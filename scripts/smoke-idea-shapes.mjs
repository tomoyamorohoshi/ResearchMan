// src/lib/ideaShapes.ts のスモークテスト（計画書: goofy-hatching-mango.md 検証7）。
// 純粋なNode実行で完結させたいが、ideaShapes.tsはNext.js/tsc標準のmoduleResolution:"bundler"に
// 合わせて拡張子なしimport（./graph）を使っており、plain nodeのESMローダーは拡張子なし解決を
// サポートしないため直接は動かせない（tsc --noEmitでは正しく解決される。二重に確認済み）。
// そのため軽量トランスパイラtsx経由で実行する（package.jsonへの依存追加はしていない。npx tsxはこの
// 検証時のみのアドホック実行）:
//   npx tsx scripts/smoke-idea-shapes.mjs
import { shapeForIdea, SHAPE_KINDS } from "../src/lib/ideaShapes.ts";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// d文字列から (x,y) 座標を全部抜き出す（M/C/Q/L/Zのみを使うため、数値を2個ずつ組にすればよい）
function pointsFromPath(d) {
  const nums = (d.match(/-?\d+\.?\d*/g) || []).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

const testIds = [];
for (let i = 0; i < 300; i++) testIds.push(`smoke-test-idea-${i}`);
// 実データのidも混ぜる（実運用形式のid文字列でも壊れないことを見る）
try {
  const { default: ideasData } = await import("../data/ideas.json", { with: { type: "json" } });
  for (const idea of ideasData) testIds.push(idea.id);
} catch {
  console.warn("data/ideas.json の読み込みをスキップ（本題のシェイプ検証には影響なし）");
}

const kindsSeen = new Set();

for (const id of testIds) {
  const shape1 = shapeForIdea(id);
  const shape2 = shapeForIdea(id);

  // 決定論性: 同じidなら常に同じ結果（Math.random不使用の確認）
  assert(JSON.stringify(shape1) === JSON.stringify(shape2), `${id}: 決定論性(2回呼び出しで一致)`);

  kindsSeen.add(shape1.kind);

  // 閉パスの健全性
  assert(shape1.outlinePath.trimEnd().endsWith("Z"), `${id}: outlinePathが閉じている(Z終端)`);
  assert(!/NaN|Infinity/.test(shape1.outlinePath), `${id}: outlinePathにNaN/Infinityがない`);
  assert(!/NaN|Infinity/.test(shape1.dateArcPath), `${id}: dateArcPathにNaN/Infinityがない`);
  assert(!/NaN|Infinity/.test(shape1.titleArcPath), `${id}: titleArcPathにNaN/Infinityがない`);
  assert(shape1.dateArcPath.startsWith("M"), `${id}: dateArcPathがMで始まる`);
  assert(shape1.titleArcPath.startsWith("M"), `${id}: titleArcPathがMで始まる`);
  assert(Number.isFinite(shape1.titleArcLength) && shape1.titleArcLength > 0, `${id}: titleArcLengthが正の有限値`);

  // 輪郭の点群バウンディングボックスに対し、safeAreaが内側に収まっているか（大まかな包含チェック）
  const outlinePts = pointsFromPath(shape1.outlinePath);
  const minX = Math.min(...outlinePts.map((p) => p.x));
  const maxX = Math.max(...outlinePts.map((p) => p.x));
  const minY = Math.min(...outlinePts.map((p) => p.y));
  const maxY = Math.max(...outlinePts.map((p) => p.y));
  const sa = shape1.safeArea;
  assert(sa.x >= minX - 1 && sa.x + sa.w <= maxX + 1, `${id}: safeAreaのx方向が輪郭bbox内 (kind=${shape1.kind})`);
  assert(sa.y >= minY - 1 && sa.y + sa.h <= maxY + 1, `${id}: safeAreaのy方向が輪郭bbox内 (kind=${shape1.kind})`);
  assert(sa.w >= shape1.viewBoxW * 0.35, `${id}: safeArea幅が下限以上 (kind=${shape1.kind})`);
  assert(sa.h >= shape1.viewBoxH * 0.15, `${id}: safeArea高さが下限以上 (kind=${shape1.kind})`);

  // viewBox・aspectの整合性
  assert(shape1.viewBoxW > 0 && shape1.viewBoxH > 0, `${id}: viewBoxが正の値`);
  assert(Math.abs(shape1.aspect - shape1.viewBoxW / shape1.viewBoxH) < 1e-9, `${id}: aspectがviewBoxW/Hと一致`);
}

// 6種すべてが出現しているか（十分な数のidを流したので網羅されるはず）
for (const kind of SHAPE_KINDS) {
  assert(kindsSeen.has(kind), `シェイプ種"${kind}"が一度も出現していない`);
}
assert(kindsSeen.size >= 6, `6種以上のシェイプが出現 (実際: ${kindsSeen.size}種)`);

console.log(`smoke-idea-shapes: ${testIds.length}件のid × 検証完了。出現シェイプ種: ${[...kindsSeen].join(", ")}`);
if (failures > 0) {
  console.error(`\n${failures}件の検証失敗`);
  process.exit(1);
} else {
  console.log("全検証PASS");
}
