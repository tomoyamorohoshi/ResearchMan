// /ideas ポスターのレイアウト事前計算（DESIGN: goofy-hatching-mango.md 2026-07-08改訂・
// 事前計算方式で再投入）。
//
// 背景: 初回実装(9dcc197〜faaa62a)はsolveFixedSizeShape/assignShapeKinds/computeCollageLayoutを
// IdeasPoster.tsx（Server Component）がビルド時に直接呼んでいたため、Vercelビルド
// (2コア・SSG1ワーカー)で/ideasの生成が300秒×3回タイムアウトし、9デプロイ連続失敗・
// 本番21時間凍結を起こしてrevert済み(68fd009)。ローカル実測130〜160秒の計算はVercelでは
// コア単位で4〜6倍遅い。再投入にあたり、重い計算をビルド時から完全に追い出し、本スクリプトが
// data/ideas.json更新のたびに3ティア分の計算結果をdata/idea-layouts.jsonへ事前に書き出す
// 方式に変える。page.tsx/IdeasPoster.tsx/IdeaShapeCard.tsxはこの結果を描画するだけで、
// ビルド時の重計算はゼロになる。
//
// 実行: npx tsx scripts/precompute-idea-layouts.mjs
// 呼び出しタイミング: generate-idea-seeds.mjs / backfill-idea-seeds.mjs がdata/ideas.jsonへ
// 書き込んだ直後に必ず実行する（パイプライン組込み済み）。手動でideas.jsonを編集した場合も、
// pushする前に必ず実行すること（pre-pushフックのscripts/check-idea-layouts-freshness.mjsが
// 入力ハッシュ不一致を検出し、実行し忘れたままのpushを拒否する）。
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeIdeaLayoutsInputHash, IDEA_LAYOUTS_ALGO_VERSION } from "./lib/idea-layouts-hash.mjs";
import { writeJsonAtomic } from "./lib/ideas-io.mjs";
import { solveFixedSizeShape } from "../src/lib/ideaShapes.ts";
import {
  assignShapeKinds,
  computeCollageLayout,
  FIXED_BODY_FONT_PX,
  FIXED_TITLE_FONT_PX,
} from "../src/lib/ideaCollageLayout.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IDEAS_JSON_PATH = process.env.IDEAS_JSON_PATH || path.join(__dirname, "../data/ideas.json");
const OUT_PATH = process.env.IDEA_LAYOUTS_JSON_PATH || path.join(__dirname, "../data/idea-layouts.json");

const TIERS = ["mobile", "compact", "wide"];

async function main() {
  const startedAt = Date.now();
  const ideasRawText = await fs.readFile(IDEAS_JSON_PATH, "utf-8");
  const ideas = JSON.parse(ideasRawText);
  if (!Array.isArray(ideas)) throw new Error(`${IDEAS_JSON_PATH} が配列ではありません`);

  const contentInputs = ideas.map((idea) => ({
    id: idea.id,
    title: idea.title,
    dateLabel: idea.date ? idea.date.replaceAll("-", ".") : "ARCHIVE",
    seed: idea.seed,
    refs: idea.refs,
  }));

  // シェイプ種(kind/generous)の決定はティア非依存に1回だけ行う（assignShapeKindsが内部で
  // 3ティアすべての実行可能性を考慮するため。IdeasPoster.tsx旧実装と同じ考え方）
  const assignments = assignShapeKinds(contentInputs);

  const tiers = {};
  for (const tier of TIERS) {
    const cards = contentInputs.map((idea) => {
      const assignment = assignments.get(idea.id);
      const { shape, scale } = solveFixedSizeShape(
        idea.id,
        idea.title,
        idea.dateLabel,
        { seed: idea.seed, refs: idea.refs },
        FIXED_TITLE_FONT_PX[tier],
        FIXED_BODY_FONT_PX[tier],
        assignment && { forceKind: assignment.kind, generous: assignment.generous },
      );
      return { id: idea.id, shape, scale };
    });
    const layout = computeCollageLayout(cards, tier);
    const cardsById = {};
    cards.forEach((c, i) => {
      cardsById[c.id] = { shape: c.shape, scale: c.scale, placement: layout.placements[i] };
    });
    tiers[tier] = {
      containerWidthPx: layout.containerWidthPx,
      containerHeightPx: layout.containerHeightPx,
      cards: cardsById,
    };
    console.log(`  [${tier}] ${cards.length}件のシェイプ・配置を計算完了`);
  }

  const inputHash = computeIdeaLayoutsInputHash(ideasRawText);
  const output = {
    inputHash,
    algoVersion: IDEA_LAYOUTS_ALGO_VERSION,
    generatedAt: new Date().toISOString(),
    tiers,
  };
  await writeJsonAtomic(OUT_PATH, output);

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `✅ idea-layouts.json 生成完了: ${ideas.length}件 × ${TIERS.length}ティア → ${OUT_PATH}（${(elapsedMs / 1000).toFixed(1)}秒）`,
  );
  // 予算の整合（goofy-hatching-mango.md 2026-07-08改訂計画・検証5）: 重計算はビルド外の
  // このスクリプトに移した。ローカル10分未満に収まらない場合は警告のみ(exit 1にはしない。
  // 生成物自体は正しく書き出せているため、日次パイプラインを不必要に落とさない判断)。
  // ビルド時間そのものの安全網はnext.config.tsのstaticPageGenerationTimeoutではなく、
  // pre-pushフックの鮮度検査＋本予算ログで担保する
  const BUDGET_MS = 10 * 60 * 1000;
  if (elapsedMs > BUDGET_MS) {
    console.warn(
      `⚠ precompute実行時間が予算(10分)を超過しました(実測${(elapsedMs / 1000).toFixed(1)}秒)。` +
        `シェイプ生成・探索ロジックの計算量退行の可能性があります`,
    );
  }
}

main().catch((e) => {
  console.error("❌ エラー:", e.message);
  process.exit(1);
});
