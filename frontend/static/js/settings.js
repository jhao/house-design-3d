// 系统设置页：大模型配置 / 数据库存储 / 家具默认值
(function () {
  const $ = (id) => document.getElementById(id);
  let CURRENT = null; // /api/settings 全量数据

  function toast(msg, ms = 2600) {
    const t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.add("hidden"), ms);
  }

  function msg(id, text, ok) {
    const el = $(id);
    if (!el) return;
    el.textContent = text || "";
    el.className = "sp-msg" + (text ? (ok ? " ok" : " err") : "");
  }

  function fmtTime(ts) {
    if (!ts) return "—";
    const d = new Date(ts * 1000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  async function jfetch(url, opts = {}) {
    const r = await fetch(url, {
      headers: opts.body ? { "Content-Type": "application/json" } : {},
      ...opts,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `请求失败 ${r.status}`);
    return data;
  }

  // ---------------- 加载 ----------------
  async function load() {
    try {
      CURRENT = await jfetch("/api/settings");
    } catch (e) {
      toast("加载设置失败：" + e.message, 5000);
      return;
    }
    renderLlm(CURRENT.llm || {});
    renderDb(CURRENT.db || {});
    renderFurniture(CURRENT.furniture_defaults || {});
    renderWalls(CURRENT.wall_kinds || []);
    loadLogs();
  }

  function renderLlm(c) {
    $("llmBase").value = c.base_url || "";
    $("llmKey").value = c.api_key || "";
    $("llmModel").value = c.model || "";
    $("llmVision").value = c.vision_model || "";
    $("llmDwg").value = c.dwg_converter || "";
    $("llmTimeout").value = c.timeout || 300;
    if ($("llmMaxTokens")) $("llmMaxTokens").value = c.max_tokens || 16000;
    $("llmEnabled").checked = !!c.enabled;
    const ta = $("recogPrompt");
    if (ta) ta.value = (CURRENT && CURRENT.recognition_prompt) || (CURRENT && CURRENT.recognition_prompt_builtin) || "";
  }

  function currentLlm() {
    return {
      base_url: $("llmBase").value.trim(),
      api_key: $("llmKey").value.trim(),
      model: $("llmModel").value.trim(),
      vision_model: $("llmVision").value.trim(),
      dwg_converter: $("llmDwg").value.trim(),
      timeout: Number($("llmTimeout").value) || 300,
      max_tokens: $("llmMaxTokens") ? (Number($("llmMaxTokens").value) || 16000) : undefined,
      enabled: $("llmEnabled").checked,
      recognition_prompt: $("recogPrompt").value,
    };
  }

  // ---------------- 大模型调用日志 ----------------
  async function loadLogs() {
    try {
      const r = await jfetch("/api/settings/llm_logs?limit=200");
      const logs = r.logs || [];
      const rows = logs.map((l) => {
        const st = l.status === "ok"
          ? '<span class="badge ok">成功</span>'
          : '<span class="badge err">失败</span>';
        const detail = l.status === "ok"
          ? (l.reply_preview ? "回复：" + escapeHtml(l.reply_preview) : "—")
          : escapeHtml(l.error || "未知错误");
        const dur = l.duration_ms != null ? `${l.duration_ms} ms` : "—";
        return `<tr>
          <td class="num">${fmtTime(l.ts)}</td>
          <td>${escapeHtml(l.kind || "")}</td>
          <td class="mono">${escapeHtml(l.model || "")}</td>
          <td>${st}${l.http ? ` <span class="http">${l.http}</span>` : ""}</td>
          <td class="num">${dur}</td>
          <td class="log-detail">${detail}</td>
        </tr>`;
      }).join("");
      $("logTable").querySelector("tbody").innerHTML =
        rows || '<tr><td colspan="6">还没有调用记录，去「设计台 → 导入图纸」试一次吧</td></tr>';
    } catch (e) {
      msg("logMsg", "❌ " + e.message, false);
    }
  }

  // ---------------- 数据库 ----------------
  function statCard(label, value, sub) {
    return `<div class="sp-stat"><div class="sp-stat-v">${value}</div>
      <div class="sp-stat-l">${label}</div>${sub ? `<div class="sp-stat-s">${sub}</div>` : ""}</div>`;
  }

  function renderDb(d) {
    $("dbStats").innerHTML = [
      statCard("项目总数", d.projects_count ?? 0, `场景数据 ${d.scene_size_total || "0 B"}`),
      statCard("数据库体积", d.db_size_human || "—", "SQLite"),
      statCard("上传文件", d.upload_count ?? 0, d.upload_size_human || "0 B"),
      statCard("剩余磁盘", d.disk_free || "—", d.db_path ? "" : ""),
    ].join("") + `<div class="sp-stat sp-wide"><div class="sp-stat-l">数据库路径</div>
        <div class="sp-stat-s mono">${d.db_path || "—"}</div>
        <div class="sp-stat-s mono">上传目录：${d.upload_dir || "—"}</div></div>`;

    const tables = (d.tables || []).map(
      (t) => `<tr><td class="mono">${t.name}</td><td class="num">${t.rows}</td></tr>`
    ).join("");
    $("dbTables").innerHTML =
      `<thead><tr><th>表名</th><th class="num">行数</th></tr></thead><tbody>${tables || '<tr><td colspan="2">无数据</td></tr>'}</tbody>`;

    const projs = (d.projects || []).map(
      (p) => `<tr><td class="num">${p.id}</td><td>${escapeHtml(p.name)}</td>
        <td class="num">${p.scene_size || "—"}</td><td>${fmtTime(p.updated_at)}</td></tr>`
    ).join("");
    $("dbProjects").innerHTML =
      `<thead><tr><th class="num">ID</th><th>项目名</th><th class="num">场景体积</th><th>最近更新</th></tr></thead>
       <tbody>${projs || '<tr><td colspan="4">还没有项目</td></tr>'}</tbody>`;
  }

  function renderWalls(kinds) {
    const labelMap = { normal: "普通墙", bearing: "承重墙", glass: "玻璃墙", beam: "梁", column: "柱" };
    $("wallStats").innerHTML = (kinds || []).map((k) =>
      statCard(labelMap[k.kind] || k.kind, `${k.thickness} mm`, `${(k.thickness / 1000).toFixed(2)} m`)
    ).join("") + statCard("默认层高", "2900 mm", "可在设计台「房高」中修改");
  }

  // ---------------- 家具默认值 ----------------
  function renderFurniture(defs) {
    const rows = Object.entries(defs).map(([type, s]) => `
      <tr data-type="${type}">
        <td class="mono">${type}</td>
        <td><input type="text" data-f="label" value="${escapeHtml(s.label || "")}" /></td>
        <td><input type="number" step="10" min="50" data-f="width" value="${s.width || 0}" /></td>
        <td><input type="number" step="10" min="50" data-f="depth" value="${s.depth || 0}" /></td>
        <td><input type="number" step="10" min="50" data-f="height" value="${s.height || 0}" /></td>
        <td><input type="color" data-f="color" value="${s.color || "#888888"}" /></td>
        <td class="mono dim">${((s.width || 0) / 1000).toFixed(2)}×${((s.depth || 0) / 1000).toFixed(2)}×${((s.height || 0) / 1000).toFixed(2)} m</td>
      </tr>`).join("");
    $("furnTable").innerHTML =
      `<thead><tr><th>类型</th><th>名称</th><th class="num">宽(mm)</th><th class="num">深(mm)</th>
       <th class="num">高(mm)</th><th>颜色</th><th>实际尺寸</th></tr></thead><tbody>${rows}</tbody>`;

    // 动态更新"实际尺寸"列
    $("furnTable").querySelectorAll("tbody tr").forEach((tr) => {
      const upd = () => {
        const g = (f) => Number(tr.querySelector(`[data-f="${f}"]`).value) || 0;
        tr.lastElementChild.textContent = `${(g("width") / 1000).toFixed(2)}×${(g("depth") / 1000).toFixed(2)}×${(g("height") / 1000).toFixed(2)} m`;
      };
      tr.querySelectorAll("input").forEach((i) => i.addEventListener("input", upd));
    });
  }

  function collectFurniture() {
    const out = {};
    $("furnTable").querySelectorAll("tbody tr").forEach((tr) => {
      const type = tr.dataset.type;
      const spec = {};
      tr.querySelectorAll("input[data-f]").forEach((i) => {
        spec[i.dataset.f] = i.type === "number" ? Number(i.value) : i.value;
      });
      out[type] = spec;
    });
    return out;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------------- 事件 ----------------
  function bind() {
    $("btnSaveLlm").onclick = async () => {
      msg("llmMsg", "保存中…", true);
      try {
        await jfetch("/api/settings/llm", { method: "PUT", body: JSON.stringify(currentLlm()) });
        msg("llmMsg", "✅ 已保存", true);
        toast("大模型配置已保存");
      } catch (e) {
        msg("llmMsg", "❌ " + e.message, false);
      }
    };

    $("btnTestLlm").onclick = async () => {
      msg("llmMsg", "测试中…", true);
      try {
        const r = await jfetch("/api/settings/test_llm", { method: "POST", body: JSON.stringify(currentLlm()) });
        msg("llmMsg", `✅ ${r.message} · 模型 ${r.model} · 回复「${r.reply}」`, true);
      } catch (e) {
        msg("llmMsg", "❌ " + e.message, false);
      }
    };

    $("btnSaveFurn").onclick = async () => {
      msg("furnMsg", "保存中…", true);
      try {
        await jfetch("/api/settings/furniture", {
          method: "PUT",
          body: JSON.stringify({ defaults: collectFurniture() }),
        });
        msg("furnMsg", "✅ 已保存，新添加的家具将使用新尺寸", true);
        toast("家具默认值已保存");
      } catch (e) {
        msg("furnMsg", "❌ " + e.message, false);
      }
    };

    $("btnResetFurn").onclick = async () => {
      if (!confirm("确定恢复所有家具默认值为出厂设置？")) return;
      try {
        const r = await jfetch("/api/settings/furniture/reset", { method: "POST" });
        renderFurniture(r.furniture_defaults || {});
        msg("furnMsg", "✅ 已恢复出厂默认值", true);
      } catch (e) {
        msg("furnMsg", "❌ " + e.message, false);
      }
    };

    $("btnRefreshLogs").onclick = () => loadLogs();
    $("btnClearLogs").onclick = async () => {
      if (!confirm("确定清空所有大模型调用日志？")) return;
      try {
        await jfetch("/api/settings/llm_logs", { method: "DELETE" });
        loadLogs();
        msg("logMsg", "✅ 已清空", true);
      } catch (e) {
        msg("logMsg", "❌ " + e.message, false);
      }
    };
  }

  bind();
  load();
})();
