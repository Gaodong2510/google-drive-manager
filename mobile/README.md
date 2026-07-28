# 云桥 CloudBridge · Android 客户端

`targetSdk 35` 全屏 WebView 壳，**不绑定任何固定服务器**。

## 给别人用时怎么部署？

1. 每个人在自己的 VPS 上安装 **云桥面板**（`google-drive-manager`）
2. 手机安装 **同一个 APK**
3. 首次打开时填写 **自己的面板地址**（例如 `http://他的IP:8787`）

应用只负责打开网页；账号、挂载、数据都在各自服务器上，互不影响。

## 界面说明

- **无顶栏标题**：进入面板后全屏显示网页（不再出现左上角「云桥」条）
- **右下角小按钮**：刷新 / 更换服务器 / 清缓存
- **首次启动**：精美引导页，必须手动填写服务器地址

## 下载

推荐 HTTPS 面板地址：

```text
https://你的域名/download/cloudbridge.apk
```

（本机示例：`https://drive.dongwen.cc/download/cloudbridge.apk`）

## 编译

```bash
export ANDROID_HOME=/opt/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
# 不要设置 SERVER_URL，保持空，便于分发
bash mobile/build-apk.sh
```
