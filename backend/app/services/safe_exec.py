"""Safe subprocess execution — never shell=True with user input."""

from __future__ import annotations

import asyncio
import logging
import re
import shlex
import subprocess
from pathlib import Path
from typing import Sequence

logger = logging.getLogger(__name__)

# Allowed characters for rclone remote names
REMOTE_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
# Duration/size style args: 50G, 128M, 15s, 1000h, 1.5G, off, full, writes, minimal, etc.
SAFE_VALUE_RE = re.compile(r"^[A-Za-z0-9_./:+%@=-]{1,128}$")
LOG_LEVELS = {"DEBUG", "INFO", "NOTICE", "ERROR", "CRITICAL"}
VFS_MODES = {"off", "minimal", "writes", "full"}


def validate_remote_name(name: str) -> str:
    if not REMOTE_NAME_RE.match(name):
        raise ValueError(f"非法 remote 名称: {name}")
    return name


def validate_path(path: str, *, must_be_absolute: bool = True) -> Path:
    p = Path(path).expanduser()
    # Resolve without requiring existence for create cases
    try:
        resolved = p.resolve(strict=False)
    except Exception as exc:
        raise ValueError(f"非法路径: {path}") from exc
    s = str(resolved)
    if must_be_absolute and not resolved.is_absolute():
        raise ValueError("路径必须是绝对路径")
    # Block path traversal tricks
    if ".." in Path(path).parts:
        raise ValueError("路径不允许包含 ..")
    if "\x00" in s:
        raise ValueError("路径包含非法字符")
    return resolved


def validate_safe_value(value: str, field: str = "value") -> str:
    if not value or not SAFE_VALUE_RE.match(value):
        raise ValueError(f"参数 {field} 含有非法字符: {value}")
    return value


def run_cmd(
    args: Sequence[str],
    *,
    timeout: float | None = 120,
    env: dict | None = None,
    cwd: str | None = None,
    check: bool = False,
) -> subprocess.CompletedProcess[str]:
    """Run command with argument list only (no shell)."""
    if not args:
        raise ValueError("empty command")
    # Ensure all args are strings
    cmd = [str(a) for a in args]
    logger.debug("exec: %s", " ".join(shlex.quote(c) for c in cmd))
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
            cwd=cwd,
            check=False,
            shell=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError(f"命令超时: {cmd[0]}") from exc
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"命令不存在: {cmd[0]}") from exc
    if check and result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}")
    return result


async def run_cmd_async(
    args: Sequence[str],
    *,
    timeout: float | None = 120,
    env: dict | None = None,
) -> subprocess.CompletedProcess[str]:
    return await asyncio.to_thread(run_cmd, args, timeout=timeout, env=env)


def start_process(
    args: Sequence[str],
    *,
    log_file: Path,
    env: dict | None = None,
) -> subprocess.Popen[str]:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    # Open log for append; process writes stdout/stderr there
    log_fh = open(log_file, "a", encoding="utf-8", buffering=1)  # noqa: SIM115
    cmd = [str(a) for a in args]
    logger.info("start process: %s", " ".join(shlex.quote(c) for c in cmd))
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=log_fh,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            env=env,
            shell=False,
            start_new_session=True,
            text=True,
        )
    except Exception:
        log_fh.close()
        raise
    # Store fh on process to avoid GC close; process owns it for life of mount
    proc._gdm_log_fh = log_fh  # type: ignore[attr-defined]
    return proc
