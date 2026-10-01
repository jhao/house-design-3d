// 主程序：编排 UI、API、2D/3D 编辑器、自动保存
const FURN_DEFAULTS = {
  bed:      { label: "床",     width: 1500, depth: 2000, color: "#8E7CC3" },  // 双人床 1.5×2.0m
  sofa:     { label: "沙发",   width: 2100, depth: 900,  color: "#E67C73" },  // 三人沙发 2.1×0.9m
  table:    { label: "桌子",   width: 1400, depth: 800,  color: "#F6BF26" },  // 餐桌 1.4×0.8m
  chair:    { label: "椅子",   width: 480,  depth: 500,  color: "#43A047" },  // 餐椅 0.48×0.5m
  fridge:   { label: "冰箱",   width: 700,  depth: 700,  color: "#9E9E9E" },  // 双门冰箱 0.7×0.7m
  cabinet:  { label: "柜子",   width: 1200, depth: 600,  color: "#A1887F" },  // 衣柜 1.2×0.6m
  bookshelf:{ label: "书架",   width: 900,  depth: 350,  color: "#5C6BC0" },  // 落地书架 0.9×0.35m
  tv:       { label: "电视柜", width: 1800, depth: 400,  color: "#37474F" },  // 地柜 1.8×0.4m
  plant:    { label: "绿植",   width: 500,  depth: 500,  color: "#2E7D32" },  // 落地盆栽 φ0.5m
  toilet:   { label: "马桶",   width: 400,  depth: 700,  color: "#B0BEC5" },  // 马桶 0.4×0.7m
  stove:    { label: "灶具",   width: 600,  depth: 600,  color: "#37474F" },  // 灶台 0.6×0.6m
  sink:     { label: "水盆",   width: 800,  depth: 500,  color: "#90A4AE" },  // 双槽 0.8×0.5m
  image:    { label: "自定义", width: 800,  depth: 800,  color: "#90A4AE" },
};
const FURN_EMOJI = { bed:"🛏️", sofa:"🛋️", table:"🪑", chair:"🪑", fridge:"🧊", cabinet:"🗄️", bookshelf:"📚", tv:"📺", plant:"🪴", toilet:"🚽", stove:"🔥", sink:"🚰", image:"🖼️" };

// 家具默认高度（mm）——启动时会被【系统设置】里保存的值覆盖
const FURN_HEIGHTS = {
  bed: 550, sofa: 850, table: 750, chair: 900, fridge: 1800, cabinet: 2000,
  bookshelf: 2000, tv: 450, plant: 1200, toilet: 700, stove: 850, sink: 900,
  image: 1500,
};

// 墙体类型选项 + 默认厚度（mm）
const WALL_KINDS = [
  ["normal", "普通墙"], ["bearing", "承重墙"], ["glass", "玻璃墙"],
  ["beam", "梁"], ["column", "柱"],
];
const WALL_THICK = { normal: 150, bearing: 300, glass: 150, beam: 200, column: 700 };

// 门的开门方向
const DOOR_DIRS = [
  ["left_in", "左侧向里开"], ["left_out", "左侧向外开"],
  ["right_in", "右侧向里开"], ["right_out", "右侧向外开"],
  ["double_in", "两侧双门向里开"], ["double_out", "两侧双门向外开"],
];
// 人物状态
const CHAR_STATES = [["stand","站立"],["raise","举手"],["squat","蹲下"],["sit","坐下"],["lie","躺下"]];

const state = { project: null, scene: null, mode: "2d", realistic: false };
let editor2d, editor3d;
let saveTimer = null;

function $(id) { return document.getElementById(id); }

window.addEventListener("DOMContentLoaded", async () => {
  editor2d = new Editor2D($("canvas2d"), {
    onSelect: (sel) => { renderProps(sel); updateAlignBar(); },
    onSceneChange: scheduleSave,
    onViewChange: updateZoomWidget,
    onHistoryMsg: toast,
    wallThickness: WALL_THICK,
  });
  if ($("minimap")) editor2d.attachMinimap($("minimap"));
  buildFurnGrid();
  bindUI();
  bindZoombar();
  bindShortcuts();
  bindModal();
  await loadRuntimeSettings();
  window.addEventListener("resize", () => { if (!editor2d) return; editor2d.resize(); updateZoomWidget(); });
  const list = await loadProjects();
  if (state.project) await selectProject(state.project.id);
  else if (list.length) await selectProject(list[0].id);
  else await createBlank();
  updateScaleWidget();
  updateZoomWidget();
  const h = $("hint");
  if (h) h.textContent = "左键点选/框选 · 右键平移 · 滚轮缩放 · 多选后顶部出现对齐工具条 · 门窗可在墙上拖拽 · Ctrl/⌘ 单击加/减选 · ⌘C/⌘V 复制粘贴 · Del 删除 · ⌘Z 撤销/⌘⇧Z 重做 · Alt 拖拽旋转 · 方向键 0.1m 微移";
});

// ---------- 系统设置：家具默认值 / 大模型配置状态 ----------
async function loadRuntimeSettings() {
  try {
    const s = await API.getSettings();
    const defs = s.furniture_defaults || {};
    for (const [k, v] of Object.entries(defs)) {
      if (!v) continue;
      FURN_DEFAULTS[k] = Object.assign(FURN_DEFAULTS[k] || {}, {
        label: v.label, width: v.width, depth: v.depth, color: v.color,
      });
      if (v.height) FURN_HEIGHTS[k] = v.height;
    }
    // 3D 渲染会优先读取 window.FURN_HEIGHT
    window.FURN_HEIGHT = Object.assign({}, FURN_HEIGHTS);
    buildFurnGrid();
  } catch (e) {
    console.warn("加载系统设置失败，回退内置默认值", e);
    window.FURN_HEIGHT = Object.assign({}, FURN_HEIGHTS);
  }
}

