"""Google Drive Manager — FastAPI application entrypoint."""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api import accounts, auth, files, mounts, oauth_cb, system
from app.core.config import get_settings
from app.core.database import SessionLocal, init_db
from app.core.security import hash_password
from app.models.models import User
from app.services.task_logger import log_task
from app.services.watchdog import get_watchdog, restore_autostart_mounts

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("gdm")


def ensure_admin_user() -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == settings.default_username).first()
        if not user:
            user = User(
                username=settings.default_username,
                password_hash=hash_password(settings.default_password),
                must_change_password=settings.force_password_change,
            )
            db.add(user)
            db.commit()
            logger.info("Created default admin user: %s", settings.default_username)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.ensure_dirs()
    init_db()
    ensure_admin_user()
    db = SessionLocal()
    try:
        log_task(db, task_type="system", status="info", message=f"Google Drive Manager v{__version__} 启动")
    finally:
        db.close()
    # Restore mounts then start watchdog
    try:
        restore_autostart_mounts()
    except Exception:
        logger.exception("Failed to restore mounts on startup")
    get_watchdog().start()
    yield
    get_watchdog().stop()
    logger.info("Shutdown complete")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )

    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins if origins != ["*"] else ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    api_prefix = "/api"
    app.include_router(auth.router, prefix=api_prefix)
    app.include_router(accounts.router, prefix=api_prefix)
    app.include_router(oauth_cb.router, prefix=api_prefix)
    app.include_router(mounts.router, prefix=api_prefix)
    app.include_router(files.router, prefix=api_prefix)
    app.include_router(system.router, prefix=api_prefix)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": __version__}

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        logger.exception("Unhandled error on %s", request.url.path)
        return JSONResponse(status_code=500, content={"detail": "服务器内部错误"})

    # Serve frontend static build if present (includes PWA assets)
    static_dir = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if static_dir.is_dir():
        assets = static_dir / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

        def _static_headers(full_path: str) -> dict[str, str] | None:
            """PWA service worker / manifest cache headers."""
            name = full_path.rsplit("/", 1)[-1]
            if name == "sw.js" or name.startswith("workbox-"):
                return {
                    "Service-Worker-Allowed": "/",
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                }
            if name.endswith(".webmanifest") or name == "manifest.webmanifest":
                return {"Cache-Control": "no-cache"}
            return None

        @app.get("/{full_path:path}")
        async def spa(full_path: str):
            if full_path.startswith("api/"):
                return JSONResponse({"detail": "Not Found"}, status_code=404)
            file_path = static_dir / full_path
            if full_path and file_path.is_file():
                headers = _static_headers(full_path)
                return FileResponse(file_path, headers=headers)
            index = static_dir / "index.html"
            if index.is_file():
                return FileResponse(index)
            return JSONResponse({"detail": "Frontend not built"}, status_code=404)
    else:

        @app.get("/")
        def root():
            return {
                "name": settings.app_name,
                "version": __version__,
                "docs": "/api/docs",
                "message": "Frontend not built. Run frontend build or open /api/docs",
            }

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    s = get_settings()
    uvicorn.run("app.main:app", host=s.host, port=s.port, reload=False)
