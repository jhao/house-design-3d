// 3D 卡通视角：Three.js（全局 THREE + OrbitControls）
// 3D 单位长度 = 展示单位 = 世界(mm)/200；plan(x,y) -> 3D(x, z)，Y 向上。
const FURN_HEIGHT = {
  bed: 550, sofa: 850, table: 750, chair: 900, fridge: 1800, cabinet: 2000,
  bookshelf: 2000, tv: 450, plant: 1200, toilet: 750, stove: 850, sink: 900,
  image: 1500,
};
// 优先使用【系统设置】里保存的高度（app.js 启动时会写入 window.FURN_HEIGHT）
function furnHeight(type, fallback) {
  const map = window.FURN_HEIGHT || FURN_HEIGHT;
  const v = map[type];
  return (v != null ? v : (FURN_HEIGHT[type] != null ? FURN_HEIGHT[type] : fallback));
}

class Editor3D {
  constructor(container) {
    this.container = container;
    this.ready = false;
    this._raf = null;
    this._altDown = false;       // Alt/Option 是否按下（3D 中左键=右键平移）
    this._savePending = false;   // 相机视角保存节流标记
    this.projectId = null;       // 当前项目 id（按项目持久化相机视角）
    if (typeof THREE === "undefined") {
      container.innerHTML = '<div style="padding:20px;color:#a55">3D 视图需要联网加载 Three.js（CDN）。请联网后刷新。</div>';
      return;
    }
    this._init();
  }

