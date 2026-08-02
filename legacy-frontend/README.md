# 独立前端

前端是纯静态页面，默认使用 `8000` 端口：

```bat
cd frontend
python -m http.server 8000
```

浏览器打开 <http://localhost:8000>。

本地无需修改 `config.js`。如果前端和后端分别部署到互联网，请把
`config.js` 中的 `window.BACKEND_URL` 改为 FastAPI 后端的 HTTPS 地址。
