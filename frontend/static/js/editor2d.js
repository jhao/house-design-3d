// 2D 编辑器：平移 / 缩放 / 旋转 / 框选 / 多元素移动 / 点选 / 拖拽 / 手绘墙体 / 人物
// 坐标体系：世界(mm) -> 展示(÷200) -> 屏幕(缩放+旋转+平移)
class Editor2D {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.opts = opts; // { onSelect, onSceneChange, onViewChange, wallThickness }
    this.scene = { walls: [], openings: [], rooms: [], furniture: [], characters: [] };
    this.view = { panX: 0, panY: 0, zoom: 1, angle: 0 };
    this.center = { x: 0, y: 0 }; // 展示坐标下的场景中心（旋转支点）
    this.selection = null;        // 主选中（用于属性面板）
    this.selectionSet = [];       // 圈选集合（用于整体移动）：[{type,id}]
    this._drag = null;
    this._panning = false;
    this._images = {};
    this.drawMode = false;
    this._drawStart = null;
    this._drawPreview = null;
    this._marquee = null;         // 框选矩形（屏幕坐标）
    this.SNAP_PX = 12;
    this.ANGLE_TOL = 6 * Math.PI / 180;
    this.minimap = null; this.mctx = null; this._miniCss = { w: 200, h: 120 }; this._miniMap = null;
    this._miniDrag = false;
    this._undo = []; this._redo = []; this._lastNudge = 0;
    this.projectId = null;   // 当前项目 id（用于按项目持久化视图）
    this._viewInit = false;  // 当前项目是否已加载过视图（避免重复 reset）

    // 缩放标定：100% 时 1m 网格 = 50px（屏幕）
    this.PPM100 = 50;
    this.MIN_PCT = 5;
    this.MAX_PCT = 800;

