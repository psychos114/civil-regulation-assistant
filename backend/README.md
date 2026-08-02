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

- 健康检查：<http://localhost:5000/api/health>
- Swagger 接口文档：<http://localhost:5000/docs>

`regulations.db`、`data/faiss.index` 和 `data/faiss_metadata.json` 会自动生成。
大模型问答只需要在 `.env` 填写 `STEPFUN_API_KEY`；FAISS 在本机运行，
不需要 Pinecone 密钥或其他向量数据库账号。

如果知识库文件发生变化，请重新执行 `python init_db.py` 重建 FAISS 索引。

## 测试

```bat
python -m pytest -q
```
