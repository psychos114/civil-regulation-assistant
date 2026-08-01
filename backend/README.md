# FastAPI 后端

这是独立的 Python 后端，默认端口为 `5000`。

## 第一次运行

```bat
cd backend
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
copy .env.example .env
python init_db.py
python run.py
```

运行后可访问：

- 健康检查：<http://127.0.0.1:5000/api/health>
- Swagger 接口文档：<http://127.0.0.1:5000/docs>

`regulations.db` 会自动生成。大模型问答需要在 `.env` 填写
`STEPFUN_API_KEY`；Pinecone 语义检索需要填写 `PINECONE_API_KEY`。

## 测试

```bat
python -m pytest -q
```
