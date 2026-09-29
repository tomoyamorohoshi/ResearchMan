// assignShapeKindsのidea単位キャッシュ＋進捗ログのテスト(バイト等価性の証明)。
// 実行: node --import tsx --test src/lib/ideaShapeAssignmentCache.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { assignShapeKinds, type IdeaContentInput, type ShapeAssignment } from "./ideaCollageLayout";

const LONG = "これは非常に長い企画本文です。".repeat(45);
const ideas: IdeaContentInput[] = [
  { id: "cache-eq-1", title: "短い企画", dateLabel: "2026.07.27", seed: "短い本文", refs: [] },
  { id: "cache-eq-2", title: "別の企画", dateLabel: "ARCHIVE", seed: "もう少し長めの本文がここに入ります。", refs: [] },
  {
    id: "cache-eq-3",
    title: "参照リンクの多い長い企画タイトルがここに入ります",
    dateLabel: "2026.08.01",
    seed: LONG,
    refs: [
      { type: "case", title: "長い参照タイトルその一つ目のケース事例" },
      { type: "tech", title: "長い参照タイトルその二つ目のテック" },
      { type: "case", title: "長い参照タイトルその三つ目のケース事例" },
    ],
  },
  { id: "cache-eq-4", title: "四番目", dateLabel: "2026.08.02", seed: "本文4", refs: [] },
];

function makeCache() {
  const store = new Map<string, ShapeAssignment>();
  const stats = { gets: 0, hits: 0, sets: 0, flushes: 0 };
  return {
    store,
    stats,
    cache: {
      get(idea: IdeaContentInput) {
        stats.gets++;
        const v = store.get(idea.id);
        if (v) stats.hits++;
        return v;
      },
      set(idea: IdeaContentInput, a: ShapeAssignment) {
        stats.sets++;
        store.set(idea.id, a);
      },
      flush() {
        stats.flushes++;
      },
    },
  };
}

const ser = (m: Map<string, ShapeAssignment>) => JSON.stringify([...m.entries()]);

test("コールド・ウォーム・キャッシュ無しの結果がバイト等価", () => {
  const silent = { log: () => {} };
  // 1回目のキャッシュ無し実行が真の全計算(以降はsolveFixedSizeShapeのプロセス内メモが効くため、
  // 時間比較の基準はこの1回目にする)
  const tBase = Date.now();
  const baseline = ser(assignShapeKinds(ideas, silent));
  const coldMs = Date.now() - tBase;

  const { cache, stats } = makeCache();
  const cold = ser(assignShapeKinds(ideas, { ...silent, cache }));
  assert.equal(cold, baseline);
  assert.equal(stats.hits, 0);
  assert.equal(stats.sets, ideas.length);

  const t1 = Date.now();
  const warm = ser(assignShapeKinds(ideas, { ...silent, cache }));
  const warmMs = Date.now() - t1;
  assert.equal(warm, baseline);
  assert.equal(stats.hits, ideas.length); // 全件ヒット
  assert.equal(stats.sets, ideas.length); // ウォームでは書き込まない
  console.log(`cold=${coldMs}ms warm=${warmMs}ms`);
  assert.ok(warmMs < Math.max(50, coldMs / 20), `warm(${warmMs}ms)はcold(${coldMs}ms)より桁違いに速いはず`);
});

test("部分ヒット: 一部だけキャッシュ済みでも結果は等価・未ヒット分のみ計算して保存", () => {
  const silent = { log: () => {} };
  const baseline = ser(assignShapeKinds(ideas, silent));
  const { cache, store, stats } = makeCache();
  const full = assignShapeKinds(ideas, silent);
  store.set(ideas[0].id, full.get(ideas[0].id)!);
  store.set(ideas[3].id, full.get(ideas[3].id)!);
  const out = ser(assignShapeKinds(ideas, { ...silent, cache }));
  assert.equal(out, baseline);
  assert.equal(stats.hits, 2);
  assert.equal(stats.sets, 2);
});

test("cacheのget/set/flushが例外を投げても全計算にフォールバックし結果は等価", () => {
  const silent = { log: () => {} };
  const baseline = ser(assignShapeKinds(ideas, silent));
  const broken = {
    get(): ShapeAssignment | undefined {
      throw new Error("read failed");
    },
    set(): void {
      throw new Error("write failed");
    },
    flush(): void {
      throw new Error("flush failed");
    },
  };
  assert.equal(ser(assignShapeKinds(ideas, { ...silent, cache: broken })), baseline);
});

test("進捗ログ: N件ごと＋最終件に `shape割り当て done/total (経過…)` を出す", () => {
  const msgs: string[] = [];
  const out = assignShapeKinds(ideas.slice(0, 3), { progressEvery: 2, log: (m) => msgs.push(m) });
  assert.equal(out.size, 3);
  assert.equal(msgs.length, 2);
  assert.match(msgs[0], /shape割り当て 2\/3 \(経過/);
  assert.match(msgs[1], /shape割り当て 3\/3 \(経過/);
});
