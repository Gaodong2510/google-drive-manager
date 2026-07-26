"""Host system metrics."""

from __future__ import annotations

import os
import time
from typing import Any

import psutil

from app.core.config import get_settings
from app.services.mount_service import dir_size
from app.services.rclone_service import get_rclone

# Simple speed calculation state
_prev_net: tuple[float, int, int] | None = None


def get_system_stats() -> dict[str, Any]:
    global _prev_net
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    boot = psutil.boot_time()
    now = time.time()
    net = psutil.net_io_counters()
    upload_speed = 0.0
    download_speed = 0.0
    if _prev_net is not None:
        dt = max(now - _prev_net[0], 0.001)
        upload_speed = max(0.0, (net.bytes_sent - _prev_net[1]) / dt)
        download_speed = max(0.0, (net.bytes_recv - _prev_net[2]) / dt)
    _prev_net = (now, net.bytes_sent, net.bytes_recv)

    load: list[float] = []
    try:
        load = list(os.getloadavg())
    except OSError:
        pass

    return {
        "cpu_percent": psutil.cpu_percent(interval=0.1),
        "memory_percent": mem.percent,
        "memory_used": mem.used,
        "memory_total": mem.total,
        "disk_percent": disk.percent,
        "disk_used": disk.used,
        "disk_total": disk.total,
        "boot_time": boot,
        "uptime_seconds": int(now - boot),
        "net_bytes_sent": net.bytes_sent,
        "net_bytes_recv": net.bytes_recv,
        "net_upload_speed": upload_speed,
        "net_download_speed": download_speed,
        "load_avg": load,
    }


def disk_warnings_for_paths(paths: list[str]) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    seen = set()
    for p in paths:
        try:
            usage = psutil.disk_usage(p if os.path.exists(p) else "/")
            # group by device total+mount
            key = (usage.total, usage.used)
            if key in seen:
                continue
            seen.add(key)
            level = None
            if usage.percent >= 90:
                level = "critical"
            elif usage.percent >= 80:
                level = "warning"
            if level:
                warnings.append(
                    {
                        "path": p,
                        "percent": usage.percent,
                        "free": usage.free,
                        "total": usage.total,
                        "level": level,
                        "message": f"磁盘 {p} 使用率 {usage.percent:.0f}%",
                    }
                )
        except OSError:
            continue
    return warnings


def get_cache_info(mounts: list[Any] | None = None) -> dict[str, Any]:
    settings = get_settings()
    root = settings.cache_dir
    total = dir_size(root) if root.exists() else 0
    file_count = 0
    if root.exists():
        for _r, _d, files in os.walk(root):
            file_count += len(files)
    mount_infos = []
    if mounts:
        for m in mounts:
            cdir = m.cache_dir or str(settings.cache_dir / f"mount_{m.id}")
            size = 0
            try:
                if os.path.isdir(cdir):
                    size = dir_size(__import__("pathlib").Path(cdir))
            except Exception:
                pass
            mount_infos.append(
                {
                    "id": m.id,
                    "name": m.name,
                    "cache_dir": cdir,
                    "size_bytes": size,
                    "max_size": None,
                }
            )
    try:
        usage = psutil.disk_usage(str(root if root.exists() else "/"))
        disk_percent = usage.percent
        disk_free = usage.free
        disk_total = usage.total
    except OSError:
        disk_percent, disk_free, disk_total = 0.0, 0, 0

    warnings: list[str] = []
    if disk_percent >= 90:
        warnings.append(f"磁盘使用率 {disk_percent:.0f}%（高危），请立即清理缓存")
    elif disk_percent >= 80:
        warnings.append(f"磁盘使用率 {disk_percent:.0f}%（警告），建议清理缓存")
    return {
        "cache_root": str(root),
        "total_size_bytes": total,
        "file_count": file_count,
        "mounts": mount_infos,
        "disk_percent": disk_percent,
        "disk_free": disk_free,
        "disk_total": disk_total,
        "warnings": warnings,
    }


def clear_cache_dir(path: str | None = None) -> dict[str, Any]:
    settings = get_settings()
    target = path or str(settings.cache_dir)
    # Safety: only under data/cache
    from app.services.safe_exec import validate_path

    p = validate_path(target)
    cache_root = settings.cache_dir.resolve()
    if cache_root not in p.parents and p != cache_root:
        if not str(p).startswith(str(cache_root)):
            raise ValueError("只能清理应用缓存目录内的内容")
    removed = 0
    freed = 0
    if p.is_dir():
        for root, dirs, files in os.walk(p, topdown=False):
            for name in files:
                fp = os.path.join(root, name)
                try:
                    freed += os.path.getsize(fp)
                    os.remove(fp)
                    removed += 1
                except OSError:
                    pass
            for name in dirs:
                dp = os.path.join(root, name)
                try:
                    os.rmdir(dp)
                except OSError:
                    pass
    return {"removed_files": removed, "freed_bytes": freed}