    this._bind();
    this.resize();
  }

  get DR() { return (this.scene && this.scene.display_ratio) || 200; }
  get WALL_THICK() {
    return (this.opts && this.opts.wallThickness) || { normal: 150, bearing: 300, glass: 150, beam: 200, column: 700 };
  }

  setScene(scene, keepView) {
    this.scene = scene || { walls: [], openings: [], rooms: [], furniture: [], characters: [] };
    this.selection = null; this.selectionSet = [];
    if (!this.cw || !this.ch) this.resize();
    // 保持视图：刷新页面 / 识别房间后不丢失缩放比例（按项目 id 恢复本地存储的视图）
    if (keepView) {
      if (!this._viewInit) { this._viewInit = true; if (!this._loadView()) this.resetZoom(); }
    } else {
      if (!this._loadView()) this.resetZoom();
    }
    this.render();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, r.width * dpr);
    this.canvas.height = Math.max(1, r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cw = r.width; this.ch = r.height;
    this.render();
  }

  // ---- 视图缩放（百分比标定：100% => 1m 网格 = 50px）----
  get pxPerMeter() { return this.view.zoom * 1000 / this.DR; }
  get zoomPercent() { return Math.round(this.pxPerMeter / this.PPM100 * 100); }
  _zoomFromPercent(p) { return (p / 100) * this.PPM100 * this.DR / 1000; }
  _clampZoom(z) {
    return Math.max(this._zoomFromPercent(this.MIN_PCT), Math.min(this._zoomFromPercent(this.MAX_PCT), z));
  }

  setZoomPercent(p, anchor) {
    const z = this._clampZoom(this._zoomFromPercent(p));
    if (anchor) {
      const wb = this.screenToWorld(anchor[0], anchor[1]);
      this.view.zoom = z;
      const v = this._rot(wb.x / this.DR - this.center.x, wb.y / this.DR - this.center.y);
      this.view.panX = anchor[0] - this.cw / 2 - z * v.x;
      this.view.panY = anchor[1] - this.ch / 2 - z * v.y;
    } else {
      const wc = this.screenToWorld(this.cw / 2, this.ch / 2);
      this.view.zoom = z;
      const v = this._rot(wc.x / this.DR - this.center.x, wc.y / this.DR - this.center.y);
      this.view.panX = -z * v.x; this.view.panY = -z * v.y;
    }
    this.render(); this._notifyView();
  }
  zoomBy(factor, anchor) {
    const p = this.pxPerMeter / this.PPM100 * 100 * factor;
    this.setZoomPercent(p, anchor || [this.cw / 2, this.ch / 2]);
  }
  _notifyView() { this.saveView(); if (this.opts.onViewChange) this.opts.onViewChange(this.view, this.zoomPercent); }

  // 默认视图：100%（1m = 50px），对准场景中心
  resetZoom() {
    const b = this._bounds();
    this.view.panX = 0; this.view.panY = 0; this.view.angle = 0;
    this.view.zoom = this._zoomFromPercent(100);
    this.center = b ? { x: (b.minx + b.maxx) / 2 / this.DR, y: (b.miny + b.maxy) / 2 / this.DR } : { x: 0, y: 0 };
  }

  // 适应窗口
  fitView() {
    const b = this._bounds();
    this.view.panX = 0; this.view.panY = 0; this.view.angle = 0;
    if (!b) { this.center = { x: 0, y: 0 }; this.view.zoom = this._zoomFromPercent(100); return; }
    this.center = { x: (b.minx + b.maxx) / 2 / this.DR, y: (b.miny + b.maxy) / 2 / this.DR };
    const wDisp = (b.maxx - b.minx) / this.DR;
    const hDisp = (b.maxy - b.miny) / this.DR;
    const pad = 1.3;
    let zoom = Math.min(this.cw / (wDisp * pad || 1), this.ch / (hDisp * pad || 1));
    if (!isFinite(zoom) || zoom <= 0) zoom = this._zoomFromPercent(100);
    this.view.zoom = this._clampZoom(zoom);
    this._notifyView();   // 适应窗口的结果也持久化
  }

  // ---- 视图持久化（按项目 id 存入 localStorage）----
  setProjectId(pid) {
    this.projectId = pid || null;
    this._viewInit = false;     // 下一个 setScene 会按新项目恢复视图
    this._loadView();
  }
  _viewKey() { return "houseview:" + (this.projectId || "default"); }
  saveView() {
    try {
      localStorage.setItem(this._viewKey(), JSON.stringify({
        zoom: this.view.zoom, panX: this.view.panX, panY: this.view.panY,
        angle: this.view.angle, cx: this.center.x, cy: this.center.y,
      }));
    } catch (e) { /* localStorage 不可用时静默忽略 */ }
  }
  _loadView() {
    try {
      const s = localStorage.getItem(this._viewKey());
      if (!s) return false;
      const v = JSON.parse(s);
      this.view.zoom = v.zoom; this.view.panX = v.panX; this.view.panY = v.panY;
      this.view.angle = v.angle || 0;
      if (v.cx !== undefined && v.cy !== undefined) this.center = { x: v.cx, y: v.cy };
      this.render(); this._notifyView();
      return true;
    } catch (e) { return false; }
  }

  _bounds() {
    const pts = [];
    for (const w of this.scene.walls || []) pts.push([w.x1, w.y1], [w.x2, w.y2]);
    for (const f of this.scene.furniture || []) pts.push([f.x, f.y]);
    for (const c of this.scene.characters || []) pts.push([c.x, c.y]);
    if (!pts.length) return null;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { minx: Math.min(...xs), maxx: Math.max(...xs), miny: Math.min(...ys), maxy: Math.max(...ys) };
  }

  // ---- 坐标变换 ----
  _rot(dx, dy) { const a = this.view.angle; return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) }; }
  _iro(dx, dy) { const a = this.view.angle; return { x: dx * Math.cos(a) + dy * Math.sin(a), y: -dx * Math.sin(a) + dy * Math.cos(a) }; }
  worldToScreen(wx, wy) {
    const dx = wx / this.DR - this.center.x, dy = wy / this.DR - this.center.y;
    const r = this._rot(dx, dy);
    return [this.cw / 2 + this.view.panX + this.view.zoom * r.x, this.ch / 2 + this.view.panY + this.view.zoom * r.y];
  }
  screenToWorld(sx, sy) {
    const rx = (sx - this.cw / 2 - this.view.panX) / this.view.zoom;
    const ry = (sy - this.ch / 2 - this.view.panY) / this.view.zoom;
    const d = this._iro(rx, ry);
    return { x: (d.x + this.center.x) * this.DR, y: (d.y + this.center.y) * this.DR };
  }
  _s(wx, wy) { return this.worldToScreen(wx, wy); }

  rotateView(deltaDeg) {
    this.view.angle += deltaDeg * Math.PI / 180;
    this.render();
    this.opts.onViewChange && this.opts.onViewChange(this.view);
  }

  // ---- 吸附与铆钉 ----
  _snapWorld() { return (this.SNAP_PX / (this.view.zoom || 1)) * this.DR; }

  _nearestVertex(wx, wy, exclude) {
    let best = null, bestD = Infinity;
    for (const w of this.scene.walls || []) {
      const ends = [[w.x1, w.y1, "a"], [w.x2, w.y2, "b"]];
      for (const [x, y, end] of ends) {
        if (exclude && Math.abs(x - exclude.x) < 1 && Math.abs(y - exclude.y) < 1) continue;
        const d = Math.hypot(x - wx, y - wy);
        if (d < bestD) { bestD = d; best = { x, y, end, w }; }
      }
    }
    if (!best) return null;
    const px = best.x, py = best.y;
    const walls = [];
    for (const w of this.scene.walls || []) {
      if (Math.abs(w.x1 - px) < 1 && Math.abs(w.y1 - py) < 1) walls.push({ wall: w, end: "a" });
      if (Math.abs(w.x2 - px) < 1 && Math.abs(w.y2 - py) < 1) walls.push({ wall: w, end: "b" });
    }
    return { x: px, y: py, walls, d: bestD };
  }

  _snapDraw(start, cand) {
    const v = this._nearestVertex(cand.x, cand.y, null);
    if (v && v.d <= this._snapWorld()) return { x: v.x, y: v.y, snap: "vertex" };
    return this._snapAngle(start, cand);
  }

  _snapVertexMove(cand, affected, exclude) {
    const sw = this._snapWorld();
    const v = this._nearestVertex(cand.x, cand.y, exclude);
    if (v && v.d <= sw) return { x: v.x, y: v.y };
    for (const a of affected) {
      const wall = a.wall;
      const other = a.end === "a" ? { x: wall.x2, y: wall.y2 } : { x: wall.x1, y: wall.y1 };
      const dx = cand.x - other.x, dy = cand.y - other.y;
      const ang = Math.atan2(dy, dx);
      let ax = dx, ay = dy;
      if (Math.abs(ang) <= this.ANGLE_TOL || Math.abs(Math.abs(ang) - Math.PI) <= this.ANGLE_TOL) ay = 0;
      else if (Math.abs(Math.abs(ang) - Math.PI / 2) <= this.ANGLE_TOL) ax = 0;
      if (ay === 0 || ax === 0) {
        const nx = other.x + ax, ny = other.y + ay;
        if (Math.hypot(nx - cand.x, ny - cand.y) <= sw) return { x: nx, y: ny };
      }
    }
    return cand;
  }

  _snapAngle(start, cand) {
    const dx = cand.x - start.x, dy = cand.y - start.y;
    const ang = Math.atan2(dy, dx);
    let ax = dx, ay = dy;
    if (Math.abs(ang) <= this.ANGLE_TOL || Math.abs(Math.abs(ang) - Math.PI) <= this.ANGLE_TOL) ay = 0;
    else if (Math.abs(Math.abs(ang) - Math.PI / 2) <= this.ANGLE_TOL) ax = 0;
    return { x: start.x + ax, y: start.y + ay, snap: "angle" };
  }

  toggleDraw() {
    this.drawMode = !this.drawMode;
    this._drawStart = null; this._drawPreview = null;
    this.canvas.style.cursor = this.drawMode ? "crosshair" : "default";
    this.render();
    return this.drawMode;
  }

  _addWall(p1, p2) {
    const id = `w${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const kind = "normal";
    const w = { id, x1: Math.round(p1.x), y1: Math.round(p1.y), x2: Math.round(p2.x), y2: Math.round(p2.y),
                thickness: this.WALL_THICK[kind] || 150, height: this.scene.ceiling_height || 2900, kind };
    this.scene.walls.push(w);
    this.opts.onSceneChange && this.opts.onSceneChange();
    return w;
  }

  // ---- 渲染 ----
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.cw, this.ch);
    this._drawGrid();

    for (const room of this.scene.rooms || []) this._drawRoom(room);
    for (const w of this.scene.walls || []) this._drawWall(w);
    for (const o of this.scene.openings || []) this._drawOpening(o);
    for (const f of this.scene.furniture || []) this._drawFurniture(f);
    for (const c of this.scene.characters || []) this._drawCharacter(c);

    if (this.drawMode && this._drawStart) {
      const s = this._drawStart, e = this._drawPreview || s;
      const [x1, y1] = this._s(s.x, s.y), [x2, y2] = this._s(e.x, e.y);
      ctx.strokeStyle = "#ff8a5b"; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#ff3b30"; ctx.beginPath(); ctx.arc(x1, y1, 4, 0, Math.PI * 2); ctx.fill();
    }

    this._drawSelection();
    if (this._marquee) this._drawMarquee();
    if (this.minimap) this._drawMinimap();
  }

  // 背景网格：细虚线 = 0.1m，实线 = 1m（100% 时 1m = 50px）
  _drawGrid() {
    const ctx = this.ctx;
    ctx.fillStyle = "#fbfaf7";
    ctx.fillRect(0, 0, this.cw, this.ch);

    const ppm = this.pxPerMeter;
    const corners = [this.screenToWorld(0, 0), this.screenToWorld(this.cw, 0),
                     this.screenToWorld(this.cw, this.ch), this.screenToWorld(0, this.ch)];
    const minWX = Math.min(...corners.map(c => c.x)), maxWX = Math.max(...corners.map(c => c.x));
    const minWY = Math.min(...corners.map(c => c.y)), maxWY = Math.max(...corners.map(c => c.y));

    const drawLines = (step, style, dash, maxCount) => {
      const n = ((maxWX - minWX) + (maxWY - minWY)) / step;
      if (n > maxCount) return;
      ctx.save();
      ctx.strokeStyle = style; ctx.lineWidth = 1;
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      for (let x = Math.floor(minWX / step) * step; x <= maxWX; x += step) {
        const [ax, ay] = this._s(x, minWY), [bx, by] = this._s(x, maxWY);
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      }
      for (let y = Math.floor(minWY / step) * step; y <= maxWY; y += step) {
        const [ax, ay] = this._s(minWX, y), [bx, by] = this._s(maxWX, y);
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      }
      ctx.stroke();
      ctx.restore();
    };

    if (ppm * 0.1 >= 4.5) drawLines(100, "rgba(118,114,104,0.20)", [2, 3], 2400);  // 0.1m 虚线
    drawLines(1000, "rgba(110,105,95,0.30)", null, 400);                            // 1m 实线
  }

  _drawRoom(room) {
    const ctx = this.ctx;
    const pts = room.points || [];
    if (pts.length < 3) return;
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = this._s(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath();
    const col = room.color || "#FFD9A0";
    ctx.fillStyle = this._alpha(col, 0.85); ctx.fill();
    ctx.strokeStyle = "rgba(60,55,48,0.10)"; ctx.lineWidth = 1; ctx.stroke();

    // 房间标签（名称 + 面积）
    const c = this._centroid(pts);
    const [lx, ly] = this._s(c[0], c[1]);
    if (lx < -100 || ly < -100 || lx > this.cw + 100 || ly > this.ch + 100) return;
    const area = (room.area || 0) / 1e6;
    const t1 = room.name || "房间";
    const t2 = area.toFixed(2) + " m²";
    ctx.save();
    ctx.font = "700 12px 'PingFang SC', 'Microsoft YaHei', sans-serif";
    const w1 = ctx.measureText(t1).width;
    ctx.font = "11px 'PingFang SC', 'Microsoft YaHei', sans-serif";
    const w2 = ctx.measureText(t2).width;
    const bw = Math.max(w1, w2) + 22, bh = 36;
    roundRect(ctx, lx - bw / 2, ly - bh / 2, bw, bh, 8);
    ctx.fillStyle = col; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.10)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#2f2b26";
    ctx.font = "700 12px 'PingFang SC', 'Microsoft YaHei', sans-serif";
    ctx.fillText(t1, lx, ly - 7);
    ctx.fillStyle = "rgba(40,36,30,0.72)";
    ctx.font = "11px 'PingFang SC', 'Microsoft YaHei', sans-serif";
    ctx.fillText(t2, lx, ly + 8);
    ctx.restore();
  }

  _drawWall(w) {
    const kind = w.kind || "normal";
    if (kind === "column") return this._drawColumn(w);
    if (kind === "beam") return this._drawBeam(w);
    const ctx = this.ctx;
    const [x1, y1] = this._s(w.x1, w.y1), [x2, y2] = this._s(w.x2, w.y2);
    const t = Math.max(3.5, (w.thickness || 150) / this.DR * this.view.zoom);
    const pal = {
      normal:  ["#26231f", "#3f3b35"],
      bearing: ["#141210", "#26231f"],
      glass:   ["#4b93c4", "rgba(163,214,244,0.55)"],
    }[kind] || ["#26231f", "#3f3b35"];
    ctx_line(ctx, x1, y1, x2, y2, t + 3, pal[0]);
    ctx_line(ctx, x1, y1, x2, y2, t, pal[1]);

    // 墙长标注（屏幕长度足够时显示，单位米）
    const lenPx = Math.hypot(x2 - x1, y2 - y1);
    if (lenPx < 52) return;
    const lenM = (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) / 1000).toFixed(2);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    let dx = x2 - x1, dy = y2 - y1; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const nx = -dy, ny = dx;
    const lx = mx + nx * (t / 2 + 10), ly = my + ny * (t / 2 + 10);
    ctx.save();
    ctx.font = "600 10px 'PingFang SC', 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const tw = ctx.measureText(lenM + "m").width + 10;
    roundRect(ctx, lx - tw / 2, ly - 7.5, tw, 15, 5);
    ctx.fillStyle = "rgba(255,255,255,0.88)"; ctx.fill();
    ctx.fillStyle = "#6b6355";
    ctx.fillText(lenM + "m", lx, ly);
    ctx.restore();
  }

  _drawColumn(w) {
    const ctx = this.ctx;
    const cx = (w.x1 + w.x2) / 2, cy = (w.y1 + w.y2) / 2;
    const side = Math.max((w.thickness || 700), 400);
    const t = side / this.DR * this.view.zoom;
    const [sx, sy] = this._s(cx, cy);
    ctx.fillStyle = "#3a3630"; ctx.strokeStyle = "#1c1a17"; ctx.lineWidth = 2;
    ctx.fillRect(sx - t / 2, sy - t / 2, t, t);
    ctx.strokeRect(sx - t / 2, sy - t / 2, t, t);
    if (t > 22) {
      ctx.fillStyle = "#fff"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("柱", sx, sy + 4);
    }
  }

  _drawBeam(w) {
    const ctx = this.ctx;
    const [x1, y1] = this._s(w.x1, w.y1), [x2, y2] = this._s(w.x2, w.y2);
    const bw = Math.max((w.thickness || 200), 160) / this.DR * this.view.zoom;
    const len = Math.hypot(x2 - x1, y2 - y1);
    ctx.save();
    ctx.translate((x1 + x2) / 2, (y1 + y2) / 2);
    ctx.rotate(Math.atan2(y2 - y1, x2 - x1));
    ctx.fillStyle = "#57534b"; ctx.strokeStyle = "#1c1a17"; ctx.lineWidth = 2;
    ctx.fillRect(-len / 2, -bw / 2, len, bw);
    ctx.strokeRect(-len / 2, -bw / 2, len, bw);
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1;
    for (let d = -len / 2; d < len / 2; d += 8) { ctx.beginPath(); ctx.moveTo(d, -bw / 2); ctx.lineTo(d + bw, bw / 2); ctx.stroke(); }
    ctx.restore();
    if (len > 52) {
      const [mx, my] = this._s((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2);
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("梁", mx, my - bw / 2 - 4);
    }
  }

  _wallPoint(w, offset) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy) || 1;
    return [w.x1 + dx / len * offset, w.y1 + dy / len * offset];
  }

  _drawOpening(o) {
    const ctx = this.ctx;
    const w = (this.scene.walls || []).find(x => x.id === o.wall_id);
    if (!w) return;
    const [px, py] = this._wallPoint(w, o.offset || 0);
    let dx = w.x2 - w.x1, dy = w.y2 - w.y1; const L = Math.hypot(dx, dy) || 1; dx/=L; dy/=L;
    const nx = -dy, ny = dx;
    const half = (o.width || 900) / 2;
    const t = (w.thickness || 150) / 2;
    const corners = [[px-dx*half+nx*t, py-dy*half+ny*t],[px+dx*half+nx*t, py+dy*half+ny*t],[px+dx*half-nx*t, py+dy*half-ny*t],[px-dx*half-nx*t, py-dy*half-ny*t]].map(([x, y]) => this._s(x, y));
    ctx.beginPath();
    corners.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.strokeStyle = o.type === "window" ? "#4b93c4" : "#8b8377"; ctx.lineWidth = 2; ctx.stroke();
    const [cx, cy] = this._s(px, py);
    if (Math.hypot((this._s(px + dx * half, py + dy * half)[0] - this._s(px - dx * half, py - dy * half)[0]),
                   (this._s(px + dx * half, py + dy * half)[1] - this._s(px - dx * half, py - dy * half)[1])) > 26) {
      ctx.fillStyle = "#6b6355"; ctx.font = "600 10px 'PingFang SC', sans-serif"; ctx.textAlign = "center";
      ctx.fillText(o.type === "window" ? "窗" : "门", cx, cy - 4);
    }

    // 门：按开门方向画门扇 + 开合弧
    if (o.type === "door" && o.dir) {
      const dir = o.dir;
      const ow = o.width || 900;                       // 门扇=整樘宽（与 3D 一致）
      const a = (o.offset || 0) - ow / 2, b = (o.offset || 0) + ow / 2;
      const inward = dir.endsWith("_out") ? 1 : -1;    // 向里=-n，向外=+n（与 3D 同一约定）
      const nvx = nx * inward, nvy = ny * inward;
      const theta = 35 * Math.PI / 180;
      const leaf = (hOff, s) => {
        const [hx0, hy0] = this._wallPoint(w, hOff);
        // 开合弧（0 → theta）：半径=整樘宽 ow
        ctx.strokeStyle = "rgba(139,131,119,0.6)"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath();
        for (let i = 0; i <= 10; i++) {
          const t = theta * i / 10;
          const pxw = hx0 + ow * (dx * s * Math.cos(t) + nvx * Math.sin(t));
          const pyw = hy0 + ow * (dy * s * Math.cos(t) + nvy * Math.sin(t));
          const [sx2, sy2] = this._s(pxw, pyw);
          i ? ctx.lineTo(sx2, sy2) : ctx.moveTo(sx2, sy2);
        }
        ctx.stroke(); ctx.setLineDash([]);
        // 门扇（长度=整樘宽 ow）
        const ex = hx0 + ow * (dx * s * Math.cos(theta) + nvx * Math.sin(theta));
        const ey = hy0 + ow * (dy * s * Math.cos(theta) + nvy * Math.sin(theta));
        const [hx, hy] = this._s(hx0, hy0), [exs, eys] = this._s(ex, ey);
        ctx.strokeStyle = "#8b8377"; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(exs, eys); ctx.stroke();
        ctx.fillStyle = "#8b8377"; ctx.beginPath(); ctx.arc(hx, hy, 2.5, 0, Math.PI * 2); ctx.fill();
      };
      if (dir.startsWith("left")) leaf(a, 1);          // 左铰链：门扇从左侧向中心
      else if (dir.startsWith("right")) leaf(b, -1);    // 右铰链：门扇从右侧向中心
      else { leaf(a, 1); leaf(b, -1); }
    }
  }

  _drawFurniture(f) {
    const ctx = this.ctx;
    const w = f.width || 800, d = f.depth || 800;
    const ang = (f.rotation || 0) * Math.PI / 180;
    const corners = [];
    for (const [lx, ly] of [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]]) {
      const rx = lx * Math.cos(ang) - ly * Math.sin(ang);
      const ry = lx * Math.sin(ang) + ly * Math.cos(ang);
      corners.push(this._s(f.x + rx, f.y + ry));
    }
    ctx.beginPath();
    corners.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.closePath();
    if (f.type === "image" && f.imageUrl && this._images[f.imageUrl]) {
      ctx.save(); ctx.clip();
      const img = this._images[f.imageUrl];
      const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
      ctx.drawImage(img, Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      ctx.restore();
    } else {
      ctx.fillStyle = this._alpha(f.color || "#8E7CC3", 0.55); ctx.fill();
    }
    ctx.strokeStyle = "rgba(58,47,37,0.55)"; ctx.lineWidth = 1.5; ctx.stroke();
    const [cx, cy] = this._s(f.x, f.y);
    const sw = Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]);
    if (sw > 34) {
      ctx.fillStyle = "#3a2f25"; ctx.font = "600 10px 'PingFang SC', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(f.label || f.type || "", cx, cy);
    }
  }

  // 2D 中人物用一个圆点表示（直径≈0.5m）
  _drawCharacter(c) {
    const ctx = this.ctx;
    const scale = this.view.zoom / this.DR;
    const r = Math.max(4.5, 250 * scale);
    const [cx, cy] = this._s(c.x, c.y);
    const col = c.color || "#3a7bd5";
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy + 1.2, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(30,26,20,0.13)"; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.2); ctx.strokeStyle = "#ffffff"; ctx.stroke();
    ctx.restore();
  }

  _drawSelection() {
    const ctx = this.ctx;
    ctx.strokeStyle = "#ff3b30"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    for (const sel of (this.selectionSet || [])) this._strokeSel(sel);
    ctx.setLineDash([]);
  }

  _strokeSel(sel) {
    const ctx = this.ctx;
    const el = this._getEl(sel); if (!el) return;
    if (sel.type === "furniture" || sel.type === "character") {
      const w = (el.width || 800), d = (el.depth || 800);
      const ang = (el.rotation || 0) * Math.PI / 180;
      const corners = [];
      if (sel.type === "furniture") {
        for (const [lx, ly] of [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]]) {
          const rx = lx * Math.cos(ang) - ly * Math.sin(ang), ry = lx * Math.sin(ang) + ly * Math.cos(ang);
          corners.push(this._s(el.x + rx, el.y + ry));
        }
      } else { const fp = this._charFootprint(el).map(p => this._s(p[0], p[1])); corners.push(...fp); }
      ctx.beginPath(); corners.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke();
    } else if (sel.type === "wall") {
      const [x1, y1] = this._s(el.x1, el.y1), [x2, y2] = this._s(el.x2, el.y2);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }

  _drawMarquee() {
    const ctx = this.ctx;
    const m = this._marquee;
    const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1), w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
    ctx.fillStyle = "rgba(255,138,91,0.12)"; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#ff8a5b"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
  }

  // ---- 命中测试 ----
  hitTest(wx, wy) {
    for (const f of this.scene.furniture || []) {
      const dx = wx - f.x, dy = wy - f.y;
      const ang = -(f.rotation || 0) * Math.PI / 180;
      const lx = dx * Math.cos(ang) - dy * Math.sin(ang), ly = dx * Math.sin(ang) + dy * Math.cos(ang);
      if (Math.abs(lx) <= (f.width || 800) / 2 && Math.abs(ly) <= (f.depth || 800) / 2) return { type: "furniture", id: f.id };
    }
    for (const c of this.scene.characters || []) {
      const fp = this._charFootprint(c);
      let inside = false;
      const tol = 60; // 命中容差（mm）
      for (let i = 0; i < 4; i++) {
        const a = fp[i], b = fp[(i + 1) % 4];
        if (((a[1] >= wy) !== (b[1] >= wy)) && (wx <= (b[0] - a[0]) * (wy - a[1]) / (b[1] - a[1]) + a[0])) inside = !inside;
      }
      if (inside) return { type: "character", id: c.id };
      if (Math.hypot(wx - c.x, wy - c.y) <= Math.max(500, 300) / 2 + tol) return { type: "character", id: c.id }; // 兜底
    }
    for (const o of this.scene.openings || []) {
      const w = (this.scene.walls || []).find(x => x.id === o.wall_id); if (!w) continue;
      const [px, py] = this._wallPoint(w, o.offset || 0);
      let dx = w.x2 - w.x1, dy = w.y2 - w.y1; const L = Math.hypot(dx, dy) || 1; dx/=L; dy/=L;
      const vx = wx - px, vy = wy - py;
      const along = vx * dx + vy * dy, perp = Math.abs(-vx * dy + vy * dx);
      if (Math.abs(along) <= (o.width || 900) / 2 && perp <= (w.thickness || 150) / 2 + 120) return { type: "opening", id: o.id };
    }
    const v = this._nearestVertex(wx, wy, null);
    if (v && v.d <= this._snapWorld()) return { type: "vertex", x: v.x, y: v.y, walls: v.walls };
    for (const w of this.scene.walls || []) {
      if (this._distSeg(wx, wy, w.x1, w.y1, w.x2, w.y2) <= (w.thickness || 150) / 2 + 150) return { type: "wall", id: w.id };
    }
    return null;
  }

  _distSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1; const L = dx*dx + dy*dy; if (!L) return Math.hypot(px-x1, py-y1);
    let t = ((px-x1)*dx + (py-y1)*dy) / L; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t*dx), py - (y1 + t*dy));
  }

  _getEl(sel) {
    if (!sel) return null;
    const map = { furniture: this.scene.furniture, wall: this.scene.walls, opening: this.scene.openings, room: this.scene.rooms, character: this.scene.characters };
    return (map[sel.type] || []).find(x => x.id === sel.id) || null;
  }
  getSelected() { return this._getEl(this.selection); }
  setSelection(sel) { this.selection = sel; this.selectionSet = sel ? [sel] : []; this.render(); this.opts.onSelect && this.opts.onSelect(sel); }
  _setSelectionSet(arr) { this.selectionSet = arr; this.selection = arr.length ? arr[arr.length - 1] : null; this.render(); this.opts.onSelect && this.opts.onSelect(this.selection); }
  refresh() { this.render(); }

  // ---- 撤销 / 重做（场景快照）----
  pushHistory() {
    if (!this.scene) return;
    try { this._undo.push(JSON.stringify(this.scene)); }
    catch (e) { return; }
    if (this._undo.length > 100) this._undo.shift();
    this._redo.length = 0;
  }
  undo() {
    if (!this._undo.length) { if (this.opts.onHistoryMsg) this.opts.onHistoryMsg("没有可撤销的操作"); return false; }
    const cur = JSON.stringify(this.scene);
    const prev = this._undo.pop();
    this._redo.push(cur);
    this._restore(prev);
    return true;
  }
  redo() {
    if (!this._redo.length) { if (this.opts.onHistoryMsg) this.opts.onHistoryMsg("没有可重做的操作"); return false; }
    const cur = JSON.stringify(this.scene);
    const prev = this._redo.pop();
    this._undo.push(cur);
    this._restore(prev);
    return true;
  }
  _restore(prev) {
    try { this.scene = JSON.parse(prev); }
    catch (e) { return; }
    // 丢弃已不存在的选中项
    this.selectionSet = (this.selectionSet || []).filter(s => this._getEl(s));
    this.selection = this.selectionSet.length ? this.selectionSet[this.selectionSet.length - 1] : null;
    this.render();
    this.opts.onSelect && this.opts.onSelect(this.selection);
    this.opts.onSceneChange && this.opts.onSceneChange();
  }
  canUndo() { return this._undo.length > 0; }
  canRedo() { return this._redo.length > 0; }

  // ---- 世界坐标包围盒（对齐/分布用）----
  _worldBounds(sel) {
    const el = this._getEl(sel); if (!el) return null;
    const box = (xs, ys, cx, cy) => ({ minx: Math.min(...xs), maxx: Math.max(...xs), miny: Math.min(...ys), maxy: Math.max(...ys), cx, cy });
    if (sel.type === "furniture") {
      const w = el.width || 800, d = el.depth || 800, ang = (el.rotation || 0) * Math.PI / 180;
      const pts = [];
      for (const [lx, ly] of [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]]) {
        const rx = lx * Math.cos(ang) - ly * Math.sin(ang), ry = lx * Math.sin(ang) + ly * Math.cos(ang);
        pts.push([el.x + rx, el.y + ry]);
      }
      return box(pts.map(p => p[0]), pts.map(p => p[1]), el.x, el.y);
    }
    if (sel.type === "character") {
      const fp = this._charFootprint(el);
      return box(fp.map(p => p[0]), fp.map(p => p[1]), el.x, el.y);
    }
    if (sel.type === "wall") {
      return box([el.x1, el.x2], [el.y1, el.y2], (el.x1 + el.x2) / 2, (el.y1 + el.y2) / 2);
    }
    if (sel.type === "opening") {
      const w = (this.scene.walls || []).find(x => x.id === el.wall_id); if (!w) return null;
      const [px, py] = this._wallPoint(w, el.offset || 0);
      let dx = w.x2 - w.x1, dy = w.y2 - w.y1; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const nx = -dy, ny = dx; const half = (el.width || 900) / 2; const t = (w.thickness || 150) / 2 + 60;
      const corners = [[px-dx*half+nx*t, py-dy*half+ny*t],[px+dx*half+nx*t, py+dy*half+ny*t],[px+dx*half-nx*t, py+dy*half-ny*t],[px-dx*half-nx*t, py-dy*half-ny*t]];
      return box(corners.map(p => p[0]), corners.map(p => p[1]), px, py);
    }
    return null;
  }
  _translateEl(sel, dx, dy) {
    const el = this._getEl(sel); if (!el) return;
    if (sel.type === "furniture" || sel.type === "character") { el.x += dx; el.y += dy; }
    else if (sel.type === "wall") { el.x1 += dx; el.y1 += dy; el.x2 += dx; el.y2 += dy; }
    // 门窗沿墙定位（offset 相对墙），平移会使其脱离墙，故对齐/分布跳过门窗
  }

  // ---- 多选对齐 / 分布（门窗因需贴合墙，不参与对齐）----
  _alignSel(mode) {
    const set = (this.selectionSet || []).filter(s => s.type === "furniture" || s.type === "character" || s.type === "wall");
    if (set.length < 2) { if (this.opts.onHistoryMsg) this.opts.onHistoryMsg("请选择 2 个以上家具/人物/墙再对齐"); return false; }
    const bs = set.map(s => ({ s, b: this._worldBounds(s) })).filter(x => x.b);
    if (bs.length < 2) return false;
    this.pushHistory();
    let target = 0;
    if (mode === "top") target = Math.max(...bs.map(x => x.b.maxy));
    else if (mode === "bottom") target = Math.min(...bs.map(x => x.b.miny));
    else if (mode === "left") target = Math.min(...bs.map(x => x.b.minx));
    else if (mode === "right") target = Math.max(...bs.map(x => x.b.maxx));
    else if (mode === "centerH") target = bs.reduce((a, x) => a + x.b.cy, 0) / bs.length;
    else if (mode === "centerV") target = bs.reduce((a, x) => a + x.b.cx, 0) / bs.length;
    for (const { s, b } of bs) {
      let dx = 0, dy = 0;
      if (mode === "top") dy = target - b.maxy;
      else if (mode === "bottom") dy = target - b.miny;
      else if (mode === "left") dx = target - b.minx;
      else if (mode === "right") dx = target - b.maxx;
      else if (mode === "centerH") dy = target - b.cy;
      else if (mode === "centerV") dx = target - b.cx;
      this._translateEl(s, Math.round(dx), Math.round(dy));
    }
    this.render(); this.opts.onSceneChange && this.opts.onSceneChange();
    return true;
  }
  _distributeSel(axis) {
    const set = (this.selectionSet || []).filter(s => s.type === "furniture" || s.type === "character" || s.type === "wall");
    if (set.length < 3) { if (this.opts.onHistoryMsg) this.opts.onHistoryMsg("等距分布至少需要 3 个元素"); return false; }
    const items = set.map(s => ({ s, b: this._worldBounds(s) })).filter(x => x.b);
    if (items.length < 3) return false;
    this.pushHistory();
    if (axis === "h") {
      items.sort((a, b) => a.b.cx - b.b.cx);
      const span = items[items.length - 1].b.maxx - items[0].b.minx;
      const widths = items.reduce((a, x) => a + (x.b.maxx - x.b.minx), 0);
      let gap = (span - widths) / (items.length - 1);
      if (!isFinite(gap)) gap = 0;
      let cursor = items[0].b.minx;
      for (const it of items) { const dx = Math.round(cursor - it.b.minx); this._translateEl(it.s, dx, 0); cursor += (it.b.maxx - it.b.minx) + gap; }
    } else {
      items.sort((a, b) => a.b.cy - b.b.cy);
      const span = items[items.length - 1].b.maxy - items[0].b.miny;
      const heights = items.reduce((a, x) => a + (x.b.maxy - x.b.miny), 0);
      let gap = (span - heights) / (items.length - 1);
      if (!isFinite(gap)) gap = 0;
      let cursor = items[0].b.miny;
      for (const it of items) { const dy = Math.round(cursor - it.b.miny); this._translateEl(it.s, 0, dy); cursor += (it.b.maxy - it.b.miny) + gap; }
    }
    this.render(); this.opts.onSceneChange && this.opts.onSceneChange();
    return true;
  }
  alignTop() { this._alignSel("top"); }
  alignBottom() { this._alignSel("bottom"); }
  alignLeft() { this._alignSel("left"); }
  alignRight() { this._alignSel("right"); }
  alignCenterH() { this._alignSel("centerH"); }   // 水平对齐：各元素水平中心共线（同 Y）
  alignCenterV() { this._alignSel("centerV"); }   // 垂直对齐：各元素竖直中心共线（同 X）
  distributeH() { this._distributeSel("h"); }
  distributeV() { this._distributeSel("v"); }

  // ---- 门窗沿所属墙拖拽 ----
  _startOpeningDrag(w0World) {
    const items = [];
    for (const s of this.selectionSet) {
      if (s.type !== "opening") continue;
      const o = this._getEl(s); if (!o) continue;
      const wall = (this.scene.walls || []).find(x => x.id === o.wall_id); if (!wall) continue;
      items.push({ sel: s, el: o, wall });
    }
    this._drag = { type: "openings", startW: w0World, items, historyPushed: false };
    this.canvas.style.cursor = "grabbing";    // 沿墙拖拽门窗：小手光标
  }

  // ---- Alt 拖拽：围绕元素中心旋转 ----
  _startRotate(sel, w0World) {
    const items = this.selectionSet.map(s => {
      const el = this._getEl(s); if (!el) return null;
      if (s.type === "furniture" || s.type === "character")
        return { sel, el, t: s.type, cx: el.x, cy: el.y };
      if (s.type === "wall") {
        const mx = (el.x1 + el.x2) / 2, my = (el.y1 + el.y2) / 2;
        return { sel, el, t: "wall", mid: [mx, my], ang0: Math.atan2(el.y2 - el.y1, el.x2 - el.x1),
                 ax0: el.x1, ay0: el.y1, bx0: el.x2, by0: el.y2 };
      }
      return null;
    }).filter(Boolean);
    this._drag = { type: "rotate", startW: w0World, items, historyPushed: false };
    this.canvas.style.cursor = "grabbing";
  }

  // ---- 图片缓存 ----
  preloadImage(url) {
    if (!url || this._images[url]) return;
    const img = new Image();
    img.onload = () => { this._images[url] = img; this.render(); };
    img.src = url;
  }

  // ---- 交互 ----
  _bind() {
    const c = this.canvas;
    c.addEventListener("mousedown", (e) => this._onDown(e));
    window.addEventListener("mousemove", (e) => this._onMove(e));
    window.addEventListener("mouseup", () => this._onUp());
    c.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.drawMode) this.toggleDraw(); });
  }
  _pos(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  _onDown(e) {
    if (e.button === 2) { // 右键平移
      const [sx, sy] = this._pos(e);
      this._panning = true; this._panStart = [sx, sy, this.view.panX, this.view.panY];
      this.canvas.style.cursor = "grabbing"; return;
    }
    if (e.button !== 0) return;
    const [sx, sy] = this._pos(e);
    const w = this.screenToWorld(sx, sy);

    // 未选中任何元素时，Alt/Option + 左键 = 右键效果（平移画布）
    if (e.altKey && !this.selection && !this.drawMode) {
      this._panning = true; this._panStart = [sx, sy, this.view.panX, this.view.panY];
      this.canvas.style.cursor = "grabbing"; return;
    }

    if (this.drawMode) {
      if (!this._drawStart) {
        const v = this._nearestVertex(w.x, w.y, null);
        this._drawStart = (v && v.d <= this._snapWorld()) ? { x: v.x, y: v.y } : { x: Math.round(w.x), y: Math.round(w.y) };
      } else {
        const end = this._snapDraw(this._drawStart, w);
        if (Math.hypot(end.x - this._drawStart.x, end.y - this._drawStart.y) > 50) { this._addWall(this._drawStart, end); this._drawStart = end; }
      }
      this._drawPreview = null; this.render(); return;
    }

    const hit = this.hitTest(w.x, w.y);
    if (hit) {
      if (hit.type === "vertex") {
        this._drag = { type: "vertex", vx: hit.x, vy: hit.y, affected: hit.walls, moving: true, historyPushed: false };
        const w0 = hit.walls[0].wall; this.setSelection({ type: "wall", id: w0.id });
        this.canvas.style.cursor = "grabbing";   // 调整墙端点（长度）：小手光标
        this.render(); return;
      }
      const inSet = this.selectionSet.some(s => s.type === hit.type && s.id === hit.id);
      const mod = e.ctrlKey || e.metaKey;
      const isElement = hit.type === "furniture" || hit.type === "character" || hit.type === "wall";
      const isToggle = isElement || hit.type === "opening";
      // Alt+拖拽：围绕元素中心旋转（仅家具/人物/墙）
      if (isElement && e.altKey) {
        let set = this.selectionSet.filter(s => !(s.type === hit.type && s.id === hit.id));
        if (!inSet) set.push(hit);
        this._setSelectionSet(set); this._startRotate(w); return;
      }
      // Ctrl/⌘ 或 Shift 单击：批量（加/减）选中。门窗亦支持；点击已选中元素则反选，否则加入多选
      if (isToggle && (mod || e.shiftKey)) {
        let set = this.selectionSet.filter(s => !(s.type === hit.type && s.id === hit.id));
        const willAdd = !inSet;
        if (willAdd) set.push(hit);
        this._setSelectionSet(set);
        if (willAdd) { if (hit.type === "opening") this._startOpeningDrag(w); else this._startMove(w); }
        return;
      }
      // 普通点选
      if (!inSet || this.selectionSet.length <= 1) {
        this.selectionSet = [hit]; this.selection = hit; this.opts.onSelect && this.opts.onSelect(hit); this.render();
      } else { this.selection = hit; this.opts.onSelect && this.opts.onSelect(hit); }
      // 门窗：沿所在墙拖拽；其余：整体移动
      if (hit.type === "opening") this._startOpeningDrag(w); else this._startMove(w);
      return;
    }
    // 空白：开始框选
    this._marquee = { x0: sx, y0: sy, x1: sx, y1: sy, base: e.shiftKey ? this.selectionSet.slice() : [] };
    this._marqueeShift = e.shiftKey;
  }

  _startMove(w0World) {
    const items = this.selectionSet.map(sel => {
      const el = this._getEl(sel); if (!el) return null;
      if (sel.type === "furniture" || sel.type === "character") return { sel, el, t: sel.type, sx: el.x, sy: el.y };
      if (sel.type === "wall") return { sel, el, t: "wall", x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2 };
      return null;
    }).filter(Boolean);
    this._drag = { type: "multi", startW: w0World, items };
    this.canvas.style.cursor = "crosshair";   // 移动元素：十字光标
  }

  _onMove(e) {
    if (this.drawMode && this._drawStart) {
      const [sx, sy] = this._pos(e); const w = this.screenToWorld(sx, sy);
      this._drawPreview = this._snapDraw(this._drawStart, w); this.render(); return;
    }
    // 围绕中心旋转（Alt+拖拽）
    if (this._drag && this._drag.type === "rotate") {
      const [sx, sy] = this._pos(e); const w = this.screenToWorld(sx, sy);
      if (!this._drag.historyPushed) { this.pushHistory(); this._drag.historyPushed = true; }
      for (const it of this._drag.items) {
        if (it.t === "furniture" || it.t === "character") {
          it.el.rotation = Math.round(Math.atan2(w.y - it.cy, w.x - it.cx) * 180 / Math.PI);
        } else {
          const d = Math.atan2(w.y - it.mid[1], w.x - it.mid[0]) - it.ang0;
          const cs = Math.cos(d), sn = Math.sin(d);
          const rx1 = it.mid[0] + (it.ax0 - it.mid[0]) * cs - (it.ay0 - it.mid[1]) * sn;
          const ry1 = it.mid[1] + (it.ax0 - it.mid[0]) * sn + (it.ay0 - it.mid[1]) * cs;
          const rx2 = it.mid[0] + (it.bx0 - it.mid[0]) * cs - (it.by0 - it.mid[1]) * sn;
          const ry2 = it.mid[1] + (it.bx0 - it.mid[0]) * sn + (it.by0 - it.mid[1]) * cs;
          it.el.x1 = Math.round(rx1); it.el.y1 = Math.round(ry1);
          it.el.x2 = Math.round(rx2); it.el.y2 = Math.round(ry2);
        }
      }
      this.render(); this.opts.onSceneChange && this.opts.onSceneChange(); return;
    }
    // 门窗沿墙拖拽：把鼠标投影到所属墙上得到偏移，并夹紧在墙段内（不得脱离墙）
    if (this._drag && this._drag.type === "openings") {
      const [sx, sy] = this._pos(e); const w = this.screenToWorld(sx, sy);
      if (!this._drag.historyPushed) { this.pushHistory(); this._drag.historyPushed = true; }
      for (const it of this._drag.items) {
        const wall = (this.scene.walls || []).find(x => x.id === it.el.wall_id) || it.wall;
        const wx1 = wall.x1, wy1 = wall.y1, wx2 = wall.x2, wy2 = wall.y2;
        const dx = wx2 - wx1, dy = wy2 - wy1; const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L, uy = dy / L;
        let off = (w.x - wx1) * ux + (w.y - wy1) * uy;
        const half = (it.el.width || 900) / 2;
        off = Math.max(half, Math.min(L - half, off));
        it.el.offset = Math.round(off);
      }
      this.render(); this.opts.onSceneChange && this.opts.onSceneChange(); return;
    }
    if (this._drag && this._drag.items) {
      const [sx, sy] = this._pos(e); const w = this.screenToWorld(sx, sy);
      let dx = w.x - this._drag.startW.x, dy = w.y - this._drag.startW.y;
      if (e.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }  // Shift：锁定水平/垂直
      if (!this._drag.historyPushed && (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)) { this.pushHistory(); this._drag.historyPushed = true; }
      for (const it of this._drag.items) {
        if (it.t === "wall") { it.el.x1 = Math.round(it.x1 + dx); it.el.y1 = Math.round(it.y1 + dy); it.el.x2 = Math.round(it.x2 + dx); it.el.y2 = Math.round(it.y2 + dy); }
        else { it.el.x = Math.round(it.sx + dx); it.el.y = Math.round(it.sy + dy); }
      }
      this.render(); this.opts.onSceneChange && this.opts.onSceneChange(); return;
    }
    if (this._marquee) { const [sx, sy] = this._pos(e); this._marquee.x1 = sx; this._marquee.y1 = sy; this.render(); return; }
    if (this._panning) {
      const [sx, sy] = this._pos(e);
      this.view.panX = this._panStart[2] + (sx - this._panStart[0]); this.view.panY = this._panStart[3] + (sy - this._panStart[1]);
      this.render(); this._notifyView(); return;
    }
    if (this._miniDrag) { this._miniMove(e); return; }
    // 悬停光标反馈：可移动元素 → 十字；墙端点（可改长度）→ 小手
    if (!this.drawMode && !this._drag && !this._panning && !this._marquee && !this._miniDrag) {
      const [hx, hy] = this._pos(e);
      const wp = this.screenToWorld(hx, hy);
      const hit = this.hitTest(wp.x, wp.y);
      if (hit && hit.type === "vertex") this.canvas.style.cursor = "grab";
      else if (hit) this.canvas.style.cursor = "crosshair";
      else this.canvas.style.cursor = "default";
    }
    if (this.drawMode) return;
    // 顶点拖拽
    if (this._drag && this._drag.type === "vertex") {
      const [sx, sy] = this._pos(e); let w = this.screenToWorld(sx, sy);
      if (e.shiftKey) {  // Shift：把墙端点锁定到水平或垂直方向
        const ddx = w.x - this._drag.vx, ddy = w.y - this._drag.vy;
        if (Math.abs(ddx) >= Math.abs(ddy)) w = { x: w.x, y: this._drag.vy };
        else w = { x: this._drag.vx, y: w.y };
      }
      if (!this._drag.historyPushed) { this.pushHistory(); this._drag.historyPushed = true; }
      const cand = this._snapVertexMove(w, this._drag.affected, { x: this._drag.vx, y: this._drag.vy });
      const ddx = Math.round(cand.x - this._drag.vx), ddy = Math.round(cand.y - this._drag.vy);
      for (const a of this._drag.affected) { if (a.end === "a") { a.wall.x1 += ddx; a.wall.y1 += ddy; } else { a.wall.x2 += ddx; a.wall.y2 += ddy; } }
      this._drag.vx = cand.x; this._drag.vy = cand.y; this.render(); this.opts.onSceneChange && this.opts.onSceneChange(); return;
    }
  }

  _onUp() {
    if (this._marquee) {
      const m = this._marquee;
      const dragDist = Math.hypot(m.x1 - m.x0, m.y1 - m.y0);
      if (dragDist < 4) { this._setSelectionSet([]); }
      else {
        const rect = { x0: Math.min(m.x0, m.x1), y0: Math.min(m.y0, m.y1), x1: Math.max(m.x0, m.x1), y1: Math.max(m.y0, m.y1) };
        const result = this._marqueeShift ? m.base.slice() : [];
        const all = [];
        for (const f of this.scene.furniture || []) all.push({ type: "furniture", id: f.id });
        for (const w of this.scene.walls || []) all.push({ type: "wall", id: w.id });
        for (const c of this.scene.characters || []) all.push({ type: "character", id: c.id });
        for (const o of this.scene.openings || []) all.push({ type: "opening", id: o.id });
        for (const s of all) if (this._elementInMarquee(s, rect)) result.push(s);
        this._setSelectionSet(result);
      }
      this._marquee = null; this.render(); return;
    }
    if (this._drag) { const wasEdit = this._drag.type === "vertex" || this._drag.type === "rotate"; this._drag = null; this.canvas.style.cursor = this.drawMode ? "crosshair" : "default"; if (wasEdit) this.opts.onSceneChange && this.opts.onSceneChange(); return; }
    if (this._panning) { this._panning = false; this.canvas.style.cursor = "default"; }
  }

  _elementInMarquee(sel, rect) {
    const b = this._screenBounds(sel); if (!b) return false;
    // 必须完全落在选框内（只框中一部分的元素不选中）
    return b.minx >= rect.x0 && b.maxx <= rect.x1 && b.miny >= rect.y0 && b.maxy <= rect.y1;
  }

  _screenBounds(sel) {
    const el = this._getEl(sel); if (!el) return null;
    if (sel.type === "wall") {
      const [a1, a2] = this._s(el.x1, el.y1), [b1, b2] = this._s(el.x2, el.y2);
      const t = Math.max(6, (el.thickness || 150) / this.DR * this.view.zoom);
      return { minx: Math.min(a1, b1) - t, maxx: Math.max(a1, b1) + t, miny: Math.min(a2, b2) - t, maxy: Math.max(a2, b2) + t };
    }
    if (sel.type === "furniture") {
      const w = el.width || 800, d = el.depth || 800, ang = (el.rotation || 0) * Math.PI / 180;
      const r = Math.hypot(w, d) / 2 / this.DR * this.view.zoom + 4; const [cx, cy] = this._s(el.x, el.y);
      return { minx: cx - r, maxx: cx + r, miny: cy - r, maxy: cy + r };
    }
    if (sel.type === "character") {
      const fp = this._charFootprint(el).map(p => this._s(p[0], p[1]));
      const xs = fp.map(p => p[0]), ys = fp.map(p => p[1]);
      const m = 6;
      return { minx: Math.min(...xs) - m, maxx: Math.max(...xs) + m, miny: Math.min(...ys) - m, maxy: Math.max(...ys) + m };
    }
    if (sel.type === "opening") {
      const wb = this._worldBounds(sel); if (!wb) return null;
      const corners = [[wb.minx, wb.miny], [wb.maxx, wb.miny], [wb.maxx, wb.maxy], [wb.minx, wb.maxy]].map(p => this._s(p[0], p[1]));
      const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
      const m = 6;
      return { minx: Math.min(...xs) - m, maxx: Math.max(...xs) + m, miny: Math.min(...ys) - m, maxy: Math.max(...ys) + m };
    }
    return null;
  }

  _onWheel(e) {
    e.preventDefault();
    const [sx, sy] = this._pos(e);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.zoomBy(factor, [sx, sy]);
  }

  // ---- 小地图 ----
  attachMinimap(mc) {
    this.minimap = mc;
    this._miniCss = { w: 180, h: 130 };
    this.mctx = mc.getContext("2d");
    mc.addEventListener("mousedown", (e) => { this._miniDrag = true; this._miniMove(e); });
    window.addEventListener("mousemove", (e) => { if (this._miniDrag) this._miniMove(e); });
    window.addEventListener("mouseup", () => { this._miniDrag = false; });
    this._miniResize();
    requestAnimationFrame(() => { this._miniResize(); this.render(); });
    window.addEventListener("resize", () => this._miniResize());
  }
  _miniResize() {
    const mc = this.minimap; if (!mc) return;
    const rect = mc.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || 180)), h = Math.max(1, Math.round(rect.height || 130));
    const dpr = window.devicePixelRatio || 1;
    if (mc.width !== Math.round(w * dpr) || mc.height !== Math.round(h * dpr)) {
      mc.width = Math.round(w * dpr); mc.height = Math.round(h * dpr);
      this.mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this._miniCss = { w, h };
  }
  _sceneBoundsMM() {
    const pts = [];
    for (const w of this.scene.walls || []) pts.push([w.x1, w.y1], [w.x2, w.y2]);
    for (const f of this.scene.furniture || []) pts.push([f.x, f.y]);
    for (const c of this.scene.characters || []) pts.push([c.x, c.y]);
    if (!pts.length) return null;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { minx: Math.min(...xs), maxx: Math.max(...xs), miny: Math.min(...ys), maxy: Math.max(...ys) };
  }
  _drawMinimap() {
    const mctx = this.mctx; if (!this.minimap || !mctx) return;
    this._miniResize();
    const mw = this._miniCss.w, mh = this._miniCss.h;
    mctx.clearRect(0, 0, mw, mh);
    mctx.fillStyle = "#faf8f4"; mctx.fillRect(0, 0, mw, mh);
    const B = this._sceneBoundsMM();
    if (!B) return;
    const pad = 800, minx = B.minx - pad, maxx = B.maxx + pad, miny = B.miny - pad, maxy = B.maxy + pad;
    const bw = maxx - minx, bh = maxy - miny;
    const scale = Math.min(mw / bw, mh / bh) * 0.94;
    const ox = (mw - bw * scale) / 2, oy = (mh - bh * scale) / 2;
    const toM = (wx, wy) => [ox + (wx - minx) * scale, oy + (wy - miny) * scale];
    this._miniMap = { minx, miny, scale, ox, oy };

    // 房间填充
    for (const room of this.scene.rooms || []) {
      const pts = room.points || []; if (pts.length < 3) continue;
      mctx.beginPath();
      pts.forEach((p, i) => { const [a, b] = toM(p[0], p[1]); i ? mctx.lineTo(a, b) : mctx.moveTo(a, b); });
      mctx.closePath();
      mctx.fillStyle = room.color || "#FFD9A0"; mctx.fill();
    }
    // 家具
    mctx.fillStyle = "rgba(90,84,72,0.55)";
    for (const f of this.scene.furniture || []) { const [a, b] = toM(f.x, f.y); mctx.fillRect(a - 1.5, b - 1.5, 3, 3); }
    // 人物
    mctx.fillStyle = "#3a7bd5";
    for (const c of this.scene.characters || []) { const [a, b] = toM(c.x, c.y); mctx.beginPath(); mctx.arc(a, b, 2.5, 0, Math.PI * 2); mctx.fill(); }
    // 墙体
    mctx.strokeStyle = "#3f3b35"; mctx.lineWidth = 1.6; mctx.lineCap = "round";
    for (const w of this.scene.walls || []) { const [a, b] = toM(w.x1, w.y1), [c, d] = toM(w.x2, w.y2); mctx.beginPath(); mctx.moveTo(a, b); mctx.lineTo(c, d); mctx.stroke(); }
    // 当前视口
    const corners = [this.screenToWorld(0, 0), this.screenToWorld(this.cw, 0), this.screenToWorld(this.cw, this.ch), this.screenToWorld(0, this.ch)].map(p => toM(p.x, p.y));
    mctx.strokeStyle = "#ff5a4d"; mctx.lineWidth = 1.5; mctx.beginPath();
    corners.forEach((p, i) => i ? mctx.lineTo(p[0], p[1]) : mctx.moveTo(p[0], p[1])); mctx.closePath(); mctx.stroke();
  }
  _miniMove(e) {
    if (!this._miniMap) return;
    const r = this.minimap.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const M = this._miniMap;
    const wx = M.minx + (mx - M.ox) / M.scale, wy = M.miny + (my - M.oy) / M.scale;
    this.center = { x: wx / this.DR, y: wy / this.DR };
    this.view.panX = 0; this.view.panY = 0; this.render(); this._notifyView();
  }

  _alpha(hex, a) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  _centroid(pts) { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return [xs.reduce((a, b) => a + b, 0) / pts.length, ys.reduce((a, b) => a + b, 0) / pts.length]; }

  // 人物占地矩形（世界坐标，0.5m × 0.3m，绕中心旋转）
  _charFootprint(c) {
    const fw = 500, fd = 300, ang = (c.rotation || 0) * Math.PI / 180;
    const out = [];
    for (const [lx, ly] of [[-fw/2,-fd/2],[fw/2,-fd/2],[fw/2,fd/2],[-fw/2,fd/2]]) {
      const rx = lx * Math.cos(ang) - ly * Math.sin(ang), ry = lx * Math.sin(ang) + ly * Math.cos(ang);
      out.push([c.x + rx, c.y + ry]);
    }
    return out;
  }
}

function ctx_line(ctx, x1, y1, x2, y2, w, color) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
