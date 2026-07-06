// src/components/IdeaShapeCard.tsx のタイトル省略ロジックのスモークテスト
// (Fable視覚検分 + adversarialレビュー統合指摘C1: フォント下限でも弧の実長に収まらない場合、
// "…"付きで切り詰める。textPathは自動省略しないため事前計算が必須)。
// 実行: npx tsx scripts/smoke-idea-title-fit.mjs
import { estimateTextWidthEm, truncateToArcBudget } from "../src/components/IdeaShapeCard.tsx";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// 十分収まる場合は原文のまま
{
  const title = "短いタイトル";
  const fontSize = 5;
  const budget = estimateTextWidthEm(title) * fontSize + 10; // 余裕を持って収まる予算
  const result = truncateToArcBudget(title, budget, fontSize);
  assert(result === title, `収まる場合は切り詰めない (実際: "${result}")`);
}

// 収まらない場合は末尾が省略記号になり、実測幅が予算以内に収まる
{
  const title = "とても長い自動生成タイトルがここに延々と続いてしまうケースの検証用文字列";
  const fontSize = 5;
  const budget = 40; // 明らかに全文は収まらない小さい予算
  const result = truncateToArcBudget(title, budget, fontSize);
  assert(result !== title, `長すぎる場合は切り詰められる (実際: "${result}")`);
  assert(result.endsWith("…"), `切り詰め結果は省略記号で終わる (実際: "${result}")`);
  assert(
    estimateTextWidthEm(result) * fontSize <= budget + 1e-6,
    `切り詰め結果は予算内に収まる (実測=${(estimateTextWidthEm(result) * fontSize).toFixed(2)}, 予算=${budget})`,
  );
}

// 英数字混じりタイトルでもNaN/例外なく動作する
{
  const title = "GPT-5 Realtime Video Codec 2026 Edition Long Name";
  const fontSize = 5;
  const budget = 30;
  const result = truncateToArcBudget(title, budget, fontSize);
  assert(typeof result === "string" && result.length > 0, `英数字混在でも空文字にならない (実際: "${result}")`);
}

// 日付ラベル("ARCHIVE"・letterSpacing付き)向け: extraEmPerCharで文字間スペーシング分を
// 幅見積もりに加算できること（日付弧が短い縦長シェイプで実測。letterSpacingを見積もりに
// 含めないと切り詰め後もなお実際のレンダリング幅が予算を超える）
{
  const label = "ARCHIVE";
  const fontSize = 5;
  const extraEmPerChar = 0.14;
  const budget = 15; // ARCHIVE全体(letterSpacing込み)は収まらないが、切り詰めれば収まる小さめ予算
  const result = truncateToArcBudget(label, budget, fontSize, extraEmPerChar);
  assert(result !== label, `letterSpacing込みで長すぎる場合は切り詰められる (実際: "${result}")`);
  const widthWithSpacing = (estimateTextWidthEm(result) + result.length * extraEmPerChar) * fontSize;
  assert(
    widthWithSpacing <= budget + 1e-6,
    `letterSpacing込みの切り詰め結果は予算内に収まる (実測=${widthWithSpacing.toFixed(2)}, 予算=${budget})`,
  );
}

// extraEmPerCharを渡さない場合(デフォルト0)は既存のタイトル用の挙動と変わらないこと(後方互換)
{
  const title = "収まる短いタイトル";
  const fontSize = 5;
  const budget = estimateTextWidthEm(title) * fontSize + 10;
  const result = truncateToArcBudget(title, budget, fontSize);
  assert(result === title, `extraEmPerChar省略時は従来どおり収まれば切り詰めない (実際: "${result}")`);
}

console.log(`smoke-idea-title-fit: 検証完了`);
if (failures > 0) {
  console.error(`\n${failures}件の検証失敗`);
  process.exit(1);
} else {
  console.log("全検証PASS");
}
