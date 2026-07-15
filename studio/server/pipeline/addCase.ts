/**
 * add-case 実パイプライン（LINEでURLを送ると事例/技術が cases.json または tech.json に
 * 追加される機能）。
 *
 * URL取得→内容抽出（case-adder Agent。contentKindでcase/tech/neitherを判定）→
 * 重複チェック→検証→（caseのみ執筆）→サムネイル→データ書き込み→監査→commit/push→
 * verify-deploy→LINE通知、を caseResearch.ts と同じ品質ガードレール・git運用・
 * ロールバック機構で実行する（rollbackIfNotCommitted/terminalStatus はcaseResearch.tsのもの
 * をそのまま再利用する）。
 *
 * contentKind分岐（case/tech自動振り分け）: case-adder Agentが返す contentKind によって
 * 以降のステップを完全に分ける。caseは既存のcase-writer/link-checker/award-verifierを使う
 * 執筆パイプライン、techはtechResearch.ts（Research(Technology)の一括収集パイプライン）と
 * 同じ品質ガードレール（validateAndDedupeTechCandidates・runAuditTech・isUrlAlive等）を
 * 単一候補向けに転用する。neitherは事例・技術のどちらでもない/確認不能として、従来どおり
 * 理由つきで失敗させる。
 *
 * caseResearch.tsとの違い:
 * - 候補は常に1件（テーマ収集ではなくURL指定のため、角度別並列収集・「複数候補から
 *   間引く」重複除外は不要。重複判定は既存cases.json/tech.jsonとの1件突き合わせのみ —
 *   addCasePure.ts参照）
 * - オーダータグの動的命名はしない。sourcesは常に固定の["User"]（要件5: ユーザー由来の目印。
 *   tech.jsonエントリのsourcesも同様に固定）
 * - 完了/失敗の通知は scripts/notify-line.mjs のテンプレ文言ではなく、addCase専用の
 *   成功/失敗テキスト（種別+タイトル+URL、または理由）を直接push する（LINEが唯一のUIのため、
 *   Studio Web UIでjob.errorを確認する運用を前提にできない）
 * - dryRun: true 時は cases.json/tech.json書き込み・commit/push・verify-deploy・LINE通知を
 *   スキップし、生成エントリと検証結果だけをjob.addCasePreviewへ記録する
 *   （auto-research-cc.mjs --dry-run と同じ「サムネイルは実際に取得を検証するが最後に
 *   掃除する」慣例に合わせる）
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gitAdd,
  gitCommit,
  gitPush,
  gitRevParseHead,
  rollbackTouchedFiles,
  runAuditIntegrity,
  runAuditTech,
  runAuditThumbnails,
  runBuild,
  runLint,
  runTypeCheck,
  runVerifyDeploy,
  runVerifyTechPages,
} from "./audit.js";
import { loadAgentDefinition } from "./agentLoader.js";
import { updateJob, type ResultCard } from "../jobs.js";
import { buildAwardVerifierPrompt, buildCaseWriterPrompt, buildLinkCheckerPrompt } from "./prompts.js";
import { buildCaseAdderPrompt } from "./addCasePrompts.js";
import {
  buildAddCaseCommitMessage,
  buildAddCaseEntry,
  buildAddTechCommitMessage,
  buildWriterFieldsFromAgentOutput,
  ensureUniqueCaseId,
  ensureUniqueTechId,
  extractJsonObject,
  findDuplicateCase,
  findExistingCaseTitleForTech,
  findExistingTechTitle,
  isUsableCandidate,
  isXLink,
  normalizeYear,
  parseContentKind,
  parseExtractedCandidate,
  parseExtractedTechCandidate,
  validateTechCandidateAllowingFallbackSource,
  type ValidatedAddCaseRequest,
} from "./addCasePure.js";
import { extractJsonArray, normalizeTitleKey, toCaseId } from "./pure.js";
import { acquireThumbnail } from "./thumbnail.js";
import {
  buildExistingTechIndex,
  buildTechEntry,
  findPrimaryLink,
  validateAndDedupeTechCandidates,
  type TechEntry,
  type TechVocab,
  type ValidatedTechCandidate,
} from "./techPure.js";
import { acquireTechThumbnail } from "./techThumbnail.js";
import { isUrlAlive } from "./techExternalScripts.js";
import { resolveLock, tryAcquireLock } from "./lock.js";
import { runAgentQuery } from "./sdkRunner.js";
import { BudgetExceededError, createJobBudgetTracker } from "./budget.js";
import { pollStrictVerify } from "./strictVerify.js";
import { finishJob, startPhase } from "./progressTiming.js";
import { pushLineMessage } from "../line/push.js";
import { loadLineConfig } from "../line/config.js";
import {
  buildAddCaseDuplicateAsCaseText,
  buildAddCaseDuplicateText,
  buildAddCaseFailedText,
  buildAddCaseSuccessText,
  buildAddTechFailedText,
} from "../line/messages.js";
import { rollbackIfNotCommitted, terminalStatus } from "./caseResearch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", ".."); // studio/server/pipeline -> repo root
const AGENTS_DIR = path.join(ROOT, ".claude", "agents");
const CASES_PATH = path.join(ROOT, "data", "cases.json");
const TAG_VOCAB_PATH = path.join(ROOT, "data", "tag-vocabulary.json");
const TECH_PATH = path.join(ROOT, "data", "tech.json");
const TECH_VOCAB_PATH = path.join(ROOT, "data", "tech-tag-vocabulary.json");
const TECH_THUMB_DIR = path.join(ROOT, "public", "thumbnails", "tech");
// verify-tech-pages.mjs（scripts/側・無改変）はこの固定パスの要約ファイルを読む。
// techResearch.ts（Research(Technology)一括収集パイプライン）と同じ契約を共有する。
const LAST_TECH_ADD_PATH = path.join(os.tmpdir(), "researchman-tech-last-add.json");
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

/**
 * kind未確定（URL取得直後・contentKind:"neither"等）はcase/tech区別ができないため、
 * 従来どおりbuildAddCaseFailedText（汎用文言）にフォールバックする。kindが"tech"と
 * 確定した後の失敗は、要件3（実測: tech判定後の失敗でも「事例の追加に失敗しました」と
 * 表示されユーザーが混乱していた）に沿ってbuildAddTechFailedTextを使う。
 */
