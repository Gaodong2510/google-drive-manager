"""OAuth callback (browser redirect, no JWT)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.oauth_service import OAuthService

router = APIRouter(prefix="/oauth", tags=["oauth"])


@router.get("/callback")
def oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    error_uri: str | None = None,
    db: Session = Depends(get_db),
):
    if error:
        detail = error
        if error_description:
            detail = f"{error}: {error_description}"
        hint = ""
        el = (error or "").lower()
        if "access_denied" in el:
            hint = (
                " 常见原因：① 未在 OAuth 同意屏幕添加测试用户；"
                "② 点了「返回安全页面」而不是「高级→继续」；"
                "③ 登录的 Google 账号不是测试用户。"
            )
        elif "redirect" in el:
            hint = " 请核对 Google 控制台与面板的 Redirect URI 是否完全一致。"
        return HTMLResponse(_page(False, f"授权失败: {detail}{hint}"), status_code=400)
    if not code or not state:
        return HTMLResponse(
            _page(
                False,
                "缺少 code 或 state 参数。若从 Google 跳回却仍看到此页，"
                "请重新在面板点击「Web OAuth」，不要直接打开回调地址。",
            ),
            status_code=400,
        )
    try:
        acc = OAuthService(db).handle_callback(code, state)
    except Exception as exc:
        return HTMLResponse(_page(False, str(exc)), status_code=400)
    return HTMLResponse(
        _page(True, f"账号「{acc.name}」授权成功", email=acc.email or "")
    )


def _page(ok: bool, message: str, email: str = "") -> str:
    color = "#16a34a" if ok else "#dc2626"
    title = "授权成功" if ok else "授权失败"
    return f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>{title} - Google Drive Manager</title>
<style>
body{{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}}
.card{{background:#1e293b;border-radius:16px;padding:32px;max-width:420px;box-shadow:0 20px 40px rgba(0,0,0,.4);text-align:center}}
h1{{color:{color};font-size:1.4rem;margin:0 0 12px}}
p{{color:#94a3b8;line-height:1.6}}
a{{display:inline-block;margin-top:20px;background:#3b82f6;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px}}
</style></head><body><div class="card">
<h1>{title}</h1>
<p>{message}</p>
{"<p>"+email+"</p>" if email else ""}
<p>可以关闭此窗口并返回管理面板。</p>
<a href="/">返回面板</a>
<script>try{{window.opener&&window.opener.postMessage({{type:'gdm-oauth',ok:{str(ok).lower()}}},'*')}}catch(e){{}}</script>
</div></body></html>"""
