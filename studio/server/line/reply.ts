/**
 * LINE Messaging API への reply送信（push.ts と同型のhttps直叩き実装）。
 *
 * 設計判断（2026-07-24改訂。旧: push.ts参照の「reply APIは使わない」設計から変更）:
 * webhookイベントの replyToken を使う reply API は無料枠（push 200通/月）を消費しない。
 * replyTokenは受信から短時間・1回限り有効な単発トークンで、失効（期限切れ・使用済み等の
 * 400系エラー）や通信エラーが起こり得るため、失敗時は push.ts::pushLineMessage への
 * フォールバックで応答を保証する。webhook.ts の即時応答（ウィザードの質問・確認・
 * 実行開始・エラー等）はこの reply優先・push フォールバックを使う。ジョブ完了等の
 * 事後通知（replyTokenが失効済み）は引き続き push.ts::pushLineMessage を直接使う。
 */
import https from "node:https";
import { pushLineMessage } from "./push.js";

const REPLY_URL = "https://api.line.me/v2/bot/message/reply";
// push.ts と同じ安全マージン（本機能の返信はいずれも短文想定）。
const LINE_MSG_LIMIT = 4800;

export interface ReplyResult {
  ok: boolean;
  status: number;
  body: string;
}

function requestReply(channelAccessToken: string, replyToken: string, text: string): Promise<ReplyResult> {
  const body = JSON.stringify({ replyToken, messages: [{ type: "text", text: text.slice(0, LINE_MSG_LIMIT) }] });
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: ReplyResult): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const req = https.request(
      REPLY_URL,
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

export interface ReplyOrPushDeps {
  reply: (channelAccessToken: string, replyToken: string, text: string) => Promise<ReplyResult>;
  push: (channelAccessToken: string, userId: string, text: string) => Promise<void>;
}

const defaultReplyOrPushDeps: ReplyOrPushDeps = { reply: requestReply, push: pushLineMessage };

/**
 * reply優先・失敗時push フォールバックの統合送信関数。webhook.ts の即時応答はこれを使う。
 * replyTokenが無ければreplyを試さず最初からpushする（follow/beacon等、将来text以外の
 * イベントを扱うことになった場合の保険）。
 */
export async function replyOrPushLineMessage(
  channelAccessToken: string,
  replyToken: string | undefined,
  userId: string,
  text: string,
  deps: ReplyOrPushDeps = defaultReplyOrPushDeps,
): Promise<void> {
  if (replyToken) {
    try {
      const result = await deps.reply(channelAccessToken, replyToken, text);
      if (result.ok) return;
      console.warn(`[studio][line] reply送信失敗のためpushへフォールバック（status=${result.status} ${result.body}）`);
    } catch (err) {
      console.warn("[studio][line] reply送信で例外のためpushへフォールバック", err);
    }
  }
  await deps.push(channelAccessToken, userId, text);
}