function buildFailedTextForKind(kind: "case" | "tech" | undefined, message: string): string {
  return kind === "tech" ? buildAddTechFailedText(message) : buildAddCaseFailedText(message);
}

async function fail(
  jobId: string,
  lineUserId: string,
  message: string,
  costUsd: number,
  ownsLock: boolean,
  kind?: "case" | "tech",
): Promise<void> {
  await updateJob(jobId, {
    status: terminalStatus(ownsLock, "error"),
    progress: undefined,
    error: message,
    cost: costUsd,
  });
  await notifyLineIfPossible(lineUserId, buildFailedTextForKind(kind, message));
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
  // contentKind確定後の失敗文言の出し分け用（要件3）。case/tech分岐に入った時点で設定する。
  let determinedKind: "case" | "tech" | undefined;
  // "public/thumbnails/<id>.jpg"（case）または "public/thumbnails/tech/<id>.jpg"（tech）。
  // ROOT基準の相対パス。dryRun時の掃除・commit前ロールバックの両方で使う。
  let thumbnailRelPath = "";

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

    // ── 1. URL取得・内容抽出（case-adder。contentKindでcase/tech/neitherを判定） ──
    await setProgress(jobId, "URL取得・内容抽出中");
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
      throw new Error(`情報の抽出に失敗しました: ${adderResult.error}`);
    }
    const obj = extractJsonObject(adderResult.text);
    if (!obj) {
      throw new Error("抽出結果を解析できませんでした（Agent応答がJSON形式ではありません）");
    }
    const contentKind = parseContentKind(obj);
    if (contentKind === "neither") {
      // reasonの取り出しはparseExtractedCandidateを流用する（obj.reasonを読むだけの
      // 汎用ロジックのため、tech/case専用のパース関数を別途作る必要はない）。
      const reason = parseExtractedCandidate(obj).reason;
      throw new Error(reason || "指定されたURLから事例/技術情報を確認できませんでした");
    }

    if (contentKind === "case") {
      determinedKind = "case";
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
              // 指摘3（対称性）: tech側はverification.kind:"tech"を記録するのに対し、case側は
              // kindが無く実測でnullになっていた。dryRun preview利用側がkindでcase/techを
              // 判別できるよう、case側にもkindを明示する。
              kind: "case",
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
      // （caseResearch.tsのunverified通知文言と同じ考え方。要件3: 成功時は種別+タイトル+サイトURL）。
      await notifyLineIfPossible(lineUserId, buildAddCaseSuccessText("case", entry.title, caseUrl));
    } else {
      determinedKind = "tech";
      // contentKind === "tech"（要件2: Technology(tech.json)への振り分け）。
      // 以降はtechResearch.ts（Research(Technology)一括収集パイプライン）と同じ品質
      // ガードレール（validateAndDedupeTechCandidates/runAuditTech/isUrlAlive等）を
      // 単一候補向けに転用する。link-checker/award-verifier/case-writerはcase専用の
      // ステップのためtechでは呼ばない（techにawardの概念は無く、summary/point/detailは
      // case-adderが直接執筆する）。

      // ── 2. 重複チェック・書式検証（validateAndDedupeTechCandidatesを1件配列で流用） ──
      await setProgress(jobId, "重複チェック中");
      const existingTechFull = JSON.parse(await readFile(TECH_PATH, "utf-8")) as TechEntry[];
      const existingTechIndex = buildExistingTechIndex(existingTechFull);
      const existingCaseTitleKeys = new Set(existingCases.map((c) => normalizeTitleKey(c.title)));
      const techVocab = JSON.parse(await readFile(TECH_VOCAB_PATH, "utf-8")) as TechVocab;

      const rawTechCandidate = parseExtractedTechCandidate(obj);
      const { accepted, rejected } = validateAndDedupeTechCandidates(
        [rawTechCandidate],
        techVocab,
        existingTechIndex,
        existingCaseTitleKeys,
      );
      let validatedRaw: ValidatedTechCandidate;
      // falseなら一次ソース（github/project/product）が見つからず、送信されたURLをpostリンクとして
      // 採用した（要件1: 実際に起きた失敗の修正。一次ソースが見つかった場合の優先動作は現状維持）。
      let primarySourceFound: boolean;
      if (rejected.length > 0) {
        const rejection = rejected[0];
        // 指摘3と同じ考え方: 重複は失敗ではなく案内のため専用文言でその場で終端処理する。
        // 却下理由には既存側のタイトルが含まれない（新規候補側のid/techNameしか分からない）ため、
        // 既存側の表示名を別途探す（見つからなければ候補自身のtechNameへフォールバックする＝
        // 安全側）。
        // レビュー指摘2: 却下理由が「Case Studyとタイトルが重複」（techPure.ts
        // validateAndDedupeTechCandidates参照）の場合、衝突相手はtech.jsonではなくcases.json
        // 側のエントリのため、findExistingTechTitle（tech.json専用）では見つからずnull→
        // 候補自身の名前にフォールバックして案内が不正確になっていた。この却下理由の場合だけ
        // cases.json（既にこの関数冒頭で読み込み済みのexistingCases）から一致タイトルを探し、
        // 「既に登録済み（Case Studyとして）」の専用文言を使う。
        if (rejection.reason === "Case Studyとタイトルが重複") {
          const techNameRaw = typeof rawTechCandidate.techName === "string" ? rawTechCandidate.techName : "";
          const existingCaseTitle = findExistingCaseTitleForTech(techNameRaw, existingCases) ?? techNameRaw;
          const message = buildAddCaseDuplicateAsCaseText(existingCaseTitle);
          await updateJob(jobId, { status: "error", progress: undefined, error: message, cost: costUsd });
          await notifyLineIfPossible(lineUserId, message);
          return;
        }
        if (rejection.reason.includes("重複")) {
          const techNameRaw = typeof rawTechCandidate.techName === "string" ? rawTechCandidate.techName : "";
          const existingTitle = findExistingTechTitle(techNameRaw, existingTechFull) ?? techNameRaw;
          const message = buildAddCaseDuplicateText(existingTitle);
          await updateJob(jobId, { status: "error", progress: undefined, error: message, cost: costUsd });
          await notifyLineIfPossible(lineUserId, message);
          return;
        }
        if (rejection.reason === "一次ソース（github/project/product）がありません") {
          // 要件1: 実際に起きた失敗（Xポストのソフトロボット研究紹介動画がエージェントの
          // Web検索でも一次ソースを見つけられず失敗していた）。techPure.tsは日次バッチ側の
          // 共有ロジックのため無改変とし、add-case専用の縮退（fallbackUrl=送信されたURLを
          // kind:"post"のリンクとして採用）をaddCasePure.tsの専用関数で行う。この却下理由に
          // 到達した時点で一次ソース以外の検証は全てvalidateAndDedupeTechCandidatesを通過済みのため、
          // この再検証は理論上失敗しないはずだが、呼び出し順変更等への防御として結果を確認する。
          const fallback = validateTechCandidateAllowingFallbackSource(
            rawTechCandidate,
            techVocab,
            existingTechIndex,
            existingCaseTitleKeys,
            url,
          );
          if (!fallback.ok) {
            throw new Error(`技術情報の検証に失敗しました: ${fallback.reason}`);
          }
          validatedRaw = fallback.value;
          primarySourceFound = fallback.primarySourceFound;
        } else {
          throw new Error(`技術情報の検証に失敗しました: ${rejection.reason}`);
        }
      } else {
        validatedRaw = accepted[0];
        primarySourceFound = true;
      }
      // 要件5: caseのensureUniqueCaseIdと同じ「idスラッグの偶然衝突」対策をtech側にも適用する
      // （別技術が同じスラッグに丸められて詳細ページ/サムネイルを上書きする事故の防止）。
      // validateAndDedupeTechCandidatesは既存idとの衝突を既に「重複」として上のブロックで
      // 弾いているため、通常この呼び出しはno-opになるが、case側と同じ防御方針を明示的に適用する。
      const techId = ensureUniqueTechId(validatedRaw.id, existingTechIndex.ids);
      const validated: ValidatedTechCandidate = { ...validatedRaw, id: techId };

      // ── 3. 一次ソース死活検証（case側のlink-checker Agentと異なり、techResearch.tsと
      //    同じ単純なisUrlAlive判定。titleMatchの概念はtechには無い）。
      //    一次ソースが見つからず縮退登録した場合（primarySourceFound=false）は、代わりに
      //    採用した送信URL自体の生存確認に切り替える（要件1: 死リンクまで通してしまわない） ──
      await setProgress(jobId, "一次ソース検証中（リンク）");
      const primary = findPrimaryLink(validated.links);
      const linkToCheck = primary?.url ?? url;
      const alive = await isUrlAlive(linkToCheck);
      if (!alive) {
        throw new Error(
          primary
            ? "一次ソースの死活確認に失敗しました（死リンクと判定）"
            : "送信されたURLの死活確認に失敗しました（死リンクと判定）",
        );
      }

      // ── 4. サムネイル（実画像必須。ダミー禁止 — 要件4はcase/tech共通） ────────────
      await setProgress(jobId, "サムネイル取得中");
      const techThumb = await acquireTechThumbnail(TECH_THUMB_DIR, validated.id, validated.links, validated.thumbnailSource);
      if (!techThumb) {
        throw new Error("サムネイル画像を確保できませんでした");
      }
      thumbnailRelPath = path.join("public", techThumb.thumbnail);

      // sourcesはcase側と同様 ["User"] 固定（要件2: エージェント出力からは採らない）。
      const techEntry = buildTechEntry(validated, techThumb.thumbnail, "User");

      if (dryRun) {
        await rm(path.join(ROOT, thumbnailRelPath), { force: true });
        await updateJob(jobId, {
          status: terminalStatus(ownsLock, "done"),
          progress: undefined,
          cost: costUsd,
          addCasePreview: {
            entry: techEntry as unknown as Record<string, unknown>,
            verification: {
              kind: "tech",
              duplicate: false,
              linkAlive: true,
              thumbnailAcquired: true,
              // 要件2: 一次ソース未発見のままpostリンクで縮退登録したことをdryRunプレビューでも
              // 判別できるようにする。
              primarySourceFound,
            },
          },
        });
        return;
      }

      // ── 5. 反映（データ書き込み） ─────────────────────────────────
      await setProgress(jobId, "反映中（データ書き込み）");
      newUntracked.push(thumbnailRelPath);
      const updatedTech = [techEntry, ...existingTechFull];
      await writeFile(TECH_PATH, JSON.stringify(updatedTech, null, 2));
      trackedTouched.push("data/tech.json");

      const techResultCards: ResultCard[] = [
        {
          kind: "tech",
          id: techEntry.id,
          url: `${SITE}/technology/${techEntry.id}`,
          title: techEntry.title,
          meta: [techEntry.org, techEntry.year].filter(Boolean).join(" · "),
          chip: { label: techEntry.type, jp: false },
        },
      ];

      // ── 6. 監査（audit-tech。case側のaudit-thumbnails/audit-integrityとは別物 — 要件2） ──
      await setProgress(jobId, "品質監査中（tech整合/tsc/lint/build）");
      const techAudits: Array<{ name: string; run: () => Promise<{ ok: boolean; stdout: string; stderr: string }> }> = [
        { name: "audit-tech", run: () => runAuditTech(ROOT) },
        { name: "tsc --noEmit", run: () => runTypeCheck(ROOT) },
        { name: "lint", run: () => runLint(ROOT) },
        { name: "build", run: () => runBuild(ROOT) },
      ];
      for (const audit of techAudits) {
        const result = await audit.run();
        if (!result.ok) {
          const tail = [result.stderr.trim().slice(-3000), result.stdout.trim().slice(-1500)].filter(Boolean).join("\n---stdout---\n");
          await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
          throw new Error(`品質監査(${audit.name})に失敗しました。反映を中止しロールバックしました。\n${tail}`);
        }
      }

      // ── 7. commit/push ───────────────────────────────────────────
      await setProgress(jobId, "反映中（commit/push）");
      const techAddResult = await gitAdd(ROOT, [...trackedTouched, ...newUntracked]);
      if (!techAddResult.ok) {
        await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
        throw new Error(`git add に失敗しました: ${techAddResult.stderr.slice(0, 500)}`);
      }
      // レビュー指摘: techPure.buildTechCommitMessage（日次バッチ収集）と同一文言だと
      // git履歴でLINE由来の単発追加と区別できないため、buildAddCaseCommitMessage（case側）に
      // 倣ったaddCasePure専用のbuildAddTechCommitMessageを使う。
      const techCommitResult = await gitCommit(ROOT, buildAddTechCommitMessage(techEntry.title));
      if (!techCommitResult.ok) {
        await rollbackTouchedFiles(ROOT, trackedTouched, newUntracked);
        throw new Error(`git commit に失敗しました: ${techCommitResult.stderr.slice(0, 500)}`);
      }
      committed = true;
      commitHash = await gitRevParseHead(ROOT);

      const techPushResult = await gitPush(ROOT);
      if (!techPushResult.ok) {
        const message = `push に失敗しました（pre-push監査等の可能性）。コミットはローカルに残っています（commit ${commitHash?.slice(0, 8) ?? "不明"}）。手動対応が必要です。`;
        await updateJob(jobId, {
          status: terminalStatus(ownsLock, "error"),
          progress: undefined,
          error: message,
          commit: commitHash,
          cost: costUsd,
        });
        await notifyLineIfPossible(lineUserId, buildAddTechFailedText(message));
        return;
      }

      // ── 8. verify-deploy（--skip-pages + verify-tech-pages。techResearch.tsと同じ回避策。
      //    verify-deploy.mjsの既定ページ検証はCase Study用サマリーを読むため無効化する） ──
      await setProgress(jobId, "本番反映を確認中");
      await writeFile(
        LAST_TECH_ADD_PATH,
        JSON.stringify({ count: 1, cases: [{ id: techEntry.id, title: techEntry.title, year: techEntry.year }] }, null, 2),
      );
      const verifyDeployResult = await runVerifyDeploy(ROOT, [], ["--skip-pages"]);
      const verifyPagesResult = await runVerifyTechPages(ROOT);
      const baseVerified = verifyDeployResult.ok && verifyPagesResult.ok;
      let techStrictResult: { ok: boolean; failedUrls: string[] } = { ok: true, failedUrls: [] };
      if (baseVerified) {
        await setProgress(jobId, "新規ページの反映を厳密確認中");
        techStrictResult = await pollStrictVerify([{ url: `${SITE}/technology/${techEntry.id}`, markers: [techEntry.id] }]);
      }
      const techVerified = baseVerified && techStrictResult.ok;
      const techUrl = `${SITE}/technology/${techEntry.id}`;

      if (techVerified) {
        await updateJob(jobId, {
          status: terminalStatus(ownsLock, "done"),
          progress: undefined,
          resultCards: techResultCards,
          commit: commitHash,
          deployedUrl: SITE,
          cost: costUsd,
        });
      } else {
        await updateJob(jobId, {
          status: terminalStatus(ownsLock, "done"),
          progress: undefined,
          warning: !baseVerified
            ? "反映確認が時間切れでした。数分後に本番へ反映される見込みです。"
            : "新規ページは表示されましたが、内容の反映確認が時間切れでした（キャッシュ等の可能性）。数分後に再度ご確認ください。",
          resultCards: techResultCards,
          commit: commitHash,
          deployedUrl: SITE,
          cost: costUsd,
        });
      }
      // 要件2: 一次ソース未発見のままpostリンク（送信URL）で縮退登録した場合、その旨をLINE成功
      // 文言に明記する（ユーザーが「本当に一次ソース確認済みなのか」誤解しないように）。
      const successNote = primarySourceFound ? undefined : "※一次ソース未発見のため投稿リンクで登録";
      await notifyLineIfPossible(lineUserId, buildAddCaseSuccessText("tech", techEntry.title, techUrl, successNote));
    }
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
      await notifyLineIfPossible(lineUserId, buildFailedTextForKind(determinedKind, warning));
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
      await notifyLineIfPossible(lineUserId, buildFailedTextForKind(determinedKind, msg));
    } else {
      await fail(jobId, lineUserId, message, costUsd, ownsLock, determinedKind);
    }
  } finally {
    await updateJob(jobId, { phaseDurationsMs: finishJob(jobId) }).catch(() => {});
    if (ownsLock) lock.release();
  }
}
