"""Google / Microsoft OAuth for Drive & OneDrive + rclone token writing."""

from __future__ import annotations

import configparser
import json
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import decrypt_value, encrypt_value
from app.models.models import DriveAccount, OAuthState, SystemSetting
from app.services.rclone_service import get_rclone
from app.services.task_logger import log_task

logger = logging.getLogger(__name__)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo"

# Microsoft identity platform (OneDrive personal + work/school)
MS_GRAPH_ME = "https://graph.microsoft.com/v1.0/me"
MS_GRAPH_DRIVE = "https://graph.microsoft.com/v1.0/me/drive"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    return row.value if row else default


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if row:
        row.value = value
        row.updated_at = _utcnow()
    else:
        row = SystemSetting(key=key, value=value)
        db.add(row)
    db.commit()


def get_oauth_credentials(db: Session) -> tuple[str, str, str]:
    settings = get_settings()
    client_id = get_setting(db, "google_client_id") or settings.google_client_id
    client_secret_enc = get_setting(db, "google_client_secret_enc")
    if client_secret_enc:
        try:
            client_secret = decrypt_value(client_secret_enc)
        except Exception:
            client_secret = ""
    else:
        client_secret = settings.google_client_secret
    redirect_uri = get_setting(db, "google_redirect_uri") or settings.google_redirect_uri
    if not redirect_uri:
        redirect_uri = f"http://127.0.0.1:{settings.port}/api/oauth/callback"
    return client_id, client_secret, redirect_uri


def get_ms_oauth_credentials(db: Session) -> tuple[str, str, str, str]:
    """Return (client_id, client_secret, redirect_uri, tenant)."""
    settings = get_settings()
    client_id = get_setting(db, "microsoft_client_id") or settings.microsoft_client_id
    client_secret_enc = get_setting(db, "microsoft_client_secret_enc")
    if client_secret_enc:
        try:
            client_secret = decrypt_value(client_secret_enc)
        except Exception:
            client_secret = ""
    else:
        client_secret = settings.microsoft_client_secret
    redirect_uri = (
        get_setting(db, "microsoft_redirect_uri")
        or settings.microsoft_redirect_uri
        or get_setting(db, "google_redirect_uri")
        or settings.google_redirect_uri
    )
    if not redirect_uri:
        redirect_uri = f"http://127.0.0.1:{settings.port}/api/oauth/callback"
    tenant = (
        get_setting(db, "microsoft_tenant") or settings.microsoft_tenant or "common"
    ).strip() or "common"
    return client_id, client_secret, redirect_uri, tenant


def _rclone_token_from_oauth(token_data: dict, *, keep_refresh_from: DriveAccount | None = None) -> dict:
    """Build rclone-compatible OAuth token blob."""
    expiry = None
    if "expires_in" in token_data:
        exp_dt = _utcnow() + timedelta(seconds=int(token_data["expires_in"]))
        expiry = exp_dt.isoformat().replace("+00:00", "Z")
    rclone_token = {
        "access_token": token_data.get("access_token"),
        "token_type": token_data.get("token_type", "Bearer"),
        "refresh_token": token_data.get("refresh_token"),
        "expiry": expiry,
    }
    if not rclone_token.get("refresh_token") and keep_refresh_from and keep_refresh_from.token_enc:
        try:
            old_tok = json.loads(decrypt_value(keep_refresh_from.token_enc))
            if old_tok.get("refresh_token"):
                rclone_token["refresh_token"] = old_tok["refresh_token"]
        except Exception:
            pass
    return rclone_token


def _resolve_account_for_state(
    db: Session,
    st: OAuthState,
    *,
    email: str | None,
    provider: str,
) -> DriveAccount:
    account: DriveAccount | None = None
    if st.account_id:
        account = db.query(DriveAccount).filter(DriveAccount.id == st.account_id).first()

    if account is None:
        default_base = "onedrive" if provider == "onedrive" else "drive"
        base_name = st.name or (email.split("@")[0] if email else default_base)
        name = base_name
        i = 1
        while db.query(DriveAccount).filter(DriveAccount.name == name).first():
            i += 1
            name = f"{base_name}_{i}"
        remote = st.remote_name or _safe_remote(name)
        while db.query(DriveAccount).filter(DriveAccount.remote_name == remote).first():
            remote = f"{remote}_{i}"
            i += 1
        account = DriveAccount(
            name=name,
            remote_name=remote,
            email=email,
            provider=provider,
            status="pending",
        )
        db.add(account)
        db.flush()
    else:
        account.provider = provider
    return account


