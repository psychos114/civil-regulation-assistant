# Render 云端部署

部署完成后，即使本地电脑关机，其他人仍可通过 `onrender.com` 地址访问。

## 第一次部署

1. 确认 `fastapi-separated` 分支已经推送到 GitHub。
2. 登录 [Render](https://dashboard.render.com/)。
3. 点击 **New +**，选择 **Blueprint**。
4. 连接 GitHub 仓库 `psychos114/civil-regulation-assistant`。
5. 选择分支 `fastapi-separated`，Render 会读取根目录中的 `render.yaml`。
6. 在 Render 提示时填写 `STEPFUN_API_KEY`（StepFun 大模型密钥）。FAISS 不需要密钥。
7. 点击 **Apply**，等待构建完成。
8. 打开 Render 显示的 `https://...onrender.com` 地址。

不要把密钥写入 GitHub、`render.yaml` 或前端代码。

## 免费版说明

Render 免费 Web Service 闲置后会休眠。电脑可以关机，但下一位访客首次打开时可能需要等待约一分钟。免费服务的本地文件是临时存储；项目会在每次启动时根据 715 条资料重新创建 SQLite 数据库和 FAISS 索引，因此冷启动会比普通网页稍慢。

如果需要随时立即打开，或需要永久保存 SQLite 与 FAISS 运行时修改，请在 Render 将服务升级为付费实例并添加 Persistent Disk。
