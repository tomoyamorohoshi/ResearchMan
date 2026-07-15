/**
 * アワードリサーチジョブの実行パイプライン（docs/AWARD_RESEARCH_SOP.md の5フェーズ:
 * P1 公式ソース確定 → P2 参照リスト構築 → P3 参照リスト確定 → P4 執筆 → P5 監査ゲート→公開）。
 *
 * 既存3パイプライン（caseResearch.ts等）と最大の違いは「低優先・一時停止/再開」:
 * - P1〜P4の間はgitロックを一切保持しない（research/add-caseがいつでも走れる）
 * - P2の部門単位・P4の事例単位の境界ごとにresearch/add-caseのrunningジョブを検知したら
 *   一時停止（status:"paused"）し、いなくなるまで20秒間隔でポーリングしてから再開する
 *   （waitWhilePriorityJobsRunning）
 * - ジョブ単位の予算上限（STUDIO_AWARD_BUDGET_USD、既定$30）に達したら一時停止し、
 *   LINEの「再開」キーワードを待つ（このケースだけはプロセス内ポーリングではなく、
 *   webhook.ts経由の新しい呼び出し=新しい予算枠での再開になる）
 * - サーバ再起動を挟んでも、checkpoint（ジョブJSONに自己完結）から任意の境界で再開できる
 *
 * P5でのみ researchman-git.lock を取得する。取得は即時失敗ではなく acquireLockWithWait
 * （20秒間隔・最大30分）で待つ（このジョブ自体が低優先のバックグラウンド実行のため、
 * caseResearch.ts等の「ユーザーが待っているUIなので即時失敗」という前提が当てはまらない）。
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractJsonObject } from "./addCasePure.js";
import { loadAgentDefinition } from "./agentLoader.js";
import {
  gitAdd,
  gitCommit,
  gitPush,
  gitRevParseHead,
  rollbackTouchedFiles,
  runAuditAward,
  runAuditIntegrity,
  runAuditThumbnails,
  runBuild,
  runLint,
  runTypeCheck,
  runVerifyDeploy,
} from "./audit.js";
import { buildAwardCategoryCollectPrompt, buildAwardCategoryListPrompt, buildAwardSourceDiscoveryPrompt } from "./awardPrompts.js";
import {
  buildAwardCommitMessage,
  buildAwardEntryString,
  classifyAwardJobForStartup,
  computePhaseProgress,
  dedupeNewCaseEntries,
  emptyAwardCheckpoint,
  groupWinnersByWork,
  meetsMinLevel,
  parseAwardCheckpoint,
  resolveAwardBudgetUsd,
  validateAwardRequest,
  type AwardCheckpoint,
  type AwardCheckpointWinner,
  type AwardPhase,
  type ValidatedAwardRequest,
} from "./awardPure.js";
import { BudgetExceededError, createJobBudgetTracker, type JobBudgetTracker } from "./budget.js";
import { acquireLockWithWait } from "./lock.js";
import {
  buildCaseEntry,
  buildExistingCaseIndex,
  extractJsonArray,
  filterTagsByVocabulary,
  normalizeTitleKey,
  toCaseId,
  type CaseEntry,
  type TagVocabulary,
  type WriterFields,
} from "./pure.js";
import { buildCaseWriterPrompt, buildLinkCheckerPrompt } from "./prompts.js";
import { runAgentQuery } from "./sdkRunner.js";
import { acquireThumbnail } from "./thumbnail.js";
import { pollStrictVerify } from "./strictVerify.js";
import { loadLineConfig } from "../line/config.js";
import { pushLineMessage } from "../line/push.js";
import { getJob, listJobs, listRunningPriorityJobs, updateJob, type ResultCard } from "../jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", ".."); // studio/server/pipeline -> repo root
const AGENTS_DIR = path.join(ROOT, ".claude", "agents");
const CASES_PATH = path.join(ROOT, "data", "cases.json");
const TAG_VOCAB_PATH = path.join(ROOT, "data", "tag-vocabulary.json");
const SITE = "https://research-man.vercel.app";

const PRIORITY_POLL_INTERVAL_MS = 20_000;
const PROGRESS_PUSH_INTERVAL_MS = 5 * 60 * 1000;
const CATEGORY_BATCH_SIZE = 3;

// ── 二重再開防止（要件D.4）: 同一プロセス内で同じjobIdを重複実行しない ─────────
const activeJobIds = new Set<string>();

/** P1: 公式の受賞者一覧が見つからなかった場合の専用エラー（要件C P1の中止メッセージに使う）。 */
class AwardSourceNotFoundError extends Error {}

/**
 * 予算超過で一時停止処理（updateJob/LINE push）を済ませた後、呼び出し元の
 * try/catchへ「もう処理済みなので通常のfail()をしなくてよい」と伝えるための内部シグナル。
 */
