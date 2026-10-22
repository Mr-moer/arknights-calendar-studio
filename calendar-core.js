/* CalendarCore — pure scheduling logic for the Arknights event calendar studio.
 * No DOM dependencies; runs in the browser and in Node for tests.
 */
(function (global) {
  "use strict";

  const DAY = 24 * 60 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;
  const MINUTE = 60 * 1000;

  const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const WEEKDAYS_SHORT = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const COLORS = ["#58b7e8", "#f3b14a", "#6cd3a4", "#e1655b", "#9d8ed8", "#e08cc4", "#7fd1c8", "#d6a66a"];

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function parseLocal(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (typeof value === "number") return new Date(value);
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) return new Date(value);
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, 0, 0);
  }

  function toInputValue(value) {
    const d = parseLocal(value);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function toDateInput(value) {
    const d = parseLocal(value);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function toTimeInput(value) {
    const d = parseLocal(value);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function toKey(value) {
    const d = parseLocal(value);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function fmtDate(value) {
    const d = parseLocal(value);
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  }

  function fmtMD(value) {
    const d = parseLocal(value);
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  }

  function fmtTime(value) {
    const d = parseLocal(value);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtDateTime(value) {
    const d = parseLocal(value);
    return `${fmtMD(d)} ${fmtTime(d)}`;
  }

  function fmtRange(ev) {
    return `${fmtDate(ev.start)} ${fmtTime(ev.start)} → ${fmtDate(ev.end)} ${fmtTime(ev.end)}`;
  }

  function sameDay(a, b) {
    return toKey(a) === toKey(b);
  }

  function addDays(value, n) {
    const d = parseLocal(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), 0, 0);
  }

  function at4(value) {
    const d = parseLocal(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 4, 0, 0, 0);
  }

  function weekStart(value) {
    const d = parseLocal(value);
    const day = d.getDay(); // 0 = Sunday
    const diff = (day + 6) % 7; // Monday = 0
    let ws = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff, 4, 0, 0, 0);
    if (d < ws) ws = new Date(ws.getTime() - 7 * DAY);
    return ws;
  }

  function weekEnd(value) {
    return addDays(weekStart(value), 7);
  }

  function weekDays(value) {
    const ws = weekStart(value);
    return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  }

  function dayWindow(value) {
    const start = at4(value);
    return [start, addDays(start, 1)];
  }

  function overlapHours(ev, day) {
    const [a, b] = dayWindow(day);
    const start = Math.max(parseLocal(ev.start).getTime(), a.getTime());
    const end = Math.min(parseLocal(ev.end).getTime(), b.getTime());
    return Math.max(0, (end - start) / HOUR);
  }

  function overlapsDay(ev, day) {
    return overlapHours(ev, day) > 0;
  }

  function eventPhase(ev, day) {
    const [a, b] = dayWindow(day);
    const start = parseLocal(ev.start);
    const end = parseLocal(ev.end);
    const starts = sameDay(start, day);
    const ends = sameDay(end, day);
    if (starts && ends) return "今日开始并结束";
    if (starts) return "今日开始";
    if (ends) return end <= a ? "今日已结束" : "今日结束";
    if (end <= a) return "已结束";
    if (start >= b) return "未开始";
    return "进行中";
  }

  function eventsOnDay(events, day) {
    return events
      .filter((ev) => overlapsDay(ev, day))
      .slice()
      .sort((a, b) => parseLocal(a.start) - parseLocal(b.start));
  }

  function unionCoverageHours(events, day) {
    const [a, b] = dayWindow(day);
    const intervals = [];
    for (const ev of events) {
      if (!ev.hasStages) continue;
      const start = Math.max(parseLocal(ev.start).getTime(), a.getTime());
      const end = Math.min(parseLocal(ev.end).getTime(), b.getTime());
      if (end > start) intervals.push([start, end]);
    }
    if (!intervals.length) return 0;
    intervals.sort((x, y) => x[0] - y[0]);
    let total = 0;
    let curStart = intervals[0][0];
    let curEnd = intervals[0][1];
    for (let i = 1; i < intervals.length; i += 1) {
      const [s, e] = intervals[i];
      if (s <= curEnd) {
        curEnd = Math.max(curEnd, e);
      } else {
        total += curEnd - curStart;
        curStart = s;
        curEnd = e;
      }
    }
    total += curEnd - curStart;
    return total / HOUR;
  }

  function monthGrid(year, month) {
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
    const start = new Date(year, month, 1 - offset);
    return Array.from({ length: cells }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }

  function monthRange(year, month) {
    const start = new Date(year, month, 1, 0, 0);
    const end = new Date(year, month + 1, 1, 0, 0);
    return [start, end];
  }

  function daysBetween(a, b) {
    return Math.round((at4(b) - at4(a)) / DAY);
  }

  function stageEvents(events) {
    return events.filter((ev) => ev.hasStages);
  }

  function iterateDays(start, end) {
    const out = [];
    let d = at4(start);
    const stop = parseLocal(end);
    while (d < stop) {
      out.push(new Date(d));
      d = addDays(d, 1);
    }
    return out;
  }

  function usableDay(ev, day) {
    return overlapHours(ev, day) >= 1;
  }

  function latestUsableDay(ev, ws, expiry) {
    const start = new Date(Math.max(at4(ev.start).getTime(), ws.getTime()));
    const end = new Date(Math.min(parseLocal(ev.end).getTime(), expiry.getTime()));
    const days = iterateDays(start, end);
    let best = null;
    for (const day of days) {
      if (day < ws || day >= expiry) continue;
      if (usableDay(ev, day)) best = day;
    }
    if (best) return best;
    return new Date(Math.max(parseLocal(ev.start).getTime(), ws.getTime()));
  }

  function firstUsableDay(ev, ws, expiry) {
    const start = new Date(Math.max(at4(ev.start).getTime(), ws.getTime()));
    const end = new Date(Math.min(parseLocal(ev.end).getTime(), expiry.getTime()));
    const days = iterateDays(start, end);
    for (const day of days) {
      if (day < ws || day >= expiry) continue;
      if (usableDay(ev, day)) return day;
    }
    return new Date(Math.max(parseLocal(ev.start).getTime(), ws.getTime()));
  }

  function shopLabel(ev) {
    if (!ev.hasStages) return "无活动关卡";
    if (ev.shopStatus === "uncleared") return "商店未搬空";
    if (ev.shopStatus === "cleared") return "商店已搬空";
    return "无商店";
  }

  function typeLabel(ev) {
    return ev.type || "活动";
  }

  /**
   * Potion recommendation for the weekly batch that starts at `ws` (Monday 04:00).
   * The batch has 2 bottles x 120 sanity, and expires on `ws + 14 days` at 04:00.
   */
  function recommendPotion(wsValue, events) {
    const ws = parseLocal(wsValue);
    const expiry = addDays(ws, 14);
    const candidates = stageEvents(events)
      .filter((ev) => parseLocal(ev.end) > ws && parseLocal(ev.start) < expiry)
      .slice()
      .sort((a, b) => parseLocal(a.start) - parseLocal(b.start));

    const base = {
      weekStart: ws,
      weekEnd: addDays(ws, 7),
      expiry,
      bottles: 2,
      sanity: 240,
      candidates,
      current: null,
      next: null,
      target: null,
      date: null,
      timeLabel: "",
      mode: "none",
      reason: "",
      note: "",
    };

    if (!candidates.length) {
      base.reason = `本周到 ${fmtDateTime(expiry)} 之间没有可刷理智的活动；建议留到下一个活动，临近到期再用在资源收集。`;
      return base;
    }

    const current = candidates[0];
    const next =
      candidates.find((ev) => ev !== current && parseLocal(ev.end) > parseLocal(current.end)) ||
      candidates.find((ev) => ev !== current) ||
      null;

    base.current = current;
    base.next = next;

    let target = current;
    let mode = "current";
    if (current.shopStatus === "cleared" || current.shopStatus === "none") {
      if (next) {
        target = next;
        mode = "next";
      }
    }

    const date = mode === "current" ? latestUsableDay(target, ws, expiry) : firstUsableDay(target, ws, expiry);
    const startsOnDate = sameDay(parseLocal(target.start), date) && parseLocal(target.start).getHours() >= 4;
    const timeLabel = startsOnDate ? `${fmtTime(target.start)} 后` : "04:00 后";

    base.target = target;
    base.date = date;
    base.timeLabel = timeLabel;
    base.mode = mode;

    if (mode === "current") {
      if (next) {
        base.reason = `本周药程覆盖「${current.name}」和「${next.name}」。当前「${current.name}」商店未搬空，优先把 2 瓶（240 理智）用在当前活动；推荐 ${fmtMD(date)} ${timeLabel}，在活动结束前清商店。`;
        base.note = `规则 2：当前商店未搬空 → 优先当前；若已搬空 → 留给「${next.name}」。`;
      } else {
        base.reason = `本周药程只覆盖「${current.name}」，直接用在当前活动；推荐 ${fmtMD(date)} ${timeLabel}。`;
      }
    } else {
      base.reason = `「${current.name}」${current.shopStatus === "cleared" ? "商店已搬空" : "没有商店可搬"}，按规则把本周药留给下一个活动「${next.name}」；推荐 ${fmtMD(date)} ${timeLabel}。`;
      base.note = `规则 2：当前商店已搬空 → 已自动改为留给下一个活动「${next.name}」。`;
    }

    return base;
  }

  /**
   * Annihilation recommendation for the week starting at `ws` (Monday 04:00).
   * It avoids days with stage events unless the whole week is covered.
   */
  function recommendAnnihilation(wsValue, events) {
    const ws = parseLocal(wsValue);
    const days = weekDays(ws);
    const stage = stageEvents(events);
    const coverage = days.map((day) => {
      const active = stage.filter((ev) => overlapHours(ev, day) > 0);
      return {
        day,
        hours: unionCoverageHours(events, day),
        events: active,
      };
    });

    const free = coverage.filter((c) => c.hours < 1);
    // "完全覆盖一周" means there is essentially no usable gap on any day.
    const allCovered = coverage.every((c) => c.hours >= 23);
    let pick;
    let mode;

    if (free.length) {
      pick = free[0];
      mode = "free";
    } else if (allCovered) {
      pick = coverage[0];
      mode = "all";
    } else {
      pick = coverage
        .slice()
        .sort((a, b) => a.hours - b.hours || a.day - b.day)[0];
      mode = "min";
    }

    const base = {
      weekStart: ws,
      weekEnd: addDays(ws, 7),
      days,
      coverage,
      date: pick.day,
      mode,
      allCovered,
      freeDays: free.map((c) => c.day),
      reason: "",
      timeLabel: "",
      runs: 5,
      sanity: 125,
      orundum: 1800,
    };

    const dayLabel = `${fmtMD(pick.day)} ${WEEKDAYS[days.indexOf(pick.day)]}`;
    base.timeLabel = days.indexOf(pick.day) === 0 ? "周一 04:00 刷新后" : `${dayLabel} 04:00 后`;

    if (!stage.length) {
      base.reason = "本周无活动，周一 04:00 刷新后直接打满 5 次，把 1800 玉拿到上限。";
      return base;
    }

    if (mode === "all") {
      base.reason = "活动覆盖整周，任一天都会占用理智；建议周一 04:00 刷新后一次打完 5 次，后续专心活动。";
      return base;
    }

    if (mode === "free") {
      const before = stage
        .filter((ev) => parseLocal(ev.end) <= pick.day)
        .sort((a, b) => parseLocal(b.end) - parseLocal(a.end))[0];
      const after = stage
        .filter((ev) => parseLocal(ev.start) >= addDays(pick.day, 1))
        .sort((a, b) => parseLocal(a.start) - parseLocal(b.start))[0];

      if (before && sameDay(parseLocal(before.end), pick.day)) {
        base.reason = `「${before.name}」${fmtTime(before.end)} 结束后，${fmtMD(pick.day)} 是本周第一个无活动日；先打 5 次剿灭，避免和活动抢理智。`;
      } else if (before) {
        base.reason = `「${before.name}」已在 ${fmtMD(before.end)} 结束，${fmtMD(pick.day)} 是本周第一个无活动日；先打 5 次剿灭。`;
      } else if (after) {
        base.reason = `赶在「${after.name}」${fmtMD(after.start)} ${fmtTime(after.start)} 开启前，${fmtMD(pick.day)} 先打满 5 次。`;
      } else {
        base.reason = `${fmtMD(pick.day)} 是本周第一个无活动日，先打 5 次剿灭，把 1800 玉拿到上限。`;
      }
      return base;
    }

    base.reason = `本周没有完全无活动的日子，${fmtMD(pick.day)} 活动覆盖最少；建议在活动开始前或结束后打，减少和活动抢理智。`;
    return base;
  }

  function buildDayPlan(dayValue, events) {
    const day = parseLocal(dayValue);
    const ws = weekStart(day);
    const potion = recommendPotion(ws, events);
    const annih = recommendAnnihilation(ws, events);
    const dayEvents = eventsOnDay(events, day);
    const actions = [];

    if (potion.date && sameDay(potion.date, day)) {
      actions.push({
        icon: "药",
        tone: "green",
        text: `本周推荐用理智药：${potion.bottles} 瓶（${potion.sanity} 理智）`,
      });
    }
    if (annih.date && sameDay(annih.date, day)) {
      actions.push({
        icon: "剿",
        tone: "orange",
        text: `本周推荐剿灭日：${annih.runs} 次（约 ${annih.sanity} 理智）`,
      });
    }
    const stages = dayEvents.filter((ev) => ev.hasStages);
    if (stages.length) {
      actions.push({
        icon: "活",
        tone: "blue",
        text: `活动可刷：${stages.map((ev) => ev.name).join(" / ")}`,
      });
    }
    if (!actions.length) {
      actions.push({
        icon: "闲",
        tone: "muted",
        text: "今日无活动：刷资源 / 主线，理智药留到下一个活动",
      });
    }

    return { day, ws, potion, annih, dayEvents, actions };
  }

  function defaultEvents() {
    return [
      {
        id: "sample-yesterday-sea",
        name: "昨日海",
        start: "2026-10-09T12:00",
        end: "2026-10-23T03:59",
        type: "SideStory",
        hasStages: true,
        shopStatus: "uncleared",
        forecast: false,
        color: COLORS[0],
        note: "官方 SideStory，关卡 10/23 03:59 关闭，商店 10/30 03:59 关闭。",
      },
      {
        id: "sample-hengwang",
        name: "恒远津梁",
        start: "2026-10-16T16:00",
        end: "2026-10-30T03:59",
        type: "签到",
        hasStages: false,
        shopStatus: "none",
        forecast: false,
        color: COLORS[4],
        note: "国家图书馆联动签到，无活动关卡；累计签到 3 日。",
      },
      {
        id: "sample-thanks",
        name: "感谢庆典（示例）",
        start: "2026-11-01T04:00",
        end: "2026-11-15T03:59",
        type: "SideStory",
        hasStages: true,
        shopStatus: "uncleared",
        forecast: true,
        color: COLORS[1],
        note: "按 10/24 前瞻直播预测的示例活动；正式时间和商店以官方公告为准。",
      },
    ];
  }

  const api = {
    DAY,
    HOUR,
    WEEKDAYS,
    WEEKDAYS_SHORT,
    COLORS,
    pad,
    parseLocal,
    toInputValue,
    toDateInput,
    toTimeInput,
    toKey,
    fmtDate,
    fmtMD,
    fmtTime,
    fmtDateTime,
    fmtRange,
    sameDay,
    addDays,
    at4,
    weekStart,
    weekEnd,
    weekDays,
    dayWindow,
    overlapHours,
    overlapsDay,
    eventPhase,
    eventsOnDay,
    unionCoverageHours,
    monthGrid,
    monthRange,
    daysBetween,
    latestUsableDay,
    firstUsableDay,
    shopLabel,
    typeLabel,
    recommendPotion,
    recommendAnnihilation,
    buildDayPlan,
    defaultEvents,
  };

  global.CalendarCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
