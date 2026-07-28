"""Google Drive account management."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import encrypt_value
from app.models.models import DriveAccount, MountPoint, User
from app.schemas.schemas import (
    DriveAccountCreate,
    DriveAccountOut,
    DriveAccountUpdate,
    MessageOut,
    OAuthStartResponse,
    PasteTokenRequest,
    RcloneImportPreviewRequest,
    RcloneImportPreviewResponse,
    RcloneImportRequest,
    RcloneImportResult,
    RcloneRemotePreview,
)
from app.services.mount_service import MountService
from app.services.oauth_service import OAuthService
from app.services.rclone_service import get_rclone
from app.services.task_logger import log_task

router = APIRouter(prefix="/accounts", tags=["accounts"])


def _remote_from_name(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_")
    return (s or "drive")[:48]


def to_out(acc: DriveAccount, db: Session) -> DriveAccountOut:
    mounts = db.query(MountPoint).filter(MountPoint.account_id == acc.id).all()
    running = sum(1 for m in mounts if m.status == "running")
    return DriveAccountOut(
        id=acc.id,
        name=acc.name,
        remote_name=acc.remote_name,
        provider=getattr(acc, "provider", None) or "drive",
        email=acc.email,
        root_folder_id=acc.root_folder_id,
        team_drive=acc.team_drive,
        onedrive_drive_id=getattr(acc, "onedrive_drive_id", None),
        onedrive_drive_type=getattr(acc, "onedrive_drive_type", None),
        status=acc.status,
        last_check_at=acc.last_check_at,
        last_error=acc.last_error,
        total_bytes=acc.total_bytes,
        used_bytes=acc.used_bytes,
        free_bytes=acc.free_bytes,
        notes=acc.notes,
        created_at=acc.created_at,
        updated_at=acc.updated_at,
        has_token=bool(acc.token_enc),
        mount_count=len(mounts),
        running_mounts=running,
    )


@router.get("", response_model=list[DriveAccountOut])
def list_accounts(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rows = db.query(DriveAccount).order_by(DriveAccount.id.asc()).all()
    return [to_out(a, db) for a in rows]


@router.post("", response_model=DriveAccountOut)
def create_account(
    body: DriveAccountCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if db.query(DriveAccount).filter(DriveAccount.name == body.name).first():
        raise HTTPException(400, "账号名称已存在")
    remote = body.remote_name or _remote_from_name(body.name)
    if not re.match(r"^[A-Za-z0-9_-]{1,64}$", remote):
        raise HTTPException(400, "remote 名称只能包含字母数字下划线和连字符")
    if db.query(DriveAccount).filter(DriveAccount.remote_name == remote).first():
        raise HTTPException(400, "remote 名称已存在")
    provider = (body.provider or "drive").strip().lower()
    if provider not in ("drive", "onedrive"):
        raise HTTPException(400, "provider 仅支持 drive 或 onedrive")
    acc = DriveAccount(
        name=body.name,
        remote_name=remote,
        provider=provider,
        root_folder_id=body.root_folder_id if provider == "drive" else None,
        team_drive=body.team_drive if provider == "drive" else False,
        onedrive_drive_id=body.onedrive_drive_id if provider == "onedrive" else None,
        onedrive_drive_type=body.onedrive_drive_type if provider == "onedrive" else None,
        notes=body.notes,
        status="pending",
    )
    if body.client_id:
        acc.client_id_enc = encrypt_value(body.client_id)
    if body.client_secret:
        acc.client_secret_enc = encrypt_value(body.client_secret)
    db.add(acc)
    db.commit()
    db.refresh(acc)
    log_task(db, task_type="system", account_id=acc.id, status="info", message=f"创建账号: {acc.name}")
    return to_out(acc, db)


@router.get("/{account_id}", response_model=DriveAccountOut)
def get_account(account_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    acc = db.query(DriveAccount).filter(DriveAccount.id == account_id).first()
    if not acc:
        raise HTTPException(404, "账号不存在")
    return to_out(acc, db)


@router.patch("/{account_id}", response_model=DriveAccountOut)
def update_account(
    account_id: int,
    body: DriveAccountUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    acc = db.query(DriveAccount).filter(DriveAccount.id == account_id).first()
    if not acc:
        raise HTTPException(404, "账号不存在")
    if body.name and body.name != acc.name:
        if db.query(DriveAccount).filter(DriveAccount.name == body.name).first():
            raise HTTPException(400, "账号名称已存在")
        acc.name = body.name
    if body.client_id is not None:
        acc.client_id_enc = encrypt_value(body.client_id) if body.client_id else None
    if body.client_secret is not None:
        acc.client_secret_enc = encrypt_value(body.client_secret) if body.client_secret else None
    if body.root_folder_id is not None:
        acc.root_folder_id = body.root_folder_id or None
    if body.provider is not None:
        p = body.provider.strip().lower()
        if p not in ("drive", "onedrive"):
            raise HTTPException(400, "provider 仅支持 drive 或 onedrive")
        acc.provider = p
    if body.team_drive is not None:
        acc.team_drive = body.team_drive
    if body.onedrive_drive_id is not None:
        acc.onedrive_drive_id = body.onedrive_drive_id or None
    if body.onedrive_drive_type is not None:
        acc.onedrive_drive_type = body.onedrive_drive_type or None
    if body.notes is not None:
        acc.notes = body.notes
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return to_out(acc, db)


@router.delete("/{account_id}", response_model=MessageOut)
def delete_account(account_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    acc = db.query(DriveAccount).filter(DriveAccount.id == account_id).first()
    if not acc:
        raise HTTPException(404, "账号不存在")
    # Stop mounts first
    mounts = db.query(MountPoint).filter(MountPoint.account_id == acc.id).all()
    svc = MountService(db)
    for m in mounts:
        try:
            if m.status == "running" or m.pid:
                svc.stop(m, reason="delete_account")
        except Exception:
            pass
        db.delete(m)
    try:
        get_rclone().delete_remote(acc.remote_name)
    except Exception:
        pass
    name = acc.name
    db.delete(acc)
    db.commit()
    log_task(db, task_type="system", status="info", message=f"删除账号: {name}")
    return MessageOut(message="账号已删除")


@router.post("/{account_id}/oauth/start", response_model=OAuthStartResponse)
def start_oauth(account_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    acc = db.query(DriveAccount).filter(DriveAccount.id == account_id).first()
    if not acc:
        raise HTTPException(404, "账号不存在")
    try:
        data = OAuthService(db).start_auth(
            account_id=acc.id,
            name=acc.name,
            remote_name=acc.remote_name,
            provider=getattr(acc, "provider", None) or "drive",
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return OAuthStartResponse(**data)


@router.post("/oauth/start", response_model=OAuthStartResponse)
def start_oauth_new(
    body: DriveAccountCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    try:
        data = OAuthService(db).start_auth(
            name=body.name,
            remote_name=body.remote_name or _remote_from_name(body.name),
            provider=body.provider or "drive",
            client_id=body.client_id,
            client_secret=body.client_secret,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return OAuthStartResponse(**data)


@router.post("/auth/token", response_model=DriveAccountOut)
def paste_token_create(
    body: PasteTokenRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Create a new account by pasting rclone authorize token JSON."""
    if not (body.name or "").strip():
        raise HTTPException(400, "新建账号请填写显示名称")
    try:
        acc = OAuthService(db).apply_token(
            token_raw=body.token,
            name=body.name,
            remote_name=body.remote_name,
            provider=body.provider,
            client_id=body.client_id,
            client_secret=body.client_secret,
            root_folder_id=body.root_folder_id,
            team_drive=body.team_drive,
            onedrive_drive_id=body.onedrive_drive_id,
            onedrive_drive_type=body.onedrive_drive_type,
            notes=body.notes,
            test_connection=body.test_connection,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"授权失败: {exc}") from exc
    return to_out(acc, db)