// ---------- 通用输入弹窗（沙箱 iframe 会屏蔽 window.prompt） ----------
let _modalResolve = null;
function bindModal() {
  const inp = $("modalInput");
  $("modalOk").onclick = () => _modalSubmit();
  $("modalCancel").onclick = () => _modalClose(null);
  $("modalMask").onclick = (e) => { if (e.target === $("modalMask")) _modalClose(null); };
  inp.onkeydown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); _modalSubmit(); }
    else if (e.key === "Escape") { e.preventDefault(); _modalClose(null); }
  };
}
function _modalClose(val) {
  $("modalMask").classList.add("hidden");
  const r = _modalResolve; _modalResolve = null;
  if (r) r(val);
}
function _modalSubmit() {
  const inp = $("modalInput");
  if (inp.dataset.kind === "text") {
    const v = (inp.value || "").trim();
    if (!v && inp.dataset.allowEmpty !== "1") { $("modalErr").textContent = "请输入内容"; return; }
    _modalClose(v);
    return;
  }
  const v = parseFloat(inp.value);
  const min = parseFloat(inp.dataset.min), max = parseFloat(inp.dataset.max);
  if (!isFinite(v)) { $("modalErr").textContent = "请输入有效数字"; return; }
  if (isFinite(min) && v < min) { $("modalErr").textContent = `不能小于 ${min}`; return; }
  if (isFinite(max) && v > max) { $("modalErr").textContent = `不能大于 ${max}`; return; }
  _modalClose(v);
}
function askValue({ title, desc, def, unit = "", step = 0.01, min, max, type = "number", allowEmpty = false }) {
  return new Promise((resolve) => {
    _modalResolve = resolve;
    $("modalTitle").textContent = title;
    $("modalDesc").textContent = desc || "";
    $("modalUnit").textContent = unit;
    $("modalErr").textContent = "";
    const inp = $("modalInput");
    const textMode = type === "text";
    inp.dataset.kind = textMode ? "text" : "number";
    inp.type = textMode ? "text" : "number";
    inp.dataset.allowEmpty = allowEmpty ? "1" : "";
    inp.value = def === undefined || def === null ? "" : def;
    inp.step = step;
    if (textMode) { delete inp.dataset.min; delete inp.dataset.max; }
    else {
      if (min !== undefined) inp.dataset.min = min; else delete inp.dataset.min;
      if (max !== undefined) inp.dataset.max = max; else delete inp.dataset.max;
    }
    $("modalMask").classList.remove("hidden");
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}

let _toastTimer = null;
function toast(msg, ms = 2000) {
  const t = $("toast"); if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

// ---------- 项目 ----------
async function loadProjects() {
  const list = await API.listProjects();
  renderProjList(list);
  return list;
}

function renderProjList(list) {
  const ul = $("projList"); ul.innerHTML = "";
  list.forEach(p => {
    const li = document.createElement("li");
    li.dataset.id = p.id;
    if (state.project && state.project.id === p.id) li.className = "active";
    const d = new Date(p.updated_at * 1000);
    li.innerHTML = `<div>${escapeHtml(p.name)}</div><div class="meta">${d.toLocaleString()}</div>`;
    li.onclick = () => selectProject(p.id);
    ul.appendChild(li);
  });
}

function markActive(id) {
  const sid = String(id);
  [...$("projList").children].forEach(li => li.classList.toggle("active", li.dataset.id === sid));
}

async function selectProject(id) {
  const p = await API.getProject(id);
  state.project = p; state.scene = p.scene;
  $("projName").textContent = p.name;
  applyScene(p.scene);
  markActive(id);
  updateScaleWidget();
}

async function createBlank() {
  const p = await API.createProject("未命名房型", null);
  state.project = p; state.scene = p.scene;
  $("projName").textContent = p.name;
  applyScene(p.scene);
  await loadProjects();
  markActive(p.id);
  updateScaleWidget();
}

function applyScene(scene) {
  state.scene = scene;
  if (state.project) editor2d.setProjectId(state.project.id);  // 恢复该项目本地保存的视图（缩放/平移）
  editor2d.setScene(scene, true);   // keepView：刷新页面 / 识别房间后保持当前缩放比例
  for (const f of scene.furniture || []) if (f.type === "image" && f.imageUrl) editor2d.preloadImage(f.imageUrl);
  renderProps(null);
  renderAreas();
  if (state.mode === "3d" && editor3d) editor3d.build(scene, { realistic: state.realistic });
  updateZoomWidget();
}

// ---------- 自动保存 ----------
function scheduleSave() {
  $("saveState").textContent = "保存中…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!state.project) return;
    try {
      const p = await API.updateProject(state.project.id, state.scene);
      state.project.updated_at = p.updated_at;
      $("projName").textContent = p.name;
      $("saveState").textContent = "已保存";
    } catch (e) { $("saveState").textContent = "保存失败"; console.error(e); }
  }, 600);
}

// ---------- 属性面板 ----------
function renderProps(sel) {
  const box = $("props");
  if (!sel) { box.innerHTML = "未选中元素（左键圈选/点选 墙体 / 门窗 / 家具 / 人物）"; return; }
  const el = editor2d.getSelected();
  if (!el) { box.innerHTML = "元素已删除"; return; }
  if (sel.type === "furniture") return renderFurnitureProps(el, box);
  if (sel.type === "wall") return renderWallProps(el, box);
  if (sel.type === "opening") return renderOpeningProps(el, box);
  if (sel.type === "character") return renderCharacterProps(el, box);
  if (sel.type === "room") return renderRoomProps(el, box);
}

function numInput(label, val, opt) {
  opt = opt || {};
  const div = opt.div || 1000;
  const unit = opt.unit || (div === 1 ? "" : "m");
  const step = opt.step || (div === 1 ? 1 : 0.01);
  const disp = Number((val / div).toFixed(3));
  const suffix = unit ? ` (${unit})` : "";
  return `<label>${label}${suffix}<input type="number" value="${disp}" step="${step}" data-k="${label}" data-div="${div}"></label>`;
}
function bindNum(box, apply) {
  box.querySelectorAll('input[type="number"]').forEach(inp => {
    inp.onchange = () => {
      beginEdit();
      const div = parseFloat(inp.dataset.div) || 1;
      apply(inp.dataset.k, (parseFloat(inp.value) || 0) * div);
      afterEdit();
    };
  });
}
function afterEdit() { renderAreas(); scheduleSave(); editor2d.render(); if (state.mode==="3d"&&editor3d) editor3d.build(state.scene, { realistic: state.realistic }); }

function renderWallProps(w, box) {
  const kindOpts = WALL_KINDS.map(([v, l]) => `<option value="${v}" ${v===(w.kind||"normal")?"selected":""}>${l}</option>`).join("");
  box.innerHTML = `<div style="font-weight:700;margin-bottom:6px">🧱 墙体</div>` +
    `<label>类型<select id="wK">${kindOpts}</select></label>` +
    `<div class="row2">` + numInput("起点X", w.x1) + numInput("起点Y", w.y1) + `</div>` +
    `<div class="row2">` + numInput("终点X", w.x2) + numInput("终点Y", w.y2) + `</div>` +
    numInput("厚度", w.thickness) + numInput("层高", w.height) +
    `<div style="display:flex;gap:6px;margin:6px 0"><button id="addDoor">➕ 门</button><button id="addWin">➕ 窗</button></div>` +
    `<button class="del" id="delBtn">删除墙体</button>`;
  $("wK").onchange = () => { w.kind = $("wK").value; w.thickness = WALL_THICK[w.kind] || 150; afterEdit(); };
  $("addDoor").onclick = () => addOpening(w, "door");
  $("addWin").onclick = () => addOpening(w, "window");
  bindNum(box, (k, v) => {
    const map = { "起点X":"x1","起点Y":"y1","终点X":"x2","终点Y":"y2","厚度":"thickness","层高":"height" };
    w[map[k]] = v;
  });
  $("delBtn").onclick = () => { beginEdit(); state.scene.walls = state.scene.walls.filter(x=>x.id!==w.id); state.scene.openings = state.scene.openings.filter(o=>o.wall_id!==w.id); editor2d.setSelection(null); afterEdit(); };
}

function addOpening(w, type) {
  beginEdit();
  const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1;
  const o = {
    id: `o${Date.now()}`,
    wall_id: w.id,
    type,
    offset: Math.round(L / 2),
    width: type === "door" ? 900 : 1500,
    height: type === "door" ? (state.scene.ceiling_height || 2900) - 80 : 1500,
  };
  if (type === "door") o.dir = "left_in";
  state.scene.openings = state.scene.openings || [];
  state.scene.openings.push(o);
  editor2d.setSelection({ type: "opening", id: o.id });
  afterEdit();
}

function renderOpeningProps(o, box) {
  const wallOpts = (state.scene.walls||[]).map(w=>`<option value="${w.id}" ${w.id===o.wall_id?"selected":""}>墙 ${w.id}</option>`).join("");
  const typeOpts = `<option value="door" ${o.type==="door"?"selected":""}>门</option><option value="window" ${o.type==="window"?"selected":""}>窗</option>`;
  const dirOpts = DOOR_DIRS.map(([v,l])=>`<option value="${v}" ${v===(o.dir||"left_in")?"selected":""}>${l}</option>`).join("");
  box.innerHTML = `<div style="font-weight:700;margin-bottom:6px">🚪 门窗</div>` +
    `<label>类型<select id="oT">${typeOpts}</select></label>` +
    `<label>所属墙<select id="oW">${wallOpts}</select></label>` +
    (o.type === "door" ? `<label>开门方向<select id="oD">${dirOpts}</select></label>` : "") +
    numInput("偏移", o.offset) + numInput("宽度", o.width) + numInput("高度", o.height) +
    `<button class="del" id="delBtn">删除</button>`;
  box.querySelectorAll("select").forEach(s => s.onchange = () => {
    if (s.id==="oT") { o.type = s.value; if (o.type==="door" && !o.dir) o.dir="left_in"; }
    if (s.id==="oW") o.wall_id = s.value;
    if (s.id==="oD") o.dir = s.value;
    afterEdit();
  });
  bindNum(box, (k, v) => { const map={"偏移":"offset","宽度":"width","高度":"height"}; o[map[k]]=v; });
  $("delBtn").onclick = () => { beginEdit(); state.scene.openings = state.scene.openings.filter(x=>x.id!==o.id); editor2d.setSelection(null); afterEdit(); };
}

function renderCharacterProps(c, box) {
  const stateOpts = CHAR_STATES.map(([v,l])=>`<option value="${v}" ${v===(c.state||"stand")?"selected":""}>${l}</option>`).join("");
  box.innerHTML = `<div style="font-weight:700;margin-bottom:6px">👤 人物</div>` +
    `<label>状态<select id="cS">${stateOpts}</select></label>` +
    numInput("X", c.x) + numInput("Y", c.y) +
    numInput("身高", c.height, { step: 0.05 }) +
    numInput("旋转°", c.rotation, { div: 1, unit: "°" }) +
    `<label>颜色<input type="color" value="${c.color||"#3a7bd5"}" id="cC"></label>` +
    `<button class="del" id="delBtn">删除人物</button>`;
  $("cS").onchange = () => { c.state = $("cS").value; afterEdit(); };
  $("cC").onchange = () => { c.color = $("cC").value; afterEdit(); };
  bindNum(box, (k, v) => { const map={"X":"x","Y":"y","身高":"height","旋转°":"rotation"}; c[map[k]]=v; });
  $("delBtn").onclick = () => { beginEdit(); state.scene.characters = state.scene.characters.filter(x=>x.id!==c.id); editor2d.setSelection(null); afterEdit(); };
}

function renderFurnitureProps(f, box) {
  box.innerHTML = `<div style="font-weight:700;margin-bottom:6px">${FURN_EMOJI[f.type]||"🪑"} ${f.label||f.type}</div>` +
    `<label>类型<select id="fT">${Object.keys(FURN_DEFAULTS).map(t=>`<option value="${t}" ${t===f.type?"selected":""}>${FURN_DEFAULTS[t].label}</option>`).join("")}</select></label>` +
    numInput("X", f.x) + numInput("Y", f.y) +
    numInput("宽", f.width) + numInput("深", f.depth) +
    numInput("旋转°", f.rotation, { div: 1, unit: "°" }) +
    `<label>颜色<input type="color" value="${f.color}" id="fC"></label>` +
    `<button class="del" id="delBtn">删除家具</button>`;
  $("fT").onchange = () => { f.type=$("fT").value; const d=FURN_DEFAULTS[f.type]; f.label=d.label; if(!f.imageUrl){f.width=d.width;f.depth=d.depth;f.color=d.color;} afterEdit(); renderProps(editor2d.selection); };
  $("fC").onchange = () => { f.color = $("fC").value; afterEdit(); };
  bindNum(box, (k, v) => { const map={"X":"x","Y":"y","宽":"width","深":"depth","旋转°":"rotation"}; f[map[k]]=v; });
  $("delBtn").onclick = () => { beginEdit(); state.scene.furniture = state.scene.furniture.filter(x=>x.id!==f.id); editor2d.setSelection(null); afterEdit(); };
}

function renderRoomProps(r, box) {
  box.innerHTML = `<div style="font-weight:700;margin-bottom:6px">🟦 房间</div>` +
    `<label>名称<input id="rN" value="${escapeHtml(r.name)}"></label>` +
    `<label>颜色<input type="color" value="${r.color}" id="rC"></label>` +
    `<div style="font-size:12px;color:#8a7c6a">面积：${((r.area||0)/1e6).toFixed(2)} ㎡</div>`;
  $("rN").onchange = () => { beginEdit(); r.name = $("rN").value; afterEdit(); };
  $("rC").onchange = () => { beginEdit(); r.color = $("rC").value; afterEdit(); };
}

// ---------- 面积 ----------
function renderAreas() {
  const box = $("areas");
  const rooms = state.scene.rooms || [];
  let total = 0; let html = "";
  rooms.forEach(r => {
    const a = (r.area || 0) / 1e6; total += a;
    html += `<div class="r"><span><span class="sw" style="background:${r.color}"></span>${escapeHtml(r.name)}</span><b>${a.toFixed(2)} ㎡</b></div>`;
  });
  box.innerHTML = `<div class="total">总面积：${total.toFixed(2)} ㎡</div>${html || '<div style="color:#8a7c6a">暂无房间，点「识别房间」</div>'}`;
}

// ---------- 家具库 ----------
function buildFurnGrid() {
  const g = $("furnGrid"); g.innerHTML = "";
  Object.keys(FURN_DEFAULTS).forEach(t => {
    if (t === "image") return;
    const b = document.createElement("button");
    b.textContent = `${FURN_EMOJI[t]||""} ${FURN_DEFAULTS[t].label}`;
    b.onclick = () => addFurniture(t);
    g.appendChild(b);
  });
}
function addFurniture(type) {
  const d = FURN_DEFAULTS[type];
  beginEdit();
  const b = editor2d._bounds();
  const cx = b ? (b.minx + b.maxx)/2 : 2000, cy = b ? (b.miny + b.maxy)/2 : 2000;
  const item = { id: `f${Date.now()}`, type, x: Math.round(cx), y: Math.round(cy), width: d.width, depth: d.depth, rotation: 0, color: d.color, label: d.label };
  state.scene.furniture = state.scene.furniture || [];
  state.scene.furniture.push(item);
  editor2d.setScene(state.scene, true);
  editor2d.setSelection({ type: "furniture", id: item.id });
  afterEdit();
}

// ---------- 人物 ----------
function addCharacter() {
  beginEdit();
  const b = editor2d._bounds();
  const cx = b ? (b.minx + b.maxx)/2 : 2000, cy = b ? (b.miny + b.maxy)/2 : 2000;
  const item = { id: `c${Date.now()}`, x: Math.round(cx), y: Math.round(cy), height: 1700, state: "stand", rotation: 0, color: "#3a7bd5", label: "人" };
  state.scene.characters = state.scene.characters || [];
  state.scene.characters.push(item);
  editor2d.setScene(state.scene, true);
  editor2d.setSelection({ type: "character", id: item.id });
  afterEdit();
}

// ---------- 工具栏 ----------
// ---------- 导入图纸：图片 / PDF / DWG 走多模态大模型识别 ----------
const VISION_EXT = /\.(jpe?g|png|webp|bmp|gif|tiff?|pdf|dwg)$/i;

function isVisionFile(f) {
  return VISION_EXT.test(f.name || "") || (f.type || "").startsWith("image/");
}

function showRecog(title, desc) {
  const m = $("recogMask"); if (!m) return;
  if (title && $("recogTitle")) $("recogTitle").textContent = title;
  if (desc && $("recogDesc")) $("recogDesc").textContent = desc;
  m.classList.remove("hidden");
}
function hideRecog() {
  const m = $("recogMask"); if (m) m.classList.add("hidden");
}

async function doImportFile(f) {
  const vision = isVisionFile(f);
  const fd = new FormData();
  fd.append("file", f);
  fd.append("name", (f.name || "导入的房型").replace(/\.[^.]+$/, ""));

  if (vision) {
    const hint = await askValue({
      title: "🤖 图纸识别提示词（可留空）",
      desc: "补充说明这张图纸的情况，会一起发给多模态大模型以提高识别准确度。\n例如：这是三室两厅户型，比例 1:100，请重点识别承重墙。\n不需要补充就直接点确定。",
      def: "", type: "text", allowEmpty: true,
    });
    if (hint === null) return;               // 用户取消
    if (hint) fd.append("hint", hint);
  }

  showRecog(
    vision ? "AI 正在识别图纸…" : "正在解析图纸…",
    vision ? `正在调用多模态大模型解析「${f.name}」，通常需要 20~90 秒，请耐心等待`
           : `正在解析「${f.name}」的墙体线框`
  );
  const t0 = Date.now();
  try {
    const p = await API.importNew(fd);
    await loadProjects();
    await selectProject(p.id);
    doFit();
    const walls = (p.scene && p.scene.walls || []).length;
    const rooms = (p.scene && p.scene.rooms || []).length;
    const openings = (p.scene && p.scene.openings || []);
    const doors = openings.filter((o) => o.type === "door").length;
    const wins = openings.filter((o) => o.type === "window").length;
    const furn = (p.scene && p.scene.furniture || []).length;
    const ms = Date.now() - t0;
    updateScaleWidget();
    showImportResult({
      ok: true,
      sub: vision ? `「${f.name}」已由多模态大模型识别导入` : `「${f.name}」已按线框解析导入`,
      lines: [
        `项目：${p.name}`,
        `耗时：${(ms / 1000).toFixed(1)} 秒`,
        `墙体：${walls} 面`,
        `房间：${rooms} 个`,
        `门：${doors} 扇 · 窗：${wins} 扇`,
        `家具：${furn} 件`,
      ],
    });
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = (err && err.message) ? err.message : String(err);
    // 错误信息形如 "请求失败 400: 详情"，剥离前缀
    const detail = msg.replace(/^请求失败 \d+:\s*/, "");
    showImportResult({
      ok: false,
      sub: vision ? `「${f.name}」识别失败（耗时 ${(ms / 1000).toFixed(1)} 秒）` : `「${f.name}」导入失败`,
      error: detail,
    });
  } finally {
    hideRecog();
  }
}

// 导入结果确认弹窗（成功/失败都给明确反馈，让用户确认）
function showImportResult({ ok, sub, lines, error }) {
  const mask = $("resultMask");
  if (!mask) return;
  $("resultIcon").textContent = ok ? "✅" : "⚠️";
  $("resultTitle").textContent = ok ? "导入成功" : "导入未完成";
  $("resultSub").textContent = sub || "";
  $("resultIcon").className = "result-icon " + (ok ? "ok" : "bad");
  const list = $("resultList");
  list.innerHTML = (lines || []).map((t) => `<li>${t}</li>`).join("");
  list.style.display = ok && lines && lines.length ? "" : "none";
  const errBox = $("resultErr");
  errBox.textContent = error || "";
  errBox.style.display = error ? "" : "none";
  // 失败时显示"前往系统设置"按钮，成功时隐藏
  $("resultSettings").style.display = ok ? "none" : "";
  mask.classList.remove("hidden");
}
function hideImportResult() {
  const mask = $("resultMask");
  if (mask) mask.classList.add("hidden");
}

// ---------- 左上角品牌下拉菜单 ----------
function bindBrandMenu() {
  const chip = $("brandChip"), menu = $("brandMenu");
  if (!chip || !menu) return;
  chip.onclick = (e) => { e.stopPropagation(); menu.classList.toggle("hidden"); };
  document.addEventListener("click", () => menu.classList.add("hidden"));
  menu.onclick = (e) => e.stopPropagation();
  if ($("menuSettings")) $("menuSettings").onclick = () => { location.href = "/settings.html"; };
  if ($("menuRecog")) $("menuRecog").onclick = () => {
    menu.classList.add("hidden");
    toast("导入图纸支持 JPG / PNG / PDF / DWG：图片与 DWG 由多模态大模型识别成房型数据；模型接口请在【系统设置】中配置。", 6000);
  };
}

function bindUI() {
  $("btnNew").onclick = () => createBlank();
  $("btnCopy").onclick = async () => { if (!state.project) return; const p = await API.copyProject(state.project.id); await loadProjects(); await selectProject(p.id); };
  $("btnImport").onclick = () => $("fileInput").click();
  $("fileInput").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) await doImportFile(f);
  };
  bindBrandMenu();
  // 导入结果确认弹窗
  $("resultOk").onclick = () => hideImportResult();
  $("resultSettings").onclick = () => { location.href = "/settings.html"; };
  $("resultMask").onclick = (e) => { if (e.target === $("resultMask")) hideImportResult(); };
  $("btnScale").onclick = async () => {
    if (!state.project) { toast("请先新建或打开一个项目"); return; }
    const cur = state.scene.scale || 1;
    const r = await askValue({
      title: "🔍 一键缩放",
      desc: `把所有元素（墙体、门窗、家具、人物）的实际尺寸按比例等比缩放。当前整体比例 ${cur.toFixed(3)}×。`,
      def: Number(cur.toFixed(3)), unit: "×", step: 0.05, min: 0.05, max: 50,
    });
    if (r == null) return;
    const ratio = r / cur;
    if (Math.abs(ratio - 1) < 1e-9) { toast("比例没有变化"); return; }
    const p = await API.scale(state.project.id, ratio);
    beginEdit();
    state.scene = p.scene; applyScene(p.scene); updateScaleWidget();
    toast(`已按 ${r.toFixed(3)}× 等比缩放`);
  };
  $("btnDetect").onclick = async () => {
    const p = await API.detectRooms(state.project.id); beginEdit(); state.scene = p.scene; applyScene(p.scene);
  };
  $("btnCeiling").onclick = async () => {
    if (!state.scene) { toast("请先新建或打开一个项目"); return; }
    beginEdit();
    const cur = (state.scene.ceiling_height || 2900) / 1000;
    const v = await askValue({
      title: "🏗️ 设置房高",
      desc: `房高是项目基础配置，默认 2.90 m。修改后会应用到所有墙体层高，并同步调整门/窗高度。（当前 ${cur.toFixed(2)} m）`,
      def: Number(cur.toFixed(2)), unit: "m", step: 0.05, min: 1.8, max: 6,
    });
    if (v == null) return;
    const mm = Math.round(v * 1000);
    state.scene.ceiling_height = mm;
    const walls = state.scene.walls || [];
    walls.forEach(w => { w.height = mm; });
    (state.scene.openings || []).forEach(o => {
      if (o.type === "door") o.height = Math.max(1200, mm - 80);
      else o.height = Math.min(o.height || 1500, Math.max(400, mm - 1000));
    });
    // 新建墙体的默认层高也跟随房高
    if (editor2d) editor2d.scene.ceiling_height = mm;
    afterEdit();
    toast(`房高已设为 ${v.toFixed(2)} m，应用到 ${walls.length} 面墙`);
  };
  if ($("btnFit")) $("btnFit").onclick = () => doFit();
  if ($("miniFit")) $("miniFit").onclick = () => doFit();
  if ($("viewZoomSet")) $("viewZoomSet").onclick = () => {
    const p = parseFloat($("viewZoomInput").value);
    if (!isFinite(p) || p <= 0) { toast("请输入有效的百分比"); return; }
    editor2d.setZoomPercent(p);
    toast(`视图缩放 ${editor2d.zoomPercent}%`);
  };
  $("btn2d").onclick = () => switchMode("2d");
  $("btn3d").onclick = () => switchMode("3d");
  // 多选对齐工具条
  const ALIGNERS = { top:"alignTop", bottom:"alignBottom", left:"alignLeft", right:"alignRight", centerH:"alignCenterH", centerV:"alignCenterV", distributeH:"distributeH", distributeV:"distributeV" };
  Object.keys(ALIGNERS).forEach(kind => {
    const b = $("align_" + kind);
    if (b) b.onclick = () => { if (editor2d) editor2d[ALIGNERS[kind]](); };
  });
  $("btnDraw").onclick = () => {
    const on = editor2d.toggleDraw();
    $("btnDraw").classList.toggle("active", on);
    $("hint").textContent = on
      ? "✏️ 绘制中：点选起点→终点连续画墙；靠近已有墙端点自动铆钉联接，接近水平/垂直自动找平；Esc 或再次点击按钮结束"
      : "左键框选/点选元素 · 右键拖拽平移 · 滚轮缩放 · 顶部按钮旋转 · 选中后可整体移动";
  };
  $("btnRender").onclick = () => {
    state.realistic = !state.realistic;
    $("btnRender").classList.toggle("active", state.realistic);
    if (state.mode === "3d" && editor3d) editor3d.build(state.scene, { realistic: state.realistic });
  };
  $("btnAddChar").onclick = () => addCharacter();
  $("imgInput").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const res = await API.uploadImage(f);
    beginEdit();
    const b = editor2d._bounds();
    const cx = b ? (b.minx+b.maxx)/2 : 2000, cy = b ? (b.miny+b.maxy)/2 : 2000;
    const item = { id:`f${Date.now()}`, type:"image", x:Math.round(cx), y:Math.round(cy), width:1200, depth:1200, rotation:0, color:"#90A4AE", label:"自定义", imageUrl: res.url };
    state.scene.furniture.push(item);
    editor2d.preloadImage(res.url);
    editor2d.setScene(state.scene, true); editor2d.setSelection({type:"furniture",id:item.id});
    afterEdit(); e.target.value="";
  };
  // 整体比例（右下角）
  $("scaleSet").onclick = async () => {
    if (!state.project) return;
    const v = parseFloat($("scaleInput").value);
    if (!isFinite(v) || v <= 0) { toast("请输入有效的比例"); return; }
    const cur = state.scene.scale || 1;
    if (Math.abs(v - cur) < 1e-9) { toast("比例没有变化"); return; }
    const p = await API.scale(state.project.id, v / cur);
    state.scene = p.scene; applyScene(p.scene); updateScaleWidget();
    toast(`整体比例已设为 ${v.toFixed(3)}×`);
  };
  $("btnChat").onclick = sendChat;
  $("chatMsg").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
  // 项目名点击重命名（文本弹窗）
  $("projName").onclick = async () => {
    if (!state.project) { toast("请先新建或打开一个项目"); return; }
    const v = await askValue({
      title: "✏️ 重命名项目",
      desc: "修改当前房型项目的名称，保存后立即生效。",
      def: state.project.name, type: "text",
    });
    if (v == null) return;                          // 取消
    const name = String(v).trim();
    if (!name) return;
    try {
      const p = await API.renameProject(state.project.id, name);
      state.project.name = p.name; state.project.updated_at = p.updated_at;
      $("projName").textContent = p.name;
      renderProjList(await API.listProjects());
      markActive(state.project.id);
      toast(`已重命名为「${p.name}」`);
    } catch (e) { toast("重命名失败：" + (e.message || e)); }
  };
}

