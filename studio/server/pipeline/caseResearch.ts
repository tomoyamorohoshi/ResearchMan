/**
 * Research(Case Study) 実パイプライン（DESIGN.md §6・§10 P1）。
 *
 * 収集(case-collector×角度並列) → 重複除外 → 検証(link-checker/award-verifier) →
 * 執筆(case-writer) → サムネイル → 反映(cases.json/researchSources.ts) →
 * 監査(audit-thumbnails/audit-integrity/tsc/lint/build) → commit/push →
 * verify-deploy → notify-line、をデイリーパイプライン（auto-research-cc.mjs +
 * launchd plist）と同じ品質ガードレール・git運用で実行する。
 *
 * 人の承認は無い（完全自動）。品質は機械監査＋失敗時ロールバック＋事後LINE通知で担保する
 * （DESIGN.md §5）。commit前の失敗は必ず rollbackTouchedFiles() で作業ツリーを戻す。
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
  runAuditIntegrity,
  runAuditThumbnails,
  runBuild,
  runLint,
  runNotifyLine,
  runTypeCheck,
  runVerifyDeploy,
} from "./audit.js";
import { loadAgentDefinition } from "./agentLoader.js";
import { updateJob, type ResultCard } from "../jobs.js";
import {
  buildAwardVerifierPrompt,
  buildCaseWriterPrompt,
  buildCollectorPrompt,
  buildLinkCheckerPrompt,
  buildOrderTagPrompt,
} from "./prompts.js";
import {
  buildAngles,
  buildCaseEntry,
  buildCommitMessage,
  buildExistingCaseIndex,
  dedupeCandidates,
  extractJsonArray,
  filterTagsByVocabulary,
  upsertOrderTagLine,
  type CaseEntry,
  type DedupedCandidate,
  type RawCandidate,
  type ValidatedResearchRequest,
  type WriterFields,
} from "./pure.js";
import { acquireThumbnail } from "./thumbnail.js";
import { resolveLock, tryAcquireLock, type LockHandle } from "./lock.js";
import { runAgentQuery, runPlainQuery } from "./sdkRunner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", ".."); // studio/server/pipeline -> repo root
const AGENTS_DIR = path.join(ROOT, ".claude", "agents");
const CASES_PATH = path.join(ROOT, "data", "cases.json");
const TAG_VOCAB_PATH = path.join(ROOT, "data", "tag-vocabulary.json");
const RESEARCH_SOURCES_PATH = path.join(ROOT, "src", "lib", "researchSources.ts");
const LAST_ADD_PATH = "/tmp/researchman-last-add.json";
const SITE = "https://research-man.vercel.app";
const FALLBACK_ORDER_TAG = "Studio";

interface Candidate extends DedupedCandidate {
  thumbnail?: string;
  videoId?: string;
}

async function setProgress(jobId: string, progress: string): Promise<void> {
  await updateJob(jobId, { progress });
}

// notify-line.mjs は「おまけ」設計で常にexit 0（設定不備・送信失敗でも本体を止めない）ため
// CommandResult.ok だけでは送信成功可否が分からない。標準出力に必ず「送信OK/送信失敗/
// 通知スキップ」を出す実装（scripts/notify-line.mjs参照）なのでログへ転記して可観測性を持たせる
// （2026-07-10: 実E2E検証時にこのログが無く送信成否をパイプライン外で確認する必要があった）。
function notifyLine(args: string[]): void {
  const result = runNotifyLine(ROOT, args);
  console.log(`[studio] notify-line: ${result.stdout.trim() || result.stderr.trim() || "(no output)"}`);
}

async function fail(jobId: string, theme: string, message: string): Promise<void> {
  await updateJob(jobId, { status: "error", progress: undefined, error: message });
  notifyLine(["--result", "error", "--label", `Studio: ${theme}`]);
}

export interface RollbackOutcome {
  rolledBack: boolean;
}

/**
 * adversarial-reviewer指摘#2: commit（場合によってはpushも）成功後に例外が起きた場合、
 * 従来はcatchブロックが無条件にrollbackTouchedFiles()を呼んでいた。commit済みファイルに
 * rmを実行すると「コミット済みファイルの未コミット削除」がworking treeに残ってしまう
 * （本番に反映済みのデータを壊す）。committed=true以降は一切ロールバックしない。
 * rollback関数を依存注入することで、パイプライン全体を動かさずにこの分岐だけを
 * 単体テストできるようにする。
 */
