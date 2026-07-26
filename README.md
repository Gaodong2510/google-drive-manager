# Google Drive Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

生产级 **Google Drive 挂载管理 Web 面板**，面向 Debian 12/13 VPS 与 **Emby / Plex / MoviePilot** 影视媒体服务器场景。

基于 **rclone mount + VFS Cache**，提供：

- 多 Google Drive 账号授权（粘贴 Token / 导入 rclone / Web OAuth）  
- 多挂载点启停 / 参数配置 / 实时日志  
- **上传进度**（VFS 回写队列 / 文件最终状态 / rclone RC 实时速度，适配 MoviePilot 入库）  
- Watchdog 断线自动恢复  
- 开机 systemd 自启  
- 本地挂载目录文件浏览器  
- 缓存与磁盘预警  
- 加密备份恢复  

**优先级：稳定性 > 安全性 > 易用性**

> 本项目为**自托管**开源软件。不提供共享的 Google OAuth 客户端；请使用「粘贴 Token」或自行创建 OAuth 凭据。请勿将 `data/`、Client Secret、备份文件提交到公开仓库。

---

## 架构

```
浏览器 → React 前端 → FastAPI 后端
                        ├── Google OAuth
                        ├── rclone 配置（加密 Token）
                        ├── Mount 管理器（参数列表执行，防注入）
                        ├── Watchdog
                        ├── 系统监控 / 缓存 / 任务日志
                        └── SQLite
                              ↓
                         Debian VPS
                         rclone mount → /mnt/...
                              ↓
                         Emby / Plex
```

推荐部署方式：**宿主机原生安装**（FUSE 挂载最稳）。Docker 可用于跑 Web 面板；容器内挂载需特权模式，生产媒体库不推荐。

---

## 目录结构

```
google-drive-manager/
├── backend/                 # FastAPI
├── frontend/                # React + Vite + Tailwind
├── data/                    # 运行时数据（DB / 日志 / 缓存 / rclone.conf）
├── systemd/
├── docker-compose.yml
├── Dockerfile
├── install.sh
└── README.md
```

---

## 快速安装（Debian 12/13）

```bash
git clone https://github.com/Gaodong2510/google-drive-manager.git
cd google-drive-manager
sudo bash install.sh
```

脚本会：

1. 检测系统并安装依赖（含 **fuse3** / `fusermount3`）  
2. 安装 / 检测 rclone  
3. 安装 Python venv 与前端构建  
4. 配置 `user_allow_other`  
5. 注册并启动 `google-drive-manager.service`  

### 访问

| 项目 | 值 |
|------|-----|
| 地址 | `http://<服务器IP>:8787` |
| 默认用户 | `admin` |
| 默认密码 | `admin123`（登录后请立即修改） |

生产环境建议：反向代理 HTTPS、限制面板端口、修改默认密码。

---

## 开发模式启动

### 后端

```bash
cd backend
python3 -m venv ../venv
source ../venv/bin/activate
pip install -r requirements.txt
export GDM_DATA_DIR=../data
uvicorn app.main:app --host 0.0.0.0 --port 8787 --reload
```

### 前端

```bash
cd frontend
npm install
npm run build          # 生产：构建到 dist，由后端托管
# 或开发热更新：
npm run dev            # http://127.0.0.1:5173 代理到 API
```

---

## Docker

```bash
docker compose up -d --build
# 访问 http://服务器IP:8787
```

> 若要在容器内 mount，请编辑 `docker-compose.yml` 启用 `privileged` 与 `/dev/fuse`。  
> **Emby/Plex 生产环境请优先 `install.sh` 原生安装。**

---

## 使用流程

### 1. 添加 Google Drive 账号（三选一）

#### 方式 A：粘贴 Token（推荐，最简单）

在有浏览器的电脑上：

```bash
rclone authorize "drive"
```

浏览器登录 Google 后，终端会输出 JSON。打开面板 **Drive 账号 → 粘贴 Token**，填显示名称并粘贴 JSON，点「保存并测试」。

无需配置公网回调地址，也无需先建 Google Cloud 项目（生产环境仍建议自建 Client ID 以获得独立配额）。

#### 方式 B：导入 rclone 配置

若已有 `rclone.conf`：

1. **Drive 账号 → 导入 rclone**  
2. 粘贴完整 conf 或单个 `[remote]` 段  
3. 解析 → 勾选 `type=drive` 的 remote → 导入  

#### 方式 C：Web OAuth（需 Google Cloud）

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)  
2. 创建项目 → 启用 **Google Drive API**  
3. 凭据 → 创建 **OAuth 客户端 ID**（应用类型：Web 应用）  
4. 授权重定向 URI 添加：

```
http://你的域名或IP:8787/api/oauth/callback
```

