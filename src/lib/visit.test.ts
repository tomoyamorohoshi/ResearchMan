// src/lib/visit.ts の単体テスト（docs/EXHIBITION_VISIT_SPEC.md §5）。
// 実行: npx tsx --test src/lib/visit.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  remainingDays,
  isEndingSoon,
  isEnded,
  isUpcoming,
  badgeFor,
  deriveVisit,
  computeBarRange,
  barLayout,
  todayLinePosition,
  monthGrid,
  shiftMonth,
  exhibitionsOpenOn,
  monthCalendar,
  lookupVenueGeo,
  buildPins,
  clusterPins,
  regionLabel,
  MAX_RANGE_DAYS,
  todayJst,
  type VenueGeo,
} from "./visit";
import type { Exhibition } from "./exhibition";

function ex(p: Partial<Exhibition> & { id: string; startDate: string; endDate: string }): Exhibition {
  return {
    slug: p.id,
    title: p.title ?? p.id,
    artists: [],
    venue: "v",
    venueType: "museum",
    prefecture: "東京都",
    city: "港区",
    status: "ongoing",
    admission: "",
    tags: [],
    score: 0,
    matchReason: "",
    sources: [],
    link: "",
    thumbnail: "",
    addedAt: "2026-01-01",
    origin: "auto",
    highlight: false,
    ...p,
  };
}

const T = "2026-10-24";