export async function rollbackIfNotCommitted(
  committed: boolean,
  trackedTouched: string[],
  newUntracked: string[],
  rollback: (tracked: string[], untracked: string[]) => Promise<void>,
): Promise<RollbackOutcome> {
  if (committed) return { rolledBack: false };
  if (trackedTouched.length === 0 && newUntracked.length === 0) return { rolledBack: false };
  await rollback(trackedTouched, newUntracked);
  return { rolledBack: true };
}

/**
 * @param externalLock 呼び出し元（combinedResearch.ts）が既に取得済みのlockを渡す場合に指定する。
 * 指定時はこの関数は自前でacquire/releaseしない（release責任は呼び出し元に残る。
 * adversarial-reviewer指摘#2: Case→Tech間でlockを一度解放して再取得すると、その隙に
 * デイリージョブがlockを奪える競合窓ができてしまうため）。単独実行時（未指定）は
 * 従来どおり自前でacquire/releaseする。
 */
export async function runCaseResearchPipeline(
  jobId: string,
  req: ValidatedResearchRequest,
  externalLock?: LockHandle,
): Promise<void> {
  const { theme, viewpoint, refUrl, count } = req;
  let costUsd = 0;

  const { lock, ownsLock } = resolveLock(externalLock, tryAcquireLock);
  if (!lock) {
    await updateJob(jobId, {
      status: "error",
      progress: undefined,
      error: "デイリージョブ実行中です。しばらく後に再実行してください。",
    });
    return;
  }

  // commit前に失敗した場合のロールバック対象（実際に書き込みが起きてから追跡する）
  const trackedTouched: string[] = [];
  const newUntracked: string[] = [];
  // commit成功後はロールバックを一切行わない（adversarial-reviewer指摘#2）。
  // catchブロックからも参照できるよう、tryの外側（関数スコープ）で宣言する。
  let committed = false;
  let commitHash: string | null = null;
  let resultCards: ResultCard[] = [];

  try {
    await setProgress(jobId, "既存データ読み込み中");
    const existingCases = JSON.parse(await readFile(CASES_PATH, "utf-8")) as Array<{
      id: string;
      title: string;
      link?: string;
    }>;
    const tagVocab = JSON.parse(await readFile(TAG_VOCAB_PATH, "utf-8")) as {
      Tech: string[];
      Form: string[];
      Theme: string[];
    };
    const existingIndex = buildExistingCaseIndex(existingCases);

    // ── 1. 収集（角度別並列） ──────────────────────────────────
    const angles = buildAngles(theme, viewpoint);
    await setProgress(jobId, `収集中（${angles.length}角度並列）`);
    const collectorDef = loadAgentDefinition(AGENTS_DIR, "case-collector");
    const perAngleTarget = Math.max(2, Math.ceil((count * 2) / angles.length));

    const collectResults = await Promise.all(
      angles.map((angle) =>
        runAgentQuery(
          ROOT,
          "case-collector",
          collectorDef,
          buildCollectorPrompt({ theme, angle, refUrl, targetCount: perAngleTarget }),
        ),
      ),
    );

    const rawCandidates: RawCandidate[] = [];
    for (const r of collectResults) {
      if (!r.ok) {
        console.warn("[studio] case-collector call failed:", r.error);
        continue;
      }
      costUsd += r.costUsd;
      const arr = extractJsonArray(r.text);
      if (!arr) {
        console.warn("[studio] case-collector returned unparseable JSON");
        continue;
      }
      for (const item of arr) {
        if (item && typeof item === "object") rawCandidates.push(item as RawCandidate);
      }
    }

    if (rawCandidates.length === 0) {
      throw new Error(
        "収集フェーズで候補が得られませんでした（WebSearch結果が空、またはAgent呼び出しに失敗した可能性があります）",
      );
    }

    // ── 2. 重複除外 ────────────────────────────────────────────
    await setProgress(jobId, "重複チェック中");
    const deduped = dedupeCandidates(rawCandidates, existingIndex);
    if (deduped.length === 0) {
      throw new Error("収集した候補はすべて既存事例と重複していました（テーマや参照URLを変えてお試しください）");
    }
    const workingSet: Candidate[] = deduped.slice(0, count * 3);

    // ── 3. 検証（link-checker / award-verifier） ────────────────
    await setProgress(jobId, "一次ソース検証中（リンク/受賞）");
    const linkCheckerDef = loadAgentDefinition(AGENTS_DIR, "link-checker");
    const linkResult = await runAgentQuery(
      ROOT,
      "link-checker",
      linkCheckerDef,
      buildLinkCheckerPrompt(
        workingSet.map((c) => ({ id: c.id, title: c.title, link: c.link, youtubeId: c.youtubeId })),
      ),
    );
    if (!linkResult.ok) {
      throw new Error(`リンク検証エージェントの呼び出しに失敗しました: ${linkResult.error}`);
    }
    costUsd += linkResult.costUsd;
    const linkVerdicts = extractJsonArray(linkResult.text);
    if (!linkVerdicts) {
      throw new Error("リンク検証結果を解析できませんでした（Agent応答がJSON形式ではありません）");
    }
    const linkMap = new Map<string, { alive: boolean; titleMatch: boolean | "na" }>();
    for (const v of linkVerdicts) {
      if (v && typeof v === "object" && "id" in v) {
        const rec = v as { id: string; alive?: boolean; titleMatch?: boolean | "na" };
        linkMap.set(rec.id, { alive: !!rec.alive, titleMatch: rec.titleMatch ?? "na" });
      }
    }

    let survivors: Candidate[] = workingSet.filter((c) => {
      const v = linkMap.get(c.id);
      return v?.alive === true && v.titleMatch !== false;
    });

    // award-verifier: 受賞を自己申告している候補のみ検証。未検証/誤りはaward空文字に落とす
    // （事例自体は却下しない。award付きの誤情報を掲載しないことが目的）。
    const awardClaimants = survivors.filter((c) => (c.award || "").trim());
    if (awardClaimants.length > 0) {
      await setProgress(jobId, "受賞情報の一次ソース照合中");
      const awardVerifierDef = loadAgentDefinition(AGENTS_DIR, "award-verifier");
      const awardResult = await runAgentQuery(
        ROOT,
        "award-verifier",
        awardVerifierDef,
        buildAwardVerifierPrompt(
          awardClaimants.map((c) => ({ id: c.id, title: c.title, client: c.client || "", year: c.year, award: c.award || "" })),
        ),
      );
      if (awardResult.ok) {
        costUsd += awardResult.costUsd;
        const awardVerdicts = extractJsonArray(awardResult.text);
        if (awardVerdicts) {
          const awardMap = new Map<string, { verdict: string; correctedAward?: string }>();
          for (const v of awardVerdicts) {
            if (v && typeof v === "object" && "id" in v) {
              const rec = v as { id: string; verdict?: string; correctedAward?: string };
              awardMap.set(rec.id, { verdict: rec.verdict || "unverified", correctedAward: rec.correctedAward });
            }
          }
          survivors = survivors.map((c) => {
            const v = awardMap.get(c.id);
            if (!v) return c;
            if (v.verdict === "confirmed") {
              return { ...c, award: v.correctedAward?.trim() || c.award };
            }
            if (v.verdict === "incorrect" && v.correctedAward?.trim()) {
              return { ...c, award: v.correctedAward.trim() };
            }
            return { ...c, award: "" }; // unverified・correction無しのincorrect
          });
        } else {
          console.warn("[studio] award-verifier returned unparseable JSON — clearing unverified award claims");
          survivors = survivors.map((c) => (awardClaimants.some((a) => a.id === c.id) ? { ...c, award: "" } : c));
        }
      } else {
        console.warn("[studio] award-verifier call failed — clearing unverified award claims:", awardResult.error);
        survivors = survivors.map((c) => (awardClaimants.some((a) => a.id === c.id) ? { ...c, award: "" } : c));
      }
    }

    if (survivors.length === 0) {
      throw new Error("リンク検証を通過した事例がありませんでした（すべて死リンクまたは内容不一致と判定）");
    }

    // ── 4. 執筆（case-writer） ───────────────────────────────────
    await setProgress(jobId, "執筆中");
    const caseWriterDef = loadAgentDefinition(AGENTS_DIR, "case-writer");
    const tagVocabFlat = [...tagVocab.Tech, ...tagVocab.Form, ...tagVocab.Theme];
    const writerResult = await runAgentQuery(
      ROOT,
      "case-writer",
      caseWriterDef,
      buildCaseWriterPrompt(
        survivors.map((c) => ({
          id: c.id,
          title: c.title,
          client: c.client || "",
          agency: c.agency || "",
          year: c.year,
          link: c.link,
          award: c.award || "",
          summary: c.summary || "",
        })),
        tagVocabFlat,
      ),
    );
    if (!writerResult.ok) {
      throw new Error(`執筆エージェントの呼び出しに失敗しました: ${writerResult.error}`);
    }
    costUsd += writerResult.costUsd;
    const writerArr = extractJsonArray(writerResult.text);
    if (!writerArr) {
      throw new Error("執筆結果を解析できませんでした（Agent応答がJSON形式ではありません）");
    }
    const writerMap = new Map<string, WriterFields>();
    for (const item of writerArr) {
      if (!item || typeof item !== "object" || !("id" in item)) continue;
      const rec = item as Record<string, unknown>;
      writerMap.set(String(rec.id), {
        summary: typeof rec.summary === "string" ? rec.summary : "",
        categories: Array.isArray(rec.categories) ? (rec.categories as string[]) : [],
        award: typeof rec.award === "string" ? rec.award : "",
        regions: Array.isArray(rec.regions) ? (rec.regions as string[]) : [],
        tags: filterTagsByVocabulary(rec.tags, tagVocab),
        overview: typeof rec.overview === "string" ? rec.overview : "",
        background: typeof rec.background === "string" ? rec.background : "",
        execution: typeof rec.execution === "string" ? rec.execution : "",
        evaluationImpact: typeof rec.evaluationImpact === "string" ? rec.evaluationImpact : "",
        relatedWorks: Array.isArray(rec.relatedWorks)
          ? (rec.relatedWorks as { title: string; description: string; url: string }[])
          : [],
      });
    }
    const written = survivors.filter((c) => writerMap.has(c.id));
    if (written.length === 0) {
      throw new Error("執筆エージェントが有効なエントリを1件も返しませんでした");
    }

    // ── 5. サムネイル ────────────────────────────────────────────
    await setProgress(jobId, "サムネイル取得中");
    const withThumbnails: Candidate[] = [];
    for (const c of written) {
      const thumb = await acquireThumbnail(c.id, {
        title: c.title,
        client: c.client,
        link: c.link,
        youtubeId: c.youtubeId,
      });
      if (thumb) {
        withThumbnails.push({ ...c, thumbnail: thumb.thumbnail, videoId: thumb.videoId });
        newUntracked.push(path.join("public", thumb.thumbnail));
      } else {
        console.warn(`[studio] thumbnail acquisition failed, dropping candidate: ${c.id}`);
      }
    }
    if (withThumbnails.length === 0) {
      throw new Error("サムネイル画像を確保できた事例がありませんでした");
    }

    // ── 6. オーダータグ決定 ───────────────────────────────────────
    await setProgress(jobId, "オーダータグ決定中");
    let orderTag = FALLBACK_ORDER_TAG;
    try {
      const tagResult = await runPlainQuery(buildOrderTagPrompt(theme), "haiku");
      if (tagResult.ok) {
        costUsd += tagResult.costUsd;
        const cleaned = tagResult.text.trim().replace(/^["'`]+|["'`]+$/g, "").split("\n")[0]?.trim();
        if (cleaned && cleaned.length <= 40) orderTag = cleaned;
      }
    } catch (err) {
      console.warn("[studio] order tag naming failed, using fallback:", err);
    }

    // ── 7. 反映（データ書き込み） ─────────────────────────────────
    await setProgress(jobId, "反映中（データ書き込み）");
    // 先にresearchSources.ts側でタグ名を確定させる（既存のradar/award等と衝突する場合、
    // upsertOrderTagLineが別名に回避することがある — adversarial-reviewer指摘#3）。
    // cases.jsonのsourcesは必ずこの確定済みタグ名(upserted.tag)を使い、researchSources.ts
    // との不整合（誤ったタブ/ハッシュタグ分類）を防ぐ。
    const sourcesContent = await readFile(RESEARCH_SOURCES_PATH, "utf-8");
    const upserted = upsertOrderTagLine(sourcesContent, orderTag, orderTag);
    const finalOrderTag = upserted.tag;

    const finalEntries: CaseEntry[] = withThumbnails.map((c) =>
      buildCaseEntry({
        id: c.id,
        title: c.title,
        client: c.client || "",
        agency: c.agency || "",
        year: c.year,
        link: c.link,
        thumbnail: c.thumbnail || "",
        videoId: c.videoId || "",
        sourceTag: finalOrderTag,
        writer: writerMap.get(c.id)!,
      }),
    );
    const updatedCases = [...finalEntries, ...existingCases];
    await writeFile(CASES_PATH, JSON.stringify(updatedCases, null, 2));
    trackedTouched.push("data/cases.json");

    if (upserted.changed) {
      await writeFile(RESEARCH_SOURCES_PATH, upserted.content);
      trackedTouched.push("src/lib/researchSources.ts");
    }

    // resultCardsはfinalEntries確定時点で組み立てておく（commit/push後の後処理で例外が
    // 起きても、catch側でjobをdoneのまま返せるようにするため — adversarial-reviewer指摘#2）。
    resultCards = finalEntries.map((c) => ({
      kind: "case" as const,
      id: c.id,
      url: `${SITE}/cases/${c.id}`,
      title: c.title,
      meta: [c.client, c.year].filter(Boolean).join(" · "),
      chip: c.award ? { label: c.award, jp: true } : undefined,
    }));

    // ── 8. 監査 ──────────────────────────────────────────────────
    await setProgress(jobId, "品質監査中（サムネ/整合性/tsc/lint/build）");
    // 2026-07-10: buildが「Next.js build worker exited with code: 1」で確定的に失敗する
    // 不具合があったが、原因はデータではなく子プロセスへのNODE_ENV=development漏れ
    // （audit.ts::sanitizedEnv参照）だったため、リトライではなく根本修正で解消した。
    // 監査は決定的なゲートであるべきなのでリトライは入れない
    // （ネットワーク起因の一時的失敗はlink-checker/award-verifier等Agent呼び出し側で
    // 別途扱う）。
    const audits: Array<{ name: string; run: () => { ok: boolean; stdout: string; stderr: string } }> = [
      { name: "audit-thumbnails", run: () => runAuditThumbnails(ROOT) },
      { name: "audit-integrity", run: () => runAuditIntegrity(ROOT) },
      { name: "tsc --noEmit", run: () => runTypeCheck(ROOT) },
      { name: "lint", run: () => runLint(ROOT) },
      { name: "build", run: () => runBuild(ROOT) },
    ];
    for (const audit of audits) {
      const result = audit.run();
      if (!result.ok) {
        // stderrを優先し、実際の例外・スタックトレースが末尾のログ整形メッセージで
        // 切り捨てられないよう十分な長さを残す（2026-07-10: 1500字だと本質的なエラーが
        // 切れてReact警告等のノイズしか残らないケースがあった）。
        const tail = [result.stderr.trim().slice(-3000), result.stdout.trim().slice(-1500)]
          .filter(Boolean)
          .join("\n---stdout---\n");
        await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
        throw new Error(`品質監査(${audit.name})に失敗しました。反映を中止しロールバックしました。\n${tail}`);
      }
    }

    // ── 9. commit/push ───────────────────────────────────────────
    await setProgress(jobId, "反映中（commit/push）");
    const addResult = gitAdd(ROOT, [...trackedTouched, ...newUntracked]);
    if (!addResult.ok) {
      await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
      throw new Error(`git add に失敗しました: ${addResult.stderr.slice(0, 500)}`);
    }
    const commitMsg = buildCommitMessage(theme, withThumbnails.length);
    const commitResult = gitCommit(ROOT, commitMsg);
    if (!commitResult.ok) {
      await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
      throw new Error(`git commit に失敗しました: ${commitResult.stderr.slice(0, 500)}`);
    }
    // commit成功。以降は何が起きてもロールバックしない（adversarial-reviewer指摘#2）。
    committed = true;
    commitHash = gitRevParseHead(ROOT);

    const pushResult = gitPush(ROOT);
    if (!pushResult.ok) {
      // commit自体はローカルに残す（デイリーパイプラインのpushfail運用と同じ）
      notifyLine(["--result", "pushfail", "--label", `Studio: ${theme}`]);
      await updateJob(jobId, {
        status: "error",
        progress: undefined,
        error: `push に失敗しました（pre-push監査等の可能性）。コミットはローカルに残っています（commit ${commitHash?.slice(0, 8) ?? "不明"}）。手動対応が必要です。`,
        commit: commitHash,
      });
      return;
    }

    // ── 10. verify-deploy / notify-line ──────────────────────────
    await setProgress(jobId, "本番反映を確認中");
    await writeFile(
      LAST_ADD_PATH,
      JSON.stringify(
        { count: withThumbnails.length, cases: finalEntries.map((c) => ({ id: c.id, title: c.title, year: c.year })) },
        null,
        2,
      ),
    );
    const verifyResult = runVerifyDeploy(
      ROOT,
      withThumbnails.map((c) => c.thumbnail || "").filter(Boolean),
    );

    if (verifyResult.ok) {
      notifyLine(["--label", `Studio: ${theme}`, "--route", "cases"]);
      await updateJob(jobId, {
        status: "done",
        progress: undefined,
        resultCards,
        commit: commitHash,
        deployedUrl: SITE,
        cost: costUsd,
      });
    } else {
      notifyLine(["--result", "unverified", "--label", `Studio: ${theme}`, "--route", "cases"]);
      await updateJob(jobId, {
        status: "done",
        progress: undefined,
        warning: "反映確認が時間切れでした。数分後に本番へ反映される見込みです。",
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
      // adversarial-reviewer指摘#2: commit（このパスに来る時点でpushも成功済み。push失敗は
      // 上のif(!pushResult.ok)で別途returnしている）後の例外は、データ自体は本番反映済みの
      // 可能性が高い。rollbackTouchedFiles を呼ばない（=commit済みファイルを勝手にrmしない）
      // のに加え、job も error ではなく done+warning にする（成功をエラー誤報しない）。
      console.error("[studio] commit後の例外（ロールバックはスキップ）:", err);
      notifyLine(["--result", "unverified", "--label", `Studio: ${theme}`, "--route", "cases"]);
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
    if (ownsLock) lock.release();
  }
}