function updateScaleWidget() {
  if ($("scaleInput")) $("scaleInput").value = (state.scene.scale || 1).toFixed(3);
}

// ---------- 视图缩放（左侧滑杆 + 右下数值）----------
const ZMIN = 5, ZMAX = 800;
function _pctToT(p) { return 1 - Math.log(Math.max(ZMIN, Math.min(ZMAX, p)) / ZMIN) / Math.log(ZMAX / ZMIN); }
function _tToPct(t) { return ZMIN * Math.pow(ZMAX / ZMIN, 1 - Math.max(0, Math.min(1, t))); }

function updateZoomWidget() {
  if (!editor2d) return;
  const p = editor2d.zoomPercent;
  if ($("zpct")) $("zpct").textContent = p + "%";
  const vi = $("viewZoomInput");
  if (vi && document.activeElement !== vi) vi.value = p;
  const track = $("ztrack");
  const H = track ? track.clientHeight : 150;
  const t = _pctToT(p);
  if ($("zknob")) $("zknob").style.top = (t * H) + "px";
  if ($("zfill")) $("zfill").style.height = Math.max(0, (1 - t) * H) + "px";
}

function doFit() {
  editor2d.fitView();
  editor2d.render();
  updateZoomWidget();
  toast(`已适应窗口 · ${editor2d.zoomPercent}%`);
}