class PipelinePausedError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function notifyIfPossible(lineUserId: string, text: string): Promise<void> {
  if (!lineUserId) return;
  const config = loadLineConfig();
  if (!config?.channelAccessToken) return;
  await pushLineMessage(config.channelAccessToken, lineUserId, text);
}

function slugAwardName(awardName: string): string {
  return awardName.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function winnersJsonPath(awardName: string, year: string): string {
  return path.join(ROOT, "data", `${slugAwardName(awardName)}${year}-winners.json`);
}

// ── 実行コンテキスト（各フェーズ関数へ引き回す状態のまとめ） ────────────────

interface PipelineCtx {
  jobId: string;
  req: ValidatedAwardRequest;
  checkpoint: AwardCheckpoint;
  budget: JobBudgetTracker;
  cost: { value: number };
}

/** costUsdを積算し、予算超過ならP5前提のPipelinePausedErrorへ変換する（呼び出し元は素通しでよい）。 */
async function trackCost(ctx: PipelineCtx, amountUsd: number): Promise<void> {
  ctx.cost.value += amountUsd;
  try {
    ctx.budget.add(amountUsd);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      await updateJob(ctx.jobId, { status: "paused", pausedReason: "budget", checkpoint: ctx.checkpoint, cost: ctx.cost.value });
      await notifyIfPossible(ctx.req.lineUserId, "予算上限に達したため一時停止。「再開」と送ると続行します");
      throw new PipelinePausedError("budget-paused");
    }
    throw err;
  }
}

async function persistCheckpoint(
  ctx: PipelineCtx,
  phase: AwardPhase,
  done: number,
  total: number,
  phaseLabel: string,
): Promise<void> {
  ctx.checkpoint.phase = phase;
  await updateJob(ctx.jobId, {
    checkpoint: ctx.checkpoint,
    progress: `${phaseLabel}（${done}/${total}）`,
    progressPercent: Math.round(computePhaseProgress(phase, done, total)),
    cost: ctx.cost.value,
  });
}

/**
 * 低優先実行の核（要件D.1・D.2）。P2の部門単位・P4の事例単位の境界ごとに呼ぶ。
 * research/add-caseのrunningジョブが無ければ即return。あれば一時停止し、いなくなるまで
 * 20秒間隔でポーリングしてからrunningへ戻す（同一プロセス内で完結するため、このケースは
 * サーバ再起動を跨がない前提。跨いだ場合はstatus:"paused"のまま孤児化し、起動時復帰
 * （recoverAwardJobsOnStartup）がpausedReason:"priority-job"を自動再開する）。
 */
async function waitWhilePriorityJobsRunning(ctx: PipelineCtx): Promise<void> {
  let priority = await listRunningPriorityJobs(ctx.jobId);
  if (priority.length === 0) return;

  const before = await getJob(ctx.jobId);
  await updateJob(ctx.jobId, { status: "paused", pausedReason: "priority-job", checkpoint: ctx.checkpoint, cost: ctx.cost.value });
  await notifyIfPossible(ctx.req.lineUserId, `⏸ AWARDS${ctx.req.awardName}を一時停止（事例/技術リサーチを優先実行中）`);

  while (priority.length > 0) {
    await sleep(PRIORITY_POLL_INTERVAL_MS);
    priority = await listRunningPriorityJobs(ctx.jobId);
  }

  const percent = Math.round(before?.progressPercent ?? 0);
  await updateJob(ctx.jobId, { status: "running", pausedReason: undefined, progress: before?.progress });
  await notifyIfPossible(ctx.req.lineUserId, `▶ AWARDSを再開（${percent}%から）`);
}

// ── 5分毎の進捗LINE push（要件E） ────────────────────────────────

function startProgressPushTimer(ctx: PipelineCtx): ReturnType<typeof setInterval> | undefined {
  if (!ctx.req.lineUserId) return undefined;
  return setInterval(() => {
    void (async () => {
      const config = loadLineConfig();
      if (!config?.channelAccessToken) return;
      const job = await getJob(ctx.jobId);
      if (!job) return;
      const pausedMark = job.status === "paused" ? "⏸ " : "";
      const percent = Math.round(job.progressPercent ?? 0);
      const phaseLabel = job.progress ?? "";
      await pushLineMessage(
        config.channelAccessToken,
        ctx.req.lineUserId,
        `${pausedMark}🏆 AWARDS ${ctx.req.awardName}: ${percent}%（${phaseLabel}）`,
      );
    })().catch((err) => console.error("[studio][awards] progress push failed", err));
  }, PROGRESS_PUSH_INTERVAL_MS);
}

