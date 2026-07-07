// src/lib/ideaShapes.ts の estimateTextWidthEm のスモークテスト。
// DESIGN差分(2026-07-07バッチ A: 切り詰め全廃)により、truncateToArcBudget
// (旧: src/components/IdeaShapeCard.tsx)は削除された。textPathは常に全文を表示し、
// 弧の選定・フォントサイズ決定は輪郭全周からの曲率ベース探索(src/lib/ideaShapes.ts)が行う
// （切り詰めゼロの検証はscripts/smoke-idea-shapes.mjs参照）。
// estimateTextWidthEmは弧の必要弧長見積もりに使う共有ユーティリティとして残り、
// ここではその挙動だけを単体検証する。
// 実行: npx tsx scripts/smoke-idea-title-fit.mjs
import { estimateTextWidthEm } from "../src/lib/ideaShapes.ts";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// 全角(CJK)は1文字1.0em
{
  const width = estimateTextWidthEm("全角文字");
  assert(Math.abs(width - 4.0) < 1e-9, `全角4文字は4.0em (実際: ${width})`);
}

// 半角(ASCII)は1文字0.6em
{
  const width = estimateTextWidthEm("abcd");
  assert(Math.abs(width - 2.4) < 1e-9, `半角4文字は2.4em (実際: ${width})`);
}

// 全角/半角混在
{
  const width = estimateTextWidthEm("AI技術");
  assert(Math.abs(width - (0.6 * 2 + 1.0 * 2)) < 1e-9, `混在文字列の幅見積もりが正しい (実際: ${width})`);
}

// 空文字は0
{
  const width = estimateTextWidthEm("");
  assert(width === 0, `空文字は0em (実際: ${width})`);
}

console.log(`smoke-idea-title-fit: 検証完了`);
if (failures > 0) {
  console.error(`\n${failures}件の検証失敗`);
  process.exit(1);
} else {
  console.log("全検証PASS");
}
