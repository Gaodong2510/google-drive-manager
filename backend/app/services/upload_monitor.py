"""Parse rclone mount logs + optional RC API for VFS upload progress.

Works with MoviePilot / Emby writes to rclone mounts (vfs-cache-mode full/writes):
local writes land in VFS cache first, then rclone write-back uploads to Google Drive.
"""

from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# RC base port; each mount uses 5572 + mount_id (localhost only).
RC_BASE_PORT = 5572

# 2026/07/26 03:28:35 INFO  : path: vfs cache: queuing for upload in 5s
_RE_TS = re.compile(r"^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2})")
_RE_QUEUE = re.compile(
    r":\s+(.+?):\s+vfs cache:\s+queuing for upload",
    re.IGNORECASE,
)
_RE_SUCCESS = re.compile(
    r":\s+(.+?):\s+vfs cache:\s+upload succeeded",
    re.IGNORECASE,
)
_RE_FAILED = re.compile(
    r":\s+(.+?):\s+vfs cache:\s+upload (?:failed|error)",
    re.IGNORECASE,
)
_RE_COPIED = re.compile(
    r":\s+(.+?):\s+Copied \((?:new|replaced)\)",
    re.IGNORECASE,
)
_RE_CLEANED = re.compile(
    r"vfs cache:\s+cleaned:\s+objects\s+(\d+)\s+\(was\s+\d+\)\s+in use\s+(\d+),\s+"
    r"to upload\s+(\d+),\s+uploading\s+(\d+),\s+total size\s+([^\s(]+)",
    re.IGNORECASE,
)
# Transferred:   	  123.456 MiB / 1.234 GiB, 10%, 12.345 MiB/s, ETA 1m2s
_RE_TRANSFERRED = re.compile(
    r"Transferred:\s+([0-9.]+\s*[KMGTP]?i?B)\s*/\s*([0-9.]+\s*[KMGTP]?i?B),\s*(\d+)%,\s*"
    r"([0-9.]+\s*[KMGTP]?i?B/s),\s*ETA\s+(\S+)",
    re.IGNORECASE,
)
_RE_TRANSFERS_LINE = re.compile(
    r"Transfers:\s+(\d+)\s*/\s*(\d+)",
    re.IGNORECASE,
)
_RE_ERRORS = re.compile(r"Errors:\s+(\d+)", re.IGNORECASE)


def rc_port_for_mount(mount_id: int) -> int:
    return RC_BASE_PORT + int(mount_id)


def parse_size_to_bytes(text: str) -> int | None:
    """Parse rclone size strings like '9.213Gi', '843M', '1.1G', '594615'."""
    if text is None:
        return None
    s = str(text).strip().replace(",", "")
    if not s or s == "-":
        return None
    m = re.match(r"^([0-9]*\.?[0-9]+)\s*([KMGTP]i?B?|B)?$", s, re.IGNORECASE)
    if not m:
        # plain integer bytes
        if s.isdigit():
            return int(s)
        return None
    num = float(m.group(1))
    unit = (m.group(2) or "B").upper().replace("IB", "I")  # GiB/MiB → GI/MI, Gi → GI
    if unit.endswith("B") and len(unit) > 1 and not unit.endswith("IB"):
        unit = unit[:-1]  # GB → G, MB → M
    mult = {
        "B": 1,
        "K": 1024,
        "KI": 1024,
        "M": 1024**2,
        "MI": 1024**2,
        "G": 1024**3,
        "GI": 1024**3,
        "T": 1024**4,
        "TI": 1024**4,
        "P": 1024**5,
        "PI": 1024**5,
    }
    return int(num * mult.get(unit, 1))


def _parse_ts(line: str) -> str | None:
    m = _RE_TS.match(line)
    if not m:
        return None
    try:
        dt = datetime.strptime(m.group(1), "%Y/%m/%d %H:%M:%S").replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except ValueError:
        return m.group(1)


@dataclass
class UploadEvent:
    time: str | None
    event: str  # queued | uploading | success | failed | copied | stats
    path: str
    message: str
    size_bytes: int | None = None