// ── P1: 公式ソース確定 ───────────────────────────────────────────

async function runP1(ctx: PipelineCtx): Promise<{ officialUrl: string; structureNote: string }> {
  if (ctx.checkpoint.officialSourceUrl) {
    return { officialUrl: ctx.checkpoint.officialSourceUrl, structureNote: ctx.checkpoint.structureNote };
  }
  await updateJob(ctx.jobId, {
    progress: "公式ソース確定中",
    progressPercent: Math.round(computePhaseProgress("P1", 0, 1)),
  });
  const def = loadAgentDefinition(AGENTS_DIR, "award-verifier");
  const result = await runAgentQuery(ROOT, "award-verifier", def, buildAwardSourceDiscoveryPrompt(ctx.req.awardName, ctx.req.year));
  await trackCost(ctx, result.costUsd);
  if (!result.ok) {
    throw new Error(`公式ソース確定に失敗しました: ${result.error}`);
  }
  const obj = extractJsonObject(result.text);
  if (!obj || obj.found !== true || typeof obj.officialUrl !== "string" || !obj.officialUrl.trim()) {
    const reason = obj && typeof obj.reason === "string" && obj.reason ? obj.reason : "公式の受賞者一覧が見つかりませんでした";
    throw new AwardSourceNotFoundError(reason);
  }
  const structureNote = typeof obj.structureNote === "string" ? obj.structureNote : "";
  ctx.checkpoint.officialSourceUrl = obj.officialUrl;
  ctx.checkpoint.structureNote = structureNote;
  await updateJob(ctx.jobId, {
    checkpoint: ctx.checkpoint,
    progress: "公式ソース確定",
    progressPercent: Math.round(computePhaseProgress("P1", 1, 1)),
  });
  return { officialUrl: obj.officialUrl, structureNote };
}

// ── 部門一覧の解決（categories:"all"の場合のみ一度だけagentへ問い合わせる） ─────

// 部門名を厳密なJSON配列として返せないAgent応答は珍しくない（実行時実測: 構成メモの自由文に
// 部門名を埋め込んで返すことがある）。部門一覧が1件も解決できない場合、ここで硬く失敗させると
// 「全部門」指定のたびに公式ソースが見つかっているのに中止してしまう。安全側のフォールバックとして
// 単一の疑似部門「全部門」でP2を1回だけ実行する（award-verifierへ渡すcategoryが「全部門」に
// なるため、プロンプト上は「対象部門をまたいで全受賞者を列挙してください」という指示として
// 機能する。部門別並列の恩恵は失うが、収集自体は続行できる）。
const ALL_CATEGORIES_FALLBACK = ["全部門"];

async function resolveCategories(ctx: PipelineCtx, officialUrl: string, structureNote: string): Promise<string[]> {
  if (Array.isArray(ctx.req.categories)) return ctx.req.categories;
  const def = loadAgentDefinition(AGENTS_DIR, "award-verifier");
  const result = await runAgentQuery(
    ROOT,
    "award-verifier",
    def,
    buildAwardCategoryListPrompt({ awardName: ctx.req.awardName, year: ctx.req.year, officialUrl, structureNote }),
  );
  await trackCost(ctx, result.costUsd);
  if (!result.ok) {
    console.warn(`[studio][awards] category list resolution failed, falling back to single pass: ${result.error}`);
    return ALL_CATEGORIES_FALLBACK;
  }
  const arr = extractJsonArray(result.text);
  const categories = (arr ?? []).filter((c): c is string => typeof c === "string" && c.trim().length > 0);
  if (categories.length === 0) {
    console.warn("[studio][awards] category list resolution returned no usable categories, falling back to single pass");
    return ALL_CATEGORIES_FALLBACK;
  }
  return categories;
}

// ── P2: 参照リスト構築（部門並列・境界ごとに一時停止判定・checkpoint永続化） ───────

