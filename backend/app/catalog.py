"""家具目录：默认尺寸（mm，实际尺寸）与卡通配色。"""

# 房间配色（卡通、明亮，互相区分）
ROOM_PALETTE = [
    "#FFD9A0",  # 暖橙
    "#A8E6CF",  # 薄荷绿
    "#A0D8FF",  # 天蓝
    "#FFB3BA",  # 粉红
    "#E0BBE4",  # 藕紫
    "#FFF5A0",  # 鹅黄
    "#C9C9FF",  # 浅紫
    "#FFC8A2",  # 蜜桃
]

# 家具默认规格：width(宽) x depth(进深)，单位 mm（实际尺寸）
FURNITURE_DEFAULTS = {
    "bed":      {"label": "床",     "width": 1500, "depth": 2000, "color": "#8E7CC3"},
    "sofa":     {"label": "沙发",   "width": 2100, "depth": 900,  "color": "#E67C73"},
    "table":    {"label": "桌子",   "width": 1400, "depth": 800,  "color": "#F6BF26"},
    "chair":    {"label": "椅子",   "width": 480,  "depth": 500,  "color": "#43A047"},
    "fridge":   {"label": "冰箱",   "width": 700,  "depth": 700,  "color": "#9E9E9E"},
    "cabinet":  {"label": "柜子",   "width": 1200, "depth": 600,  "color": "#A1887F"},
    "bookshelf":{"label": "书架",   "width": 900,  "depth": 350,  "color": "#5C6BC0"},
    "tv":       {"label": "电视柜", "width": 1800, "depth": 400,  "color": "#37474F"},
    "plant":    {"label": "绿植",   "width": 500,  "depth": 500,  "color": "#2E7D32"},
    "toilet":   {"label": "马桶",   "width": 400,  "depth": 700,  "color": "#B0BEC5"},
    "stove":    {"label": "灶具",   "width": 600,  "depth": 600,  "color": "#37474F"},
    "sink":     {"label": "水盆",   "width": 800,  "depth": 500,  "color": "#90A4AE"},
    "image":    {"label": "自定义", "width": 800,  "depth": 800,  "color": "#90A4AE"},
}

# 家具默认高度（mm，实际尺寸），与 3D 渲染共用
FURNITURE_HEIGHTS = {
    "bed": 550,        # 含床垫的床面高
    "sofa": 850,       # 靠背顶高
    "table": 750,      # 桌面高
    "chair": 900,      # 椅背高
    "fridge": 1800,    # 双门冰箱
    "cabinet": 2000,   # 衣柜
    "bookshelf": 2000,
    "tv": 450,         # 电视地柜
    "plant": 1200,     # 落地盆栽
    "toilet": 700,     # 含水箱
    "stove": 850,      # 灶台面高
    "sink": 900,       # 台面高（含水盆）
    "image": 1500,
}

FURNITURE_TYPES = list(FURNITURE_DEFAULTS.keys())


def get_furniture_defaults():
    """基础默认值 + 用户在系统设置里的覆盖，返回统一的规格字典（含 height）。"""
    from .settings import get_furniture_overrides

    out = {}
    for k, v in FURNITURE_DEFAULTS.items():
        out[k] = {
            "label": v["label"],
            "width": v["width"],
            "depth": v["depth"],
            "color": v["color"],
            "height": FURNITURE_HEIGHTS.get(k, 800),
        }
    for k, ov in (get_furniture_overrides() or {}).items():
        if k in out and isinstance(ov, dict):
            out[k].update({f: val for f, val in ov.items() if f in ("label", "width", "depth", "height", "color")})
    return out

# 墙体类型（kind）：普通墙 / 承重墙 / 玻璃墙 / 梁 / 柱
WALL_KINDS = [
    ("normal",  "普通墙"),
    ("bearing", "承重墙"),
    ("glass",   "玻璃墙"),
    ("beam",    "梁"),
    ("column",  "柱"),
]
WALL_KIND_LABELS = {k: label for k, label in WALL_KINDS}

# 各类墙体默认厚度（mm，实际尺寸）
WALL_KIND_THICKNESS = {
    "normal":  150,   # 普通墙 0.15m
    "bearing": 300,   # 承重墙 0.3m
    "glass":   150,   # 玻璃墙
    "beam":    200,   # 梁
    "column":  700,   # 柱 0.7m x 0.7m
}

# 门的开门方向（6 种）
DOOR_DIRS = [
    ("left_in",   "左侧向里开"),
    ("left_out",  "左侧向外开"),
    ("right_in",  "右侧向里开"),
    ("right_out", "右侧向外开"),
    ("double_in", "两侧双门向里开"),
    ("double_out","两侧双门向外开"),
]
DOOR_DIR_LABELS = {k: label for k, label in DOOR_DIRS}

