/**
 * add-case 実パイプライン（LINEでURLを送ると事例が cases.json に追加される機能）。
 *
 * URL取得→事例情報抽出（case-adder Agent）→重複チェック→検証(link-checker/award-verifier)→
 * 執筆(case-writer)→サムネイル→cases.json追加→監査→commit/push→verify-deploy→LINE通知、を
 * caseResearch.ts と同じ品質ガードレール・git運用・ロールバック機構で実行する
 * （rollbackIfNotCommitted/terminalStatus はcaseResearch.tsのものをそのまま再利用する）。
 *
 * caseResearch.tsとの違い:
 * - 候補は常に1件（テーマ収集ではなくURL指定のため、角度別並列収集・「複数候補から
 *   間引く」重複除外は不要。重複判定は既存cases.jsonとの1件突き合わせのみ — addCasePure.ts参照）
 * - オーダータグの動的命名はしない。sourcesは常に固定の["User"]（要件5: ユーザー由来の目印）
 * - 完了/失敗の通知は scripts/notify-line.mjs のテンプレ文言ではなく、addCase専用の
 *   成功/失敗テキスト（タイトル+URL、または理由）を直接push する（LINEが唯一のUIのため、
 *   Studio Web UIでjob.errorを確認する運用を前提にできない）
 * - dryRun: true 時は cases.json書き込み・commit/push・verify-deploy・LINE通知をスキップし、
 *   生成エントリと検証結果だけをjob.addCasePreviewへ記録する（auto-research-cc.mjs --dry-run と
 *   同じ「サムネイルは実際に取得を検証するが最後に掃除する」慣例に合わせる）
 */
import { readFile, rm, writeFile } from "node:fs/promises";
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
  runTypeCheck,
  runVerifyDeploy,
} from "./audit.js";
import { loadAgentDefinition } from "./agentLoader.js";
import { updateJob, type ResultCard } from "../jobs.js";
import { buildAwardVerifierPrompt, buildCaseWriterPrompt, buildLinkCheckerPrompt } from "./prompts.js";
import { buildCaseAdderPrompt } from "./addCasePrompts.js";
import {
  buildAddCaseCommitMessage,
  buildAddCaseEntry,
  buildWriterFieldsFromAgentOutput,
  ensureUniqueCaseId,
  extractJsonObject,
  findDuplicateCase,
  isUsableCandidate,
  isXLink,
  normalizeYear,
  parseExtractedCandidate,
  type ValidatedAddCaseRequest,
} from "./addCasePure.js";
import { extractJsonArray, toCaseId } from "./pure.js";
import { acquireThumbnail } from "./thumbnail.js";
import { resolveLock, tryAcquireLock } from "./lock.js";
import { runAgentQuery } from "./sdkRunner.js";
import { BudgetExceededError, createJobBudgetTracker } from "./budget.js";
import { pollStrictVerify } from "./strictVerify.js";
import { finishJob, startPhase } from "./progressTiming.js";
import { pushLineMessage } from "../line/push.js";
import { loadLineConfig } from "../line/config.js";
import { buildAddCaseDuplicateText, buildAddCaseFailedText, buildAddCaseSuccessText } from "../line/messages.js";
import { rollbackIfNotCommitted, terminalStatus } from "./caseResearch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", ".."); // studio/server/pipeline -> repo root
const AGENTS_DIR = path.join(ROOT, ".claude", "agents");
const CASES_PATH = path.join(ROOT, "data", "cases.json");
const TAG_VOCAB_PATH = path.join(ROOT, "data", "tag-vocabulary.json");
const SITE = "https://research-man.vercel.app";

async function setProgress(jobId: string, progress: string): Promise<void> {
  const phaseDurationsMs = startPhase(jobId, progress);
  await updateJob(jobId, { progress, phaseDurationsMs });
}

/**
 * lineUserId が空（API入口=Claude Codeからの一括処理）ならLINE通知はスキップする
 * （ジョブ結果はGET /api/jobs/:idのポーリングで確認できるため、LINE送信は不要）。
 */
