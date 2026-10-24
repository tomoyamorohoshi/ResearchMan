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

// 本番データの likes.userPicks 系は今後増えても前提が崩れないよう取り除いた状態を土台にする。
const profile = () => {
  const p = JSON.parse(fs.readFileSync(new URL("../../data/exhibition-profile.json", import.meta.url), "utf-8"));
  if (p.likes) { delete p.likes.userPicks; delete p.likes.userPicksEvidenceSince; }
  return p;
};

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

// ── userPicks 印付きごみ箱率 ──
const withPicks = (n) => {
  const p = profile();
  p.likes.userPicks = Array.from({ length: n }, (_, i) => ({ title: `P${i}`, venue: "V", tags: [], why: "w", addedAt: `2026-10-0${i + 1}T00:00:00.000Z` }));
  return p;
};
const boosted = (id) => it(id, { boostedBy: "userPick", score: 62 });

test("computeExhibitionStats: 印付き件数・ごみ箱件数・ごみ箱率", () => {
  const items = [boosted("b1"), boosted("b2"), boosted("b3"), boosted("b4"), it("n")];
  const s = computeExhibitionStats({ favIds: [], trashedIds: ["b1", "b2", "n"], items });
  assert.deepEqual(s.boosted, { count: 4, trashed: 2, trashRate: 0.5 });
  assert.deepEqual(computeExhibitionStats({ favIds: [], trashedIds: [], items: [it("x")] }).boosted, { count: 0, trashed: 0, trashRate: 0 });
});

test("proposeExhibitionProfile: 印付き3件以上かつごみ箱率50%以上なら最古の userPick を1件外す", () => {
  const p = withPicks(3);
  const items = [boosted("b1"), boosted("b2"), boosted("b3")];
  const stats = computeExhibitionStats({ favIds: [], trashedIds: ["b1", "b2"], items });
  const next = proposeExhibitionProfile(p, stats, items);
  assert.deepEqual(next.likes.userPicks.map((x) => x.title), ["P1", "P2"]);
  assert.equal(p.likes.userPicks.length, 3);
  assert.equal(checkExhibitionProfileChange(p, next).ok, true);
});

test("proposeExhibitionProfile: 条件未満（2件 / 率49%）や userPicks 無しでは外さない", () => {
  const p = withPicks(3);
  const two = [boosted("b1"), boosted("b2")];
  assert.equal(proposeExhibitionProfile(p, computeExhibitionStats({ favIds: [], trashedIds: ["b1", "b2"], items: two }), two).likes.userPicks.length, 3);
  const four = [boosted("b1"), boosted("b2"), boosted("b3"), boosted("b4"), boosted("b5"), boosted("b6"), boosted("b7")];
  const s7 = computeExhibitionStats({ favIds: [], trashedIds: ["b1", "b2", "b3"], items: four }); // 3/7=0.43
  assert.equal(proposeExhibitionProfile(p, s7, four).likes.userPicks.length, 3);
  const none = profile();
  const three = [boosted("b1"), boosted("b2"), boosted("b3")];
  const sN = computeExhibitionStats({ favIds: [], trashedIds: ["b1", "b2", "b3"], items: three });
  assert.equal(proposeExhibitionProfile(none, sN, three).likes.userPicks, undefined);
});

test("checkExhibitionProfileChange: userPicks は削除1件・追加3件・上限10件まで許可。内容改変は拒否", () => {
  const p = withPicks(5);
  const del2 = structuredClone(p); del2.likes.userPicks.splice(0, 2);
  assert.equal(checkExhibitionProfileChange(p, del2).ok, false);
  const del1 = structuredClone(p); del1.likes.userPicks.splice(0, 1);
  assert.equal(checkExhibitionProfileChange(p, del1).ok, true);
  const add3 = structuredClone(p); for (let i = 0; i < 3; i++) add3.likes.userPicks.push({ title: `N${i}`, venue: "V", tags: [], why: "w", addedAt: "2026-10-20T00:00:00.000Z" });
  assert.equal(checkExhibitionProfileChange(p, add3).ok, true);
  const add4 = structuredClone(add3); add4.likes.userPicks.push({ title: "N9", venue: "V", tags: [], why: "w", addedAt: "2026-10-21T00:00:00.000Z" });
  assert.equal(checkExhibitionProfileChange(p, add4).ok, false);
  const over = structuredClone(withPicks(9)); for (let i = 0; i < 3; i++) over.likes.userPicks.push({ title: `M${i}`, venue: "V", tags: [], why: "w", addedAt: "2026-10-22T00:00:00.000Z" });
  assert.equal(checkExhibitionProfileChange(withPicks(9), over).ok, false); // 12件 > 10
  const edit = structuredClone(p); edit.likes.userPicks[0].why = "書き換え"; edit.likes.userPicks[1].why = "書き換え2"; // 2件差し替え=削除2+追加2
  assert.equal(checkExhibitionProfileChange(p, edit).ok, false);
  const fromNone = structuredClone(profile()); fromNone.likes.userPicks = [];
  assert.equal(checkExhibitionProfileChange(profile(), fromNone).ok, true);
});

