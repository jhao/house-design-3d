"""房间识别与面积计算。

策略：把墙体栅格化到网格，对"空白"区域做泛洪填充（flood fill），
每个连通分量即为一个房间。面积 = 格子数 × 单格面积。
由于房间互不重叠，求和天然不会重复计算。
"""
from .catalog import ROOM_PALETTE


def polygon_area(points):
    """鞋带公式，返回多边形面积（平方单位）。points: [[x,y],...]"""
    n = len(points)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def _dist_to_segment(px, py, x1, y1, x2, y2):
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx = x1 + t * dx
    cy = y1 + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def _raster_wall(grid, cols, rows, minx, miny, cell, x1, y1, x2, y2, thickness):
    r = max(thickness / 2.0, cell)
    steps = max(2, int(((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5 / (cell / 2)))
    for s in range(steps + 1):
        t = s / steps
        cx = x1 + t * (x2 - x1)
        cy = y1 + t * (y2 - y1)
        # mark cells within radius r of (cx,cy)
        c0 = int((cx - r - minx) // cell)
        c1 = int((cx + r - minx) // cell)
        r0 = int((cy - r - miny) // cell)
        r1 = int((cy + r - miny) // cell)
        for c in range(max(0, c0), min(cols, c1 + 1)):
            for rr in range(max(0, r0), min(rows, r1 + 1)):
                wx = minx + (c + 0.5) * cell
                wy = miny + (rr + 0.5) * cell
                if _dist_to_segment(wx, wy, x1, y1, x2, y2) <= r:
                    grid[c][rr] = 1


def detect_rooms(walls, cell=50, min_area=1.0):
    """根据墙体线段识别房间。返回 rooms 列表（含 points 与 area，单位与墙体一致，即 mm）。"""
    if not walls:
        return []
    xs, ys = [], []
    for w in walls:
        xs += [w["x1"], w["x2"]]
        ys += [w["y1"], w["y2"]]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    cols = max(1, int((maxx - minx) // cell) + 1)
    rows = max(1, int((maxy - miny) // cell) + 1)
    grid = [[0] * rows for _ in range(cols)]
    for w in walls:
        _raster_wall(grid, cols, rows, minx, miny, cell,
                     w["x1"], w["y1"], w["x2"], w["y2"], w.get("thickness", 200))
    visited = [[False] * rows for _ in range(cols)]
    rooms = []
    rid = 0
    for c in range(cols):
        for r in range(rows):
            if grid[c][r] == 0 and not visited[c][r]:
                stack = [(c, r)]
                visited[c][r] = True
                comp = []
                while stack:
                    cc, rr = stack.pop()
                    comp.append((cc, rr))
                    for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nc, nr = cc + dc, rr + dr
                        if 0 <= nc < cols and 0 <= nr < rows and not visited[nc][nr] and grid[nc][nr] == 0:
                            visited[nc][nr] = True
                            stack.append((nc, nr))
                area = len(comp) * cell * cell
                if area < cell * cell * 6:  # 忽略极小缝隙
                    continue
                # 与网格边界相连的区域视为"室外"，排除（只保留封闭室内房间）
                touches_border = any(cc == 0 or cc == cols - 1 or rr == 0 or rr == rows - 1 for cc, rr in comp)
                if touches_border:
                    continue
                mask = set(comp)
                contour = _trace_contour(mask, cols, rows)
                if len(contour) >= 3:
                    points = _contour_to_world(contour, minx, miny, cell)
                else:
                    # 退化情况回退到包围盒
                    cs = [p[0] for p in comp]
                    rrs = [p[1] for p in comp]
                    x0, x1 = min(cs), max(cs)
                    y0, y1 = min(rrs), max(rrs)
                    points = [
                        [minx + x0 * cell, miny + y0 * cell],
                        [minx + (x1 + 1) * cell, miny + y0 * cell],
                        [minx + (x1 + 1) * cell, miny + (y1 + 1) * cell],
                        [minx + x0 * cell, miny + (y1 + 1) * cell],
                    ]
                centroid = _polygon_centroid(points)
                rooms.append({
                    "id": f"r{rid}",
                    "name": f"房间{rid + 1}",
                    "color": ROOM_PALETTE[rid % len(ROOM_PALETTE)],
                    "points": points,
                    "area": area,
                    "centroid": centroid,
                })
                rid += 1
    return rooms


def room_centroid(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def _trace_contour(mask, cols, rows):
    """Moore 邻域边界追踪：给定区域内像素集合 mask，返回闭合的边界像素序列 (c, r)。

    用于把泛洪得到的房间连通域还原成真实轮廓多边形（可包含斜墙 / L 形等非矩形形状），
    从而面积和着色都准确，而不是用包围盒（矩形）近似（会把斜墙房间多算面积）。
    """
    if not mask:
        return []
    inside = lambda c, r: 0 <= c < cols and 0 <= r < rows and (c, r) in mask
    # 起点：最上(行最小)、再最左。其"上方"必为空，故回溯方向为 S(索引 2)。
    start = min(mask, key=lambda p: (p[1], p[0]))
    NBR = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]  # 顺时针 E,SE,S,SW,W,NW,N,NE
    back = 2
    contour = [start]
    b = start
    guard = 0
    while True:
        found = None
        for i in range(1, 9):
            d = NBR[(back + i) % 8]
            nc, nr = b[0] + d[0], b[1] + d[1]
            if inside(nc, nr):
                found = (nc, nr)
                back = (NBR.index(d) + 4) % 8
                break
        if found is None or found == start:
            break
        if found != contour[-1]:
            contour.append(found)
        b = found
        guard += 1
        if guard > 8 * len(mask) + 64:
            break
    return contour


def _contour_to_world(contour, minx, miny, cell):
    """边界像素中心 -> 世界坐标(mm)。向外偏移 0.5 格以贴合真实房间边界。"""
    pts = []
    n = len(contour)
    if n < 3:
        return pts
    for i in range(n):
        c, r = contour[i]
        pc, pr = contour[(i - 1) % n]
        nc, nr = contour[(i + 1) % n]
        # 外法向（相邻边中点差）用于向外偏移半格
        mx1, my1 = (c + pc) / 2.0 - c, (r + pr) / 2.0 - r
        mx2, my2 = (c + nc) / 2.0 - c, (r + nr) / 2.0 - r
        ox = mx1 + mx2
        oy = my1 + my2
        ml = (ox * ox + oy * oy) ** 0.5 or 1
        offc = c + ox / ml * 0.5
        offr = r + oy / ml * 0.5
        pts.append([minx + offc * cell, miny + offr * cell])
    return pts


def _polygon_centroid(points):
    n = len(points)
    if n < 3:
        return room_centroid(points) if points else (0, 0)
    a = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        cr = x1 * y2 - x2 * y1
        a += cr
        cx += (x1 + x2) * cr
        cy += (y1 + y2) * cr
    a *= 0.5
    if abs(a) < 1e-9:
        return room_centroid(points)
    return (cx / (6 * a), cy / (6 * a))
