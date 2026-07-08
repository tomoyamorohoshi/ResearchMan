/**
 * data/idea-layouts.json の鮮度チェック用ハッシュ（DESIGN: goofy-hatching-mango.md
 * 2026-07-08改訂・事前計算方式）。
 *
 * data/ideas.json の生テキスト＋アルゴリズムバージョン文字列から入力ハッシュを作る。
 * precompute-idea-layouts.mjs（重い計算を実行してdata/idea-layouts.jsonへ書き出す側）と
 * check-idea-layouts-freshness.mjs（pre-pushフックが「レイアウトが現在のideas.jsonと
 * 一致しているか」だけを高速に検査する側）の両方から、この1つの関数を共有する
 * （ズレると鮮度検査自体が無意味になるため、ハッシュ式を二重実装しない）。
 *
 * IDEA_LAYOUTS_ALGO_VERSION は、solveFixedSizeShape / assignShapeKinds / computeCollageLayout
 * の計算結果に影響するロジック変更（src/lib/ideaShapes.ts・src/lib/ideaCollageLayout.ts）を
 * 行うたびに必ずインクリメントすること。ここを怠ると、ロジックが変わったのに
 * data/idea-layouts.json が古いままでも鮮度検査がハッシュ一致と誤判定し、pushを通してしまう。
 */
import crypto from "node:crypto";

export const IDEA_LAYOUTS_ALGO_VERSION = "fixed-two-size-v1";

export function computeIdeaLayoutsInputHash(ideasJsonRawText) {
  return crypto.createHash("sha256").update(ideasJsonRawText).update(IDEA_LAYOUTS_ALGO_VERSION).digest("hex");
}
