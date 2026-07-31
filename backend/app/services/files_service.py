"""Browse local mount directories (not Drive API)."""

from __future__ import annotations

import logging
import mimetypes
import os
import shutil
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.services.safe_exec import validate_path

logger = logging.getLogger(__name__)


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


def _match_mount(path: Path, mounts: list[Any]) -> Any | None:
    """Pick the longest matching mount.local_path under path."""
    best = None
    best_len = -1
    for m in mounts:
        try:
            root = validate_path(m.local_path)
        except ValueError:
            continue
        if path == root or _is_under(path, root):
            n = len(str(root))
            if n > best_len:
                best = m
                best_len = n
    return best


def local_path_to_remote(path: str, mounts: list[Any]) -> tuple[str, str, Any]:
    """Map a local mount path to (remote_name, remote_rel_path, mount)."""
    p = validate_path(path)
    mount = _match_mount(p, mounts)
    if not mount or not mount.account:
        raise ValueError(f"路径不在任何挂载下: {path}")
    root = validate_path(mount.local_path)
    if p == root:
        rel = ""
    else:
        rel = str(p.relative_to(root)).replace("\\", "/")
    base = (mount.remote_path or "").strip().strip("/")
    if base and rel:
        remote_rel = f"{base}/{rel}"
    elif base:
        remote_rel = base
    else:
        remote_rel = rel
    return mount.account.remote_name, remote_rel, mount


def copy_between_mounts(
    src_paths: list[str],
    dest_dir: str,
    mounts: list[Any],
    allowed_roots: list[str],
    *,
    prefer_rclone: bool = True,
) -> dict[str, Any]:
    """
    Copy files/dirs from src_paths into dest_dir (must be under a mount).
    Prefer rclone remote→remote (minimal disk); fallback to local shutil via FUSE.
    """
    from app.services.rclone_service import get_rclone

    dest = ensure_within_roots(dest_dir, allowed_roots)
    if not dest.exists() or not dest.is_dir():
        raise ValueError(f"目标目录不存在: {dest_dir}")

    dest_remote, dest_rel, dest_mount = local_path_to_remote(str(dest), mounts)
    rclone = get_rclone()
    results: list[dict[str, Any]] = []
    mode_used = "rclone"

    for src in src_paths:
        sp = ensure_within_roots(src, allowed_roots)
        if not sp.exists():
            raise FileNotFoundError(f"源不存在: {src}")
        src_remote, src_rel, src_mount = local_path_to_remote(str(sp), mounts)
        name = sp.name

        # Same mount + same path noop
        if str(sp) == str(dest / name):
            results.append({"src": src, "status": "skip", "reason": "源与目标相同"})
            continue

        if prefer_rclone and src_remote and dest_remote and rclone.is_installed():
            # File: copy parent/file into dest; Dir: copy dir into dest/name
            if sp.is_dir():
                src_spec = f"{src_remote}:{src_rel}" if src_rel else f"{src_remote}:"
                # trailing slash semantics: copy contents into dest_dir/name
                dst_rel = f"{dest_rel}/{name}".strip("/") if dest_rel else name
                dst_spec = f"{dest_remote}:{dst_rel}"
            else:
                # rclone copy file: source is file path, dest is directory
                src_spec = f"{src_remote}:{src_rel}"
                dst_spec = f"{dest_remote}:{dest_rel}" if dest_rel else f"{dest_remote}:"

            logger.info("rclone copy %s → %s", src_spec, dst_spec)
            code, out, err = rclone.copy_remote_to_remote(src_spec, dst_spec)
            if code != 0:
                # fallback local
                logger.warning("rclone copy failed (%s), fallback local: %s", code, err[:300])
                mode_used = "local"
                _local_copy(sp, dest / name if sp.is_dir() else dest / name)
                results.append(
                    {
                        "src": src,
                        "status": "ok",
                        "mode": "local",
                        "note": f"rclone 失败后本地复制: {(err or out)[:200]}",
                    }
                )
            else:
                results.append({"src": src, "status": "ok", "mode": "rclone", "dst": dst_spec})
        else:
            mode_used = "local"
            target = dest / name
            _local_copy(sp, target)
            results.append({"src": src, "status": "ok", "mode": "local"})

    ok = sum(1 for r in results if r.get("status") == "ok")
    return {
        "mode": mode_used,
        "copied": ok,
        "total": len(src_paths),
        "results": results,
        "dest_dir": str(dest),
        "dest_mount": dest_mount.name if dest_mount else None,
    }


def _local_copy(src: Path, dest: Path) -> None:
    if src.is_dir():
        if dest.exists():
            # merge into existing
            for item in src.iterdir():
                _local_copy(item, dest / item.name)
        else:
            shutil.copytree(src, dest, dirs_exist_ok=True)
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
