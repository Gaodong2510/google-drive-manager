"""rclone binary and config management."""

from __future__ import annotations

import configparser
import json
import logging
import os
import re
import shutil
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.core.security import decrypt_value, encrypt_value
from app.services.safe_exec import run_cmd, validate_remote_name

logger = logging.getLogger(__name__)


class RcloneService:
    def __init__(self) -> None:
        self.settings = get_settings()

    @property
    def bin(self) -> str:
        return self.settings.rclone_bin

    @property
    def config_path(self) -> Path:
        return self.settings.resolved_rclone_config

    def find_binary(self) -> str | None:
        path = shutil.which(self.bin)
        if path:
            return path
        for candidate in ("/usr/bin/rclone", "/usr/local/bin/rclone", "/bin/rclone"):
            if Path(candidate).is_file() and os.access(candidate, os.X_OK):
                return candidate
        return None

    def is_installed(self) -> bool:
        return self.find_binary() is not None

    def version(self) -> str | None:
        binary = self.find_binary()
        if not binary:
            return None
        try:
            r = run_cmd([binary, "version"], timeout=15)
            if r.returncode != 0:
                return None
            first = (r.stdout or "").splitlines()[0] if r.stdout else ""
            # rclone v1.68.2
            m = re.search(r"rclone\s+v?([\d.]+)", first, re.I)
            return m.group(1) if m else first.strip() or None
        except Exception as exc:
            logger.warning("rclone version check failed: %s", exc)
            return None

    def env_with_config(self, base: dict | None = None) -> dict[str, str]:
        env = dict(os.environ if base is None else base)
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.config_path.exists():
            self.config_path.touch(mode=0o600)
            self.config_path.chmod(0o600)
        env["RCLONE_CONFIG"] = str(self.config_path)
        # Avoid interactive prompts
        env["RCLONE_CONFIG_PASS"] = env.get("RCLONE_CONFIG_PASS", "")
        return env

    def _load_config(self) -> configparser.ConfigParser:
        cp = configparser.ConfigParser()
        if self.config_path.exists():
            cp.read(self.config_path)
        return cp

    def _save_config(self, cp: configparser.ConfigParser) -> None:
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.config_path, "w", encoding="utf-8") as f:
            cp.write(f)
        self.config_path.chmod(0o600)

    def upsert_drive_remote(
        self,
        remote_name: str,
        *,
        client_id: str,
        client_secret: str,
        token_json: str,
        root_folder_id: str | None = None,
        team_drive: bool = False,
    ) -> None:
        remote_name = validate_remote_name(remote_name)
        cp = self._load_config()
        section = remote_name
        if not cp.has_section(section):
            cp.add_section(section)
        # Clear leftover keys when switching provider
        for key in list(cp.options(section)) if cp.has_section(section) else []:
            if key not in ("type",):
                cp.remove_option(section, key)
        cp.set(section, "type", "drive")
        cp.set(section, "scope", "drive")
        if client_id:
            cp.set(section, "client_id", client_id)
        if client_secret:
            cp.set(section, "client_secret", client_secret)
        # token as single-line JSON
        cp.set(section, "token", token_json)
        if root_folder_id:
            cp.set(section, "root_folder_id", root_folder_id)
        if team_drive:
            cp.set(section, "team_drive", root_folder_id or "")
        self._save_config(cp)

    def upsert_onedrive_remote(
        self,
        remote_name: str,
        *,
        token_json: str,
        client_id: str = "",
        client_secret: str = "",
        drive_id: str | None = None,
        drive_type: str | None = None,
    ) -> None:
        """Write an rclone type=onedrive remote section."""
        remote_name = validate_remote_name(remote_name)
        cp = self._load_config()
        section = remote_name
        if not cp.has_section(section):
            cp.add_section(section)
        for key in list(cp.options(section)):
            if key not in ("type",):
                cp.remove_option(section, key)
        cp.set(section, "type", "onedrive")
        cp.set(section, "token", token_json)
        if client_id:
            cp.set(section, "client_id", client_id)
        if client_secret:
            cp.set(section, "client_secret", client_secret)
        if drive_id:
            cp.set(section, "drive_id", drive_id)
        if drive_type:
            cp.set(section, "drive_type", drive_type)
        self._save_config(cp)

    def obscure_password(self, password: str) -> str:
        """Return rclone-obscured password for conf storage."""
        binary = self.find_binary()
        if not binary:
            # Store plain; rclone also accepts some plain forms but conf expects obscure
            return password
        r = run_cmd([binary, "obscure", password], timeout=15)
        if r.returncode != 0:
            logger.warning("rclone obscure failed: %s", (r.stderr or r.stdout or "")[:200])
            return password
        out = (r.stdout or "").strip()
        return out or password

    def upsert_webdav_remote(
        self,
        remote_name: str,
        *,
        url: str,
        user: str,
        password: str,
        vendor: str = "other",
        password_obscured: bool = False,
    ) -> None:
        """Write an rclone type=webdav remote (123 云盘等)."""
        remote_name = validate_remote_name(remote_name)
        url = (url or "").strip()
        if not url.startswith(("http://", "https://")):
            raise ValueError("WebDAV URL 必须以 http:// 或 https:// 开头")
        user = (user or "").strip()
        if not user:
            raise ValueError("WebDAV 用户名不能为空")
        if not password:
            raise ValueError("WebDAV 密码不能为空")
        vendor = (vendor or "other").strip() or "other"
        obscured = password if password_obscured else self.obscure_password(password)

        cp = self._load_config()
        section = remote_name
        if not cp.has_section(section):
            cp.add_section(section)
        for key in list(cp.options(section)):
            if key not in ("type",):
                cp.remove_option(section, key)
        cp.set(section, "type", "webdav")
        cp.set(section, "url", url)
        cp.set(section, "vendor", vendor)
        cp.set(section, "user", user)
        cp.set(section, "pass", obscured)
        self._save_config(cp)

    def upsert_remote(
        self,
        remote_name: str,
        *,
        provider: str,
        token_json: str = "",
        client_id: str = "",
        client_secret: str = "",
        root_folder_id: str | None = None,
        team_drive: bool = False,
        onedrive_drive_id: str | None = None,
        onedrive_drive_type: str | None = None,
        webdav_url: str | None = None,
        webdav_user: str | None = None,
        webdav_password: str | None = None,
        webdav_vendor: str | None = None,
        webdav_password_obscured: bool = False,
    ) -> None:
        provider = (provider or "drive").strip().lower()
        if provider in ("123pan", "webdav"):
            self.upsert_webdav_remote(
                remote_name,
                url=webdav_url or "",
                user=webdav_user or "",
                password=webdav_password or token_json or "",
                vendor=webdav_vendor or "other",
                password_obscured=webdav_password_obscured,
            )
        elif provider == "onedrive":
            self.upsert_onedrive_remote(
                remote_name,
                token_json=token_json,
                client_id=client_id,
                client_secret=client_secret,
                drive_id=onedrive_drive_id,
                drive_type=onedrive_drive_type,
            )
        else:
            self.upsert_drive_remote(
                remote_name,
                client_id=client_id,
                client_secret=client_secret,
                token_json=token_json,
                root_folder_id=root_folder_id,
                team_drive=team_drive,
            )

    def copy_remote_to_remote(
        self,
        src: str,
        dst: str,
        *,
        transfers: int = 4,
        checkers: int = 8,
        timeout: int = 0,
    ) -> tuple[int, str, str]:
        """rclone copy src dst (e.g. remote:path remote2:path). Returns (code, stdout, stderr)."""
        binary = self.find_binary()
        if not binary:
            raise RuntimeError("rclone 未安装")
        # Basic injection guards
        if "\n" in src or "\r" in src or "\n" in dst or "\r" in dst:
            raise ValueError("非法路径")
        args = [
            binary,
            "copy",
            src,
            dst,
            "--config",
            str(self.config_path),
            "--transfers",
            str(max(1, min(transfers, 16))),
            "--checkers",
            str(max(1, min(checkers, 32))),
            "--retries",
            "5",
            "--low-level-retries",
            "10",
            "-P",
        ]
        # timeout 0 = no limit (long transfers)
        r = run_cmd(args, timeout=timeout or 86400, env=self.env_with_config())
        return r.returncode, r.stdout or "", r.stderr or ""

    def detect_onedrive_drive(self, remote_name: str) -> dict[str, str] | None:
        """Try to pick the first OneDrive drive via rclone backend drives."""
        remote_name = validate_remote_name(remote_name)
        binary = self.find_binary()
        if not binary:
            return None
        # Prefer JSON if available
        for extra in (["--json"], []):
            r = run_cmd(
                [binary, "backend", "drives", f"{remote_name}:", *extra, "--config", str(self.config_path)],
                timeout=90,
                env=self.env_with_config(),
            )
            if r.returncode != 0:
                continue
            out = (r.stdout or "").strip()
            if not out:
                continue
            if extra:
                try:
                    data = json.loads(out)
                    items = data if isinstance(data, list) else data.get("list") or data.get("drives") or []
                    if items and isinstance(items, list):
                        first = items[0]
                        if isinstance(first, dict):
                            did = str(first.get("id") or first.get("drive_id") or "").strip()
                            dtype = str(first.get("driveType") or first.get("drive_type") or first.get("type") or "personal").strip()
                            if did:
                                return {"drive_id": did, "drive_type": dtype or "personal"}
                except json.JSONDecodeError:
                    pass
            # Plain text: lines like "id driveType name"
            for line in out.splitlines():
                parts = line.strip().split()
                if len(parts) >= 2 and not parts[0].lower().startswith("id"):
                    return {"drive_id": parts[0], "drive_type": parts[1]}
        return None

    def delete_remote(self, remote_name: str) -> None:
        remote_name = validate_remote_name(remote_name)
        cp = self._load_config()
        if cp.has_section(remote_name):
            cp.remove_section(remote_name)
            self._save_config(cp)

    def list_remotes(self) -> list[str]:
        binary = self.find_binary()
        if not binary:
            return []
        r = run_cmd([binary, "listremotes", "--config", str(self.config_path)], timeout=30, env=self.env_with_config())
        if r.returncode != 0:
            return []
        remotes = []
        for line in (r.stdout or "").splitlines():
            line = line.strip().rstrip(":")
            if line:
                remotes.append(line)
        return remotes

    def about(self, remote_name: str) -> dict[str, Any]:
        remote_name = validate_remote_name(remote_name)
        binary = self.find_binary()
        if not binary:
            raise RuntimeError("rclone 未安装")
        target = f"{remote_name}:"
        r = run_cmd(
            [binary, "about", target, "--json", "--config", str(self.config_path)],
            timeout=60,
            env=self.env_with_config(),
        )
        if r.returncode != 0:
            err = (r.stderr or r.stdout or "about failed").strip()
            raise RuntimeError(err)
        data = json.loads(r.stdout or "{}")
        return {
            "total": data.get("total"),
            "used": data.get("used"),
            "free": data.get("free"),
            "trashed": data.get("trashed"),
            "other": data.get("other"),
        }

    def lsd(self, remote_name: str, path: str = "") -> list[dict]:
        remote_name = validate_remote_name(remote_name)
        binary = self.find_binary()
        if not binary:
            raise RuntimeError("rclone 未安装")
        target = f"{remote_name}:{path.lstrip('/')}"
        r = run_cmd(
            [binary, "lsd", target, "--config", str(self.config_path)],
            timeout=60,
            env=self.env_with_config(),
        )
        if r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout or "lsd failed").strip())
        entries = []
        for line in (r.stdout or "").splitlines():
            parts = line.split(None, 5)
            if len(parts) >= 6:
                entries.append({"name": parts[5]})
            elif len(parts) >= 1:
                entries.append({"name": parts[-1]})
        return entries

    def test_connection(self, remote_name: str) -> dict[str, Any]:
        about = self.about(remote_name)
        return {"ok": True, "about": about}

    def install_rclone(self) -> str:
        """Install rclone via official install script (requires network + root)."""
        if self.is_installed():
            return f"已安装 rclone v{self.version()}"
        # Download install script and run — use curl/bash carefully with fixed URL
        r = run_cmd(
            ["bash", "-c", "curl -fsSL https://rclone.org/install.sh | bash"],
            timeout=300,
        )
        if r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout or "install failed").strip())
        ver = self.version()
        if not ver:
            raise RuntimeError("rclone 安装后仍不可用")
        return f"已安装 rclone v{ver}"

    def count_mount_processes(self) -> int:
        try:
            r = run_cmd(["pgrep", "-f", r"rclone mount"], timeout=10)
            if r.returncode != 0:
                return 0
            lines = [ln for ln in (r.stdout or "").splitlines() if ln.strip()]
            return len(lines)
        except Exception:
            return 0


def get_rclone() -> RcloneService:
    return RcloneService()
