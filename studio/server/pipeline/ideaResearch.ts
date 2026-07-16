/**
 * idea(テーマ駆動アイディエーション) 実パイプライン（DESIGN.md §6・§10 P3）。
 *
 * 切り口選定(data/idea-angles.json) → 検索キーワード抽出 → 関連Case/Techのretrieve
 * （search-cases.mjs＋tech.jsonスコアリング） → 咀嚼(部分アイデアの書き出し。ヤング『アイデア
 * のつくり方』②相当) → 生成(Agent SDK 1パス) → 機械検証（スキーマ/seed書式/pattern語彙/
 * refs実在/重複除外） → 採点→改稿→再検証（ヤング⑤相当。質の批評→育成。改稿は既存の機械検証を
 * 必ず再通過させる） → 反映(ideas.json+idea-layouts.jsonペアコミット) → 監査(root build) →
 * commit/push → verify-deploy(--skip-pages) → notify-line、を caseResearch.ts と同じ品質
 * ガードレール・git運用・ロールバック方式で実行する。咀嚼・採点/改稿はいずれもenhancer
 * （呼び出し失敗時は安全側にフォールバックし、必須ゲートにはしない）。
 *
 * dryRun:true の場合は機械検証・採点/改稿までを実行し、反映(書き込み)以降を一切行わずに
 * job.ideaPreviewへ記録して終了する（addCase.ts/awardResearch.tsと同じdryRunパターン）。
 *
 * 人の承認は無い（完全自動、DESIGN.md §5）。commit前の失敗は必ずrollbackTouchedFiles()で
 * 作業ツリーを戻す。committed=true以降は一切ロールバックしない
 * （rollbackIfNotCommittedはcaseResearch.tsのものをそのまま再利用。判定ロジックはタブに依存しない）。
 */
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jstDateString } from "../../../scripts/lib/jst-date.mjs";
import { readIdeasJsonSafe, writeJsonAtomic } from "../../../scripts/lib/ideas-io.mjs";
import {
  gitAdd,
  gitCommit,
  gitPush,
  gitRevParseHead,
  rollbackTouchedFiles,
  runBuild,
  runIdeaLayoutsPrecompute,
  runNotifyLine,
  runVerifyDeploy,
} from "./audit.js";
import { rollbackIfNotCommitted } from "./caseResearch.js";
import { loadIdeaAngles } from "./ideaAngles.js";
import { runSearchCases } from "./ideaExternalScripts.js";
import { fetchFavoriteIds, loadFavSyncConfig } from "./ideaFavorites.js";
import {
  buildIdeaChewPrompt,
  buildIdeaCritiquePrompt,
  buildIdeaRevisePrompt,
  buildIdeaWriterPrompt,
  buildKeywordExtractionPrompt,
  type AngleWithExemplars,
  type IdeaCritiqueTarget,
  type IdeaReviseTarget,
} from "./ideaPrompts.js";
import {
  appendCountShortfallWarning,
  buildIdeaCommitMessage,
  buildIdeaLineText,
  endsWithKamo,
  IDEA_CRITIQUE_DISCARD_THRESHOLD,
  IDEA_CRITIQUE_REVISE_THRESHOLD,
  isAllowedPattern,
  isDuplicateIdea,
  nextStudioIdeaSeq,
  parseChewResult,
  parseCritiqueResult,
  parseReviseResult,
  resolveIdeaRef,
  scoreTechCandidates,
  selectAngles,
  sumCritiqueScore,
  type CaseRecord,
  type ChewedAngle,
  type IdeaCritique,
  type IdeaEntry,
  type RawIdeaCandidate,
  type ReviseCandidate,
  type TechRecord,
  type ValidatedIdeaRequest,
} from "./ideaPure.js";
import { extractJsonArray } from "./pure.js";
import { tryAcquireLock } from "./lock.js";
import { runPlainQuery } from "./sdkRunner.js";
import { updateJob, type IdeaRefChip, type ResultCard } from "../jobs.js";
import { BudgetExceededError, createJobBudgetTracker } from "./budget.js";
import { pollStrictVerify } from "./strictVerify.js";
import { finishJob, startPhase } from "./progressTiming.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", ".."); // studio/server/pipeline -> repo root
const CASES_PATH = path.join(ROOT, "data", "cases.json");
const TECH_PATH = path.join(ROOT, "data", "tech.json");
const IDEAS_JSON_PATH = path.join(ROOT, "data", "ideas.json");
const LAST_IDEA_TEXT_PATH = path.join(os.tmpdir(), "researchman-studio-idea-last.txt");
const SITE = "https://research-man.vercel.app";
const IDEAS_URL = `${SITE}/ideas`;
const MAX_GEN_ATTEMPTS = 3;

