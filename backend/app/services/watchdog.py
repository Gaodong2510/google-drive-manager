"""Watchdog: monitor mounts and auto-recover."""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.models import MountPoint
from app.services.mount_service import MountService
from app.services.task_logger import log_task

logger = logging.getLogger(__name__)


class WatchdogService:
    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._running = False
        self._lock = threading.Lock()

    @property
    def running(self) -> bool:
        return self._running and self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        with self._lock:
            if self.running:
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._loop, name="gdm-watchdog", daemon=True)
            self._thread.start()
            self._running = True
            logger.info("Watchdog started")

    def stop(self) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=10)
        self._running = False
        logger.info("Watchdog stopped")

    def _loop(self) -> None:
        settings = get_settings()
        # Initial delay
        self._stop.wait(5)
        while not self._stop.is_set():
            try:
                self._tick()
            except Exception:
                logger.exception("Watchdog tick failed")
            self._stop.wait(settings.watchdog_interval_seconds)

    def _tick(self) -> None:
        settings = get_settings()
        db = SessionLocal()
        try:
            mounts = db.query(MountPoint).filter(MountPoint.enabled == True).all()  # noqa: E712
            for mount in mounts:
                try:
                    self._check_mount(db, mount, settings)
                except Exception as exc:
                    logger.exception("Watchdog check failed for mount %s", mount.id)
                    log_task(
                        db,
                        task_type="watchdog",
                        mount_id=mount.id,
                        status="error",
                        message=f"Watchdog 检查异常: {mount.name}",
                        detail=str(exc),
                    )
        finally:
            db.close()

    def _check_mount(self, db, mount: MountPoint, settings) -> None:
        if mount.watchdog_paused:
            return
        if not mount.auto_start and mount.status == "stopped":
            return

        svc = MountService(db)
        mount = svc.refresh_status(mount)

        healthy = mount.status == "running" and svc.is_process_alive(mount.pid)
        if healthy and settings.watchdog_read_check:
            if not svc.check_readable(mount.local_path):
                healthy = False
                mount.last_error = "挂载目录不可读"
                mount.status = "error"
                db.add(mount)
                db.commit()

        if healthy:
            if mount.consecutive_failures:
                mount.consecutive_failures = 0
                db.add(mount)
                db.commit()
            return

        # Only auto-recover if auto_start or was supposed to run
        should_run = mount.auto_start or mount.status in ("error", "starting", "running")
        if not should_run:
            return

        max_fail = settings.watchdog_max_restarts
        if (mount.consecutive_failures or 0) >= max_fail:
            if not mount.watchdog_paused:
                mount.watchdog_paused = True
                mount.last_error = (
                    f"连续恢复失败 {mount.consecutive_failures} 次，已暂停自动重启。"
                    "请检查网络、Google 授权或 rclone 日志。"
                )
                db.add(mount)
                db.commit()
                log_task(
                    db,
                    task_type="watchdog",
                    mount_id=mount.id,
                    status="error",
                    message=f"挂载 {mount.name} 已暂停自动恢复",
                    detail=mount.last_error,
                )
            return

        log_task(
            db,
            task_type="watchdog",
            mount_id=mount.id,
            status="warning",
            message=f"检测到异常，尝试恢复: {mount.name} (status={mount.status})",
            detail=mount.last_error,
        )
        try:
            # stop dirty state then start
            try:
                svc.stop(mount, reason="watchdog")
            except Exception:
                pass
            mount = db.query(MountPoint).filter(MountPoint.id == mount.id).first()
            if not mount:
                return
            result = svc.start(mount, reason="watchdog")
            if result.status != "running":
                result.consecutive_failures = (result.consecutive_failures or 0) + 1
                db.add(result)
                db.commit()
            else:
                log_task(
                    db,
                    task_type="watchdog",
                    mount_id=mount.id,
                    status="success",
                    message=f"自动恢复成功: {mount.name}",
                )
        except Exception as exc:
            mount = db.query(MountPoint).filter(MountPoint.id == mount.id).first()
            if mount:
                mount.consecutive_failures = (mount.consecutive_failures or 0) + 1
                mount.last_error = str(exc)
                mount.status = "error"
                db.add(mount)
                db.commit()
            log_task(
                db,
                task_type="watchdog",
                mount_id=mount.id if mount else None,
                status="error",
                message=f"自动恢复失败: {mount.name if mount else '?'}",
                detail=str(exc),
            )


_watchdog: WatchdogService | None = None


def get_watchdog() -> WatchdogService:
    global _watchdog
    if _watchdog is None:
        _watchdog = WatchdogService()
    return _watchdog


def restore_autostart_mounts() -> None:
    """Called on application startup to restore mounts with auto_start."""
    db = SessionLocal()
    try:
        mounts = (
            db.query(MountPoint)
            .filter(MountPoint.enabled == True, MountPoint.auto_start == True)  # noqa: E712
            .all()
        )
        svc = MountService(db)
        for mount in mounts:
            if mount.watchdog_paused:
                continue
            try:
                svc.refresh_status(mount)
                if mount.status != "running":
                    log_task(
                        db,
                        task_type="system",
                        mount_id=mount.id,
                        status="info",
                        message=f"系统启动，自动恢复挂载: {mount.name}",
                    )
                    svc.start(mount, reason="boot")
            except Exception as exc:
                logger.exception("Failed to restore mount %s", mount.name)
                log_task(
                    db,
                    task_type="system",
                    mount_id=mount.id,
                    status="error",
                    message=f"开机自动挂载失败: {mount.name}",
                    detail=str(exc),
                )
    finally:
        db.close()