test("addDays: 月・年跨ぎ", () => {
  assert.equal(addDays("2026-10-24", -7), "2026-10-17");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("todayJst は再エクスポート: UTC 15:00 で日付が変わる", () => {
  assert.equal(todayJst(new Date("2026-10-23T14:59:59Z")), "2026-10-23");
  assert.equal(todayJst(new Date("2026-10-23T15:00:00Z")), "2026-10-24");
});

test("remainingDays: 当日=0、翌日=1、終了済みは負", () => {
  assert.equal(remainingDays(ex({ id: "a", startDate: "2026-10-01", endDate: T }), T), 0);
  assert.equal(remainingDays(ex({ id: "a", startDate: "2026-10-01", endDate: "2026-10-25" }), T), 1);
  assert.equal(remainingDays(ex({ id: "a", startDate: "2026-10-01", endDate: "2026-10-23" }), T), -1);
});

test("isEndingSoon: 0〜7日は真、8日は偽、終了済みと開催前は偽", () => {
  const e = (end: string, start = "2026-09-01") => ex({ id: "a", startDate: start, endDate: end });
  assert.equal(isEndingSoon(e("2026-10-24"), T), true);
  assert.equal(isEndingSoon(e("2026-10-31"), T), true);
  assert.equal(isEndingSoon(e("2026-11-01"), T), false);
  assert.equal(isEndingSoon(e("2026-10-23"), T), false);
  // 開催前は対象外（仮定）
  assert.equal(isEndingSoon(e("2026-10-30", "2026-10-28"), T), false);
});

test("isEnded / isUpcoming", () => {
  assert.equal(isEnded(ex({ id: "a", startDate: "2026-09-01", endDate: "2026-10-23" }), T), true);
  assert.equal(isEnded(ex({ id: "a", startDate: "2026-09-01", endDate: T }), T), false);
  assert.equal(isUpcoming(ex({ id: "a", startDate: "2026-10-25", endDate: "2026-11-30" }), T), true);
  assert.equal(isUpcoming(ex({ id: "a", startDate: T, endDate: "2026-11-30" }), T), false);
});

test("badgeFor: 今日まで / あと N 日 / M/D から / なし", () => {
  assert.deepEqual(badgeFor(ex({ id: "a", startDate: "2026-09-01", endDate: T }), T), {
    kind: "urgent",
    label: "今日まで",
  });
  assert.deepEqual(badgeFor(ex({ id: "a", startDate: "2026-09-01", endDate: "2026-10-31" }), T), {
    kind: "urgent",
    label: "あと 7 日",
  });
  assert.deepEqual(badgeFor(ex({ id: "a", startDate: "2026-09-01", endDate: "2026-10-25" }), T), {
    kind: "urgent",
    label: "あと 1 日",
  });
  assert.equal(badgeFor(ex({ id: "a", startDate: "2026-09-01", endDate: "2026-11-01" }), T), null);
  assert.deepEqual(badgeFor(ex({ id: "a", startDate: "2026-11-05", endDate: "2026-12-01" }), T), {
    kind: "upcoming",
    label: "11/5 から",
  });
  assert.deepEqual(badgeFor(ex({ id: "a", startDate: "2027-01-09", endDate: "2027-02-01" }), T), {
    kind: "upcoming",
    label: "1/9 から",
  });
  assert.equal(badgeFor(ex({ id: "a", startDate: "2026-09-01", endDate: "2026-10-01" }), T), null);
});

test("deriveVisit: 行きたいのみ・トラッシュ除外・終了済み分離・並び順", () => {
  const items = [
    ex({ id: "far", title: "far", startDate: "2026-10-01", endDate: "2026-12-01" }),
    ex({ id: "soon", title: "soon", startDate: "2026-10-01", endDate: "2026-10-27" }),
    ex({ id: "mid", title: "mid", startDate: "2026-10-01", endDate: "2026-11-15" }),
    ex({ id: "today", title: "today", startDate: "2026-10-01", endDate: T }),
    ex({ id: "up", title: "up", startDate: "2026-11-01", endDate: "2026-11-10" }),
    ex({ id: "old", title: "old", startDate: "2026-09-01", endDate: "2026-10-20" }),
    ex({ id: "older", title: "older", startDate: "2026-08-01", endDate: "2026-10-10" }),
    ex({ id: "trash", startDate: "2026-10-01", endDate: "2026-10-26" }),
    ex({ id: "notwant", startDate: "2026-10-01", endDate: "2026-10-26" }),
  ];
  const want = new Set(["far", "soon", "mid", "today", "up", "old", "older", "trash"]);
  const trash = new Set(["trash"]);
  const r = deriveVisit(items, want, trash, T);
  assert.deepEqual(
    r.active.map((e) => e.id),
    ["today", "soon", "up", "mid", "far"],
  );
  // ended は終了日の新しい順
  assert.deepEqual(
    r.ended.map((e) => e.id),
    ["old", "older"],
  );
});

test("deriveVisit: 終了間近が先頭、その後は終了日昇順。同日は開始日→title", () => {
  const items = [
    ex({ id: "b", title: "b", startDate: "2026-10-05", endDate: "2026-11-20" }),
    ex({ id: "a2", title: "b", startDate: "2026-10-01", endDate: "2026-11-20" }),
    ex({ id: "a1", title: "a", startDate: "2026-10-05", endDate: "2026-11-20" }),
    ex({ id: "u", title: "u", startDate: "2026-10-01", endDate: "2026-10-30" }),
  ];
  const r = deriveVisit(items, new Set(items.map((i) => i.id)), new Set(), T);
  assert.deepEqual(
    r.active.map((e) => e.id),
    ["u", "a2", "a1", "b"],
  );
});

test("deriveVisit: 空入力", () => {
  assert.deepEqual(deriveVisit([], new Set(), new Set(), T), { active: [], ended: [] });
});

test("computeBarRange: start=今日-7、end=最も遅い終了日", () => {
  const active = [
    ex({ id: "a", startDate: "2026-10-01", endDate: "2026-11-10" }),
    ex({ id: "b", startDate: "2026-10-01", endDate: "2026-12-01" }),
  ];
  const r = computeBarRange(active, T);
  assert.equal(r.start, "2026-10-17");
  assert.equal(r.end, "2026-12-01");
  assert.equal(r.days, 46);
  assert.equal(r.clipped, false);
});

test("computeBarRange: 最大6か月(183日)でクリップ", () => {
  const active = [ex({ id: "a", startDate: "2026-10-01", endDate: "2028-01-01" })];
  const r = computeBarRange(active, T);
  assert.equal(r.start, "2026-10-17");
  assert.equal(r.end, addDays("2026-10-17", MAX_RANGE_DAYS - 1));
  assert.equal(r.days, MAX_RANGE_DAYS);
  assert.equal(r.clipped, true);
});

test("computeBarRange: active 0件は今日-7〜今日+30日の既定範囲", () => {
  const r = computeBarRange([], T);
  assert.equal(r.start, "2026-10-17");
  assert.equal(r.end, "2026-11-23");
  assert.equal(r.days, 38);
});

test("barLayout: 範囲内・左右クリップ・完全範囲外", () => {
  const range = computeBarRange([ex({ id: "z", startDate: "2026-10-01", endDate: "2026-11-25" })], T);
  // start 10-17, end 11-25 => 40日
  assert.equal(range.days, 40);
  const inside = barLayout(ex({ id: "a", startDate: "2026-10-27", endDate: "2026-11-05" }), range);
  assert.equal(inside.visible, true);
  assert.equal(inside.leftDays, 10);
  assert.equal(inside.widthDays, 10);
  assert.equal(inside.left, 10 / 40);
  assert.equal(inside.width, 10 / 40);
  const clippedL = barLayout(ex({ id: "a", startDate: "2026-09-01", endDate: "2026-10-20" }), range);
  assert.equal(clippedL.visible, true);
  assert.equal(clippedL.left, 0);
  assert.equal(clippedL.widthDays, 4);
  const clippedR = barLayout(ex({ id: "a", startDate: "2026-11-20", endDate: "2027-03-01" }), range);
  assert.equal(clippedR.visible, true);
  assert.equal(clippedR.leftDays, 34);
  assert.equal(clippedR.widthDays, 6);
  assert.equal(clippedR.left + clippedR.width, 1);
  const before = barLayout(ex({ id: "a", startDate: "2026-09-01", endDate: "2026-10-16" }), range);
  assert.equal(before.visible, false);
  const after = barLayout(ex({ id: "a", startDate: "2026-11-26", endDate: "2026-12-30" }), range);
  assert.equal(after.visible, false);
});

test("barLayout: 6か月上限で後半の展覧会は範囲外", () => {
  const range = computeBarRange([ex({ id: "z", startDate: "2026-10-01", endDate: "2028-01-01" })], T);
  const late = barLayout(ex({ id: "a", startDate: "2027-06-01", endDate: "2027-07-01" }), range);
  assert.equal(late.visible, false);
});

test("todayLinePosition: 今日の列の中心", () => {
  const range = computeBarRange([ex({ id: "z", startDate: "2026-10-01", endDate: "2026-11-25" })], T);
  assert.equal(todayLinePosition(range, T), 7.5 / 40);
});

test("monthGrid: 2026-10 は 6週42マス、日曜始まり、前後埋め草", () => {
  const g = monthGrid(2026, 10);
  assert.equal(g.length, 42);
  // 2026-10-01 は木曜 → 日曜始まりなので 9/27 から
  assert.equal(g[0].date, "2026-09-27");
  assert.equal(g[0].inMonth, false);
  assert.equal(g[4].date, "2026-10-01");
  assert.equal(g[4].inMonth, true);
  assert.equal(g[34].date, "2026-10-31");
  assert.equal(g[34].inMonth, true);
  assert.equal(g[35].inMonth, false);
  assert.equal(g[41].date, "2026-11-07");
  assert.equal(g.filter((c) => c.inMonth).length, 31);
});

test("monthGrid: 年跨ぎ（2027-01 は 12/27 始まり）と日曜1日の月", () => {
  const g = monthGrid(2027, 1);
  assert.equal(g[0].date, "2026-12-27");
  assert.equal(g[0].inMonth, false);
  assert.equal(g[5].date, "2027-01-01");
  // 2026-02-01 は日曜
  const f = monthGrid(2026, 2);
  assert.equal(f[0].date, "2026-02-01");
  assert.equal(f[0].inMonth, true);
});

test("shiftMonth: 年跨ぎ", () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 10, 14), { year: 2027, month: 12 });
});

