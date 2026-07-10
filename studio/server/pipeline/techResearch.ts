/**
 * Research(Technology) 実パイプライン（DESIGN.md §6・§10 P2）。
 *
 * 収集(発掘+執筆1パス・最大2ラウンド) → 重複/書式検証 → 一次ソース死活検証 →
 * サムネイル取得 → 反映(data/tech.json) → 監査(audit-tech/tsc/lint/build) →
 * commit/push → verify-deploy(--skip-pages)+verify-tech-pages → notify-line、を
 * caseResearch.ts と同じ品質ガードレール・git運用・ロールバック方式で実行する
 * （収集プロンプト・文体は scripts/auto-research-tech.mjs をテーマ駆動用に踏襲。
 * scripts/側は無改変）。
 *
 * 人の承認は無い（完全自動、DESIGN.md §5）。commit前の失敗は必ず rollbackTouchedFiles()で
 * 作業ツリーを戻す。committed=true以降は一切ロールバックしない
 * （rollbackIfNotCommittedはcaseResearch.tsのものを再利用。判定ロジックはタブに依存しない）。
 *
 * data/tech.json・data/cases.json は lock保持中（=デイリージョブと排他）にパイプライン内で
 * 一度だけ読み、以降は使い回す（重複読み込みを避ける。他プロセスによる変更は
 * tryAcquireLock() が排他しているため発生しない）。
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gitAdd,
  gitCommit,
  gitPush,
  gitRevParseHead,
  rollbackTouchedFiles,
  runAuditTech,
  runBuild,
  runLint,
  runNotifyLine,
  runTypeCheck,
  runVerifyDeploy,
  runVerifyTechPages,
} from "./audit.js";
import { rollbackIfNotCommitted } from "./caseResearch.js";
import { appendCountShortfallWarning } from "./ideaPure.js";
import type { LoadedAgentDefinition } from "./agentLoader.js";
import { updateJob, type ResultCard } from "../jobs.js";
import { extractJsonArray, normalizeTitleKey, type ValidatedResearchRequest } from "./pure.js";
import { buildTechCollectorPrompt } from "./techPrompts.js";
import {
  buildExistingTechIndex,
  buildTechCommitMessage,
  buildTechEntry,
  findPrimaryLink,
  validateAndDedupeTechCandidates,
  type ExistingTechIndex,
  type TechEntry,
  type TechVocab,
  type ValidatedTechCandidate,
} from "./techPure.js";
import { acquireTechThumbnail } from "./techThumbnail.js";
import { isUrlAlive } from "./techExternalScripts.js";
import { tryAcquireLock } from "./lock.js";
import { runAgentQuery } from "./sdkRunner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", ".."); // studio/server/pipeline -> repo root
const TECH_PATH = path.join(ROOT, "data", "tech.json");
const CASES_PATH = path.join(ROOT, "data", "cases.json");
const VOCAB_PATH = path.join(ROOT, "data", "tech-tag-vocabulary.json");
const THUMB_DIR = path.join(ROOT, "public", "thumbnails", "tech");
const LAST_TECH_ADD_PATH = "/tmp/researchman-tech-last-add.json";
const SITE = "https://research-man.vercel.app";
const SOURCE_LABEL = "Batch Research"; // TECHNOLOGY_SPEC.md §5: 一括リサーチ由来（Studioオンデマンドもここに含める）
const MAX_GEN_ROUNDS = 2; // scripts/auto-research-tech.mjs::MAX_ROUNDS と同じ考え方

// .claude/agents/*.md を持たないため、Studio専用のエージェント定義をコードで直接持つ
// （agentLoader.tsのLoadedAgentDefinition互換オブジェクト。定義ファイルを新設しない
// ＝「共通化より薄い実装を優先」）。model/toolsは scripts/auto-research-tech.mjs の
// MODEL="sonnet" / allowedTools="WebSearch,WebFetch" に合わせる。
const TECH_COLLECTOR_DEF: LoadedAgentDefinition = {
  description: "Technology（先端技術）調査・記事執筆の専門エージェント。",
  tools: ["WebSearch", "WebFetch"],
  model: "sonnet",
  prompt: `Technology（先端技術）調査・記事執筆の専門エージェント。ResearchMan Technology タブ
（TECHNOLOGY_SPEC.md準拠）に掲載する技術を発掘し、日本語記事を書く。

手順:
1. 指定されたテーマ・観点でWeb検索し、クライテリアに適合する技術を発掘する
2. 一次ソース（GitHub README・プロジェクトページ・論文）をWebFetchで実際に開いて読む
3. 技術者でなくてもわかる日本語で概要・ポイント・詳細を執筆する

規則:
- URLが実在しない技術は返さない。捏造は最悪の失敗
- 一次ソースを読まずに書いた記事は出力しない
- クライテリアに適合しない技術（論文のみ・コード未公開・製品ニュースのみ等）は候補に含めない`,
};

async function setProgress(jobId: string, progress: string): Promise<void> {
  await updateJob(jobId, { progress });
}

// notify-line.mjs は「おまけ」設計で常にexit 0のため、送信成否をログへ転記する
// （caseResearch.tsと同じ理由・2026-07-10）。
function notifyLine(args: string[]): void {
  const result = runNotifyLine(ROOT, args);
  console.log(`[studio] notify-line: ${result.stdout.trim() || result.stderr.trim() || "(no output)"}`);
}

async function fail(jobId: string, theme: string, message: string): Promise<void> {
  await updateJob(jobId, { status: "error", progress: undefined, error: message });
  notifyLine(["--result", "error", "--route", "technology", "--label", `Studio: ${theme}`]);
}

interface RawCandidateWithName {
  techName?: unknown;
  verdict?: unknown;
  [key: string]: unknown;
}

/**
 * 収集エージェントを最大 MAX_GEN_ROUNDS 回呼ぶ（既に検証通過数が目標に達したら早期終了）。
 * 生の候補配列（検証前）とコストを返す。検証・重複除外は呼び出し側で一括して行う
 * （raws を毎ラウンド累積し、常に「これまでの全候補」で検証し直すことで
 * ラウンド跨ぎの自己重複も自然に除外できる）。
 */
