# 土木工程智能规范助手（云端部署版）

这是原 Flask + SQLite 本地项目的云端兼容版本。网页界面和 API 路径保持不变，后端运行在 Cloudflare Workers，法规数据使用 D1 数据库持久保存。

当前公开版本：`v0.1`

## 已实现接口

- `GET /api/regulations/check-update`
- `GET /api/regulations/list?page=1&page_size=10`
- `POST /api/regulations/download`
- `GET /api/regulations/{id}`

所有接口允许跨域访问。初次访问时会自动写入 33 条法规演示数据。

## 大模型问答

`POST /api/chat` 会在服务器端调用 StepFun Chat Completions API。浏览器不会接触 API 密钥。生产环境需要配置：

- `STEPFUN_API_KEY`：API 密钥（机密）
- `STEPFUN_BASE_URL`：默认为 `https://api.stepfun.com/step_plan/v1`
- `STEPFUN_MODEL`：默认为 `step-3.7-flash`

公开站点按访问者每小时最多 20 次提问进行限流。回答会参考云端法规摘要，但不能代替官方法规全文和具备资质的专业人员审核。

## 本地开发

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

## 验证

```bash
npm run lint
npm test
```

## 数据与使用说明

`data/seed-regulations.json` 中的法规内容是用于功能演示的摘要，不代替正式法规全文。用于生产业务前，应接入合法、权威的数据来源，并以官方公布文本为准。
