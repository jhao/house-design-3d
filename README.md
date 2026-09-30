# 户型 / 房型设计平台（House Design 3D）

一个**单仓库、零外部依赖**的户型图设计与 3D 预览工具：上传或绘制户型平面图，编辑墙体 / 门窗 / 房间 / 家具，实时 3D 预览，并可用多模态大模型把户型图照片 / CAD 自动识别成可编辑的平面图，或用自然语言指挥 AI 自动布置家具。

> 后端仅用 FastAPI + SQLite（单文件），前端是**无构建步骤**的原生 JS（Canvas2D 自绘 2D 编辑器 + Three.js 3D 预览），一条命令即可启动。

---

## 一、产品功能

### 1. 平面图编辑（2D）
- **墙体**：自由绘制 / 拖拽 / 顶点编辑，支持水平 / 垂直约束（Shift）、围绕中心旋转（Alt）。
- **门窗**：门、窗可沿所在墙体拖拽移动，自动贴墙、不脱离墙体；墙体删除时联动处理。
- **房间**：多边形房间划分，可命名、配色。
- **家具 / 人物**：内置多种家具类型，可放置、旋转、缩放、配色。
- **多选编辑**：框选 / Ctrl（⌘）单击批量选中、反选；顶部对齐工具条支持
  - 向上 / 向下 / 向左 / 向右对齐
  - 水平对齐、垂直对齐
  - 等距离水平分开、等距离垂直分开
- **复制 / 粘贴**：⌘/Ctrl + C / X / V，复制墙体时连带复制其上的门窗。
- **撤销 / 重做**：⌘/Ctrl + Z、⌘/Ctrl + Shift + Z（或 Ctrl+Y）。
- **键盘快捷键**：方向键按 0.1m 微移、`+` / `-` 缩放、`+/-` 缩放、Shift 约束、Alt 旋转。

### 2. 3D 实时预览
- 基于 Three.js 的 3D 视图，与平面编辑实时联动；支持缩放 / 平移。

### 3. 图纸导入与智能识别
- **图片 / PDF / DWG**：交给多模态大模型（如 DeepSeek `deepseek-flash`）识别，自动输出墙体、门窗、房间、家具的结构化 JSON。针对推理型模型「先思考、后回答」导致输出为空的问题，内置 `max_tokens` 自动加码重试与 JSON 截断修复。
- **DXF / JSON 线框**：解析为墙体线段，直接生成平面图。
- 图片在送入模型前用 Pillow 归一化（≤1280px、转 JPEG/PNG），规避格式不支持问题。

### 4. AI 自然语言布置
- 输入「在客厅放一个沙发」之类的指令，自动放置家具：
  - 已配置 LLM 时调用大模型解析意图；
  - 未配置时回落到内置启发式（识别「家具类型 + 房间名」→ 放置到房间中心）。

### 5. 系统设置与可观测性
- 大模型配置：Base URL、API Key、模型名、视觉模型、最大输出 tokens、识别提示词（可覆盖内置提示词）。
- 大模型调用日志：记录每次调用的模型、耗时、状态、返回预览，便于排查空回复等问题。
- 家具默认值覆盖：按类型自定义标签 / 尺寸 / 颜色。

### 6. 项目管理
- 支持多项目；项目内可设置比例、缩放、区域，支持复制、重命名。

---

## 二、技术架构选型

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 后端框架 | **FastAPI** + uvicorn | 单进程同时提供 REST API 与前端静态资源（单端口），`/health`、`/ready` 健康检查。 |
| 存储 | **SQLite**（单文件） | 零运维；持久化项目、设置、LLM 调用日志。**LLM API Key 仅存于本地 SQLite，不写入代码、不上传。** |
| 前端 | **原生 JS（无打包）** | `index.html` + `static/`，免 npm build；2D 编辑器用 **Canvas2D** 自绘，3D 预览用 **Three.js**。 |
| AI 接入 | OpenAI 兼容接口 | 通过环境变量或网页设置接入 DeepSeek 等；支持多模态视觉识别与推理型模型。 |
| 图像处理 | **Pillow** | 上传图片归一化，避免模型不支持的格式。 |
| 解析 | 自研 DXF / JSON 线框解析 | 轻量，无第三方 CAD 依赖。 |

### 目录结构
```
.
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI 入口（API + 静态资源）
│   │   ├── config.py        # 配置（全部来自环境变量）
│   │   ├── db.py            # SQLite 初始化与数据访问
│   │   ├── vision.py        # 多模态图纸识别（含重试 / 修复）
│   │   ├── ai_agent.py      # 自然语言布置（LLM + 启发式兜底）
│   │   ├── cad_parser.py    # DXF / JSON 线框解析
│   │   ├── scene.py         # 场景模型与转换
│   │   ├── settings.py      # 系统设置 / 提示词
│   │   └── routers/         # 项目 / 平面图 / AI / 设置 路由
│   └── requirements.txt
├── frontend/
│   ├── index.html           # 主界面
│   ├── settings.html        # 系统设置页
│   └── static/
│       ├── js/              # editor2d / editor3d / app / api / settings
│       └── css/             # 样式
├── samples/                 # 示例平面图（sample_flat.json）
├── init.sh / start.sh / stop.sh
└── README.md
```

---

## 三、启动方法

### 环境要求
- Python 3.10+
- 操作系统：macOS / Linux / Windows（WSL）

### 1. 获取代码
```bash
git clone <本仓库地址>
cd house-design-3d
```

### 2. 初始化（创建虚拟环境并安装依赖）
```bash
./init.sh
```
或手动：
```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
```

### 3.（可选）配置大模型
任选其一：
- **环境变量**（推荐，不写盘）：
  ```bash
  export LLM_API_KEY="sk-..."
  export LLM_BASE_URL="https://api.deepseek.com/v1"
  export LLM_MODEL="deepseek-chat"
  ```
- 或在启动后于网页【系统设置】中填写（仅保存在本地 SQLite）。

> 不配置也能用：AI 识别与布置会回落到内置启发式，其余编辑功能完全可用。

### 4. 启动服务
```bash
./start.sh
```
等价于：
```bash
source .venv/bin/activate
export PYTHONPATH="$(pwd)"
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

### 5. 访问
浏览器打开 **http://localhost:8000**

### 6. 停止
```bash
./stop.sh
```

### 运行期自动生成的目录（已 gitignore，无需手动管理）
- `data/`：SQLite 数据库（含项目数据与 LLM Key）
- `uploads/`：用户上传的户型图

---

## 四、安全与隐私说明
- **不收集任何个人数据**：项目数据、上传图片、LLM API Key 均仅存于本地 `data/` 与 `uploads/`（已被 `.gitignore` 排除，不会提交到仓库）。
- 仓库内**不含**任何密钥、绝对路径或个人身份信息；所有敏感配置均通过环境变量或本地数据库注入。
- 默认监听 `0.0.0.0:8000`，仅在受信任的本地 / 内网环境使用；如需公网暴露请自行加反向代理与鉴权。

---

## 五、License
本项目仅供学习与自用。如需商用或二次分发，请自行确认相关许可。