async function notifyLineIfPossible(lineUserId: string, text: string): Promise<void> {
  if (!lineUserId) return;
  const config = loadLineConfig();
  if (!config?.channelAccessToken) {
    console.warn("[studio][add-case] channelAccessToken未設定のためLINE通知をスキップしました");
    return;
  }
  await pushLineMessage(config.channelAccessToken, lineUserId, text);
}

async function fail(jobId: string, lineUserId: string, message: string, costUsd: number, ownsLock: boolean): Promise<void> {
  await updateJob(jobId, {
    status: terminalStatus(ownsLock, "error"),
    progress: undefined,
    error: message,
    cost: costUsd,
  });
  await notifyLineIfPossible(lineUserId, buildAddCaseFailedText(message));
}

export async function runAddCasePipeline(jobId: string, req: ValidatedAddCaseRequest): Promise<void> {
  const { url, context, lineUserId, dryRun } = req;
  let costUsd = 0;
  const budget = createJobBudgetTracker();

  const { lock, ownsLock } = resolveLock(undefined, tryAcquireLock);
  if (!lock) {
    const message = "デイリージョブ実行中です。しばらく後に再実行してください。";
    await updateJob(jobId, { status: "error", progress: undefined, error: message });
    await notifyLineIfPossible(lineUserId, buildAddCaseFailedText(message));
    return;
  }

  // commit前に失敗した場合のロールバック対象（実際に書き込みが起きてから追跡する）
  const trackedTouched: string[] = [];
  const newUntracked: string[] = [];
  let committed = false;
  let commitHash: string | null = null;
  let thumbnailRelPath = ""; // "public/thumbnails/<id>.jpg"（ROOT基準の相対パス）

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

    // ── 1. URL取得・事例情報抽出（case-adder） ────────────────────
    await setProgress(jobId, "URL取得・事例情報抽出中");
    const adderDef = loadAgentDefinition(AGENTS_DIR, "case-adder");
    const adderResult = await runAgentQuery(
      ROOT,
      "case-adder",
      adderDef,
      buildCaseAdderPrompt({ url, context, isXLink: isXLink(url) }),
    );
    costUsd += adderResult.costUsd;
    budget.add(adderResult.costUsd);
    if (!adderResult.ok) {
      throw new Error(`事例情報の抽出に失敗しました: ${adderResult.error}`);
    }
    const obj = extractJsonObject(adderResult.text);
    if (!obj) {
      throw new Error("事例情報の抽出結果を解析できませんでした（Agent応答がJSON形式ではありません）");
    }
    const candidate = parseExtractedCandidate(obj);
    if (!isUsableCandidate(candidate)) {
      throw new Error(candidate.reason || "指定されたURLから事例情報を確認できませんでした");
    }
    // 指摘1: "2024/25"のような表記ゆれのyearがid生成・サムネイルパス・URLへ混入するのを防ぐ。
    // 事実確認できない年は当年フォールバック等で埋めず、isUsableCandidateと同じfail-closed
    // 方針でreject（エラーにする）。以降はこの正規化後の値のみを使う。
    const normalizedYear = normalizeYear(candidate.year);
    if (normalizedYear === null) {
      throw new Error(`年の形式を確認できませんでした（取得値: ${candidate.year}）`);
    }
    const year = normalizedYear;

    // ── 2. 重複チェック（正規化リンク+タイトル） ───────────────────
    await setProgress(jobId, "重複チェック中");
    const existingIds = new Set(existingCases.map((c) => c.id));
    const id = ensureUniqueCaseId(toCaseId(candidate.title, year, candidate.client), existingIds);
    const duplicate = findDuplicateCase({ id, title: candidate.title, link: candidate.link }, existingCases);
    if (duplicate) {
      // 指摘3: 重複は失敗ではなく案内のため、buildAddCaseFailedTextで二重ラップせず
      // 専用文言でその場で終端処理する（finallyのロック解放・phaseDurationsMs記録は通常通り実行される）。
      const message = buildAddCaseDuplicateText(duplicate.title);
      await updateJob(jobId, { status: "error", progress: undefined, error: message, cost: costUsd });
      await notifyLineIfPossible(lineUserId, message);
      return;
    }

    // ── 3. 検証（link-checker） ──────────────────────────────────
    await setProgress(jobId, "一次ソース検証中（リンク）");
    const linkCheckerDef = loadAgentDefinition(AGENTS_DIR, "link-checker");
    const linkResult = await runAgentQuery(
      ROOT,
      "link-checker",
      linkCheckerDef,
      buildLinkCheckerPrompt([{ id, title: candidate.title, link: candidate.link, youtubeId: candidate.youtubeId }]),
    );
    costUsd += linkResult.costUsd;
    budget.add(linkResult.costUsd);
    if (!linkResult.ok) {
      throw new Error(`リンク検証エージェントの呼び出しに失敗しました: ${linkResult.error}`);
    }
    const linkVerdicts = extractJsonArray(linkResult.text);
    if (!linkVerdicts) {
      throw new Error("リンク検証結果を解析できませんでした（Agent応答がJSON形式ではありません）");
    }
    const verdict = linkVerdicts[0] as { alive?: boolean; titleMatch?: boolean | "na" } | undefined;
    if (!verdict || verdict.alive !== true || verdict.titleMatch === false) {
      throw new Error("リンク検証を通過しませんでした（死リンクまたは内容不一致と判定）");
    }

    // ── 4. 受賞検証（自己申告がある場合のみ。award-verifier） ───────
    let award = candidate.award;
    let awardVerdict: "confirmed" | "unverified" | "not-claimed" = "not-claimed";
    if (award.trim()) {
      await setProgress(jobId, "受賞情報の一次ソース照合中");
      const awardVerifierDef = loadAgentDefinition(AGENTS_DIR, "award-verifier");
      const awardResult = await runAgentQuery(
        ROOT,
        "award-verifier",
        awardVerifierDef,
        buildAwardVerifierPrompt([{ id, title: candidate.title, client: candidate.client, year, award }]),
      );
      costUsd += awardResult.costUsd;
      budget.add(awardResult.costUsd);
      if (awardResult.ok) {
        const awardVerdicts = extractJsonArray(awardResult.text);
        const rec = awardVerdicts?.[0] as { verdict?: string; correctedAward?: string } | undefined;
        if (rec?.verdict === "confirmed") {
          award = rec.correctedAward?.trim() || award;
          awardVerdict = "confirmed";
        } else {
          // unverified・correction無しのincorrectは、award-verifier.mdの規則により
          // 誤情報を掲載しないため空にする（事例自体は却下しない。caseResearch.tsと同じ方針）。
          award = "";
          awardVerdict = "unverified";
        }
      } else {
        console.warn("[studio][add-case] award-verifier call failed — clearing unverified award claim:", awardResult.error);
        award = "";
        awardVerdict = "unverified";
      }
    }

    // ── 5. 執筆（case-writer） ───────────────────────────────────
    await setProgress(jobId, "執筆中");
    const caseWriterDef = loadAgentDefinition(AGENTS_DIR, "case-writer");
    const tagVocabFlat = [...tagVocab.Tech, ...tagVocab.Form, ...tagVocab.Theme];
    const writerResult = await runAgentQuery(
      ROOT,
      "case-writer",
      caseWriterDef,
      buildCaseWriterPrompt(
        [
          {
            id,
            title: candidate.title,
            client: candidate.client,
            agency: candidate.agency,
            year,
            link: candidate.link,
            award,
            summary: candidate.summary,
          },
        ],
        tagVocabFlat,
      ),
    );
    costUsd += writerResult.costUsd;
    budget.add(writerResult.costUsd);
    if (!writerResult.ok) {
      throw new Error(`執筆エージェントの呼び出しに失敗しました: ${writerResult.error}`);
    }
    const writerArr = extractJsonArray(writerResult.text);
    const writerItem = writerArr?.[0] as Record<string, unknown> | undefined;
    if (!writerItem) {
      throw new Error("執筆エージェントが有効なエントリを返しませんでした");
    }
    // 指摘2: awardは常にaward-verifierで照合済みの`award`変数を採用し、writerItem.awardは
    // 参照しない（case-writerが記事本文から未照合の受賞情報を再生成しても紛れ込ませない）。
    const writer = buildWriterFieldsFromAgentOutput(writerItem, tagVocab, award);

    // ── 6. サムネイル（実画像必須。ダミー禁止 — 要件4） ────────────
    await setProgress(jobId, "サムネイル取得中");
    const thumb = await acquireThumbnail(id, {
      title: candidate.title,
      client: candidate.client,
      link: candidate.link,
      youtubeId: candidate.youtubeId,
    });
    if (!thumb) {
      throw new Error("サムネイル画像（og:image）を確保できませんでした");
    }
    thumbnailRelPath = path.join("public", thumb.thumbnail);

    const entry = buildAddCaseEntry({
      id,
      title: candidate.title,
      client: candidate.client,
      agency: candidate.agency,
      year,
      link: candidate.link,
      thumbnail: thumb.thumbnail,
      videoId: thumb.videoId,
      writer,
    });

    if (dryRun) {
      // auto-research-cc.mjs --dry-run と同じ慣例: 検証のため実際に取得したサムネイルは
      // 孤立ファイルとして残さず掃除する。cases.json書き込み・監査・commit/push・
      // verify-deploy・LINE通知はすべて行わない。
      await rm(path.join(ROOT, thumbnailRelPath), { force: true });
      await updateJob(jobId, {
        status: terminalStatus(ownsLock, "done"),
        progress: undefined,
        cost: costUsd,
        addCasePreview: {
          entry: entry as unknown as Record<string, unknown>,
          verification: {
            duplicate: false,
            linkAlive: true,
            titleMatch: verdict.titleMatch ?? "na",
            awardVerdict,
            thumbnailAcquired: true,
          },
        },
      });
      return;
    }

    // ── 7. 反映（データ書き込み） ─────────────────────────────────
    await setProgress(jobId, "反映中（データ書き込み）");
    newUntracked.push(thumbnailRelPath);
    const updatedCases = [entry, ...existingCases];
    await writeFile(CASES_PATH, JSON.stringify(updatedCases, null, 2));
    trackedTouched.push("data/cases.json");

    const resultCards: ResultCard[] = [
      {
        kind: "case",
        id: entry.id,
        url: `${SITE}/cases/${entry.id}`,
        title: entry.title,
        meta: [entry.client, entry.year].filter(Boolean).join(" · "),
        chip: entry.award ? { label: entry.award, jp: true } : undefined,
      },
    ];

    // ── 8. 監査 ──────────────────────────────────────────────────
    await setProgress(jobId, "品質監査中（サムネ/整合性/tsc/lint/build）");
    const audits: Array<{ name: string; run: () => Promise<{ ok: boolean; stdout: string; stderr: string }> }> = [
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
        throw new Error(`品質監査(${audit.name})に失敗しました。反映を中止しロールバックしました。\n${tail}`);
      }
    }

    // ── 9. commit/push ───────────────────────────────────────────
    await setProgress(jobId, "反映中（commit/push）");
    const addResult = await gitAdd(ROOT, [...trackedTouched, ...newUntracked]);
    if (!addResult.ok) {
      await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
      throw new Error(`git add に失敗しました: ${addResult.stderr.slice(0, 500)}`);
    }
    const commitResult = await gitCommit(ROOT, buildAddCaseCommitMessage(entry.title));
    if (!commitResult.ok) {
      await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
      throw new Error(`git commit に失敗しました: ${commitResult.stderr.slice(0, 500)}`);
    }
    // commit成功。以降は何が起きてもロールバックしない（caseResearch.tsと同じ方針）。
    committed = true;
    commitHash = await gitRevParseHead(ROOT);

    const pushResult = await gitPush(ROOT);
    if (!pushResult.ok) {
      const message = `push に失敗しました（pre-push監査等の可能性）。コミットはローカルに残っています（commit ${commitHash?.slice(0, 8) ?? "不明"}）。手動対応が必要です。`;
      await updateJob(jobId, {
        status: terminalStatus(ownsLock, "error"),
        progress: undefined,
        error: message,
        commit: commitHash,
        cost: costUsd,
      });
      await notifyLineIfPossible(lineUserId, buildAddCaseFailedText(message));
      return;
    }

    // ── 10. verify-deploy ─────────────────────────────────────────
    await setProgress(jobId, "本番反映を確認中");
    const verifyResult = await runVerifyDeploy(ROOT, [thumb.thumbnail]);
    let strictResult: { ok: boolean; failedUrls: string[] } = { ok: true, failedUrls: [] };
    if (verifyResult.ok) {
      await setProgress(jobId, "新規ページの反映を厳密確認中");
      strictResult = await pollStrictVerify([{ url: `${SITE}/cases/${entry.id}`, markers: [entry.id] }]);
    }
    const verified = verifyResult.ok && strictResult.ok;
    const caseUrl = `${SITE}/cases/${entry.id}`;

    if (verified) {
      await updateJob(jobId, {
        status: terminalStatus(ownsLock, "done"),
        progress: undefined,
        resultCards,
        commit: commitHash,
        deployedUrl: SITE,
        cost: costUsd,
      });
    } else {
      await updateJob(jobId, {
        status: terminalStatus(ownsLock, "done"),
        progress: undefined,
        warning: !verifyResult.ok
          ? "反映確認が時間切れでした。数分後に本番へ反映される見込みです。"
          : "新規ページは表示されましたが、内容の反映確認が時間切れでした（キャッシュ等の可能性）。数分後に再度ご確認ください。",
        resultCards,
        commit: commitHash,
        deployedUrl: SITE,
        cost: costUsd,
      });
    }
    // 反映確認が時間切れでも実際にはpush済み（=本番へ向かっている）ため、成功として通知する
    // （caseResearch.tsのunverified通知文言と同じ考え方。要件1: 成功時はタイトル+サイトURL）。
    await notifyLineIfPossible(lineUserId, buildAddCaseSuccessText(entry.title, caseUrl));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await rollbackIfNotCommitted(committed, trackedTouched, newUntracked, (tracked, untracked) =>
      rollbackTouchedFiles(ROOT, tracked, untracked),
    );
    const isBudgetError = err instanceof BudgetExceededError;
    if (committed && !isBudgetError) {
      const warning = `反映後の処理でエラーが発生しました（データは本番に反映済みの可能性があります。commit ${commitHash?.slice(0, 8) ?? "不明"}）: ${message}`;
      await updateJob(jobId, {
        status: terminalStatus(ownsLock, "done"),
        progress: undefined,
        warning,
        commit: commitHash,
        deployedUrl: SITE,
        cost: costUsd,
      });
      await notifyLineIfPossible(lineUserId, buildAddCaseFailedText(warning));
    } else if (committed && isBudgetError) {
      const msg = `${message}（データは本番に反映済みの可能性があります。commit ${commitHash?.slice(0, 8) ?? "不明"}）`;
      await updateJob(jobId, {
        status: terminalStatus(ownsLock, "error"),
        progress: undefined,
        error: msg,
        commit: commitHash,
        cost: costUsd,
        budgetExceeded: true,
      });
      await notifyLineIfPossible(lineUserId, buildAddCaseFailedText(msg));
    } else {
      await fail(jobId, lineUserId, message, costUsd, ownsLock);
    }
  } finally {
    await updateJob(jobId, { phaseDurationsMs: finishJob(jobId) }).catch(() => {});
    if (ownsLock) lock.release();
  }
}