test("userPick 削除は同じ証拠で再発火しない: 6週シミュレーションで5件→4件で止まる", () => {
  let p = withPicks(5);
  const items = ["b1", "b2", "b3"].map((id) => ({ ...boosted(id), addedAt: "2026-10-10T00:00:00.000Z" }));
  const sim = (prof) => proposeExhibitionProfile(prof, computeExhibitionStats({ favIds: [], trashedIds: ["b1", "b2"], items, boostedSince: prof.likes.userPicksEvidenceSince }), items);
  for (let w = 0; w < 6; w++) {
    const next = sim(p);
    assert.equal(checkExhibitionProfileChange(p, next).ok, true, JSON.stringify(checkExhibitionProfileChange(p, next).errors));
    p = next;
  }
  assert.equal(p.likes.userPicks.length, 4);
  assert.ok(p.likes.userPicksEvidenceSince);
});

test("userPick 削除後に追加された新しい pick と新しい印付き展示だけが次の証拠になる", () => {
  let p = withPicks(5);
  const old = ["b1", "b2", "b3"].map((id) => ({ ...boosted(id), addedAt: "2026-10-10T00:00:00.000Z" }));
  const s1 = computeExhibitionStats({ favIds: [], trashedIds: ["b1", "b2"], items: old });
  p = proposeExhibitionProfile(p, s1, old);
  assert.equal(p.likes.userPicks.length, 4);
  const since = p.likes.userPicksEvidenceSince;
  const fresh = ["f1", "f2", "f3"].map((id) => ({ ...boosted(id), addedAt: new Date(Date.parse(since) + 1000).toISOString() }));
  const all = [...old, ...fresh];
  const s2 = computeExhibitionStats({ favIds: [], trashedIds: ["b1", "b2", "f1", "f2"], items: all, boostedSince: since });
  assert.deepEqual(s2.boosted, { count: 3, trashed: 2, trashRate: 0.67 });
  assert.equal(proposeExhibitionProfile(p, s2, all).likes.userPicks.length, 3);
});

test("同一UTC日の境界: 当日01:30Zに追加された印付き3件は、同日の tuneup による削除後に翌週の証拠にならない", () => {
  const day = new Date().toISOString().slice(0, 10);
  let p = withPicks(5);
  const items = ["b1", "b2", "b3"].map((id) => ({ ...boosted(id), addedAt: `${day}T00:00:00.000Z` }));
  const stats = (prof) => computeExhibitionStats({ favIds: [], trashedIds: ["b1", "b2"], items, boostedSince: prof.likes.userPicksEvidenceSince });
  p = proposeExhibitionProfile(p, stats(p), items);
  assert.equal(p.likes.userPicks.length, 4);
  assert.match(p.likes.userPicksEvidenceSince, /^\d{4}-\d{2}-\d{2}T/); // フルISO
  assert.equal(checkExhibitionProfileChange(withPicks(5), p).ok, true);
  const week2 = proposeExhibitionProfile(p, stats(p), items);
  assert.equal(week2.likes.userPicks.length, 4); // 再発火しない
});

test("ガードレール: userPicksEvidenceSince は ISO日時と旧 YYYY-MM-DD を許可、他は拒否", () => {
  const base = withPicks(3);
  for (const v of ["2026-10-24T12:00:00.000Z", "2026-10-24"]) {
    const n = structuredClone(base); n.likes.userPicksEvidenceSince = v;
    assert.equal(checkExhibitionProfileChange(base, n).ok, true, v);
  }
  const bad = structuredClone(base); bad.likes.userPicksEvidenceSince = "yesterday";
  assert.equal(checkExhibitionProfileChange(base, bad).ok, false);
});
