"""API request/response schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ---- Auth ----
class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    must_change_password: bool = False


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class ChangeUsernameRequest(BaseModel):
    new_username: str = Field(min_length=2, max_length=64)
    current_password: str


class UserOut(BaseModel):
    id: int
    username: str
    must_change_password: bool
    last_login: datetime | None = None

    model_config = {"from_attributes": True}


class ChangeUsernameResponse(BaseModel):
    message: str
    username: str
    access_token: str
    token_type: str = "bearer"


# ---- Drive / OneDrive accounts ----
SUPPORTED_PROVIDERS = ("drive", "onedrive")


class DriveAccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    remote_name: str | None = Field(default=None, max_length=64)
    provider: str = Field(default="drive", description="drive | onedrive")
    client_id: str | None = None
    client_secret: str | None = None
    root_folder_id: str | None = None
    team_drive: bool = False
    onedrive_drive_id: str | None = None
    onedrive_drive_type: str | None = None
    notes: str | None = None


class DriveAccountUpdate(BaseModel):
    name: str | None = None
    provider: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    root_folder_id: str | None = None
    team_drive: bool | None = None
    onedrive_drive_id: str | None = None
    onedrive_drive_type: str | None = None
    notes: str | None = None


class DriveAccountOut(BaseModel):
    id: int
    name: str
    remote_name: str
    provider: str = "drive"
    email: str | None = None
    root_folder_id: str | None = None
    team_drive: bool
    onedrive_drive_id: str | None = None
    onedrive_drive_type: str | None = None
    status: str
    last_check_at: datetime | None = None
    last_error: str | None = None
    total_bytes: int | None = None
    used_bytes: int | None = None
    free_bytes: int | None = None
    notes: str | None = None
    created_at: datetime
    updated_at: datetime
    has_token: bool = False
    mount_count: int = 0
    running_mounts: int = 0

    model_config = {"from_attributes": True}


class OAuthStartResponse(BaseModel):
    authorize_url: str
    state: str
    account_id: int | None = None


class PasteTokenRequest(BaseModel):
    """Paste rclone authorize / OAuth token JSON to authorize an account."""

    token: str = Field(min_length=10, description="rclone authorize 输出的 JSON 或完整粘贴文本")
    name: str | None = Field(default=None, max_length=128)
    remote_name: str | None = Field(default=None, max_length=64)
    provider: str = Field(default="drive", description="drive | onedrive")
    client_id: str | None = None
    client_secret: str | None = None
    root_folder_id: str | None = None
    team_drive: bool = False
    onedrive_drive_id: str | None = None
    onedrive_drive_type: str | None = None
    notes: str | None = None
    test_connection: bool = True


class RcloneImportPreviewRequest(BaseModel):
    config_text: str = Field(min_length=5, description="rclone.conf 全文或单个 [remote] 段")


class RcloneRemotePreview(BaseModel):
    remote_name: str
    type: str = "drive"
    has_token: bool = False
    has_client_id: bool = False
    has_client_secret: bool = False
    root_folder_id: str | None = None
    team_drive: str | None = None
    scope: str | None = None
    drive_id: str | None = None
    drive_type: str | None = None


class RcloneImportPreviewResponse(BaseModel):
    remotes: list[RcloneRemotePreview]
    count: int = 0


class RcloneImportRequest(BaseModel):
    config_text: str = Field(min_length=5)
    selected_remotes: list[str] | None = None
    name_prefix: str | None = Field(default=None, max_length=32)
    test_connection: bool = True
    overwrite: bool = False


class RcloneImportResult(BaseModel):
    imported: list[DriveAccountOut]
    count: int = 0
    message: str = ""


# ---- Mounts ----
class MountParams(BaseModel):
    vfs_cache_mode: str = "full"
    vfs_cache_max_size: str = "50G"
    vfs_cache_max_age: str = "168h"
    vfs_read_chunk_size: str = "128M"
    vfs_read_chunk_size_limit: str = "2G"
    buffer_size: str = "64M"
    dir_cache_time: str = "1000h"
    poll_interval: str = "15s"
    attr_timeout: str = "1s"
    allow_other: bool = True
    umask: str = "002"
    log_level: str = "INFO"
    transfers: int = 4
    checkers: int = 8
    drive_chunk_size: str = "128M"
    vfs_read_ahead: str = "256M"
    vfs_write_back: str = "5s"
    multi_thread_streams: int = 4
    multi_thread_cutoff: str = "128M"
    extra_args: list[str] = Field(default_factory=list)


class MountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    account_id: int
    remote_path: str = ""
    local_path: str
    mode: str = "media"
    params: MountParams | None = None
    cache_dir: str | None = None
    auto_start: bool = True


class MountUpdate(BaseModel):
    name: str | None = None
    remote_path: str | None = None
    local_path: str | None = None
    mode: str | None = None
    params: MountParams | None = None
    cache_dir: str | None = None
    auto_start: bool | None = None
    enabled: bool | None = None
    watchdog_paused: bool | None = None


class MountOut(BaseModel):
    id: int
    name: str
    account_id: int
    account_name: str | None = None
    remote_name: str | None = None
    provider: str = "drive"  # drive | onedrive (from linked account)
    remote_path: str
    local_path: str
    mode: str
    params: dict[str, Any] = Field(default_factory=dict)
    cache_dir: str | None = None
    enabled: bool
    auto_start: bool
    status: str
    pid: int | None = None
    started_at: datetime | None = None
    uptime_seconds: int | None = None
    last_error: str | None = None
    restart_count: int
    consecutive_failures: int
    watchdog_paused: bool
    cache_size_bytes: int
    created_at: datetime
    updated_at: datetime
    command_preview: list[str] = Field(default_factory=list)

    model_config = {"from_attributes": True}


# ---- Files ----
class FileEntry(BaseModel):
    name: str
    path: str
    is_dir: bool
    size: int = 0
    mtime: float | None = None
    ext: str | None = None


class BrowseResponse(BaseModel):
    path: str
    parent: str | None
    entries: list[FileEntry]
    total: int
    truncated: bool = False


# ---- Tasks / logs ----
class TaskLogOut(BaseModel):
    id: int
    task_type: str
    mount_id: int | None = None
    account_id: int | None = None
    status: str
    message: str
    detail: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ---- System ----
class SystemStats(BaseModel):
    cpu_percent: float
    memory_percent: float
    memory_used: int
    memory_total: int
    disk_percent: float
    disk_used: int
    disk_total: int
    boot_time: float
    uptime_seconds: int
    net_bytes_sent: int
    net_bytes_recv: int
    net_upload_speed: float = 0
    net_download_speed: float = 0
    load_avg: list[float] = Field(default_factory=list)


class DashboardOut(BaseModel):
    system: SystemStats
    accounts_total: int
    mounts_total: int
    mounts_running: int
    mounts_error: int
    mounts_stopped: int
    total_cache_bytes: int
    rclone_installed: bool
    rclone_version: str | None = None
    rclone_mount_processes: int
    watchdog_running: bool
    disk_warnings: list[dict[str, Any]] = Field(default_factory=list)
    mounts: list[MountOut] = Field(default_factory=list)


class UploadEventOut(BaseModel):
    time: str | None = None
    event: str
    path: str
    message: str
    size_bytes: int | None = None


class MountUploadOut(BaseModel):
    mount_id: int
    mount_name: str
    local_path: str
    status: str
    rc_enabled: bool = False
    rc_port: int | None = None
    objects: int = 0
    in_use: int = 0
    to_upload: int = 0
    uploading: int = 0
    cache_total_bytes: int = 0
    cache_total_display: str = "0"
    last_cleaned_at: str | None = None
    transfer_bytes: int | None = None
    transfer_total_bytes: int | None = None
    transfer_percent: float | None = None
    transfer_speed_bps: float | None = None
    transfer_eta: str | None = None
    transfers_done: int | None = None
    transfers_total: int | None = None
    errors: int = 0
    recent_events: list[UploadEventOut] = Field(default_factory=list)
    active: bool = False
    source: str = "log"
    note: str | None = None


class UploadStatusOut(BaseModel):
    mounts: list[MountUploadOut] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)


class CacheInfo(BaseModel):
    cache_root: str
    total_size_bytes: int
    file_count: int
    mounts: list[dict[str, Any]] = Field(default_factory=list)
    disk_percent: float
    disk_free: int
    disk_total: int
    warnings: list[str] = Field(default_factory=list)


class SettingUpdate(BaseModel):
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str | None = None
    microsoft_client_id: str | None = None
    microsoft_client_secret: str | None = None
    microsoft_redirect_uri: str | None = None
    microsoft_tenant: str | None = None
    allow_file_delete: bool | None = None
    watchdog_interval_seconds: int | None = None
    watchdog_max_restarts: int | None = None


class SettingsOut(BaseModel):
    google_client_id: str = ""
    google_client_secret_set: bool = False
    google_redirect_uri: str = ""
    microsoft_client_id: str = ""
    microsoft_client_secret_set: bool = False
    microsoft_redirect_uri: str = ""
    microsoft_tenant: str = "common"
    allow_file_delete: bool = True
    watchdog_interval_seconds: int = 30
    watchdog_max_restarts: int = 5
    rclone_config_path: str = ""
    data_dir: str = ""
    app_version: str = "1.0.0"


class MessageOut(BaseModel):
    message: str
    detail: Any = None


class RcloneStatus(BaseModel):
    installed: bool
    version: str | None = None
    path: str | None = None
    config_path: str
    mount_processes: int
