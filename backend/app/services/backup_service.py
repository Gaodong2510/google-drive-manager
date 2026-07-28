"""Encrypted configuration backup / restore."""

from __future__ import annotations

import json
import shutil
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import decrypt_value, encrypt_value
from app.models.models import DriveAccount, MountPoint, SystemSetting, User


def create_backup(db: Session) -> Path:
    settings = get_settings()
    settings.backups_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out = settings.backups_dir / f"gdm_backup_{ts}.tar.gz.enc"

    payload: dict = {
        "version": 1,
        "created_at": ts,
        "settings": {s.key: s.value for s in db.query(SystemSetting).all()},
        "accounts": [],
        "mounts": [],
        # users: only username/hash for restore of admin
        "users": [
            {
                "username": u.username,
                "password_hash": u.password_hash,
                "must_change_password": u.must_change_password,
                "is_active": u.is_active,
            }
            for u in db.query(User).all()
        ],
    }
    for a in db.query(DriveAccount).all():
        payload["accounts"].append(
            {
                "name": a.name,
                "remote_name": a.remote_name,
                "provider": getattr(a, "provider", None) or "drive",
                "email": a.email,
                "client_id_enc": a.client_id_enc,
                "client_secret_enc": a.client_secret_enc,
                "token_enc": a.token_enc,
                "root_folder_id": a.root_folder_id,
                "team_drive": a.team_drive,
                "onedrive_drive_id": getattr(a, "onedrive_drive_id", None),
                "onedrive_drive_type": getattr(a, "onedrive_drive_type", None),
                "status": a.status,
                "notes": a.notes,
            }
        )
    for m in db.query(MountPoint).all():
        acc = m.account
        payload["mounts"].append(
            {
                "name": m.name,
                "account_remote": acc.remote_name if acc else None,
                "remote_path": m.remote_path,
                "local_path": m.local_path,
                "mode": m.mode,
                "params_json": m.params_json,
                "cache_dir": m.cache_dir,
                "enabled": m.enabled,
                "auto_start": m.auto_start,
            }
        )

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        (tmp_path / "payload.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        # copy rclone.conf if present
        rc = settings.resolved_rclone_config
        if rc.exists():
            shutil.copy2(rc, tmp_path / "rclone.conf")
        tar_path = tmp_path / "backup.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            tar.add(tmp_path / "payload.json", arcname="payload.json")
            if (tmp_path / "rclone.conf").exists():
                tar.add(tmp_path / "rclone.conf", arcname="rclone.conf")
        raw = tar_path.read_bytes()
        # Encrypt as base64 fernet of whole archive
        token = encrypt_value(raw.hex())  # hex to keep as str for encrypt_value
        out.write_text(token, encoding="utf-8")
        out.chmod(0o600)
    return out


def restore_backup(db: Session, file_path: Path) -> dict:
    settings = get_settings()
    enc = file_path.read_text(encoding="utf-8").strip()
    raw_hex = decrypt_value(enc)
    raw = bytes.fromhex(raw_hex)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        tar_path = tmp_path / "backup.tar.gz"
        tar_path.write_bytes(raw)
        with tarfile.open(tar_path, "r:gz") as tar:
            tar.extractall(tmp_path)
        payload = json.loads((tmp_path / "payload.json").read_text(encoding="utf-8"))
        rc_src = tmp_path / "rclone.conf"
        if rc_src.exists():
            dest = settings.resolved_rclone_config
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(rc_src, dest)
            dest.chmod(0o600)

    # Restore settings
    for k, v in (payload.get("settings") or {}).items():
        row = db.query(SystemSetting).filter(SystemSetting.key == k).first()
        if row:
            row.value = v
        else:
            db.add(SystemSetting(key=k, value=v))

    # Accounts by remote_name
    remote_map: dict[str, DriveAccount] = {}
    for item in payload.get("accounts") or []:
        acc = db.query(DriveAccount).filter(DriveAccount.remote_name == item["remote_name"]).first()
        if not acc:
            acc = DriveAccount(name=item["name"], remote_name=item["remote_name"])
            db.add(acc)
        acc.email = item.get("email")
        acc.provider = item.get("provider") or "drive"
        acc.client_id_enc = item.get("client_id_enc")
        acc.client_secret_enc = item.get("client_secret_enc")
        acc.token_enc = item.get("token_enc")
        acc.root_folder_id = item.get("root_folder_id")
        acc.team_drive = bool(item.get("team_drive"))
        acc.onedrive_drive_id = item.get("onedrive_drive_id")
        acc.onedrive_drive_type = item.get("onedrive_drive_type")
        acc.status = item.get("status") or "pending"
        acc.notes = item.get("notes")
        db.flush()
        remote_map[acc.remote_name] = acc

    for item in payload.get("mounts") or []:
        mount = db.query(MountPoint).filter(MountPoint.name == item["name"]).first()
        remote = item.get("account_remote")
        acc = remote_map.get(remote) if remote else None
        if not acc and remote:
            acc = db.query(DriveAccount).filter(DriveAccount.remote_name == remote).first()
        if not acc:
            continue
        if not mount:
            mount = MountPoint(name=item["name"], account_id=acc.id, local_path=item["local_path"])
            db.add(mount)
        mount.account_id = acc.id
        mount.remote_path = item.get("remote_path") or ""
        mount.local_path = item["local_path"]
        mount.mode = item.get("mode") or "media"
        mount.params_json = item.get("params_json") or "{}"
        mount.cache_dir = item.get("cache_dir")
        mount.enabled = bool(item.get("enabled", True))
        mount.auto_start = bool(item.get("auto_start", True))
        mount.status = "stopped"
        mount.pid = None

    db.commit()
    return {"message": "恢复完成", "accounts": len(payload.get("accounts") or []), "mounts": len(payload.get("mounts") or [])}


def list_backups() -> list[dict]:
    settings = get_settings()
    settings.backups_dir.mkdir(parents=True, exist_ok=True)
    items = []
    for p in sorted(settings.backups_dir.glob("gdm_backup_*.tar.gz.enc"), reverse=True):
        st = p.stat()
        items.append({"name": p.name, "path": str(p), "size": st.st_size, "mtime": st.st_mtime})
    return items