async function runCollectionRounds(
  theme: string,
  viewpoint: string,
  refUrl: string,
  count: number,
  vocab: TechVocab,
  existingTech: ExistingTechIndex,
  existingCaseTitleKeys: Set<string>,
  existingTechTitles: string[],
): Promise<{ raws: RawCandidateWithName[]; costUsd: number }> {
  let costUsd = 0;
  const raws: RawCandidateWithName[] = [];
  const seenThisRun: string[] = [];

  for (let round = 1; round <= MAX_GEN_ROUNDS; round++) {
    const { accepted } = validateAndDedupeTechCandidates(raws, vocab, existingTech, existingCaseTitleKeys);
    if (accepted.length >= count) break;
    const remaining = count - accepted.length;
    const targetCount = Math.max(2, remaining * 2);
    const result = await runAgentQuery(
      ROOT,
      "tech-collector",
      TECH_COLLECTOR_DEF,
      buildTechCollectorPrompt({
        theme,
        viewpoint,
        refUrl,
        targetCount,
        excludeTitles: [...existingTechTitles, ...seenThisRun],
      }),
    );
    if (!result.ok) {
      console.warn(`[studio] tech collector round ${round} failed:`, result.error);
      continue;
    }
    costUsd += result.costUsd;
    const arr = extractJsonArray(result.text);
    if (!arr) {
      console.warn("[studio] tech collector returned unparseable JSON");
      continue;
    }
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const rec = item as RawCandidateWithName;
      raws.push(rec);
      if (rec.verdict === "adopt" && typeof rec.techName === "string") seenThisRun.push(rec.techName);
    }
  }

  return { raws, costUsd };
}

