"""Mount lifecycle management via rclone mount."""

from __future__ import annotations

import json
import logging
import os
import signal
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil
from sqlalchemy.orm import Session

from app.core.config import MOUNT_PRESETS, get_settings
from app.models.models import DriveAccount, MountPoint
from app.services.rclone_service import get_rclone
from app.services.safe_exec import (
    run_cmd,
    start_process,
    validate_path,
    validate_remote_name,
    validate_safe_value,
)
from app.services.task_logger import log_task

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def merge_params(mode: str, custom: dict | None) -> dict[str, Any]:
    preset = MOUNT_PRESETS.get(mode, MOUNT_PRESETS["media"])
    base = dict(preset.get("params") or {})
    if custom:
        base.update({k: v for k, v in custom.items() if v is not None})
    return base


def build_mount_args(
    *,
    remote_name: str,
    remote_path: str,
    local_path: str,
    params: dict[str, Any],
    cache_dir: str,
    log_file: Path,
    config_path: Path,
    rclone_bin: str,
    mount_id: int | None = None,
    provider: str = "drive",
) -> list[str]:
    remote_name = validate_remote_name(remote_name)
    local = validate_path(local_path)
    cache = validate_path(cache_dir)
    rpath = (remote_path or "").lstrip("/")
    # Prevent remote path injection via newlines
    if "\n" in rpath or "\r" in rpath or ":" in rpath:
        raise ValueError("非法 remote 路径")
    source = f"{remote_name}:{rpath}"
    provider = (provider or "drive").strip().lower()

    args: list[str] = [
        rclone_bin,
        "mount",
        source,
        str(local),
        "--config",
        str(config_path),
        "--daemon=false",  # we manage process ourselves
        "--log-file",
        str(log_file),
        "--log-format",
        "date,time",
    ]

    # Localhost RC for upload progress (MoviePilot writes → VFS → cloud)
    if mount_id is not None and int(mount_id) > 0:
        from app.services.upload_monitor import rc_port_for_mount

        rc_port = rc_port_for_mount(int(mount_id))
        args.extend(
            [
                "--rc",
                "--rc-addr",
                f"127.0.0.1:{rc_port}",
                "--rc-no-auth",
                "--stats",
                "5s",
                "--stats-log-level",
                "NOTICE",
            ]
        )

    vfs_mode = str(params.get("vfs_cache_mode", "full"))
    if vfs_mode not in ("off", "minimal", "writes", "full"):
        raise ValueError(f"非法 vfs-cache-mode: {vfs_mode}")
    args.extend(["--vfs-cache-mode", vfs_mode])

    mapping = [
        ("vfs_cache_max_size", "--vfs-cache-max-size"),
        ("vfs_cache_max_age", "--vfs-cache-max-age"),
        ("vfs_read_chunk_size", "--vfs-read-chunk-size"),
        ("vfs_read_chunk_size_limit", "--vfs-read-chunk-size-limit"),
        ("buffer_size", "--buffer-size"),
        ("dir_cache_time", "--dir-cache-time"),
        ("poll_interval", "--poll-interval"),
        ("attr_timeout", "--attr-timeout"),
        ("vfs_read_ahead", "--vfs-read-ahead"),
        ("vfs_write_back", "--vfs-write-back"),
        ("multi_thread_cutoff", "--multi-thread-cutoff"),
        ("umask", "--umask"),
    ]
    # Provider-specific chunk size flags
    if provider == "drive":
        mapping.append(("drive_chunk_size", "--drive-chunk-size"))
    elif provider == "onedrive":
        mapping.append(("drive_chunk_size", "--onedrive-chunk-size"))
        mapping.append(("onedrive_chunk_size", "--onedrive-chunk-size"))

    for key, flag in mapping:
        if key in params and params[key] is not None and params[key] != "":
            val = validate_safe_value(str(params[key]), key)
            args.extend([flag, val])

    if params.get("allow_other", True):
        args.append("--allow-other")

    log_level = str(params.get("log_level", "INFO")).upper()
    if log_level not in ("DEBUG", "INFO", "NOTICE", "ERROR", "CRITICAL"):
        log_level = "INFO"
    args.extend(["--log-level", log_level])

    for int_key, flag in (
        ("transfers", "--transfers"),
        ("checkers", "--checkers"),
        ("multi_thread_streams", "--multi-thread-streams"),
    ):
        if int_key in params and params[int_key] is not None:
            try:
                n = int(params[int_key])
            except (TypeError, ValueError) as exc:
                raise ValueError(f"非法整数参数 {int_key}") from exc
            if n < 0 or n > 64:
                raise ValueError(f"{int_key} 超出范围")
            args.extend([flag, str(n)])

    args.extend(["--cache-dir", str(cache)])

    # Media-friendly defaults; Google Drive pacer only for drive remotes
    args.append("--use-mmap")
    if provider == "drive":
        args.extend(
            [
                "--drive-pacer-min-sleep",
                "10ms",
                "--drive-pacer-burst",
                "200",
            ]
        )

    # Extra args: only allow known-safe flag patterns
    extra = params.get("extra_args") or []
    if isinstance(extra, list):
        for item in extra:
            s = str(item).strip()
            if not s:
                continue
            if not s.startswith("--"):
                raise ValueError(f"额外参数必须以 -- 开头: {s}")
            if any(c in s for c in (";", "|", "&", "`", "$", "\n", "\r", " ")):
                # allow flag=value without spaces
                if "=" in s and " " not in s and not any(c in s for c in (";", "|", "&", "`", "$")):
                    args.append(s)
                    continue
                raise ValueError(f"额外参数不安全: {s}")
            args.append(s)

    return args


