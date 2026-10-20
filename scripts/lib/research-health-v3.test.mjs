// research-health.mjs の v3 追加チェック（純関数）のテスト。git フィクスチャ不要で高速。
// 実行: node --test scripts/lib/research-health-v3.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkLensAdoption,
  checkBorderlineRates,
  LENS_MIN_TAGGED,
  BORDERLINE_MIN_COUNT,
  BORDERLINE_MIN_REACTED,
} from "./research-health.mjs";

const TODAY = "2026-10-20";
const mk = (lens, n = 1, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: `x${lens}-${i}`, title: "t", discoveryLens: lens, gateTier: "accept", ...extra }));
const byDay = (items, day = "2026-10-18") => new Map([[day, items]]);

test("checkLensAdoption: タグ付きが少ない間(旧データ/導入直後)は判定しない", () => {
  const items = [...mk(1, 3), ...mk(2, 3)]; // 6件 < 閾値
  assert.ok(LENS_MIN_TAGGED > 6);
  assert.deepEqual(checkLensAdoption({ ccByDay: byDay(items), today: TODAY }), []);
  assert.deepEqual(checkLensAdoption({ ccByDay: byDay([{ id: "o", title: "旧" }]), today: TODAY }), []);
});

test("checkLensAdoption: 十分な件数があり特定レンズが0件なら med。レンズ番号を detail に出す", () => {
  const items = [...mk(1, 5), ...mk(2, 5), ...mk(3, 5)];
  const f = checkLensAdoption({ ccByDay: byDay(items), today: TODAY });
  assert.equal(f.length, 1);
  assert.equal(f[0].code, "lens-zero");
  assert.equal(f[0].severity, "med");
  assert.match(f[0].detail, /レンズ4/);
});

test("checkLensAdoption: 全レンズに1件以上あれば出ない / 7日窓外の追加は数えない", () => {
  const ok = [...mk(1, 4), ...mk(2, 4), ...mk(3, 4), ...mk(4, 1)];
  assert.deepEqual(checkLensAdoption({ ccByDay: byDay(ok), today: TODAY }), []);
  const old = byDay([...mk(1, 5), ...mk(2, 5), ...mk(3, 5), ...mk(4, 5)], "2026-09-01");
  assert.deepEqual(checkLensAdoption({ ccByDay: old, today: TODAY }), []);
});

const snap = (b, extra = {}) => ({ at: "2026-10-19T00:00:00Z", byTier: { borderline: b, accept: { count: 50, fav: 10, trashed: 2 } }, ...extra });

test("checkBorderlineRates: 件数/反応数が閾値未満なら判定しない", () => {
  assert.deepEqual(checkBorderlineRates({ stats: snap({ count: BORDERLINE_MIN_COUNT - 1, fav: 0, trashed: 9 }), today: TODAY }), []);
  assert.deepEqual(checkBorderlineRates({ stats: snap({ count: 40, fav: 1, trashed: BORDERLINE_MIN_REACTED - 3 }), today: TODAY }), []);
  assert.deepEqual(checkBorderlineRates({ stats: null, today: TODAY }), []);
});

test("checkBorderlineRates: trash 偏重(反応のうち70%以上)なら med", () => {
  const f = checkBorderlineRates({ stats: snap({ count: 30, fav: 2, trashed: 14 }), today: TODAY });
  assert.equal(f.length, 1);
  assert.equal(f[0].code, "borderline-trash-heavy");
  assert.equal(f[0].severity, "med");
});

test("checkBorderlineRates: fav が多数派なら low の情報(accept基準が厳しい可能性)", () => {
  const f = checkBorderlineRates({ stats: snap({ count: 30, fav: 14, trashed: 2 }), today: TODAY });
  assert.equal(f.length, 1);
  assert.equal(f[0].code, "borderline-fav-heavy");
  assert.equal(f[0].severity, "low");
});

test("checkBorderlineRates: 拮抗していれば出ない / 21日超古い統計は無視", () => {
  assert.deepEqual(checkBorderlineRates({ stats: snap({ count: 30, fav: 7, trashed: 7 }), today: TODAY }), []);
  assert.deepEqual(checkBorderlineRates({ stats: snap({ count: 30, fav: 1, trashed: 14 }, { at: "2026-09-01T00:00:00Z" }), today: TODAY }), []);
});