  _init() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    this.scene3 = new THREE.Scene();
    this.scene3.background = new THREE.Color(0xf4f1e8);
    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 5000);
    this.camera.position.set(60, 60, 60);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.container.innerHTML = "";
    this.container.appendChild(this.renderer.domElement);

    this.scene3.add(new THREE.HemisphereLight(0xffffff, 0xccbb99, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(80, 120, 40);
    this.scene3.add(dir);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    // 相机视角变化即按项目保存（节流 300ms）
    this.controls.addEventListener("change", () => this._onCamChange());
    // Alt/Option 按住时左键等同右键（平移），松开恢复旋转；仅 3D 视图激活时生效
    window.addEventListener("keydown", (e) => { if (e.key === "Alt") { this._altDown = true; this._applyAlt(); } });
    window.addEventListener("keyup",   (e) => { if (e.key === "Alt") { this._altDown = false; this._applyAlt(); } });

    this.root = new THREE.Group();
    this.scene3.add(this.root);

    this.ready = true;
    this._animate();
    window.addEventListener("resize", () => this._resize());
  }

  _resize() {
    if (!this.ready) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  // 键盘 +/− 缩放：沿视线方向推拉相机
  zoomBy(factor) {
    if (!this.ready) return;
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const len = dir.length();
    const newLen = Math.max(2, Math.min(len * factor, 3000));
    dir.setLength(newLen);
    this.camera.position.copy(this.controls.target).add(dir);
    this.controls.update();
  }

  _clear() {
    while (this.root.children.length) {
      const c = this.root.children.pop();
      c.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose && o.material.dispose(); });
    }
  }

  // ---- 相机视角持久化（按项目 id 存入 localStorage）----
  setProjectId(pid) {
    this.projectId = pid || null;
    const v = this._loadView();
    if (v && this.ready) {
      this.camera.position.set(v.pos.x, v.pos.y, v.pos.z);
      this.controls.target.set(v.tgt.x, v.tgt.y, v.tgt.z);
    }
  }
  _viewKey() { return "houseview3d:" + (this.projectId || "default"); }
  saveView() {
    if (!this.ready || !this.controls) return;
    try {
      localStorage.setItem(this._viewKey(), JSON.stringify({
        pos: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
        tgt: { x: this.controls.target.x, y: this.controls.target.y, z: this.controls.target.z },
      }));
    } catch (e) { /* localStorage 不可用时忽略 */ }
  }
  _loadView() {
    try {
      const s = localStorage.getItem(this._viewKey());
      if (!s) return null;
      return JSON.parse(s);
    } catch (e) { return null; }
  }
  _onCamChange() {
    if (this._savePending) return;
    this._savePending = true;
    setTimeout(() => { this._savePending = false; this.saveView(); }, 300);
  }
  // Alt 按下时左键=平移；松开恢复旋转（仅 3D 视图可见时生效）
  _applyAlt() {
    if (!this.controls) return;
    const active = this.container && !this.container.classList.contains("hidden");
    this.controls.mouseButtons.LEFT = (this._altDown && active) ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  }

  _toon(hex) {
    return new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) });
  }

  _wallBox(cx, cz, len, h, t, ang, yCenter, color, opacity) {
    const geo = new THREE.BoxGeometry(len, h, t);
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color === undefined ? 0xc9a27e : color) });
    if (opacity !== undefined && opacity < 1) {
      mat.transparent = true;
      mat.opacity = opacity;
      mat.depthWrite = false;       // 半透明墙不写深度，便于从外部看穿到室内
      mat.side = THREE.DoubleSide;  // 双面渲染，墙体内外表面都可见
    }
    const mesh = new THREE.Mesh(geo, mat);
    if (opacity !== undefined && opacity < 1) {
      mesh.renderOrder = 2;          // 透明墙/玻璃墙最后绘制，确保始终能看穿到室内家具
    }
    this._outline(mesh, 1.02);
    mesh.position.set(cx, yCenter !== undefined ? yCenter : h / 2, cz);
    mesh.rotation.y = ang;
    this.root.add(mesh);
  }

  // 将一条墙按门窗位置切成多段：门整高留空、窗中段留空（上下保留墙）
  _buildWall(w, DR, openings, transparent) {
    const kind = w.kind || "normal";
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const t = Math.max(0.1, (w.thickness || 200) / DR);
    const ht = (w.height || 2800) / DR;
    const SILL = 900; // 窗台高度（mm）
    const ang = -Math.atan2(dy, dx);

    // 柱：独立方柱
    if (kind === "column") {
      const side = Math.max((w.thickness || 200), 400) / DR;
      const cx = (w.x1 + w.x2) / 2 / DR, cz = (w.y1 + w.y2) / 2 / DR;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(side, ht, side), this._toon(0x555555));
      this._outline(mesh, 1.03);
      mesh.position.set(cx, ht / 2, cz);
      this.root.add(mesh);
      return;
    }
    // 梁：贴顶部的结构梁
    if (kind === "beam") {
      const bw = Math.max((w.thickness || 200), 160) / DR;
      const bh = 400 / DR;
      const cx = (w.x1 + w.x2) / 2 / DR, cz = (w.y1 + w.y2) / 2 / DR;
      const len = L / DR;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, bh, bw), this._toon(0x6d6d6d));
      this._outline(mesh, 1.03);
      mesh.position.set(cx, ht - bh / 2, cz);
      mesh.rotation.y = ang;
      this.root.add(mesh);
      return;
    }

    const wallColor = kind === "bearing" ? 0x6b6b6b : kind === "glass" ? 0xbfe3ff : 0xc9a27e;
    // 透明模式（默认开启）：普通墙/承重墙半透明，便于从 3D 外部看穿到室内；
    // 玻璃墙为「最透」的面（0.2），明显比普通半透明墙(0.34)更清楚，可从任一侧双向看穿
    const wallOpacity = kind === "glass" ? 0.2 : (transparent ? 0.34 : 1.0);

    const os = (openings || []).filter(o => o.wall_id === w.id)
      .map(o => {
        const c = (o.offset || 0), hw = (o.width || 900) / 2;
        return { type: o.type || "door", a: c - hw, b: c + hw, height: o.height || 2100, sill: SILL };
      })
      .sort((p, q) => p.a - q.a);
    let cursor = 0; const segs = [];
    for (const o of os) {
      const a = Math.max(0, o.a), b = Math.min(L, o.b);
      if (b <= cursor) continue;
      if (a > cursor) segs.push({ a: cursor, b: a, type: "solid" });
      segs.push({ a, b, type: o.type, sill: o.sill, height: o.height });
      cursor = b;
    }
    if (cursor < L) segs.push({ a: cursor, b: L, type: "solid" });

    for (const seg of segs) {
      const lenSeg = (seg.b - seg.a) / DR;
      if (lenSeg <= 0.001) continue;
      const mid = seg.a + (seg.b - seg.a) / 2;
      const cx = (w.x1 + ux * mid) / DR, cz = (w.y1 + uy * mid) / DR;
      if (seg.type === "solid") {
        this._wallBox(cx, cz, lenSeg, ht, t, ang, ht / 2, wallColor, wallOpacity);
      } else if (seg.type === "window") {
        const sill = seg.sill / DR, wh = seg.height / DR;
        if (sill > 0.01) this._wallBox(cx, cz, lenSeg, sill, t, ang, sill / 2, wallColor, wallOpacity);
        const upH = ht - (sill + wh);
        if (upH > 0.01) this._wallBox(cx, cz, lenSeg, upH, t, ang, sill + wh + upH / 2, wallColor, wallOpacity);
      }
      // door: 整段留空 -> 墙体空洞
    }

    // 门扇 / 窗玻璃
    for (const o of (openings || []).filter(o => o.wall_id === w.id)) {
      const c = o.offset || 0;
      const px = (w.x1 + ux * c) / DR, pz = (w.y1 + uy * c) / DR;
      if (o.type === "window") {
        const ow = (o.width || 900) / DR, wh = (o.height || 1500) / DR;
        const gy = SILL / DR + wh / 2;
        const grp = new THREE.Group();
        grp.position.set(px, gy, pz);
        grp.rotation.y = ang;
        // 透明玻璃（可透过窗看进室内，也可从室内看向室外）：双面 + 不写深度 + 最后绘制
        const pane = new THREE.Mesh(new THREE.BoxGeometry(ow, wh, Math.max(0.05, t * 1.1)),
          new THREE.MeshLambertMaterial({ color: 0xbfe8f2, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
        pane.renderOrder = 2;          // 始终在实体家具之后绘制，确保双向都看穿
        this._outline(pane, 1.04);
        grp.add(pane);
        // 窗框（四边细框，便于辨识窗户）
        const fr = Math.max(0.08, t * 0.4), fmat = this._toon(0x6f7a86);
        const addBar = (w, h, x, y) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, t * 1.3), fmat); b.position.set(x, y, 0); grp.add(b); };
        addBar(ow, fr, 0, wh / 2 - fr / 2);
        addBar(ow, fr, 0, -wh / 2 + fr / 2);
        addBar(fr, wh, -ow / 2 + fr / 2, 0);
        addBar(fr, wh, ow / 2 - fr / 2, 0);
        this.root.add(grp);
      } else if (o.dir) {
        // 门：按开门方向（6 种）画真实门扇，仅渲染用户所选方向（无 dir 不画，杜绝"初始门"残留）
        const ow = (o.width || 900) / DR, oh = (o.height || 2100) / DR, thin = 0.05;
        const dir = o.dir;
        const inward = dir.endsWith("_out") ? 1 : -1;
        const grp = new THREE.Group();
        grp.position.set(px, 0, pz);
        grp.rotation.y = ang;
        const leafMat = this._toon(0x8a5a2b);
        const makeLeaf = (hingeX, closedSign) => {
          const g2 = new THREE.Group();
          g2.position.set(hingeX, 0, 0);
          g2.rotation.y = -closedSign * inward * 35 * Math.PI / 180;
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(ow, oh, thin), leafMat);
          this._outline(leaf, 1.05);
          leaf.position.set(closedSign * ow / 2, oh / 2, 0);
          g2.add(leaf);
          grp.add(g2);
        };
        if (dir.startsWith("left")) makeLeaf(-ow / 2, 1);
        else if (dir.startsWith("right")) makeLeaf(ow / 2, -1);
        else { makeLeaf(-ow / 2, 1); makeLeaf(ow / 2, -1); }
        this.root.add(grp);
      }
    }
  }
  _outline(mesh, scale = 1.06) {
    const m = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: 0x3a2f25, side: THREE.BackSide }));
    m.scale.setScalar(scale);
    mesh.add(m);
  }

  build(scene, opts) {
    if (!this.ready) return;
    this._clear();
    this._lastScene = scene; this._lastOpts = opts;   // 缓存最近一次场景，供 resetView 复用
    const realistic = !!(opts && opts.realistic);
    // 3D 墙体透明：默认开启（false 时才实心），对应 2D 俯视可看穿室内的体验
    const wallTransparent = !(opts && opts.wallTransparent === false);
    const DR = (scene && scene.display_ratio) || 200;
    const walls = scene.walls || [];
    const furn = scene.furniture || [];

    // 地面（按墙体包围盒）
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (const w of walls) { for (const [x, y] of [[w.x1,w.y1],[w.x2,w.y2]]) { minx=Math.min(minx,x);maxx=Math.max(maxx,x);miny=Math.min(miny,y);maxy=Math.max(maxy,y);} }
    if (minx > maxx) { minx = 0; maxx = 5000; miny = 0; maxy = 5000; }
    const pad = 1000;
    const fw = (maxx - minx + pad*2) / DR, fd = (maxy - miny + pad*2) / DR;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), new THREE.MeshLambertMaterial({ color: 0xeae3d2 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((minx + maxx)/2/DR, 0, (miny + maxy)/2/DR);
    this.root.add(floor);

    // 墙体（按门窗开洞 + 类型）
    for (const w of walls) this._buildWall(w, DR, scene.openings || [], wallTransparent);

    // 家具
    for (const f of furn) {
      const fw = (f.width||800)/DR, fd = (f.depth||800)/DR;
      if (f.type === "image" && f.imageUrl) {
        const fh = furnHeight(f.type, 1500) / DR;
        const geo = new THREE.PlaneGeometry(fw, fh);
        const tex = new THREE.TextureLoader().load(f.imageUrl);
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
        mesh.position.set(f.x/DR, fh/2, f.y/DR);
        mesh.rotation.y = -(f.rotation||0) * Math.PI/180;
        this.root.add(mesh);
      } else if (realistic) {
        this._realisticFurniture(f, DR);
      } else {
        const fh = furnHeight(f.type, 800) / DR;
        const geo = new THREE.BoxGeometry(fw, fh, fd);
        const mesh = new THREE.Mesh(geo, this._toon(f.color || "#8E7CC3"));
        this._outline(mesh, 1.04);
        mesh.position.set(f.x/DR, fh/2, f.y/DR);
        mesh.rotation.y = -(f.rotation||0) * Math.PI/180;
        this.root.add(mesh);
      }
    }

    // 人物（测试设计合理性）
    for (const c of (scene.characters || [])) this._buildCharacter(c, DR);

    // 相机：优先恢复该项目本地保存的视角（切换 2D/3D 或刷新后保持水平面位置与缩放）
    const saved = this._loadView();
    if (saved) {
      this.camera.position.set(saved.pos.x, saved.pos.y, saved.pos.z);
      this.controls.target.set(saved.tgt.x, saved.tgt.y, saved.tgt.z);
    } else {
      const cx = (minx + maxx) / 2 / DR, cz = (miny + maxy) / 2 / DR;
      const span = Math.max((maxx - minx) / DR, (maxy - miny) / DR, 6);
      // 默认相机：等比拉近（距=场景跨度×0.85），高度更低，避免 2D→3D 一上来离得太远
      const dist = span * 0.85 + 4;
      this.camera.position.set(cx + dist * 0.62, dist * 0.55, cz + dist * 0.62);
      this.controls.target.set(cx, 1.2, cz);
    }
    this.controls.update();
  }

  // 复位视角：清除该项目本地保存的（可能过远的）视角，按默认近距离重新取景
  resetView() {
    if (!this.ready) return;
    try { localStorage.removeItem(this._viewKey()); } catch (e) {}
    if (this._lastScene) this.build(this._lastScene, this._lastOpts);
  }

  // 胶囊体：圆柱 + 两端球（three r137 无 CapsuleGeometry）
  _capsule(r, len, mat, seg = 12) {
    const g = new THREE.Group();
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.max(1e-4, len), seg), mat);
    g.add(cyl);
    for (const s of [1, -1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r, seg, 10), mat);
      cap.position.y = s * len / 2;
      g.add(cap);
    }
    return g;
  }

  // 人物：由胶囊/球体/关节层级构成的人体（站·举手·蹲·坐·躺）
  _buildCharacter(c, DR) {
    const H = (c.height || 1700) / DR;
    const state = c.state || "stand";
    const skin  = this._toon(0xeab98d);
    const shirt = this._toon(c.color || 0x3a7bd5);
    const pants = this._toon(0x46597a);
    const shoe  = this._toon(0x2b2b30);
    const hairM = this._toon(0x33261d);

    const root = new THREE.Group();
    root.position.set(c.x / DR, 0, c.y / DR);
    root.rotation.y = -(c.rotation || 0) * Math.PI / 180;
    this.root.add(root);

    // 接地阴影
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3 * H, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.004;
    root.add(shadow);

    const body = new THREE.Group();
    root.add(body);

    const thigh = 0.24 * H, shin = 0.22 * H;
    const hipY = state === "squat" ? 0.23 * H : state === "sit" ? 0.24 * H : thigh + shin;
    const torsoH = 0.27 * H;
    const armUpper = 0.17 * H, armFore = 0.16 * H;
    const hipDX = 0.055 * H, shoulderDX = 0.115 * H;

    const hips = new THREE.Group();
    hips.position.set(0, hipY, 0);
    body.add(hips);

    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.095 * H, 14, 12), pants);
    pelvis.scale.set(1.06, 0.78, 0.8);
    hips.add(pelvis);

    const torso = new THREE.Group();
    hips.add(torso);

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.104 * H, 0.082 * H, torsoH, 16), shirt);
    trunk.scale.z = 0.72; trunk.position.y = torsoH / 2;
    torso.add(trunk);

    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.104 * H, 16, 12), shirt);
    shoulders.scale.set(1.3, 0.66, 0.74); shoulders.position.y = torsoH;
    torso.add(shoulders);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.031 * H, 0.035 * H, 0.06 * H, 10), skin);
    neck.position.y = torsoH + 0.03 * H;
    torso.add(neck);

    const headR = 0.075 * H;
    const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 20, 16), skin);
    head.scale.set(1, 1.09, 0.95);
    head.position.y = torsoH + 0.06 * H + headR;
    torso.add(head);

    // 五官（眉·眼·鼻·口·耳）+ 微笑表情
    const face = new THREE.Group();
    head.add(face);
    const fDark = this._toon(0x2b2b2b);
    for (const sx of [-1, 1]) {                       // 眼睛
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13 * headR, 12, 10), fDark);
      eye.position.set(sx * 0.34 * headR, 0.12 * headR, 0.86 * headR);
      face.add(eye);
    }
    for (const sx of [-1, 1]) {                       // 眉毛
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.26 * headR, 0.05 * headR, 0.06 * headR), this._toon(0x4a3326));
      brow.position.set(sx * 0.34 * headR, 0.34 * headR, 0.85 * headR);
      face.add(brow);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.09 * headR, 10, 8), skin);   // 鼻子
    nose.position.set(0, -0.04 * headR, 0.97 * headR);
    face.add(nose);
    for (const sx of [-1, 1]) {                       // 耳朵
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.13 * headR, 10, 8), skin);
      ear.position.set(sx * headR, 0, 0);
      face.add(ear);
    }
    const mouth = new THREE.Mesh(                      // 嘴巴：微笑（下半圆环 ∪）
      new THREE.TorusGeometry(0.24 * headR, 0.04 * headR, 8, 18, Math.PI),
      this._toon(0x9c4a36));
    mouth.rotation.x = Math.PI;
    mouth.position.set(0, -0.4 * headR, 0.82 * headR);
    face.add(mouth);

    // 头发（按长度：短 / 中 / 长）
    const hairLen = c.hair || "medium";
    const cap = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.05, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), hairM);
    cap.scale.set(1.04, 1.08, 1.0);
    cap.position.copy(head.position); cap.position.y += headR * 0.06;
    torso.add(cap);
    const sideLen = hairLen === "long" ? 2.0 * headR : hairLen === "medium" ? 1.0 * headR : 0.3 * headR;
    const hy = head.position.y - sideLen / 2 + headR * 0.15;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.7 * headR, sideLen, 0.55 * headR), hairM);
    back.position.set(0, hy, -0.5 * headR); torso.add(back);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.5 * headR, sideLen, 1.3 * headR), hairM);
      side.position.set(sx * 0.82 * headR, hy, -0.05 * headR); torso.add(side);
    }

    const makeArm = (side) => {
      const arm = new THREE.Group();
      arm.position.set(side * shoulderDX, torsoH - 0.02 * H, 0);
      torso.add(arm);
      const upper = this._capsule(0.036 * H, armUpper, skin);
      upper.position.y = -armUpper / 2; arm.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -armUpper; arm.add(elbow);
      const fore = this._capsule(0.030 * H, armFore, skin);
      fore.position.y = -armFore / 2; elbow.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.036 * H, 12, 10), skin);
      hand.scale.set(1, 1.15, 0.78); hand.position.y = -armFore - 0.02 * H;
      elbow.add(hand);
      return { arm, elbow };
    };
    const makeLeg = (side) => {
      const leg = new THREE.Group();
      leg.position.set(side * hipDX, 0, 0);
      hips.add(leg);
      const th = this._capsule(0.052 * H, thigh, pants);
      th.position.y = -thigh / 2; leg.add(th);
      const knee = new THREE.Group();
      knee.position.y = -thigh; leg.add(knee);
      const sh = this._capsule(0.042 * H, shin, pants);
      sh.position.y = -shin / 2; knee.add(sh);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.072 * H, 0.045 * H, 0.15 * H), shoe);
      foot.position.set(0, -shin - 0.012 * H, 0.035 * H);
      knee.add(foot);
      return { leg, knee };
    };

    const LG = makeLeg(-1), RG = makeLeg(1);
    const AL = makeArm(-1), AR = makeArm(1);

    if (state === "raise") {
      AL.arm.rotation.z = -2.9; AR.arm.rotation.z = 2.9;
      AL.arm.rotation.x = 0.12; AR.arm.rotation.x = 0.12;
    } else if (state === "squat") {
      for (const L of [LG, RG]) { L.leg.rotation.x = -1.15; L.knee.rotation.x = 2.1; }
      torso.rotation.x = -0.24;
      AL.arm.rotation.x = -0.55; AR.arm.rotation.x = -0.55;
      AL.arm.rotation.z = -0.25; AR.arm.rotation.z = 0.25;
    } else if (state === "sit") {
      for (const L of [LG, RG]) { L.leg.rotation.x = -Math.PI / 2; L.knee.rotation.x = Math.PI / 2; }
      AL.arm.rotation.x = -0.6; AR.arm.rotation.x = -0.6;
      AL.arm.rotation.z = -0.22; AR.arm.rotation.z = 0.22;
    } else if (state === "lie") {
      body.rotation.x = Math.PI / 2;
      body.position.y = H * 0.09;
      shadow.visible = false;
    } else {
      AL.arm.rotation.z = -0.13; AR.arm.rotation.z = 0.13;
      AL.arm.rotation.x = 0.06; AR.arm.rotation.x = 0.06;
    }
  }

  // 真实家具模型
  // 注意：显示单位 1 = 200mm = 0.2m，故"米 -> 单位"需 ×5（u()）
  _realisticFurniture(f, DR) {
    const fw = (f.width||800)/DR, fd = (f.depth||800)/DR;
    const H = furnHeight(f.type, 800) / DR;       // 家具总高（已是正确的显示单位）
    const col = f.color || "#8E7CC3";
    const u = (m) => m * 5;                         // 米 -> 显示单位（1 单位 = 0.2m）
    const grp = new THREE.Group();
    grp.position.set(f.x/DR, 0, f.y/DR);
    grp.rotation.y = -(f.rotation||0) * Math.PI/180;
    const add = (w, h, d, color, cx, cy, cz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this._toon(color));
      this._outline(m, 1.04); m.position.set(cx, cy, cz); grp.add(m); return m;
    };
    switch (f.type) {
      case "bed": {
        add(fw, u(0.25), fd, col, 0, u(0.125), 0);                          // 床架
        add(fw*0.94, u(0.22), fd*0.82, "#f5f0e6", 0, u(0.36), -fd*0.05);    // 床垫
        add(fw*0.32, u(0.12), fd*0.24, "#ffffff", -fw*0.26, u(0.56), -fd*0.28); // 枕头
        add(fw*0.32, u(0.12), fd*0.24, "#ffffff",  fw*0.26, u(0.56), -fd*0.28);
        break;
      }
      case "sofa": {
        add(fw, u(0.42), fd, col, 0, u(0.21), 0);                          // 座基
        add(fw, u(0.45), fd*0.22, col, 0, u(0.42)+u(0.225), -fd*0.39);     // 靠背
        add(fw*0.12, u(0.6), fd*0.55, col, -fw*0.44, u(0.3), 0);           // 扶手
        add(fw*0.12, u(0.6), fd*0.55, col,  fw*0.44, u(0.3), 0);
        break;
      }
      case "table": {
        const topH = u(0.75), topT = u(0.06), legW = u(0.08);
        add(fw, topT, fd, "#caa472", 0, topH, 0);
        for (const [sx, sz] of [[-1,-1],[1,-1],[-1,1],[1,1]])
          add(legW, topH-topT, legW, "#7a5a3a", sx*(fw/2-legW), (topH-topT)/2, sz*(fd/2-legW));
        break;
      }
      case "chair": {
        const sh = u(0.45), st = u(0.06), legW = u(0.06);
        add(fw, st, fd, col, 0, sh, 0);
        add(fw, u(0.45), fd*0.2, col, 0, sh+u(0.225), -fd*0.4);
        for (const [sx, sz] of [[-1,-1],[1,-1],[-1,1],[1,1]])
          add(legW, sh-st, legW, "#7a5a3a", sx*(fw/2-legW), (sh-st)/2, sz*(fd/2-legW));
        break;
      }
      case "fridge": {
        add(fw, H, fd, col, 0, H/2, 0);
        add(fw*0.04, H*0.35, fd*0.18, "#d8d8d8", 0, H*0.7, fd*0.5); // 把手
        break;
      }
      case "cabinet": {
        add(fw, H, fd, col, 0, H/2, 0);
        add(fw*0.9, H*0.02, fd*0.9, "#00000022", 0, H*0.5, fd*0.5); // 门缝
        break;
      }
      case "bookshelf": {
        add(fw*0.12, H, fd, col, -fw*0.44, H/2, 0);
        add(fw*0.12, H, fd, col,  fw*0.44, H/2, 0);
        for (let i = 1; i <= 4; i++) add(fw*0.88, 0.05, fd, col, 0, H*i/5, 0);
        break;
      }
      case "tv": {
        add(fw, H, fd, col, 0, H/2, 0);
        add(fw*0.7, H*0.5, 0.05, "#1b1b1b", 0, H + H*0.25, -fd*0.5);
        break;
      }
      case "plant": {
        add(u(0.4), u(0.4), u(0.4), "#a0623a", 0, u(0.2), 0);
        const foliage = new THREE.Mesh(new THREE.SphereGeometry(Math.min(fw,fd)/2, 12, 12), this._toon("#2E7D32"));
        this._outline(foliage, 1.04); foliage.position.set(0, H*0.7, 0); grp.add(foliage);
        break;
      }
      case "toilet": {
        add(fw*0.7, u(0.6), fd*0.4, col, 0, u(0.3), fd*0.28);   // 水箱
        const bowl = new THREE.Mesh(new THREE.BoxGeometry(fw, u(0.4), fd*0.7), this._toon(col));
        this._outline(bowl, 1.04); bowl.position.set(0, u(0.2), -fd*0.15); grp.add(bowl);
        break;
      }
      case "stove": {
        add(fw, H, fd, col, 0, H/2, 0); // 柜体
        const top = new THREE.Mesh(new THREE.BoxGeometry(fw*0.96, u(0.06), fd*0.96), this._toon("#222222"));
        this._outline(top, 1.02); top.position.set(0, H - u(0.03), 0); grp.add(top);
        const burner = (bx, bz) => {
          const r = new THREE.Mesh(new THREE.CylinderGeometry(u(0.12), u(0.12), u(0.04), 16), this._toon("#444444"));
          r.position.set(bx, H + u(0.005), bz); grp.add(r);
        };
        burner(-fw*0.22, -fd*0.2); burner(fw*0.22, -fd*0.2);
        burner(-fw*0.22, fd*0.2); burner(fw*0.22, fd*0.2);
        break;
      }
      case "sink": {
        add(fw, H, fd, col, 0, H/2, 0);
        const basin = new THREE.Mesh(new THREE.BoxGeometry(fw*0.8, u(0.06), fd*0.7), this._toon("#cfd6da"));
        this._outline(basin, 1.02); basin.position.set(0, H - u(0.03), 0); grp.add(basin);
        add(u(0.06), u(0.35), u(0.06), "#9aa0a4", fw*0.3, H + u(0.15), -fd*0.1); // 水龙头立管
        add(u(0.28), u(0.06), u(0.06), "#9aa0a4", fw*0.18, H + u(0.32), -fd*0.1); // 出水臂
        break;
      }
      default: {
        add(fw, H, fd, col, 0, H/2, 0);
      }
    }
    this.root.add(grp);
  }

  _animate() {
    if (!this.ready) return;
    this._raf = requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene3, this.camera);
  }
}
