"""Security helpers: password hashing, JWT, encryption."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload: dict[str, Any] = {"sub": subject, "exp": expire}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.get_secret_key(), algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any] | None:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.get_secret_key(), algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None


def encrypt_value(value: str) -> str:
    f = Fernet(get_settings().get_encryption_key())
    return f.encrypt(value.encode()).decode()


def decrypt_value(token: str) -> str:
    f = Fernet(get_settings().get_encryption_key())
    try:
        return f.decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("Failed to decrypt sensitive value") from exc


def mask_secret(value: str | None, show: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= show * 2:
        return "*" * len(value)
    return f"{value[:show]}{'*' * (len(value) - show * 2)}{value[-show:]}"
