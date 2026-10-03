// src/lib/exhibition.ts の単体テスト（SPEC §3.2 / §4 / §11）。
// 実行: npx tsx --test src/lib/exhibition.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeStatus,
  todayJst,
  daysBetween,
  isValidYmd,
  daysLeft,
  startsIn,
  sortExhibitions,
  visibleExhibitions,
  slugify,
  buildExhibitionId,
  exhibitionData,
  exhibitionItems,
  getExhibitionBySlug,
  type Exhibition,
} from "./exhibition";
import * as mjs from "../../scripts/lib/exhibition-status.mjs";
import * as slugMjs from "../../scripts/lib/exhibition-slug.mjs";

function ex(p: Partial<Exhibition> & { id: string; startDate: string; endDate: string }): Exhibition {
  return {
    id: p.id,
    slug: p.id,
    title: p.title ?? p.id,
    artists: [],
    venue: "v",
    venueType: "museum",
    prefecture: "東京都",
    city: "x",
    status: "ongoing",
    admission: "無料",
    tags: [],
    score: 70,
    matchReason: "r",
    sources: [{ name: "o", url: "https://example.com/", kind: "official" }],
    link: "https://example.com/",
    thumbnail: `/thumbnails/exhibition/${p.id}.jpg`,
    addedAt: "2026-10-04T00:00:00.000Z",
    origin: "auto",
    highlight: false,
    ...p,
  } as Exhibition;
}

