// API 客户端：Base URL 走相对路径（同源），统一错误处理。
const API = {
  async listProjects() {
    return this._json("/api/projects");
  },
  async getProject(id) {
    return this._json(`/api/projects/${id}`);
  },
  async createProject(name, scene) {
    return this._json("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, scene }),
    });
  },
  async updateProject(id, scene) {
    return this._json(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify({ scene }),
    });
  },
  async renameProject(id, name) {
    return this._json(`/api/projects/${id}/rename`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  },
  async deleteProject(id) {
    return this._json(`/api/projects/${id}`, { method: "DELETE" });
  },
  async copyProject(id) {
    return this._json(`/api/projects/${id}/copy`, { method: "POST" });
  },
  async importNew(formData) {
    return this._json("/api/import", { method: "POST", body: formData });
  },
  async importInto(id, formData) {
    return this._json(`/api/projects/${id}/import`, { method: "POST", body: formData });
  },
  async scale(id, ratio) {
    return this._json(`/api/projects/${id}/scale`, {
      method: "POST",
      body: JSON.stringify({ ratio }),
    });
  },
  async detectRooms(id) {
    return this._json(`/api/projects/${id}/detect_rooms`, { method: "POST" });
  },
  async areas(id) {
    return this._json(`/api/projects/${id}/areas`, { method: "POST" });
  },
  async aiArrange(id, message) {
    return this._json(`/api/projects/${id}/ai_arrange`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
  },
  // 标准动作 API：直接执行一组画布动作（AI / MCP / 自动化调用）
  async applyActions(id, actions, message) {
    return this._json(`/api/projects/${id}/apply_actions`, {
      method: "POST",
      body: JSON.stringify({ actions, message: message || null }),
    });
  },
  async getSettings() {
    return this._json("/api/settings");
  },
  async saveLlmSettings(cfg) {
    return this._json("/api/settings/llm", {
      method: "PUT",
      body: JSON.stringify(cfg),
    });
  },
  async uploadImage(file) {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/upload_image", { method: "POST", body: fd });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },

  async _json(url, opts = {}) {
    const r = await fetch(url, {
      headers: opts.body && !(opts.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {},
      ...opts,
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`请求失败 ${r.status}: ${t}`);
    }
    return r.json();
  },
};