export async function runTechResearchPipeline(jobId: string, req: ValidatedResearchRequest): Promise<void> {
  const { theme, viewpoint, refUrl, count } = req;
  let costUsd = 0;

  const lock = tryAcquireLock();
  if (!lock) {
    await updateJob(jobId, {
      status: "error",
      progress: undefined,
      error: "デイリージョブ実行中です。しばらく後に再実行してください。",
    });
    return;
  }

  const trackedTouched: string[] = [];
  const newUntracked: string[] = [];
  let committed = false;
  let commitHash: string | null = null;
  let resultCards: ResultCard[] = [];

  try {
    await setProgress(jobId, "既存データ読み込み中");
    const existingTechFull = JSON.parse(await readFile(TECH_PATH, "utf-8")) as TechEntry[];
    const existingTechTitles = existingTechFull.map((t) => t.title);
    const existingTech = buildExistingTechIndex(existingTechFull);
    const cases = JSON.parse(await readFile(CASES_PATH, "utf-8")) as Array<{ title: string }>;
    const existingCaseTitleKeys = new Set(cases.map((c) => normalizeTitleKey(c.title)));
    const vocab = JSON.parse(await readFile(VOCAB_PATH, "utf-8")) as TechVocab;

    // ── 1. 収集（発掘+執筆1パス・最大2ラウンド） ─────────────────
    await setProgress(jobId, "技術収集中（発掘・記事執筆）");
    const { raws, costUsd: collectCost } = await runCollectionRounds(
      theme,
      viewpoint,
      refUrl,
      count,
      vocab,
      existingTech,
      existingCaseTitleKeys,
      existingTechTitles,
    );
    costUsd += collectCost;

    if (raws.length === 0) {
      throw new Error(
        "収集フェーズで候補が得られませんでした（WebSearch結果が空、またはAgent呼び出しに失敗した可能性があります）",
      );
    }

    // ── 2. 重複・書式検証 ──────────────────────────────────────
    await setProgress(jobId, "重複・書式を検証中");
    const { accepted, rejected } = validateAndDedupeTechCandidates(raws, vocab, existingTech, existingCaseTitleKeys);
    if (rejected.length > 0) {
      console.log(`[studio] tech候補${rejected.length}件を却下:`, rejected.map((r) => `${r.id}: ${r.reason}`).join(" / "));
    }
    if (accepted.length === 0) {
      throw new Error("検証を通過した技術候補がありませんでした（重複または形式不正）");
    }
    const workingSet = accepted.slice(0, count * 2);

    // ── 3. 一次ソース死活検証 ────────────────────────────────────
    await setProgress(jobId, "技術情報の一次ソースを検証中");
    const aliveChecked: ValidatedTechCandidate[] = [];
    for (const c of workingSet) {
      const primary = findPrimaryLink(c.links);
      if (!primary) continue; // 理論上validateAndDedupeTechCandidatesで既に弾かれている
      const alive = await isUrlAlive(primary.url);
      if (alive) aliveChecked.push(c);
      else console.warn(`[studio] 一次ソース到達不可のため却下: ${c.title} (${primary.url})`);
    }
    if (aliveChecked.length === 0) {
      throw new Error("一次ソース検証を通過した技術候補がありませんでした（すべて死リンクと判定）");
    }

    // ── 4. サムネイル取得 ────────────────────────────────────────
    await setProgress(jobId, "技術サムネイル取得中");
    const withThumbnails: Array<{ candidate: ValidatedTechCandidate; thumbnail: string }> = [];
    for (const c of aliveChecked.slice(0, count)) {
      const thumb = await acquireTechThumbnail(THUMB_DIR, c.id, c.links, c.thumbnailSource);
      if (thumb) {
        withThumbnails.push({ candidate: c, thumbnail: thumb.thumbnail });
        newUntracked.push(path.join("public", thumb.thumbnail));
      } else {
        console.warn(`[studio] thumbnail acquisition failed, dropping candidate: ${c.id}`);
      }
    }
    if (withThumbnails.length === 0) {
      throw new Error("サムネイル画像を確保できた技術候補がありませんでした");
    }
    const warningMsg = appendCountShortfallWarning(withThumbnails.length, count, undefined);

    // ── 5. 反映（データ書き込み） ─────────────────────────────────
    await setProgress(jobId, "反映中（データ書き込み）");
    const finalEntries: TechEntry[] = withThumbnails.map(({ candidate, thumbnail }) =>
      buildTechEntry(candidate, thumbnail, SOURCE_LABEL),
    );
    const updatedTech = [...finalEntries, ...existingTechFull];
    await writeFile(TECH_PATH, JSON.stringify(updatedTech, null, 2));
    trackedTouched.push("data/tech.json");

    resultCards = finalEntries.map((t) => ({
      kind: "tech" as const,
      id: t.id,
      url: `${SITE}/technology/${t.id}`,
      title: t.title,
      meta: [t.org, t.year].filter(Boolean).join(" · "),
      chip: { label: t.type, jp: false },
    }));

    // ── 6. 品質監査 ──────────────────────────────────────────────
    await setProgress(jobId, "品質監査中（tech整合/tsc/lint/build）");
    const audits: Array<{ name: string; run: () => { ok: boolean; stdout: string; stderr: string } }> = [
      { name: "audit-tech", run: () => runAuditTech(ROOT) },
      { name: "tsc --noEmit", run: () => runTypeCheck(ROOT) },
      { name: "lint", run: () => runLint(ROOT) },
      { name: "build", run: () => runBuild(ROOT) },
    ];
    for (const audit of audits) {
      const result = audit.run();
      if (!result.ok) {
        const tail = [result.stderr.trim().slice(-3000), result.stdout.trim().slice(-1500)]
          .filter(Boolean)
          .join("\n---stdout---\n");
        await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
        throw new Error(`品質監査(${audit.name})に失敗しました。反映を中止しロールバックしました。\n${tail}`);
      }
    }

    // ── 7. commit/push ───────────────────────────────────────────
    await setProgress(jobId, "反映中（commit/push）");
    const addResult = gitAdd(ROOT, [...trackedTouched, ...newUntracked]);
    if (!addResult.ok) {
      await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
      throw new Error(`git add に失敗しました: ${addResult.stderr.slice(0, 500)}`);
    }
    const commitMsg = buildTechCommitMessage(theme, withThumbnails.length);
    const commitResult = gitCommit(ROOT, commitMsg);
    if (!commitResult.ok) {
      await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
      throw new Error(`git commit に失敗しました: ${commitResult.stderr.slice(0, 500)}`);
    }
    committed = true;
    commitHash = gitRevParseHead(ROOT);

    const pushResult = gitPush(ROOT);
    if (!pushResult.ok) {
      notifyLine(["--result", "pushfail", "--route", "technology", "--label", `Studio: ${theme}`]);
      await updateJob(jobId, {
        status: "error",
        progress: undefined,
        error: `push に失敗しました（pre-push監査等の可能性）。コミットはローカルに残っています（commit ${commitHash?.slice(0, 8) ?? "不明"}）。手動対応が必要です。`,
        commit: commitHash,
      });
      return;
    }

    // ── 8. verify-deploy / verify-tech-pages / notify-line ───────
    await setProgress(jobId, "本番反映を確認中");
    await writeFile(
      LAST_TECH_ADD_PATH,
      JSON.stringify(
        { count: withThumbnails.length, cases: finalEntries.map((t) => ({ id: t.id, title: t.title, year: t.year })) },
        null,
        2,
      ),
    );
    // Technology日次パイプラインと同じ回避策: verify-deploy.mjsの既定ページ検証はCase Study用
    // サマリーを読むため --skip-pages で無効化し、代わりに verify-tech-pages.mjs で
    // /technology/<id> の反映を確認する（scripts/verify-tech-pages.mjs参照）。
    const verifyDeployResult = runVerifyDeploy(ROOT, [], ["--skip-pages"]);
    const verifyPagesResult = runVerifyTechPages(ROOT);
    const verified = verifyDeployResult.ok && verifyPagesResult.ok;

    if (verified) {
      notifyLine(["--summary", LAST_TECH_ADD_PATH, "--route", "technology", "--label", `Studio: ${theme}`]);
      await updateJob(jobId, {
        status: "done",
        progress: undefined,
        warning: warningMsg,
        resultCards,
        commit: commitHash,
        deployedUrl: SITE,
        cost: costUsd,
      });
    } else {
      notifyLine(["--result", "unverified", "--summary", LAST_TECH_ADD_PATH, "--route", "technology", "--label", `Studio: ${theme}`]);
      await updateJob(jobId, {
        status: "done",
        progress: undefined,
        warning: [warningMsg, "反映確認が時間切れでした。数分後に本番へ反映される見込みです。"].filter(Boolean).join(" / "),
        resultCards,
        commit: commitHash,
        deployedUrl: SITE,
        cost: costUsd,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await rollbackIfNotCommitted(committed, trackedTouched, newUntracked, (tracked, untracked) =>
      rollbackTouchedFiles(ROOT, tracked, untracked),
    );
    if (committed) {
      console.error("[studio] tech commit後の例外（ロールバックはスキップ）:", err);
      notifyLine(["--result", "unverified", "--route", "technology", "--label", `Studio: ${theme}`]);
      await updateJob(jobId, {
        status: "done",
        progress: undefined,
        warning: `反映後の処理でエラーが発生しました（データは本番に反映済みの可能性があります。commit ${commitHash?.slice(0, 8) ?? "不明"}）: ${message}`,
        resultCards,
        commit: commitHash,
        deployedUrl: SITE,
        cost: costUsd,
      });
    } else {
      await fail(jobId, theme, message);
    }
  } finally {
    lock.release();
  }
}
