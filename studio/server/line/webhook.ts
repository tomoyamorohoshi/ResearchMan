/**
 * POST /api/line-webhook（LINE Messaging API webhook）。
 *
 * 「LINEで対話→ウィザードで内容を固める→y返信で実行→LINEで結果」の入口。テキストメッセージ
 * のみ対象。ジョブの完了/エラー通知は既存パイプライン（caseResearch.ts等 → notify-line.mjs）が
 * 送るため、ここでは実装しない（jobs.ts::createJob に渡すだけで完結する）。
 *
 * 会話の状態遷移そのものは wizard.ts::stepWizard（純粋関数）に切り出してある。このファイルの
 * 役割は「キャンセル判定→期限切れ判定→stepWizard呼び出し→（必要なら）Claude構造化/createJob
 * という副作用の実行」という薄いオーケストレーションのみ。
 *
 * ルーティング上の制約: 署名検証には生のリクエストボディが要る。index.ts側で
 * このルートにだけ express.raw() を、グローバルな express.json() より前に登録すること
 * （このファイル自体はミドルウェア登録順を制御できないため、index.ts側の責務として
 * コメントを残す）。
 *
 * 応答方針: 署名検証に失敗したら401。それ以外（許可外送信者・解釈失敗等、業務上の失敗も
 * 含む）は常に200を返す。LINEはwebhookが2xx以外を返すと再送してくることがあり、
 * 業務エラーで200以外を返すと再送の嵐になる（タスク指示どおり）。
 *
 * 応答経路（2026-07-24改訂）: ユーザーへの即時応答（ウィザードの質問・確認・実行開始・
 * バリデーションエラー等）は reply API 優先（無料枠を消費しない。reply.ts参照）。
 * replyTokenは受信イベントから取り出し、Claude構造化（最大60秒）を挟んでも同じ値を使う
 * （数秒〜数十秒ならreplyTokenは通常有効。失効していればreply.ts側でpushへ自動フォールバック
 * するため、ここでは分岐を増やさず deps.respond を呼ぶだけでよい）。ジョブ完了/エラーの
 * 事後通知（数分〜数十分後）はreplyTokenが使えないため、引き続きpush（notify-line.mjs等）。
 */
import type express from "express";
import {
  createJob,
  findLatestFinishedJob,
  findResumableAwardsJob,
  listActiveJobs,
  ValidationError,
  type Job,
  type ResumableAwardsJob,
  type Tab,
} from "../jobs.js";
import { resumeAwardJob } from "../pipeline/awardResearch.js";
import { isCancelText, isProgressText, isResumeText, type LineRequestKind } from "./classify.js";
import { loadLineConfig, type LineConfig } from "./config.js";
import {
  buildAddCaseAcceptedText,
  buildAwardAcceptedText,
  buildAwardResumeAcceptedText,
  buildAwardResumeNotFoundText,
  buildCancelledText,
  buildExecStartedText,
  buildExpiredAndMenuText,
  buildJobCreateFailedText,
  buildNoPendingText,
  buildProgressStatusText,
  buildQueuedAcceptedText,
  buildStructureFailedText,
  buildUnconfiguredAllowedUserText,
} from "./messages.js";
import { isPendingExpired, loadPending, savePending, type LinePending } from "./pending.js";
import { replyOrPushLineMessage } from "./reply.js";
import { verifyLineSignature } from "./signature.js";
import { structureAwardViaClaude, structureViaClaude, type AwardStructureResult, type StructureResult } from "./structure.js";
import { buildMenuPending, pendingFromStructured, renderFinalConfirm, stepWizard } from "./wizard.js";

export interface LineWebhookDeps {
  getConfig: () => LineConfig | null;
  /** 即時応答の送信。reply優先・失敗時push フォールバック（reply.ts参照）。 */
  respond: (channelAccessToken: string, replyToken: string | undefined, userId: string, text: string) => Promise<void>;
  createJob: (tab: Tab, request: Record<string, unknown>) => Promise<Job>;
  loadPending: () => Promise<LinePending | null>;
  savePending: (p: LinePending | null) => Promise<void>;
  structure: (kind: LineRequestKind, freeText: string) => Promise<StructureResult>;
  /** AWARDS専用（Q1/Q2の2問から構造化する。structureとは異なる形の入力・出力）。 */
  structureAward: (q1: string, q2: string) => Promise<AwardStructureResult>;
  /** 「再開」キーワード（要件A.3・D.3）: 予算超過で一時停止中のAWARDSジョブを探す。無ければnull。 */
  findResumableAwardsJob: () => Promise<ResumableAwardsJob | null>;
  /** 見つかったジョブをcheckpointから再開する（新しい予算枠で続行。awardResearch.ts参照）。 */
  resumeAwardsJob: (jobId: string) => Promise<void>;
  /** 「進捗」「状況」キーワード向け: status="running"/"paused"の全ジョブ。 */
  listActiveJobs: () => Promise<Job[]>;
  /** 「進捗」「状況」キーワード向け: 実行中/一時停止中ジョブが無いときに案内する直近の完了ジョブ1件。 */
  findLatestFinishedJob: () => Promise<Job | null>;
  now: () => Date;
}

