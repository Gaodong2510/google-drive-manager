#!/usr/bin/env bash
# Google Drive Manager installer for Debian 12/13
set -euo pipefail

APP_NAME="google-drive-manager"
INSTALL_DIR="${INSTALL_DIR:-/opt/google-drive-manager}"
DATA_DIR="${DATA_DIR:-$INSTALL_DIR/data}"
PORT="${PORT:-8787}"
SERVICE_NAME="google-drive-manager"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m';GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err() { echo -e "${RED}[x]${NC} $*"; exit 1; }

need_root() {
  if [[ $EUID -ne 0 ]]; then
    err "请使用 root 运行: sudo bash install.sh"
  fi
}

detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    log "检测到系统: $PRETTY_NAME"
    if [[ "${ID:-}" != "debian" && "${ID_LIKE:-}" != *debian* ]]; then
      warn "未检测到 Debian，将继续尝试安装（未完整测试）"
    fi
  fi
}

install_deps() {
  log "安装系统依赖..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq \
    python3 python3-venv python3-pip python3-dev \
    curl ca-certificates fuse3 unzip procps \
    build-essential pkg-config \
    >/dev/null
  # allow_other for rclone
  if [[ -f /etc/fuse.conf ]]; then
    if ! grep -qE '^\s*user_allow_other\s*$' /etc/fuse.conf; then
      printf '\nuser_allow_other\n' >> /etc/fuse.conf
      log "已启用 /etc/fuse.conf user_allow_other"
    fi
  fi
}

install_rclone() {
  if command -v rclone >/dev/null 2>&1; then
    log "rclone 已安装: $(rclone version | head -1)"
    return
  fi
  log "安装 rclone..."
  curl -fsSL https://rclone.org/install.sh | bash
  log "rclone 安装完成: $(rclone version | head -1)"
}

install_node() {
  if command -v npm >/dev/null 2>&1; then
    log "Node/npm 已存在"
    return
  fi
  log "安装 Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs >/dev/null
}

copy_app() {
  log "部署应用到 $INSTALL_DIR ..."
  mkdir -p "$INSTALL_DIR" "$DATA_DIR"/{config,logs,cache,backups,rclone}
  # rsync-like copy excluding venv/node_modules
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude 'venv' \
      --exclude 'frontend/node_modules' \
      --exclude 'frontend/dist' \
      --exclude 'data' \
      --exclude '.git' \
      "$SCRIPT_DIR/" "$INSTALL_DIR/"
  else
    mkdir -p "$INSTALL_DIR"
    cp -a "$SCRIPT_DIR/backend" "$INSTALL_DIR/"
    cp -a "$SCRIPT_DIR/frontend" "$INSTALL_DIR/"
    cp -a "$SCRIPT_DIR/systemd" "$INSTALL_DIR/" 2>/dev/null || true
    cp -a "$SCRIPT_DIR/Dockerfile" "$INSTALL_DIR/" 2>/dev/null || true
    cp -a "$SCRIPT_DIR/docker-compose.yml" "$INSTALL_DIR/" 2>/dev/null || true
    cp -a "$SCRIPT_DIR/README.md" "$INSTALL_DIR/" 2>/dev/null || true
    cp -a "$SCRIPT_DIR/install.sh" "$INSTALL_DIR/" 2>/dev/null || true
  fi
  mkdir -p "$DATA_DIR"/{config,logs,cache,backups,rclone}
  # if installing from same tree with existing data, keep it
  if [[ "$SCRIPT_DIR/data" != "$DATA_DIR" && -d "$SCRIPT_DIR/data" ]]; then
    true
  fi
  chmod 700 "$DATA_DIR/config" "$DATA_DIR/rclone" "$DATA_DIR/backups"
}

setup_python() {
  log "创建 Python 虚拟环境并安装依赖..."
  python3 -m venv "$INSTALL_DIR/venv"
  # shellcheck disable=SC1091
  source "$INSTALL_DIR/venv/bin/activate"
  pip install -U pip wheel -q
  pip install -r "$INSTALL_DIR/backend/requirements.txt" -q
}

build_frontend() {
  log "构建前端..."
  cd "$INSTALL_DIR/frontend"
  npm install --silent
  npm run build
  cd "$INSTALL_DIR"
}

install_systemd() {
  log "配置 systemd 服务..."
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Google Drive Manager Web Panel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}/backend
Environment=GDM_DATA_DIR=${DATA_DIR}
Environment=GDM_HOST=0.0.0.0
Environment=GDM_PORT=${PORT}
ExecStart=${INSTALL_DIR}/venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
Restart=always
RestartSec=5
LimitNOFILE=1048576
KillMode=mixed
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}.service"
  systemctl restart "${SERVICE_NAME}.service"
}

print_summary() {
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  IP=${IP:-127.0.0.1}
  echo
  echo "=============================================="
  log "安装完成！"
  echo "  访问地址:  http://${IP}:${PORT}"
  echo "  本机访问:  http://127.0.0.1:${PORT}"
  echo "  默认账号:  admin"
  echo "  默认密码:  admin123  （请立即修改）"
  echo "  数据目录:  ${DATA_DIR}"
  echo "  服务管理:  systemctl status ${SERVICE_NAME}"
  echo "  查看日志:  journalctl -u ${SERVICE_NAME} -f"
  echo "  API 文档:  http://${IP}:${PORT}/api/docs"
  echo "=============================================="
}

main() {
  need_root
  detect_os
  install_deps
  install_rclone
  install_node
  copy_app
  setup_python
  build_frontend
  install_systemd
  sleep 2
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    log "健康检查通过"
  else
    warn "健康检查未通过，请检查: journalctl -u ${SERVICE_NAME} -n 50"
  fi
  print_summary
}

main "$@"
