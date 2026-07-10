/**
 * idea(テーマ駆動アイディエーション) 実パイプライン（DESIGN.md §6・§10 P3）。
 *
 * 切り口選定(data/idea-angles.json) → 検索キーワード抽出 → 関連Case/Techのretrieve
 * （search-cases.mjs＋tech.jsonスコアリング） → 生成(Agent SDK 1パス) → 機械検証
 * （スキーマ/seed書式/pattern語彙/refs実在/重複除外） → 反映(ideas.json+idea-layouts.json
 * ペアコミット) → 監査(root build) → commit/push → verify-deploy(--skip-pages) →
 * notify-line、を caseResearch.ts と同じ品質ガードレール・git運用・ロールバック方式で実行する。
 *
 * 人の承認は無い（完全自動、DESIGN.md §5）。commit前の失敗は必ずrollbackTouchedFiles()で
 * 作業ツリーを戻す。committed=true以降は一切ロールバックしない
 * （rollbackIfNotCommittedはcaseResearch.tsのものをそのまま再利用。判定ロジックはタブに依存しない）。
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jstDateString } from "../../../scripts/lib/jst-date.mjs";
import { readIdeasJsonSafe, writeJsonAtomic } from "../../../scripts/lib/ideas-io.mjs";
import { runIdeaLayoutsPrecompute } from "../../../scripts/lib/run-idea-layouts-precompute.mjs";
import {
  gitAdd,
  gitCommit,
  gitPush,
  gitRevParseHead,
  rollbackTouchedFiles,
  runBuild,
  runNotifyLine,
  runVerifyDeploy,
} from "./audit.js";
import { rollbackIfNotCommitted } from "./caseResearch.js";
import { loadIdeaAngles } from "./ideaAngles.js";
import { runSearchCases } from "./ideaExternalScripts.js";
import { fetchFavoriteIds, loadFavSyncConfig } from "./ideaFavorites.js";
import { buildIdeaWriterPrompt, buildKeywordExtractionPrompt, type AngleWithExemplars } from "./ideaPrompts.js";
import {
  appendCountShortfallWarning,
  buildIdeaCommitMessage,
  buildIdeaLineText,
  endsWithKamo,
  isAllowedPattern,
  isDuplicateIdea,
  nextStudioIdeaSeq,
  resolveIdeaRef,
  scoreTechCandidates,
  selectAngles,
  type CaseRecord,
  type IdeaEntry,
  type RawIdeaCandidate,
  type TechRecord,
  type ValidatedIdeaRequest,
} from "./ideaPure.js";
import { extractJsonArray } from "./pure.js";
import { tryAcquireLock } from "./lock.js";
import { runPlainQuery } from "./sdkRunner.js";
import { updateJob, type IdeaRefChip, type ResultCard } from "../jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", ".."); // studio/server/pipeline -> repo root
const CASES_PATH = path.join(ROOT, "data", "cases.json");
const TECH_PATH = path.join(ROOT, "data", "tech.json");
const IDEAS_JSON_PATH = path.join(ROOT, "data", "ideas.json");
const LAST_IDEA_TEXT_PATH = "/tmp/researchman-studio-idea-last.txt";
const SITE = "https://research-man.vercel.app";
const IDEAS_URL = `${SITE}/ideas`;
const MAX_GEN_ATTEMPTS = 3;

async function setProgress(jobId: string, progress: string): Promise<void> {
  await updateJob(jobId, { progress });
}

// notify-line.mjs は常にexit 0（設定不備・送信失敗でも本体を止めない「おまけ」設計）のため、
// 送信成否をログへ転記して可観測性を持たせる（caseResearch.tsと同じ理由・2026-07-10）。
function notifyLine(args: string[]): void {
  const result = runNotifyLine(ROOT, args);
  console.log(`[studio] notify-line: ${result.stdout.trim() || result.stderr.trim() || "(no output)"}`);
}

async function fail(jobId: string, theme: string, message: string): Promise<void> {
  await updateJob(jobId, { status: "error", progress: undefined, error: message });
  notifyLine(["--result", "error", "--label", `Studio: ${theme}`]);
}

export async function runIdeaResearchPipeline(jobId: string, req: ValidatedIdeaRequest): Promise<void> {
  const { theme, constraint, source, count } = req;
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
  let warningMsg: string | undefined;

  try {
    await setProgress(jobId, "既存データ読み込み中");
    const cases = JSON.parse(await readFile(CASES_PATH, "utf-8")) as CaseRecord[];
    const tech = JSON.parse(await readFile(TECH_PATH, "utf-8")) as TechRecord[];
    const angles = loadIdeaAngles(ROOT);
    const existingIdeas = await readIdeasJsonSafe(IDEAS_JSON_PATH);
    const caseById = new Map(cases.map((c) => [c.id, c]));
    const techById = new Map(tech.map((t) => [t.id, t]));

    // ── 1. お気に入り解決（DESIGN.md §6・タスク指示: 取得不能なら偽装せず全事例フォールバック） ──
    let favoriteCaseIds: Set<string> | null = null;
    if (source === "お気に入り中心") {
      await setProgress(jobId, "お気に入りを確認中");
      try {
        const cfg = await loadFavSyncConfig();
        if (!cfg) throw new Error("お気に入り同期の設定がありません");
        favoriteCaseIds = await fetchFavoriteIds(cfg);
      } catch (err) {
        console.warn("[studio] favorites unavailable, falling back to all cases:", err);
        warningMsg = "お気に入りデータ未接続のため全事例から生成しました";
      }
    }

    // ── 2. 切り口選定 ──────────────────────────────────────────
    await setProgress(jobId, "切り口を選定中");
    const selectedAngles = selectAngles(angles, count, favoriteCaseIds);
    const allowedLabels = new Set(selectedAngles.map((a) => a.label));

    // ── 3. 検索キーワード抽出 ────────────────────────────────────
    await setProgress(jobId, "検索キーワードを抽出中");
    let keywords: string[] = [theme];
    try {
      const kwResult = await runPlainQuery(buildKeywordExtractionPrompt(theme, constraint), "haiku");
      if (kwResult.ok) {
        costUsd += kwResult.costUsd;
        const arr = extractJsonArray(kwResult.text);
        const extracted = (arr || []).filter((x): x is string => typeof x === "string" && x.trim().length > 0);
        if (extracted.length > 0) keywords = extracted.map((k) => k.trim());
      }
    } catch (err) {
      console.warn("[studio] idea keyword extraction failed, using theme as-is:", err);
    }

    // ── 4. 関連事例・技術のretrieve（具体の触発材料） ──────────────
    await setProgress(jobId, "関連事例・技術を検索中");
    const caseCandidates = runSearchCases(ROOT, keywords, Math.max(8, count * 2));
    const techCandidates = scoreTechCandidates(tech, keywords, Math.max(6, count));
    const allowedRefIds = new Set<string>([
      ...caseCandidates.map((c) => c.id),
      ...techCandidates.map((t) => t.id),
      ...selectedAngles.flatMap((a) => a.exemplarCaseIds),
    ]);

    // ── 5. 生成（Agent SDK 1パス・最大3回リトライ） ──────────────
    await setProgress(jobId, "アイデア生成中");
    const angleInputs: AngleWithExemplars[] = selectedAngles.map((angle) => ({
      angle,
      exemplars: angle.exemplarCaseIds
        .map((id) => caseById.get(id))
        .filter((c): c is CaseRecord => !!c)
        .slice(0, 3),
    }));
    const writerPrompt = buildIdeaWriterPrompt({ theme, constraint, angles: angleInputs, caseCandidates, techCandidates });

    let rawIdeas: unknown[] | null = null;
    let genError = "";
    for (let attempt = 1; attempt <= MAX_GEN_ATTEMPTS; attempt++) {
      const genResult = await runPlainQuery(writerPrompt, "sonnet");
      if (!genResult.ok) {
        genError = genResult.error || "生成呼び出しに失敗しました";
        continue;
      }
      costUsd += genResult.costUsd;
      const arr = extractJsonArray(genResult.text);
      if (!arr) {
        genError = "生成結果のJSON解析に失敗しました";
        continue;
      }
      rawIdeas = arr;
      break;
    }
    if (!rawIdeas) {
      throw new Error(`アイデア生成に${MAX_GEN_ATTEMPTS}回失敗しました: ${genError}`);
    }

    // ── 6. 機械検証・エントリ組み立て ────────────────────────────
    await setProgress(jobId, "生成結果を検証中");
    const dateStr = jstDateString();
    let seq = nextStudioIdeaSeq(existingIdeas, dateStr);
    const newEntries: IdeaEntry[] = [];
    // 重複判定は既存ideas.json + 今回すでに採用した分の両方に対して行う（今回内の自己重複も除外）
    const workingExisting: Array<{ title?: string; seed?: string }> = [...existingIdeas];

    for (const raw of rawIdeas) {
      if (!raw || typeof raw !== "object") continue;
      const rec = raw as RawIdeaCandidate;
      const title = typeof rec.title === "string" ? rec.title.trim() : "";
      const seed = typeof rec.seed === "string" ? rec.seed.trim() : "";
      if (!title || !seed) continue;
      if (!endsWithKamo(seed)) continue;
      if (!isAllowedPattern(rec.pattern, allowedLabels)) continue;
      if (isDuplicateIdea({ title, seed }, workingExisting)) continue;

      const refsRaw = Array.isArray(rec.refs) ? rec.refs : [];
      const refs = refsRaw
        .map((r) => resolveIdeaRef(r, allowedRefIds, caseById, techById))
        .filter((r): r is NonNullable<typeof r> => !!r);

      seq++;
      const entry: IdeaEntry = {
        id: `studio-${dateStr}-${seq}`,
        date: dateStr,
        title,
        pattern: rec.pattern as string,
        seed,
        refs,
      };
      newEntries.push(entry);
      workingExisting.push(entry);
    }

    if (newEntries.length === 0) {
      throw new Error("検証を通過したアイデアが1件もありませんでした（形式不正または既存との重複）");
    }
    warningMsg = appendCountShortfallWarning(newEntries.length, count, warningMsg);

    resultCards = newEntries.map((e) => ({
      kind: "idea" as const,
      id: e.id,
      url: IDEAS_URL,
      title: e.title,
      angle: e.pattern,
      seed: e.seed,
      refs: e.refs.map((r): IdeaRefChip => ({ type: r.type, label: r.title })),
    }));

    // ── 7. 反映（ideas.json + idea-layouts.json ペア） ──────────
    await setProgress(jobId, "反映中（データ書き込み）");
    const updatedIdeas = [...existingIdeas, ...newEntries];
    await writeJsonAtomic(IDEAS_JSON_PATH, updatedIdeas);
    trackedTouched.push("data/ideas.json");

    const precomputeOk = runIdeaLayoutsPrecompute();
    if (!precomputeOk) {
      await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
      throw new Error("idea-layouts.json の再計算に失敗しました。反映を中止しロールバックしました。");
    }
    trackedTouched.push("data/idea-layouts.json");

    // ── 8. 監査（root next build。ideas.json破損が/ideasページを壊さないことの最終確認） ──
    await setProgress(jobId, "品質監査中（build）");
    const buildResult = runBuild(ROOT);
    if (!buildResult.ok) {
      const tail = [buildResult.stderr.trim().slice(-3000), buildResult.stdout.trim().slice(-1500)]
        .filter(Boolean)
        .join("\n---stdout---\n");
      await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
      throw new Error(`品質監査(build)に失敗しました。反映を中止しロールバックしました。\n${tail}`);
    }

    // ── 9. commit/push ────────────────────────────────────────
    await setProgress(jobId, "反映中（commit/push）");
    const addResult = gitAdd(ROOT, trackedTouched);
    if (!addResult.ok) {
      await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
      throw new Error(`git add に失敗しました: ${addResult.stderr.slice(0, 500)}`);
    }
    const commitMsg = buildIdeaCommitMessage(theme, newEntries.length);
    const commitResult = gitCommit(ROOT, commitMsg);
    if (!commitResult.ok) {
      await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
      throw new Error(`git commit に失敗しました: ${commitResult.stderr.slice(0, 500)}`);
    }
    // commit成功。以降は何が起きてもロールバックしない。
    committed = true;
    commitHash = gitRevParseHead(ROOT);

    const pushResult = gitPush(ROOT);
    if (!pushResult.ok) {
      notifyLine(["--result", "pushfail", "--label", `Studio: ${theme}`]);
      await updateJob(jobId, {
        status: "error",
        progress: undefined,
        error: `push に失敗しました（pre-push監査等の可能性）。コミットはローカルに残っています（commit ${commitHash?.slice(0, 8) ?? "不明"}）。手動対応が必要です。`,
        commit: commitHash,
      });
      return;
    }

    // ── 10. verify-deploy / notify-line ──────────────────────
    await setProgress(jobId, "本番反映を確認中");
    // --skip-pages: verify-deploy.mjsの既定は/tmp/researchman-last-add.json（Case Study用
    // サマリー）を読んで新規ページを検証するため、ideaの反映確認でそれを読むと誤検証になる
    // （Technology日次パイプラインと同じ回避策。scripts/verify-deploy.mjs参照）。
    const verifyResult = runVerifyDeploy(ROOT, [], ["--skip-pages"]);
    const lineText = buildIdeaLineText({ theme, entries: newEntries, verified: verifyResult.ok, commitHash, site: SITE });
    await writeFile(LAST_IDEA_TEXT_PATH, lineText);
    notifyLine(["--text-file", LAST_IDEA_TEXT_PATH]);

    if (verifyResult.ok) {
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
      console.error("[studio] idea commit後の例外（ロールバックはスキップ）:", err);
      notifyLine(["--result", "unverified", "--label", `Studio: ${theme}`]);
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
