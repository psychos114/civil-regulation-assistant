# 土木工程智能规范助手（云端部署版）

这是原本地项目的 Cloudflare Workers 兼容版本。网页界面和 API 路径保持不变，法规数据使用 D1 数据库持久保存。

当前公开版本：`v0.1`

## 已实现接口

- `GET /api/regulations/check-update`
- `GET /api/regulations/list?page=1&page_size=10`
- `POST /api/regulations/download`
- `GET /api/regulations/{id}`
- `GET /api/rag/status`

所有接口允许跨域访问。初次访问时会自动写入 33 条法规演示数据。

## 大模型问答

`POST /api/chat` 会在服务器端调用 StepFun Chat Completions API。浏览器不会接触 API 密钥。生产环境需要配置：

- `STEPFUN_API_KEY`：API 密钥（机密）
- `STEPFUN_BASE_URL`：默认为 `https://api.stepfun.com/step_plan/v1`
- `STEPFUN_MODEL`：默认为 `step-3.7-flash`

公开站点按访问者每小时最多 20 次提问进行限流，回答会检索：

- 云端法规摘要；
- D1 中的中国建筑股份有限公司公开年度报告、ESG 报告、季度报告、内部控制报告和官网业务资料。

企业资料会保留文档名称、PDF 页码和官方来源网址。当前数据集包含 7 份文档、715 个文本块。本目录运行在 Cloudflare Workers，不能加载 Python/C++ 原生的 FAISS，因此只提供关键词检索兼容模式；真正的 `IndexFlatIP` 向量检索位于仓库根目录的 FastAPI 后端。回答不能代替官方法规全文和具备资质的专业人员审核。

向量数据库状态接口：

- `GET /api/rag/vector-store`
- `POST /api/rag/vector-store`：在 Workers 中返回 `FAISS_RUNTIME_UNAVAILABLE`，请改用 FastAPI 后端建立索引

## 更新 RAG 数据

1. 将本地生成的 `chunks.jsonl` 放入 `rag_import/`。
2. 修改 `db/schema.ts` 后运行 `npm run db:generate`。
3. 运行 `npm run rag:seed`，把经过校验的文本块写入最新的 `rag_chunks` 迁移。
4. 同步更新 `backend/data/rag_chunks.jsonl`，然后在 `backend` 目录执行 `python init_db.py` 重建 FAISS 索引。
5. 运行 `npm test` 验证迁移、兼容状态和网页来源展示。

`rag_import/` 不会提交到 Git；生产部署使用生成后的 D1 迁移。不要把 `.env`、API 密钥或虚拟环境上传到仓库。

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
