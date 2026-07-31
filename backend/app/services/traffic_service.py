"""Local daily traffic accounting for rclone mounts (Asia/Shanghai midnight reset).

Source of truth: rclone RC ``core/stats`` ``bytes`` field (session-cumulative).
We sample periodically, convert session deltas into per-day totals. Day boundary
is Beijing time (Asia/Shanghai) 00:00 — not Google quota, local monitoring only.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models.models import DriveAccount, MountPoint, MountTrafficDaily, MountTrafficState
from app.services.upload_monitor import query_rclone_rc, rc_port_for_mount

logger = logging.getLogger(__name__)

TZ_SHANGHAI = ZoneInfo("Asia/Shanghai")
# Keep this many days of history (including today)
HISTORY_DAYS = 30


def beijing_now() -> datetime:
    return datetime.now(TZ_SHANGHAI)


def beijing_today_str(now: datetime | None = None) -> str:
    n = now or beijing_now()
    if n.tzinfo is None:
        n = n.replace(tzinfo=timezone.utc).astimezone(TZ_SHANGHAI)
    else:
        n = n.astimezone(TZ_SHANGHAI)
    return n.date().isoformat()


def next_beijing_midnight(now: datetime | None = None) -> datetime:
    n = now or beijing_now()
    if n.tzinfo is None:
        n = n.replace(tzinfo=timezone.utc).astimezone(TZ_SHANGHAI)
    else:
        n = n.astimezone(TZ_SHANGHAI)
    tomorrow = n.date() + timedelta(days=1)
    return datetime(tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, 0, tzinfo=TZ_SHANGHAI)


def seconds_until_reset(now: datetime | None = None) -> int:
    n = now or beijing_now()
    if n.tzinfo is None:
        n = n.replace(tzinfo=timezone.utc).astimezone(TZ_SHANGHAI)
    else:
        n = n.astimezone(TZ_SHANGHAI)
    delta = next_beijing_midnight(n) - n
    return max(0, int(delta.total_seconds()))


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _get_or_create_state(db: Session, mount_id: int) -> MountTrafficState:
    st = db.query(MountTrafficState).filter(MountTrafficState.mount_id == mount_id).first()
    if not st:
        st = MountTrafficState(
            mount_id=mount_id,
            last_session_bytes=0,
            last_pid=None,
            last_sample_at=None,
            last_day=None,
        )
        db.add(st)
        db.flush()
    return st


def _get_or_create_daily(db: Session, mount_id: int, day: str) -> MountTrafficDaily:
    row = (
        db.query(MountTrafficDaily)
        .filter(MountTrafficDaily.mount_id == mount_id, MountTrafficDaily.day == day)
        .first()
    )
    if not row:
        row = MountTrafficDaily(mount_id=mount_id, day=day, bytes_total=0, sample_count=0)
        db.add(row)
        db.flush()
    return row


def _session_bytes_from_rc(mount_id: int) -> int | None:
    port = rc_port_for_mount(mount_id)
    stats = query_rclone_rc(port, "core/stats", timeout=1.2)
    if not stats:
        return None
    b = stats.get("bytes")
    if isinstance(b, (int, float)) and b >= 0:
        return int(b)
    return None


def sample_mount(db: Session, mount: MountPoint, *, day: str | None = None) -> dict[str, Any]:
    """Sample one mount: convert session byte growth into today's total."""
    today = day or beijing_today_str()
    mid = int(mount.id)
    state = _get_or_create_state(db, mid)
    daily = _get_or_create_daily(db, mid, today)

    session_bytes = _session_bytes_from_rc(mid)
    rc_ok = session_bytes is not None
    if session_bytes is None:
        # Mount stopped / RC unavailable — keep last baseline so we don't double-count on restart
        session_bytes = int(state.last_session_bytes or 0)

    delta = 0
    first_sample = state.last_sample_at is None and (state.last_session_bytes or 0) == 0
    pid_changed = (
        mount.pid is not None
        and state.last_pid is not None
        and int(mount.pid) != int(state.last_pid)
    )

    if first_sample:
        # Baseline only — do not dump entire multi-day session into "today"
        delta = 0
    elif not rc_ok:
        delta = 0
    elif pid_changed or session_bytes < int(state.last_session_bytes or 0):
        # Process restarted (counter reset). Count only bytes since new process started.
        delta = int(session_bytes)
    else:
        delta = int(session_bytes) - int(state.last_session_bytes or 0)

    if delta < 0:
        delta = 0

    if delta > 0:
        daily.bytes_total = int(daily.bytes_total or 0) + delta
    daily.sample_count = int(daily.sample_count or 0) + 1
    daily.updated_at = _utcnow()

    state.last_session_bytes = int(session_bytes)
    state.last_pid = mount.pid
    state.last_sample_at = _utcnow()
    state.last_day = today
    state.updated_at = _utcnow()

    db.add(daily)
    db.add(state)

    return {
        "mount_id": mid,
        "day": today,
        "delta": delta,
        "today_bytes": int(daily.bytes_total or 0),
        "session_bytes": int(session_bytes),
        "rc_ok": rc_ok,
    }


