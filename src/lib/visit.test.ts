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
  weekStart,
  rangeGrid,
  rangeLabel,
  exhibitionsOpenOn,
  rangeCalendar,
  lookupVenueGeo,
  buildPins,
  clusterPins,
  regionLabel,
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

const TODAY = "2026-10-28"; // 水曜。その週の日曜は 10-25

test("weekStart: 日曜はそのまま、他の曜日は直前の日曜、年跨ぎ", () => {
  assert.equal(weekStart("2026-10-25"), "2026-10-25");
  assert.equal(weekStart("2026-10-28"), "2026-10-25");
  assert.equal(weekStart("2026-10-31"), "2026-10-25");
  assert.equal(weekStart("2027-01-01"), "2026-12-27");
});

test("rangeGrid: 今日の週の日曜から6週42マス、今日より前は past", () => {
  const g = rangeGrid(TODAY, 0);
  assert.equal(g.length, 42);
  assert.equal(g[0].date, "2026-10-25");
  assert.equal(g[41].date, "2026-12-05");
  assert.deepEqual(g.slice(0, 4).map((c) => c.past), [true, true, true, false]);
  assert.equal(g.filter((c) => c.past).length, 3);
  assert.equal(g[3].date, TODAY);
});

test("rangeGrid: 月付き表示は各月1日と範囲の最初の非過去マス（今日）", () => {
  const g = rangeGrid(TODAY, 0);
  const marked = g.filter((c) => c.showMonth).map((c) => c.date);
  assert.deepEqual(marked, ["2026-10-28", "2026-11-01", "2026-12-01"]);
  // page 1 は先頭マス（日曜）に月付き
  const g1 = rangeGrid(TODAY, 1);
  assert.equal(g1[0].date, "2026-12-06");
  assert.equal(g1[0].showMonth, true);
  assert.equal(g1.filter((c) => c.past).length, 0);
  assert.deepEqual(g1.filter((c) => c.showMonth).map((c) => c.date), ["2026-12-06", "2027-01-01"]);
});

test("rangeGrid: 今日が日曜なら過去マスなし。page は負なら 0 扱い", () => {
  const g = rangeGrid("2026-10-25", 0);
  assert.equal(g[0].date, "2026-10-25");
  assert.equal(g.filter((c) => c.past).length, 0);
  assert.equal(rangeGrid("2026-10-25", -3)[0].date, "2026-10-25");
});

test("rangeLabel: 開始は今日（最初の範囲）、終わりは最後のマス", () => {
  assert.equal(rangeLabel(rangeGrid(TODAY, 0)), "10.28 — 12.05");
  assert.equal(rangeLabel(rangeGrid(TODAY, 1)), "12.06 — 01.16");
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

test("rangeCalendar: 各マスに開いている展覧会 ID。今日より前のマスは空（帯を切り詰める）", () => {
  const items = [
    ex({ id: "a", startDate: "2026-10-20", endDate: "2026-10-30" }), // 開始が過去
    ex({ id: "p", startDate: "2026-10-01", endDate: "2026-10-27" }), // 全部過去
  ];
  const cells = rangeCalendar(TODAY, 0, items);
  assert.equal(cells.length, 42);
  const byDate = new Map(cells.map((c) => [c.date, c]));
  assert.deepEqual(byDate.get("2026-10-25")!.ids, []);
  assert.deepEqual(byDate.get("2026-10-27")!.ids, []);
  assert.deepEqual(byDate.get("2026-10-28")!.ids, ["a"]);
  assert.deepEqual(byDate.get("2026-10-30")!.ids, ["a"]);
  assert.deepEqual(byDate.get("2026-10-31")!.ids, []);
  assert.ok(cells.every((c) => !c.ids.includes("p")));
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

// ---- カレンダー（名前入り横帯） ----
import { visitNo, weekSegments, endingOn } from "./visit";

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
  const days = rangeCalendar("2026-09-27", 0, items);
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
  const weeks = weekSegments(rangeCalendar("2026-09-27", 0, items), items);
  const w = weeks[1];
  const lane = (id: string) => w.find((s) => s.id === id)!.lane;
  assert.notEqual(lane("a"), lane("b"));
  assert.equal(lane("c"), lane("a")); // a が終わったあとは詰める
});

test("weekSegments: 開始列昇順で詰めるので X(列4-6) Y(列0-2) の入力順でも1段", () => {
  // 2026-10-11(日)〜10-17(土) の週
  const items = [
    { id: "x", startDate: "2026-10-15", endDate: "2026-10-17" },
    { id: "y", startDate: "2026-10-11", endDate: "2026-10-13" },
  ];
  const weeks = weekSegments(rangeCalendar("2026-09-27", 0, items), items);
  const w = weeks[2];
  assert.equal(w.length, 2);
  assert.equal(Math.max(...w.map((s) => s.lane)), 0);
});

test("weekSegments: 開始が過去の帯は今日のマスから始まり、左端は切れている(capLeft=false)", () => {
  const items = [ex({ id: "a", startDate: "2026-10-20", endDate: "2026-10-30" })];
  const weeks = weekSegments(rangeCalendar(TODAY, 0, items), items);
  const a = weeks[0].find((s) => s.id === "a")!;
  assert.deepEqual([a.col, a.span, a.capLeft, a.capRight], [3, 3, false, true]);
  assert.equal(weeks[1].length, 0);
  // 週をまたぐ場合も、今日で切れた左端は capLeft=false
  const long = [ex({ id: "b", startDate: "2026-10-20", endDate: "2026-11-04" })];
  const w2 = weekSegments(rangeCalendar(TODAY, 0, long), long);
  const b1 = w2[0].find((s) => s.id === "b")!;
  assert.deepEqual([b1.col, b1.span, b1.capLeft, b1.capRight], [3, 4, false, false]);
  const b2 = w2[1].find((s) => s.id === "b")!;
  assert.deepEqual([b2.col, b2.span, b2.capLeft, b2.capRight], [0, 4, false, true]);
});
