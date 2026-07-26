# 土木工程智能规范助手（云端部署版）

这是原 Flask + SQLite 本地项目的云端兼容版本。网页界面和 API 路径保持不变，后端运行在 Cloudflare Workers，法规数据使用 D1 数据库持久保存。

## 已实现接口

- `GET /api/regulations/check-update`
- `GET /api/regulations/list?page=1&page_size=10`
- `POST /api/regulations/download`
- `GET /api/regulations/{id}`

所有接口允许跨域访问。初次访问时会自动写入 33 条法规演示数据。

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
