"""Application configuration."""

from __future__ import annotations

import os
import secrets
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_data_dir() -> Path:
    env = os.environ.get("GDM_DATA_DIR")
    if env:
        return Path(env)
    # Project root / data
    return Path(__file__).resolve().parents[3] / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GDM_", env_file=".env", extra="ignore")

    app_name: str = "Google Drive Manager"
    app_version: str = "1.0.0"
    debug: bool = False
    host: str = "0.0.0.0"
    port: int = 8787

    data_dir: Path = _default_data_dir()
    secret_key: str = ""
    encryption_key: str = ""

    # Auth
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days
    jwt_algorithm: str = "HS256"
    default_username: str = "admin"
    default_password: str = "admin123"
    force_password_change: bool = True

    # OAuth (user-configurable Google Cloud OAuth client)
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""
    oauth_scopes: str = "https://www.googleapis.com/auth/drive"

    # rclone
    rclone_bin: str = "rclone"
    rclone_config_path: Path | None = None

    # Watchdog
    watchdog_interval_seconds: int = 30
    watchdog_max_restarts: int = 5
    watchdog_restart_window_seconds: int = 600
    watchdog_read_check: bool = True

    # Security
    cors_origins: str = "*"
    allow_file_delete: bool = True
    max_browse_entries: int = 2000

    # Mount defaults (media server)
    default_mount_mode: str = "media"  # media | cloud | custom

    @property
    def config_dir(self) -> Path:
        return self.data_dir / "config"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def backups_dir(self) -> Path:
        return self.data_dir / "backups"

    @property
    def rclone_dir(self) -> Path:
        return self.data_dir / "rclone"

    @property
    def db_path(self) -> Path:
        return self.config_dir / "gdm.db"

    @property
    def resolved_rclone_config(self) -> Path:
        if self.rclone_config_path:
            return Path(self.rclone_config_path)
        return self.rclone_dir / "rclone.conf"

    def ensure_dirs(self) -> None:
        for p in (
            self.data_dir,
            self.config_dir,
            self.logs_dir,
            self.cache_dir,
            self.backups_dir,
            self.rclone_dir,
            self.logs_dir / "mounts",
        ):
            p.mkdir(parents=True, exist_ok=True)

    def get_secret_key(self) -> str:
        if self.secret_key:
            return self.secret_key
        key_file = self.config_dir / "secret.key"
        if key_file.exists():
            return key_file.read_text().strip()
        key = secrets.token_urlsafe(48)
        key_file.write_text(key)
        key_file.chmod(0o600)
        return key

    def get_encryption_key(self) -> bytes:
        """Fernet key material (url-safe base64 32-byte key)."""
        from cryptography.fernet import Fernet

        if self.encryption_key:
            return self.encryption_key.encode() if isinstance(self.encryption_key, str) else self.encryption_key
        key_file = self.config_dir / "encryption.key"
        if key_file.exists():
            return key_file.read_bytes().strip()
        key = Fernet.generate_key()
        key_file.write_bytes(key)
        key_file.chmod(0o600)
        return key


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings


# Media / cloud recommended rclone mount parameter presets
MOUNT_PRESETS: dict[str, dict] = {
    "media": {
        "label": "媒体服务器模式 (Emby/Plex)",
        "description": "针对大文件连续读取、4K 流媒体、多用户同时访问优化",
        "params": {
            "vfs_cache_mode": "full",
            "vfs_cache_max_size": "50G",
            "vfs_cache_max_age": "168h",
            "vfs_read_chunk_size": "128M",
            "vfs_read_chunk_size_limit": "2G",
            "buffer_size": "64M",
            "dir_cache_time": "1000h",
            "poll_interval": "15s",
            "attr_timeout": "1s",
            "allow_other": True,
            "umask": "002",
            "log_level": "INFO",
            "transfers": 4,
            "checkers": 8,
            "drive_chunk_size": "128M",
            "vfs_read_ahead": "256M",
            "vfs_write_back": "5s",
            "multi_thread_streams": 4,
            "multi_thread_cutoff": "128M",
        },
    },
    "cloud": {
        "label": "普通云盘模式",
        "description": "平衡内存占用与响应速度，适合日常文件浏览",
        "params": {
            "vfs_cache_mode": "writes",
            "vfs_cache_max_size": "10G",
            "vfs_cache_max_age": "72h",
            "vfs_read_chunk_size": "32M",
            "vfs_read_chunk_size_limit": "512M",
            "buffer_size": "16M",
            "dir_cache_time": "5m",
            "poll_interval": "1m",
            "attr_timeout": "1s",
            "allow_other": True,
            "umask": "002",
            "log_level": "INFO",
            "transfers": 4,
            "checkers": 8,
            "drive_chunk_size": "64M",
            "vfs_read_ahead": "32M",
            "vfs_write_back": "5s",
            "multi_thread_streams": 0,
            "multi_thread_cutoff": "256M",
        },
    },
    "custom": {
        "label": "自定义模式",
        "description": "完全自定义所有挂载参数",
        "params": {},
    },
}