async function runP2(ctx: PipelineCtx, officialUrl: string, structureNote: string): Promise<void> {
  const { checkpoint } = ctx;

  if (checkpoint.resolvedCategories.length === 0) {
    checkpoint.resolvedCategories = await resolveCategories(ctx, officialUrl, structureNote);
  }
  const allCategories = checkpoint.resolvedCategories;
  const total = allCategories.length;
  if (total === 0) return; // 部門概念が無い/解決できなかった場合は何もせず次フェーズへ

  const def = loadAgentDefinition(AGENTS_DIR, "award-verifier");
  let remaining = allCategories.filter((c) => !checkpoint.categoriesDone.includes(c));

  while (remaining.length > 0) {
    await waitWhilePriorityJobsRunning(ctx);
    const batch = remaining.slice(0, CATEGORY_BATCH_SIZE);
    await persistCheckpoint(ctx, "P2", checkpoint.categoriesDone.length, total, "参照リスト構築中");

    const results = await Promise.all(
      batch.map((category) =>
        runAgentQuery(
          ROOT,
          "award-verifier",
          def,
          buildAwardCategoryCollectPrompt({
            awardName: ctx.req.awardName,
            year: ctx.req.year,
            category,
            minLevelLabel: ctx.req.minLevel,
            officialUrl,
            structureNote,
          }),
        ),
      ),
    );

    for (let i = 0; i < batch.length; i++) {
      const category = batch[i];
      const result = results[i];
      await trackCost(ctx, result.costUsd);

      if (!result.ok) {
        console.warn(`[studio][awards] category collection failed for ${category}:`, result.error);
        checkpoint.categoriesFailed.push(category);
        checkpoint.categoriesDone.push(category);
        continue;
      }
      const arr = extractJsonArray(result.text);
      if (!arr) {
        console.warn(`[studio][awards] category collection returned unparseable JSON for ${category}`);
        checkpoint.categoriesFailed.push(category);
        checkpoint.categoriesDone.push(category);
        continue;
      }
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const w = item as Record<string, unknown>;
        const level = String(w.level ?? "");
        if (!meetsMinLevel(level, ctx.req.minLevel)) continue;
        checkpoint.collectedWinners.push({
          category: String(w.category ?? category),
          subcategory: String(w.subcategory ?? ""),
          level,
          title: String(w.title ?? ""),
          brand: String(w.brand ?? ""),
          agency: String(w.agency ?? ""),
          sourceUrl: String(w.sourceUrl ?? ""),
        });
      }
      checkpoint.categoriesDone.push(category);
    }

    // 部門完了ごとにcheckpointを永続化する（要件C P2）。
    await persistCheckpoint(ctx, "P2", checkpoint.categoriesDone.length, total, "参照リスト構築中");
    remaining = allCategories.filter((c) => !checkpoint.categoriesDone.includes(c));
  }
}

// ── P4: 執筆（work=同一作品単位の境界ごとに一時停止判定・checkpoint永続化） ───────