const defaultDeps: LineWebhookDeps = {
  getConfig: loadLineConfig,
  respond: replyOrPushLineMessage,
  createJob,
  loadPending,
  savePending,
  structure: structureViaClaude,
  structureAward: structureAwardViaClaude,
  findResumableAwardsJob,
  resumeAwardsJob: resumeAwardJob,
  listActiveJobs,
  findLatestFinishedJob,
  now: () => new Date(),
};

function logMissingChannelSecret(): void {
  console.error(
    [
      "[studio][line] channelSecret が未設定のため webhook を503で拒否しました。",
      "設定手順: LINE Developers Console → 対象チャネル → Messaging API設定 → Channel secret をコピーし、",
      '~/.researchman-line.json に { "channelSecret": "<値>" } を追加してください（allowedUserId も参照）。',
    ].join("\n"),
  );
}

/**
 * イベント1件を処理する（非同期。呼び出し側=ハンドラ本体はレスポンス送出後にfire-and-forgetで呼ぶ）。
 * text以外のメッセージ種別・message以外のイベント種別は無視する。
 */
async function handleEvent(event: unknown, config: LineConfig, deps: LineWebhookDeps): Promise<void> {
  if (!event || typeof event !== "object") return;
  const e = event as Record<string, unknown>;
  if (e.type !== "message") return;
  const message = e.message as Record<string, unknown> | undefined;
  if (!message || message.type !== "text" || typeof message.text !== "string") return;
  const text = message.text;
  const source = e.source as Record<string, unknown> | undefined;
  const userId = typeof source?.userId === "string" ? source.userId : "";
  if (!userId) return;
  // 即時応答（このイベントへの返信）に使う。受信直後の値を使い回す（Claude構造化等の
  // 非同期処理を挟んでも同じ値のまま。失効時のフォールバックは deps.respond 内部で行う）。
  const replyToken = typeof e.replyToken === "string" ? e.replyToken : undefined;

  const token = config.channelAccessToken ?? "";

  if (!config.allowedUserId) {
    await deps.respond(token, replyToken, userId, buildUnconfiguredAllowedUserText(userId));
    return;
  }
  if (userId !== config.allowedUserId) {
    // 未許可の送信者には応答しない（存在確認を許さない。サーバログにのみ残す）。
    console.warn(`[studio][line] 未許可の送信者からのメッセージを無視しました（userId=${userId}）`);
    return;
  }

  const now = deps.now();

  // 「再開」（要件A.3・D.3）: 予算超過で一時停止中のAWARDSジョブをユーザーの意思で再開する
  // 全状態で有効な予約語。pending（研究/アイデア/AWARDS Q1・Q2の対話状態）とは無関係のため、
  // キャンセルと同じくstepWizardより前に判定する。
  if (isResumeText(text)) {
    const job = await deps.findResumableAwardsJob();
    if (!job) {
      await deps.respond(token, replyToken, userId, buildAwardResumeNotFoundText());
      return;
    }
    await deps.respond(token, replyToken, userId, buildAwardResumeAcceptedText());
    deps.resumeAwardsJob(job.id).catch((err) => {
      console.error("[studio][line] AWARDSジョブの再開に失敗しました", err);
    });
    return;
  }

  // キャンセルは全状態で有効（item9）。stepWizardより前に判定する。
  if (isCancelText(text)) {
    const pending = await deps.loadPending();
    if (pending && pending.userId === userId && !isPendingExpired(pending, now)) {
      await deps.savePending(null);
      await deps.respond(token, replyToken, userId, buildCancelledText());
    } else {
      await deps.respond(token, replyToken, userId, buildNoPendingText());
    }
    return;
  }

  // 「進捗」「状況」（進捗の対話的照会）: 「再開」「キャンセル」と同じく全状態で有効な
  // 予約語として扱う。ウィザード進行中でも割り込んで答えられるよう、stepWizardより前に
  // 判定し、pendingは一切読み書きしない（照会してもウィザードの進行状態は壊れない）。
  if (isProgressText(text)) {
    const active = await deps.listActiveJobs();
    const latestFinished = active.length > 0 ? null : await deps.findLatestFinishedJob();
    await deps.respond(token, replyToken, userId, buildProgressStatusText(active, latestFinished, now));
    return;
  }

  const stored = await deps.loadPending();
  const storedForUser = stored && stored.userId === userId ? stored : null;

  // 期限切れのpendingが残っている状態でメッセージが来たら、内容に関わらず期限切れを通知し
  // メニューへ差し戻す（item10）。
  if (storedForUser && isPendingExpired(storedForUser, now)) {
    await deps.savePending(buildMenuPending(userId, now));
    await deps.respond(token, replyToken, userId, buildExpiredAndMenuText());
    return;
  }

  const outcome = stepWizard(storedForUser, text, now, userId);

  if (outcome.kind === "needsStructure") {
    const structured = await deps.structure(outcome.requestKind, outcome.freeText);
    if (!structured.ok) {
      await deps.respond(token, replyToken, userId, buildStructureFailedText(structured.error));
      return;
    }
    const next = pendingFromStructured(userId, structured.tab, structured.value, now);
    await deps.savePending(next);
    await deps.respond(token, replyToken, userId, renderFinalConfirm(next));
    return;
  }

  if (outcome.kind === "needsAwardStructure") {
    // research/ideaのショートカット経路（needsStructure）と異なりfinal_confirmを挟まないため、
    // pendingはここで即クリアする（"execute"分岐と同じタイミング）。
    await deps.savePending(null);
    const structured = await deps.structureAward(outcome.q1, outcome.q2);
    if (!structured.ok) {
      await deps.respond(token, replyToken, userId, buildStructureFailedText(structured.error));
      return;
    }
    try {
      await deps.createJob("awards", { ...structured.value, lineUserId: userId });
      await deps.respond(token, replyToken, userId, buildAwardAcceptedText());
    } catch (err) {
      const reason = err instanceof ValidationError || err instanceof Error ? err.message : String(err);
      await deps.respond(token, replyToken, userId, buildJobCreateFailedText(reason));
    }
    return;
  }

  if (outcome.kind === "addCase") {
    // 事例追加（URL投稿）は確認ステップなしで即ジョブ投入する（item1）。pendingは
    // そもそも作っていない（wizard.ts::stepIdle参照）ので保存操作は不要。
    // lineUserId をリクエストに含めることで、パイプライン（addCase.ts）が完了/失敗時に
    // このuserId宛へ結果をpushする（API入口=Claude Code一括処理はlineUserIdが無いため
    // LINE通知はスキップされる）。
    try {
      const job = await deps.createJob("add-case", { url: outcome.url, context: outcome.context, lineUserId: userId });
      await deps.respond(token, replyToken, userId, job.status === "queued" ? buildQueuedAcceptedText() : buildAddCaseAcceptedText());
    } catch (err) {
      const reason = err instanceof ValidationError || err instanceof Error ? err.message : String(err);
      await deps.respond(token, replyToken, userId, buildJobCreateFailedText(reason));
    }
    return;
  }

  if (outcome.kind === "execute") {
    await deps.savePending(null);
    try {
      const job = await deps.createJob(outcome.tab, outcome.request);
      await deps.respond(token, replyToken, userId, job.status === "queued" ? buildQueuedAcceptedText() : buildExecStartedText());
    } catch (err) {
      const reason = err instanceof ValidationError || err instanceof Error ? err.message : String(err);
      await deps.respond(token, replyToken, userId, buildJobCreateFailedText(reason));
    }
    return;
  }

  await deps.savePending(outcome.pending);
  await deps.respond(token, replyToken, userId, outcome.reply);
}

