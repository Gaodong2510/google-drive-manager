"""Background cross-mount copy jobs with rclone progress polling."""

from __future__ import annotations

import logging
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.services import files_service
from app.services.rclone_service import get_rclone

logger = logging.getLogger(__name__)

# Multi-line:  Transferred:   	  123.456 MiB / 1.234 GiB, 10%, 12.345 MiB/s, ETA 1m2s
# One-line:             6 B / 6 B, 100%, 0 B/s, ETA -
# Percent may be "-" when total unknown; ETA may be "-"
_STATS_RE = re.compile(
    r"(?:Transferred:\s+)?([0-9.]+\s*[KMGTP]?i?B)\s*/\s*([0-9.]+\s*[KMGTP]?i?B),\s*"
    r"(?:([0-9]+)%|-)"
    r"(?:,\s*([0-9.]+\s*[KMGTP]?i?B/s))?"
    r"(?:,\s*ETA\s*(\S+))?",
    re.I,
)
# File count line: Transferred:            5 / 12, 41%
_FILES_RE = re.compile(
    r"Transferred:\s+(\d+)\s*/\s*(\d+)(?:,\s*(\d+)%)?",
    re.I,
)


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


@dataclass
class TransferJob:
    id: str
    status: str = "pending"  # pending|running|success|error|cancelled
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
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "can_close": True,  # UI hint: safe to close modal; job keeps running
        }


class TransferService:
    def __init__(self) -> None:
        self._jobs: dict[str, TransferJob] = {}
        self._lock = threading.Lock()

    def get(self, job_id: str) -> TransferJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list_active(self) -> list[TransferJob]:
        with self._lock:
            return [j for j in self._jobs.values() if j.status in ("pending", "running")]

    def list_recent(self, limit: int = 30) -> list[TransferJob]:
        """Active jobs first, then recently updated finished jobs (newest first)."""
        with self._lock:
            jobs = list(self._jobs.values())
        jobs.sort(
            key=lambda j: (
                0 if j.status in ("pending", "running") else 1,
                -(j.updated_at.timestamp() if j.updated_at else 0),
            )
        )
        return jobs[: max(1, limit)]

    def _touch(self, job: TransferJob, **kwargs: Any) -> None:
        for k, v in kwargs.items():
            setattr(job, k, v)
        job.updated_at = _utcnow()

    def start(
        self,
        *,
        src_paths: list[str],
        dest_dir: str,
        mounts: list[Any],
        allowed_roots: list[str],
        prefer_rclone: bool = True,
    ) -> TransferJob:
        # Validate early
        dest = files_service.ensure_within_roots(dest_dir, allowed_roots)
        if not dest.exists() or not dest.is_dir():
            raise ValueError(f"目标目录不存在: {dest_dir}")
        for src in src_paths:
            sp = files_service.ensure_within_roots(src, allowed_roots)
            if not sp.exists():
                raise FileNotFoundError(f"源不存在: {src}")

        n_files, n_dirs, size_bytes = _count_sources(src_paths)
        size_label = _format_bytes(size_bytes) if size_bytes else "—"
        job = TransferJob(
            id=uuid.uuid4().hex[:16],
            status="pending",
            src_paths=list(src_paths),
            dest_dir=str(dest),
            items_total=len(src_paths),
            files_total=n_files,
            size_bytes=size_bytes,
            total=size_label if size_bytes else "",
            message=f"任务已排队… {n_files} 个文件 · 共 {size_label}"
            + (f" · {n_dirs} 个文件夹" if n_dirs else ""),
        )
        with self._lock:
            self._jobs[job.id] = job
            # prune old finished jobs (keep last 30)
            finished = [j for j in self._jobs.values() if j.status in ("success", "error", "cancelled")]
            finished.sort(key=lambda j: j.created_at)
            for old in finished[:-30]:
                self._jobs.pop(old.id, None)

        # Snapshot mount info for thread (ORM objects may expire)
        mount_snapshot = []
        for m in mounts:
            acc = m.account
            mount_snapshot.append(
                {
                    "local_path": m.local_path,
                    "remote_path": m.remote_path or "",
                    "remote_name": acc.remote_name if acc else None,
                    "name": m.name,
                }
            )

        t = threading.Thread(
            target=self._run_job,
            args=(job.id, mount_snapshot, allowed_roots, prefer_rclone),
            name=f"gdm-transfer-{job.id}",
            daemon=True,
        )
        t.start()
        return job

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
        if job.status in ("pending", "running"):
            self._touch(job, status="cancelled", message="已取消", finished_at=_utcnow())
        return job

    def _run_job(
        self,
        job_id: str,
        mount_snapshot: list[dict],
        allowed_roots: list[str],
        prefer_rclone: bool,
    ) -> None:
        job = self.get(job_id)
        if not job:
            return
        self._touch(job, status="running", message="开始复制…", percent=0)

        class _Snap:
            def __init__(self, d: dict):
                self.local_path = d["local_path"]
                self.remote_path = d["remote_path"]
                self.name = d["name"]

                class A:
                    pass

                a = A()
                a.remote_name = d["remote_name"]
                self.account = a if d["remote_name"] else None

        mounts = [_Snap(d) for d in mount_snapshot]
        rclone = get_rclone()
        dest = Path(job.dest_dir)

        try:
            for idx, src in enumerate(job.src_paths):
                if job._cancel.is_set():
                    self._touch(job, status="cancelled", message="已取消", finished_at=_utcnow())
                    return

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
                            self._touch(job, status="cancelled", message="已取消", finished_at=_utcnow())
                            return
                        # fallback local
                        self._touch(job, mode="local", message=f"rclone 失败，改用本地复制: {sp.name}")
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
                message=f"失败: {exc}",
                finished_at=_utcnow(),
            )

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
            "--stats",
            "1s",
            "--stats-one-line",
            "--stats-unit",
            "bytes",
            "-v",
        ]
        env = get_rclone().env_with_config()
        logger.info("transfer %s: rclone %s → %s", job.id, src_spec, dst_spec)

        import subprocess

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

            # Prefer byte transfer lines (have unit B); skip pure file-count lines
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
                # Multi-line stats: "Transferred: N / M" is file count (no unit)
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
