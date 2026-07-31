"""Dashboard, cache, settings, backup, rclone, tasks."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import encrypt_value
from app.models.models import DriveAccount, MountPoint, SystemSetting, TaskLog, User
from app.schemas.schemas import (
    CacheInfo,
    DashboardOut,
    MessageOut,
    MountOut,
    RcloneStatus,
    SettingsOut,
    SettingUpdate,
    SystemStats,
    TaskLogOut,
    TrafficOut,
    UploadStatusOut,
)
from app.api.mounts import to_out
from app.services import backup_service
from app.services.mount_service import MountService
from app.services.oauth_service import get_setting, set_setting
from app.services.rclone_service import get_rclone
from app.services.system_monitor import clear_cache_dir, disk_warnings_for_paths, get_cache_info, get_system_stats
from app.services.traffic_service import get_traffic_summary, reset_today, sample_all_mounts
from app.services.transfer_service import get_transfer_service
from app.services.upload_monitor import (
    build_mount_upload_status,
    merge_copy_jobs_into_mounts,
    summarize_uploads,
)
from app.services.watchdog import get_watchdog

router = APIRouter(tags=["system"])


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    stats = get_system_stats()
    accounts = db.query(DriveAccount).count()
    mounts = db.query(MountPoint).all()
    svc = MountService(db)
    refreshed = []
    for m in mounts:
        try:
            svc.refresh_status(m)
        except Exception:
            pass
        refreshed.append(m)
    running = sum(1 for m in refreshed if m.status == "running")
    error = sum(1 for m in refreshed if m.status == "error")
    stopped = sum(1 for m in refreshed if m.status == "stopped")
    cache_total = sum(m.cache_size_bytes or 0 for m in refreshed)
    rc = get_rclone()
    paths = ["/"] + [m.local_path for m in refreshed] + [str(get_settings().cache_dir)]
    warnings = disk_warnings_for_paths(paths)
    # Opportunistic traffic sample so dashboard stays fresh even between watchdog ticks
    traffic = None
    try:
        sample_all_mounts(db)
        traffic = TrafficOut(**get_traffic_summary(db))
    except Exception:
        try:
            traffic = TrafficOut(**get_traffic_summary(db))
        except Exception:
            traffic = None
    return DashboardOut(
        system=SystemStats(**stats),
        accounts_total=accounts,
        mounts_total=len(refreshed),
        mounts_running=running,
        mounts_error=error,
        mounts_stopped=stopped,
        total_cache_bytes=cache_total,
        rclone_installed=rc.is_installed(),
        rclone_version=rc.version(),
        rclone_mount_processes=rc.count_mount_processes(),
        watchdog_running=get_watchdog().running,
        disk_warnings=warnings,
        mounts=[to_out(m, svc) for m in refreshed],
        traffic=traffic,
    )


@router.get("/traffic", response_model=TrafficOut)
def traffic_status(
    sample: bool = Query(True, description="采样一次再返回"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if sample:
        try:
            sample_all_mounts(db)
        except Exception:
            pass
    return TrafficOut(**get_traffic_summary(db))


@router.post("/traffic/reset", response_model=TrafficOut)
def traffic_reset(
    mount_id: int | None = Query(None, description="仅重置指定挂载；省略则重置全部今日上传流量"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return TrafficOut(**reset_today(db, mount_id=mount_id))


@router.get("/system/stats", response_model=SystemStats)
def system_stats(_: User = Depends(get_current_user)):
    return SystemStats(**get_system_stats())


@router.get("/rclone/status", response_model=RcloneStatus)
def rclone_status(_: User = Depends(get_current_user)):
    rc = get_rclone()
    return RcloneStatus(
        installed=rc.is_installed(),
        version=rc.version(),
        path=rc.find_binary(),
        config_path=str(rc.config_path),
        mount_processes=rc.count_mount_processes(),
    )


@router.post("/rclone/install", response_model=MessageOut)
def rclone_install(_: User = Depends(get_current_user)):
    try:
        msg = get_rclone().install_rclone()
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return MessageOut(message=msg)


@router.get("/cache", response_model=CacheInfo)
def cache_info(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    mounts = db.query(MountPoint).all()
    return CacheInfo(**get_cache_info(mounts))


@router.post("/cache/clear", response_model=MessageOut)
def cache_clear(path: str | None = None, _: User = Depends(get_current_user)):
    try:
        result = clear_cache_dir(path)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return MessageOut(message="缓存已清理", detail=result)


@router.get("/settings", response_model=SettingsOut)
def get_settings_api(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    settings = get_settings()
    secret_set = bool(get_setting(db, "google_client_secret_enc"))
    ms_secret_set = bool(get_setting(db, "microsoft_client_secret_enc"))
    default_cb = (
        get_setting(db, "google_redirect_uri")
        or settings.google_redirect_uri
        or f"http://127.0.0.1:{settings.port}/api/oauth/callback"
    )
    return SettingsOut(
        google_client_id=get_setting(db, "google_client_id") or settings.google_client_id,
        google_client_secret_set=secret_set,
        google_redirect_uri=default_cb,
        microsoft_client_id=get_setting(db, "microsoft_client_id") or settings.microsoft_client_id,
        microsoft_client_secret_set=ms_secret_set,
        microsoft_redirect_uri=get_setting(db, "microsoft_redirect_uri")
        or settings.microsoft_redirect_uri
        or default_cb,
        microsoft_tenant=get_setting(db, "microsoft_tenant") or settings.microsoft_tenant or "common",
        allow_file_delete=settings.allow_file_delete,
        watchdog_interval_seconds=int(get_setting(db, "watchdog_interval_seconds") or settings.watchdog_interval_seconds),
        watchdog_max_restarts=int(get_setting(db, "watchdog_max_restarts") or settings.watchdog_max_restarts),
        rclone_config_path=str(settings.resolved_rclone_config),
        data_dir=str(settings.data_dir),
        app_version=settings.app_version,
    )


@router.put("/settings", response_model=SettingsOut)
def update_settings_api(
    body: SettingUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if body.google_client_id is not None:
        set_setting(db, "google_client_id", body.google_client_id)
    if body.google_client_secret is not None and body.google_client_secret != "":
        set_setting(db, "google_client_secret_enc", encrypt_value(body.google_client_secret))
    if body.google_redirect_uri is not None:
        set_setting(db, "google_redirect_uri", body.google_redirect_uri)
    if body.microsoft_client_id is not None:
        set_setting(db, "microsoft_client_id", body.microsoft_client_id)
    if body.microsoft_client_secret is not None and body.microsoft_client_secret != "":
        set_setting(db, "microsoft_client_secret_enc", encrypt_value(body.microsoft_client_secret))
    if body.microsoft_redirect_uri is not None:
        set_setting(db, "microsoft_redirect_uri", body.microsoft_redirect_uri)
    if body.microsoft_tenant is not None:
        set_setting(db, "microsoft_tenant", body.microsoft_tenant.strip() or "common")
    if body.watchdog_interval_seconds is not None:
        set_setting(db, "watchdog_interval_seconds", str(body.watchdog_interval_seconds))
    if body.watchdog_max_restarts is not None:
        set_setting(db, "watchdog_max_restarts", str(body.watchdog_max_restarts))
    return get_settings_api(db, _)


@router.get("/uploads/status", response_model=UploadStatusOut)
def uploads_status(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """VFS 回写 + 跨盘复制进度：挂载日志/RC + 后台 copy 任务，统一在最近事件里展示。"""
    svc = MountService(db)
    mounts = db.query(MountPoint).order_by(MountPoint.id).all()
    statuses = []
    for m in mounts:
        try:
            svc.refresh_status(m)
        except Exception:
            pass
        statuses.append(
            build_mount_upload_status(
                mount_id=m.id,
                mount_name=m.name,
                local_path=m.local_path,
                mount_status=m.status or "stopped",
                log_path=svc.log_path(m),
                try_rc=True,
            )
        )
    copy_jobs_raw = get_transfer_service().list_recent(limit=30)
    copy_jobs = merge_copy_jobs_into_mounts(statuses, copy_jobs_raw)
    return summarize_uploads(statuses, copy_jobs=copy_jobs)


@router.get("/tasks", response_model=list[TaskLogOut])
def list_tasks(
    limit: int = Query(100, ge=1, le=500),
    task_type: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = db.query(TaskLog).order_by(TaskLog.id.desc())
    if task_type:
        query = query.filter(TaskLog.task_type == task_type)
    if q:
        like = f"%{q}%"
        query = query.filter(TaskLog.message.like(like))
    return query.limit(limit).all()


@router.delete("/tasks", response_model=MessageOut)
def clear_tasks(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    db.query(TaskLog).delete()
    db.commit()
    return MessageOut(message="任务日志已清空")


@router.get("/backups")
def list_backups(_: User = Depends(get_current_user)):
    return backup_service.list_backups()


@router.post("/backups", response_model=MessageOut)
def create_backup(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    path = backup_service.create_backup(db)
    return MessageOut(message="备份已创建", detail={"path": str(path), "name": path.name})


@router.get("/backups/{name}/download")
def download_backup(name: str, _: User = Depends(get_current_user)):
    if "/" in name or ".." in name or not name.startswith("gdm_backup_"):
        raise HTTPException(400, "非法文件名")
    path = get_settings().backups_dir / name
    if not path.exists():
        raise HTTPException(404, "备份不存在")
    return FileResponse(path, filename=name, media_type="application/octet-stream")


@router.post("/backups/restore", response_model=MessageOut)
async def restore_backup(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    settings = get_settings()
    dest = settings.backups_dir / f"restore_upload_{file.filename or 'backup'}.enc"
    content = await file.read()
    dest.write_bytes(content)
    try:
        result = backup_service.restore_backup(db, dest)
    except Exception as exc:
        raise HTTPException(400, f"恢复失败: {exc}") from exc
    return MessageOut(message=result.get("message", "恢复完成"), detail=result)


@router.get("/watchdog")
def watchdog_status(_: User = Depends(get_current_user)):
    wd = get_watchdog()
    return {"running": wd.running}


@router.post("/watchdog/start", response_model=MessageOut)
def watchdog_start(_: User = Depends(get_current_user)):
    get_watchdog().start()
    return MessageOut(message="Watchdog 已启动")


@router.post("/watchdog/stop", response_model=MessageOut)
def watchdog_stop(_: User = Depends(get_current_user)):
    get_watchdog().stop()
    return MessageOut(message="Watchdog 已停止")
