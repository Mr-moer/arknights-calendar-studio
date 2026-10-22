const assert = require("assert");
const C = require("../calendar-core.js");

function ev(overrides) {
  return Object.assign(
    {
      id: "x",
      name: "活动",
      start: "2026-10-09T12:00",
      end: "2026-10-23T03:59",
      type: "SideStory",
      hasStages: true,
      shopStatus: "uncleared",
      forecast: false,
      color: "#58b7e8",
    },
    overrides
  );
}

function ymd(d) {
  return C.toKey(d);
}

// week boundaries: Monday 04:00
assert.strictEqual(ymd(C.weekStart("2026-10-22T09:00")), "2026-10-19");
assert.strictEqual(C.fmtTime(C.weekStart("2026-10-22T09:00")), "04:00");
assert.strictEqual(ymd(C.weekStart("2026-10-25T23:00")), "2026-10-19");
assert.strictEqual(ymd(C.weekStart("2026-10-26T03:00")), "2026-10-19");
assert.strictEqual(ymd(C.weekStart("2026-10-26T04:00")), "2026-10-26");

// dynamic month grid: Oct 2026 is 5 rows, Nov 2026 is 6 rows
assert.strictEqual(C.monthGrid(2026, 9).length, 35);
assert.strictEqual(C.monthGrid(2026, 10).length, 42);

const events = [
  ev({ id: "sea", name: "昨日海", start: "2026-10-09T12:00", end: "2026-10-23T03:59" }),
  ev({
    id: "lib",
    name: "恒远津梁",
    start: "2026-10-16T16:00",
    end: "2026-10-30T03:59",
    type: "签到",
    hasStages: false,
    shopStatus: "none",
  }),
  ev({
    id: "thanks",
    name: "感谢庆典",
    start: "2026-11-01T04:00",
    end: "2026-11-15T03:59",
    shopStatus: "uncleared",
  }),
];

// potion week 10/19: current event uncleared -> use on current, last usable day 10/22
{
  const r = C.recommendPotion("2026-10-19T04:00", events);
  assert.strictEqual(r.mode, "current");
  assert.strictEqual(r.current.name, "昨日海");
  assert.strictEqual(r.next.name, "感谢庆典");
  assert.strictEqual(ymd(r.date), "2026-10-22");
  assert.ok(r.reason.includes("昨日海"));
  assert.ok(r.note.includes("规则 2"));
  assert.strictEqual(ymd(r.expiry), "2026-11-02");
  console.log("potion current:", ymd(r.date), r.mode);
}

// potion week 10/19: current shop cleared -> save for next 11/01
{
  const cleared = events.map((x) => (x.id === "sea" ? { ...x, shopStatus: "cleared" } : x));
  const r = C.recommendPotion("2026-10-19T04:00", cleared);
  assert.strictEqual(r.mode, "next");
  assert.strictEqual(r.target.name, "感谢庆典");
  assert.strictEqual(ymd(r.date), "2026-11-01");
  assert.ok(r.reason.includes("留给下一个活动"));
  console.log("potion next:", ymd(r.date), r.mode);
}

// annihilation week 10/19: event ends Friday 03:59 -> Friday is first free day
{
  const r = C.recommendAnnihilation("2026-10-19T04:00", events);
  assert.strictEqual(r.mode, "free");
  assert.strictEqual(ymd(r.date), "2026-10-23");
  assert.ok(r.reason.includes("昨日海"));
  console.log("annihilation free:", ymd(r.date), r.mode);
}

// annihilation week 10/26: no stage event -> Monday
{
  const r = C.recommendAnnihilation("2026-10-26T04:00", events);
  assert.strictEqual(r.mode, "free");
  assert.strictEqual(ymd(r.date), "2026-10-26");
  console.log("annihilation empty week:", ymd(r.date), r.mode);
}

// annihilation week 11/02: event covers whole week -> any day, Monday
{
  const r = C.recommendAnnihilation("2026-11-02T04:00", events);
  assert.strictEqual(r.mode, "all");
  assert.strictEqual(ymd(r.date), "2026-11-02");
  assert.strictEqual(r.allCovered, true);
  console.log("annihilation full week:", ymd(r.date), r.mode);
}

// potion week 10/26: event starts 11/01, expiry 11/09 -> use inside event
{
  const r = C.recommendPotion("2026-10-26T04:00", events);
  assert.strictEqual(r.mode, "current");
  assert.strictEqual(r.current.name, "感谢庆典");
  assert.strictEqual(ymd(r.date), "2026-11-08");
  console.log("potion week 10/26:", ymd(r.date), r.mode);
}

// day plan on 10/22 includes potion + event
{
  const p = C.buildDayPlan("2026-10-22T12:00", events);
  assert.ok(p.actions.some((a) => a.icon === "药"));
  assert.ok(p.actions.some((a) => a.icon === "活"));
  assert.strictEqual(ymd(p.potion.date), "2026-10-22");
}

console.log("all core tests passed");
