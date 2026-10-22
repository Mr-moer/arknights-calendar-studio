/* Manual JSON data export / import for the calendar studio. */
(function () {
  "use strict";

  const C = window.CalendarCore;
  const $ = (sel) => document.querySelector(sel);
  const callbacks = {
    getEvents: () => [],
    replaceEvents: () => {},
    mergeEvents: () => ({ added: 0, skipped: 0 }),
    toast: () => {},
  };

  let pending = [];
  let pendingFileName = "";
  let pendingInvalid = 0;
  let pendingDuplicates = 0;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function normalizeName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/sidestory|复刻|限时活动|活动|「|」|【|】|《|》|\s+/g, "");
  }

  function normalizeEvent(raw, index) {
    if (!raw || typeof raw !== "object") return null;
    const name = String(raw.name || "").trim();
    if (!name) return null;
    let startRaw = String(raw.start || "").trim();
    let endRaw = String(raw.end || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) startRaw += "T12:00";
    if (/^\d{4}-\d{2}-\d{2}$/.test(endRaw)) endRaw += "T03:59";
    const start = C.parseLocal(startRaw);
    const end = C.parseLocal(endRaw);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;

    const type = ["SideStory", "复刻", "签到", "其他"].includes(raw.type) ? raw.type : "其他";
    const hasStages = typeof raw.hasStages === "boolean" ? raw.hasStages : type !== "签到";
    let shopStatus = ["uncleared", "cleared", "none"].includes(raw.shopStatus) ? raw.shopStatus : (hasStages ? "uncleared" : "none");
    if (!hasStages) shopStatus = "none";
    const color = /^#[0-9a-f]{6}$/i.test(String(raw.color || "")) ? raw.color : C.COLORS[index % C.COLORS.length];
    return {
      ...(raw.id ? { id: String(raw.id) } : {}),
      name,
      start: C.toInputValue(start),
      end: C.toInputValue(end),
      type,
      hasStages,
      shopStatus,
      forecast: !!raw.forecast,
      color,
      note: String(raw.note || ""),
    };
  }

  function countDuplicates(events) {
    const existing = callbacks.getEvents() || [];
    const keys = new Set();
    for (const ev of existing) {
      keys.add(normalizeName(ev.name) + "|" + C.toKey(ev.start));
      if (ev.id) keys.add("id|" + ev.id);
    }
    let count = 0;
    for (const ev of events) {
      const key = normalizeName(ev.name) + "|" + C.toKey(ev.start);
      if (keys.has(key) || (ev.id && keys.has("id|" + ev.id))) {
        count += 1;
      } else {
        keys.add(key);
        if (ev.id) keys.add("id|" + ev.id);
      }
    }
    return count;
  }

  function setStatus(message, kind) {
    const node = $("#dataStatus");
    node.className = "ai-status" + (message ? " show" : "") + (kind ? " " + kind : "");
    node.textContent = message || "";
  }

  function getImportMode() {
    const checked = document.querySelector('input[name="dataImportMode"]:checked');
    return checked ? checked.value : "merge";
  }

  function renderPreview() {
    const wrap = $("#dataPreview");
    if (!pending.length) {
      wrap.innerHTML = '<div class="ai-empty">没有可导入的活动。请检查 JSON 中的 name / start / end 字段。</div>';
      $("#btnConfirmDataImport").disabled = true;
      $("#btnConfirmDataImport").textContent = "确认导入";
      return;
    }
    const mode = getImportMode();
    const mergeCount = Math.max(0, pending.length - pendingDuplicates);
    const count = mode === "replace" ? pending.length : mergeCount;
    const summary = `
      <div class="data-summary">
        文件：${esc(pendingFileName || "未命名")} · 解析 ${pending.length + pendingInvalid} 条 · 有效 ${pending.length} 条
        ${pendingInvalid ? ` · 无效 ${pendingInvalid} 条` : ""}
        ${pendingDuplicates ? ` · 与现有数据重复 ${pendingDuplicates} 条（合并时跳过）` : ""}
        <br>${mode === "replace" ? `覆盖后可保留 ${pending.length} 条` : `合并后可新增 ${mergeCount} 条`}
      </div>
    `;
    const list = pending.slice(0, 12).map((ev) => `
      <div class="data-event">
        <span class="data-event-color" style="--c:${esc(ev.color)}"></span>
        <div class="data-event-main">
          <div class="data-event-name">${esc(ev.name)}</div>
          <div class="data-event-time">${C.fmtDate(ev.start)} ${C.fmtTime(ev.start)} → ${C.fmtDate(ev.end)} ${C.fmtTime(ev.end)}</div>
          <div class="data-event-tags">
            <span class="tag">${esc(ev.type)}</span>
            <span class="tag ${ev.hasStages ? "" : "none"}">${ev.hasStages ? "有活动关卡" : "无活动关卡"}</span>
            <span class="tag ${ev.shopStatus}">${ev.shopStatus === "uncleared" ? "商店未搬空" : ev.shopStatus === "cleared" ? "商店已搬空" : "无商店"}</span>
            ${ev.forecast ? '<span class="tag forecast">预计</span>' : ""}
          </div>
        </div>
      </div>
    `).join("");
    const more = pending.length > 12 ? `<div class="ai-hint">仅预览前 12 条，导入时会处理全部 ${pending.length} 条。</div>` : "";
    wrap.innerHTML = summary + list + more;
    $("#btnConfirmDataImport").disabled = count === 0;
    $("#btnConfirmDataImport").textContent = mode === "replace"
      ? `确认覆盖（${pending.length}）`
      : `确认合并（新增 ${mergeCount}）`;
  }

  async function handleFile(file) {
    if (!file) return;
    pending = [];
    pendingInvalid = 0;
    pendingDuplicates = 0;
    pendingFileName = file.name;
    setStatus("正在读取文件…", "loading");
    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        throw new Error("文件不是有效 JSON。");
      }
      let rawEvents = null;
      if (Array.isArray(parsed)) rawEvents = parsed;
      else if (parsed && Array.isArray(parsed.events)) rawEvents = parsed.events;
      else if (parsed && parsed.data && Array.isArray(parsed.data.events)) rawEvents = parsed.data.events;
      if (!rawEvents) throw new Error("JSON 里没有 events 数组，也不是事件数组。");

      const valid = [];
      rawEvents.forEach((raw, index) => {
        const ev = normalizeEvent(raw, index);
        if (ev) valid.push(ev);
        else pendingInvalid += 1;
      });
      pending = valid;
      pendingDuplicates = countDuplicates(valid);
      renderPreview();
      if (!valid.length) {
        setStatus("没有解析到有效活动。请检查 name、start、end 字段。", "error");
      } else {
        const mergeCount = Math.max(0, valid.length - pendingDuplicates);
        setStatus(`已读取 ${rawEvents.length} 条，有效 ${valid.length} 条；合并可新增 ${mergeCount} 条。`, "success");
      }
    } catch (e) {
      pending = [];
      renderPreview();
      setStatus(e.message || String(e), "error");
    } finally {
      $("#dataFile").value = "";
    }
  }

  function exportData() {
    const events = (callbacks.getEvents() || []).map((ev) => ({
      id: ev.id,
      name: ev.name,
      start: ev.start,
      end: ev.end,
      type: ev.type,
      hasStages: ev.hasStages,
      shopStatus: ev.shopStatus,
      forecast: !!ev.forecast,
      color: ev.color,
      note: ev.note || "",
    }));
    const payload = {
      app: "arknights-calendar-studio",
      version: 1,
      exportedAt: new Date().toISOString(),
      events,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    a.href = url;
    a.download = `明日方舟_活动数据_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setStatus(`已导出 ${events.length} 个活动。`, "success");
    $("#btnConfirmDataImport").disabled = true;
    callbacks.toast(`已导出 ${events.length} 个活动。`);
  }

  function confirmImport() {
    if (!pending.length) return;
    const mode = document.querySelector('input[name="dataImportMode"]:checked').value;
    if (mode === "replace") {
      const existing = callbacks.getEvents().length;
      if (existing && !window.confirm(`覆盖现有 ${existing} 个活动？建议先导出一份备份。`)) return;
      callbacks.replaceEvents(pending);
      setStatus(`已覆盖导入 ${pending.length} 个活动。`, "success");
      callbacks.toast(`已覆盖导入 ${pending.length} 个活动。`);
    } else {
      const result = callbacks.mergeEvents(pending);
      setStatus(`合并完成：新增 ${result.added} 个，跳过重复 ${result.skipped} 个。`, "success");
      callbacks.toast(`合并完成：新增 ${result.added} 个。`);
    }
    pending = [];
    $("#btnConfirmDataImport").disabled = true;
    $("#btnConfirmDataImport").textContent = "确认导入";
    setTimeout(close, 500);
  }

  function open() {
    $("#dataModal").classList.remove("hidden");
    setStatus("", "");
    if (!pending.length) {
      $("#dataPreview").innerHTML = '<div class="ai-empty">还没有选择文件。先导出备份，或选择一个 JSON 文件。</div>';
      $("#btnConfirmDataImport").disabled = true;
      $("#btnConfirmDataImport").textContent = "确认导入";
    }
  }

  function close() {
    $("#dataModal").classList.add("hidden");
  }

  function init(opts) {
    Object.assign(callbacks, opts || {});
    $("#btnData").addEventListener("click", open);
    $("#btnCloseData").addEventListener("click", close);
    $("#btnCancelDataImport").addEventListener("click", close);
    $("#btnExportData").addEventListener("click", exportData);
    $("#dataFile").addEventListener("change", (e) => handleFile(e.target.files && e.target.files[0]));
    document.querySelectorAll('input[name="dataImportMode"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (pending.length) renderPreview();
      });
    });
    $("#btnConfirmDataImport").addEventListener("click", confirmImport);
    $("#dataModal").addEventListener("click", (e) => {
      if (e.target === $("#dataModal")) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("#dataModal").classList.contains("hidden")) close();
    });
  }

  window.DataPort = { init, open, close };
})();
