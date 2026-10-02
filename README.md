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
- **透明墙（默认开启）**：3D 视图中普通墙 / 承重墙默认半透明（opacity ≈ 0.34，双面 + 不写深度），可从外部看穿到室内。工具栏「🧱 透明墙」可一键切换回实心墙。
- **玻璃双向透视**：玻璃墙（kind=glass）始终是最透的面（opacity ≈ 0.2，比普通半透明墙更清楚），窗玻璃 opacity ≈ 0.16，均 `双面渲染 + 不写深度 + renderOrder=2`（最后绘制）。无论从室内还是室外、透过玻璃墙一侧还是窗户，都能清楚看到另一侧的内容。
- **人物模型**：头部补齐眉 / 眼 / 鼻 / 口 / 耳五官并保持微笑；属性面板可改「衣服颜色」与「发型（短发 / 中发 / 长发）」。
- **真实家具比例**：开启「🪑 家具渲染」后，床 / 沙发 / 桌 / 椅 / 马桶等按真实高度建模（1 显示单位 = 0.2m），高度与现实一致。
- **默认近距离取景**：2D→3D 默认相机已拉近（距 = 场景跨度 ×0.85，低视角），不会一进来就离得太远。工具栏「🎯 复位视角」可随时清除已保存的视角、按默认近距离重新取景。
- **重建节流**：改色 / 拖拽等连续操作触发 3D 重建时，统一入口 `build3d()` 用 `requestAnimationFrame` 合并为「每帧最多一次」，避免整场景反复重建打满主线程。

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

### 7. 编辑交互增强
- **复制 / 粘贴置顶**：`⌘/Ctrl + C / X / V` 复制粘贴，新元素置于同层最上方，粘贴后自动选中、可直接拖拽。
- **完全包含式框选**：框选时只有「完全落在选框内」的元素才会被选中，部分重叠不选中。
- **光标语义**：移动元素时显示十字光标（`crosshair`）；拖拽墙端点改长度、沿墙拖拽门窗时显示小手光标（`grab`/`grabbing`）。
- **Alt 平移**：未选中任何元素时，按住 `Alt/Option` 再左键拖拽 = 右键效果（平移画布）。
- **缩放持久化**：缩放 / 平移比例按项目 id 存入 `localStorage`，刷新页面或点「识别房间」后仍保持，不会复位。
- **项目独立地址**：每个项目对应独立 URL（地址栏 `#/p/<项目id>`），刷新页面或浏览器前进 / 后退都会停在同一项目；切换项目时地址栏同步更新。
- **2D ⇄ 3D 视角保持**：2D 缩放比例与 3D 相机位置（含水平面 target）均按项目持久化，2D / 3D 来回切换不丢失各自视角。
- **3D 下 Alt = 右键**：3D 视图中按住 `Alt/Option` 时左键等同右键（平移画布），松开恢复左键旋转。
- **面积统计滚动**：右侧面积统计超过 10 个房间时显示区域内滚动条，不再无限伸长。

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

---

## 六、标准动作 API（供 AI / MCP 调用）

所有「对画布的修改」都收敛为一组结构化**动作（action）**，由后端统一执行。前端交互、AI 助手、以及未来的 MCP 工具走的是同一套语义接口，行为一致、可审计、可重放。

- 执行器：`backend/app/actions.py` → `apply_actions(scene, actions)` 返回 `(新场景, 报告)`。
- REST 接口：`POST /api/projects/{pid}/apply_actions`，请求体 `{ "actions": [...], "message": "可选备注" }`。
- 自然语言入口：`POST /api/projects/{pid}/ai_arrange`，由大模型把一句话翻译成动作后执行（未配置 LLM 时回落内置启发式）。

动作示例（`op` 取值）：

| op | 说明 | 关键参数 |
| --- | --- | --- |
| `add_furniture` | 新增家具 | `type, x, y, 可选 width/depth/rotation/color/label` |
| `update_furniture` | 修改家具 | `id, x?, y?, width?, depth?, rotation?, color?, label?` |
| `add_character` | 新增人物 | `x, y, 可选 height/rotation/state/color` |
| `update_character` | 修改人物 | `id, x?, y?, height?, rotation?, state?, color?` |
| `move_element` | 平移元素 | `type, id, dx?, dy?, x?, y?`（`type` ∈ furniture/character/wall/room/opening） |
| `add_wall` | 新增墙 | `x1, y1, x2, y2, 可选 kind/thickness/height` |
| `update_wall` | 修改墙 | `id, x1?, y1?, x2?, y2?, kind?, thickness?, height?` |
| `add_opening` | 新增门窗 | `wall_id, opening_type, 可选 offset/width/height/dir` |
| `update_opening` | 修改门窗 | `id, wall_id?, offset?, width?, height?, dir?` |
| `delete_element` | 删除元素 | `type, id`（`type` ∈ wall/opening/furniture/character/room） |

坐标单位：**mm（世界坐标）**。门窗 `offset` 为沿所属墙起点起算的弧长，执行时会自动夹紧在墙段内；删除墙会连带删除其上的门窗。

> MCP 接入思路：MCP 工具只需把「用户意图」转换为上述 action 数组，再调用 `apply_actions` 接口即可，无需关心前端渲染细节。
