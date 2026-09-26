/**
 * LINE Messaging API への push送信（scripts/notify-line.mjs の https直叩き実装を踏襲。
 * SDK追加はしない）。
 *
 * 設計判断（2026-07-24改訂）: webhookイベントへの即時応答（ウィザードの質問・確認・
 * 実行開始通知・エラー通知等）は reply.ts::replyOrPushLineMessage が reply API を優先し
 * （無料枠を消費しない）、reply失効時のみここへフォールバックする。この push.ts が直接
 * 呼ばれるのは、（1）reply失敗時のフォールバック、（2）ジョブ完了/エラーの事後通知
 * （数分〜数十分後にreplyTokenがもう使えない。addCase.ts・awardResearch.ts等）の2用途。
 */
import https from "node:https";
import type { LineMessage } from "./xpostPure.js";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";
// LINEの1メッセージは5,000字上限（安全マージンを取って切り詰める。本機能の返信は
// いずれも短文想定のため、通常はこの分岐に入らない）。
const LINE_MSG_LIMIT = 4800;
// LINE Messaging APIの1回の送信あたりのメッセージ数上限。
const LINE_MESSAGES_PER_SEND = 5;

export interface PushResult {
  ok: boolean;
  status: number;
  body: string;
}

/** textメッセージのみ4800字に切り詰め、image等はそのまま通す（X投稿の複数吹き出し送信向け）。 */
function clampMessage(message: LineMessage): LineMessage {
  return message.type === "text" ? { type: "text", text: message.text.slice(0, LINE_MSG_LIMIT) } : message;
}

function requestPush(channelAccessToken: string, userId: string, text: string): Promise<PushResult> {
  const body = JSON.stringify({ to: userId, messages: [{ type: "text", text: text.slice(0, LINE_MSG_LIMIT) }] });
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: PushResult): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const req = https.request(
      PUSH_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${channelAccessToken}`,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        const finish = (): void => settle({ ok: (res.statusCode ?? 0) === 200, status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() });
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", finish);
      },
    );
    req.on("error", (e) => settle({ ok: false, status: 0, body: e.message }));
    req.setTimeout(15_000, () => {
      settle({ ok: false, status: 0, body: "timeout" });
      req.destroy();
    });
    req.write(body);
    req.end();
  });
}

/**
 * push送信のfire-and-forgetラッパー。scripts/notify-line.mjs と同じ「おまけ」設計 —
 * 送信失敗（トークン不備・LINE側障害等）でも本体のジョブ作成フローを巻き込まない。
 * 失敗時はログのみ。
 */
export async function pushLineMessage(channelAccessToken: string, userId: string, text: string): Promise<void> {
  if (!channelAccessToken) {
    console.warn("[studio][line] channelAccessToken未設定のためpush送信をスキップしました");
    return;
  }
  try {
    const result = await requestPush(channelAccessToken, userId, text);
    if (!result.ok) {
      console.warn(`[studio][line] push送信失敗（status=${result.status} ${result.body}）`);
    }
  } catch (err) {
    console.warn("[studio][line] push送信で例外", err);
  }
}

// ── 複数吹き出し送信（X投稿。DESIGN合意 docs/X_POST_DRAFTS_DESIGN.md v2） ──────────
// 既存のpushLineMessage（単一テキスト）の挙動・実装は変更しない。以下は追加のみ。

function requestPushMessages(channelAccessToken: string, userId: string, messages: LineMessage[]): Promise<PushResult> {
  const body = JSON.stringify({ to: userId, messages: messages.slice(0, LINE_MESSAGES_PER_SEND).map(clampMessage) });
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: PushResult): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const req = https.request(
      PUSH_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${channelAccessToken}`,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        const finish = (): void => settle({ ok: (res.statusCode ?? 0) === 200, status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() });
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", finish);
      },
    );
    req.on("error", (e) => settle({ ok: false, status: 0, body: e.message }));
    req.setTimeout(15_000, () => {
      settle({ ok: false, status: 0, body: "timeout" });
      req.destroy();
    });
    req.write(body);
    req.end();
  });
}

/**
 * 複数吹き出し（テキスト/画像混在、最大5件。LINE Messaging APIの1回の送信あたりの上限と
 * 同じ）のpush送信。fire-and-forget（pushLineMessageと同じ「おまけ」設計。失敗時はログのみ）。
 * push自体は1回の送信で枠を1通しか消費しない（DESIGN合意）。
 */
export async function pushLineMessages(channelAccessToken: string, userId: string, messages: LineMessage[]): Promise<void> {
  if (!channelAccessToken) {
    console.warn("[studio][line] channelAccessToken未設定のためpush送信をスキップしました");
    return;
  }
  try {
    const result = await requestPushMessages(channelAccessToken, userId, messages);
    if (!result.ok) {
      console.warn(`[studio][line] push送信失敗（status=${result.status} ${result.body}）`);
    }
  } catch (err) {
    console.warn("[studio][line] push送信で例外", err);
  }
}