async function runP4(ctx: PipelineCtx): Promise<void> {
  const { checkpoint, req } = ctx;
  const grouped = groupWinnersByWork(checkpoint.collectedWinners);
  const total = grouped.length;
  if (total === 0) return;

  const existingCases = JSON.parse(await readFile(CASES_PATH, "utf-8")) as Array<{ id: string; title: string; link?: string }>;
  const existingIndex = buildExistingCaseIndex(existingCases);
  const tagVocab = JSON.parse(await readFile(TAG_VOCAB_PATH, "utf-8")) as TagVocabulary;
  const tagVocabFlat = [...tagVocab.Tech, ...tagVocab.Form, ...tagVocab.Theme];
  const caseWriterDef = loadAgentDefinition(AGENTS_DIR, "case-writer");
  const linkCheckerDef = loadAgentDefinition(AGENTS_DIR, "link-checker");

  let done = checkpoint.writtenTitleKeys.length;

  for (const work of grouped) {
    if (checkpoint.writtenTitleKeys.includes(work.titleKey)) continue; // 再開時: 処理済み(執筆済み/却下確定)

    await waitWhilePriorityJobsRunning(ctx);
    await persistCheckpoint(ctx, "P4", done, total, "執筆中");

    const primarySourceUrl = work.records[0]?.sourceUrl || "";
    const id = toCaseId(work.title, req.year, work.brand);
    const titleKeyNorm = normalizeTitleKey(work.title);
    const linkKeyNorm = primarySourceUrl.replace(/\/+$/, "");
    const isDup = existingIndex.ids.has(id) || existingIndex.titleKeys.has(titleKeyNorm) || (!!linkKeyNorm && existingIndex.links.has(linkKeyNorm));
    if (isDup) {
      checkpoint.writtenTitleKeys.push(work.titleKey);
      done++;
      // 指摘4【軽微】再発防止: 成功経路（466行目）と対称に、continue分岐でも
      // writtenTitleKeys.push直後にcheckpointを即時永続化する（遅延すると、この工程が
      // work一覧の最後の要素だった場合に永続化されないままP4が抜けてしまう）。
      await persistCheckpoint(ctx, "P4", done, total, "執筆中");
      continue;
    }

    // リンク死活検証（受賞事実そのものはP2のaward-verifierで既に照合済みのため、ここでは
    // 事例執筆の材料として使うURL/映像/サムネイルの生存確認に絞る — SOPフェーズ4）。
    const linkResult = await runAgentQuery(
      ROOT,
      "link-checker",
      linkCheckerDef,
      buildLinkCheckerPrompt([{ id, title: work.title, link: primarySourceUrl }]),
    );
    await trackCost(ctx, linkResult.costUsd);
    const linkVerdicts = linkResult.ok ? extractJsonArray(linkResult.text) : null;
    const linkVerdict = linkVerdicts?.[0] as { alive?: boolean } | undefined;
    if (!linkResult.ok || !linkVerdict || linkVerdict.alive !== true) {
      console.warn(`[studio][awards] link check failed, skipping: ${work.title}`);
      checkpoint.writtenTitleKeys.push(work.titleKey);
      done++;
      await persistCheckpoint(ctx, "P4", done, total, "執筆中");
      continue;
    }

    const writerResult = await runAgentQuery(
      ROOT,
      "case-writer",
      caseWriterDef,
      buildCaseWriterPrompt(
        [{ id, title: work.title, client: work.brand, agency: work.agency, year: req.year, link: primarySourceUrl, award: "", summary: "" }],
        tagVocabFlat,
      ),
    );
    await trackCost(ctx, writerResult.costUsd);
    const writerArr = writerResult.ok ? extractJsonArray(writerResult.text) : null;
    const writerItem = writerArr?.[0] as Record<string, unknown> | undefined;
    if (!writerResult.ok || !writerItem) {
      console.warn(`[studio][awards] case-writer failed, skipping: ${work.title}`);
      checkpoint.writtenTitleKeys.push(work.titleKey);
      done++;
      await persistCheckpoint(ctx, "P4", done, total, "執筆中");
      continue;
    }

    // award欄は参照リストからの転記のみ（SOPフェーズ4）。同一作品の複数部門受賞は
    // 「 / 」連結（awardPure.ts::buildAwardEntryString）。
    const writer: WriterFields = {
      summary: typeof writerItem.summary === "string" ? writerItem.summary : "",
      categories: Array.isArray(writerItem.categories) ? (writerItem.categories as string[]) : [],
      award: buildAwardEntryString(req.awardName, req.year, work.records),
      regions: Array.isArray(writerItem.regions) ? (writerItem.regions as string[]) : [],
      tags: filterTagsByVocabulary(writerItem.tags, tagVocab),
      overview: typeof writerItem.overview === "string" ? writerItem.overview : "",
      background: typeof writerItem.background === "string" ? writerItem.background : "",
      execution: typeof writerItem.execution === "string" ? writerItem.execution : "",
      evaluationImpact: typeof writerItem.evaluationImpact === "string" ? writerItem.evaluationImpact : "",
      relatedWorks: Array.isArray(writerItem.relatedWorks)
        ? (writerItem.relatedWorks as { title: string; description: string; url: string }[])
        : [],
    };

    const thumb = await acquireThumbnail(id, { title: work.title, client: work.brand, link: primarySourceUrl });
    if (!thumb) {
      console.warn(`[studio][awards] thumbnail acquisition failed, skipping: ${work.title}`);
      checkpoint.writtenTitleKeys.push(work.titleKey);
      done++;
      await persistCheckpoint(ctx, "P4", done, total, "執筆中");
      continue;
    }

    const entry = buildCaseEntry({
      id,
      title: work.title,
      client: work.brand,
      agency: work.agency,
      year: req.year,
      link: primarySourceUrl,
      thumbnail: thumb.thumbnail,
      videoId: thumb.videoId,
      sourceTag: `${req.awardName} ${req.year}`,
      writer,
    });

    checkpoint.writtenEntries.push({ entry: entry as unknown as Record<string, unknown>, thumbnailPath: path.join("public", thumb.thumbnail) });
    checkpoint.writtenTitleKeys.push(work.titleKey);
    existingIndex.ids.add(id);
    existingIndex.titleKeys.add(titleKeyNorm);
    done++;
    // 1件完了ごとにcheckpointを永続化する（要件C P4）。
    await persistCheckpoint(ctx, "P4", done, total, "執筆中");
  }
}

// ── P5: 監査ゲート → 公開（このフェーズでのみgitロックを取得する） ────────────