class MountService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.settings = get_settings()
        self.rclone = get_rclone()

    def log_path(self, mount: MountPoint) -> Path:
        return self.settings.logs_dir / "mounts" / f"mount_{mount.id}.log"

    def resolve_cache_dir(self, mount: MountPoint) -> Path:
        if mount.cache_dir:
            return validate_path(mount.cache_dir)
        return validate_path(str(self.settings.cache_dir / f"mount_{mount.id}"))

    def get_params(self, mount: MountPoint) -> dict[str, Any]:
        try:
            custom = json.loads(mount.params_json or "{}")
        except json.JSONDecodeError:
            custom = {}
        return merge_params(mount.mode, custom)

    def command_preview(self, mount: MountPoint, account: DriveAccount | None = None) -> list[str]:
        if account is None:
            account = mount.account
        binary = self.rclone.find_binary() or "rclone"
        params = self.get_params(mount)
        try:
            return build_mount_args(
                remote_name=account.remote_name,
                remote_path=mount.remote_path or "",
                local_path=mount.local_path,
                params=params,
                cache_dir=str(self.resolve_cache_dir(mount)),
                log_file=self.log_path(mount),
                config_path=self.rclone.config_path,
                rclone_bin=binary,
                mount_id=mount.id,
                provider=getattr(account, "provider", None) or "drive",
            )
        except Exception as exc:
            return [f"# error: {exc}"]

    def is_process_alive(self, pid: int | None) -> bool:
        if not pid:
            return False
        try:
            p = psutil.Process(pid)
            if not p.is_running() or p.status() == psutil.STATUS_ZOMBIE:
                return False
            # Confirm it's rclone
            name = (p.name() or "").lower()
            cmdline = " ".join(p.cmdline() or []).lower()
            return "rclone" in name or "rclone" in cmdline
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            return False

    def is_path_mounted(self, local_path: str) -> bool:
        try:
            path = str(validate_path(local_path))
        except ValueError:
            return False
        try:
            with open("/proc/mounts", encoding="utf-8") as f:
                for line in f:
                    parts = line.split()
                    if len(parts) >= 2 and parts[1] == path:
                        return True
        except OSError:
            pass
        # Fallback: mountpoint command
        try:
            r = run_cmd(["mountpoint", "-q", path], timeout=5)
            return r.returncode == 0
        except Exception:
            return False

    def check_readable(self, local_path: str) -> bool:
        try:
            path = validate_path(local_path)
            if not path.exists():
                return False
            # listdir is enough for fuse health
            os.listdir(path)
            return True
        except Exception:
            return False

    def find_pid_for_mount(self, local_path: str) -> int | None:
        path = str(validate_path(local_path))
        for proc in psutil.process_iter(["pid", "name", "cmdline"]):
            try:
                cmdline = proc.info.get("cmdline") or []
                if not cmdline:
                    continue
                if "rclone" not in (cmdline[0] or "") and "rclone" not in " ".join(cmdline):
                    continue
                if "mount" not in cmdline:
                    continue
                if path in cmdline:
                    return int(proc.info["pid"])
            except (psutil.NoSuchProcess, psutil.AccessDenied, TypeError, ValueError):
                continue
        return None

    def refresh_status(self, mount: MountPoint) -> MountPoint:
        alive = self.is_process_alive(mount.pid)
        mounted = self.is_path_mounted(mount.local_path)
        if not alive:
            # Try rediscover
            pid = self.find_pid_for_mount(mount.local_path)
            if pid:
                mount.pid = pid
                alive = True
        if alive and mounted:
            if mount.status != "running":
                mount.status = "running"
                if not mount.started_at:
                    mount.started_at = _utcnow()
        elif mount.status == "starting":
            # keep starting briefly
            if mount.started_at and (_utcnow() - mount.started_at.replace(tzinfo=timezone.utc)).total_seconds() > 60:
                if not alive:
                    mount.status = "error"
                    mount.last_error = mount.last_error or "启动超时，进程未存活"
        elif alive and not mounted:
            mount.status = "error"
            mount.last_error = "进程存在但挂载点未挂载"
        elif not alive and mounted:
            mount.status = "error"
            mount.last_error = "目录仍被挂载但 rclone 进程已退出"
            mount.pid = None
        else:
            if mount.status not in ("error",):
                mount.status = "stopped"
            mount.pid = None
            if mount.status == "stopped":
                mount.started_at = None
        # Cache size
        try:
            cache = self.resolve_cache_dir(mount)
            mount.cache_size_bytes = dir_size(cache) if cache.exists() else 0
        except Exception:
            pass
        self.db.add(mount)
        self.db.commit()
        self.db.refresh(mount)
        return mount

    def ensure_mount_dir(self, local_path: str) -> Path:
        path = validate_path(local_path)
        # Safety: don't allow mounting over critical system dirs
        forbidden_prefixes = ("/bin", "/boot", "/dev", "/etc", "/lib", "/proc", "/root", "/run", "/sbin", "/sys", "/usr")
        s = str(path)
        for fp in forbidden_prefixes:
            if s == fp or s.startswith(fp + "/"):
                # allow /mnt, /media, /data, /opt/mounts etc.
                if not (s.startswith("/mnt") or s.startswith("/media") or s.startswith("/data") or s.startswith("/opt")):
                    if s.startswith(("/bin", "/boot", "/dev", "/etc", "/lib", "/proc", "/sys", "/sbin", "/usr")):
                        raise ValueError(f"禁止在系统目录挂载: {s}")
        # Explicit allow list-ish: must be under /mnt, /media, /data, /opt, or custom under home-like
        allowed = s.startswith(("/mnt/", "/media/", "/data/", "/opt/", "/home/")) or s in ("/mnt", "/media", "/data")
        if not allowed and not s.startswith(str(self.settings.data_dir)):
            # Still allow if user explicitly created under common media paths
            if not s.startswith("/srv/"):
                raise ValueError(
                    f"挂载路径必须位于 /mnt、/media、/data、/opt、/srv、/home 或数据目录下: {s}"
                )
        path.mkdir(parents=True, exist_ok=True)
        return path

    def cleanup_stale_mount(self, local_path: str) -> None:
        path = str(validate_path(local_path))
        if self.is_path_mounted(path):
            # try fusermount / umount
            for cmd in (
                ["fusermount", "-uz", path],
                ["fusermount3", "-uz", path],
                ["umount", "-l", path],
            ):
                try:
                    r = run_cmd(cmd, timeout=15)
                    if r.returncode == 0:
                        logger.info("Unmounted stale mount %s via %s", path, cmd[0])
                        break
                except Exception as exc:
                    logger.debug("unmount attempt failed %s: %s", cmd, exc)

    def start(self, mount: MountPoint, *, reason: str = "manual") -> MountPoint:
        account = mount.account
        if not account:
            raise RuntimeError("账号不存在")
        if account.status not in ("connected", "ok") and not account.token_enc:
            # allow if remote exists in rclone config
            pass
        if not self.rclone.is_installed():
            raise RuntimeError("rclone 未安装，请先安装 rclone")

        # Prevent duplicate
        self.refresh_status(mount)
        if mount.status == "running" and self.is_process_alive(mount.pid):
            return mount

        # Kill orphan with same path
        orphan = self.find_pid_for_mount(mount.local_path)
        if orphan and orphan != mount.pid:
            try:
                os.kill(orphan, signal.SIGTERM)
                time.sleep(1)
            except ProcessLookupError:
                pass

        self.cleanup_stale_mount(mount.local_path)
        self.ensure_mount_dir(mount.local_path)
        cache = self.resolve_cache_dir(mount)
        cache.mkdir(parents=True, exist_ok=True)

        log_file = self.log_path(mount)
        log_file.parent.mkdir(parents=True, exist_ok=True)
        binary = self.rclone.find_binary()
        if not binary:
            raise RuntimeError("rclone 未安装")

        params = self.get_params(mount)
        args = build_mount_args(
            remote_name=account.remote_name,
            remote_path=mount.remote_path or "",
            local_path=mount.local_path,
            params=params,
            cache_dir=str(cache),
            log_file=log_file,
            config_path=self.rclone.config_path,
            rclone_bin=binary,
            mount_id=mount.id,
            provider=getattr(account, "provider", None) or "drive",
        )

        mount.status = "starting"
        mount.last_error = None
        mount.started_at = _utcnow()
        self.db.add(mount)
        self.db.commit()

        env = self.rclone.env_with_config()
        try:
            proc = start_process(args, log_file=log_file, env=env)
        except Exception as exc:
            mount.status = "error"
            mount.last_error = str(exc)
            self.db.add(mount)
            self.db.commit()
            log_task(
                self.db,
                task_type="start",
                mount_id=mount.id,
                account_id=account.id,
                status="error",
                message=f"启动挂载失败: {mount.name}",
                detail=str(exc),
            )
            raise

        # Wait briefly for mount to come up
        mount.pid = proc.pid
        self.db.add(mount)
        self.db.commit()

        ok = False
        last_err = None
        for _ in range(30):
            time.sleep(0.5)
            if proc.poll() is not None:
                # process exited
                last_err = tail_file(log_file, 20) or f"rclone 退出 code={proc.returncode}"
                break
            if self.is_path_mounted(mount.local_path) or self.check_readable(mount.local_path):
                ok = True
                break

        if ok:
            mount.status = "running"
            mount.consecutive_failures = 0
            mount.last_error = None
            log_task(
                self.db,
                task_type="start",
                mount_id=mount.id,
                account_id=account.id,
                status="success",
                message=f"挂载已启动: {mount.name} (pid={mount.pid}, reason={reason})",
            )
        else:
            # cleanup
            if proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=5)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
            self.cleanup_stale_mount(mount.local_path)
            mount.status = "error"
            mount.pid = None
            mount.last_error = last_err or "挂载启动失败，请查看日志"
            mount.consecutive_failures = (mount.consecutive_failures or 0) + 1
            log_task(
                self.db,
                task_type="start",
                mount_id=mount.id,
                account_id=account.id,
                status="error",
                message=f"挂载启动失败: {mount.name}",
                detail=mount.last_error,
            )

        self.db.add(mount)
        self.db.commit()
        self.db.refresh(mount)
        return mount

    def stop(self, mount: MountPoint, *, reason: str = "manual") -> MountPoint:
        pid = mount.pid or self.find_pid_for_mount(mount.local_path)
        if pid:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            # wait
            for _ in range(20):
                if not self.is_process_alive(pid):
                    break
                time.sleep(0.25)
            if self.is_process_alive(pid):
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        self.cleanup_stale_mount(mount.local_path)
        mount.pid = None
        mount.status = "stopped"
        mount.started_at = None
        self.db.add(mount)
        self.db.commit()
        self.db.refresh(mount)
        log_task(
            self.db,
            task_type="stop",
            mount_id=mount.id,
            account_id=mount.account_id,
            status="success",
            message=f"挂载已停止: {mount.name} (reason={reason})",
        )
        return mount

    def restart(self, mount: MountPoint, *, reason: str = "manual") -> MountPoint:
        try:
            self.stop(mount, reason=f"restart:{reason}")
        except Exception as exc:
            logger.warning("stop before restart failed: %s", exc)
        mount.restart_count = (mount.restart_count or 0) + 1
        self.db.add(mount)
        self.db.commit()
        result = self.start(mount, reason=f"restart:{reason}")
        log_task(
            self.db,
            task_type="restart",
            mount_id=mount.id,
            account_id=mount.account_id,
            status="success" if result.status == "running" else "error",
            message=f"重启挂载: {mount.name}",
        )
        return result


def dir_size(path: Path) -> int:
    total = 0
    try:
        for root, _dirs, files in os.walk(path):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(root, f))
                except OSError:
                    pass
    except OSError:
        pass
    return total


def tail_file(path: Path, lines: int = 100) -> str:
    if not path.exists():
        return ""
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            block = 4096
            data = b""
            while size > 0 and data.count(b"\n") <= lines:
                step = min(block, size)
                size -= step
                f.seek(size)
                data = f.read(step) + data
            text = data.decode("utf-8", errors="replace")
            return "\n".join(text.splitlines()[-lines:])
    except OSError:
        return ""
