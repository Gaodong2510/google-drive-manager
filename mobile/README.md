# 云桥 CloudBridge · Android 客户端

## 为什么不用浏览器「添加到主屏幕」？

Chrome 安装 PWA 时会自动生成 **WebAPK**，其 `targetSdk` 由浏览器决定，在较新安卓上常提示：

> **此应用是针对旧版 Android 开发的**

这不是面板本身写坏了，而是 **WebAPK 的已知限制**。

本目录提供 **targetSdk 35** 的独立 APK 壳（WebView），可侧载安装，避免该提示。

| | PWA 安装 | 本 APK |
|--|--|--|
| targetSdk | 由 Chrome 决定（偏旧） | **35**（Android 15） |
| 旧版 Android 提示 | 常见 | 不应再出现 |
| 服务器地址 | 当前网址 | 首次可配置 / 菜单更换 |

## 下载安装

若面板已部署，用手机浏览器打开：

```text
http://你的服务器IP:8787/download/cloudbridge.apk
```

1. 允许「安装未知应用」
2. 安装「云桥」
3. 打开后填写服务器地址（例如 `http://152.x.x.x:8787`）→ 保存并打开  
4. 右上角菜单可 **刷新** / **更换服务器**

## 重新编译

```bash
export ANDROID_HOME=/opt/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export SERVER_URL=http://你的IP:8787

bash mobile/build-apk.sh
```

产物：`mobile/cloudbridge.apk`  
同时复制到：`frontend/public/download/cloudbridge.apk`（网页可下）

需要：JDK 17、Android SDK Platform 35、Build-Tools 35。