class OAuthService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.rclone = get_rclone()

    def start_auth(
        self,
        *,
        name: str | None = None,
        remote_name: str | None = None,
        account_id: int | None = None,
        provider: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
        redirect_after: str | None = None,
    ) -> dict:
        # Resolve provider from account or argument
        resolved = (provider or "drive").strip().lower()
        if account_id is not None:
            acc = self.db.query(DriveAccount).filter(DriveAccount.id == account_id).first()
            if acc:
                resolved = (getattr(acc, "provider", None) or resolved or "drive").strip().lower()
        if resolved in ("one_drive", "microsoft", "ms"):
            resolved = "onedrive"
        if resolved not in ("drive", "onedrive"):
            raise ValueError("provider 仅支持 drive 或 onedrive")

        if resolved == "onedrive":
            return self._start_onedrive_auth(
                name=name,
                remote_name=remote_name,
                account_id=account_id,
                client_id=client_id,
                client_secret=client_secret,
                redirect_after=redirect_after,
            )
        return self._start_google_auth(
            name=name,
            remote_name=remote_name,
            account_id=account_id,
            client_id=client_id,
            client_secret=client_secret,
            redirect_after=redirect_after,
        )

    def _start_google_auth(
        self,
        *,
        name: str | None = None,
        remote_name: str | None = None,
        account_id: int | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
        redirect_after: str | None = None,
    ) -> dict:
        cid, csecret, redirect_uri = get_oauth_credentials(self.db)
        if client_id:
            cid = client_id
        if client_secret:
            csecret = client_secret
            set_setting(self.db, "google_client_secret_enc", encrypt_value(client_secret))
            set_setting(self.db, "google_client_id", client_id or cid)

        if not cid or not csecret:
            raise ValueError(
                "请先在「系统设置」中配置 Google OAuth Client ID 与 Client Secret。"
                "可在 Google Cloud Console 创建 OAuth 客户端（Web 应用）。"
            )

        state = secrets.token_urlsafe(32)
        expires = _utcnow() + timedelta(minutes=15)
        st = OAuthState(
            state=state,
            account_id=account_id,
            name=name,
            remote_name=remote_name,
            redirect_after=redirect_after,
            provider="drive",
            expires_at=expires,
        )
        self.db.add(st)
        self.db.commit()

        settings = get_settings()
        params = {
            "client_id": cid,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": settings.oauth_scopes,
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
            "include_granted_scopes": "true",
        }
        url = f"{GOOGLE_AUTH_URL}?{urlencode(params)}"
        return {"authorize_url": url, "state": state, "account_id": account_id}

    def _start_onedrive_auth(
        self,
        *,
        name: str | None = None,
        remote_name: str | None = None,
        account_id: int | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
        redirect_after: str | None = None,
    ) -> dict:
        cid, csecret, redirect_uri, tenant = get_ms_oauth_credentials(self.db)
        if client_id:
            cid = client_id
        if client_secret:
            csecret = client_secret
            set_setting(self.db, "microsoft_client_secret_enc", encrypt_value(client_secret))
            set_setting(self.db, "microsoft_client_id", client_id or cid)

        if not cid or not csecret:
            raise ValueError(
                "请先在「系统设置」中配置 Microsoft（Azure）应用 Client ID 与 Client Secret，"
                "并将 Redirect URI 登记为面板回调地址。完成后即可像 CloudDrive2 一样网页登录 OneDrive。"
            )

        state = secrets.token_urlsafe(32)
        expires = _utcnow() + timedelta(minutes=15)
        st = OAuthState(
            state=state,
            account_id=account_id,
            name=name,
            remote_name=remote_name,
            redirect_after=redirect_after,
            provider="onedrive",
            expires_at=expires,
        )
        self.db.add(st)
        self.db.commit()

        settings = get_settings()
        params = {
            "client_id": cid,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "response_mode": "query",
            "scope": settings.microsoft_oauth_scopes,
            "state": state,
            "prompt": "select_account",
        }
        url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?{urlencode(params)}"
        return {"authorize_url": url, "state": state, "account_id": account_id}

    def handle_callback(self, code: str, state: str) -> DriveAccount:
        st = self.db.query(OAuthState).filter(OAuthState.state == state).first()
        if not st:
            raise ValueError("无效的 OAuth state")
        if st.expires_at.replace(tzinfo=timezone.utc) < _utcnow():
            self.db.delete(st)
            self.db.commit()
            raise ValueError("OAuth state 已过期，请重新授权")

        provider = (getattr(st, "provider", None) or "drive").strip().lower()
        if provider == "onedrive":
            return self._handle_onedrive_callback(code, st)
        return self._handle_google_callback(code, st)

    def _handle_google_callback(self, code: str, st: OAuthState) -> DriveAccount:
        cid, csecret, redirect_uri = get_oauth_credentials(self.db)
        if not cid or not csecret:
            raise ValueError("Google OAuth 凭据未配置")

        with httpx.Client(timeout=30) as client:
            token_resp = client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": cid,
                    "client_secret": csecret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            if token_resp.status_code != 200:
                raise ValueError(f"获取 Token 失败: {token_resp.text[:300]}")
            token_data = token_resp.json()

            email = None
            headers = {"Authorization": f"Bearer {token_data.get('access_token')}"}
            ui = client.get(GOOGLE_USERINFO, headers=headers)
            if ui.status_code == 200:
                email = ui.json().get("email")

        old = (
            self.db.query(DriveAccount).filter(DriveAccount.id == st.account_id).first()
            if st.account_id
            else None
        )
        rclone_token = _rclone_token_from_oauth(token_data, keep_refresh_from=old)
        token_json = json.dumps(rclone_token)

        account = _resolve_account_for_state(self.db, st, email=email, provider="drive")
        account.email = email or account.email
        account.client_id_enc = encrypt_value(cid)
        account.client_secret_enc = encrypt_value(csecret)
        account.token_enc = encrypt_value(token_json)
        account.status = "connected"
        account.last_error = None
        account.last_check_at = _utcnow()
        self.db.add(account)
        self.db.commit()
        self.db.refresh(account)

        try:
            self.rclone.upsert_drive_remote(
                account.remote_name,
                client_id=cid,
                client_secret=csecret,
                token_json=token_json,
                root_folder_id=account.root_folder_id,
                team_drive=account.team_drive,
            )
            try:
                about = self.rclone.about(account.remote_name)
                account.total_bytes = about.get("total")
                account.used_bytes = about.get("used")
                account.free_bytes = about.get("free")
                account.status = "connected"
            except Exception as exc:
                account.last_error = str(exc)[:500]
                logger.warning("about after oauth failed: %s", exc)
            self.db.add(account)
            self.db.commit()
        except Exception as exc:
            account.status = "error"
            account.last_error = str(exc)[:500]
            self.db.add(account)
            self.db.commit()
            log_task(
                self.db,
                task_type="oauth",
                account_id=account.id,
                status="error",
                message=f"OAuth 成功但写入 rclone 配置失败: {account.name}",
                detail=str(exc),
            )
            raise

        self.db.delete(st)
        self.db.commit()
        log_task(
            self.db,
            task_type="oauth",
            account_id=account.id,
            status="success",
            message=f"Google Drive 授权成功: {account.name} ({account.email})",
        )
        return account

    def _handle_onedrive_callback(self, code: str, st: OAuthState) -> DriveAccount:
        cid, csecret, redirect_uri, tenant = get_ms_oauth_credentials(self.db)
        if not cid or not csecret:
            raise ValueError("Microsoft OAuth 凭据未配置")

        token_url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
        with httpx.Client(timeout=45) as client:
            token_resp = client.post(
                token_url,
                data={
                    "client_id": cid,
                    "client_secret": csecret,
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            if token_resp.status_code != 200:
                raise ValueError(f"获取 Microsoft Token 失败: {token_resp.text[:400]}")
            token_data = token_resp.json()

            email = None
            display = None
            drive_id = None
            drive_type = "personal"
            headers = {"Authorization": f"Bearer {token_data.get('access_token')}"}
            me = client.get(MS_GRAPH_ME, headers=headers)
            if me.status_code == 200:
                mej = me.json()
                email = mej.get("mail") or mej.get("userPrincipalName")
                display = mej.get("displayName")
            drv = client.get(MS_GRAPH_DRIVE, headers=headers)
            if drv.status_code == 200:
                dj = drv.json()
                drive_id = dj.get("id")
                dtype = (dj.get("driveType") or "personal").lower()
                # Map Graph driveType → rclone drive_type
                if dtype in ("personal", "business", "documentlibrary"):
                    drive_type = dtype
                elif dtype == "documentLibrary":
                    drive_type = "documentLibrary"
                else:
                    drive_type = dtype or "personal"

        old = (
            self.db.query(DriveAccount).filter(DriveAccount.id == st.account_id).first()
            if st.account_id
            else None
        )
        rclone_token = _rclone_token_from_oauth(token_data, keep_refresh_from=old)
        if not rclone_token.get("refresh_token"):
            raise ValueError(
                "未拿到 refresh_token。请在 Azure 应用权限中包含 offline_access，"
                "并确保授权时同意该权限后重试。"
            )
        token_json = json.dumps(rclone_token)

        account = _resolve_account_for_state(
            self.db,
            st,
            email=email,
            provider="onedrive",
        )
        if not st.name and display and not account.email:
            # keep existing name if already set
            pass
        account.email = email or account.email
        account.client_id_enc = encrypt_value(cid)
        account.client_secret_enc = encrypt_value(csecret)
        account.token_enc = encrypt_value(token_json)
        if drive_id:
            account.onedrive_drive_id = drive_id
        account.onedrive_drive_type = drive_type or account.onedrive_drive_type or "personal"
        account.status = "connected"
        account.last_error = None
        account.last_check_at = _utcnow()
        self.db.add(account)
        self.db.commit()
        self.db.refresh(account)

        try:
            self.rclone.upsert_onedrive_remote(
                account.remote_name,
                token_json=token_json,
                client_id=cid,
                client_secret=csecret,
                drive_id=account.onedrive_drive_id,
                drive_type=account.onedrive_drive_type,
            )
            if not account.onedrive_drive_id:
                detected = self.rclone.detect_onedrive_drive(account.remote_name)
                if detected:
                    account.onedrive_drive_id = detected.get("drive_id")
                    account.onedrive_drive_type = (
                        detected.get("drive_type") or account.onedrive_drive_type or "personal"
                    )
                    self.rclone.upsert_onedrive_remote(
                        account.remote_name,
                        token_json=token_json,
                        client_id=cid,
                        client_secret=csecret,
                        drive_id=account.onedrive_drive_id,
                        drive_type=account.onedrive_drive_type,
                    )
            try:
                about = self.rclone.about(account.remote_name)
                account.total_bytes = about.get("total")
                account.used_bytes = about.get("used")
                account.free_bytes = about.get("free")
                account.status = "connected"
            except Exception as exc:
                account.last_error = str(exc)[:500]
                logger.warning("onedrive about after oauth failed: %s", exc)
            self.db.add(account)
            self.db.commit()
        except Exception as exc:
            account.status = "error"
            account.last_error = str(exc)[:500]
            self.db.add(account)
            self.db.commit()
            log_task(
                self.db,
                task_type="oauth",
                account_id=account.id,
                status="error",
                message=f"OneDrive OAuth 成功但写入 rclone 配置失败: {account.name}",
                detail=str(exc),
            )
            raise

        self.db.delete(st)
        self.db.commit()
        log_task(
            self.db,
            task_type="oauth",
            account_id=account.id,
            status="success",
            message=f"OneDrive 授权成功: {account.name} ({account.email or ''})",
        )
        return account

    def test_account(self, account: DriveAccount) -> dict:
        # Ensure rclone config is synced
        self.sync_account_to_rclone(account)
        provider = (getattr(account, "provider", None) or "drive").strip().lower()
        data: dict = {}
        try:
            about = self.rclone.test_connection(account.remote_name)
            data = about.get("about") or {}
            account.total_bytes = data.get("total")
            account.used_bytes = data.get("used")
            account.free_bytes = data.get("free")
        except Exception as exc:
            if provider not in ("123pan", "webdav"):
                raise
            # 123/WebDAV 常不支持 about 配额，用列目录验证
            self.rclone.lsd(account.remote_name, "")
            data = {"ok": True, "note": f"about 不可用（{exc}），lsd 成功"}
        account.status = "connected"
        account.last_check_at = _utcnow()
        account.last_error = None
        self.db.add(account)
        self.db.commit()
        return data

    def sync_account_to_rclone(self, account: DriveAccount) -> None:
        provider = (getattr(account, "provider", None) or "drive").strip().lower()
        if provider in ("123pan", "webdav"):
            if not account.token_enc:
                raise ValueError("账号尚未配置 WebDAV 密码")
            url = (getattr(account, "webdav_url", None) or "").strip()
            if not url:
                raise ValueError("账号缺少 WebDAV URL")
            user = (account.email or "").strip()
            if not user:
                raise ValueError("账号缺少 WebDAV 用户名")
            password, obscured = _decode_webdav_secret(decrypt_value(account.token_enc))
            vendor = (getattr(account, "webdav_vendor", None) or "other").strip() or "other"
            self.rclone.upsert_webdav_remote(
                account.remote_name,
                url=url,
                user=user,
                password=password,
                vendor=vendor,
                password_obscured=obscured,
            )
            return

        if not account.token_enc:
            raise ValueError("账号尚未完成授权（无 Token）")
        token_json = decrypt_value(account.token_enc)
        cid = decrypt_value(account.client_id_enc) if account.client_id_enc else ""
        csecret = decrypt_value(account.client_secret_enc) if account.client_secret_enc else ""
        if provider == "drive" and (not cid or not csecret):
            cid2, csecret2, _ = get_oauth_credentials(self.db)
            cid = cid or cid2
            csecret = csecret or csecret2
        elif provider == "onedrive" and (not cid or not csecret):
            cid2, csecret2, _, _ = get_ms_oauth_credentials(self.db)
            cid = cid or cid2
            csecret = csecret or csecret2
        self.rclone.upsert_remote(
            account.remote_name,
            provider=provider,
            token_json=token_json,
            client_id=cid,
            client_secret=csecret,
            root_folder_id=account.root_folder_id,
            team_drive=account.team_drive,
            onedrive_drive_id=getattr(account, "onedrive_drive_id", None),
            onedrive_drive_type=getattr(account, "onedrive_drive_type", None),
        )

    def connect_webdav(
        self,
        *,
        name: str,
        url: str,
        user: str,
        password: str,
        remote_name: str | None = None,
        provider: str = "123pan",
        vendor: str = "other",
        notes: str | None = None,
        test_connection: bool = True,
        account_id: int | None = None,
    ) -> DriveAccount:
        """Create or update a 123pan/WebDAV account and write rclone conf."""
        resolved = _normalize_provider(provider)
        if resolved not in ("123pan", "webdav"):
            raise ValueError("connect_webdav 仅支持 123pan / webdav")
        url = (url or "").strip()
        user = (user or "").strip()
        password = password or ""
        if not url.startswith(("http://", "https://")):
            raise ValueError("WebDAV URL 必须以 http:// 或 https:// 开头")
        if not user:
            raise ValueError("请填写 WebDAV 用户名")
        if not password:
            raise ValueError("请填写 WebDAV 密码")
        vendor = (vendor or "other").strip() or "other"

        account: DriveAccount | None = None
        if account_id is not None:
            account = self.db.query(DriveAccount).filter(DriveAccount.id == account_id).first()
            if not account:
                raise ValueError("账号不存在")

        if account is None:
            base_name = (name or ("123云盘" if resolved == "123pan" else "WebDAV")).strip()
            display = base_name
            i = 1
            while self.db.query(DriveAccount).filter(DriveAccount.name == display).first():
                i += 1
                display = f"{base_name}_{i}"
            remote = _safe_remote(remote_name or display)
            j = 1
            base_remote = remote
            while self.db.query(DriveAccount).filter(DriveAccount.remote_name == remote).first():
                j += 1
                remote = f"{base_remote}_{j}"
            account = DriveAccount(
                name=display,
                remote_name=remote,
                provider=resolved,
                status="pending",
                notes=notes,
            )
            self.db.add(account)
            self.db.flush()
        else:
            if name and name.strip() and name.strip() != account.name:
                if self.db.query(DriveAccount).filter(DriveAccount.name == name.strip()).first():
                    raise ValueError("账号名称已存在")
                account.name = name.strip()
            account.provider = resolved
            if notes is not None:
                account.notes = notes

        account.email = user
        account.webdav_url = url
        account.webdav_vendor = vendor
        account.token_enc = encrypt_value(_encode_webdav_secret(password, obscured=False))
        account.team_drive = False
        account.root_folder_id = None
        account.status = "connected"
        account.last_error = None
        account.last_check_at = _utcnow()
        self.db.add(account)
        self.db.commit()
        self.db.refresh(account)

        try:
            self.rclone.upsert_webdav_remote(
                account.remote_name,
                url=url,
                user=user,
                password=password,
                vendor=vendor,
                password_obscured=False,
            )
            if test_connection:
                try:
                    about = self.rclone.about(account.remote_name)
                    account.total_bytes = about.get("total")
                    account.used_bytes = about.get("used")
                    account.free_bytes = about.get("free")
                    account.status = "connected"
                    account.last_error = None
                except Exception as exc:
                    # WebDAV about may not report quota; try lsd as health check
                    try:
                        self.rclone.lsd(account.remote_name, "")
                        account.status = "connected"
                        account.last_error = None
                        logger.info("webdav about unavailable, lsd ok: %s", account.remote_name)
                    except Exception as exc2:
                        account.status = "error"
                        account.last_error = str(exc2)[:500]
                        logger.warning("webdav test failed: %s / %s", exc, exc2)
            self.db.add(account)
            self.db.commit()
            self.db.refresh(account)
        except Exception as exc:
            account.status = "error"
            account.last_error = str(exc)[:500]
            self.db.add(account)
            self.db.commit()
            log_task(
                self.db,
                task_type="oauth",
                account_id=account.id,
                status="error",
                message=f"WebDAV 配置写入失败: {account.name}",
                detail=str(exc),
            )
            raise

        label = "123云盘" if resolved == "123pan" else "WebDAV"
        log_task(
            self.db,
            task_type="oauth",
            account_id=account.id,
            status="success" if account.status == "connected" else "warning",
            message=f"{label} 已连接: {account.name} ({user})",
            detail=None if account.status == "connected" else account.last_error,
        )
        return account

    def apply_token(
        self,
        *,
        token_raw: str,
        account_id: int | None = None,
        name: str | None = None,
        remote_name: str | None = None,
        provider: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
        root_folder_id: str | None = None,
        team_drive: bool | None = None,
        onedrive_drive_id: str | None = None,
        onedrive_drive_type: str | None = None,
        notes: str | None = None,
        test_connection: bool = True,
    ) -> DriveAccount:
        """Apply pasted rclone token JSON to create or update an account (drive / onedrive)."""
        token_dict = extract_token_json(token_raw)
        token_json = json.dumps(token_dict, ensure_ascii=False)

        account: DriveAccount | None = None
        if account_id is not None:
            account = self.db.query(DriveAccount).filter(DriveAccount.id == account_id).first()
            if not account:
                raise ValueError("账号不存在")

        resolved_provider = _normalize_provider(
            provider
            or (getattr(account, "provider", None) if account else None)
            or "drive"
        )

        g_cid, g_csecret, _ = get_oauth_credentials(self.db)
        ms_cid, ms_csecret, _, _ = get_ms_oauth_credentials(self.db)
        cid = (client_id or "").strip()
        csecret = (client_secret or "").strip()
        if resolved_provider == "drive":
            cid = cid or g_cid
            csecret = csecret or g_csecret
        elif resolved_provider == "onedrive":
            cid = cid or ms_cid
            csecret = csecret or ms_csecret

        if account is None:
            default_base = "onedrive" if resolved_provider == "onedrive" else "drive"
            base_name = (name or default_base).strip() or default_base
            display = base_name
            i = 1
            while self.db.query(DriveAccount).filter(DriveAccount.name == display).first():
                i += 1
                display = f"{base_name}_{i}"
            remote = (remote_name or _safe_remote(display)).strip()
            remote = _safe_remote(remote)
            i = 1
            base_remote = remote
            while self.db.query(DriveAccount).filter(DriveAccount.remote_name == remote).first():
                i += 1
                remote = f"{base_remote}_{i}"
            account = DriveAccount(
                name=display,
                remote_name=remote,
                provider=resolved_provider,
                status="pending",
                root_folder_id=root_folder_id,
                team_drive=bool(team_drive) if resolved_provider == "drive" else False,
                onedrive_drive_id=onedrive_drive_id if resolved_provider == "onedrive" else None,
                onedrive_drive_type=onedrive_drive_type if resolved_provider == "onedrive" else None,
                notes=notes,
            )
            self.db.add(account)
            self.db.flush()
        else:
            if name and name.strip() and name.strip() != account.name:
                if self.db.query(DriveAccount).filter(DriveAccount.name == name.strip()).first():
                    raise ValueError("账号名称已存在")
                account.name = name.strip()
            account.provider = resolved_provider
            if root_folder_id is not None:
                account.root_folder_id = root_folder_id or None
            if team_drive is not None:
                account.team_drive = team_drive
            if onedrive_drive_id is not None:
                account.onedrive_drive_id = onedrive_drive_id or None
            if onedrive_drive_type is not None:
                account.onedrive_drive_type = onedrive_drive_type or None
            if notes is not None:
                account.notes = notes

        # Preserve existing client credentials if not provided
        if not cid and account.client_id_enc:
            try:
                cid = decrypt_value(account.client_id_enc)
            except Exception:
                cid = ""
        if not csecret and account.client_secret_enc:
            try:
                csecret = decrypt_value(account.client_secret_enc)
            except Exception:
                csecret = ""

        # Merge refresh_token if new paste lacks it
        if not token_dict.get("refresh_token") and account.token_enc:
            try:
                old_tok = json.loads(decrypt_value(account.token_enc))
                if old_tok.get("refresh_token"):
                    token_dict["refresh_token"] = old_tok["refresh_token"]
                    token_json = json.dumps(token_dict, ensure_ascii=False)
            except Exception:
                pass

        if resolved_provider == "drive":
            email = _fetch_email(token_dict.get("access_token") or "")
            if email:
                account.email = email
        else:
            email = _fetch_ms_email(token_dict.get("access_token") or "")
            if email:
                account.email = email

        if cid:
            account.client_id_enc = encrypt_value(cid)
        if csecret:
            account.client_secret_enc = encrypt_value(csecret)
        account.token_enc = encrypt_value(token_json)
        account.status = "connected"
        account.last_error = None
        account.last_check_at = _utcnow()
        self.db.add(account)
        self.db.commit()
        self.db.refresh(account)

        try:
            self.rclone.upsert_remote(
                account.remote_name,
                provider=resolved_provider,
                token_json=token_json,
                client_id=cid or "",
                client_secret=csecret or "",
                root_folder_id=account.root_folder_id,
                team_drive=account.team_drive,
                onedrive_drive_id=account.onedrive_drive_id,
                onedrive_drive_type=account.onedrive_drive_type,
            )
            # Auto-detect OneDrive drive_id if missing
            if resolved_provider == "onedrive" and not account.onedrive_drive_id:
                detected = self.rclone.detect_onedrive_drive(account.remote_name)
                if detected:
                    account.onedrive_drive_id = detected.get("drive_id")
                    account.onedrive_drive_type = detected.get("drive_type") or account.onedrive_drive_type or "personal"
                    self.rclone.upsert_remote(
                        account.remote_name,
                        provider="onedrive",
                        token_json=token_json,
                        client_id=cid or "",
                        client_secret=csecret or "",
                        onedrive_drive_id=account.onedrive_drive_id,
                        onedrive_drive_type=account.onedrive_drive_type,
                    )
                    self.db.add(account)
                    self.db.commit()
            if test_connection:
                try:
                    about = self.rclone.about(account.remote_name)
                    account.total_bytes = about.get("total")
                    account.used_bytes = about.get("used")
                    account.free_bytes = about.get("free")
                    account.status = "connected"
                    account.last_error = None
                except Exception as exc:
                    account.status = "error"
                    account.last_error = str(exc)[:500]
                    logger.warning("about after paste token failed: %s", exc)
            self.db.add(account)
            self.db.commit()
            self.db.refresh(account)
        except Exception as exc:
            account.status = "error"
            account.last_error = str(exc)[:500]
            self.db.add(account)
            self.db.commit()
            log_task(
                self.db,
                task_type="oauth",
                account_id=account.id,
                status="error",
                message=f"Token 已保存但写入 rclone 失败: {account.name}",
                detail=str(exc),
            )
            raise

        label = "OneDrive" if resolved_provider == "onedrive" else "Google Drive"
        log_task(
            self.db,
            task_type="oauth",
            account_id=account.id,
            status="success" if account.status == "connected" else "warning",
            message=f"粘贴 Token 授权完成 ({label}): {account.name}"
            + (f" ({account.email})" if account.email else ""),
            detail=None if account.status == "connected" else account.last_error,
        )
        return account

    def preview_rclone_import(self, config_text: str) -> list[dict[str, Any]]:
        remotes = parse_rclone_config_text(config_text)
        if not remotes:
            raise ValueError(
                "未找到 type=drive / onedrive / webdav 的 remote，请粘贴完整 rclone 配置"
            )
        return remotes

    def import_rclone_remotes(
        self,
        *,
        config_text: str,
        selected_remotes: list[str] | None = None,
        name_prefix: str | None = None,
        test_connection: bool = True,
        overwrite: bool = False,
    ) -> list[DriveAccount]:
        """Import drive/onedrive/webdav remotes from rclone.conf text."""
        text = (config_text or "").strip()
        if not text:
            raise ValueError("rclone 配置内容为空")

        cp = configparser.ConfigParser(interpolation=None)
        try:
            cp.read_string(text)
        except configparser.Error as exc:
            raise ValueError(f"rclone 配置解析失败: {exc}") from exc

        previews = parse_rclone_config_text(text)
        available = {p["remote_name"]: p for p in previews}
        if not available:
            raise ValueError("未找到 type=drive / onedrive / webdav 的 remote")

        if selected_remotes:
            targets = []
            for name in selected_remotes:
                if name not in available:
                    raise ValueError(f"配置中不存在 remote: {name}")
                targets.append(name)
        else:
            targets = list(available.keys())

        imported: list[DriveAccount] = []
        errors: list[str] = []

        for section in targets:
            try:
                acc = self._import_one_rclone_section(
                    cp,
                    section,
                    name_prefix=name_prefix,
                    test_connection=test_connection,
                    overwrite=overwrite,
                )
                imported.append(acc)
            except Exception as exc:
                logger.exception("import remote %s failed", section)
                errors.append(f"{section}: {exc}")

        if not imported:
            raise ValueError("导入失败: " + "; ".join(errors[:5]))

        log_task(
            self.db,
            task_type="oauth",
            status="success" if not errors else "warning",
            message=f"从 rclone 配置导入 {len(imported)} 个账号"
            + (f"，{len(errors)} 个失败" if errors else ""),
            detail="; ".join(errors) if errors else None,
        )
        return imported

    def _import_one_rclone_section(
        self,
        cp: configparser.ConfigParser,
        section: str,
        *,
        name_prefix: str | None,
        test_connection: bool,
        overwrite: bool,
    ) -> DriveAccount:
        if not cp.has_section(section):
            raise ValueError(f"配置中不存在 remote: {section}")
        rtype = (cp.get(section, "type", fallback="") or "").strip().lower()
        if rtype not in ("drive", "onedrive", "webdav"):
            raise ValueError(f"{section} 不是 drive/onedrive/webdav 类型（当前: {rtype or '空'}）")

        # WebDAV / 123pan import path
        if rtype == "webdav":
            url = (cp.get(section, "url", fallback="") or "").strip()
            user = (cp.get(section, "user", fallback="") or "").strip()
            pass_raw = (cp.get(section, "pass", fallback="") or "").strip()
            vendor = (cp.get(section, "vendor", fallback="") or "other").strip() or "other"
            if not url or not user or not pass_raw:
                raise ValueError(f"{section} WebDAV 需包含 url / user / pass")
            provider = "123pan" if "123" in url.lower() else "webdav"
            # pass in conf is usually already rclone-obscured; store as-is and mark obscured
            remote = _safe_remote(section)
            existing = (
                self.db.query(DriveAccount).filter(DriveAccount.remote_name == remote).first()
            )
            if existing and not overwrite:
                raise ValueError(f"remote「{remote}」已存在，勾选覆盖后再导入")
            display_base = f"{name_prefix}{section}" if name_prefix else section
            if existing:
                account = existing
                account.provider = provider
            else:
                display = display_base
                i = 1
                while self.db.query(DriveAccount).filter(DriveAccount.name == display).first():
                    i += 1
                    display = f"{display_base}_{i}"
                account = DriveAccount(
                    name=display,
                    remote_name=remote,
                    provider=provider,
                    status="pending",
                )
                self.db.add(account)
                self.db.flush()
            account.email = user
            account.webdav_url = url
            account.webdav_vendor = vendor
            # conf 中的 pass 通常已是 rclone obscure 后的值
            account.token_enc = encrypt_value(_encode_webdav_secret(pass_raw, obscured=True))
            account.status = "connected"
            account.last_error = None
            account.last_check_at = _utcnow()
            self.db.add(account)
            self.db.commit()
            self.db.refresh(account)
            self.rclone.upsert_webdav_remote(
                account.remote_name,
                url=url,
                user=user,
                password=pass_raw,
                vendor=vendor,
                password_obscured=True,
            )
            if test_connection:
                try:
                    self.test_account(account)
                except Exception as exc:
                    account.status = "error"
                    account.last_error = str(exc)[:500]
                    self.db.add(account)
                    self.db.commit()
            self.db.refresh(account)
            return account

        provider = _normalize_provider(rtype)

        token_raw = (cp.get(section, "token", fallback="") or "").strip()
        if not token_raw:
            raise ValueError(f"{section} 缺少 token")
        token_dict = extract_token_json(token_raw)
        token_json = json.dumps(token_dict, ensure_ascii=False)

        cid = (cp.get(section, "client_id", fallback="") or "").strip()
        csecret = (cp.get(section, "client_secret", fallback="") or "").strip()
        if provider == "drive" and (not cid or not csecret):
            g_cid, g_csecret, _ = get_oauth_credentials(self.db)
            cid = cid or g_cid
            csecret = csecret or g_csecret

        root = (cp.get(section, "root_folder_id", fallback="") or "").strip() or None
        team_raw = (cp.get(section, "team_drive", fallback="") or "").strip()
        team_drive = bool(team_raw) if provider == "drive" else False
        if team_raw and not root and provider == "drive":
            root = team_raw

        od_drive_id = (cp.get(section, "drive_id", fallback="") or "").strip() or None
        od_drive_type = (cp.get(section, "drive_type", fallback="") or "").strip() or None

        remote = _safe_remote(section)
        existing = (
            self.db.query(DriveAccount).filter(DriveAccount.remote_name == remote).first()
        )
        if existing and not overwrite:
            raise ValueError(f"remote「{remote}」已存在，勾选覆盖后再导入")

        display_base = f"{name_prefix}{section}" if name_prefix else section
        if existing:
            account = existing
        else:
            display = display_base
            i = 1
            while self.db.query(DriveAccount).filter(DriveAccount.name == display).first():
                i += 1
                display = f"{display_base}_{i}"
            final_remote = remote
            j = 1
            while (
                self.db.query(DriveAccount)
                .filter(DriveAccount.remote_name == final_remote)
                .first()
            ):
                j += 1
                final_remote = f"{remote}_{j}"
            account = DriveAccount(
                name=display,
                remote_name=final_remote,
                status="pending",
            )
            self.db.add(account)
            self.db.flush()

        account.provider = provider
        account.root_folder_id = root if provider == "drive" else None
        account.team_drive = team_drive
        account.onedrive_drive_id = od_drive_id if provider == "onedrive" else None
        account.onedrive_drive_type = od_drive_type if provider == "onedrive" else None
        if cid:
            account.client_id_enc = encrypt_value(cid)
        if csecret:
            account.client_secret_enc = encrypt_value(csecret)
        account.token_enc = encrypt_value(token_json)

        if provider == "drive":
            email = _fetch_email(token_dict.get("access_token") or "")
        else:
            email = _fetch_ms_email(token_dict.get("access_token") or "")
        if email:
            account.email = email

        account.status = "connected"
        account.last_error = None
        account.last_check_at = _utcnow()
        self.db.add(account)
        self.db.commit()
        self.db.refresh(account)

        self.rclone.upsert_remote(
            account.remote_name,
            provider=provider,
            token_json=token_json,
            client_id=cid or "",
            client_secret=csecret or "",
            root_folder_id=account.root_folder_id,
            team_drive=account.team_drive,
            onedrive_drive_id=account.onedrive_drive_id,
            onedrive_drive_type=account.onedrive_drive_type,
        )

        if provider == "onedrive" and not account.onedrive_drive_id:
            detected = self.rclone.detect_onedrive_drive(account.remote_name)
            if detected:
                account.onedrive_drive_id = detected.get("drive_id")
                account.onedrive_drive_type = (
                    detected.get("drive_type") or account.onedrive_drive_type or "personal"
                )
                self.rclone.upsert_remote(
                    account.remote_name,
                    provider="onedrive",
                    token_json=token_json,
                    client_id=cid or "",
                    client_secret=csecret or "",
                    onedrive_drive_id=account.onedrive_drive_id,
                    onedrive_drive_type=account.onedrive_drive_type,
                )
                self.db.add(account)
                self.db.commit()

        if test_connection:
            try:
                about = self.rclone.about(account.remote_name)
                account.total_bytes = about.get("total")
                account.used_bytes = about.get("used")
                account.free_bytes = about.get("free")
                account.status = "connected"
                account.last_error = None
            except Exception as exc:
                account.status = "error"
                account.last_error = str(exc)[:500]
                logger.warning("about after import failed: %s", exc)
            self.db.add(account)
            self.db.commit()
            self.db.refresh(account)

        return account


def _safe_remote(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_")
    return (s or "drive")[:48]


def _encode_webdav_secret(password: str, *, obscured: bool) -> str:
    return json.dumps({"p": password, "o": bool(obscured)}, ensure_ascii=False)


def _decode_webdav_secret(raw: str) -> tuple[str, bool]:
    """Return (password, is_obscured). Plain string treated as not obscured."""
    text = (raw or "").strip()
    if not text:
        return "", False
    if text.startswith("{"):
        try:
            data = json.loads(text)
            if isinstance(data, dict) and "p" in data:
                return str(data.get("p") or ""), bool(data.get("o"))
        except json.JSONDecodeError:
            pass
    return text, False


def extract_token_json(raw: str) -> dict[str, Any]:
    """Parse token from rclone authorize output or plain JSON."""
    text = (raw or "").strip()
    if not text:
        raise ValueError("Token 不能为空")

    # rclone authorize often wraps JSON between markers
    m = re.search(
        r"(?:Paste the following into your remote machine.*?-->)?\s*(\{.*\})\s*(?:<---End paste)?",
        text,
        re.S | re.I,
    )
    candidate = m.group(1) if m else text

    # Try direct JSON first
    for attempt in (candidate, text):
        try:
            data = json.loads(attempt)
            if isinstance(data, dict):
                return _normalize_token_dict(data)
        except json.JSONDecodeError:
            pass

    # Find first JSON object containing access_token or refresh_token
    for match in re.finditer(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", text, re.S):
        try:
            data = json.loads(match.group(0))
            if isinstance(data, dict) and (
                data.get("access_token") or data.get("refresh_token")
            ):
                return _normalize_token_dict(data)
        except json.JSONDecodeError:
            continue

    # Greedy brace match for nested-ish token blobs
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(text[start : end + 1])
            if isinstance(data, dict):
                return _normalize_token_dict(data)
        except json.JSONDecodeError:
            pass

    raise ValueError(
        "无法解析 Token：请粘贴 rclone authorize 输出的整段 JSON，"
        "需包含 access_token 或 refresh_token。"
    )


def _normalize_token_dict(data: dict[str, Any]) -> dict[str, Any]:
    access = data.get("access_token")
    refresh = data.get("refresh_token")
    if not access and not refresh:
        raise ValueError("Token JSON 缺少 access_token 与 refresh_token")
    if not refresh:
        logger.warning("Token 无 refresh_token，长期使用可能失效")

    expiry = data.get("expiry") or data.get("expires") or data.get("expire")
    if not expiry and data.get("expires_in"):
        try:
            exp_dt = _utcnow() + timedelta(seconds=int(data["expires_in"]))
            expiry = exp_dt.isoformat().replace("+00:00", "Z")
        except (TypeError, ValueError):
            expiry = None

    return {
        "access_token": access or "",
        "token_type": data.get("token_type") or "Bearer",
        "refresh_token": refresh or "",
        "expiry": expiry,
    }


def _normalize_provider(provider: str | None) -> str:
    p = (provider or "drive").strip().lower()
    if p in ("onedrive", "one_drive", "microsoft", "ms"):
        return "onedrive"
    if p in ("drive", "gdrive", "google", "google_drive", "googledrive"):
        return "drive"
    if p in ("123pan", "123", "123云盘", "pan123"):
        return "123pan"
    if p in ("webdav", "dav"):
        return "webdav"
    raise ValueError(f"不支持的云盘类型: {provider}（支持 drive / onedrive / 123pan / webdav）")


def parse_rclone_config_text(config_text: str) -> list[dict[str, Any]]:
    """Parse rclone.conf text and return drive/onedrive/webdav remote previews."""
    text = (config_text or "").strip()
    if not text:
        raise ValueError("rclone 配置内容为空")

    # rclone token JSON contains % and {} — disable interpolation
    cp = configparser.ConfigParser(interpolation=None)
    try:
        cp.read_string(text)
    except configparser.Error as exc:
        raise ValueError(f"rclone 配置解析失败: {exc}") from exc

    remotes: list[dict[str, Any]] = []
    for section in cp.sections():
        rtype = (cp.get(section, "type", fallback="") or "").strip().lower()
        if rtype not in ("drive", "onedrive", "webdav"):
            continue
        token_raw = (cp.get(section, "token", fallback="") or "").strip()
        pass_raw = (cp.get(section, "pass", fallback="") or "").strip()
        user_raw = (cp.get(section, "user", fallback="") or "").strip()
        url_raw = (cp.get(section, "url", fallback="") or "").strip()
        has_token = False
        if rtype == "webdav":
            has_token = bool(pass_raw and user_raw and url_raw)
            # Map generic webdav to 123pan when URL looks like 123
            display_type = "123pan" if "123" in url_raw.lower() else "webdav"
        else:
            display_type = rtype
            if token_raw:
                try:
                    extract_token_json(token_raw)
                    has_token = True
                except ValueError:
                    has_token = bool(token_raw)
        root = (cp.get(section, "root_folder_id", fallback="") or "").strip() or None
        team = (cp.get(section, "team_drive", fallback="") or "").strip() or None
        drive_id = (cp.get(section, "drive_id", fallback="") or "").strip() or None
        drive_type = (cp.get(section, "drive_type", fallback="") or "").strip() or None
        vendor = (cp.get(section, "vendor", fallback="") or "").strip() or None
        remotes.append(
            {
                "remote_name": section,
                "type": display_type if rtype == "webdav" else rtype,
                "has_token": has_token,
                "has_client_id": bool((cp.get(section, "client_id", fallback="") or "").strip()),
                "has_client_secret": bool(
                    (cp.get(section, "client_secret", fallback="") or "").strip()
                ),
                "root_folder_id": root,
                "team_drive": team,
                "scope": (cp.get(section, "scope", fallback="") or "").strip() or None,
                "drive_id": drive_id,
                "drive_type": drive_type,
                "webdav_url": url_raw or None,
                "webdav_user": user_raw or None,
                "webdav_vendor": vendor,
            }
        )
    return remotes


def _fetch_ms_email(access_token: str) -> str | None:
    """Best-effort Microsoft Graph /me for OneDrive tokens."""
    if not access_token:
        return None
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(
                "https://graph.microsoft.com/v1.0/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if r.status_code != 200:
                return None
            data = r.json()
            return data.get("mail") or data.get("userPrincipalName") or data.get("displayName")
    except Exception as exc:
        logger.debug("MS userinfo failed: %s", exc)
        return None


def _fetch_email(access_token: str) -> str | None:
    if not access_token:
        return None
    try:
        with httpx.Client(timeout=15) as client:
            ui = client.get(
                GOOGLE_USERINFO,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if ui.status_code == 200:
                return ui.json().get("email")
    except Exception as exc:
        logger.debug("userinfo fetch failed: %s", exc)
    return None