async function runP5(ctx: PipelineCtx): Promise<void> {
  const { checkpoint, req, jobId } = ctx;
  await persistCheckpoint(ctx, "P5", 0, 1, "監査待ち（gitロック取得中）");

  const lock = await acquireLockWithWait();
  if (!lock) {
    throw new Error('gitロックを30分待っても取得できませんでした。時間をおいて「再開」と送ってください。');
  }

  const trackedTouched: string[] = [];
  const newUntracked: string[] = [];
  let committed = false;
  let commitHash: string | null = null;

  try {
    const refPath = winnersJsonPath(req.awardName, req.year);
    const newEntries = checkpoint.writtenEntries.map((w) => w.entry as unknown as CaseEntry);
    const verifiedCategories = checkpoint.categoriesDone.filter((c) => !checkpoint.categoriesFailed.includes(c));

    // 指摘1【重大】再発防止: P5途中またはcommit直後にプロセスが落ちて再開した場合、
    // checkpoint.p5==="committed"（commit済み・push未確認）なら、ファイル書き込み/監査/
    // git add・commitは一切再実行しない（再実行するとcases.jsonへ同一エントリが
    // 重複prependされ二重コミットされる）。push以降の完了処理のみ行う。
    if (checkpoint.p5 === "committed") {
      commitHash = await gitRevParseHead(ROOT);
      committed = true;
    } else {
      const existingCases = JSON.parse(await readFile(CASES_PATH, "utf-8")) as CaseEntry[];
      // 多重防御その2: checkpoint.p5によるスキップに加え、既存idと重複するエントリは
      // ここでも除外する（想定外の経路でこのブロックが再実行された場合の保険）。
      const dedupedNewEntries = dedupeNewCaseEntries(new Set(existingCases.map((c) => c.id)), newEntries);
      const updatedCases = [...dedupedNewEntries, ...existingCases];
      await writeFile(CASES_PATH, JSON.stringify(updatedCases, null, 2));
      trackedTouched.push("data/cases.json");
      for (const w of checkpoint.writtenEntries) newUntracked.push(w.thumbnailPath);

      const refJson = {
        _note: "ResearchMan Studio AWARDSジョブによる自動生成（award-verifier並列照合。docs/AWARD_RESEARCH_SOP.md）",
        generatedFrom: `award-verifier agents (parallel, official site: ${checkpoint.officialSourceUrl})`,
        generatedAt: new Date().toISOString().slice(0, 10),
        sourceNote: checkpoint.categoriesFailed.length ? `未照合部門: ${checkpoint.categoriesFailed.join(", ")}` : "",
        verifiedCategories,
        winners: checkpoint.collectedWinners,
      };
      await writeFile(refPath, JSON.stringify(refJson, null, 2));
      trackedTouched.push(path.relative(ROOT, refPath).split(path.sep).join("/"));

      checkpoint.p5 = "files-written";
      await persistCheckpoint(ctx, "P5", 0, 1, "品質監査中");

      const awardPrefix = `${req.awardName} ${req.year}`;
      const audits: Array<{ name: string; run: () => Promise<{ ok: boolean; stdout: string; stderr: string }> }> = [
        { name: "audit-award", run: () => runAuditAward(ROOT, refPath, awardPrefix) },
        { name: "audit-thumbnails", run: () => runAuditThumbnails(ROOT) },
        { name: "audit-integrity", run: () => runAuditIntegrity(ROOT) },
        { name: "tsc --noEmit", run: () => runTypeCheck(ROOT) },
        { name: "lint", run: () => runLint(ROOT) },
        { name: "build", run: () => runBuild(ROOT) },
      ];
      for (const audit of audits) {
        const result = await audit.run();
        if (!result.ok) {
          const tail = [result.stderr.trim().slice(-3000), result.stdout.trim().slice(-1500)].filter(Boolean).join("\n---stdout---\n");
          await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
          checkpoint.p5 = "pending";
          await persistCheckpoint(ctx, "P5", 0, 1, "監査失敗・ロールバック済み");
          throw new Error(`品質監査(${audit.name})に失敗しました。反映を中止しロールバックしました。\n${tail}`);
        }
      }

      await persistCheckpoint(ctx, "P5", 0, 1, "反映中（commit/push）");
      const addResult = await gitAdd(ROOT, [...trackedTouched, ...newUntracked]);
      if (!addResult.ok) {
        await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
        checkpoint.p5 = "pending";
        await persistCheckpoint(ctx, "P5", 0, 1, "git add失敗・ロールバック済み");
        throw new Error(`git add に失敗しました: ${addResult.stderr.slice(0, 500)}`);
      }
      const commitResult = await gitCommit(ROOT, buildAwardCommitMessage(req.awardName, req.year, dedupedNewEntries.length));
      if (!commitResult.ok) {
        await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
        checkpoint.p5 = "pending";
        await persistCheckpoint(ctx, "P5", 0, 1, "git commit失敗・ロールバック済み");
        throw new Error(`git commit に失敗しました: ${commitResult.stderr.slice(0, 500)}`);
      }
      committed = true;
      checkpoint.p5 = "committed";
      commitHash = await gitRevParseHead(ROOT);
      await persistCheckpoint(ctx, "P5", 1, 1, "commit完了・push待ち");
    }

    const pushResult = await gitPush(ROOT);
    if (!pushResult.ok) {
      const message = `push に失敗しました（pre-push監査等の可能性）。コミットはローカルに残っています（commit ${commitHash?.slice(0, 8) ?? "不明"}）。手動対応が必要です。`;
      await updateJob(jobId, { status: "error", progress: undefined, error: message, commit: commitHash, cost: ctx.cost.value, checkpoint });
      await notifyIfPossible(req.lineUserId, `AWARDS ${req.awardName}: ${message}`);
      return;
    }

    const resultCards: ResultCard[] = newEntries.map((c) => ({
      kind: "case" as const,
      id: c.id,
      url: `${SITE}/cases/${c.id}`,
      title: c.title,
      meta: [c.client, c.year].filter(Boolean).join(" · "),
      chip: c.award ? { label: c.award, jp: true } : undefined,
    }));

    const verifyResult = await runVerifyDeploy(ROOT, checkpoint.writtenEntries.map((w) => path.basename(w.thumbnailPath)));
    let strictResult: { ok: boolean; failedUrls: string[] } = { ok: true, failedUrls: [] };
    if (verifyResult.ok) {
      strictResult = await pollStrictVerify(newEntries.map((c) => ({ url: `${SITE}/cases/${c.id}`, markers: [c.id] })));
    }
    const verified = verifyResult.ok && strictResult.ok;

    // 完了報告には公式照合済み/未照合部門の内訳を必ず明記する（SOPフェーズ5）。
    const summary = [
      `🏆 AWARDS ${req.awardName} ${req.year}: 完了 ${newEntries.length}件追加`,
      `照合済み部門: ${verifiedCategories.join("、") || "なし"}`,
      `未照合部門: ${checkpoint.categoriesFailed.join("、") || "なし"}`,
      SITE,
    ].join("\n");

    if (verified) {
      await updateJob(jobId, {
        status: "done",
        progress: undefined,
        progressPercent: 100,
        resultCards,
        commit: commitHash,
        deployedUrl: SITE,
        cost: ctx.cost.value,
        checkpoint,
      });
      await notifyIfPossible(req.lineUserId, summary);
    } else {
      await updateJob(jobId, {
        status: "done",
        progress: undefined,
        progressPercent: 100,
        warning: "反映確認が時間切れでした。数分後に本番へ反映される見込みです。",
        resultCards,
        commit: commitHash,
        deployedUrl: SITE,
        cost: ctx.cost.value,
        checkpoint,
      });
      await notifyIfPossible(req.lineUserId, `${summary}\n（反映確認が時間切れのため、数分後にご確認ください）`);
    }
  } finally {
    lock.release();
  }
}