function bindZoombar() {
  const track = $("ztrack");
  if (!track) return;
  let dragging = false;
  const applyFromY = (clientY) => {
    const r = track.getBoundingClientRect();
    const t = (clientY - r.top) / Math.max(1, r.height);
    editor2d.setZoomPercent(_tToPct(t));
  };
  track.addEventListener("mousedown", (e) => { dragging = true; e.preventDefault(); applyFromY(e.clientY); });
  window.addEventListener("mousemove", (e) => { if (dragging) { e.preventDefault(); applyFromY(e.clientY); } });
  window.addEventListener("mouseup", () => { dragging = false; });
  if ($("zoomIn")) $("zoomIn").onclick = () => editor2d.zoomBy(1.25);
  if ($("zoomOut")) $("zoomOut").onclick = () => editor2d.zoomBy(1 / 1.25);
  updateZoomWidget();
}

// ---------- 键盘快捷键 ----------
function bindShortcuts() {
  if (!editor2d) return;
  window.addEventListener("keydown", (e) => {
    // 在输入框 / 文本域 / 下拉框里打字时不触发（避免与输入冲突）
    const ae = document.activeElement;
    if (ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)) return;

    // 撤销 / 重做：Ctrl/⌘ + Z，Ctrl/⌘ + Shift + Z（或 Ctrl + Y）
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); if (e.shiftKey) redoEdit(); else undoEdit(); return; }
      if (k === "y") { e.preventDefault(); redoEdit(); return; }
      if (k === "c") { e.preventDefault(); copySelection(false); return; }
      if (k === "x") { e.preventDefault(); copySelection(true); return; }
      if (k === "v") { e.preventDefault(); pasteSelection(); return; }
      return;
    }

    const k = e.key;
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); deleteSelection(); return; }
    if (k === "+" || k === "=" || k === "Add") { e.preventDefault(); zoomKey(1.25); return; }
    if (k === "-" || k === "_" || k === "Subtract") { e.preventDefault(); zoomKey(1 / 1.25); return; }
    if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault(); nudgeSelection(k); return;
    }
  });
}

