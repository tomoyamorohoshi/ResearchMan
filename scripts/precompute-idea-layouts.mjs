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

// ── rename-with-retryの堅牢化 ─────────────────────────────────────────────
// 背景(2026-07-15障害): 本スクリプトはtmpファイルに書いてからfs.renameで本体へ原子的に
// 置き換えるが、rename瞬間にgit pre-push監査(scripts/check-idea-layouts-freshness.mjs等)や
// Windows側のAVスキャン・検索インデクサが data/idea-layouts.json を一瞬開いていると、
// Windowsではrenameが対象ファイルのハンドル解放待ちでEPERM(まれにEBUSY/EACCES)を返し
// 失敗する。単発renameだと呼び出し元のideaジョブ全体がロールバックしてしまうため、
// 指数バックオフでリトライする。fs実装・sleep実装を注入可能にし、実FSでの再現が不安定な
// EPERMをモックで検証できるようにする(scripts/smoke-precompute-rename-retry.mjs)。
const RENAME_RETRYABLE_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRY_DELAYS_MS = [200, 400, 800, 1600, 3200]; // 指数バックオフ・最大5回リトライ

function isRetryableRenameError(err) {
  return Boolean(err) && RENAME_RETRYABLE_CODES.has(err.code);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fs.rename を EPERM/EBUSY/EACCES 時のみ指数バックオフでリトライする純関数。
 * renameFn/sleepFnを注入可能にすることで、実FSの競合(タイミング依存で不安定)を再現せず
 * 「N回失敗→成功」「全回失敗」をモックで決定的にテストできる。
 * 最終的に全リトライを使い切って失敗した場合は最後のエラーをそのままthrowする
 * （tmpファイルの後始末は行わない＝従来のwriteJsonAtomicと同じ挙動を維持）。
 */
export async function renameWithRetry(
  tmpPath,
  destPath,
  { renameFn = fs.rename, delaysMs = RENAME_RETRY_DELAYS_MS, sleepFn = defaultSleep } = {},
) {
  let attempt = 0;
  for (;;) {
    try {
      await renameFn(tmpPath, destPath);
      return;
    } catch (err) {
      if (!isRetryableRenameError(err) || attempt >= delaysMs.length) throw err;
      await sleepFn(delaysMs[attempt]);
      attempt += 1;
    }
  }
}

/**
 * data/idea-layouts.json への原子書き込み。同一ディレクトリのtmpファイルに書いてから
 * renameWithRetryで本体へ置き換える(scripts/lib/ideas-io.mjsのwriteJsonAtomicと同じ
 * tmp命名規則・書き込み手順。renameだけWindowsでの一時的な競合に強くしたもの)。
 */
export async function writeIdeaLayoutsAtomic(filePath, data, { writeFileFn = fs.writeFile, ...retryOptions } = {}) {
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}`);
  await writeFileFn(tmpPath, JSON.stringify(data, null, 2) + "\n");
  await renameWithRetry(tmpPath, filePath, retryOptions);
}

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
  await writeIdeaLayoutsAtomic(OUT_PATH, output);

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

// CLIブロック: このファイルが直接実行された場合のみ動く(audit-award.mjsと同じ規約)。
// これにより、smoke-precompute-rename-retry.mjsがrenameWithRetry/writeIdeaLayoutsAtomicだけを
// importして単体検証する際に、18分かかるmain()本体を誤って走らせずに済む。
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("❌ エラー:", e.message);
    process.exit(1);
  });
}
