/* Optional local server for the Arknights event calendar studio.
 *
 * Static server + AI proxy so the API key never reaches the browser.
 *
 * Usage:
 *   node server.js
 *   open http://127.0.0.1:8787
 *
 * Environment:
 *   PORT=8787
 *   AI_API_KEY=sk-...            (or OPENAI_API_KEY)
 *   AI_API_BASE=https://api.openai.com/v1
 *   AI_MODEL=gpt-4.1
 *   AI_PROTOCOL=responses        (responses | chat)
 *   MOCK_AI=1                    (demo mode; no API key needed)
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const MOCK = process.env.MOCK_AI === "1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let pathnameDecoded;
  try {
    pathnameDecoded = decodeURIComponent(pathname);
  } catch (e) {
    res.writeHead(400); res.end("Bad request"); return;
  }
  const relative = pathnameDecoded === "/" ? "/index.html" : pathnameDecoded;
  const filePath = path.resolve(ROOT, "." + relative);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, "index.html")) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function joinEndpoint(base, protocol) {
  const clean = String(base || "").replace(/\/+$/, "");
  if (/\/(responses|chat\/completions)$/.test(clean)) return clean;
  return clean + (protocol === "chat" ? "/chat/completions" : "/responses");
}

function buildProviderBody(protocol, model, prompt) {
  if (protocol === "chat") {
    return {
      model,
      messages: [
        { role: "system", content: "你是严谨的《明日方舟》官方活动信息整理助手。只输出 JSON，不编造。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    };
  }
  return {
    model,
    input: prompt,
    tools: [{ type: "web_search" }],
  };
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
  if (data.choices && data.choices[0] && data.choices[0].message) {
    const message = data.choices[0].message;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content.map((part) => (part && (part.text || part.content)) || "").join("");
    }
  }
  return "";
}

function mockText() {
  const payload = {
    events: [
      {
        name: "昨日海",
        start: "2026-10-09T12:00",
        end: "2026-10-23T03:59",
        type: "SideStory",
        hasStages: true,
        shopStatus: "unknown",
        forecast: false,
        sourceUrl: "https://ak.hypergryph.com/news/5101",
        evidence: "活动时间：10月09日 12:00 - 10月30日 03:59；活动关卡开启至10月23日 03:59。",
        confidence: 0.96,
      },
      {
        name: "感谢庆典（AI 示例）",
        start: "2026-11-01T04:00",
        end: "2026-11-15T03:59",
        type: "SideStory",
        hasStages: true,
        shopStatus: "unknown",
        forecast: true,
        sourceUrl: "https://ak.hypergryph.com/news/0799",
        evidence: "按 10/24 前瞻直播预测的示例活动，正式时间以官方公告为准。",
        confidence: 0.62,
      },
    ],
    notes: [
      "MOCK_AI=1：这是演示数据，不是真实联网搜索结果。",
      "真实模式请配置 AI_API_KEY，并确认模型支持 web_search。",
    ],
  };
  return JSON.stringify(payload);
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

function deepSeekSearchEndpoint(base) {
  const clean = String(base || "").replace(/\/+$/, "");
  if (/\/tools\/search$/.test(clean)) return clean;
  if (/\/v1$/.test(clean)) return clean + "/tools/search";
  return clean + "/v1/tools/search";
}

async function deepSeekSearchAll(apiKey, base, from, to, signal) {
  const endpoint = deepSeekSearchEndpoint(base);
  const queries = [
    `site:ak.hypergryph.com 明日方舟 活动 ${from} ${to}`,
    `site:weibo.com 明日方舟Arknights 活动 ${from} ${to}`,
    `site:bilibili.com 明日方舟 官方 活动 ${from} ${to}`,
  ];
  const seen = new Set();
  const results = [];
  for (const query of queries) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, count: 6, need_content: true }),
      signal,
    });
    let data = null;
    try { data = await response.json(); } catch (e) { data = null; }
    if (!response.ok) {
      const message = (data && data.error && (data.error.message || data.error)) || `HTTP ${response.status}`;
      throw new Error(`DeepSeek Search 返回错误：${message}`);
    }
    for (const item of (data && data.results) || []) {
      if (!item || !item.url || seen.has(item.url) || !isOfficialUrl(item.url)) continue;
      seen.add(item.url);
      results.push(item);
    }
  }
  return results.slice(0, 12);
}

function deepSeekContext(results) {
  return results.map((item, index) => {
    const content = String(item.content || "").slice(0, 2600);
    return [
      `[${index + 1}] ${item.title || ""}`,
      `URL: ${item.url}`,
      `DATE: ${item.date || "unknown"}  AUTHORITY: ${item.authority == null ? "unknown" : item.authority}`,
      `SUMMARY: ${item.summary || item.snippet || ""}`,
      content ? `CONTENT:\n${content}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

async function callDeepSeek(apiKey, base, model, prompt, from, to, signal) {
  if (!from || !to) throw new Error("DeepSeek 模式需要 from / to 日期范围");
  const results = await deepSeekSearchAll(apiKey, base, from, to, signal);
  if (!results.length) {
    return {
      text: JSON.stringify({
        events: [],
        notes: [
          "DeepSeek Search 没有返回可用的官方页面。",
          "请检查日期范围、网络或 API 余额；不要在无来源时猜测活动时间。",
        ],
      }),
      searchCount: 0,
      results: [],
    };
  }

  const finalPrompt = [
    prompt,
    "",
    "=== 以下是 DeepSeek Search 返回的官方页面 ===",
    deepSeekContext(results),
    "",
    "请只依据以上页面提取活动；页面没有明确写出的时间不要猜。",
    "如果页面不足以确认某个活动，降低 confidence 或直接不输出。",
  ].join("\n");

  const endpoint = joinEndpoint(base, "chat");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是严谨的《明日方舟》官方活动信息整理助手。只能依据用户提供的官方页面提取，不得使用记忆编造。只输出 JSON。" },
        { role: "user", content: finalPrompt },
      ],
      temperature: 0.1,
      max_tokens: 8000,
      response_format: { type: "json_object" },
    }),
    signal,
  });
  let data = null;
  try { data = await response.json(); } catch (e) { data = null; }
  if (!response.ok) {
    const message = (data && data.error && (data.error.message || data.error)) || `HTTP ${response.status}`;
    throw new Error(`DeepSeek Chat 返回错误：${message}`);
  }
  const text = extractText(data);
  if (!text) throw new Error("DeepSeek 返回了空内容");
  return {
    text,
    searchCount: results.length,
    results: results.map((item) => ({ title: item.title, url: item.url, date: item.date })),
  };
}

async function handleAI(req, res) {
  let raw;
  try {
    raw = await readBody(req, 1024 * 1024);
  } catch (e) {
    sendJson(res, 413, { ok: false, error: e.message });
    return;
  }

  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch (e) {
    sendJson(res, 400, { ok: false, error: "请求体不是有效 JSON" });
    return;
  }

  if (MOCK) {
    sendJson(res, 200, {
      ok: true,
      text: mockText(),
      model: "mock",
      protocol: "mock",
      usage: null,
      mock: true,
    });
    return;
  }

  const protocol = body.protocol || process.env.AI_PROTOCOL || "deepseek";
  const isDeepSeek = protocol === "deepseek";
  const apiKey = isDeepSeek
    ? (process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY || process.env.OPENAI_API_KEY)
    : (process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY);
  if (!apiKey) {
    sendJson(res, 500, {
      ok: false,
      error: isDeepSeek
        ? "服务端未配置 DEEPSEEK_API_KEY（或 AI_API_KEY）。可先设置 MOCK_AI=1 演示。"
        : "服务端未配置 AI_API_KEY。可先设置 MOCK_AI=1 演示，或在环境变量中配置密钥。",
    });
    return;
  }

  const model = body.model || (isDeepSeek
    ? (process.env.DEEPSEEK_MODEL || process.env.AI_MODEL || "deepseek-flash")
    : (process.env.AI_MODEL || "gpt-4.1"));
  const base = isDeepSeek
    ? (process.env.DEEPSEEK_API_BASE || process.env.AI_API_BASE || "https://api.deepseek.com")
    : (process.env.AI_API_BASE || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1");
  const prompt = String(body.prompt || "").trim();
  if (!prompt) {
    sendJson(res, 400, { ok: false, error: "缺少 prompt" });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    if (isDeepSeek && body.purpose === "test") {
      const endpoint = joinEndpoint(base, "chat");
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 32,
        }),
        signal: controller.signal,
      });
      let data = null;
      try { data = await response.json(); } catch (e) { data = null; }
      if (!response.ok) {
        const message = (data && data.error && (data.error.message || data.error)) || `HTTP ${response.status}`;
        sendJson(res, 502, { ok: false, error: String(message) });
        return;
      }
      const text = extractText(data);
      sendJson(res, 200, { ok: true, text: text || "OK", model, protocol, test: true });
      return;
    }

    if (isDeepSeek) {
      const from = String(body.from || "").trim();
      const to = String(body.to || "").trim();
      const out = await callDeepSeek(apiKey, base, model, prompt, from, to, controller.signal);
      sendJson(res, 200, {
        ok: true,
        text: out.text,
        model,
        protocol,
        searchCount: out.searchCount,
        searchResults: out.results,
        usage: null,
      });
      return;
    }

    const endpoint = joinEndpoint(base, protocol);
    let response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildProviderBody(protocol, model, prompt)),
      signal: controller.signal,
    });
    let data = null;
    try { data = await response.json(); } catch (e) { data = null; }

    // Some OpenAI-compatible providers reject response_format; retry once.
    if (!response.ok && protocol === "chat") {
      const msg = (data && data.error && (data.error.message || data.error)) || "";
      if (/response_format|json_object/i.test(String(msg))) {
        const retryBody = buildProviderBody(protocol, model, prompt);
        delete retryBody.response_format;
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(retryBody),
          signal: controller.signal,
        });
        try { data = await response.json(); } catch (e) { data = null; }
      }
    }

    if (!response.ok) {
      const message = (data && data.error && (data.error.message || data.error)) || `HTTP ${response.status}`;
      sendJson(res, 502, { ok: false, error: String(message) });
      return;
    }

    const text = extractText(data);
    if (!text) {
      sendJson(res, 502, { ok: false, error: "模型返回了空内容" });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      text,
      model,
      protocol,
      usage: data && data.usage ? data.usage : null,
    });
  } catch (e) {
    const message = e && e.name === "AbortError" ? "AI 请求超时（120 秒）" : (e.message || String(e));
    sendJson(res, 502, { ok: false, error: message });
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/api/ai/import") {
    if (req.method === "POST") {
      handleAI(req, res);
    } else {
      sendJson(res, 405, { ok: false, error: "POST only" });
    }
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405); res.end("Method not allowed"); return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  Arknights Event Calendar Studio");
  console.log(`  http://${HOST}:${PORT}`);
  console.log(`  AI proxy: POST http://${HOST}:${PORT}/api/ai/import`);
  if (MOCK) {
    console.log("  MOCK_AI=1: AI proxy returns demo data only.");
  } else {
    const configured = !!(
      process.env.DEEPSEEK_API_KEY ||
      process.env.AI_API_KEY ||
      process.env.OPENAI_API_KEY
    );
    console.log(`  AI key: ${configured ? "configured" : "NOT configured"}`);
    console.log(`  AI protocol: ${process.env.AI_PROTOCOL || "deepseek"}`);
    console.log(`  AI model: ${process.env.DEEPSEEK_MODEL || process.env.AI_MODEL || "deepseek-flash"}`);
  }
  console.log("");
});
