"""Mount management API."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.core.config import MOUNT_PRESETS
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.models import DriveAccount, MountPoint, User
from app.schemas.schemas import MessageOut, MountCreate, MountOut, MountUpdate
from app.services.mount_service import MountService, merge_params, tail_file
from app.services.safe_exec import validate_path
from app.services.task_logger import log_task

router = APIRouter(prefix="/mounts", tags=["mounts"])


def _uptime(mount: MountPoint) -> int | None:
    if mount.status != "running" or not mount.started_at:
        return None
    st = mount.started_at
    if st.tzinfo is None:
        st = st.replace(tzinfo=timezone.utc)
    return int((datetime.now(timezone.utc) - st).total_seconds())


def to_out(mount: MountPoint, svc: MountService) -> MountOut:
    acc = mount.account
    try:
        params = json.loads(mount.params_json or "{}")
    except json.JSONDecodeError:
        params = {}
    params = merge_params(mount.mode, params)
    return MountOut(
        id=mount.id,
        name=mount.name,
        account_id=mount.account_id,
        account_name=acc.name if acc else None,
        remote_name=acc.remote_name if acc else None,
        remote_path=mount.remote_path or "",
        local_path=mount.local_path,
        mode=mount.mode,
        params=params,
        cache_dir=mount.cache_dir or str(svc.resolve_cache_dir(mount)),
        enabled=mount.enabled,
        auto_start=mount.auto_start,
        status=mount.status,
        pid=mount.pid,
        started_at=mount.started_at,
        uptime_seconds=_uptime(mount),
        last_error=mount.last_error,
        restart_count=mount.restart_count or 0,
        consecutive_failures=mount.consecutive_failures or 0,
        watchdog_paused=mount.watchdog_paused,
        cache_size_bytes=mount.cache_size_bytes or 0,
        created_at=mount.created_at,
        updated_at=mount.updated_at,
        command_preview=svc.command_preview(mount, acc),
    )


@router.get("/presets")
def list_presets(_: User = Depends(get_current_user)):
    return {
        k: {"label": v["label"], "description": v["description"], "params": v["params"]}
        for k, v in MOUNT_PRESETS.items()
    }


@router.get("", response_model=list[MountOut])
def list_mounts(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    svc = MountService(db)
    rows = db.query(MountPoint).order_by(MountPoint.id.asc()).all()
    out = []
    for m in rows:
        try:
            svc.refresh_status(m)
        except Exception:
            pass
        out.append(to_out(m, svc))
    return out


@router.post("", response_model=MountOut)
def create_mount(
    body: MountCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    acc = db.query(DriveAccount).filter(DriveAccount.id == body.account_id).first()
    if not acc:
        raise HTTPException(404, "账号不存在")
    if db.query(MountPoint).filter(MountPoint.name == body.name).first():
        raise HTTPException(400, "挂载名称已存在")
    try:
        local = str(validate_path(body.local_path))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if db.query(MountPoint).filter(MountPoint.local_path == local).first():
        raise HTTPException(400, "该本地路径已被其他挂载使用")

    if body.mode not in MOUNT_PRESETS:
        raise HTTPException(400, "无效的模式")
    params = body.params.model_dump() if body.params else {}
    if body.mode != "custom":
        # merge with preset
        params = merge_params(body.mode, params)

    mount = MountPoint(
        name=body.name,
        account_id=acc.id,
        remote_path=body.remote_path or "",
        local_path=local,
        mode=body.mode,
        params_json=json.dumps(params, ensure_ascii=False),
        cache_dir=body.cache_dir,
        auto_start=body.auto_start,
        enabled=True,
        status="stopped",
    )
    db.add(mount)
    db.commit()
    db.refresh(mount)
    log_task(db, task_type="system", mount_id=mount.id, account_id=acc.id, status="info", message=f"创建挂载: {mount.name}")
    return to_out(mount, MountService(db))


@router.get("/{mount_id}", response_model=MountOut)
def get_mount(mount_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    mount = db.query(MountPoint).filter(MountPoint.id == mount_id).first()
    if not mount:
        raise HTTPException(404, "挂载不存在")
    svc = MountService(db)
    svc.refresh_status(mount)
    return to_out(mount, svc)


@router.patch("/{mount_id}", response_model=MountOut)
def update_mount(
    mount_id: int,
    body: MountUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    mount = db.query(MountPoint).filter(MountPoint.id == mount_id).first()
    if not mount:
        raise HTTPException(404, "挂载不存在")
    if body.name and body.name != mount.name:
        if db.query(MountPoint).filter(MountPoint.name == body.name).first():
            raise HTTPException(400, "挂载名称已存在")
        mount.name = body.name
    if body.remote_path is not None:
        mount.remote_path = body.remote_path
    if body.local_path is not None:
        try:
            local = str(validate_path(body.local_path))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        other = db.query(MountPoint).filter(MountPoint.local_path == local, MountPoint.id != mount.id).first()
        if other:
            raise HTTPException(400, "该本地路径已被其他挂载使用")
        mount.local_path = local
    if body.mode is not None:
        if body.mode not in MOUNT_PRESETS:
            raise HTTPException(400, "无效的模式")
        mount.mode = body.mode
    if body.params is not None:
        mount.params_json = json.dumps(body.params.model_dump(), ensure_ascii=False)
    if body.cache_dir is not None:
        mount.cache_dir = body.cache_dir or None
    if body.auto_start is not None:
        mount.auto_start = body.auto_start
    if body.enabled is not None:
        mount.enabled = body.enabled
    if body.watchdog_paused is not None:
        mount.watchdog_paused = body.watchdog_paused
        if not body.watchdog_paused:
            mount.consecutive_failures = 0
    db.add(mount)
    db.commit()
    db.refresh(mount)
    return to_out(mount, MountService(db))


@router.delete("/{mount_id}", response_model=MessageOut)
def delete_mount(mount_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    mount = db.query(MountPoint).filter(MountPoint.id == mount_id).first()
    if not mount:
        raise HTTPException(404, "挂载不存在")
    svc = MountService(db)
    try:
        svc.stop(mount, reason="delete")
    except Exception:
        pass
    name = mount.name
    db.delete(mount)
    db.commit()
    return MessageOut(message=f"已删除挂载 {name}")


@router.post("/{mount_id}/start", response_model=MountOut)
def start_mount(mount_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    mount = db.query(MountPoint).filter(MountPoint.id == mount_id).first()
    if not mount:
        raise HTTPException(404, "挂载不存在")
    try:
        mount = MountService(db).start(mount, reason="manual")
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return to_out(mount, MountService(db))


@router.post("/{mount_id}/stop", response_model=MountOut)
def stop_mount(mount_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    mount = db.query(MountPoint).filter(MountPoint.id == mount_id).first()
    if not mount:
        raise HTTPException(404, "挂载不存在")
    try:
        mount = MountService(db).stop(mount, reason="manual")
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return to_out(mount, MountService(db))


@router.post("/{mount_id}/restart", response_model=MountOut)
def restart_mount(mount_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    mount = db.query(MountPoint).filter(MountPoint.id == mount_id).first()
    if not mount:
        raise HTTPException(404, "挂载不存在")
    try:
        mount = MountService(db).restart(mount, reason="manual")
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return to_out(mount, MountService(db))


@router.get("/{mount_id}/logs")
def mount_logs(
    mount_id: int,
    lines: int = Query(200, ge=10, le=5000),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    mount = db.query(MountPoint).filter(MountPoint.id == mount_id).first()
    if not mount:
        raise HTTPException(404, "挂载不存在")
    path = MountService(db).log_path(mount)
    content = tail_file(path, lines)
    return {"mount_id": mount_id, "path": str(path), "content": content}


@router.get("/{mount_id}/logs/download")
def download_logs(mount_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    mount = db.query(MountPoint).filter(MountPoint.id == mount_id).first()
    if not mount:
        raise HTTPException(404, "挂载不存在")
    path = MountService(db).log_path(mount)
    if not path.exists():
        return PlainTextResponse("", headers={"Content-Disposition": f'attachment; filename="mount_{mount_id}.log"'})
    return PlainTextResponse(
        path.read_text(encoding="utf-8", errors="replace"),
        headers={"Content-Disposition": f'attachment; filename="mount_{mount_id}.log"'},
    )


@router.delete("/{mount_id}/logs", response_model=MessageOut)
def clear_logs(mount_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    mount = db.query(MountPoint).filter(MountPoint.id == mount_id).first()
    if not mount:
        raise HTTPException(404, "挂载不存在")
    path = MountService(db).log_path(mount)
    if path.exists():
        path.write_text("", encoding="utf-8")
    return MessageOut(message="日志已清空")
