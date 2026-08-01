# 土木工程智能规范助手（前后端分离版）

当前分支为 `fastapi-separated`，前端与后端已经完全分离：

```text
frontend/          React + Vite 新版前端，默认端口 8000
backend/           Python FastAPI 服务，默认端口 5000
legacy-frontend/   改版前的静态前端，仅作备份
legacy-sites/      早期 Sites 版本，仅作备份
```

新版界面采用深蓝工程工作台风格，包含可用的智能问答、规范库、法规更新、知识来源、设置与关于功能。后端使用 FastAPI、SQLite、StepFun 和 Pinecone。

## 最简单的运行方法（Windows）

1. 双击根目录中的 `start_all.bat`。
2. 等待出现“后端”和“前端”两个黑色窗口。
3. 浏览器访问 <http://127.0.0.1:8000>。
4. 后端接口文档位于 <http://127.0.0.1:5000/docs>。

## 云端分享（电脑关机后仍可访问）

项目已经提供 `render.yaml`，可部署为 `https://...onrender.com` 云端网址，不使用 `chatgpt.site`，也不依赖本地电脑持续开机。完整步骤见 [DEPLOY_RENDER.md](DEPLOY_RENDER.md)。

如需大模型和 Pinecone，请在 `backend/.env` 中填写：

```env
STEPFUN_API_KEY=你的密钥
PINECONE_API_KEY=你的密钥
```

密钥只能保存在 `backend/.env`，该文件已被 Git 忽略，不会上传到 GitHub。

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

## 前端开发

首次开发需要在 `frontend` 目录安装依赖：

```bat
cd frontend
npm install
npm run dev
```

生成可发布版本：

```bat
npm run build
```

如需连接在线后端，请编辑 `frontend/public/config.js`，填写 FastAPI 的 HTTPS 地址，再执行一次 `npm run build`。本地使用 `start_frontend.bat` 时，脚本会把最新配置复制到构建目录。

## 后端开发

```bat
cd backend
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
copy .env.example .env
python init_db.py
python run.py
```

## 测试

```bat
cd backend
python -m pytest -q

cd ..\frontend
npm run build
npm run test:sites
```

GitHub Actions 会在推送 `fastapi-separated` 分支时自动测试 FastAPI 后端并编译 React 前端。

> `backend/data/seed-regulations.json` 是法规功能演示摘要，不替代正式规范全文。工程安全、法律责任和强制性条文必须以主管部门正式文本及专业人员复核结果为准。
