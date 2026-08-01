# 土木工程智能规范助手：前后端分离版

此分支为 `fastapi-separated`，在不影响现有线上版本的情况下完成了前后端分离：

```text
frontend/       独立静态网页，默认端口 8000
backend/        Python FastAPI 服务，默认端口 5000
legacy-sites/   原 TypeScript / Sites 云端版本，仅供参考
```

后端技术栈：Python 3.10+、FastAPI、SQLite、HTTPX、Pinecone、StepFun。

## 最简单的运行方法（Windows）

1. 双击根目录的 `start_all.bat`。
2. 第一次运行会自动安装 Python 依赖并初始化数据库，请耐心等待。
3. 出现两个黑色窗口后，打开 <http://127.0.0.1:8000>。
4. FastAPI 接口文档位于 <http://127.0.0.1:5000/docs>。

如需大模型和 Pinecone：

1. 第一次启动后打开 `backend/.env`。
2. 填写 `STEPFUN_API_KEY` 和 `PINECONE_API_KEY`。
3. 保存文件并重新启动后端窗口。

密钥只放在 `backend/.env`，该文件已经被 Git 忽略，不会上传。

## API

- `GET /api/health`
- `GET /api/regulations/check-update`
- `GET /api/regulations/list?page=1&page_size=10`
- `POST /api/regulations/download`
- `GET /api/regulations/{id}`
- `GET /api/rag/status`
- `GET /api/rag/vector-store`
- `POST /api/rag/vector-store`
- `POST /api/chat`

## 分别启动

后端：

```bat
cd backend
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
copy .env.example .env
python init_db.py
python run.py
```

前端（另开一个终端）：

```bat
cd frontend
python -m http.server 8000
```

## 自动测试

```bat
cd backend
python -m pytest -q
```

GitHub Actions 会在推送 `fastapi-separated` 分支时自动运行后端测试。

## 部署提示

前端可以部署到静态网站服务；后端部署到支持 Python 的服务器，并执行：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 5000
```

部署后，将 `frontend/config.js` 中的 `window.BACKEND_URL` 改为后端 HTTPS 地址。

`backend/data/seed-regulations.json` 是法规功能演示摘要，不代替正式规范全文。工程安全、法律责任和强制性条文必须以主管部门正式文本及专业人员复核结果为准。