// P4 #6: フェーズ切替のたびに直前フェーズの所要時間を積算し、job JSONへ記録する
// （caseResearch.tsと同じ理由）。
async function setProgress(jobId: string, progress: string): Promise<void> {
  const phaseDurationsMs = startPhase(jobId, progress);
  await updateJob(jobId, { progress, phaseDurationsMs });
}

// notify-line.mjs は常にexit 0（設定不備・送信失敗でも本体を止めない「おまけ」設計）のため、
// 送信成否をログへ転記して可観測性を持たせる（caseResearch.tsと同じ理由・2026-07-10）。
async function notifyLine(args: string[]): Promise<void> {
  const result = await runNotifyLine(ROOT, args);
  console.log(`[studio] notify-line: ${result.stdout.trim() || result.stderr.trim() || "(no output)"}`);
}

// 独立レビュー指摘#4: caseResearch.ts/techResearch.tsのfail()相当。失敗時もそれまでの
// 実消費コストをjob.costへ記録する（従来はcost未指定のままerror状態にしていたため、
// 失敗ジョブのコストが常にnullになり実態を過小評価していた）。
async function fail(
  jobId: string,
  theme: string,
  message: string,
  costUsd: number,
  budgetExceeded = false,
): Promise<void> {
  await updateJob(jobId, {
    status: "error",
    progress: undefined,
    error: message,
    cost: costUsd,
    ...(budgetExceeded ? { budgetExceeded: true } : {}),
  });
  await notifyLine(["--result", "error", "--label", `Studio: ${theme}`]);
}

/**
 * 批評フェーズ（ヤング⑤相当）のLLM呼び出し1回分を実行する。初回採点・改稿後の再採点の
 * 両方から共有して使う。呼び出し失敗・JSON解析失敗はenhancer方針（タスク指示の咀嚼と
 * 同じ思想）で「無採点のまま元の案を通す」ため、例外は投げず空Mapを返す
 * （costUsdは呼び出し元がcostUsd/budget.add()へ必ず加算する）。
 */
async function runCritiqueCall(
  entries: IdeaCritiqueTarget[],
): Promise<{ critiques: Map<string, IdeaCritique>; costUsd: number }> {
  let costUsd = 0;
  const critiques = new Map<string, IdeaCritique>();
  try {
    const result = await runPlainQuery(buildIdeaCritiquePrompt(entries), "sonnet");
    costUsd = result.costUsd;
    if (result.ok) {
      const parsed = parseCritiqueResult(result.text);
      if (parsed) {
        for (const c of parsed) critiques.set(c.id, c);
      } else {
        console.warn("[studio] idea critique: JSON解析に失敗。無採点のまま元の案を通します");
      }
    } else {
      console.warn("[studio] idea critique failed, passing through unscored:", result.error);
    }
  } catch (err) {
    console.warn("[studio] idea critique unexpected error, passing through unscored:", err);
  }
  return { critiques, costUsd };
}

/**
 * 改稿対象をまとめて1回のLLM呼び出しで改稿する。呼び出し失敗・JSON解析失敗は空Mapを返す
 * （呼び出し元は「改稿できなかった＝破棄」として扱う。要判断リスト参照）。
 */