test(".ts の computeStatus/todayJst/daysBetween/isValidYmd は .mjs と一致する", () => {
  const dates = ["2025-12-31", "2026-01-01", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-20", "2026-10-21", "2027-01-12"];
  for (const t of dates) {
    assert.equal(computeStatus("2026-10-04", "2026-10-20", t), mjs.computeStatus("2026-10-04", "2026-10-20", t));
    assert.equal(daysBetween(t, "2026-10-04"), mjs.daysBetween(t, "2026-10-04"));
  }
  for (const iso of ["2026-10-04T14:59:59Z", "2026-10-04T15:00:00Z", "2026-12-31T15:00:00Z"]) {
    assert.equal(todayJst(new Date(iso)), mjs.todayJst(new Date(iso)));
  }
  for (const s of ["2026-02-29", "2028-02-29", "x", "2026-10-04"]) {
    assert.equal(isValidYmd(s), mjs.isValidYmd(s));
  }
});

test("computeStatus (.ts): 境界", () => {
  assert.equal(computeStatus("2026-10-05", "2026-10-20", "2026-10-04"), "upcoming");
  assert.equal(computeStatus("2026-10-05", "2026-10-20", "2026-10-05"), "ongoing");
  assert.equal(computeStatus("2026-10-05", "2026-10-20", "2026-10-20"), "ongoing");
  assert.equal(computeStatus("2026-10-05", "2026-10-20", "2026-10-21"), "ended");
});

test("daysLeft / startsIn", () => {
  const e = ex({ id: "a", startDate: "2026-10-01", endDate: "2026-10-18" });
  assert.equal(daysLeft(e, "2026-10-04"), 14);
  assert.equal(daysLeft(e, "2026-10-18"), 0); // 本日まで
  const u = ex({ id: "b", startDate: "2026-10-17", endDate: "2026-10-25" });
  assert.equal(startsIn(u, "2026-10-04"), 13);
  assert.equal(startsIn(u, "2026-10-17"), 0);
});

test("sortExhibitions: ongoing→upcoming、ongoingはendDate昇順、upcomingはstartDate昇順", () => {
  const today = "2026-10-04";
  const items = [
    ex({ id: "up-late", startDate: "2026-11-01", endDate: "2026-12-01" }),
    ex({ id: "on-late", startDate: "2026-09-01", endDate: "2027-01-11" }),
    ex({ id: "up-soon", startDate: "2026-10-17", endDate: "2026-10-25" }),
    ex({ id: "on-soon", startDate: "2026-09-01", endDate: "2026-10-18" }),
  ];
  assert.deepEqual(sortExhibitions(items, today).map((e) => e.id), ["on-soon", "on-late", "up-soon", "up-late"]);
});

test("sortExhibitions: 同順位内で highlight が先頭、保存 status ではなく today で判定", () => {
  const today = "2026-10-04";
  const items = [
    ex({ id: "plain", startDate: "2026-09-01", endDate: "2026-10-18", status: "upcoming" }),
    ex({ id: "hl", startDate: "2026-09-02", endDate: "2026-10-18", highlight: true, score: 85 }),
    ex({ id: "earlier", startDate: "2026-09-01", endDate: "2026-10-10" }),
  ];
  // endDate昇順が優先。同endDate(10-18)内でhighlightが先頭
  assert.deepEqual(sortExhibitions(items, today).map((e) => e.id), ["earlier", "hl", "plain"]);
});

test("sortExhibitions: 入力配列を破壊しない", () => {
  const items = [
    ex({ id: "b", startDate: "2026-09-01", endDate: "2026-10-20" }),
    ex({ id: "a", startDate: "2026-09-01", endDate: "2026-10-10" }),
  ];
  sortExhibitions(items, "2026-10-04");
  assert.deepEqual(items.map((e) => e.id), ["b", "a"]);
});

test("visibleExhibitions: today で再計算して ended を除外し status を更新する", () => {
  const items = [
    ex({ id: "stale-ongoing", startDate: "2026-09-01", endDate: "2026-10-03", status: "ongoing" }),
    ex({ id: "now-ongoing", startDate: "2026-10-04", endDate: "2026-10-20", status: "upcoming" }),
    ex({ id: "still-up", startDate: "2026-10-17", endDate: "2026-10-25", status: "upcoming" }),
    ex({ id: "last-day", startDate: "2026-09-01", endDate: "2026-10-04", status: "ongoing" }),
  ];
  const v = visibleExhibitions(items, "2026-10-04");
  assert.deepEqual(v.map((e) => e.id).sort(), ["last-day", "now-ongoing", "still-up"]);
  assert.equal(v.find((e) => e.id === "now-ongoing")?.status, "ongoing");
  assert.equal(v.find((e) => e.id === "still-up")?.status, "upcoming");
});

test("slugify: ASCII 小文字ハイフン区切り、日本語のみは空文字", () => {
  assert.equal(slugify("Machines of Loving Grace"), "machines-of-loving-grace");
  assert.equal(slugify("  A--B__C!! "), "a-b-c");
  assert.equal(slugify("Café Ünï"), "cafe-uni");
  assert.equal(slugify("自己破壊芸術展"), "");
  assert.equal(slugify("田中義久 ARCHIVE / ACHIEVE"), "archive-achieve");
});

test("buildExhibitionId: {startYear}-{venue}-{title}、パターン適合・100字以内", () => {
  const id = buildExhibitionId({ startDate: "2026-10-02", venue: "Maruka 3F", title: "Auto-Destructive Art" });
  assert.equal(id, "2026-maruka-3f-auto-destructive-art");
  assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test("buildExhibitionId: 長い場合は60字目安で切り詰め（末尾ハイフン無し）", () => {
  const id = buildExhibitionId({
    startDate: "2026-10-02",
    venue: "Very Long Venue Name Museum Of Contemporary Art",
    title: "An Extremely Long Exhibition Title That Goes On And On Forever",
  });
  assert.ok(id.length <= 60, `len=${id.length}`);
  assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(id.startsWith("2026-"));
});

test("buildExhibitionId: 衝突時は -2, -3", () => {
  const input = { startDate: "2026-10-02", venue: "Maruka", title: "Show" };
  const a = buildExhibitionId(input, []);
  assert.equal(a, "2026-maruka-show");
  const b = buildExhibitionId(input, [a]);
  assert.equal(b, "2026-maruka-show-2");
  const c = buildExhibitionId(input, new Set([a, b]));
  assert.equal(c, "2026-maruka-show-3");
});

test("buildExhibitionId: 日本語のみのタイトル/会場でもパターン適合・決定的・別展は別ID", () => {
  const a = buildExhibitionId({ startDate: "2026-08-29", venue: "東京都現代美術館", title: "多田美波 ― 光、凛と ゆれる" });
  const a2 = buildExhibitionId({ startDate: "2026-08-29", venue: "東京都現代美術館", title: "多田美波 ― 光、凛と ゆれる" });
  const b = buildExhibitionId({ startDate: "2026-08-29", venue: "東京都現代美術館", title: "別の展覧会" });
  assert.equal(a, a2);
  assert.notEqual(a, b);
  assert.match(a, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(a.startsWith("2026-"));
  assert.ok(a.length <= 100);
});

test("slug 関数は .mjs と一致する", () => {
  const inp = { startDate: "2026-10-02", venue: "Maruka 3F", title: "Show 展" };
  assert.equal(buildExhibitionId(inp, ["x"]), slugMjs.buildExhibitionId(inp, ["x"]));
  assert.equal(slugify("A b"), slugMjs.slugify("A b"));
});

test("データ読み込み: exhibition.json の version/statusAsOf と items", () => {
  assert.equal(exhibitionData.version, 1);
  assert.match(exhibitionData.statusAsOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Array.isArray(exhibitionItems));
  assert.equal(getExhibitionBySlug("__none__"), undefined);
});
