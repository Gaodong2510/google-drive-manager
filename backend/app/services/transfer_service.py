"""Background cross-mount copy jobs with progress + SQLite persistence / resume."""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.database import SessionLocal
from app.models.models import TransferJobRecord
from app.services import files_service
from app.services.rclone_service import get_rclone

logger = logging.getLogger(__name__)

# Multi-line / one-line rclone stats
_STATS_RE = re.compile(
    r"(?:Transferred:\s+)?([0-9.]+\s*[KMGTP]?i?B)\s*/\s*([0-9.]+\s*[KMGTP]?i?B),\s*"
    r"(?:([0-9]+)%|-)"
    r"(?:,\s*([0-9.]+\s*[KMGTP]?i?B/s))?"
    r"(?:,\s*ETA\s*(\S+))?",
    re.I,
)
_FILES_RE = re.compile(
    r"Transferred:\s+(\d+)\s*/\s*(\d+)(?:,\s*(\d+)%)?",
    re.I,
)

# How many finished jobs to keep in DB
_KEEP_FINISHED = 50


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _format_bytes(n: int) -> str:
    if n <= 0:
        return "0 B"
    units = ["B", "KiB", "MiB", "GiB", "TiB"]
    v = float(n)
    i = 0
    while v >= 1024 and i < len(units) - 1:
        v /= 1024
        i += 1
    if i == 0:
        return f"{int(v)} B"
    return f"{v:.2f} {units[i]}"


def _count_sources(paths: list[str], *, max_files: int = 5000) -> tuple[int, int, int]:
    """Return (files, dirs, total_bytes) for local source paths (best-effort, capped)."""
    files = 0
    dirs = 0
    total = 0
    for raw in paths:
        try:
            p = Path(raw)
            if not p.exists():
                continue
            if p.is_file():
                files += 1
                try:
                    total += int(p.stat().st_size)
                except OSError:
                    pass
            elif p.is_dir():
                dirs += 1
                for root, _ds, fs in os.walk(p):
                    for name in fs:
                        if files >= max_files:
                            return files, dirs, total
                        fp = Path(root) / name
                        try:
                            total += int(fp.stat().st_size)
                            files += 1
                        except OSError:
                            continue
        except OSError:
            continue
    return files, dirs, total


def _parse_dt(val: Any) -> datetime | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    try:
        s = str(val).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


@dataclass
class TransferJob:
    id: str
    status: str = "pending"  # pending|running|success|error|cancelled|interrupted
    mode: str = "rclone"
    percent: float = 0.0
    transferred: str = ""
    total: str = ""
    speed: str = ""
    eta: str = ""
    message: str = ""
    error: str = ""
    src_paths: list[str] = field(default_factory=list)
    dest_dir: str = ""
    current_src: str = ""
    items_done: int = 0
    items_total: int = 0
    files_total: int = 0
    files_done: int = 0
    size_bytes: int = 0
    prefer_rclone: bool = True
    mount_snapshot: list[dict] = field(default_factory=list)
    allowed_roots: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=_utcnow)
    updated_at: datetime = field(default_factory=_utcnow)
    finished_at: datetime | None = None
    _cancel: threading.Event = field(default_factory=threading.Event, repr=False)
    _proc: Any = field(default=None, repr=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "status": self.status,
            "mode": self.mode,
            "percent": round(self.percent, 1),
            "transferred": self.transferred,
            "total": self.total,
            "speed": self.speed,
            "eta": self.eta,
            "message": self.message,
            "error": self.error,
            "src_paths": self.src_paths,
            "dest_dir": self.dest_dir,
            "current_src": self.current_src,
            "items_done": self.items_done,
            "items_total": self.items_total,
            "files_total": self.files_total,
            "files_done": self.files_done,
            "size_bytes": self.size_bytes,
            "prefer_rclone": self.prefer_rclone,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "can_close": True,
            "resumable": self.status in ("pending", "running", "interrupted", "error", "cancelled")
            and bool(self.src_paths)
            and bool(self.dest_dir)
            and self.items_done < max(self.items_total, 1),
        }