async function runReviseCall(
  items: IdeaReviseTarget[],
  theme: string,
  constraint: string,
  caseCandidates: CaseRecord[],
  techCandidates: TechRecord[],
): Promise<{ revised: Map<string, ReviseCandidate>; costUsd: number }> {
  let costUsd = 0;
  const revised = new Map<string, ReviseCandidate>();
  try {
    const result = await runPlainQuery(
      buildIdeaRevisePrompt({ theme, constraint, items, caseCandidates, techCandidates }),
      "sonnet",
    );
    costUsd = result.costUsd;
    if (result.ok) {
      const parsed = parseReviseResult(result.text);
      if (parsed) {
        for (const c of parsed) revised.set(c.id, c);
      } else {
        console.warn("[studio] idea revise: JSON解析に失敗。改稿できなかった案として扱います");
      }
    } else {
      console.warn("[studio] idea revise failed:", result.error);
    }
  } catch (err) {
    console.warn("[studio] idea revise unexpected error:", err);
  }
  return { revised, costUsd };
}

export async function runIdeaResearchPipeline(jobId: string, req: ValidatedIdeaRequest): Promise<void> {
  const { theme, constraint, source, count, dryRun } = req;
  let costUsd = 0;
  const budget = createJobBudgetTracker();

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
    let kwCostUsd = 0;
    try {
      const kwResult = await runPlainQuery(buildKeywordExtractionPrompt(theme, constraint), "haiku");
      // 独立レビュー指摘#3: runPlainQueryは失敗時(ok:false)もそれまでの実消費costUsdを返すため、
      // ok判定の前に必ず受け取る（従来はif(ok)の中でのみ加算しており、失敗分のコストが
      // 記録から漏れていた）。
      kwCostUsd = kwResult.costUsd;
      if (kwResult.ok) {
        const arr = extractJsonArray(kwResult.text);
        const extracted = (arr || []).filter((x): x is string => typeof x === "string" && x.trim().length > 0);
        if (extracted.length > 0) keywords = extracted.map((k) => k.trim());
      }
    } catch (err) {
      console.warn("[studio] idea keyword extraction failed, using theme as-is:", err);
    }
    costUsd += kwCostUsd;
    // budgetチェックは上のtry/catchの外に置く（内側のcatchは「キーワード抽出失敗」専用のため、
    // BudgetExceededErrorを投げても飲み込まれず本来のcatchまで伝播する。caseResearch.tsと同じ理由）。
    budget.add(kwCostUsd);

    // ── 4. 関連事例・技術のretrieve（具体の触発材料） ──────────────
    await setProgress(jobId, "関連事例・技術を検索中");
    const caseCandidates = await runSearchCases(ROOT, keywords, Math.max(8, count * 2));
    const techCandidates = scoreTechCandidates(tech, keywords, Math.max(6, count));
    const allowedRefIds = new Set<string>([
      ...caseCandidates.map((c) => c.id),
      ...techCandidates.map((t) => t.id),
      ...selectedAngles.flatMap((a) => a.exemplarCaseIds),
    ]);
    const angleInputs: AngleWithExemplars[] = selectedAngles.map((angle) => ({
      angle,
      exemplars: angle.exemplarCaseIds
        .map((id) => caseById.get(id))
        .filter((c): c is CaseRecord => !!c)
        .slice(0, 3),
    }));

    // ── 5. 咀嚼（ヤング②相当。生成前に素材を要素分解し部分アイデアを書き出す） ──────
    // enhancerでありゲートではない: 呼び出し失敗・JSON解析失敗は空配列にフォールバックし、
    // 従来通り直接生成へ進む（タスク指示）。costUsdはok判定に関わらず必ず加算する
    // （独立レビュー指摘#3のパターンをここでも踏襲）。
    await setProgress(jobId, "素材を咀嚼中");
    let chewedAngles: ChewedAngle[] = [];
    let chewCostUsd = 0;
    try {
      const chewResult = await runPlainQuery(
        buildIdeaChewPrompt({ theme, constraint, angles: angleInputs, caseCandidates, techCandidates }),
        "sonnet",
      );
      chewCostUsd = chewResult.costUsd;
      if (chewResult.ok) {
        const parsed = parseChewResult(chewResult.text);
        if (parsed) {
          chewedAngles = parsed;
        } else {
          console.warn("[studio] idea chew: JSON解析に失敗。空配列にフォールバックします");
        }
      } else {
        console.warn("[studio] idea chew failed, falling back to empty:", chewResult.error);
      }
    } catch (err) {
      console.warn("[studio] idea chew unexpected error, falling back to empty:", err);
    }
    costUsd += chewCostUsd;
    budget.add(chewCostUsd);

    // ── 6. 生成（Agent SDK 1パス・最大3回リトライ） ──────────────
    await setProgress(jobId, "アイデア生成中");
    const writerPrompt = buildIdeaWriterPrompt({ theme, constraint, angles: angleInputs, caseCandidates, techCandidates, chewedAngles });

    let rawIdeas: unknown[] | null = null;
    let genError = "";
    for (let attempt = 1; attempt <= MAX_GEN_ATTEMPTS; attempt++) {
      const genResult = await runPlainQuery(writerPrompt, "sonnet");
      // 独立レビュー指摘#3: 失敗(ok:false)でcontinueする前に必ずコストを加算する
      // （このループはtry/catchの外なので、budget.add()の例外はそのまま外側catchへ伝播する）。
      costUsd += genResult.costUsd;
      budget.add(genResult.costUsd);
      if (!genResult.ok) {
        genError = genResult.error || "生成呼び出しに失敗しました";
        continue;
      }
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

    // ── 7. 機械検証・エントリ組み立て ────────────────────────────
    await setProgress(jobId, "生成結果を検証中");
    const dateStr = jstDateString();
    let seq = nextStudioIdeaSeq(existingIdeas, dateStr);
    const candidateEntries: IdeaEntry[] = [];
    // 重複判定は既存ideas.json + 今回すでに採用した分の両方に対して行う（今回内の自己重複も除外）
    const workingExisting: Array<{ title?: string; seed?: string }> = [...existingIdeas];
    // 要件3: rationale欠落は生成を捨てる理由にせず、warning扱いで空文字を保存する。
    let rationaleMissingCount = 0;

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
      const rationale = typeof rec.rationale === "string" ? rec.rationale.trim() : "";
      if (!rationale) rationaleMissingCount++;

      seq++;
      const entry: IdeaEntry = {
        id: `studio-${dateStr}-${seq}`,
        date: dateStr,
        title,
        pattern: rec.pattern as string,
        seed,
        refs,
        rationale,
        // 採点フェーズ（次段）で上書きされる暫定値。採点呼び出し自体が失敗した場合は
        // enhancer方針によりゼロのまま無採点で通す。
        scores: { discovery: 0, surprise: 0, conviction: 0 },
      };
      candidateEntries.push(entry);
      workingExisting.push(entry);
    }

    if (candidateEntries.length === 0) {
      throw new Error("検証を通過したアイデアが1件もありませんでした（形式不正または既存との重複）");
    }
    if (rationaleMissingCount > 0) {
      const rationaleWarning = `${rationaleMissingCount}件でrationale（言語化）が欠落していました`;
      warningMsg = warningMsg ? `${warningMsg} / ${rationaleWarning}` : rationaleWarning;
    }

    // ── 8. 採点→改稿→再検証（ヤング⑤相当。質の批評→育成） ──────────────
    await setProgress(jobId, "批評・改稿中");
    const critiqueTargetOf = (e: IdeaEntry): IdeaCritiqueTarget => ({
      id: e.id,
      title: e.title,
      pattern: e.pattern,
      seed: e.seed,
      rationale: e.rationale,
    });

    const initialCritique = await runCritiqueCall(candidateEntries.map(critiqueTargetOf));
    costUsd += initialCritique.costUsd;
    budget.add(initialCritique.costUsd);

    const kept: IdeaEntry[] = [];
    const toRevise: IdeaEntry[] = [];
    for (const entry of candidateEntries) {
      const c = initialCritique.critiques.get(entry.id);
      if (!c) {
        // 採点呼び出し失敗、またはこの案だけ結果が欠落 → enhancer方針により無採点のまま通す
        kept.push(entry);
        continue;
      }
      entry.scores = { discovery: c.discovery, surprise: c.surprise, conviction: c.conviction };
      if (sumCritiqueScore(c) < IDEA_CRITIQUE_REVISE_THRESHOLD) {
        toRevise.push(entry);
      } else {
        kept.push(entry);
      }
    }

    let finalEntries: IdeaEntry[] = [...kept];
    // dryRun向けの批評・改稿の記録（要件5・ideaPreview.critique）。
    const critiqueRecord: Record<string, unknown> = {
      initial: [...initialCritique.critiques.values()],
      revisedIds: [] as string[],
      discardedIds: [] as string[],
      rescored: [] as IdeaCritique[],
    };

    if (toRevise.length > 0) {
      const reviseItems: IdeaReviseTarget[] = toRevise.map((e) => ({
        id: e.id,
        pattern: e.pattern,
        title: e.title,
        seed: e.seed,
        rationale: e.rationale,
        note: initialCritique.critiques.get(e.id)?.note ?? "",
      }));
      const reviseResult = await runReviseCall(reviseItems, theme, constraint, caseCandidates, techCandidates);
      costUsd += reviseResult.costUsd;
      budget.add(reviseResult.costUsd);

      const revisedByEntryId = new Map<string, IdeaEntry>();
      for (const original of toRevise) {
        const candidate = reviseResult.revised.get(original.id);
        if (!candidate) {
          // 改稿呼び出し失敗、またはこの案だけ結果が欠落 → 改稿できなかったので破棄
          // （要判断: 明記なきフォールバックを安全側=破棄とした）
          (critiqueRecord.discardedIds as string[]).push(original.id);
          console.warn(`[studio] idea revise: ${original.id} の改稿結果が得られませんでした。破棄します`);
          continue;
        }
        const seed = candidate.seed.trim();
        // 改稿後も既存の機械検証を必ず再通過させる（要件2）。pattern は改稿プロンプト側で
        // 変更させていないため常にtrueになるはずだが、防御的にそのまま検証する。
        if (!seed || !endsWithKamo(seed) || !isAllowedPattern(original.pattern, allowedLabels)) {
          (critiqueRecord.discardedIds as string[]).push(original.id);
          console.warn(`[studio] idea revise: ${original.id} の改稿結果が機械検証を通過しませんでした。破棄します`);
          continue;
        }
        const refsRaw = Array.isArray(candidate.refs) ? candidate.refs : [];
        const refs = refsRaw
          .map((r) => resolveIdeaRef(r, allowedRefIds, caseById, techById))
          .filter((r): r is NonNullable<typeof r> => !!r);
        const title = candidate.title.trim() || original.title;
        const dupCheckList = [
          ...existingIdeas,
          ...finalEntries,
          ...toRevise.filter((t) => t.id !== original.id),
        ];
        if (isDuplicateIdea({ title, seed }, dupCheckList)) {
          (critiqueRecord.discardedIds as string[]).push(original.id);
          console.warn(`[studio] idea revise: ${original.id} の改稿結果が既存/他案と重複しました。破棄します`);
          continue;
        }
        revisedByEntryId.set(original.id, {
          ...original,
          title,
          seed,
          rationale: candidate.rationale.trim() || original.rationale,
          refs,
        });
      }

      if (revisedByEntryId.size > 0) {
        const rescoreCritique = await runCritiqueCall([...revisedByEntryId.values()].map(critiqueTargetOf));
        costUsd += rescoreCritique.costUsd;
        budget.add(rescoreCritique.costUsd);

        for (const [id, revisedEntry] of revisedByEntryId) {
          const c = rescoreCritique.critiques.get(id);
          if (!c) {
            // 再採点呼び出し失敗、またはこの案だけ結果が欠落 → enhancer方針により
            // 改稿前のスコアのまま通す（改稿自体は既に機械検証を再通過済み）
            finalEntries.push(revisedEntry);
            (critiqueRecord.revisedIds as string[]).push(id);
            continue;
          }
          const sum = sumCritiqueScore(c);
          if (sum < IDEA_CRITIQUE_DISCARD_THRESHOLD) {
            (critiqueRecord.discardedIds as string[]).push(id);
            console.warn(`[studio] idea revise: ${id} は改稿後も採点${sum}点で破棄しました`);
            continue;
          }
          revisedEntry.scores = { discovery: c.discovery, surprise: c.surprise, conviction: c.conviction };
          finalEntries.push(revisedEntry);
          (critiqueRecord.revisedIds as string[]).push(id);
          (critiqueRecord.rescored as IdeaCritique[]).push(c);
        }
      }
    }

    const newEntries = finalEntries;
    if (newEntries.length === 0) {
      throw new Error("採点・改稿を経て採用可能なアイデアが1件もありませんでした");
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

    // ── 9. dryRun: ここで打ち切りE2E検証用にideaPreviewへ記録する（要件5。
    //    addCase.tsのdryRunと同じ配置パターン＝反映(書き込み)より前で終了する） ──────
    if (dryRun) {
      await updateJob(jobId, {
        status: "done",
        progress: undefined,
        cost: costUsd,
        ideaPreview: {
          entries: newEntries as unknown as Array<Record<string, unknown>>,
          chewedAngles: chewedAngles as unknown as Array<Record<string, unknown>>,
          critique: critiqueRecord,
        },
      });
      return;
    }

    // ── 10. 反映（ideas.json + idea-layouts.json ペア） ──────────
    await setProgress(jobId, "反映中（データ書き込み）");
    const updatedIdeas = [...existingIdeas, ...newEntries];
    await writeJsonAtomic(IDEAS_JSON_PATH, updatedIdeas);
    trackedTouched.push("data/ideas.json");

    const precomputeResult = await runIdeaLayoutsPrecompute(ROOT);
    if (!precomputeResult.ok) {
      await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
      const tail = [precomputeResult.stderr.trim().slice(-2000), precomputeResult.stdout.trim().slice(-1000)]
        .filter(Boolean)
        .join("\n---stdout---\n");
      throw new Error(`idea-layouts.json の再計算に失敗しました。反映を中止しロールバックしました。\n${tail}`);
    }
    trackedTouched.push("data/idea-layouts.json");

    // ── 11. 監査（root next build。ideas.json破損が/ideasページを壊さないことの最終確認） ──
    await setProgress(jobId, "品質監査中（build）");
    const buildResult = await runBuild(ROOT);
    if (!buildResult.ok) {
      const tail = [buildResult.stderr.trim().slice(-3000), buildResult.stdout.trim().slice(-1500)]
        .filter(Boolean)
        .join("\n---stdout---\n");
      await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
      throw new Error(`品質監査(build)に失敗しました。反映を中止しロールバックしました。\n${tail}`);
    }

    // ── 12. commit/push ────────────────────────────────────────
    await setProgress(jobId, "反映中（commit/push）");
    const addResult = await gitAdd(ROOT, trackedTouched);
    if (!addResult.ok) {
      await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
      throw new Error(`git add に失敗しました: ${addResult.stderr.slice(0, 500)}`);
    }
    const commitMsg = buildIdeaCommitMessage(theme, newEntries.length);
    const commitResult = await gitCommit(ROOT, commitMsg);
    if (!commitResult.ok) {
      await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
      throw new Error(`git commit に失敗しました: ${commitResult.stderr.slice(0, 500)}`);
    }
    // commit成功。以降は何が起きてもロールバックしない。
    committed = true;
    commitHash = await gitRevParseHead(ROOT);

    const pushResult = await gitPush(ROOT);
    if (!pushResult.ok) {
      await notifyLine(["--result", "pushfail", "--label", `Studio: ${theme}`]);
      await updateJob(jobId, {
        status: "error",
        progress: undefined,
        error: `push に失敗しました（pre-push監査等の可能性）。コミットはローカルに残っています（commit ${commitHash?.slice(0, 8) ?? "不明"}）。手動対応が必要です。`,
        commit: commitHash,
      });
      return;
    }

    // ── 13. verify-deploy / notify-line ──────────────────────
    await setProgress(jobId, "本番反映を確認中");
    // --skip-pages: verify-deploy.mjsの既定はos.tmpdir()/researchman-last-add.json（Case Study用
    // サマリー）を読んで新規ページを検証するため、ideaの反映確認でそれを読むと誤検証になる
    // （Technology日次パイプラインと同じ回避策。scripts/verify-deploy.mjs参照）。
    const verifyResult = await runVerifyDeploy(ROOT, [], ["--skip-pages"]);

    // P4 #5厳密化: idea は既存verify-deployが --skip-pages のためページ検証を一切しない
    // （landed+home 200のみ）。/ideas は1ページに全アイデアが集約されるため、新規追加分
    // 全件のタイトルがそのページの本文に現れるまでポーリングする追加確認を行う
    // （caseResearch.ts/techResearch.tsと同じ理由。「✓ RM に自動反映」表示が実態と
    // 一致するようにする）。
    let strictResult: { ok: boolean; failedUrls: string[] } = { ok: true, failedUrls: [] };
    if (verifyResult.ok) {
      await setProgress(jobId, "新規アイデアの反映を厳密確認中");
      // 独立レビュー指摘#5: titleは"&"/"<"/">"を含むとReactのSSR出力ではHTMLエスケープ済み
      // 形（&amp;等）でしか現れず、生のtitleでのbody.includes()は恒久的に外れる
      // （cases.jsonに413件実在）。ideaのidはIdeaShapeCard（src/components/IdeaShapeCard.tsx）
      // がSVG path要素の id="idea-date-arc-<id>" 等として必ず出力するASCIIスラッグのため、
      // エスケープ問題が起きずより堅牢なマーカーになる。
      strictResult = await pollStrictVerify([{ url: IDEAS_URL, markers: newEntries.map((e) => e.id) }]);
    }
    const verified = verifyResult.ok && strictResult.ok;

    const lineText = buildIdeaLineText({ theme, entries: newEntries, verified, commitHash, site: SITE });
    await writeFile(LAST_IDEA_TEXT_PATH, lineText);
    await notifyLine(["--text-file", LAST_IDEA_TEXT_PATH]);

    if (verified) {
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
        warning: [
          warningMsg,
          !verifyResult.ok
            ? "反映確認が時間切れでした。数分後に本番へ反映される見込みです。"
            : "新規アイデアの反映確認が時間切れでした（キャッシュ等の可能性）。数分後に再度ご確認ください。",
        ]
          .filter(Boolean)
          .join(" / "),
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
    const isBudgetError = err instanceof BudgetExceededError;
    if (committed && !isBudgetError) {
      console.error("[studio] idea commit後の例外（ロールバックはスキップ）:", err);
      await notifyLine(["--result", "unverified", "--label", `Studio: ${theme}`]);
      await updateJob(jobId, {
        status: "done",
        progress: undefined,
        warning: `反映後の処理でエラーが発生しました（データは本番に反映済みの可能性があります。commit ${commitHash?.slice(0, 8) ?? "不明"}）: ${message}`,
        resultCards,
        commit: commitHash,
        deployedUrl: SITE,
        cost: costUsd,
      });
    } else if (committed && isBudgetError) {
      // DESIGN.md §8: 予算超過はcommit後でも「停止のみ」で常にエラー扱いにする
      // （caseResearch.tsと同じ理由。budget.ts参照）。
      console.error("[studio] idea commit後に予算上限超過を検知（ロールバックはスキップ、停止のみ）:", err);
      await notifyLine(["--result", "error", "--label", `Studio: ${theme}`]);
      await updateJob(jobId, {
        status: "error",
        progress: undefined,
        error: `${message}（データは本番に反映済みの可能性があります。commit ${commitHash?.slice(0, 8) ?? "不明"}）`,
        resultCards,
        commit: commitHash,
        cost: costUsd,
        budgetExceeded: true,
      });
    } else {
      await fail(jobId, theme, message, costUsd, isBudgetError);
    }
  } finally {
    await updateJob(jobId, { phaseDurationsMs: finishJob(jobId) }).catch(() => {});
    lock.release();
  }
}
