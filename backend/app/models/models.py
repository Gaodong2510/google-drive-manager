"""SQLAlchemy models."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class DriveAccount(Base):
    __tablename__ = "drive_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    remote_name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # rclone backend: drive | onedrive | 123pan (webdav)
    provider: Mapped[str] = mapped_column(String(32), default="drive", index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Encrypted tokens / sensitive fields
    client_id_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_secret_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    root_folder_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    team_drive: Mapped[bool] = mapped_column(Boolean, default=False)
    # OneDrive-specific (rclone drive_id / drive_type)
    onedrive_drive_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    onedrive_drive_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 123 云盘 / 通用 WebDAV
    webdav_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    webdav_vendor: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending|connected|error|revoked
    last_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    used_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    free_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    mounts: Mapped[list[MountPoint]] = relationship(back_populates="account", cascade="all, delete-orphan")


class MountPoint(Base):
    __tablename__ = "mount_points"
    __table_args__ = (UniqueConstraint("local_path", name="uq_mount_local_path"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("drive_accounts.id", ondelete="CASCADE"))
    remote_path: Mapped[str] = mapped_column(String(512), default="")  # path inside remote
    local_path: Mapped[str] = mapped_column(String(512))
    mode: Mapped[str] = mapped_column(String(32), default="media")  # media|cloud|custom
    # JSON string of rclone params
    params_json: Mapped[str] = mapped_column(Text, default="{}")
    cache_dir: Mapped[str | None] = mapped_column(String(512), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_start: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(32), default="stopped")  # running|starting|stopped|error
    pid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    restart_count: Mapped[int] = mapped_column(Integer, default=0)
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)
    watchdog_paused: Mapped[bool] = mapped_column(Boolean, default=False)
    cache_size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    account: Mapped[DriveAccount] = relationship(back_populates="mounts")


class TaskLog(Base):
    __tablename__ = "task_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_type: Mapped[str] = mapped_column(String(64), index=True)  # start|stop|restart|watchdog|oauth|system
    mount_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="info")  # info|success|error|warning
    message: Mapped[str] = mapped_column(Text, default="")
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class OAuthState(Base):
    __tablename__ = "oauth_states"

    state: Mapped[str] = mapped_column(String(128), primary_key=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    remote_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    redirect_after: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # drive | onedrive
    provider: Mapped[str | None] = mapped_column(String(32), nullable=True, default="drive")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class MountTrafficState(Base):
    """Per-mount last sample of rclone session bytes (for daily delta tracking)."""

    __tablename__ = "mount_traffic_state"

    mount_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_session_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    last_pid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_sample_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Last Asia/Shanghai calendar date we attributed traffic to (YYYY-MM-DD)
    last_day: Mapped[str | None] = mapped_column(String(16), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class MountTrafficDaily(Base):
    """Daily traffic totals in Asia/Shanghai timezone (resets conceptually at 00:00)."""

    __tablename__ = "mount_traffic_daily"
    __table_args__ = (UniqueConstraint("mount_id", "day", name="uq_mount_traffic_day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mount_id: Mapped[int] = mapped_column(Integer, index=True)
    # Asia/Shanghai date string YYYY-MM-DD
    day: Mapped[str] = mapped_column(String(16), index=True)
    bytes_total: Mapped[int] = mapped_column(BigInteger, default=0)
    sample_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