function zoomKey(factor) {
  if (state.mode === "3d" && editor3d && editor3d.ready) editor3d.zoomBy(factor);
  else editor2d.zoomBy(factor);
}

function undoEdit() { if (!editor2d) return; if (editor2d.undo()) afterEdit(); }
function redoEdit() { if (!editor2d) return; if (editor2d.redo()) afterEdit(); }

// 删除当前选中的所有元素
function deleteSelection() {
  if (!editor2d || !state.scene) return;
  const set = editor2d.selectionSet || [];
  if (!set.length) { toast("请先选中要删除的元素"); return; }
  editor2d.pushHistory();
  const ids = new Set(set.map(s => s.id));
  const types = new Set(set.map(s => s.type));
  if (types.has("wall")) {
    state.scene.walls = (state.scene.walls || []).filter(w => !ids.has(w.id));
    state.scene.openings = (state.scene.openings || []).filter(o => !ids.has(o.wall_id));
  }
  if (types.has("furniture")) state.scene.furniture = (state.scene.furniture || []).filter(f => !ids.has(f.id));
  if (types.has("character")) state.scene.characters = (state.scene.characters || []).filter(c => !ids.has(c.id));
  if (types.has("opening")) state.scene.openings = (state.scene.openings || []).filter(o => !ids.has(o.id));
  if (types.has("room")) state.scene.rooms = (state.scene.rooms || []).filter(r => !ids.has(r.id));
  editor2d.setSelection(null);
  afterEdit();
  toast(`已删除 ${set.length} 个元素`);
}

