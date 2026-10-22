/* AI-assisted official-source import.
 * Works in two modes:
 *  - proxy: POST to the local Node server, which keeps the API key server-side.
 *  - direct: call an OpenAI-compatible endpoint from the browser.
 */
(function () {
  "use strict";

  const C = window.CalendarCore;
  const $ = (sel) => document.querySelector(sel);
  const SETTINGS_KEY = "arknights-calendar-ai-settings-v1";
  const KEY_SESSION_KEY = "arknights-calendar-ai-key-session";

  const EVENT_SCHEMA = {
    type: "object",
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            start: { type: "string" },
            end: { type: "string" },
            type: { type: "string", enum: ["SideStory", "复刻", "签到", "其他"] },
            hasStages: { type: "boolean" },
            shopStatus: { type: "string", enum: ["uncleared", "cleared", "none", "unknown"] },
            forecast: { type: "boolean" },
            sourceUrl: { type: "string" },
            evidence: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["name", "start", "end", "type", "hasStages", "shopStatus", "forecast", "sourceUrl", "evidence", "confidence"],
          additionalProperties: false,
        },
      },
      notes: { type: "array", items: { type: "string" } },
    },
    required: ["events", "notes"],
    additionalProperties: false,
  };

  const callbacks = {
    getEvents: () => [],
    addEvents: () => {},
    toast: () => {},
  };

  let settings = null;
  let results = [];
  let busy = false;

  // ---------- settings ----------
  function defaultSettings() {
    const served = location.protocol === "http:" || location.protocol === "https:";
    return {
      mode: served ? "proxy" : "direct",
      proxyUrl: "/api/ai/import",
      protocol: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "",
      model: "deepseek-flash",
      rememberKey: true,
    };
  }

  function loadSettings() {
    const defaults = defaultSettings();
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return defaults;
      const saved = JSON.parse(raw);
      const merged = { ...defaults, ...saved };
      if (merged.rememberKey === false) {
        try { merged.apiKey = sessionStorage.getItem(KEY_SESSION_KEY) || ""; } catch (e) { merged.apiKey = ""; }
      }
      return merged;
    } catch (e) {
      return defaults;
    }
  }

  function persistSettings(next) {
    settings = { ...next };
    const { apiKey, ...rest } = settings;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
      if (settings.rememberKey) {
        localStorage.setItem(SETTINGS_KEY + "-key", apiKey || "");
        sessionStorage.removeItem(KEY_SESSION_KEY);
      } else {
        localStorage.removeItem(SETTINGS_KEY + "-key");
        sessionStorage.setItem(KEY_SESSION_KEY, apiKey || "");
      }
    } catch (e) {
      /* localStorage can be unavailable on file:// */
    }
  }

  function loadStoredKey() {
    try {
      return localStorage.getItem(SETTINGS_KEY + "-key") || "";
    } catch (e) {
      return "";
    }
  }

  function settingsForRequest(override) {
    const base = override || settings || loadSettings();
    if (base.rememberKey && !base.apiKey) base.apiKey = loadStoredKey();
    return base;
  }

  function fillSettingsForm() {
    const s = settingsForRequest();
    $("#aiMode").value = s.mode;
    $("#aiProtocol").value = s.protocol || "deepseek";
    $("#aiProxyUrl").value = s.proxyUrl || "/api/ai/import";
    $("#aiBaseUrl").value = s.baseUrl || "https://api.deepseek.com";
    $("#aiApiKey").value = s.apiKey || "";
    $("#aiModel").value = s.model || "deepseek-flash";
    $("#aiRememberKey").checked = s.rememberKey !== false;
    toggleModeFields();
  }

  function readSettingsForm() {
    return {
      mode: $("#aiMode").value,
      protocol: $("#aiProtocol").value,
      proxyUrl: $("#aiProxyUrl").value.trim() || "/api/ai/import",
      baseUrl: $("#aiBaseUrl").value.trim() || "https://api.deepseek.com",
      apiKey: $("#aiApiKey").value.trim(),
      model: $("#aiModel").value.trim() || "deepseek-flash",
      rememberKey: $("#aiRememberKey").checked,
    };
  }

  function toggleModeFields() {
    const mode = $("#aiMode").value;
    $("#aiProxyFields").classList.toggle("hidden", mode !== "proxy");
    $("#aiDirectFields").classList.toggle("hidden", mode !== "direct");
  }

  function applyProtocolPreset() {
    const protocol = $("#aiProtocol").value;
    const base = $("#aiBaseUrl");
    const model = $("#aiModel");
    if (protocol === "deepseek") {
      if (!base.value || /openai\.com/i.test(base.value)) base.value = "https://api.deepseek.com";
      if (!model.value || /^gpt-/i.test(model.value)) model.value = "deepseek-flash";
    } else if (protocol === "responses") {
      if (!base.value || /deepseek\.com/i.test(base.value)) base.value = "https://api.openai.com/v1";
      if (!model.value || /^deepseek-/i.test(model.value)) model.value = "gpt-4.1";
    }
  }

  // ---------- prompt ----------
  function buildPrompt(from, to) {
    return [
      "你是《明日方舟》官方活动信息整理助手。请联网搜索，并严格只使用以下官方来源：",
      "- 明日方舟官网公告：https://ak.hypergryph.com/news",
      "- 官方微博：https://weibo.com/arknights",
      "- 明日方舟官方 B 站 / 微信公众号（仅官方认证账号）",
      "不要使用 NGA、TapTap、玩家 Wiki、新闻聚合站、攻略站等非官方来源。",
      "",
      `今天是 ${C.fmtDate(new Date())}。检索范围：${from} 至 ${to}（北京时间 UTC+8）。`,
      "找出该范围内开启或结束的限时活动、SideStory、复刻、签到活动，以及同期开放的剿灭委托。",
      "",
      "对每个活动输出：",
      "- name：活动名（不要带书名号以外的修饰）",
      "- start / end：北京时间，格式 YYYY-MM-DDTHH:mm，精确到分钟",
      "- type：SideStory / 复刻 / 签到 / 其他",
      "- hasStages：是否有可消耗理智的活动关卡（签到/登录为 false）",
      "- shopStatus：uncleared / cleared / none / unknown。无法确认时写 unknown，不要猜。",
      "- forecast：是否只是预告 / 未确认",
      "- sourceUrl：官方公告或官方社媒链接",
      "- evidence：引用公告里关于活动时间的原文片段",
      "- confidence：0 到 1 的置信度",
      "",
      "规则：",
      "1. 结束时间为公告写的 03:59 就写 03:59，不要改成 23:59。",
      "2. 只收录同时有明确开始和结束时间的活动；没有明确结束时间就不要猜。",
      "3. 签到 / 登录活动 hasStages=false、shopStatus=none。",
      "4. 有活动关卡但公告没提商店的，shopStatus=unknown。",
      "5. 不要编造；找不到就返回空数组。",
      "6. 只输出 JSON，不要 Markdown 代码块，不要额外解释。",
      "",
      'JSON 格式：{"events":[{"name":"","start":"","end":"","type":"SideStory","hasStages":true,"shopStatus":"unknown","forecast":false,"sourceUrl":"","evidence":"","confidence":0.9}],"notes":[""]}',
    ].join("\n");
  }

  function buildTestPrompt() {
    return "这是接口连接测试。请只回复两个字母：OK";
  }

  // ---------- provider calls ----------
  function endpointFor(s) {
    const base = String(s.baseUrl || "").replace(/\/+$/, "");
    if (/\/(responses|chat\/completions)$/.test(base)) return base;
    return base + (s.protocol === "chat" || s.protocol === "deepseek" ? "/chat/completions" : "/responses");
  }

  function searchEndpointFor(s) {
    const base = String(s.baseUrl || "").replace(/\/+$/, "");
    if (/\/tools\/search$/.test(base)) return base;
    if (/\/v1$/.test(base)) return base + "/tools/search";
    return base + "/v1/tools/search";
  }

  function responseBody(s, prompt, purpose) {
    if (s.protocol === "chat" || s.protocol === "deepseek") {
      const body = {
        model: s.model,
        messages: [
          { role: "system", content: "你是严谨的《明日方舟》官方活动信息整理助手。只输出 JSON，不编造。" },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
      };
      if (purpose === "search") body.response_format = { type: "json_object" };
      return body;
    }
    const body = {
      model: s.model,
      input: prompt,
    };
    if (purpose === "search") {
      body.tools = [{ type: "web_search" }];
      body.text = {
        format: {
          type: "json_schema",
          name: "arknights_events",
          strict: true,
          schema: EVENT_SCHEMA,
        },
      };
    }
    return body;
  }

  function extractText(data) {
    if (!data) return "";
    if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
    if (Array.isArray(data.output)) {
      const chunks = [];
      for (const item of data.output) {
        if (!item || !Array.isArray(item.content)) continue;
        for (const content of item.content) {
          if (content && typeof content.text === "string") chunks.push(content.text);
        }
      }
      if (chunks.length) return chunks.join("");
    }
    if (data.choices && data.choices[0]) {
      const message = data.choices[0].message;
      if (message) {
        if (typeof message.content === "string") return message.content;
        if (Array.isArray(message.content)) {
          return message.content.map((part) => (part && (part.text || part.content)) || "").join("");
        }
      }
    }
    return "";
  }

  function deepSeekQueries(from, to) {
    return [
      `site:ak.hypergryph.com 明日方舟 活动 ${from} ${to}`,
      `site:weibo.com 明日方舟Arknights 活动 ${from} ${to}`,
      `site:bilibili.com 明日方舟 官方 活动 ${from} ${to}`,
    ];
  }

  function isOfficialUrl(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
      const officialHosts = ["hypergryph.com", "weibo.com", "weibo.cn", "bilibili.com", "b23.tv", "mp.weixin.qq.com"];
      return officialHosts.some((item) => host === item || host.endsWith("." + item));
    } catch (e) {
      return false;
    }
  }

  async function deepSeekSearch(s, from, to) {
    const endpoint = searchEndpointFor(s);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${s.apiKey}`,
    };
    const seen = new Set();
    const results = [];
    for (const query of deepSeekQueries(from, to)) {
      let response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ query, count: 6, need_content: true }),
        });
      } catch (e) {
        throw new Error("DeepSeek Search 请求失败。直连模式可能被 CORS 拦截，建议改用本地代理。");
      }
      let data = null;
      try { data = await response.json(); } catch (e) { data = null; }
      if (!response.ok) {
        const message = (data && data.error && (data.error.message || data.error)) || `HTTP ${response.status}`;
        throw new Error(`DeepSeek Search 返回错误：${message}`);
      }
      for (const item of (data && data.results) || []) {
        if (!item || !item.url || seen.has(item.url)) continue;
        if (!isOfficialUrl(item.url)) continue;
        seen.add(item.url);
        results.push(item);
      }
    }
    return results.slice(0, 12);
  }

  async function callDeepSeekDirect(s, prompt, purpose, meta) {
    if (!s.apiKey) throw new Error("DeepSeek 直连需要 API Key。请到「接口设置」填写，或改用本地代理。");
    if (purpose === "test") return callDirect(s, prompt, purpose);

    const from = meta && meta.from;
    const to = meta && meta.to;
    if (!from || !to) throw new Error("缺少检索日期范围，无法调用 DeepSeek Search。");

    const searchResults = await deepSeekSearch(s, from, to);
    if (!searchResults.length) {
      return JSON.stringify({
        events: [],
        notes: [
          "DeepSeek Search 没有返回可用的官方页面。",
          "请检查日期范围、网络或 API 余额；不要在没有来源的情况下让模型猜测活动时间。",
        ],
      });
    }

    const context = searchResults.map((item, index) => {
      const content = String(item.content || "").slice(0, 2600);
      return [
        `[${index + 1}] ${item.title || ""}`,
        `URL: ${item.url}`,
        `DATE: ${item.date || "unknown"}  AUTHORITY: ${item.authority == null ? "unknown" : item.authority}`,
        `SUMMARY: ${item.summary || item.snippet || ""}`,
        content ? `CONTENT:\n${content}` : "",
      ].filter(Boolean).join("\n");
    }).join("\n\n");

    const finalPrompt = [
      prompt,
      "",
      "=== 以下是 DeepSeek Search 返回的官方页面 ===",
      context,
      "",
      "请只依据以上页面提取活动；页面没有明确写出的时间不要猜。",
      "如果页面不足以确认某个活动，降低 confidence 或直接不输出。",
    ].join("\n");

    const endpoint = endpointFor(s);
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${s.apiKey}`,
        },
        body: JSON.stringify({
          model: s.model,
          messages: [
            { role: "system", content: "你是严谨的《明日方舟》官方活动信息整理助手。只能依据用户提供的官方页面提取，不得使用记忆编造。只输出 JSON。" },
            { role: "user", content: finalPrompt },
          ],
          temperature: 0.1,
          max_tokens: 8000,
          response_format: { type: "json_object" },
        }),
      });
    } catch (e) {
      throw new Error("DeepSeek Chat 请求失败。直连模式可能被 CORS 拦截，建议改用本地代理。");
    }
    let data = null;
    try { data = await response.json(); } catch (e) { data = null; }
    if (!response.ok) {
      const message = (data && data.error && (data.error.message || data.error)) || `HTTP ${response.status}`;
      throw new Error(`DeepSeek Chat 返回错误：${message}`);
    }
    const text = extractText(data);
    if (!text) throw new Error("DeepSeek 返回了空内容。");
    return text;
  }

  async function callDirect(s, prompt, purpose) {
    if (!s.apiKey) throw new Error("直连模式需要 API Key。请到「接口设置」填写，或改用本地代理。");
    const endpoint = endpointFor(s);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${s.apiKey}`,
    };
    const body = responseBody(s, prompt, purpose);

    async function send(payload) {
      try {
        return await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
      } catch (e) {
        throw new Error(
          "请求失败。可能是接口不支持浏览器跨域（CORS），或网络不可达。建议用「本地代理」模式启动 server.js。"
        );
      }
    }

    let response = await send(body);
    let data = null;
    try { data = await response.json(); } catch (e) { data = null; }

    // Some OpenAI-compatible providers reject response_format / text.format.
    if (!response.ok && purpose === "search") {
      const message = String((data && data.error && (data.error.message || data.error)) || "");
      if (s.protocol === "chat" && /response_format|json_object/i.test(message)) {
        const retry = { ...body };
        delete retry.response_format;
        response = await send(retry);
        try { data = await response.json(); } catch (e) { data = null; }
      } else if (s.protocol === "responses" && /format|json_schema|schema/i.test(message)) {
        const retry = { ...body };
        delete retry.text;
        retry.input = `${prompt}\n\n注意：只输出一个 JSON 对象，不要 Markdown 代码块。`;
        response = await send(retry);
        try { data = await response.json(); } catch (e) { data = null; }
      }
    }

    if (!response.ok) {
      const message = (data && data.error && (data.error.message || data.error)) || `HTTP ${response.status}`;
      throw new Error(`AI 接口返回错误：${message}`);
    }
    const text = extractText(data);
    if (!text) throw new Error("AI 接口返回了空内容。");
    return text;
  }

  async function callProxy(s, prompt, purpose, meta) {
    if (!s.proxyUrl) throw new Error("代理地址为空。");
    let response;
    try {
      response = await fetch(s.proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model: s.model,
          protocol: s.protocol,
          purpose,
          from: meta && meta.from,
          to: meta && meta.to,
        }),
      });
    } catch (e) {
      throw new Error("代理不可达。请先在项目目录运行 `node server.js`，并通过 http://127.0.0.1:8787 打开页面。");
    }
    let data = null;
    try { data = await response.json(); } catch (e) { data = null; }
    if (!response.ok || !data || data.ok === false) {
      const message = (data && data.error) || `HTTP ${response.status}`;
      throw new Error(`代理返回错误：${message}`);
    }
    if (!data.text) throw new Error("代理返回了空内容。");
    return data.text;
  }

  async function runAI(prompt, purpose, overrideSettings, meta) {
    const s = settingsForRequest(overrideSettings);
    if (s.mode === "proxy") return callProxy(s, prompt, purpose, meta);
    if (s.protocol === "deepseek") return callDeepSeekDirect(s, prompt, purpose, meta);
    return callDirect(s, prompt, purpose);
  }

  // ---------- parsing ----------
  function stripJSON(text) {
    let value = String(text || "").trim();
    value = value.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const first = value.indexOf("{");
    const last = value.lastIndexOf("}");
    if (first >= 0 && last > first) return value.slice(first, last + 1);
    const firstArr = value.indexOf("[");
    const lastArr = value.lastIndexOf("]");
    if (firstArr >= 0 && lastArr > firstArr) return value.slice(firstArr, lastArr + 1);
    return value;
  }

  function parseAIResponse(text) {
    let parsed;
    try {
      parsed = JSON.parse(stripJSON(text));
    } catch (e) {
      throw new Error("AI 返回的内容不是有效 JSON。可以重试，或换一个更稳定的模型。");
    }
    const rawEvents = Array.isArray(parsed) ? parsed : parsed.events;
    if (!Array.isArray(rawEvents)) throw new Error("AI 返回 JSON 里没有 events 数组。");
    const notes = Array.isArray(parsed && parsed.notes) ? parsed.notes.map(String) : [];
    const existing = callbacks.getEvents() || [];
    return {
      events: rawEvents.map((raw) => normalizeEvent(raw, existing)).filter(Boolean),
      notes,
    };
  }

  function normalizeType(value) {
    if (value === "SideStory" || value === "复刻" || value === "签到" || value === "其他") return value;
    return "其他";
  }

  function normalizeEvent(raw, existing) {
    if (!raw || typeof raw !== "object") return null;
    const warnings = [];
    let name = String(raw.name || "").trim();
    if (!name) name = "未命名活动";

    let startRaw = String(raw.start || "").trim();
    let endRaw = String(raw.end || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) {
      startRaw += "T12:00";
      warnings.push("AI 未给出开始时间，已按 12:00 填充，请核对。");
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(endRaw)) {
      endRaw += "T03:59";
      warnings.push("AI 未给出结束时间，已按 03:59 填充，请核对。");
    }
    const start = C.parseLocal(startRaw);
    const end = C.parseLocal(endRaw);
    const valid = !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start;
    if (!valid) warnings.push("开始 / 结束时间不完整或结束早于开始，不能导入。");

    const type = normalizeType(raw.type);
    let hasStages = typeof raw.hasStages === "boolean" ? raw.hasStages : type !== "签到";
    if (type === "签到") hasStages = false;
    if (typeof raw.hasStages !== "boolean" && type !== "签到") {
      warnings.push("AI 未明确是否有活动关卡，已按“有”处理。");
    }

    let shopStatus = String(raw.shopStatus || "unknown");
    if (!["uncleared", "cleared", "none", "unknown"].includes(shopStatus)) shopStatus = "unknown";
    if (!hasStages) shopStatus = "none";
    if (hasStages && shopStatus === "unknown") {
      shopStatus = "uncleared";
      warnings.push("商店状态未确认，已按“商店未搬空”导入，请手动核对。");
    }

    let sourceUrl = String(raw.sourceUrl || "").trim();
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
      if (/^(weibo\.com|ak\.hypergryph\.com|www\.bilibili\.com|b23\.tv)\//i.test(sourceUrl)) {
        sourceUrl = "https://" + sourceUrl;
      } else {
        sourceUrl = "";
        warnings.push("来源链接不是有效的 http(s) 地址，已忽略。");
      }
    }
    if (sourceUrl) {
      try {
        const host = new URL(sourceUrl).hostname.replace(/^www\./, "").toLowerCase();
        const officialHosts = ["hypergryph.com", "weibo.com", "weibo.cn", "bilibili.com", "b23.tv", "mp.weixin.qq.com"];
        if (!officialHosts.some((item) => host === item || host.endsWith("." + item))) {
          warnings.push(`来源域名 ${host} 不在官方白名单内，请核对。`);
        }
      } catch (e) {
        warnings.push("来源链接无法解析，请核对。");
      }
    }
    if (!sourceUrl) warnings.push("AI 未提供可点击的官方来源，建议人工核对。");

    const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
    if (confidence && confidence < 0.65) warnings.push(`AI 置信度较低（${Math.round(confidence * 100)}%），请重点核对。`);

    const normalized = {
      name,
      start: valid ? C.toInputValue(start) : "",
      end: valid ? C.toInputValue(end) : "",
      type,
      hasStages,
      shopStatus,
      forecast: !!raw.forecast,
      sourceUrl,
      evidence: String(raw.evidence || "").trim(),
      confidence,
      warnings,
      valid,
      duplicate: false,
      checked: valid,
      imported: false,
    };

    const normalizeName = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/sidestory|复刻|限时活动|活动|「|」|【|】|《|》|\s+/g, "");
    const keyName = normalizeName(name);
    normalized.duplicate = existing.some((ev) => {
      const sameName = normalizeName(ev.name) === keyName;
      if (!sameName) return false;
      if (!valid) return true;
      return C.sameDay(ev.start, start) || C.sameDay(ev.end, end);
    });
    if (normalized.duplicate) {
      normalized.checked = false;
      normalized.warnings.push("日历里已有同名 / 同起始日的活动，默认不导入。");
    }

    return normalized;
  }

  // ---------- UI ----------
  function setStatus(el, message, kind) {
    const node = typeof el === "string" ? $(el) : el;
    if (!node) return;
    node.className = "ai-status" + (message ? " show" : "") + (kind ? " " + kind : "");
    if (kind === "loading") {
      node.innerHTML = `<span class="spinner"></span>${escapeHtml(message)}`;
    } else {
      node.textContent = message || "";
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function renderResults(notes) {
    const wrap = $("#aiResults");
    if (!results.length) {
      wrap.innerHTML = '<div class="ai-empty">没有找到可导入的活动。可以扩大日期范围、换一个支持联网搜索的模型，或检查接口设置。</div>';
      updateSelectedCount();
      return;
    }

    const noteHtml = notes && notes.length
      ? `<div class="ai-status show" style="margin-top:0;margin-bottom:8px">${notes.map(escapeHtml).join("<br>")}</div>`
      : "";

    wrap.innerHTML = noteHtml + results.map((r, index) => {
      const tags = [
        `<span class="tag">${escapeHtml(r.type)}</span>`,
        `<span class="tag ${r.hasStages ? "" : "none"}">${r.hasStages ? "有活动关卡" : "无活动关卡"}</span>`,
        `<span class="tag ${r.shopStatus}">${escapeHtml(shopLabel(r.shopStatus))}</span>`,
        r.forecast ? '<span class="tag forecast">预计</span>' : "",
        r.confidence ? `<span class="tag">置信 ${Math.round(r.confidence * 100)}%</span>` : "",
        r.duplicate ? '<span class="tag muted">已存在</span>' : "",
        r.imported ? '<span class="tag cleared">已导入</span>' : "",
      ].filter(Boolean).join("");
      const dateText = r.valid ? `${C.fmtDate(r.start)} ${C.fmtTime(r.start)} → ${C.fmtDate(r.end)} ${C.fmtTime(r.end)}` : "时间不完整";
      const source = r.sourceUrl
        ? ` · <a href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">官方来源</a>`
        : "";
      const warnings = r.warnings.length
        ? `<div class="ai-result-warning ${r.valid ? "" : "bad"}">${r.warnings.map(escapeHtml).join("<br>")}</div>`
        : "";
      return `
        <div class="ai-result ${r.duplicate ? "duplicate" : ""}">
          <input type="checkbox" class="ai-result-check" data-ai-index="${index}" ${r.checked ? "checked" : ""} ${(!r.valid || r.duplicate || r.imported) ? "disabled" : ""}>
          <div class="ai-result-main">
            <div class="ai-result-name">${escapeHtml(r.name)}</div>
            <div class="ai-result-date">${dateText}</div>
            <div class="ai-result-tags">${tags}</div>
            <div class="ai-result-evidence">${escapeHtml(r.evidence || "AI 未提供原文摘录")}${source}</div>
            ${warnings}
          </div>
        </div>
      `;
    }).join("");

    updateSelectedCount();
  }

  function shopLabel(value) {
    if (value === "uncleared") return "商店未搬空";
    if (value === "cleared") return "商店已搬空";
    if (value === "none") return "无商店";
    return "商店状态未知";
  }

  function updateSelectedCount() {
    const count = results.filter((r) => r.checked && r.valid && !r.duplicate && !r.imported).length;
    $("#aiSelectedCount").textContent = `${count} 项可导入`;
    $("#btnAIImportSelected").disabled = count === 0 || busy;
    const selectable = results.filter((r) => r.valid && !r.duplicate && !r.imported);
    $("#aiSelectAll").checked = selectable.length > 0 && selectable.every((r) => r.checked);
  }

  function setBusy(value) {
    busy = value;
    $("#btnAISearch").disabled = value;
    $("#aiSelectAll").disabled = value;
    $("#btnAIImportSelected").disabled = value || results.filter((r) => r.checked && r.valid && !r.duplicate && !r.imported).length === 0;
    $("#btnAISearch").textContent = value ? "搜索中…" : "开始搜索";
  }

  async function searchOfficial() {
    if (busy) return;
    const from = $("#aiFrom").value;
    const to = $("#aiTo").value;
    if (!from || !to) {
      setStatus("#aiStatus", "请先选择检索开始和结束日期。", "error");
      return;
    }
    if (C.parseLocal(from) > C.parseLocal(to)) {
      setStatus("#aiStatus", "检索开始日期不能晚于结束日期。", "error");
      return;
    }

    const s = settingsForRequest();
    if (s.mode === "direct" && !s.apiKey) {
      setStatus("#aiStatus", "直连模式还没有 API Key。请到「接口设置」填写，或运行 server.js 用本地代理。", "error");
      return;
    }

    setBusy(true);
    setStatus("#aiStatus", "正在搜索官方公告与社媒，并整理活动时间…", "loading");
    $("#aiResults").innerHTML = "";
    results = [];

    try {
      const text = await runAI(buildPrompt(from, to), "search", null, { from, to });
      const parsed = parseAIResponse(text);
      results = parsed.events;
      renderResults(parsed.notes);
      if (!results.length) {
        setStatus("#aiStatus", "搜索完成，但没有找到可导入的活动。可以扩大日期范围或换模型。", "success");
      } else {
        const validCount = results.filter((r) => r.valid && !r.duplicate).length;
        setStatus("#aiStatus", `搜索完成：找到 ${results.length} 条，其中 ${validCount} 条可导入。请核对时间和来源后再导入。`, "success");
      }
    } catch (e) {
      setStatus("#aiStatus", e.message || String(e), "error");
    } finally {
      setBusy(false);
      updateSelectedCount();
    }
  }

  function importSelected() {
    const selected = results.filter((r) => r.checked && r.valid && !r.duplicate && !r.imported);
    if (!selected.length) return;
    const events = selected.map((r) => ({
      name: r.name,
      start: r.start,
      end: r.end,
      type: r.type,
      hasStages: r.hasStages,
      shopStatus: r.shopStatus,
      forecast: r.forecast,
      note: [r.evidence, r.sourceUrl ? `来源：${r.sourceUrl}` : ""].filter(Boolean).join("\n"),
    }));
    callbacks.addEvents(events);
    selected.forEach((r) => { r.imported = true; r.checked = false; });
    renderResults([]);
    setStatus("#aiStatus", `已导入 ${events.length} 个活动。请回到日历核对时间与商店状态。`, "success");
    callbacks.toast(`AI 已导入 ${events.length} 个活动。`);
  }

  // ---------- test connection ----------
  async function testConnection() {
    if (busy) return;
    const formSettings = readSettingsForm();
    const s = settingsForRequest(formSettings);
    if (s.mode === "direct" && !s.apiKey) {
      setStatus("#aiSettingsStatus", "直连模式需要 API Key。", "error");
      return;
    }
    setStatus("#aiSettingsStatus", "正在测试接口…", "loading");
    try {
      const text = await runAI(buildTestPrompt(), "test", formSettings);
      const short = String(text).trim().slice(0, 80);
      setStatus("#aiSettingsStatus", `接口可用，返回：${short || "(空)"}`, "success");
    } catch (e) {
      setStatus("#aiSettingsStatus", e.message || String(e), "error");
    }
  }

  // ---------- tabs / open / close ----------
  function switchTab(tab) {
    const isImport = tab === "import";
    $("#aiTabImport").classList.toggle("active", isImport);
    $("#aiTabSettings").classList.toggle("active", !isImport);
    $("#aiImportPane").classList.toggle("hidden", !isImport);
    $("#aiSettingsPane").classList.toggle("hidden", isImport);
    if (!isImport) fillSettingsForm();
  }

  function open() {
    const d = new Date();
    if (!$("#aiFrom").value) $("#aiFrom").value = C.toDateInput(C.addDays(d, -30));
    if (!$("#aiTo").value) $("#aiTo").value = C.toDateInput(C.addDays(d, 45));
    $("#aiModal").classList.remove("hidden");
    switchTab("import");
    setStatus("#aiStatus", "", "");
    if (settings && settings.mode === "direct" && !settingsForRequest().apiKey) {
      setStatus("#aiStatus", "第一次使用：先在「接口设置」填 API Key，或运行 server.js 用本地代理。", "");
    }
  }

  function close() {
    $("#aiModal").classList.add("hidden");
  }

  function saveSettingsFromForm() {
    const next = readSettingsForm();
    persistSettings(next);
    setStatus("#aiSettingsStatus", "设置已保存。", "success");
    callbacks.toast("AI 接口设置已保存。");
  }

  // ---------- init ----------
  function init(opts) {
    Object.assign(callbacks, opts || {});
    settings = loadSettings();
    settings.apiKey = settings.apiKey || loadStoredKey();
    fillSettingsForm();

    $("#btnAIImport").addEventListener("click", open);
    $("#btnCloseAI").addEventListener("click", close);
    $("#aiModal").addEventListener("click", (e) => {
      if (e.target === $("#aiModal")) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("#aiModal").classList.contains("hidden")) close();
    });

    $("#aiTabImport").addEventListener("click", () => switchTab("import"));
    $("#aiTabSettings").addEventListener("click", () => switchTab("settings"));
    $("#btnAISettingsFromImport").addEventListener("click", () => switchTab("settings"));
    $("#btnAIBackToImport").addEventListener("click", () => switchTab("import"));
    $("#aiMode").addEventListener("change", toggleModeFields);
    $("#aiProtocol").addEventListener("change", applyProtocolPreset);
    $("#btnAISearch").addEventListener("click", searchOfficial);
    $("#btnAIImportSelected").addEventListener("click", importSelected);
    $("#btnAISaveSettings").addEventListener("click", saveSettingsFromForm);
    $("#btnAITest").addEventListener("click", testConnection);

    $("#aiSelectAll").addEventListener("change", (e) => {
      const checked = e.target.checked;
      results.forEach((r) => {
        if (r.valid && !r.duplicate && !r.imported) r.checked = checked;
      });
      renderResults([]);
    });

    $("#aiResults").addEventListener("change", (e) => {
      const check = e.target.closest("[data-ai-index]");
      if (!check) return;
      const index = Number(check.getAttribute("data-ai-index"));
      if (results[index]) results[index].checked = check.checked;
      updateSelectedCount();
    });
  }

  window.AIImport = { init, open, close };
})();