// ── dryRun（ミニE2E用。要件・完了条件2）: P1+P2を最大1部門だけ実行し、書き込み・git・LINEを
//    スキップしてjob.awardPreviewに記録して終了する ──────────────────────────

async function runDryRun(ctx: PipelineCtx): Promise<void> {
  const source = await runP1(ctx);
  const categories = await resolveCategories(ctx, source.officialUrl, source.structureNote);
  const firstCategory = categories[0];
  const winners: AwardCheckpointWinner[] = [];

  if (firstCategory) {
    await updateJob(ctx.jobId, {
      progress: `参照リスト構築中（部門: ${firstCategory}。dryRun）`,
      progressPercent: Math.round(computePhaseProgress("P2", 0, 1)),
    });
    const def = loadAgentDefinition(AGENTS_DIR, "award-verifier");
    const result = await runAgentQuery(
      ROOT,
      "award-verifier",
      def,
      buildAwardCategoryCollectPrompt({
        awardName: ctx.req.awardName,
        year: ctx.req.year,
        category: firstCategory,
        minLevelLabel: ctx.req.minLevel,
        officialUrl: source.officialUrl,
        structureNote: source.structureNote,
      }),
    );
    await trackCost(ctx, result.costUsd);
    if (result.ok) {
      const arr = extractJsonArray(result.text) ?? [];
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const w = item as Record<string, unknown>;
        const level = String(w.level ?? "");
        if (!meetsMinLevel(level, ctx.req.minLevel)) continue;
        winners.push({
          category: String(w.category ?? firstCategory),
          subcategory: String(w.subcategory ?? ""),
          level,
          title: String(w.title ?? ""),
          brand: String(w.brand ?? ""),
          agency: String(w.agency ?? ""),
          sourceUrl: String(w.sourceUrl ?? ""),
        });
      }
    } else {
      console.warn("[studio][awards] dryRun: category collection failed:", result.error);
    }
  }

  await updateJob(ctx.jobId, {
    status: "done",
    progress: undefined,
    progressPercent: 100,
    cost: ctx.cost.value,
    awardPreview: {
      officialSourceUrl: source.officialUrl,
      winners: winners as unknown as Array<Record<string, unknown>>,
    },
  });
}

