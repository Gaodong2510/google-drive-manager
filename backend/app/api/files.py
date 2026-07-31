"""File browser API over local mounts."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import decode_access_token
from app.models.models import MountPoint, User
from app.schemas.schemas import (
    BrowseResponse,
    FileCopyRequest,
    FileCopyResponse,
    MessageOut,
    TransferJobOut,
)
from app.services import files_service
from app.services.task_logger import log_task
from app.services.transfer_service import get_transfer_service

router = APIRouter(prefix="/files", tags=["files"])
_bearer = HTTPBearer(auto_error=False)


def _roots(db: Session) -> list[str]:
    return [m.local_path for m in db.query(MountPoint).all()]


def _user_from_token_or_bearer(
    db: Session,
    creds: HTTPAuthorizationCredentials | None,
    token: str | None,
) -> User:
    """Allow Authorization header or ?token= for media tags (img/video/audio)."""
    raw = None
    if creds and creds.credentials:
        raw = creds.credentials
    elif token:
        raw = token.strip()
    if not raw:
        raise HTTPException(status_code=401, detail="未登录或令牌无效")
    payload = decode_access_token(raw)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="令牌无效或已过期")
    user = db.query(User).filter(User.username == payload["sub"]).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="用户不存在或已禁用")
    return user


@router.get("/roots")
def list_roots(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    mounts = db.query(MountPoint).order_by(MountPoint.id).all()
    return [
        {
            "id": m.id,
            "name": m.name,
            "path": m.local_path,
            "status": m.status,
            "account_name": m.account.name if m.account else None,
            "provider": (getattr(m.account, "provider", None) or "drive") if m.account else "drive",
            "remote_path": m.remote_path or "",
            "team_drive": bool(getattr(m.account, "team_drive", False)) if m.account else False,
            "remote_name": m.account.remote_name if m.account else None,
        }
        for m in mounts
    ]


@router.get("/browse", response_model=BrowseResponse)
def browse(
    path: str = Query(...),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    search: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    try:
        data = files_service.browse(path, _roots(db), sort_by=sort_by, sort_dir=sort_dir, search=search)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
    return data


@router.post("/mkdir", response_model=MessageOut)
def mkdir(
    path: str = Query(...),
    name: str = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    try:
        target = files_service.mkdir(path, name, _roots(db))
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return MessageOut(message="文件夹已创建", detail={"path": target})


@router.delete("", response_model=MessageOut)
def delete_file(
    path: str = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    settings = get_settings()
    try:
        files_service.remove_path(path, _roots(db), allow_delete=settings.allow_file_delete)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return MessageOut(message="已删除")


@router.post("/copy", response_model=FileCopyResponse)
def copy_files(
    body: FileCopyRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    跨挂载复制：优先 rclone remote→remote（几乎不占服务器整文件磁盘）。
    默认 async_job=true：立即返回 job_id，前端轮询进度；可关闭弹窗，任务仍在后台跑。
    """
    mounts = db.query(MountPoint).all()
    roots = [m.local_path for m in mounts]

    if body.async_job:
        try:
            job = get_transfer_service().start(
                src_paths=body.src_paths,
                dest_dir=body.dest_dir,
                mounts=mounts,
                allowed_roots=roots,
                prefer_rclone=body.prefer_rclone,
            )
        except PermissionError as exc:
            raise HTTPException(403, str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(404, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(500, str(exc)) from exc

        log_task(
            db,
            task_type="system",
            status="info",
            message=f"开始后台复制 {len(body.src_paths)} 项 → {body.dest_dir} (job={job.id})",
        )
        return FileCopyResponse(
            message="复制任务已在后台启动，可关闭弹窗；进度见下方进度条或「上传进度」页",
            mode="rclone",
            job_id=job.id,
            async_job=True,
            detail=job.to_dict(),
        )

    try:
        result = files_service.copy_between_mounts(
            body.src_paths,
            body.dest_dir,
            mounts,
            roots,
            prefer_rclone=body.prefer_rclone,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc

    log_task(
        db,
        task_type="system",
        status="success",
        message=f"文件复制完成: {result.get('copied')}/{result.get('total')} → {body.dest_dir}",
        detail=str(result.get("results"))[:2000],
    )
    mode = result.get("mode") or "rclone"
    return FileCopyResponse(
        message=f"已复制 {result.get('copied')}/{result.get('total')} 项（{mode}）",
        mode=mode,
        detail=result,
        async_job=False,
    )


@router.get("/copy/{job_id}", response_model=TransferJobOut)
def copy_job_status(job_id: str, _: User = Depends(get_current_user)):
    job = get_transfer_service().get(job_id)
    if not job:
        raise HTTPException(404, "任务不存在或已过期")
    return TransferJobOut(**job.to_dict())


@router.post("/copy/{job_id}/cancel", response_model=TransferJobOut)
def copy_job_cancel(job_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    job = get_transfer_service().cancel(job_id)
    if not job:
        raise HTTPException(404, "任务不存在或已过期")
    log_task(db, task_type="system", status="warning", message=f"取消复制任务 {job_id}")
    return TransferJobOut(**job.to_dict())


@router.get("/download")
def download(
    path: str = Query(...),
    token: str | None = Query(default=None, description="JWT for media preview (img/video src)"),
    inline: bool = Query(default=False, description="Content-Disposition: inline for preview"),
    db: Session = Depends(get_db),
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
):
    _user_from_token_or_bearer(db, creds, token)
    try:
        fp = files_service.resolve_download(path, _roots(db))
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    media_type = files_service.guess_media_type(fp)
    # FileResponse supports HTTP Range (needed for video seeking)
    return FileResponse(
        path=str(fp),
        filename=fp.name,
        media_type=media_type,
        content_disposition_type="inline" if inline else "attachment",
    )
