# 土木工程智能规范助手

本项目包含完整前端页面和 Flask 后端，为土木工程行业规范提供查询、分页、
更新检查、更新下载和法规详情接口。数据保存在本地 SQLite 单文件数据库中。

## 运行环境

- Python 3.10+
- Flask
- Flask-CORS
- SQLite（Python 标准库）

## 快速启动

```powershell
git clone https://github.com/psychos114/civil-regulation-assistant.git
cd civil-regulation-assistant
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe init_db.py
.\.venv\Scripts\python.exe server.py
```

浏览器访问 `http://127.0.0.1:5000/` 即可使用完整助手。服务启动时会自动创建
`regulations.db` 和初始数据，因此 `python init_db.py` 是可选步骤。全新数据库
会初始化 33 份常用规范，覆盖结构、抗震、地基基础、勘察测量、施工质量、
安全、节能、防水和装饰装修等方向。

Flask 会在根地址提供项目内的 `index.html`，因此只需启动一个服务即可同时
使用前端和 API。也可通过 `FRONTEND_FILE` 环境变量指定其他前端文件。

如需使用其他数据库文件，可在启动前设置 `REGULATIONS_DB` 环境变量：

```powershell
$env:REGULATIONS_DB = "D:\CivilDocs\regulations.db"
python server.py
```

## API

### 1. 检查法规更新

```http
GET /api/regulations/check-update
```

返回 `has_update`、`update_count` 和 `updates`。演示数据库首次检查会发现
3 份更新；全部下载后法规总数为 34。

### 2. 获取法规列表

```http
GET /api/regulations/list?page=1&page_size=10
```

支持参数：

- `page`：页码，默认 1
- `page_size`：每页数量，默认 10，最大 100
- `per_page`：`page_size` 的兼容别名
- `q` 或 `search`：按标题、编号和内容搜索
- `is_new`：`0`、`1`、`false` 或 `true`

### 3. 下载更新法规

下载全部可用更新：

```http
POST /api/regulations/download
Content-Type: application/json

{}
```

下载指定更新：

```json
{
  "update_ids": ["gb-55030-2024", "jgj-59-2011-r2024"]
}
```

也可在 `update_ids` 中使用法规编号，例如 `GB 55030-2024`。

### 4. 获取法规详情

```http
GET /api/regulations/1
```

不存在时返回 HTTP 404 和结构化错误码 `REGULATION_NOT_FOUND`。

## 通用响应格式

成功：

```json
{
  "success": true,
  "message": "请求成功",
  "data": {}
}
```

失败：

```json
{
  "success": false,
  "message": "错误说明",
  "error": {
    "code": "ERROR_CODE"
  }
}
```

## 前端接入示例

原页面可将模拟的 `checkForUpdates()` 替换为类似流程：

```javascript
const API_BASE = 'http://localhost:5000/api';

async function getAvailableUpdates() {
  const response = await fetch(`${API_BASE}/regulations/check-update`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message);
  return result.data;
}

async function downloadUpdates(updateIds) {
  const response = await fetch(`${API_BASE}/regulations/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ update_ids: updateIds })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message);
  return result.data;
}
```

## 测试

测试使用 Python 标准库 `unittest`，不需要额外测试依赖：

```powershell
python -m unittest -v
```

测试会使用临时数据库，不会修改项目内的 `regulations.db`。测试还会检查
扩展规范库中的代表性行业规范是否能够被搜索到。

## 临时互联网分享

Windows 用户可双击 `start_internet_access.bat`。首次运行时脚本会引导下载
`cloudflared`，之后创建无需开放入站防火墙的临时 HTTPS 隧道。

也可在已经安装 `cloudflared` 的情况下手动运行：

```powershell
cloudflared tunnel --url http://127.0.0.1:5000
```

命令会显示随机的 `https://...trycloudflare.com` 地址。该地址仅在命令窗口
运行期间有效，适合测试和临时演示，不适合作为正式生产部署。

## 数据来源说明

项目未获得外部法规数据源地址，因此 `REMOTE_REGULATIONS` 是用于接口联调的
本地演示更新源，正文也是演示摘要。生产环境应把该数据源替换为合法、权威、
可追溯的法规服务，同时保留现有数据库写入和 API 响应层。

## 项目结构

```text
.
├── index.html                  # 前端页面
├── server.py                   # Flask 主服务
├── init_db.py                  # SQLite 初始化脚本
├── test_api.py                 # API 自动化测试
├── requirements.txt            # Python 依赖
├── start_internet_access.bat   # Windows 临时公网分享入口
└── README.md
```

`.venv`、本地数据库、Cloudflare 可执行文件和临时公网日志已通过 `.gitignore`
排除，不会上传到 GitHub。