5. 在面板 **系统设置** 中填写 Client ID / Secret / Redirect URI 并保存  
6. **Drive 账号** → 添加账号 → **Web OAuth**，浏览器完成登录同意  
7. 点 **测试连接**，确认容量与状态  

### 3. 创建挂载

1. **挂载管理** → 创建挂载  
2. 选择账号、本地路径（如 `/mnt/gdrive_media`）  
3. 模式推荐：**媒体服务器模式 (Emby/Plex)**  
4. 启动挂载，确认状态为「运行中」  

### 4. Emby / Plex 使用挂载目录

将媒体库路径指向挂载目录，例如：

```
/mnt/gdrive_media/Movies
/mnt/gdrive_media/TV
```

建议：

- 使用 **媒体服务器模式**（`vfs-cache-mode full` 等已预设）  
- 缓存盘有足够空间，并设置 `vfs-cache-max-size`  
- 磁盘使用率 >80% 会在 Dashboard 告警  
- Emby/Plex 扫描间隔不要过密，减轻 API 与目录缓存压力  

### 5. 上传进度（MoviePilot / 媒体整理）

MoviePilot 等工具写入挂载目录时，文件先进入本地 **VFS 缓存**，再由 rclone 回写到 Google Drive。

1. 打开面板 **上传进度**（`/uploads`），可自动刷新  
2. 关注顶部 **排队 / 上传中** 计数；均为 `0` 且视频状态为「成功」即云端完成  
3. Dashboard 也有摘要卡片  

> 本地整理完成 ≠ 云端已传完。历史日志中的「排队」在文件成功后会折叠为最终「成功」，不是错误。

挂载启动时会自动启用本机 rclone RC（`127.0.0.1:5572+mount_id`）以显示实时速度；旧挂载需在面板中重启一次挂载。

### 6. 日志

| 来源 | 方式 |
|------|------|
| 上传进度 | **上传进度** 页面 |
| 面板任务 | **任务日志** 页面 |
| 单个挂载 rclone 日志 | 挂载卡片 → 日志 |
| 系统服务 | `journalctl -u google-drive-manager -f` |
| 文件 | `data/logs/mounts/mount_<id>.log` |

### 7. 备份 / 恢复

- **系统设置** → 创建备份（加密）  
- 下载 `.tar.gz.enc` 妥善保存  
- 恢复：上传备份文件  

### 7. 升级

```bash
# 拉取/覆盖新版本代码后
sudo bash install.sh
# 或手动：
cd /opt/google-drive-manager
source venv/bin/activate
pip install -r backend/requirements.txt
cd frontend && npm install && npm run build
systemctl restart google-drive-manager
```

数据目录 `data/` 默认保留，不会丢账号与挂载配置。

---

## 媒体服务器推荐参数（已内置）

| 参数 | 推荐值（媒体模式） |
|------|-------------------|
| vfs-cache-mode | full |
| vfs-cache-max-size | 50G（按磁盘调整） |
| vfs-cache-max-age | 168h |
| vfs-read-chunk-size | 128M |
| buffer-size | 64M |
| dir-cache-time | 1000h |
| poll-interval | 15s |
| allow-other | true |

也可选择「普通云盘模式」或自定义。

---

## 安全说明

- 登录：bcrypt 密码 + JWT  
- OAuth Token / Client Secret：**Fernet 加密** 存库  
- rclone.conf 权限 `600`  
- 挂载命令：**参数列表** 执行，禁止 shell 拼接  
- 路径校验：禁止穿越与系统关键目录  
- Token / Secret **不在页面明文展示**  

生产环境请：

1. 修改默认密码  
2. 使用反向代理 + HTTPS（Nginx / Caddy）  
3. 限制面板端口仅内网或 VPN 访问  

---

## systemd

```bash
systemctl status google-drive-manager
systemctl restart google-drive-manager
systemctl stop google-drive-manager
```

应用启动时会：

- 自动恢复 `auto_start` 挂载  
- 启动 Watchdog 定时健康检查与自愈  

连续恢复失败达到上限后会 **暂停无限重启**，并在面板显示明确错误。

---

## API 文档

安装后访问：`http://<host>:8787/api/docs`

---

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| GDM_DATA_DIR | 数据目录 | `./data` |
| GDM_HOST | 监听地址 | `0.0.0.0` |
| GDM_PORT | 端口 | `8787` |
| GDM_DEFAULT_USERNAME | 初始用户 | `admin` |
| GDM_DEFAULT_PASSWORD | 初始密码 | `admin123` |
| GDM_RCLONE_BIN | rclone 路径 | `rclone` |

---

## 许可证

[MIT](LICENSE) — 请自担风险用于生产环境，并遵守 [Google API 服务条款](https://developers.google.com/terms) 与 rclone 使用条款。

## 贡献

欢迎 Issue / PR。提交前请确认未包含 `data/`、Token、密钥或个人 OAuth 凭据。