// ── オーケストレーション本体（fresh start / resume 共通） ────────────────────

async function runCore(jobId: string, req: ValidatedAwardRequest, checkpoint: AwardCheckpoint): Promise<void> {
  if (activeJobIds.has(jobId)) return; // 二重再開防止（要件D.4）
  activeJobIds.add(jobId);

  const budget = createJobBudgetTracker(resolveAwardBudgetUsd());
  const ctx: PipelineCtx = { jobId, req, checkpoint, budget, cost: { value: 0 } };
  const timer = req.dryRun ? undefined : startProgressPushTimer(ctx);

  try {
    if (req.dryRun) {
      await runDryRun(ctx);
      return;
    }

    const source = await runP1(ctx);

    await waitWhilePriorityJobsRunning(ctx);
    await runP2(ctx, source.officialUrl, source.structureNote);

    await persistCheckpoint(ctx, "P3", 1, 1, "参照リスト確定");

    await waitWhilePriorityJobsRunning(ctx);
    await runP4(ctx);

    if (checkpoint.writtenEntries.length === 0) {
      await updateJob(jobId, {
        status: "done",
        progress: undefined,
        progressPercent: 100,
        resultCards: [],
        cost: ctx.cost.value,
        checkpoint,
        warning: "対象条件（部門・レベル下限）に合致する新規事例が見つかりませんでした。",
      });
      await notifyIfPossible(req.lineUserId, `AWARDS ${req.awardName} ${req.year}: 追加対象が見つかりませんでした（条件を変えてお試しください）`);
      return;
    }

    await runP5(ctx);
  } catch (err) {
    if (err instanceof PipelinePausedError) return; // 一時停止処理は既に完了済み
    if (err instanceof AwardSourceNotFoundError) {
      const message = `公式の受賞者一覧が見つからないため中止。トレード記事のみでの確定はSOPで禁止（${err.message}）`;
      await updateJob(jobId, { status: "error", progress: undefined, error: message, cost: ctx.cost.value });
      await notifyIfPossible(
        req.lineUserId,
        `AWARDS ${req.awardName}: 公式の受賞者一覧が見つからないため中止しました。トレード記事のみでの確定はSOPで禁止されています。`,
      );
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[studio][awards] pipeline failed", err);
    await updateJob(jobId, { status: "error", progress: undefined, error: message, cost: ctx.cost.value, checkpoint });
    await notifyIfPossible(req.lineUserId, `AWARDS ${req.awardName}: 失敗しました: ${message}`);
  } finally {
    if (timer) clearInterval(timer);
    activeJobIds.delete(jobId);
  }
}

// ── エントリポイント ─────────────────────────────────────────────

/** 新規ジョブの実行開始（jobs.ts::createJob("awards", ...)が呼ぶ）。 */
export async function runAwardResearchPipeline(jobId: string, req: ValidatedAwardRequest): Promise<void> {
  await runCore(jobId, req, emptyAwardCheckpoint());
}

/**
 * 一時停止中（または孤児化してpausedへ落とした）ジョブをcheckpointから再開する
 * （LINEの「再開」キーワード・サーバ起動時の自動再開の両方がこの関数を呼ぶ）。
 * 新しい予算トラッカーで実行される（要件D.3: 「再開」で新しい予算枠から続行）。
 */
export async function resumeAwardJob(jobId: string): Promise<void> {
  if (activeJobIds.has(jobId)) return;
  const job = await getJob(jobId);
  if (!job || job.tab !== "awards") return;
  const validated = validateAwardRequest(job.request);
  if (!validated.ok) {
    await updateJob(jobId, { status: "error", progress: undefined, error: `再開に失敗しました（依頼内容が不正です）: ${validated.error}` });
    return;
  }
  const checkpoint = parseAwardCheckpoint(job.checkpoint);
  await updateJob(jobId, { status: "running", pausedReason: undefined });
  await runCore(jobId, validated.value, checkpoint);
}

/**
 * サーバ起動時の復帰（要件D.4。index.ts起動処理から呼ぶ）。workdir/jobsを走査し、
 * classifyAwardJobForStartup の判定に従って自動再開/待機を振り分ける。
 */
export async function recoverAwardJobsOnStartup(): Promise<void> {
  const jobs = await listJobs();
  for (const job of jobs) {
    const action = classifyAwardJobForStartup(job);
    if (action === "ignore" || action === "wait-budget") continue;
    if (action === "mark-restart-and-resume") {
      await updateJob(job.id, { status: "paused", pausedReason: "restart" });
    }
    resumeAwardJob(job.id).catch((err) => {
      console.error(`[studio][awards] startup resume failed for job ${job.id}`, err);
    });
  }
}