@dataclass
class MountUploadStatus:
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
    recent_events: list[UploadEvent] = field(default_factory=list)
    active: bool = False
    source: str = "log"  # log | rc | hybrid
    note: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "mount_id": self.mount_id,
            "mount_name": self.mount_name,
            "local_path": self.local_path,
            "status": self.status,
            "rc_enabled": self.rc_enabled,
            "rc_port": self.rc_port,
            "objects": self.objects,
            "in_use": self.in_use,
            "to_upload": self.to_upload,
            "uploading": self.uploading,
            "cache_total_bytes": self.cache_total_bytes,
            "cache_total_display": self.cache_total_display,
            "last_cleaned_at": self.last_cleaned_at,
            "transfer_bytes": self.transfer_bytes,
            "transfer_total_bytes": self.transfer_total_bytes,
            "transfer_percent": self.transfer_percent,
            "transfer_speed_bps": self.transfer_speed_bps,
            "transfer_eta": self.transfer_eta,
            "transfers_done": self.transfers_done,
            "transfers_total": self.transfers_total,
            "errors": self.errors,
            "recent_events": [
                {
                    "time": e.time,
                    "event": e.event,
                    "path": e.path,
                    "message": e.message,
                    "size_bytes": e.size_bytes,
                }
                for e in self.recent_events
            ],
            "active": self.active,
            "source": self.source,
            "note": self.note,
        }


def _read_log_tail(path: Path, max_bytes: int = 1_500_000) -> list[str]:
    if not path.is_file():
        return []
    try:
        size = path.stat().st_size
        with path.open("rb") as f:
            if size > max_bytes:
                f.seek(size - max_bytes)
                f.readline()  # drop partial first line
            data = f.read()
        text = data.decode("utf-8", errors="replace")
        return text.splitlines()
    except OSError as exc:
        logger.warning("read log failed %s: %s", path, exc)
        return []


_MEDIA_EXTS = (".mkv", ".mp4", ".ts", ".m2ts", ".avi", ".mov", ".wmv", ".flv", ".webm", ".iso")

# Higher = more terminal. Intermediate queued/copied must not outrank success.
_EVENT_RANK = {
    "failed": 50,
    "success": 40,
    "uploading": 30,
    "queued": 20,
    "copied": 10,
    "stats": 0,
}


def _is_media_path(path: str) -> bool:
    lower = path.lower()
    return any(lower.endswith(ext) for ext in _MEDIA_EXTS)


def _consolidate_file_events(events: list[UploadEvent]) -> list[UploadEvent]:
    """One row per path: keep final state (success/failed), drop stale queued/copied.

    rclone logs: queuing → Copied (new) → upload succeeded. Showing all three
    looks like stuck "排队" even when upload already finished.
    """
    latest: dict[str, UploadEvent] = {}
    order: list[str] = []
    for e in events:
        prev = latest.get(e.path)
        if prev is None:
            latest[e.path] = e
            order.append(e.path)
            continue
        prev_rank = _EVENT_RANK.get(prev.event, 0)
        new_rank = _EVENT_RANK.get(e.event, 0)
        # Terminal states always win; otherwise later higher/equal rank updates
        if e.event in ("success", "failed") or new_rank >= prev_rank:
            latest[e.path] = e
        # else keep prev (e.g. ignore queued after success — shouldn't happen if chrono)
    return [latest[p] for p in order if p in latest]