@router.post("/{account_id}/auth/token", response_model=DriveAccountOut)
def paste_token_existing(
    account_id: int,
    body: PasteTokenRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Apply pasted token to an existing account."""
    try:
        acc = OAuthService(db).apply_token(
            token_raw=body.token,
            account_id=account_id,
            name=body.name,
            provider=body.provider,
            client_id=body.client_id,
            client_secret=body.client_secret,
            root_folder_id=body.root_folder_id,
            team_drive=body.team_drive,
            onedrive_drive_id=body.onedrive_drive_id,
            onedrive_drive_type=body.onedrive_drive_type,
            notes=body.notes,
            test_connection=body.test_connection,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"授权失败: {exc}") from exc
    return to_out(acc, db)


@router.post("/import-rclone/preview", response_model=RcloneImportPreviewResponse)
def import_rclone_preview(
    body: RcloneImportPreviewRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Parse pasted rclone.conf and list drive/onedrive remotes."""
    try:
        remotes = OAuthService(db).preview_rclone_import(body.config_text)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    items = [RcloneRemotePreview(**r) for r in remotes]
    return RcloneImportPreviewResponse(remotes=items, count=len(items))


@router.post("/import-rclone", response_model=RcloneImportResult)
def import_rclone(
    body: RcloneImportRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Import selected drive/onedrive remotes from rclone.conf text."""
    try:
        accounts = OAuthService(db).import_rclone_remotes(
            config_text=body.config_text,
            selected_remotes=body.selected_remotes,
            name_prefix=body.name_prefix,
            test_connection=body.test_connection,
            overwrite=body.overwrite,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"导入失败: {exc}") from exc
    outs = [to_out(a, db) for a in accounts]
    return RcloneImportResult(
        imported=outs,
        count=len(outs),
        message=f"成功导入 {len(outs)} 个云盘账号（Google Drive / OneDrive）",
    )


@router.post("/{account_id}/test", response_model=MessageOut)
def test_account(account_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    acc = db.query(DriveAccount).filter(DriveAccount.id == account_id).first()
    if not acc:
        raise HTTPException(404, "账号不存在")
    try:
        about = OAuthService(db).test_account(acc)
    except Exception as exc:
        acc.status = "error"
        acc.last_error = str(exc)[:500]
        db.add(acc)
        db.commit()
        raise HTTPException(400, f"连接失败: {exc}") from exc
    return MessageOut(message="连接正常", detail=about)
