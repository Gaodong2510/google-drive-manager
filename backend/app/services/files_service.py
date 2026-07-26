"""Browse local mount directories (not Drive API)."""

from __future__ import annotations

import mimetypes
import os
import shutil
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.services.safe_exec import validate_path


def _is_under(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def ensure_within_roots(path: str, allowed_roots: list[str]) -> Path:
    p = validate_path(path)
    if not allowed_roots:
        raise ValueError("没有允许的挂载根目录")
    for root in allowed_roots:
        try:
            r = validate_path(root)
        except ValueError:
            continue
        if p == r or _is_under(p, r):
            return p
    raise ValueError("路径不在允许的挂载目录内")


def browse(
    path: str,
    allowed_roots: list[str],
    *,
    sort_by: str = "name",
    sort_dir: str = "asc",
    search: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    p = ensure_within_roots(path, allowed_roots)
    if not p.exists():
        raise FileNotFoundError(f"路径不存在: {p}")
    if not p.is_dir():
        raise NotADirectoryError(f"不是目录: {p}")

    entries: list[dict[str, Any]] = []
    try:
        names = os.listdir(p)
    except OSError as exc:
        raise RuntimeError(f"无法读取目录: {exc}") from exc

    for name in names:
        if search and search.lower() not in name.lower():
            continue
        fp = p / name
        try:
            st = fp.lstat()
            is_dir = fp.is_dir()
            entries.append(
                {
                    "name": name,
                    "path": str(fp),
                    "is_dir": is_dir,
                    "size": 0 if is_dir else int(st.st_size),
                    "mtime": float(st.st_mtime),
                    "ext": None if is_dir else (fp.suffix.lower().lstrip(".") or None),
                }
            )
        except OSError:
            continue

    reverse = sort_dir.lower() == "desc"

    def key_fn(e: dict) -> Any:
        if sort_by == "size":
            return (not e["is_dir"], e["size"], e["name"].lower())
        if sort_by == "mtime":
            return (not e["is_dir"], e["mtime"] or 0, e["name"].lower())
        return (not e["is_dir"], e["name"].lower())

    entries.sort(key=key_fn, reverse=reverse)

    total = len(entries)
    truncated = False
    if total > settings.max_browse_entries:
        entries = entries[: settings.max_browse_entries]
        truncated = True

    parent = None
    for root in allowed_roots:
        try:
            r = validate_path(root)
            if p == r:
                parent = None
                break
            if _is_under(p, r):
                parent = str(p.parent)
                break
        except ValueError:
            continue

    return {
        "path": str(p),
        "parent": parent,
        "entries": entries,
        "total": total,
        "truncated": truncated,
    }


def mkdir(path: str, name: str, allowed_roots: list[str]) -> str:
    parent = ensure_within_roots(path, allowed_roots)
    if not name or name in (".", "..") or "/" in name or "\\" in name:
        raise ValueError("非法文件夹名")
    target = parent / name
    ensure_within_roots(str(target), allowed_roots)
    target.mkdir(parents=False, exist_ok=False)
    return str(target)


def remove_path(path: str, allowed_roots: list[str], *, allow_delete: bool) -> None:
    if not allow_delete:
        raise PermissionError("已禁用删除功能")
    p = ensure_within_roots(path, allowed_roots)
    # Never delete the mount root itself
    for root in allowed_roots:
        try:
            if p == validate_path(root):
                raise ValueError("不能删除挂载根目录")
        except ValueError as exc:
            if "不能删除" in str(exc):
                raise
    if p.is_dir():
        shutil.rmtree(p)
    elif p.is_file() or p.is_symlink():
        p.unlink()
    else:
        raise FileNotFoundError(str(p))


def resolve_download(path: str, allowed_roots: list[str]) -> Path:
    p = ensure_within_roots(path, allowed_roots)
    if not p.is_file():
        raise FileNotFoundError("文件不存在或不是普通文件")
    return p


def guess_media_type(path: Path) -> str:
    mt, _ = mimetypes.guess_type(str(path))
    return mt or "application/octet-stream"
