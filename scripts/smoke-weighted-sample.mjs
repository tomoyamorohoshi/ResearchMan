// scripts/lib/weighted-sample.mjs の単体検証。
// - 全重み1.0のときは旧 sample()（Fisher-Yatesシャッフル+slice）と完全に同一の
//   コード経路・同一の乱数消費で同一の結果を返すこと（バッチ2a「挙動不変」の証明）
// - 重み付けが実際に選択確率へ反映されること（統計的検証）
// 実行: node scripts/smoke-weighted-sample.mjs
import { computeItemWeight, weightedSample } from "./lib/weighted-sample.mjs";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

// 旧実装（generate-idea-seeds.mjs の refactor前 sample()）をそのまま再掲し、
// 同一の乱数列を与えて weightedSample(weights=null/全1) と結果が一致することを確認する。
function legacySample(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function withMockedRandom(seqFactory, fn) {
  const seq = seqFactory();
  const orig = Math.random;
  Math.random = () => {
    const v = seq.next();
    return v.done ? 0.5 : v.value;
  };
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

function* mulberry32Seq(seed) {
  let a = seed;
  for (;;) {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    yield ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

const items = Array.from({ length: 20 }, (_, i) => `item-${i}`);

// ── 1. 挙動不変: weights省略 と weights=全1 は旧sample()と同一の乱数消費で同一結果 ──
{
  const a = withMockedRandom(() => mulberry32Seq(42), () => legacySample(items, 6));
  const b = withMockedRandom(() => mulberry32Seq(42), () => weightedSample(items, 6, null));
  const c = withMockedRandom(() => mulberry32Seq(42), () => weightedSample(items, 6, items.map(() => 1)));
  assert(JSON.stringify(a) === JSON.stringify(b), `weights省略はlegacySample()と同一結果 (${JSON.stringify(a)} vs ${JSON.stringify(b)})`);
  assert(JSON.stringify(a) === JSON.stringify(c), `weights=全1はlegacySample()と同一結果 (${JSON.stringify(a)} vs ${JSON.stringify(c)})`);
}

// ── 2. computeItemWeight: 未指定キー・空配列は1.0、複数タグは積 ──
{
  assert(computeItemWeight(undefined, {}) === 1, "keys未定義は1.0");
  assert(computeItemWeight([], { "Tech/AI": 2 }) === 1, "空配列は1.0");
  assert(computeItemWeight(["Tech/AI"], {}) === 1, "重みマップ空は1.0");
  assert(computeItemWeight(["Tech/AI"], { "Tech/AI": 2.5 }) === 2.5, "一致タグの重みを適用");
  assert(computeItemWeight(["Tech/AI", "Form/Product"], { "Tech/AI": 2, "Form/Product": 3 }) === 6, "複数タグは積");
  assert(computeItemWeight(["Tech/Unknown"], { "Tech/AI": 2 }) === 1, "未知タグは1.0扱い");
}

// ── 3. 重み付けが選択確率に反映される（統計的検証） ──
{
  const arr = ["heavy", "light-a", "light-b", "light-c"];
  const weights = [4.0, 0.25, 0.25, 0.25]; // heavy が圧倒的に選ばれやすいはず
  let heavyCount = 0;
  const TRIALS = 3000;
  for (let i = 0; i < TRIALS; i++) {
    const picked = weightedSample(arr, 1, weights);
    if (picked[0] === "heavy") heavyCount++;
  }
  const rate = heavyCount / TRIALS;
  // 理論値: 4/(4+0.25*3)=0.842。統計誤差を見込み0.7以上であればOKとする
  assert(rate > 0.7, `重み付きサンプリングでheavyが優先選択される (rate=${rate.toFixed(3)})`);
}

// ── 4. 均等重み(全て同値だが1でない)でも n件を重複なく返す ──
{
  const arr = Array.from({ length: 10 }, (_, i) => `x${i}`);
  const weights = arr.map(() => 2.5);
  const picked = weightedSample(arr, 5, weights);
  assert(picked.length === 5, "均等重みでも指定件数を返す");
  assert(new Set(picked).size === 5, "均等重みでも重複なく非復元抽出");
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: weighted-sample");
}