export function createLineWebhookHandler(overrides: Partial<LineWebhookDeps> = {}): express.RequestHandler {
  const deps: LineWebhookDeps = { ...defaultDeps, ...overrides };

  return (req, res) => {
    const config = deps.getConfig();
    if (!config?.channelSecret) {
      logMissingChannelSecret();
      res.status(503).end();
      return;
    }

    // req.body は index.ts 側で express.raw() を適用しているため Buffer のはず。
    // 万一（テスト用の素のexpress.json()等）Bufferでなければ、生バイト列が
    // 手に入らず署名検証は必ず失敗する（安全側に倒れるだけで、実運用経路では起きない）。
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const signature = req.header("x-line-signature");
    if (!verifyLineSignature(rawBody, signature, config.channelSecret)) {
      res.status(401).end();
      return;
    }

    // 署名検証OK以降は常に200（LINEの再送嵐を防ぐ）。以降の処理は非同期。
    res.status(200).end();

    let payload: { events?: unknown[] } = {};
    try {
      payload = JSON.parse(rawBody.toString("utf-8")) as { events?: unknown[] };
    } catch (err) {
      console.error("[studio][line] webhook body のJSONパースに失敗しました", err);
      return;
    }
    const events = Array.isArray(payload.events) ? payload.events : [];
    for (const event of events) {
      handleEvent(event, config, deps).catch((err) => {
        console.error("[studio][line] イベント処理に失敗しました", err);
      });
    }
  };
}