class TransferService:
    def __init__(self) -> None:
        self._jobs: dict[str, TransferJob] = {}
        self._lock = threading.Lock()
        self._running_threads: dict[str, threading.Thread] = {}
        self._loaded = False

    # ---- persistence -------------------------------------------------

    def _persist(self, job: TransferJob) -> None:
        """Write job state to SQLite (best-effort)."""
        try:
            db = SessionLocal()
            try:
                row = db.get(TransferJobRecord, job.id)
                if not row:
                    row = TransferJobRecord(id=job.id)
                    db.add(row)
                row.status = job.status
                row.mode = job.mode
                row.percent = float(job.percent or 0)
                row.transferred = job.transferred or ""
                row.total = job.total or ""
                row.speed = job.speed or ""
                row.eta = job.eta or ""
                row.message = job.message or ""
                row.error = job.error or ""
                row.src_paths_json = json.dumps(job.src_paths, ensure_ascii=False)
                row.dest_dir = job.dest_dir or ""
                row.current_src = job.current_src or ""
                row.items_done = int(job.items_done or 0)
                row.items_total = int(job.items_total or 0)
                row.files_total = int(job.files_total or 0)
                row.files_done = int(job.files_done or 0)
                row.size_bytes = int(job.size_bytes or 0)
                row.prefer_rclone = bool(job.prefer_rclone)
                row.mounts_json = json.dumps(job.mount_snapshot, ensure_ascii=False)
                row.allowed_roots_json = json.dumps(job.allowed_roots, ensure_ascii=False)
                row.created_at = job.created_at or _utcnow()
                row.updated_at = job.updated_at or _utcnow()
                row.finished_at = job.finished_at
                db.commit()
            finally:
                db.close()
        except Exception:
            logger.exception("persist transfer job %s failed", job.id)

    def _delete_old_finished(self) -> None:
        try:
            db = SessionLocal()
            try:
                finished = (
                    db.query(TransferJobRecord)
                    .filter(TransferJobRecord.status.in_(("success", "error", "cancelled")))
                    .order_by(TransferJobRecord.updated_at.desc())
                    .all()
                )
                for old in finished[_KEEP_FINISHED:]:
                    db.delete(old)
                    with self._lock:
                        self._jobs.pop(old.id, None)
                db.commit()
            finally:
                db.close()
        except Exception:
            logger.exception("prune finished transfer jobs failed")

    def _row_to_job(self, row: TransferJobRecord) -> TransferJob:
        try:
            srcs = json.loads(row.src_paths_json or "[]")
        except Exception:
            srcs = []
        try:
            mounts = json.loads(row.mounts_json or "[]")
        except Exception:
            mounts = []
        try:
            roots = json.loads(row.allowed_roots_json or "[]")
        except Exception:
            roots = []
        return TransferJob(
            id=row.id,
            status=row.status or "pending",
            mode=row.mode or "rclone",
            percent=float(row.percent or 0),
            transferred=row.transferred or "",
            total=row.total or "",
            speed=row.speed or "",
            eta=row.eta or "",
            message=row.message or "",
            error=row.error or "",
            src_paths=list(srcs) if isinstance(srcs, list) else [],
            dest_dir=row.dest_dir or "",
            current_src=row.current_src or "",
            items_done=int(row.items_done or 0),
            items_total=int(row.items_total or 0),
            files_total=int(row.files_total or 0),
            files_done=int(row.files_done or 0),
            size_bytes=int(row.size_bytes or 0),
            prefer_rclone=bool(row.prefer_rclone if row.prefer_rclone is not None else True),
            mount_snapshot=list(mounts) if isinstance(mounts, list) else [],
            allowed_roots=list(roots) if isinstance(roots, list) else [],
            created_at=_parse_dt(row.created_at) or _utcnow(),
            updated_at=_parse_dt(row.updated_at) or _utcnow(),
            finished_at=_parse_dt(row.finished_at),
        )

    def load_from_db(self) -> None:
        """Load recent jobs into memory (call once after init_db)."""
        if self._loaded:
            return
        try:
            db = SessionLocal()
            try:
                rows = (
                    db.query(TransferJobRecord)
                    .order_by(TransferJobRecord.updated_at.desc())
                    .limit(80)
                    .all()
                )
                with self._lock:
                    for row in rows:
                        # Mark stale running/pending as interrupted until resume
                        if row.status in ("running", "pending"):
                            row.status = "interrupted"
                            row.message = (row.message or "") + " · 服务曾重启，可续传"
                            row.updated_at = _utcnow()
                        job = self._row_to_job(row)
                        if row.status == "interrupted":
                            job.status = "interrupted"
                        self._jobs[job.id] = job
                    db.commit()
                self._loaded = True
                logger.info("Loaded %d transfer jobs from DB", len(rows))
            finally:
                db.close()
        except Exception:
            logger.exception("load transfer jobs from DB failed")
            self._loaded = True

    # ---- public API --------------------------------------------------

    def get(self, job_id: str) -> TransferJob | None:
        with self._lock:
            j = self._jobs.get(job_id)
            if j:
                return j
        # fallback DB
        try:
            db = SessionLocal()
            try:
                row = db.get(TransferJobRecord, job_id)
                if not row:
                    return None
                job = self._row_to_job(row)
                with self._lock:
                    self._jobs[job.id] = job
                return job
            finally:
                db.close()
        except Exception:
            return None

    def list_active(self) -> list[TransferJob]:
        with self._lock:
            return [j for j in self._jobs.values() if j.status in ("pending", "running")]

    def list_recent(self, limit: int = 30) -> list[TransferJob]:
        # Merge DB rows so restart / external writes stay visible in UI
        try:
            db = SessionLocal()
            try:
                rows = (
                    db.query(TransferJobRecord)
                    .order_by(TransferJobRecord.updated_at.desc())
                    .limit(max(limit * 2, 40))
                    .all()
                )
                with self._lock:
                    for row in rows:
                        mem = self._jobs.get(row.id)
                        if mem and mem.status in ("pending", "running"):
                            continue
                        self._jobs[row.id] = self._row_to_job(row)
            finally:
                db.close()
        except Exception:
            logger.exception("list_recent DB merge failed")
        with self._lock:
            jobs = list(self._jobs.values())
        jobs.sort(
            key=lambda j: (
                0 if j.status in ("pending", "running", "interrupted") else 1,
                -(j.updated_at.timestamp() if j.updated_at else 0),
            )
        )
        return jobs[: max(1, limit)]

    def _touch(self, job: TransferJob, **kwargs: Any) -> None:
        for k, v in kwargs.items():
            setattr(job, k, v)
        job.updated_at = _utcnow()
        self._persist(job)

    def start(
        self,
        *,
        src_paths: list[str],
        dest_dir: str,
        mounts: list[Any],
        allowed_roots: list[str],
        prefer_rclone: bool = True,
        job_id: str | None = None,
        resume_from: int = 0,
        existing_message: str | None = None,
    ) -> TransferJob:
        dest = files_service.ensure_within_roots(dest_dir, allowed_roots)
        if not dest.exists() or not dest.is_dir():
            raise ValueError(f"目标目录不存在: {dest_dir}")
        for src in src_paths:
            sp = files_service.ensure_within_roots(src, allowed_roots)
            if not sp.exists():
                raise FileNotFoundError(f"源不存在: {src}")

        n_files, n_dirs, size_bytes = _count_sources(src_paths)
        size_label = _format_bytes(size_bytes) if size_bytes else "—"
        mount_snapshot = []
        for m in mounts:
            acc = getattr(m, "account", None)
            if isinstance(m, dict):
                mount_snapshot.append(m)
            else:
                mount_snapshot.append(
                    {
                        "local_path": m.local_path,
                        "remote_path": m.remote_path or "",
                        "remote_name": acc.remote_name if acc else None,
                        "name": m.name,
                    }
                )

        jid = job_id or uuid.uuid4().hex[:16]
        with self._lock:
            existing = self._jobs.get(jid)
            if existing and existing.status in ("pending", "running"):
                # already running
                return existing

        start_idx = max(0, min(resume_from, len(src_paths)))
        msg = existing_message or (
            f"任务已排队… {n_files} 个文件 · 共 {size_label}"
            + (f" · {n_dirs} 个文件夹" if n_dirs else "")
        )
        if start_idx > 0:
            msg = f"续传排队… 从第 {start_idx + 1}/{len(src_paths)} 项继续 · 共 {size_label}"

        job = TransferJob(
            id=jid,
            status="pending",
            src_paths=list(src_paths),
            dest_dir=str(dest),
            items_total=len(src_paths),
            items_done=start_idx,
            files_total=n_files,
            size_bytes=size_bytes,
            total=size_label if size_bytes else "",
            message=msg,
            prefer_rclone=prefer_rclone,
            mount_snapshot=mount_snapshot,
            allowed_roots=list(allowed_roots),
            percent=min(99.0, (start_idx / max(len(src_paths), 1)) * 100),
        )
        with self._lock:
            self._jobs[job.id] = job
        self._persist(job)
        self._delete_old_finished()

        t = threading.Thread(
            target=self._run_job,
            args=(job.id,),
            name=f"gdm-transfer-{job.id}",
            daemon=True,
        )
        with self._lock:
            self._running_threads[job.id] = t
        t.start()
        return job

    def resume(
        self,
        job_id: str,
        *,
        mounts: list[Any] | None = None,
        allowed_roots: list[str] | None = None,
    ) -> TransferJob:
        """Resume an interrupted / failed / cancelled job from items_done."""
        job = self.get(job_id)
        if not job:
            raise FileNotFoundError("任务不存在")
        if job.status in ("pending", "running"):
            return job
        if not job.src_paths or not job.dest_dir:
            raise ValueError("任务缺少源/目标，无法续传")

        # Refresh mount snapshot if provided
        if mounts is not None:
            snap = []
            for m in mounts:
                acc = getattr(m, "account", None)
                if isinstance(m, dict):
                    snap.append(m)
                else:
                    snap.append(
                        {
                            "local_path": m.local_path,
                            "remote_path": m.remote_path or "",
                            "remote_name": acc.remote_name if acc else None,
                            "name": m.name,
                        }
                    )
            job.mount_snapshot = snap
        if allowed_roots is not None:
            job.allowed_roots = list(allowed_roots)

        if not job.mount_snapshot:
            raise ValueError("缺少挂载快照，无法续传（请重新选择文件发起复制）")
        if not job.allowed_roots:
            job.allowed_roots = [m.get("local_path") for m in job.mount_snapshot if m.get("local_path")]

        job._cancel = threading.Event()
        job._proc = None
        job.error = ""
        job.finished_at = None
        job.speed = ""
        job.eta = ""
        # items_done is the next index to process (or current incomplete)
        start_idx = max(0, min(job.items_done, len(job.src_paths)))
        return self.start(
            src_paths=job.src_paths,
            dest_dir=job.dest_dir,
            mounts=job.mount_snapshot,
            allowed_roots=job.allowed_roots,
            prefer_rclone=job.prefer_rclone,
            job_id=job.id,
            resume_from=start_idx,
            existing_message=f"断点续传… 从第 {start_idx + 1}/{len(job.src_paths)} 项 · 已完成文件将跳过",
        )

    def cancel(self, job_id: str) -> TransferJob | None:
        job = self.get(job_id)
        if not job:
            return None
        job._cancel.set()
        proc = job._proc
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
        if job.status in ("pending", "running", "interrupted"):
            self._touch(job, status="cancelled", message="已取消", finished_at=_utcnow())
        return job

    def resume_interrupted_on_boot(self) -> int:
        """After mounts are ready, auto-resume interrupted jobs. Returns count started."""
        self.load_from_db()
        to_resume: list[str] = []
        with self._lock:
            for j in self._jobs.values():
                if j.status == "interrupted" and j.src_paths and j.dest_dir:
                    to_resume.append(j.id)
        count = 0
        for jid in to_resume:
            try:
                from sqlalchemy.orm import joinedload
                from app.models.models import MountPoint

                db = SessionLocal()
                try:
                    mounts = (
                        db.query(MountPoint).options(joinedload(MountPoint.account)).all()
                    )
                    snap = []
                    for m in mounts:
                        acc = m.account
                        snap.append(
                            {
                                "local_path": m.local_path,
                                "remote_path": m.remote_path or "",
                                "remote_name": acc.remote_name if acc else None,
                                "name": m.name,
                            }
                        )
                    roots = [m.local_path for m in mounts]
                    self.resume(jid, mounts=snap, allowed_roots=roots)
                    count += 1
                    logger.info("Auto-resumed transfer job %s", jid)
                finally:
                    db.close()
            except Exception:
                logger.exception("Auto-resume job %s failed", jid)
                job = self.get(jid)
                if job:
                    self._touch(
                        job,
                        status="interrupted",
                        message=f"自动续传失败，请手动重试: {job.error or job.message}",
                    )
        return count

    def seed_job(
        self,
        *,
        job_id: str,
        src_paths: list[str],
        dest_dir: str,
        items_done: int = 0,
        message: str = "",
        mounts: list[Any] | None = None,
        allowed_roots: list[str] | None = None,
        auto_start: bool = True,
    ) -> TransferJob:
        """Insert a recovered job (e.g. from journal after crash without persistence)."""
        snap: list[dict] = []
        if mounts:
            for m in mounts:
                acc = getattr(m, "account", None)
                if isinstance(m, dict):
                    snap.append(m)
                else:
                    snap.append(
                        {
                            "local_path": m.local_path,
                            "remote_path": getattr(m, "remote_path", "") or "",
                            "remote_name": acc.remote_name if acc else None,
                            "name": m.name,
                        }
                    )
        roots = list(allowed_roots or [s.get("local_path") for s in snap if s.get("local_path")])
        n_files, _n_dirs, size_bytes = _count_sources(src_paths)
        job = TransferJob(
            id=job_id,
            status="interrupted",
            src_paths=list(src_paths),
            dest_dir=dest_dir,
            items_done=items_done,
            items_total=len(src_paths),
            files_total=n_files,
            size_bytes=size_bytes,
            total=_format_bytes(size_bytes) if size_bytes else "",
            message=message or "已从中断状态恢复，等待续传",
            mount_snapshot=snap,
            allowed_roots=roots,
            percent=min(99.0, (items_done / max(len(src_paths), 1)) * 100),
        )
        with self._lock:
            self._jobs[job.id] = job
        self._persist(job)
        if auto_start:
            return self.resume(job_id, mounts=mounts, allowed_roots=roots)
        return job

    # ---- runner ------------------------------------------------------

    def _run_job(self, job_id: str) -> None:
        job = self.get(job_id)
        if not job:
            return
        start_idx = max(0, min(job.items_done, len(job.src_paths)))
        self._touch(
            job,
            status="running",
            message=f"开始复制… 从第 {start_idx + 1}/{job.items_total} 项"
            if start_idx
            else "开始复制…",
            finished_at=None,
            error="",
        )

        class _Snap:
            def __init__(self, d: dict):
                self.local_path = d["local_path"]
                self.remote_path = d.get("remote_path") or ""
                self.name = d.get("name") or ""

                class A:
                    pass

                a = A()
                a.remote_name = d.get("remote_name")
                self.account = a if d.get("remote_name") else None

        mounts = [_Snap(d) for d in (job.mount_snapshot or [])]
        rclone = get_rclone()
        dest = Path(job.dest_dir)
        allowed_roots = job.allowed_roots or []
        prefer_rclone = job.prefer_rclone

        try:
            for idx in range(start_idx, len(job.src_paths)):
                if job._cancel.is_set():
                    self._touch(job, status="cancelled", message="已取消", finished_at=_utcnow())
                    return

                src = job.src_paths[idx]
                sp = files_service.ensure_within_roots(src, allowed_roots)
                self._touch(
                    job,
                    current_src=src,
                    items_done=idx,
                    message=f"正在复制 ({idx + 1}/{job.items_total}): {sp.name}",
                    percent=min(99.0, (idx / max(job.items_total, 1)) * 100),
                )

                src_remote, src_rel, _ = files_service.local_path_to_remote(str(sp), mounts)
                dest_remote, dest_rel, _ = files_service.local_path_to_remote(str(dest), mounts)
                name = sp.name

                if prefer_rclone and src_remote and dest_remote and rclone.is_installed():
                    if sp.is_dir():
                        src_spec = f"{src_remote}:{src_rel}" if src_rel else f"{src_remote}:"
                        dst_rel = f"{dest_rel}/{name}".strip("/") if dest_rel else name
                        dst_spec = f"{dest_remote}:{dst_rel}"
                    else:
                        src_spec = f"{src_remote}:{src_rel}"
                        dst_spec = f"{dest_remote}:{dest_rel}" if dest_rel else f"{dest_remote}:"

                    ok = self._rclone_copy_with_progress(job, src_spec, dst_spec, item_index=idx)
                    if not ok:
                        if job._cancel.is_set():
                            self._touch(
                                job, status="cancelled", message="已取消", finished_at=_utcnow()
                            )
                            return
                        self._touch(
                            job, mode="local", message=f"rclone 失败，改用本地复制: {sp.name}"
                        )
                        files_service._local_copy(sp, dest / name)
                else:
                    self._touch(job, mode="local", message=f"本地复制: {sp.name}")
                    files_service._local_copy(sp, dest / name)

                base = (idx + 1) / max(job.items_total, 1) * 100
                self._touch(job, items_done=idx + 1, percent=min(99.5, base))

            self._touch(
                job,
                status="success",
                percent=100.0,
                message=f"完成：{job.items_total} 项 → {job.dest_dir}",
                finished_at=_utcnow(),
                current_src="",
            )
        except Exception as exc:
            logger.exception("transfer job %s failed", job_id)
            self._touch(
                job,
                status="error",
                error=str(exc)[:800],
                message=f"失败: {exc}（可断点续传）",
                finished_at=_utcnow(),
            )
        finally:
            with self._lock:
                self._running_threads.pop(job_id, None)

    def _rclone_copy_with_progress(
        self,
        job: TransferJob,
        src_spec: str,
        dst_spec: str,
        *,
        item_index: int,
    ) -> bool:
        binary = get_rclone().find_binary()
        if not binary:
            return False
        cfg = str(get_rclone().config_path)
        # size-only: skip files already complete at dest (resume-friendly across remotes)
        args = [
            binary,
            "copy",
            src_spec,
            dst_spec,
            "--config",
            cfg,
            "--transfers",
            "4",
            "--checkers",
            "8",
            "--retries",
            "5",
            "--low-level-retries",
            "10",
            "--size-only",
            "--stats",
            "1s",
            "--stats-one-line",
            "--stats-unit",
            "bytes",
            "-v",
        ]
        env = get_rclone().env_with_config()
        logger.info("transfer %s: rclone %s → %s", job.id, src_spec, dst_spec)

        try:
            proc = subprocess.Popen(
                args,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                env=env,
                bufsize=1,
            )
        except Exception as exc:
            self._touch(job, error=str(exc)[:500])
            return False

        job._proc = proc
        item_base = item_index / max(job.items_total, 1) * 100
        item_span = 100 / max(job.items_total, 1)

        assert proc.stdout is not None
        last_lines: list[str] = []
        for line in proc.stdout:
            if job._cancel.is_set():
                try:
                    proc.terminate()
                except Exception:
                    pass
                break
            line = line.rstrip()
            if not line:
                continue
            last_lines.append(line)
            if len(last_lines) > 40:
                last_lines = last_lines[-40:]

            m = _STATS_RE.search(line)
            if m and "B" in (m.group(1) or "").upper():
                transferred, total, pct_s, speed, eta = m.groups()
                try:
                    item_pct = float(pct_s) if pct_s is not None else 0.0
                except ValueError:
                    item_pct = 0.0
                overall = item_base + (item_pct / 100.0) * item_span
                eta_s = (eta or "").strip()
                if eta_s in ("-", ""):
                    eta_s = ""
                files_hint = ""
                if job.files_total > 0:
                    files_hint = f" · {job.files_total} 个文件 · 共 {_format_bytes(job.size_bytes)}"
                self._touch(
                    job,
                    mode="rclone",
                    transferred=transferred.strip(),
                    total=total.strip(),
                    speed=(speed or "").strip(),
                    eta=eta_s,
                    percent=min(99.5, overall),
                    message=f"复制中 ({job.items_done + 1}/{job.items_total}) {item_pct:.0f}%{files_hint}",
                )
                continue
            fm = _FILES_RE.search(line)
            if fm:
                try:
                    done_f = int(fm.group(1))
                    total_f = int(fm.group(2))
                except (TypeError, ValueError):
                    continue
                self._touch(
                    job,
                    files_done=done_f,
                    files_total=max(job.files_total, total_f),
                )

        code = proc.wait()
        job._proc = None
        if job._cancel.is_set():
            return False
        if code != 0:
            err = "\n".join(last_lines[-8:])[:600]
            self._touch(job, error=err or f"rclone exit {code}")
            logger.warning("rclone copy failed job=%s code=%s: %s", job.id, code, err[:200])
            return False
        return True


_transfer_service: TransferService | None = None


def get_transfer_service() -> TransferService:
    global _transfer_service
    if _transfer_service is None:
        _transfer_service = TransferService()
    return _transfer_service
