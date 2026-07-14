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
 * reply tokenではなくpushで返信する設計判断は push.ts 冒頭のコメント参照。
 */
import type express from "express";
import { createJob, ValidationError, type Tab } from "../jobs.js";
import { isCancelText, type LineRequestKind } from "./classify.js";
import { loadLineConfig, type LineConfig } from "./config.js";
import {
  buildAddCaseAcceptedText,
  buildCancelledText,
  buildExecStartedText,
  buildExpiredAndMenuText,
  buildJobCreateFailedText,
  buildNoPendingText,
  buildStructureFailedText,
  buildUnconfiguredAllowedUserText,
} from "./messages.js";
import { isPendingExpired, loadPending, savePending, type LinePending } from "./pending.js";
import { pushLineMessage } from "./push.js";
import { verifyLineSignature } from "./signature.js";
import { structureViaClaude, type StructureResult } from "./structure.js";
import { buildMenuPending, pendingFromStructured, renderFinalConfirm, stepWizard } from "./wizard.js";

export interface LineWebhookDeps {
  getConfig: () => LineConfig | null;
  sendPush: (channelAccessToken: string, userId: string, text: string) => Promise<void>;
  createJob: (tab: Tab, request: Record<string, unknown>) => Promise<unknown>;
  loadPending: () => Promise<LinePending | null>;
  savePending: (p: LinePending | null) => Promise<void>;
  structure: (kind: LineRequestKind, freeText: string) => Promise<StructureResult>;
  now: () => Date;
}

const defaultDeps: LineWebhookDeps = {
  getConfig: loadLineConfig,
  sendPush: pushLineMessage,
  createJob,
  loadPending,
  savePending,
  structure: structureViaClaude,
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

  const token = config.channelAccessToken ?? "";

  if (!config.allowedUserId) {
    await deps.sendPush(token, userId, buildUnconfiguredAllowedUserText(userId));
    return;
  }
  if (userId !== config.allowedUserId) {
    // 未許可の送信者には応答しない（存在確認を許さない。サーバログにのみ残す）。
    console.warn(`[studio][line] 未許可の送信者からのメッセージを無視しました（userId=${userId}）`);
    return;
  }

  const now = deps.now();

  // キャンセルは全状態で有効（item9）。stepWizardより前に判定する。
  if (isCancelText(text)) {
    const pending = await deps.loadPending();
    if (pending && pending.userId === userId && !isPendingExpired(pending, now)) {
      await deps.savePending(null);
      await deps.sendPush(token, userId, buildCancelledText());
    } else {
      await deps.sendPush(token, userId, buildNoPendingText());
    }
    return;
  }

  const stored = await deps.loadPending();
  const storedForUser = stored && stored.userId === userId ? stored : null;

  // 期限切れのpendingが残っている状態でメッセージが来たら、内容に関わらず期限切れを通知し
  // メニューへ差し戻す（item10）。
  if (storedForUser && isPendingExpired(storedForUser, now)) {
    await deps.savePending(buildMenuPending(userId, now));
    await deps.sendPush(token, userId, buildExpiredAndMenuText());
    return;
  }

  const outcome = stepWizard(storedForUser, text, now, userId);

  if (outcome.kind === "needsStructure") {
    const structured = await deps.structure(outcome.requestKind, outcome.freeText);
    if (!structured.ok) {
      await deps.sendPush(token, userId, buildStructureFailedText(structured.error));
      return;
    }
    const next = pendingFromStructured(userId, structured.tab, structured.value, now);
    await deps.savePending(next);
    await deps.sendPush(token, userId, renderFinalConfirm(next));
    return;
  }

  if (outcome.kind === "addCase") {
    // 事例追加（URL投稿）は確認ステップなしで即ジョブ投入する（item1）。pendingは
    // そもそも作っていない（wizard.ts::stepIdle参照）ので保存操作は不要。
    // lineUserId をリクエストに含めることで、パイプライン（addCase.ts）が完了/失敗時に
    // このuserId宛へ結果をpushする（API入口=Claude Code一括処理はlineUserIdが無いため
    // LINE通知はスキップされる）。
    try {
      await deps.createJob("add-case", { url: outcome.url, context: outcome.context, lineUserId: userId });
      await deps.sendPush(token, userId, buildAddCaseAcceptedText());
    } catch (err) {
      const reason = err instanceof ValidationError || err instanceof Error ? err.message : String(err);
      await deps.sendPush(token, userId, buildJobCreateFailedText(reason));
    }
    return;
  }

  if (outcome.kind === "execute") {
    await deps.savePending(null);
    try {
      await deps.createJob(outcome.tab, outcome.request);
      await deps.sendPush(token, userId, buildExecStartedText());
    } catch (err) {
      const reason = err instanceof ValidationError || err instanceof Error ? err.message : String(err);
      await deps.sendPush(token, userId, buildJobCreateFailedText(reason));
    }
    return;
  }

  await deps.savePending(outcome.pending);
  await deps.sendPush(token, userId, outcome.reply);
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