def sample_all_mounts(db: Session) -> dict[str, Any]:
    """Sample all mounts and prune old history. Safe to call from watchdog."""
    today = beijing_today_str()
    mounts = db.query(MountPoint).order_by(MountPoint.id.asc()).all()
    results = []
    for m in mounts:
        try:
            results.append(sample_mount(db, m, day=today))
        except Exception:
            logger.exception("traffic sample failed for mount %s", m.id)
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("traffic sample commit failed")
        raise
    prune_old_days(db, keep_days=HISTORY_DAYS)
    return {"day": today, "mounts": results, "sampled": len(results)}


def prune_old_days(db: Session, keep_days: int = HISTORY_DAYS) -> int:
    today = beijing_now().date()
    cutoff = (today - timedelta(days=max(1, keep_days) - 1)).isoformat()
    q = db.query(MountTrafficDaily).filter(MountTrafficDaily.day < cutoff)
    n = q.count()
    if n:
        q.delete(synchronize_session=False)
        db.commit()
    return n


def reset_today(db: Session, mount_id: int | None = None) -> dict[str, Any]:
    """Manually zero today's local counters (does not affect rclone session bytes)."""
    today = beijing_today_str()
    q = db.query(MountTrafficDaily).filter(MountTrafficDaily.day == today)
    if mount_id is not None:
        q = q.filter(MountTrafficDaily.mount_id == int(mount_id))
    rows = q.all()
    for r in rows:
        r.bytes_total = 0
        r.sample_count = 0
        r.updated_at = _utcnow()
        db.add(r)
    # Ensure rows exist for all mounts even if never sampled
    mounts = db.query(MountPoint).all()
    for m in mounts:
        if mount_id is not None and int(m.id) != int(mount_id):
            continue
        _get_or_create_daily(db, int(m.id), today)
        # Re-baseline session so next sample doesn't re-add the whole session
        st = _get_or_create_state(db, int(m.id))
        cur = _session_bytes_from_rc(int(m.id))
        if cur is not None:
            st.last_session_bytes = cur
            st.last_pid = m.pid
        st.last_sample_at = _utcnow()
        st.last_day = today
        st.updated_at = _utcnow()
        db.add(st)
    db.commit()
    return get_traffic_summary(db)


def get_traffic_summary(db: Session) -> dict[str, Any]:
    today = beijing_today_str()
    now = beijing_now()
    mounts = db.query(MountPoint).order_by(MountPoint.id.asc()).all()
    accounts = {a.id: a for a in db.query(DriveAccount).all()}
    daily_map = {
        (r.mount_id): r
        for r in db.query(MountTrafficDaily).filter(MountTrafficDaily.day == today).all()
    }
    state_map = {s.mount_id: s for s in db.query(MountTrafficState).all()}

    items: list[dict[str, Any]] = []
    total_today = 0
    total_session = 0
    for m in mounts:
        acc = accounts.get(m.account_id)
        daily = daily_map.get(m.id)
        state = state_map.get(m.id)
        today_b = int(daily.bytes_total or 0) if daily else 0
        # Prefer live RC session; fall back to last known
        live = _session_bytes_from_rc(int(m.id)) if m.status == "running" else None
        session_b = int(live if live is not None else (state.last_session_bytes if state else 0) or 0)
        total_today += today_b
        total_session += session_b
        items.append(
            {
                "mount_id": m.id,
                "mount_name": m.name,
                "account_id": m.account_id,
                "account_name": acc.name if acc else None,
                "provider": (getattr(acc, "provider", None) or "drive") if acc else "drive",
                "team_drive": bool(acc.team_drive) if acc else False,
                "status": m.status,
                "today_bytes": today_b,
                "session_bytes": session_b,
                "rc_ok": live is not None,
                "last_sample_at": state.last_sample_at.isoformat() if state and state.last_sample_at else None,
            }
        )

    # Recent history totals (all mounts summed per day)
    hist_rows = (
        db.query(MountTrafficDaily)
        .filter(MountTrafficDaily.day <= today)
        .order_by(MountTrafficDaily.day.desc())
        .all()
    )
    by_day: dict[str, int] = {}
    for r in hist_rows:
        by_day[r.day] = by_day.get(r.day, 0) + int(r.bytes_total or 0)
    history = [{"day": d, "bytes_total": by_day[d]} for d in sorted(by_day.keys(), reverse=True)[:14]]

    next_reset = next_beijing_midnight(now)
    return {
        "timezone": "Asia/Shanghai",
        "day": today,
        "today_bytes": total_today,
        "session_bytes": total_session,
        "next_reset_at": next_reset.isoformat(),
        "seconds_until_reset": seconds_until_reset(now),
        "note": "本地统计：按 rclone 会话传输增量累计，每天北京时间 00:00 自动换日清零。",
        "mounts": items,
        "history": history,
    }