test("exhibitionsOpenOn: 境界を含む", () => {
  const items = [
    ex({ id: "a", startDate: "2026-10-10", endDate: "2026-10-20" }),
    ex({ id: "b", startDate: "2026-10-20", endDate: "2026-10-25" }),
  ];
  assert.deepEqual(exhibitionsOpenOn(items, "2026-10-09").map((e) => e.id), []);
  assert.deepEqual(exhibitionsOpenOn(items, "2026-10-10").map((e) => e.id), ["a"]);
  assert.deepEqual(exhibitionsOpenOn(items, "2026-10-20").map((e) => e.id), ["a", "b"]);
  assert.deepEqual(exhibitionsOpenOn(items, "2026-10-21").map((e) => e.id), ["b"]);
  assert.deepEqual(exhibitionsOpenOn(items, "2026-10-26").map((e) => e.id), []);
});

test("monthCalendar: 各マスに開いている展覧会 ID", () => {
  const items = [ex({ id: "a", startDate: "2026-09-29", endDate: "2026-10-02" })];
  const cells = monthCalendar(2026, 10, items);
  assert.equal(cells.length, 42);
  const byDate = new Map(cells.map((c) => [c.date, c]));
  assert.deepEqual(byDate.get("2026-09-28")!.ids, []);
  assert.deepEqual(byDate.get("2026-09-29")!.ids, ["a"]); // 前月の埋め草マスにも出る
  assert.equal(byDate.get("2026-09-29")!.inMonth, false);
  assert.deepEqual(byDate.get("2026-10-02")!.ids, ["a"]);
  assert.deepEqual(byDate.get("2026-10-03")!.ids, []);
});

