/* UI for the Arknights event calendar studio. */
(function () {
  "use strict";

  const C = window.CalendarCore;
  const STORAGE_KEY = "arknights-calendar-studio-v1";
  const $ = (sel) => document.querySelector(sel);

  const state = {
    events: [],
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(),
    selected: C.toKey(new Date()),
    editingId: null,
  };

  let toastTimer = null;

  // ---------- small helpers ----------
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function weekdayCN(date) {
    const d = C.parseLocal(date);
    const idx = d.getDay() === 0 ? 6 : d.getDay() - 1;
    return C.WEEKDAYS[idx];
  }

  function weekdayShort(date) {
    const d = C.parseLocal(date);
    const idx = d.getDay() === 0 ? 6 : d.getDay() - 1;
    return C.WEEKDAYS_SHORT[idx];
  }

  function uid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "ev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  function toast(message, type) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("error", type === "error");
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function sortEvents(events) {
    return events.slice().sort((a, b) => C.parseLocal(a.start) - C.parseLocal(b.start));
  }

  function eventById(id) {
    return state.events.find((ev) => ev.id === id);
  }

  function isStageEvent(ev) {
    return !!ev.hasStages;
  }

  // ---------- persistence ----------
  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.events)) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          events: state.events,
          viewYear: state.viewYear,
          viewMonth: state.viewMonth,
          selected: state.selected,
        })
      );
    } catch (error) {
      /* localStorage may be unavailable on file:// in some browsers */
    }
  }

  function hydrateEvent(raw, index) {
    const now = new Date();
    const start = raw.start ? C.toInputValue(raw.start) : C.toInputValue(now);
    let end = raw.end ? C.toInputValue(raw.end) : C.toInputValue(C.addDays(now, 7));
    if (C.parseLocal(end) <= C.parseLocal(start)) {
      end = C.toInputValue(C.addDays(C.parseLocal(start), 7));
    }
    const type = raw.type || "SideStory";
    const hasStages = typeof raw.hasStages === "boolean" ? raw.hasStages : type !== "签到";
    let shopStatus = raw.shopStatus || (hasStages ? "uncleared" : "none");
    if (!hasStages) shopStatus = "none";
    return {
      id: raw.id || uid(),
      name: raw.name || "未命名活动",
      start,
      end,
      type,
      hasStages,
      shopStatus,
      forecast: !!raw.forecast,
      color: raw.color || C.COLORS[index % C.COLORS.length],
      note: raw.note || "",
    };
  }

  function hydrateEvents(rawEvents) {
    return sortEvents(rawEvents.map(hydrateEvent));
  }

  function chooseColor(events) {
    const used = new Set(events.map((ev) => ev.color));
    const free = C.COLORS.find((color) => !used.has(color));
    if (free) return free;
    return C.COLORS[events.length % C.COLORS.length];
  }

  function normalizeEventName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/sidestory|复刻|限时活动|活动|「|」|【|】|《|》|\s+/g, "");
  }

  function replaceEvents(rawEvents) {
    state.events = hydrateEvents(rawEvents || []);
    const first = state.events[0];
    if (first) {
      state.selected = C.toKey(first.start);
      state.viewYear = C.parseLocal(first.start).getFullYear();
      state.viewMonth = C.parseLocal(first.start).getMonth();
    }
    saveState();
    renderAll();
  }

  function mergeEvents(rawEvents) {
    const incoming = hydrateEvents(rawEvents || []);
    const seen = new Set();
    for (const ev of state.events) {
      seen.add(normalizeEventName(ev.name) + "|" + C.toKey(ev.start));
      if (ev.id) seen.add("id|" + ev.id);
    }
    let added = 0;
    let skipped = 0;
    for (const ev of incoming) {
      const key = normalizeEventName(ev.name) + "|" + C.toKey(ev.start);
      if (seen.has(key) || (ev.id && seen.has("id|" + ev.id))) {
        skipped += 1;
        continue;
      }
      state.events.push(ev);
      seen.add(key);
      if (ev.id) seen.add("id|" + ev.id);
      added += 1;
    }
    if (added) {
      state.events = sortEvents(state.events);
      const newest = incoming.find((ev) => state.events.some((item) => item.id === ev.id));
      if (newest) {
        state.selected = C.toKey(newest.start);
        state.viewYear = C.parseLocal(newest.start).getFullYear();
        state.viewMonth = C.parseLocal(newest.start).getMonth();
      }
      saveState();
      renderAll();
    }
    return { added, skipped };
  }

  function addEvents(rawEvents) {
    const created = [];
    for (const raw of rawEvents || []) {
      if (!raw || !raw.name) continue;
      const start = C.parseLocal(raw.start);
      const end = C.parseLocal(raw.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;
      const hasStages = raw.hasStages !== false;
      created.push({
        id: uid(),
        name: String(raw.name).trim(),
        start: C.toInputValue(start),
        end: C.toInputValue(end),
        type: raw.type || "其他",
        hasStages,
        shopStatus: hasStages ? (raw.shopStatus || "uncleared") : "none",
        forecast: !!raw.forecast,
        color: chooseColor(state.events.concat(created)),
        note: raw.note || "",
      });
    }
    if (!created.length) return [];
    state.events = sortEvents(state.events.concat(created));
    const first = created[0];
    state.selected = C.toKey(first.start);
    state.viewYear = C.parseLocal(first.start).getFullYear();
    state.viewMonth = C.parseLocal(first.start).getMonth();
    saveState();
    renderAll();
    return created;
  }

  // ---------- initial state ----------
  function initialSelection(events) {
    const today = new Date();
    const saved = loadSaved();
    if (saved && saved.selected) {
      const d = C.parseLocal(saved.selected);
      if (!Number.isNaN(d.getTime())) return d;
    }
    const relevant = events.some((ev) => {
      const start = C.parseLocal(ev.start);
      const end = C.parseLocal(ev.end);
      return C.addDays(start, -14) <= today && today <= C.addDays(end, 14);
    });
    if (relevant) return today;
    if (events.length) return C.parseLocal(events[0].start);
    return today;
  }

  function init() {
    const saved = loadSaved();
    if (saved && Array.isArray(saved.events)) {
      state.events = hydrateEvents(saved.events);
      state.viewYear = Number.isFinite(saved.viewYear) ? saved.viewYear : new Date().getFullYear();
      state.viewMonth = Number.isFinite(saved.viewMonth) ? saved.viewMonth : new Date().getMonth();
    } else {
      state.events = hydrateEvents(C.defaultEvents());
    }

    const selected = initialSelection(state.events);
    state.selected = C.toKey(selected);
    state.viewYear = selected.getFullYear();
    state.viewMonth = selected.getMonth();

    bindEvents();
    resetForm();
    renderAll();
  }

  // ---------- form ----------
  function setFormDateDefaults() {
    const base = C.parseLocal(state.selected || new Date());
    $("#fieldStartDate").value = C.toDateInput(base);
    $("#fieldStartTime").value = "12:00";
    $("#fieldEndDate").value = C.toDateInput(C.addDays(base, 7));
    $("#fieldEndTime").value = "03:59";
  }

  function resetForm() {
    state.editingId = null;
    $("#fieldName").value = "";
    $("#fieldType").value = "SideStory";
    $("#fieldShop").value = "uncleared";
    $("#fieldStages").checked = true;
    $("#fieldForecast").checked = false;
    setFormDateDefaults();
    $("#btnSave").textContent = "添加活动";
    $("#btnCancelEdit").classList.add("hidden");
    updateFormAvailability();
  }

  function updateFormAvailability() {
    const type = $("#fieldType").value;
    const stages = $("#fieldStages");
    const shop = $("#fieldShop");
    const wasDisabled = stages.disabled;

    if (type === "签到") {
      stages.checked = false;
      stages.disabled = true;
      shop.value = "none";
      shop.disabled = true;
      return;
    }

    stages.disabled = false;
    if (wasDisabled) stages.checked = true;

    if (!stages.checked) {
      shop.value = "none";
      shop.disabled = true;
      return;
    }

    shop.disabled = false;
    if (wasDisabled && shop.value === "none") shop.value = "uncleared";
  }

  function readForm() {
    const type = $("#fieldType").value;
    const hasStages = type === "签到" ? false : $("#fieldStages").checked;
    const start = C.parseLocal(`${$("#fieldStartDate").value}T${$("#fieldStartTime").value || "00:00"}`);
    const end = C.parseLocal(`${$("#fieldEndDate").value}T${$("#fieldEndTime").value || "00:00"}`);
    return {
      name: $("#fieldName").value.trim(),
      start,
      end,
      type,
      hasStages,
      shopStatus: hasStages ? $("#fieldShop").value : "none",
      forecast: $("#fieldForecast").checked,
    };
  }

  function handleSubmit(event) {
    event.preventDefault();
    const data = readForm();
    if (!data.name) {
      toast("先填活动名称。", "error");
      $("#fieldName").focus();
      return;
    }
    if (Number.isNaN(data.start.getTime()) || Number.isNaN(data.end.getTime())) {
      toast("开始 / 结束时间不完整。", "error");
      return;
    }
    if (data.end <= data.start) {
      toast("结束时间必须晚于开始时间。", "error");
      return;
    }

    if (state.editingId) {
      const idx = state.events.findIndex((ev) => ev.id === state.editingId);
      if (idx >= 0) {
        state.events[idx] = {
          ...state.events[idx],
          name: data.name,
          start: C.toInputValue(data.start),
          end: C.toInputValue(data.end),
          type: data.type,
          hasStages: data.hasStages,
          shopStatus: data.shopStatus,
          forecast: data.forecast,
        };
        toast("活动已更新。");
      }
    } else {
      state.events.push({
        id: uid(),
        name: data.name,
        start: C.toInputValue(data.start),
        end: C.toInputValue(data.end),
        type: data.type,
        hasStages: data.hasStages,
        shopStatus: data.shopStatus,
        forecast: data.forecast,
        color: chooseColor(state.events),
        note: "",
      });
      toast("活动已加入日历。");
    }

    state.events = sortEvents(state.events);
    state.selected = C.toKey(data.start);
    state.viewYear = data.start.getFullYear();
    state.viewMonth = data.start.getMonth();
    saveState();
    resetForm();
    renderAll();
  }

  function editEvent(id) {
    const ev = eventById(id);
    if (!ev) return;
    state.editingId = id;
    $("#fieldName").value = ev.name;
    $("#fieldStartDate").value = C.toDateInput(ev.start);
    $("#fieldStartTime").value = C.toTimeInput(ev.start);
    $("#fieldEndDate").value = C.toDateInput(ev.end);
    $("#fieldEndTime").value = C.toTimeInput(ev.end);
    $("#fieldType").value = ev.type;
    $("#fieldStages").checked = ev.hasStages;
    $("#fieldShop").value = ev.shopStatus;
    $("#fieldForecast").checked = ev.forecast;
    $("#btnSave").textContent = "保存修改";
    $("#btnCancelEdit").classList.remove("hidden");
    updateFormAvailability();
    $("#fieldName").focus();
    $(".manager").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function deleteEvent(id) {
    const ev = eventById(id);
    if (!ev) return;
    if (!window.confirm(`删除活动「${ev.name}」？`)) return;
    state.events = state.events.filter((item) => item.id !== id);
    if (state.editingId === id) resetForm();
    saveState();
    renderAll();
    toast("活动已删除。");
  }

  function toggleShop(id) {
    const ev = eventById(id);
    if (!ev || !ev.hasStages || ev.shopStatus === "none") {
      toast("这个活动没有可切换的商店状态。", "error");
      return;
    }
    ev.shopStatus = ev.shopStatus === "uncleared" ? "cleared" : "uncleared";
    saveState();
    renderAll();
    if (ev.shopStatus === "cleared") {
      toast(`「${ev.name}」已标记搬空：理智药会优先留给下一个活动。`);
    } else {
      toast(`「${ev.name}」已标记未搬空：理智药优先当前活动。`);
    }
  }

  // ---------- render: event list ----------
  function renderEventList() {
    const wrap = $("#eventList");
    $("#eventCount").textContent = String(state.events.length);
    if (!state.events.length) {
      wrap.innerHTML = '<div class="empty-state">还没有活动。<br>在上方手动填入开始 / 结束时间，日历会自动排班。</div>';
      return;
    }

    wrap.innerHTML = state.events
      .map((ev) => {
        const forecastTag = ev.forecast ? '<span class="tag forecast">预计</span>' : "";
        const shopTag = ev.hasStages
          ? `<span class="tag ${ev.shopStatus}">${C.shopLabel(ev)}</span>`
          : '<span class="tag none">无活动关卡</span>';
        const toggle = ev.hasStages && ev.shopStatus !== "none"
          ? `<button type="button" class="mini-btn" data-action="toggle" data-id="${esc(ev.id)}">${ev.shopStatus === "uncleared" ? "标记搬空" : "标记未搬空"}</button>`
          : "";
        return `
          <div class="event-item" data-id="${esc(ev.id)}" role="button" tabindex="0">
            <span class="event-color" style="--c:${esc(ev.color)}"></span>
            <div class="event-main">
              <div class="event-name">${esc(ev.name)}${forecastTag}</div>
              <div class="event-time">${C.fmtDate(ev.start)} ${C.fmtTime(ev.start)} → ${C.fmtDate(ev.end)} ${C.fmtTime(ev.end)}</div>
              <div class="event-tags">
                <span class="tag">${esc(ev.type)}</span>
                ${shopTag}
              </div>
            </div>
            <div class="event-actions">
              ${toggle}
              <button type="button" class="mini-btn" data-action="edit" data-id="${esc(ev.id)}">编辑</button>
              <button type="button" class="mini-btn del" data-action="delete" data-id="${esc(ev.id)}">删除</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  // ---------- render: calendar ----------
  function renderCalendar() {
    const year = state.viewYear;
    const month = state.viewMonth;
    const days = C.monthGrid(year, month);
    const today = new Date();
    const grid = $("#calendarGrid");

    $("#monthLabel").textContent = `${year}年${month + 1}月`;

    const [mStart, mEnd] = C.monthRange(year, month);
    const monthEvents = state.events.filter((ev) => C.parseLocal(ev.end) > mStart && C.parseLocal(ev.start) < mEnd);
    $("#monthSub").textContent = monthEvents.length
      ? `${monthEvents.length} 个活动 · 点击日期查看详情`
      : "暂无活动 · 可在左侧添加";

    grid.innerHTML = days
      .map((day) => {
        const outside = day.getMonth() !== month;
        const isToday = C.sameDay(day, today);
        const selected = C.sameDay(day, state.selected);
        const weekend = day.getDay() === 0 || day.getDay() === 6;
        const dayEvents = C.eventsOnDay(state.events, day).slice(0, 4);
        const bars = dayEvents
          .map((ev) => `<i class="bar ${ev.forecast ? "forecast" : ""}" style="--c:${esc(ev.color)}"></i>`)
          .join("");
        const classes = [
          "day-cell",
          outside ? "outside" : "",
          weekend ? "weekend" : "",
          isToday ? "today" : "",
          selected ? "selected" : "",
        ].filter(Boolean).join(" ");
        return `
          <button type="button" class="${classes}" data-date="${C.toKey(day)}"
            aria-label="${C.fmtDate(day)} ${weekdayCN(day)}${dayEvents.length ? "，" + dayEvents.length + " 个活动" : ""}">
            <span class="day-meta">${isToday ? "TODAY" : ""}</span>
            <span class="daynum">${day.getDate()}</span>
            <span class="day-ghost" aria-hidden="true">${String(day.getDate()).padStart(2, "0")}</span>
            <span class="bars">${bars}</span>
          </button>
        `;
      })
      .join("");
  }

  // ---------- render: detail ----------
  function phaseClass(phase) {
    if (phase.includes("已结束")) return "ending";
    if (phase.includes("结束")) return "ending";
    if (phase.includes("开始")) return "starting";
    if (phase.includes("进行")) return "active";
    return "";
  }

  function renderDetail() {
    const root = $("#dayDetail");
    const plan = C.buildDayPlan(state.selected, state.events);
    const day = plan.day;
    const today = new Date();
    const isCurrentWeek = C.sameDay(plan.ws, C.weekStart(today));
    const weekEnd = C.addDays(plan.ws, 6);
    const nextReset = C.addDays(plan.ws, 7);
    const detailEvents = state.events
      .filter((ev) => C.overlapsDay(ev, day) || C.sameDay(ev.start, day) || C.sameDay(ev.end, day))
      .sort((a, b) => C.parseLocal(a.start) - C.parseLocal(b.start));

    const eventCards = detailEvents.length
      ? detailEvents.map((ev) => {
          const phase = C.eventPhase(ev, day);
          const tags = [
            `<span class="tag">${esc(ev.type)}</span>`,
            `<span class="tag ${ev.hasStages ? ev.shopStatus : "none"}">${esc(C.shopLabel(ev))}</span>`,
            ev.forecast ? '<span class="tag forecast">预计</span>' : "",
          ].filter(Boolean).join("");
          return `
            <div class="event-detail-card" style="--c:${esc(ev.color)}">
              <div class="event-detail-top">
                <div class="event-detail-name">${esc(ev.name)}</div>
                <span class="phase ${phaseClass(phase)}">${esc(phase)}</span>
              </div>
              <div class="event-detail-time">${C.fmtDate(ev.start)} ${C.fmtTime(ev.start)} → ${C.fmtDate(ev.end)} ${C.fmtTime(ev.end)}</div>
              <div class="event-detail-tags">${tags}</div>
              ${ev.note ? `<div class="event-note">${esc(ev.note)}</div>` : ""}
            </div>
          `;
        }).join("")
      : '<div class="detail-empty">今天没有活动。适合刷资源 / 主线，或把理智药留到下一个活动。</div>';

    const potion = plan.potion;
    let potionBody = "";
    if (potion.date) {
      const same = C.sameDay(potion.date, day);
      const isPast = C.parseLocal(potion.date) < new Date(today.getFullYear(), today.getMonth(), today.getDate(), 4, 0);
      const badge = same
        ? '<span class="rec-badge">今天就用</span>'
        : isPast
          ? '<span class="rec-badge past">已过</span>'
          : "";
      const coverChips = potion.candidates.map((ev) => `
        <span class="cover-chip" style="--c:${esc(ev.color)}"><i></i>${esc(ev.name)} · ${esc(C.shopLabel(ev))}</span>
      `).join("");
      potionBody = `
        <div class="rec-kicker"><span>理智药推荐</span><span>2 × 120 / 本周</span></div>
        <div class="rec-date">${C.fmtMD(potion.date)} ${weekdayCN(potion.date)} <span class="time">${esc(potion.timeLabel)}</span>${badge}</div>
        <div class="rec-reason">${esc(potion.reason)}</div>
        <div class="cover-chips">${coverChips}</div>
        ${potion.note ? `<div class="rule-note">${esc(potion.note)}</div>` : ""}
        <div class="rec-meta">本周药程 ${C.fmtMD(potion.weekStart)}–${C.fmtMD(potion.expiry)} · 到期 ${C.fmtDateTime(potion.expiry)} · ${potion.bottles} 瓶共 ${potion.sanity} 理智</div>
      `;
    } else {
      potionBody = `
        <div class="rec-kicker"><span>理智药推荐</span><span>2 × 120 / 本周</span></div>
        <div class="rec-date">暂无活动目标</div>
        <div class="rec-reason">${esc(potion.reason)}</div>
        <div class="rec-meta">本周药程 ${C.fmtMD(potion.weekStart)}–${C.fmtMD(potion.expiry)} · 到期 ${C.fmtDateTime(potion.expiry)}</div>
      `;
    }

    const annih = plan.annih;
    const annihSame = C.sameDay(annih.date, day);
    const annihPast = C.parseLocal(annih.date) < new Date(today.getFullYear(), today.getMonth(), today.getDate(), 4, 0);
    const annihBadge = annihSame
      ? '<span class="rec-badge">今天打</span>'
      : annihPast
        ? '<span class="rec-badge past">已过</span>'
        : "";
    const coverage = annih.coverage.map((cov) => {
      const hours = Math.round(cov.hours);
      const pct = Math.max(4, Math.min(100, Math.round((cov.hours / 24) * 100)));
      const color = cov.hours < 1 ? "#6cd3a4" : cov.hours >= 23 ? "#e1655b" : "#f3b14a";
      const rec = C.sameDay(cov.day, annih.date) ? "rec" : "";
      return `
        <div class="cov-day ${rec}" title="${C.fmtMD(cov.day)} · 活动覆盖 ${hours} 小时">
          <span>${weekdayCN(cov.day).replace("周", "")}</span>
          <div class="cov-track"><i style="height:${pct}%;--c:${color}"></i></div>
          <span class="cov-date">${C.fmtMD(cov.day)}</span>
        </div>
      `;
    }).join("");

    const actionRows = plan.actions.map((action) => `
      <div class="action-row ${esc(action.tone)}">
        <span class="action-icon">${esc(action.icon)}</span>
        <span class="action-text">${esc(action.text)}</span>
      </div>
    `).join("");

    root.innerHTML = `
      <div class="day-head">
        <div class="day-big">${String(day.getDate()).padStart(2, "0")}</div>
        <div>
          <div class="day-month">${day.getFullYear()}年${day.getMonth() + 1}月 · ${weekdayCN(day)}</div>
          <div class="day-week">本周 ${C.fmtMD(plan.ws)}–${C.fmtMD(weekEnd)}<br>下次刷新 ${C.fmtMD(nextReset)} 04:00</div>
        </div>
        <span class="week-pill">${isCurrentWeek ? "本周" : "排班周"}</span>
      </div>

      <div class="section">
        <div class="section-head">
          <span class="section-title">今日活动</span>
          <span class="section-meta">${detailEvents.length} 个</span>
        </div>
        ${eventCards}
      </div>

      <div class="section">
        <div class="section-head">
          <span class="section-title">理智药建议</span>
          <span class="section-meta">RULE 01 / 02</span>
        </div>
        <div class="rec-card">${potionBody}</div>
      </div>

      <div class="section">
        <div class="section-head">
          <span class="section-title">剿灭建议</span>
          <span class="section-meta">5 × 25 / 1800 玉</span>
        </div>
        <div class="rec-card annih">
          <div class="rec-kicker"><span>本周最佳剿灭日</span><span>${annih.allCovered ? "活动全覆盖" : "避开活动"}</span></div>
          <div class="rec-date">${C.fmtMD(annih.date)} ${weekdayCN(annih.date)} <span class="time">${esc(annih.timeLabel)}</span>${annihBadge}</div>
          <div class="rec-reason">${esc(annih.reason)}</div>
          <div class="coverage-strip">${coverage}</div>
          <div class="rec-meta">本周 ${C.fmtMD(annih.weekStart)}–${C.fmtMD(C.addDays(annih.weekStart, 6))} · ${annih.runs} 次约 ${annih.sanity} 理智 · 上限 ${annih.orundum} 玉</div>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <span class="section-title">当天行动</span>
          <span class="section-meta">ACTION</span>
        </div>
        <div class="action-list">${actionRows}</div>
      </div>
    `;
  }

  function renderAll() {
    renderEventList();
    renderCalendar();
    renderDetail();
  }

  // ---------- navigation ----------
  function selectDate(dateValue) {
    const d = C.parseLocal(dateValue);
    state.selected = C.toKey(d);
    if (d.getMonth() !== state.viewMonth || d.getFullYear() !== state.viewYear) {
      state.viewYear = d.getFullYear();
      state.viewMonth = d.getMonth();
    }
    saveState();
    renderCalendar();
    renderDetail();
  }

  function shiftMonth(delta) {
    let year = state.viewYear;
    let month = state.viewMonth + delta;
    if (month < 0) { month = 11; year -= 1; }
    if (month > 11) { month = 0; year += 1; }
    state.viewYear = year;
    state.viewMonth = month;
    const first = new Date(year, month, 1);
    state.selected = C.toKey(first);
    saveState();
    renderCalendar();
    renderDetail();
  }

  function goToday() {
    const today = new Date();
    state.viewYear = today.getFullYear();
    state.viewMonth = today.getMonth();
    state.selected = C.toKey(today);
    saveState();
    renderCalendar();
    renderDetail();
  }

  // ---------- export poster ----------
  function buildPosterCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1600;
    const ctx = canvas.getContext("2d");
    drawPoster(ctx, canvas.width, canvas.height);
    return canvas;
  }

  function exportPoster() {
    const canvas = buildPosterCanvas();
    canvas.toBlob((blob) => {
      if (!blob) {
        toast("导出失败：浏览器没有返回图片。", "error");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const month = `${state.viewYear}${String(state.viewMonth + 1).padStart(2, "0")}`;
      a.href = url;
      a.download = `明日方舟_活动日历_${month}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      toast("海报已导出。");
    }, "image/png");
  }

  function hexToRgb(hex) {
    const h = String(hex || "#58b7e8").replace("#", "");
    const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return {
      r: parseInt(v.slice(0, 2), 16),
      g: parseInt(v.slice(2, 4), 16),
      b: parseInt(v.slice(4, 6), 16),
    };
  }

  function rgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function blendHex(hex, target, t) {
    const a = hexToRgb(hex);
    const b = hexToRgb(target);
    const c = (x, y) => Math.round(x + (y - x) * t);
    return `rgb(${c(a.r, b.r)},${c(a.g, b.g)},${c(a.b, b.b)})`;
  }

  function rr(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function setFont(ctx, weight, size, mono) {
    ctx.font = `${weight} ${size}px ${mono ? '"Consolas","SFMono-Regular",monospace' : '"Microsoft YaHei","Noto Sans SC",sans-serif'}`;
  }

  function wrapLines(ctx, text, maxWidth) {
    const chars = Array.from(String(text));
    const lines = [];
    let line = "";
    for (const ch of chars) {
      // keep closing punctuation attached to the previous line
      if (line && /[，。；：、！？）》】]/.test(ch)) {
        line += ch;
        continue;
      }
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawWrapped(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const lines = wrapLines(ctx, text, maxWidth);
    const limited = typeof maxLines === "number" ? lines.slice(0, maxLines) : lines;
    limited.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
    return y + limited.length * lineHeight;
  }

  function drawPoster(ctx, W, H) {
    // background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#080c11");
    bg.addColorStop(1, "#121a23");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // grid
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.025)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 48) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 48) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();

    // header accents
    ctx.fillStyle = "#f3b14a";
    ctx.fillRect(80, 78, 8, 130);
    ctx.fillStyle = "rgba(88,183,232,0.7)";
    ctx.fillRect(94, 78, 4, 72);

    // title
    ctx.fillStyle = "#f3b14a";
    setFont(ctx, "700", 18, true);
    ctx.fillText("A R K N I G H T S   /   E V E N T   C A L E N D A R", 116, 88);

    setFont(ctx, "800", 72, false);
    ctx.fillStyle = "#eef4fa";
    const t1 = "明日方舟";
    ctx.fillText(t1, 112, 176);
    const t1w = ctx.measureText(t1).width;
    ctx.fillStyle = "#f3b14a";
    ctx.fillText(" 活动日历", 112 + t1w, 176);

    setFont(ctx, "400", 24, false);
    ctx.fillStyle = "#9bacbc";
    ctx.fillText(`${state.viewYear}.${String(state.viewMonth + 1).padStart(2, "0")}  /  活动时间 · 理智药 · 剿灭排班`, 116, 216);

    // right meta
    setFont(ctx, "700", 16, true);
    ctx.fillStyle = "#7d8fa1";
    ctx.textAlign = "right";
    ctx.fillText("DATA CUT  " + C.fmtDate(new Date()), 2320, 92);
    setFont(ctx, "400", 16, false);
    ctx.fillText("以游戏内 / 官方公告为准", 2320, 120);
    ctx.textAlign = "left";

    const pillW = 290, pillH = 40, pillX = 2320 - pillW, pillY = 150;
    rr(ctx, pillX, pillY, pillW, pillH, 20);
    ctx.fillStyle = "rgba(243,177,74,0.10)";
    ctx.fill();
    ctx.strokeStyle = "rgba(243,177,74,0.5)";
    ctx.stroke();
    setFont(ctx, "700", 16, false);
    ctx.fillStyle = "#f3b14a";
    ctx.fillText("当前", pillX + 16, pillY + 26);
    ctx.fillStyle = "#edf4fb";
    ctx.fillText(`${state.viewYear}年${state.viewMonth + 1}月排班`, pillX + 60, pillY + 26);

    // header rule
    ctx.strokeStyle = "#2a3744";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, 250); ctx.lineTo(2320, 250); ctx.stroke();
    ctx.strokeStyle = "#f3b14a";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(80, 250); ctx.lineTo(420, 250); ctx.stroke();

    // calendar geometry
    const GX = 80, GY = 316, GRID_W = 1520, COL_W = GRID_W / 7;
    const days = C.monthGrid(state.viewYear, state.viewMonth);
    const rows = days.length / 7;
    const ROW_H = Math.floor(1120 / rows);

    // weekday header
    ctx.textAlign = "center";
    C.WEEKDAYS.forEach((name, i) => {
      setFont(ctx, "700", 18, false);
      ctx.fillStyle = i >= 5 ? "#f3b14a" : "#93a4b5";
      ctx.fillText(name, GX + i * COL_W + COL_W / 2, 286);
    });
    ctx.textAlign = "left";

    ctx.strokeStyle = "#1d2833";
    ctx.beginPath(); ctx.moveTo(GX, 306); ctx.lineTo(GX + GRID_W, 306); ctx.stroke();

    const today = new Date();
    days.forEach((day, idx) => {
      const col = idx % 7;
      const row = Math.floor(idx / 7);
      const x = GX + col * COL_W + 4;
      const y = GY + row * ROW_H + 4;
      const w = COL_W - 8;
      const h = ROW_H - 8;
      const outside = day.getMonth() !== state.viewMonth;
      const isToday = C.sameDay(day, today);
      const selected = C.sameDay(day, state.selected);
      const weekend = day.getDay() === 0 || day.getDay() === 6;

      rr(ctx, x, y, w, h, 8);
      ctx.fillStyle = isToday ? "#1f1a13" : weekend ? "#101820" : "#0f161d";
      ctx.fill();
      ctx.strokeStyle = selected ? "#f3b14a" : isToday ? "rgba(243,177,74,0.55)" : "#1f2b37";
      ctx.lineWidth = selected ? 2 : 1;
      ctx.stroke();

      // oversized ghost date fills the tall calendar cell
      ctx.save();
      ctx.textAlign = "right";
      setFont(ctx, "700", 108, true);
      ctx.fillStyle = selected
        ? "rgba(243,177,74,0.075)"
        : isToday
          ? "rgba(243,177,74,0.06)"
          : outside
            ? "rgba(255,255,255,0.018)"
            : "rgba(255,255,255,0.032)";
      ctx.fillText(String(day.getDate()), x + w - 8, y + h - 8);
      ctx.restore();

      ctx.globalAlpha = outside ? 0.3 : 1;
      setFont(ctx, "700", 28, true);
      ctx.fillStyle = isToday ? "#f3b14a" : "#dfe8f2";
      ctx.fillText(String(day.getDate()), x + 12, y + 34);

      if (isToday) {
        setFont(ctx, "700", 9, true);
        ctx.fillStyle = "#f3b14a";
        ctx.textAlign = "right";
        ctx.fillText("TODAY", x + w - 10, y + 18);
        ctx.textAlign = "left";
      }

      const dayEvents = C.eventsOnDay(state.events, day).slice(0, 4);
      dayEvents.forEach((ev, barIdx) => {
        const by = y + h - 16 - (dayEvents.length - 1 - barIdx) * 7;
        rr(ctx, x + 10, by, w - 20, 4, 2);
        if (ev.forecast) {
          ctx.fillStyle = rgba(ev.color, 0.55);
          ctx.fillRect(x + 10, by, w - 20, 4);
        } else {
          ctx.fillStyle = ev.color;
          ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
    });

    // right panel
    const RX = 1640, RY = 316, RW = 680;
    rr(ctx, RX, RY, RW, 1120, 14);
    ctx.fillStyle = "#10171f";
    ctx.fill();
    ctx.strokeStyle = "#2a3744";
    ctx.stroke();

    const plan = C.buildDayPlan(state.selected, state.events);
    const detailEvents = state.events
      .filter((ev) => C.overlapsDay(ev, plan.day) || C.sameDay(ev.start, plan.day) || C.sameDay(ev.end, plan.day))
      .sort((x, z) => C.parseLocal(x.start) - C.parseLocal(z.start));
    const p = plan.potion;
    const a = plan.annih;
    let y = RY + 34;

    setFont(ctx, "700", 15, true);
    ctx.fillStyle = "#f3b14a";
    ctx.fillText("DAY DETAIL / 当天详情", RX + 28, y);
    y += 26;

    setFont(ctx, "800", 52, false);
    ctx.fillStyle = "#eef4fa";
    ctx.fillText(`${C.fmtMD(plan.day)}  ${weekdayCN(plan.day)}`, RX + 28, y + 26);
    setFont(ctx, "400", 16, true);
    ctx.fillStyle = "#7d8fa1";
    ctx.fillText(`WEEK ${C.fmtMD(plan.ws)}–${C.fmtMD(C.addDays(plan.ws, 6))}  /  NEXT RESET ${C.fmtMD(C.addDays(plan.ws, 7))} 04:00`, RX + 28, y + 54);
    y += 76;

    ctx.strokeStyle = "#1d2833";
    ctx.beginPath(); ctx.moveTo(RX + 28, y); ctx.lineTo(RX + RW - 28, y); ctx.stroke();
    y += 26;

    // events
    setFont(ctx, "700", 16, true);
    ctx.fillStyle = "#93a4b5";
    ctx.fillText("今日活动", RX + 28, y);
    y += 24;

    if (!detailEvents.length) {
      setFont(ctx, "400", 17, false);
      ctx.fillStyle = "#6f8092";
      ctx.fillText("今天没有活动。", RX + 28, y + 6);
      y += 40;
    } else {
      detailEvents.slice(0, 2).forEach((ev) => {
        ctx.fillStyle = ev.color;
        ctx.fillRect(RX + 28, y - 14, 4, 42);
        setFont(ctx, "700", 20, false);
        ctx.fillStyle = "#e9eff6";
        ctx.fillText(ev.name, RX + 46, y);
        setFont(ctx, "400", 13, true);
        ctx.fillStyle = "#7d8fa1";
        ctx.fillText(`${C.fmtMD(ev.start)} ${C.fmtTime(ev.start)} → ${C.fmtMD(ev.end)} ${C.fmtTime(ev.end)}`, RX + 46, y + 24);
        y += 54;
      });
      if (detailEvents.length > 2) {
        setFont(ctx, "400", 13, false);
        ctx.fillStyle = "#6f8092";
        ctx.fillText(`+${detailEvents.length - 2} 个活动`, RX + 46, y + 2);
        y += 22;
      }
      y += 4;
    }

    // sanity card
    const cardH = 320;
    rr(ctx, RX + 24, y, RW - 48, cardH, 10);
    ctx.fillStyle = "#0d151c";
    ctx.fill();
    ctx.strokeStyle = "#2a3946";
    ctx.stroke();
    setFont(ctx, "700", 14, true);
    ctx.fillStyle = "#6f8092";
    ctx.fillText("理智药推荐 / 2×120", RX + 44, y + 30);
    setFont(ctx, "800", 32, false);
    ctx.fillStyle = "#eef4fa";
    if (p.date) {
      ctx.fillText(`${C.fmtMD(p.date)} ${weekdayCN(p.date)}`, RX + 44, y + 72);
      setFont(ctx, "400", 17, false);
      ctx.fillStyle = "#9bacbc";
      ctx.fillText(p.timeLabel, RX + 330, y + 72);
    } else {
      ctx.fillText("暂无活动目标", RX + 44, y + 72);
    }
    setFont(ctx, "400", 16, false);
    ctx.fillStyle = "#a7b6c5";
    let reasonBottom = drawWrapped(ctx, p.reason, RX + 44, y + 106, RW - 88, 25, 4);
    if (p.note) {
      ctx.fillStyle = "#f3b14a";
      ctx.fillRect(RX + 44, reasonBottom + 8, 3, 18);
      setFont(ctx, "400", 14, false);
      ctx.fillStyle = "#d0b47f";
      drawWrapped(ctx, p.note, RX + 56, reasonBottom + 22, RW - 100, 22, 2);
    }
    setFont(ctx, "400", 12, true);
    ctx.fillStyle = "#6f8092";
    ctx.fillText(`到期 ${C.fmtDateTime(p.expiry)} · ${p.bottles} 瓶共 ${p.sanity} 理智`, RX + 44, y + cardH - 20);
    y += cardH + 14;

    // annihilation card
    const aH = 312;
    rr(ctx, RX + 24, y, RW - 48, aH, 10);
    ctx.fillStyle = "#0d151c";
    ctx.fill();
    ctx.strokeStyle = "#2a3946";
    ctx.stroke();
    setFont(ctx, "700", 14, true);
    ctx.fillStyle = "#6f8092";
    ctx.fillText("剿灭推荐 / 5×25", RX + 44, y + 30);
    setFont(ctx, "800", 32, false);
    ctx.fillStyle = "#eef4fa";
    ctx.fillText(`${C.fmtMD(a.date)} ${weekdayCN(a.date)}`, RX + 44, y + 72);
    setFont(ctx, "400", 17, false);
    ctx.fillStyle = "#9bacbc";
    ctx.fillText(a.timeLabel, RX + 330, y + 72);
    setFont(ctx, "400", 16, false);
    ctx.fillStyle = "#a7b6c5";
    drawWrapped(ctx, a.reason, RX + 44, y + 106, RW - 88, 25, 3);

    // mini coverage strip
    const cw = (RW - 88) / 7;
    a.coverage.forEach((cov, i) => {
      const cx = RX + 44 + i * cw;
      const cy = y + 198;
      const ch = 46;
      rr(ctx, cx + 2, cy, cw - 4, ch, 3);
      ctx.fillStyle = "#0a1016";
      ctx.fill();
      ctx.strokeStyle = C.sameDay(cov.day, a.date) ? "#f3b14a" : "#1e2b37";
      ctx.stroke();
      const ratio = Math.max(0.06, Math.min(1, cov.hours / 24));
      ctx.fillStyle = cov.hours < 1 ? "#6cd3a4" : cov.hours >= 23 ? "#e1655b" : "#f3b14a";
      const bh = Math.round((ch - 4) * ratio);
      ctx.fillRect(cx + 4, cy + ch - 2 - bh, cw - 8, bh);
      setFont(ctx, "400", 9, true);
      ctx.fillStyle = "#6f8092";
      ctx.textAlign = "center";
      ctx.fillText(C.WEEKDAYS[i].replace("周", ""), cx + cw / 2, cy + ch + 15);
      ctx.textAlign = "left";
    });
    setFont(ctx, "400", 12, true);
    ctx.fillStyle = "#6f8092";
    ctx.fillText(`本周 ${C.fmtMD(a.weekStart)}–${C.fmtMD(C.addDays(a.weekStart, 6))} · ${a.runs} 次约 ${a.sanity} 理智 · 上限 ${a.orundum} 玉`, RX + 44, y + aH - 20);
    y += aH + 18;

    // actions
    setFont(ctx, "700", 15, true);
    ctx.fillStyle = "#93a4b5";
    ctx.fillText("当天行动", RX + 28, y);
    y += 22;
    plan.actions.slice(0, 3).forEach((action) => {
      rr(ctx, RX + 24, y - 14, RW - 48, 32, 6);
      ctx.fillStyle = "#0c1319";
      ctx.fill();
      ctx.strokeStyle = "#23313e";
      ctx.stroke();
      ctx.fillStyle = action.tone === "green" ? "#6cd3a4" : action.tone === "orange" ? "#f3b14a" : action.tone === "blue" ? "#58b7e8" : "#607283";
      rr(ctx, RX + 34, y - 8, 20, 20, 5);
      ctx.fill();
      setFont(ctx, "700", 10, false);
      ctx.fillStyle = "#10151a";
      ctx.textAlign = "center";
      ctx.fillText(action.icon, RX + 44, y + 6);
      ctx.textAlign = "left";
      setFont(ctx, "400", 14, false);
      ctx.fillStyle = "#aebdcc";
      ctx.fillText(action.text, RX + 64, y + 5);
      y += 38;
    });

    // footer
    ctx.strokeStyle = "#1d2833";
    ctx.beginPath(); ctx.moveTo(80, 1490); ctx.lineTo(2320, 1490); ctx.stroke();
    setFont(ctx, "400", 11, false);
    ctx.fillStyle = "#637385";
    ctx.fillText("由「活动日历生成器」生成 · 活动时间与商店状态由用户手动维护 · 推荐结果仅供排班参考", 80, 1518);
    ctx.textAlign = "right";
    ctx.fillText(`生成于 ${C.fmtDate(new Date())} ${C.fmtTime(new Date())} · 非官方工具`, 2320, 1518);
    ctx.textAlign = "left";
  }

  // ---------- modal ----------
  function openRules() {
    $("#rulesModal").classList.remove("hidden");
  }

  function closeRules() {
    $("#rulesModal").classList.add("hidden");
  }

  // ---------- bindings ----------
  function bindEvents() {
    $("#eventForm").addEventListener("submit", handleSubmit);
    $("#fieldType").addEventListener("change", updateFormAvailability);
    $("#fieldStages").addEventListener("change", updateFormAvailability);
    $("#btnCancelEdit").addEventListener("click", resetForm);

    $("#eventList").addEventListener("click", (e) => {
      const actionBtn = e.target.closest("[data-action]");
      if (actionBtn) {
        e.stopPropagation();
        const id = actionBtn.getAttribute("data-id");
        const action = actionBtn.getAttribute("data-action");
        if (action === "edit") editEvent(id);
        if (action === "delete") deleteEvent(id);
        if (action === "toggle") toggleShop(id);
        return;
      }
      const item = e.target.closest(".event-item");
      if (item) editEvent(item.getAttribute("data-id"));
    });

    $("#eventList").addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest("button")) return;
      const item = e.target.closest(".event-item");
      if (item) {
        e.preventDefault();
        editEvent(item.getAttribute("data-id"));
      }
    });

    $("#calendarGrid").addEventListener("click", (e) => {
      const cell = e.target.closest(".day-cell");
      if (cell) selectDate(cell.getAttribute("data-date"));
    });

    $("#btnPrev").addEventListener("click", () => shiftMonth(-1));
    $("#btnNext").addEventListener("click", () => shiftMonth(1));
    $("#btnToday").addEventListener("click", goToday);

    $("#btnRules").addEventListener("click", openRules);
    $("#btnCloseRules").addEventListener("click", closeRules);
    $("#rulesModal").addEventListener("click", (e) => {
      if (e.target === $("#rulesModal")) closeRules();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeRules();
    });

    $("#btnSamples").addEventListener("click", () => {
      if (!window.confirm("用示例活动替换当前数据？当前录入会丢失。")) return;
      state.events = hydrateEvents(C.defaultEvents());
      state.editingId = null;
      const first = C.parseLocal(state.events[0].start);
      state.viewYear = first.getFullYear();
      state.viewMonth = first.getMonth();
      state.selected = C.toKey(first);
      saveState();
      resetForm();
      renderAll();
      toast("已载入示例活动。");
    });

    $("#btnExport").addEventListener("click", exportPoster);
  }

  // expose a tiny API for debugging / tests
  window.CalendarApp = {
    state,
    renderAll,
    buildPosterCanvas,
    exportPoster,
  };

  init();

  if (window.AIImport) {
    window.AIImport.init({
      getEvents: () => state.events,
      addEvents,
      toast,
    });
  }

  if (window.DataPort) {
    window.DataPort.init({
      getEvents: () => state.events,
      replaceEvents,
      mergeEvents,
      toast,
    });
  }
})();
