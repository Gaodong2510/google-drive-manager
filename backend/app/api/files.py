"""File browser API over local mounts."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.models import MountPoint, User
from app.schemas.schemas import BrowseResponse, MessageOut
from app.services import files_service

router = APIRouter(prefix="/files", tags=["files"])


def _roots(db: Session) -> list[str]:
    return [m.local_path for m in db.query(MountPoint).all()]


@router.get("/roots")
def list_roots(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    mounts = db.query(MountPoint).order_by(MountPoint.id).all()
    return [
        {
            "id": m.id,
            "name": m.name,
            "path": m.local_path,
            "status": m.status,
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


@router.get("/download")
def download(path: str = Query(...), db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    try:
        fp = files_service.resolve_download(path, _roots(db))
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return FileResponse(
        path=str(fp),
        filename=fp.name,
        media_type=files_service.guess_media_type(fp),
    )