const geo: VenueGeo = {
  version: 1,
  venues: {
    森美術館: { lat: 35.66, lng: 139.72, source: "nominatim", query: "q", checkedAt: "2026-10-24" },
    A: { lat: 1, lng: 2, source: "manual", query: "q", checkedAt: "2026-10-24" },
  },
};

test("lookupVenueGeo: 前後空白のみトリム、あいまい一致なし", () => {
  assert.equal(lookupVenueGeo(geo, "森美術館")?.lat, 35.66);
  assert.equal(lookupVenueGeo(geo, "  森美術館\n")?.lat, 35.66);
  assert.equal(lookupVenueGeo(geo, "森美術館 六本木"), undefined);
  assert.equal(lookupVenueGeo(geo, "未登録"), undefined);
  assert.equal(lookupVenueGeo(geo, "toString"), undefined);
  assert.equal(lookupVenueGeo(geo, "__proto__"), undefined);
});

test("buildPins: 同一会場は1ピンに束ね、座標なしは unlocated、urgent は any", () => {
  const items = [
    ex({ id: "1", venue: "森美術館", startDate: "2026-10-01", endDate: "2026-12-01" }),
    ex({ id: "2", venue: " 森美術館 ", startDate: "2026-10-01", endDate: "2026-10-26" }),
    ex({ id: "3", venue: "A", startDate: "2026-10-01", endDate: "2026-12-01" }),
    ex({ id: "4", venue: "どこか", startDate: "2026-10-01", endDate: "2026-12-01" }),
  ];
  const { pins, unlocated } = buildPins(items, geo, T);
  assert.equal(pins.length, 2);
  const mori = pins.find((p) => p.venue === "森美術館")!;
  assert.deepEqual(mori.items.map((e) => e.id), ["1", "2"]);
  assert.equal(mori.urgent, true);
  assert.equal(mori.lat, 35.66);
  assert.equal(mori.lng, 139.72);
  const a = pins.find((p) => p.venue === "A")!;
  assert.equal(a.urgent, false);
  assert.deepEqual(unlocated.map((e) => e.id), ["4"]);
});

test("buildPins: 空入力", () => {
  assert.deepEqual(buildPins([], geo, T), { pins: [], unlocated: [] });
});

const geo2: VenueGeo = {
  version: 1,
  venues: {
    MOT: { lat: 35.6797754, lng: 139.8087878, source: "nominatim", query: "q", checkedAt: "2026-10-24" },
    "MOT コレクション": { lat: 35.6797754, lng: 139.8087878, source: "nominatim", query: "q", checkedAt: "2026-10-24" },
    近い: { lat: 35.6799, lng: 139.8089, source: "nominatim", query: "q", checkedAt: "2026-10-24" }, // 約 20m
    遠い: { lat: 35.6820, lng: 139.8087878, source: "nominatim", query: "q", checkedAt: "2026-10-24" }, // 約 250m
    YCAM: { lat: 34.1695, lng: 131.4672, source: "nominatim", query: "q", checkedAt: "2026-10-24" },
    森: { lat: 35.6604, lng: 139.7292, source: "nominatim", query: "q", checkedAt: "2026-10-24" },
  },
};

test("buildPins: 会場名が違っても同一座標・数十m以内は1ピンに束ねる（遠いものは別）", () => {
  const items = [
    ex({ id: "1", venue: "MOT", startDate: "2026-10-01", endDate: "2026-12-01" }),
    ex({ id: "2", venue: "MOT コレクション", startDate: "2026-10-01", endDate: "2026-12-01" }),
    ex({ id: "3", venue: "近い", startDate: "2026-10-01", endDate: "2026-12-01" }),
    ex({ id: "4", venue: "遠い", startDate: "2026-10-01", endDate: "2026-12-01" }),
  ];
  const { pins } = buildPins(items, geo2, T);
  assert.equal(pins.length, 2);
  assert.deepEqual(pins[0].items.map((e) => e.id), ["1", "2", "3"]);
  assert.equal(pins[0].venue, "MOT");
  assert.deepEqual(pins[1].items.map((e) => e.id), ["4"]);
});