// 方向键：按 0.1m（100mm）水平/垂直微移选中元素
function nudgeSelection(key) {
  if (!editor2d || !state.scene) return;
  const set = editor2d.selectionSet || [];
  if (!set.length) { toast("请先选中元素"); return; }
  const step = 100;
  let dx = 0, dy = 0;
  if (key === "ArrowLeft") dx = -step;
  else if (key === "ArrowRight") dx = step;
  else if (key === "ArrowUp") dy = step;        // 世界上：上 = +Y
  else if (key === "ArrowDown") dy = -step;

  // 连续按住方向键时合并为一次撤销记录（500ms 内）
  const now = Date.now();
  if (now - (editor2d._lastNudge || 0) > 500) editor2d.pushHistory();
  editor2d._lastNudge = now;

  for (const sel of set) {
    const el = editor2d._getEl(sel);
    if (!el) continue;
    if (sel.type === "furniture" || sel.type === "character") { el.x += dx; el.y += dy; }
    else if (sel.type === "wall") { el.x1 += dx; el.y1 += dy; el.x2 += dx; el.y2 += dy; }
    else if (sel.type === "room") { (el.points || []).forEach(p => { p[0] += dx; p[1] += dy; }); }
    else if (sel.type === "opening") {
      const w = (state.scene.walls || []).find(x => x.id === el.wall_id); if (!w) continue;
      const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1;
      const wdx = (w.x2 - w.x1) / L, wdy = (w.y2 - w.y1) / L;
      el.offset += Math.round(dx * wdx + dy * wdy);   // 沿墙方向投影位移
    }
  }
  editor2d.render();
  afterEdit();
}

