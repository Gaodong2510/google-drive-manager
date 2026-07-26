"""Persist task/operation logs."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.models.models import TaskLog

logger = logging.getLogger(__name__)


def log_task(
    db: Session,
    *,
    task_type: str,
    message: str,
    status: str = "info",
    mount_id: int | None = None,
    account_id: int | None = None,
    detail: str | None = None,
) -> TaskLog:
    entry = TaskLog(
        task_type=task_type,
        mount_id=mount_id,
        account_id=account_id,
        status=status,
        message=message,
        detail=detail,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    level = logging.ERROR if status == "error" else logging.INFO
    logger.log(level, "[%s] %s", task_type, message)
    return entry


def redact_secrets(text: str) -> str:
    """Best-effort redaction of tokens/secrets in log text."""
    import re

    patterns = [
        (r"(refresh_token[\"']?\s*[:=]\s*[\"']?)([^\"'\s,}]+)", r"\1***REDACTED***"),
        (r"(access_token[\"']?\s*[:=]\s*[\"']?)([^\"'\s,}]+)", r"\1***REDACTED***"),
        (r"(client_secret[\"']?\s*[:=]\s*[\"']?)([^\"'\s,}]+)", r"\1***REDACTED***"),
        (r"(Bearer\s+)([A-Za-z0-9._\-]+)", r"\1***REDACTED***"),
    ]
    out = text
    for pat, repl in patterns:
        out = re.sub(pat, repl, out, flags=re.IGNORECASE)
    return out
