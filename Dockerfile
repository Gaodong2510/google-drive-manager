# Multi-stage: build frontend, run FastAPI serving static + API
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    GDM_DATA_DIR=/data \
    GDM_HOST=0.0.0.0 \
    GDM_PORT=8787 \
    DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates fuse3 unzip procps \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://rclone.org/install.sh | bash || true

WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend/ /app/backend/
COPY --from=frontend-build /frontend/dist /app/frontend/dist

RUN mkdir -p /data /mnt

# NOTE: For FUSE mounts from container you need:
#   --privileged --device /dev/fuse --cap-add SYS_ADMIN
# Production recommendation: run native install on host for Emby/Plex stability.

EXPOSE 8787
VOLUME ["/data"]

WORKDIR /app/backend
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]