// 在属性面板 / 工具栏变更前调用，记录一次可撤销快照
function beginEdit() { if (editor2d) editor2d.pushHistory(); }

// ---------- 复制 / 粘贴 / 剪切（元素级）----------
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function genId(prefix) { return prefix + Date.now() + "_" + Math.floor(Math.random() * 1e4); }

let _clipboard = null;

// 复制选中元素到剪贴板；cut=true 时同时删除原元素
function copySelection(cut) {
  if (!editor2d || !state.scene) return;
  const set = editor2d.selectionSet || [];
  if (!set.length) { toast(cut ? "请先选中要剪切的元素" : "请先选中要复制的元素"); return; }
  const ids = new Set(set.map(s => s.id));
  const types = new Set(set.map(s => s.type));
  const buf = { walls: [], openings: [], furniture: [], characters: [], rooms: [] };
  if (types.has("wall")) {
    buf.walls = (state.scene.walls || []).filter(w => ids.has(w.id)).map(deepClone);
    const cw = new Set(buf.walls.map(w => w.id));
    // 选中墙时，把墙上的门窗一并带走，避免变成孤儿
    (state.scene.openings || []).filter(o => cw.has(o.wall_id)).forEach(o => buf.openings.push(deepClone(o)));
  }
  if (types.has("furniture")) buf.furniture = (state.scene.furniture || []).filter(f => ids.has(f.id)).map(deepClone);
  if (types.has("character")) buf.characters = (state.scene.characters || []).filter(c => ids.has(c.id)).map(deepClone);
  if (types.has("opening")) (state.scene.openings || []).filter(o => ids.has(o.id) && !buf.openings.some(b => b.id === o.id)).forEach(o => buf.openings.push(deepClone(o)));
  if (types.has("room")) buf.rooms = (state.scene.rooms || []).filter(r => ids.has(r.id)).map(deepClone);
  _clipboard = buf;
  if (cut) {
    beginEdit();
    if (types.has("wall")) { state.scene.walls = (state.scene.walls || []).filter(w => !ids.has(w.id)); state.scene.openings = (state.scene.openings || []).filter(o => !ids.has(o.wall_id)); }
    if (types.has("furniture")) state.scene.furniture = (state.scene.furniture || []).filter(f => !ids.has(f.id));
    if (types.has("character")) state.scene.characters = (state.scene.characters || []).filter(c => !ids.has(c.id));
    if (types.has("opening")) state.scene.openings = (state.scene.openings || []).filter(o => !ids.has(o.id));
    if (types.has("room")) state.scene.rooms = (state.scene.rooms || []).filter(r => !ids.has(r.id));
    editor2d.setSelection(null); afterEdit();
    toast(`已剪切 ${set.length} 个元素`);
  } else {
    toast(`已复制 ${set.length} 个元素（Ctrl/⌘+V 粘贴）`);
  }
}

