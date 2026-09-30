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

  _toon(hex) {
    return new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) });
  }

  _wallBox(cx, cz, len, h, t, ang, yCenter, color, opacity) {
    const geo = new THREE.BoxGeometry(len, h, t);
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color === undefined ? 0xc9a27e : color) });
    if (opacity !== undefined && opacity < 1) { mat.transparent = true; mat.opacity = opacity; }
    const mesh = new THREE.Mesh(geo, mat);
    this._outline(mesh, 1.02);
    mesh.position.set(cx, yCenter !== undefined ? yCenter : h / 2, cz);
    mesh.rotation.y = ang;
    this.root.add(mesh);
  }

  // 将一条墙按门窗位置切成多段：门整高留空、窗中段留空（上下保留墙）
  _buildWall(w, DR, openings) {
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
    const wallOpacity = kind === "glass" ? 0.4 : 1.0;

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
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(ow, wh, Math.max(0.06, t * 1.15)),
          new THREE.MeshLambertMaterial({ color: 0x9fd8e6, transparent: true, opacity: 0.5 }));
        this._outline(mesh, 1.03);
        mesh.position.set(px, gy, pz);
        mesh.rotation.y = ang;
        this.root.add(mesh);
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
    const realistic = !!(opts && opts.realistic);
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
    for (const w of walls) this._buildWall(w, DR, scene.openings || []);

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

    // 相机对准中心
    this.controls.target.set((minx+maxx)/2/DR, 2, (miny+maxy)/2/DR);
    this.controls.update();
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

    const hair = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.04, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.56), hairM);
    hair.scale.set(1, 1.06, 0.99);
    hair.position.copy(head.position); hair.position.y += headR * 0.06;
    torso.add(hair);

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
  _realisticFurniture(f, DR) {
    const fw = (f.width||800)/DR, fd = (f.depth||800)/DR;
    const H = furnHeight(f.type, 800) / DR;
    const col = f.color || "#8E7CC3";
    const grp = new THREE.Group();
    grp.position.set(f.x/DR, 0, f.y/DR);
    grp.rotation.y = -(f.rotation||0) * Math.PI/180;
    const add = (w, h, d, color, cx, cy, cz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this._toon(color));
      this._outline(m, 1.04); m.position.set(cx, cy, cz); grp.add(m); return m;
    };
    switch (f.type) {
      case "bed": {
        const baseH = 0.3, matH = 0.25;
        add(fw, baseH, fd, col, 0, baseH/2, 0);
        add(fw*0.94, matH, fd*0.82, "#f5f0e6", 0, baseH+matH/2, -fd*0.05);
        add(fw*0.32, 0.12, fd*0.24, "#ffffff", -fw*0.26, baseH+matH+0.06, -fd*0.28);
        add(fw*0.32, 0.12, fd*0.24, "#ffffff",  fw*0.26, baseH+matH+0.06, -fd*0.28);
        break;
      }
      case "sofa": {
        add(fw, 0.35, fd, col, 0, 0.175, 0);
        add(fw, 0.5, fd*0.22, col, 0, 0.5, -fd*0.39);
        add(fw*0.12, 0.42, fd*0.55, col, -fw*0.44, 0.42, 0);
        add(fw*0.12, 0.42, fd*0.55, col,  fw*0.44, 0.42, 0);
        break;
      }
      case "table": {
        const topH = 0.75, topT = 0.06, legW = 0.1;
        add(fw, topT, fd, "#caa472", 0, topH, 0);
        for (const [sx, sz] of [[-1,-1],[1,-1],[-1,1],[1,1]])
          add(legW, topH-topT, legW, "#7a5a3a", sx*(fw/2-legW), (topH-topT)/2, sz*(fd/2-legW));
        break;
      }
      case "chair": {
        const sh = 0.45, st = 0.06, legW = 0.08;
        add(fw, st, fd, col, 0, sh, 0);
        add(fw, 0.4, fd*0.2, col, 0, sh+0.2, -fd*0.4);
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
        add(0.4, 0.4, 0.4, "#a0623a", 0, 0.2, 0);
        const foliage = new THREE.Mesh(new THREE.SphereGeometry(Math.min(fw,fd)/2, 12, 12), this._toon("#2E7D32"));
        this._outline(foliage, 1.04); foliage.position.set(0, H*0.7, 0); grp.add(foliage);
        break;
      }
      case "toilet": {
        add(fw*0.7, 0.4, fd*0.4, col, 0, 0.2, fd*0.28); // 水箱
        const bowl = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.45, fd*0.7), this._toon(col));
        this._outline(bowl, 1.04); bowl.position.set(0, 0.225, -fd*0.15); grp.add(bowl);
        break;
      }
      case "stove": {
        add(fw, H, fd, col, 0, H/2, 0); // 柜体
        const top = new THREE.Mesh(new THREE.BoxGeometry(fw*0.96, 0.06, fd*0.96), this._toon("#222222"));
        this._outline(top, 1.02); top.position.set(0, H - 0.03, 0); grp.add(top);
        const burner = (bx, bz) => {
          const r = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 16), this._toon("#444444"));
          r.position.set(bx, H + 0.005, bz); grp.add(r);
        };
        burner(-fw*0.22, -fd*0.2); burner(fw*0.22, -fd*0.2);
        burner(-fw*0.22, fd*0.2); burner(fw*0.22, fd*0.2);
        break;
      }
      case "sink": {
        add(fw, H, fd, col, 0, H/2, 0);
        const basin = new THREE.Mesh(new THREE.BoxGeometry(fw*0.8, 0.06, fd*0.7), this._toon("#cfd6da"));
        this._outline(basin, 1.02); basin.position.set(0, H - 0.03, 0); grp.add(basin);
        add(0.06, 0.35, 0.06, "#9aa0a4", fw*0.3, H + 0.15, -fd*0.1); // 水龙头立管
        add(0.28, 0.06, 0.06, "#9aa0a4", fw*0.18, H + 0.32, -fd*0.1); // 出水臂
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
