// scripts/lib/tuneup-exhibition.mjs の単体テスト（node:test）。
// 実行: node --test scripts/lib/tuneup-exhibition.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import {
  computeExhibitionStats,
  proposeExhibitionProfile,
  checkExhibitionProfileChange,
} from "./tuneup-exhibition.mjs";

const profile = () => JSON.parse(fs.readFileSync(new URL("../../data/exhibition-profile.json", import.meta.url), "utf-8"));

const it = (id, over = {}) => ({
  id, slug: id, title: id, artists: ["A"], venue: "V", venueType: "museum", prefecture: "東京都", score: 72,
  tags: ["media_art"], origin: "auto", ...over,
});

test("computeExhibitionStats: お気に入り=1・intake=2 の重みでタグ/会場種別/都道府県/score帯を集計", () => {
  const items = [
    it("a", { tags: ["media_art", "light"], score: 72 }),
    it("b", { tags: ["light"], origin: "intake", score: 85, prefecture: "大阪府", venueType: "alt_space" }),
    it("c", { tags: ["sound"], score: 61 }),
  ];
  const s = computeExhibitionStats({ favIds: ["a", "zzz-not-exhibition"], trashedIds: ["c"], items });
  assert.equal(s.favoriteCount, 1);
  assert.equal(s.intakeCount, 1);
  assert.equal(s.trashedCount, 1);
  assert.deepEqual(s.tags, { media_art: 1, light: 3 }); // a: 1 / b: 2
  assert.deepEqual(s.venueTypes, { museum: 1, alt_space: 2 });
  assert.deepEqual(s.prefectures, { 東京都: 1, 大阪府: 2 });
  assert.deepEqual(s.scoreBands, { "70-79": 1, "80-100": 2 });
  assert.equal(s.trashRate, 0.33);
});

test("proposeExhibitionProfile: intake 成功の作家・会場を watch に追加（既存は重複しない）", () => {
  const p = profile();
  const items = [it("n", { origin: "intake", artists: ["新作家", "真鍋大度"], venue: "新会場" })];
  const stats = computeExhibitionStats({ favIds: [], trashedIds: [], items });
  const next = proposeExhibitionProfile(p, stats, items);
  assert.ok(next.watch.artists.includes("新作家"));
  assert.equal(next.watch.artists.filter((a) => a === "真鍋大度").length, 1);
  assert.ok(next.watch.venues.includes("新会場"));
  assert.equal(p.watch.artists.includes("新作家"), false); // 入力は変更しない
});

test("proposeExhibitionProfile: ごみ箱率が高ければ threshold.add を +5（上限75）", () => {
  const p = profile();
  const items = [it("a"), ...["t1", "t2", "t3", "t4", "t5"].map((x) => it(x))];
  const stats = computeExhibitionStats({ favIds: ["a"], trashedIds: ["t1", "t2", "t3", "t4", "t5"], items });
  const next = proposeExhibitionProfile(p, stats, items);
  assert.equal(next.scoring.threshold.add, p.scoring.threshold.add + 5);
  assert.equal(next.exclusions.hard.length, p.exclusions.hard.length);
});

test("checkExhibitionProfileChange: 提案結果は許可される", () => {
  const p = profile();
  const items = [it("n", { origin: "intake", artists: ["新作家"], venue: "新会場" })];
  const next = proposeExhibitionProfile(p, computeExhibitionStats({ favIds: [], trashedIds: [], items }), items);
  const r = checkExhibitionProfileChange(p, next);
  assert.equal(r.ok, true, r.errors.join(","));
});

test("checkExhibitionProfileChange: exclusions.hard / collectAll の変更は拒否（自動変更禁止）", () => {
  const p = profile();
  const a = structuredClone(p);
  a.exclusions.hard.pop();
  assert.equal(checkExhibitionProfileChange(p, a).ok, false);
  const b = structuredClone(p);
  b.exclusions.collectAll.push("何か");
  assert.equal(checkExhibitionProfileChange(p, b).ok, false);
});

test("checkExhibitionProfileChange: 提案対象外（sources/seeds/components/highlight）の変更は拒否", () => {
  const p = profile();
  for (const mutate of [
    (x) => { x.sources.pop(); },
    (x) => { x.seeds.pop(); },
    (x) => { x.scoring.components[0].points = 99; },
    (x) => { x.scoring.threshold.highlight = 50; },
  ]) {
    const x = structuredClone(p);
    mutate(x);
    assert.equal(checkExhibitionProfileChange(p, x).ok, false);
  }
});

test("checkExhibitionProfileChange: threshold.add 範囲外・重み範囲外・多すぎる重み変更・watch 削除は拒否", () => {
  const p = profile();
  const a = structuredClone(p); a.scoring.threshold.add = 90;
  assert.equal(checkExhibitionProfileChange(p, a).ok, false);
  const b = structuredClone(p); b.likes.themes[0].weight = 9;
  assert.equal(checkExhibitionProfileChange(p, b).ok, false);
  const c = structuredClone(p); for (const t of c.likes.themes.slice(0, 4)) t.weight = t.weight === 1 ? 2 : t.weight - 1;
  assert.equal(checkExhibitionProfileChange(p, c).ok, false);
  const d = structuredClone(p); d.watch.artists.pop();
  assert.equal(checkExhibitionProfileChange(p, d).ok, false);
});