// 粘贴：所有元素换新 id，整体偏移 300mm；门窗重映射所属墙并夹紧在墙段内
function pasteSelection() {
  if (!_clipboard) { toast("剪贴板为空，请先复制或剪切元素"); return; }
  if (!editor2d || !state.scene) return;
  beginEdit();
  const dx = 300, dy = 300; // 粘贴位移（mm），避免与原件完全重叠
  const newSel = [];
  const wallMap = {};
  for (const w of (_clipboard.walls || [])) {
    const nw = deepClone(w); nw.id = genId("w"); wallMap[w.id] = nw.id;
    nw.x1 += dx; nw.y1 += dy; nw.x2 += dx; nw.y2 += dy;
    state.scene.walls.push(nw); newSel.push({ type: "wall", id: nw.id });
  }
  for (const o of (_clipboard.openings || [])) {
    const no = deepClone(o); no.id = genId("o");
    let targetWall = o.wall_id;
    if (wallMap[o.wall_id] !== undefined) targetWall = wallMap[o.wall_id];       // 随墙一起复制 → 指向新墙
    else {
      const exists = (state.scene.walls || []).some(w => w.id === o.wall_id);   // 单独复制门窗 → 所属墙仍存在才保留
      if (!exists) continue;
    }
    no.wall_id = targetWall;
    const w = (state.scene.walls || []).find(x => x.id === targetWall);
    if (w) { const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1; const half = (no.width || 900) / 2; no.offset = Math.max(half, Math.min(L - half, no.offset)); }
    state.scene.openings.push(no); newSel.push({ type: "opening", id: no.id });
  }
  for (const f of (_clipboard.furniture || [])) {
    const nf = deepClone(f); nf.id = genId("f"); nf.x += dx; nf.y += dy;
    state.scene.furniture.push(nf); newSel.push({ type: "furniture", id: nf.id });
    if (nf.type === "image" && nf.imageUrl) editor2d.preloadImage(nf.imageUrl);
  }
  for (const c of (_clipboard.characters || [])) {
    const nc = deepClone(c); nc.id = genId("c"); nc.x += dx; nc.y += dy;
    state.scene.characters.push(nc); newSel.push({ type: "character", id: nc.id });
  }
  for (const r of (_clipboard.rooms || [])) {
    const nr = deepClone(r); nr.id = genId("r"); (nr.points || []).forEach(p => { p[0] += dx; p[1] += dy; });
    state.scene.rooms.push(nr); newSel.push({ type: "room", id: nr.id });
  }
  editor2d.setSelection(null);
  editor2d._setSelectionSet(newSel);
  afterEdit();
  toast(`已粘贴 ${newSel.length} 个元素`);
}

// ---------- 对齐工具条显隐 ----------
function updateAlignBar() {
  const bar = $("alignBar"); if (!bar) return;
  const n = (editor2d.selectionSet || []).length;
  bar.classList.toggle("hidden", n < 2);
}

function switchMode(mode) {
  state.mode = mode;
  $("btn2d").classList.toggle("active", mode === "2d");
  $("btn3d").classList.toggle("active", mode === "3d");
  $("canvas2d").classList.toggle("hidden", mode === "3d");
  $("canvas3d").classList.toggle("hidden", mode === "2d");
  if (mode === "3d") {
    if (!editor3d) editor3d = new Editor3D($("canvas3d"));
    if (editor3d.ready) { editor3d._resize(); editor3d.build(state.scene, { realistic: state.realistic }); }
  } else {
    editor2d.resize();
    updateZoomWidget();
  }
}

// ---------- AI 对话 ----------
async function sendChat() {
  const msg = $("chatMsg").value.trim(); if (!msg || !state.project) return;
  $("chatMsg").value = "";
  addBubble("me", msg);
  try {
    const res = await API.aiArrange(state.project.id, msg);
    beginEdit(); state.scene = res.scene; applyScene(res.scene);
    addBubble("ai", res.message || "已处理");
    updateScaleWidget();
  } catch (e) {
    addBubble("ai", "出错了：" + e.message);
  }
}
function addBubble(who, text) {
  const c = $("chat");
  const d = document.createElement("div");
  d.className = "bubble " + who; d.textContent = text;
  c.appendChild(d); c.scrollTop = c.scrollHeight;
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[m])); }