def parse_mount_log(lines: list[str], *, max_events: int = 120) -> dict[str, Any]:
    events: list[UploadEvent] = []
    objects = in_use = to_upload = uploading = 0
    cache_total_bytes = 0
    cache_total_display = "0"
    last_cleaned_at: str | None = None
    transfer_bytes = transfer_total = None
    transfer_percent = transfer_speed_bps = None
    transfer_eta = None
    transfers_done = transfers_total = None
    errors = 0

    for line in lines:
        ts = _parse_ts(line)

        m = _RE_CLEANED.search(line)
        if m:
            objects = int(m.group(1))
            in_use = int(m.group(2))
            to_upload = int(m.group(3))
            uploading = int(m.group(4))
            cache_total_display = m.group(5)
            cache_total_bytes = parse_size_to_bytes(cache_total_display) or 0
            last_cleaned_at = ts
            continue

        m = _RE_TRANSFERRED.search(line)
        if m:
            transfer_bytes = parse_size_to_bytes(m.group(1).replace("/s", ""))
            transfer_total = parse_size_to_bytes(m.group(2))
            transfer_percent = float(m.group(3))
            speed = parse_size_to_bytes(m.group(4).replace("/s", "").strip())
            transfer_speed_bps = float(speed) if speed is not None else None
            transfer_eta = m.group(5)
            continue

        m = _RE_TRANSFERS_LINE.search(line)
        if m:
            transfers_done = int(m.group(1))
            transfers_total = int(m.group(2))
            continue

        m = _RE_ERRORS.search(line)
        if m:
            errors = int(m.group(1))
            continue

        for pattern, ev in (
            (_RE_FAILED, "failed"),
            (_RE_SUCCESS, "success"),
            (_RE_QUEUE, "queued"),
            (_RE_COPIED, "copied"),
        ):
            m = pattern.search(line)
            if m:
                path = m.group(1).strip()
                events.append(
                    UploadEvent(
                        time=ts,
                        event=ev,
                        path=path,
                        message=line.split(" : ", 1)[-1].strip() if " : " in line else line.strip(),
                    )
                )
                break

    # Collapse per-file lifecycle: queued → copied → success (do not show stale "排队" after success)
    events = _consolidate_file_events(events)

    # Prefer media files in the UI list, then sidecars; cap length
    media_events = [e for e in events if _is_media_path(e.path)]
    other_events = [e for e in events if not _is_media_path(e.path)]
    keep_media = media_events[-max(40, max_events // 2) :]
    remain = max_events - len(keep_media)
    keep_other = other_events[-remain:] if remain > 0 else []
    # Preserve relative time order among selected (events is chronological)
    selected = set(id(e) for e in keep_media) | set(id(e) for e in keep_other)
    events = [e for e in events if id(e) in selected]
    if len(events) > max_events:
        events = events[-max_events:]
    events = list(reversed(events))  # newest first for UI

    return {
        "objects": objects,
        "in_use": in_use,
        "to_upload": to_upload,
        "uploading": uploading,
        "cache_total_bytes": cache_total_bytes,
        "cache_total_display": cache_total_display,
        "last_cleaned_at": last_cleaned_at,
        "transfer_bytes": transfer_bytes,
        "transfer_total_bytes": transfer_total,
        "transfer_percent": transfer_percent,
        "transfer_speed_bps": transfer_speed_bps,
        "transfer_eta": transfer_eta,
        "transfers_done": transfers_done,
        "transfers_total": transfers_total,
        "errors": errors,
        "events": events,
    }


def query_rclone_rc(port: int, path: str = "core/stats", timeout: float = 1.5) -> dict[str, Any] | None:
    """Call localhost rclone RC (no auth; bound to 127.0.0.1 only)."""
    url = f"http://127.0.0.1:{port}/{path}"
    try:
        req = urllib.request.Request(url, data=b"{}", method="POST")
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return json.loads(body) if body else {}
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        logger.debug("rc %s failed: %s", url, exc)
        return None


def apply_rc_stats(status: MountUploadStatus, stats: dict[str, Any]) -> None:
    """Merge rclone core/stats into status."""
    # bytes transferred this session
    bytes_ = stats.get("bytes")
    if isinstance(bytes_, (int, float)):
        status.transfer_bytes = int(bytes_)
    total = stats.get("totalBytes")
    if isinstance(total, (int, float)) and total > 0:
        status.transfer_total_bytes = int(total)
        if status.transfer_bytes is not None:
            status.transfer_percent = round(100.0 * status.transfer_bytes / total, 1)
    speed = stats.get("speed")
    if isinstance(speed, (int, float)):
        status.transfer_speed_bps = float(speed)
    eta = stats.get("eta")
    if eta is not None:
        try:
            eta_i = int(eta)
            if eta_i >= 0:
                m, s = divmod(eta_i, 60)
                h, m = divmod(m, 60)
                status.transfer_eta = f"{h}h{m}m{s}s" if h else (f"{m}m{s}s" if m else f"{s}s")
        except (TypeError, ValueError):
            status.transfer_eta = str(eta)
    transfers = stats.get("transferring") or []
    if isinstance(transfers, list) and transfers:
        # Prefer live transferring list as "active" events
        live: list[UploadEvent] = []
        for t in transfers[:40]:
            if not isinstance(t, dict):
                continue
            name = t.get("name") or t.get("group") or "transfer"
            size = t.get("size")
            pct = t.get("percentage")
            spd = t.get("speed")
            msg = f"上传中 {pct}% @ {spd} B/s" if pct is not None else "上传中"
            live.append(
                UploadEvent(
                    time=None,
                    event="uploading",
                    path=str(name),
                    message=msg,
                    size_bytes=int(size) if isinstance(size, (int, float)) else None,
                )
            )
        # Prepend live transfers
        status.recent_events = live + status.recent_events
        status.uploading = max(status.uploading, len(transfers))
    err = stats.get("errors")
    if isinstance(err, (int, float)):
        status.errors = int(err)
    status.rc_enabled = True
    status.source = "hybrid" if status.source == "log" else "rc"


def build_mount_upload_status(
    *,
    mount_id: int,
    mount_name: str,
    local_path: str,
    mount_status: str,
    log_path: Path,
    try_rc: bool = True,
    max_events: int = 60,
) -> MountUploadStatus:
    port = rc_port_for_mount(mount_id)
    parsed = parse_mount_log(_read_log_tail(log_path), max_events=max_events)
    st = MountUploadStatus(
        mount_id=mount_id,
        mount_name=mount_name,
        local_path=local_path,
        status=mount_status,
        rc_port=port,
        objects=parsed["objects"],
        in_use=parsed["in_use"],
        to_upload=parsed["to_upload"],
        uploading=parsed["uploading"],
        cache_total_bytes=parsed["cache_total_bytes"],
        cache_total_display=parsed["cache_total_display"],
        last_cleaned_at=parsed["last_cleaned_at"],
        transfer_bytes=parsed["transfer_bytes"],
        transfer_total_bytes=parsed["transfer_total_bytes"],
        transfer_percent=parsed["transfer_percent"],
        transfer_speed_bps=parsed["transfer_speed_bps"],
        transfer_eta=parsed["transfer_eta"],
        transfers_done=parsed["transfers_done"],
        transfers_total=parsed["transfers_total"],
        errors=parsed["errors"],
        recent_events=parsed["events"],
        source="log",
    )

    if try_rc and mount_status == "running":
        rc_stats = query_rclone_rc(port, "core/stats")
        if rc_stats is not None:
            apply_rc_stats(st, rc_stats)
            st.note = None
        else:
            st.rc_enabled = False
            st.note = (
                "当前挂载未开启 rclone RC，进度来自日志解析。"
                "重启挂载后可获得实时传输速度（面板会自动加 --rc）。"
            )
    else:
        st.rc_enabled = False

    st.active = bool(st.to_upload > 0 or st.uploading > 0 or (st.transfer_speed_bps or 0) > 0)
    return st


def summarize_uploads(mounts: list[MountUploadStatus]) -> dict[str, Any]:
    total_to_upload = sum(m.to_upload for m in mounts)
    total_uploading = sum(m.uploading for m in mounts)
    total_errors = sum(m.errors for m in mounts)
    active_mounts = sum(1 for m in mounts if m.active)
    speeds = [m.transfer_speed_bps for m in mounts if m.transfer_speed_bps]
    return {
        "mounts": [m.to_dict() for m in mounts],
        "summary": {
            "to_upload": total_to_upload,
            "uploading": total_uploading,
            "errors": total_errors,
            "active_mounts": active_mounts,
            "total_speed_bps": sum(speeds) if speeds else 0.0,
            "any_active": active_mounts > 0 or total_to_upload > 0 or total_uploading > 0,
        },
    }