test("regionLabel: 都府県の接尾辞を外す、北海道はそのまま", () => {
  assert.equal(regionLabel("東京都"), "東京");
  assert.equal(regionLabel("京都府"), "京都");
  assert.equal(regionLabel("山口県"), "山口");
  assert.equal(regionLabel("北海道"), "北海道");
});

test("clusterPins: 50km 以内で連結、件数の多い順、ラベルは多数派の都道府県", () => {
  const items = [
    ex({ id: "1", venue: "MOT", startDate: "2026-10-01", endDate: "2026-12-01" }),
    ex({ id: "2", venue: "森", startDate: "2026-10-01", endDate: "2026-12-01" }),
    ex({ id: "3", venue: "森", startDate: "2026-10-01", endDate: "2026-12-01" }),
    ex({ id: "4", venue: "YCAM", prefecture: "山口県", startDate: "2026-10-01", endDate: "2026-12-01" }),
  ];
  const { pins } = buildPins(items, geo2, T);
  const cl = clusterPins(pins, 50);
  assert.equal(cl.length, 2);
  assert.equal(cl[0].label, "東京");
  assert.equal(cl[0].count, 3);
  assert.equal(cl[0].pins.length, 2);
  assert.equal(cl[1].label, "山口");
  assert.equal(cl[1].count, 1);
  assert.deepEqual(clusterPins([], 50), []);
});

// ---- カレンダー案 (?cal=) ----
import { parseCalStyle, visitNo, weekSegments, endingOn } from "./visit";

test("parseCalStyle: 不正値・無しは lines、count/bands はそのまま", () => {
  assert.equal(parseCalStyle(undefined), "lines");
  assert.equal(parseCalStyle("zzz"), "lines");
  assert.equal(parseCalStyle(["count"]), "lines");
  assert.equal(parseCalStyle("count"), "count");
  assert.equal(parseCalStyle("bands"), "bands");
});

test("visitNo: 1始まり2桁", () => {
  assert.equal(visitNo(0), "01");
  assert.equal(visitNo(11), "12");
});

test("endingOn: その日が終了日の展示 id", () => {
  const items = [
    { id: "a", startDate: "2026-10-01", endDate: "2026-10-10" },
    { id: "b", startDate: "2026-10-01", endDate: "2026-10-11" },
  ];
  assert.deepEqual(endingOn(items, "2026-10-10"), ["a"]);
  assert.deepEqual(endingOn(items, "2026-10-09"), []);
});

test("weekSegments: 週をまたぐ帯を週ごとに分割し、端の連続を示す", () => {
  // 2026-10 は 10/1(木) 始まり。グリッドは 9/27(日) から
  const items = [
    { id: "a", startDate: "2026-10-02", endDate: "2026-10-06" }, // 金〜火（週1→週2）
    { id: "b", startDate: "2026-10-03", endDate: "2026-10-03" },
  ];
  const days = monthCalendar(2026, 10, items);
  const weeks = weekSegments(days, items);
  assert.equal(weeks.length, 6);
  const a1 = weeks[0].find((s) => s.id === "a")!;
  assert.deepEqual([a1.col, a1.span, a1.capLeft, a1.capRight], [5, 2, true, false]);
  const a2 = weeks[1].find((s) => s.id === "a")!;
  assert.deepEqual([a2.col, a2.span, a2.capLeft, a2.capRight], [0, 3, false, true]);
  const b = weeks[0].find((s) => s.id === "b")!;
  assert.equal(b.col, 6);
  assert.notEqual(a1.lane, b.lane); // 同じ列(土)で重なるので別段
});

test("weekSegments: 重なる帯は別レーン", () => {
  const items = [
    { id: "a", startDate: "2026-10-05", endDate: "2026-10-08" },
    { id: "b", startDate: "2026-10-06", endDate: "2026-10-07" },
    { id: "c", startDate: "2026-10-09", endDate: "2026-10-09" },
  ];
  const weeks = weekSegments(monthCalendar(2026, 10, items), items);
  const w = weeks[1];
  const lane = (id: string) => w.find((s) => s.id === id)!.lane;
  assert.notEqual(lane("a"), lane("b"));
  assert.equal(lane("c"), lane("a")); // a が終わったあとは詰める
});
