"""Auth routes."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.models.models import User
from app.schemas.schemas import (
    ChangePasswordRequest,
    ChangeUsernameRequest,
    ChangeUsernameResponse,
    LoginRequest,
    MessageOut,
    TokenResponse,
    UserOut,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_\u4e00-\u9fff.-]{2,64}$")


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == body.username).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="用户已禁用")
    user.last_login = datetime.now(timezone.utc)
    db.add(user)
    db.commit()
    token = create_access_token(user.username)
    return TokenResponse(access_token=token, must_change_password=user.must_change_password)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/change-password", response_model=MessageOut)
def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码不正确")
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    db.add(user)
    db.commit()
    return MessageOut(message="密码已更新")


@router.post("/change-username", response_model=ChangeUsernameResponse)
def change_username(
    body: ChangeUsernameRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change login username; returns a fresh JWT because tokens are keyed by username."""
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码不正确")

    new_username = body.new_username.strip()
    if not new_username:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    if new_username == user.username:
        raise HTTPException(status_code=400, detail="新用户名与当前相同")
    if not _USERNAME_RE.match(new_username):
        raise HTTPException(
            status_code=400,
            detail="用户名仅支持 2–64 位字母、数字、下划线、点、连字符或中文",
        )

    exists = (
        db.query(User)
        .filter(User.username == new_username, User.id != user.id)
        .first()
    )
    if exists:
        raise HTTPException(status_code=400, detail="该用户名已被占用")

    user.username = new_username
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.username)
    return ChangeUsernameResponse(
        message="用户名已更新",
        username=user.username,
        access_token=token,
    )
