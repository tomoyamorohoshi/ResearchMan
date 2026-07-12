/**
 * LINE Messaging API への push送信（scripts/notify-line.mjs の https直叩き実装を踏襲。
 * SDK追加はしない）。
 *
 * 設計判断: reply API は使わない。reply tokenは発行から短時間（LINE仕様上おおむね数十秒）で
 * 失効する単発トークンだが、このwebhookは署名検証後すぐ200を返し、依頼の解釈
 * （Claude呼び出し、最大60秒）やジョブ作成は非同期で行う（webhook.ts参照）。
 * 非同期処理の間にreply tokenが失効する恐れがあるため、確認メッセージ・実行開始通知・
 * エラー通知のすべてを push（channelAccessToken + userId）に統一する。OK/キャンセルの
 * ような即時応答できる操作も、経路をpushに揃えることで分岐を増やさない。
 */
import https from "node:https";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";
// LINEの1メッセージは5,000字上限（安全マージンを取って切り詰める。本機能の返信は
// いずれも短文想定のため、通常はこの分岐に入らない）。
const LINE_MSG_LIMIT = 4800;

export interface PushResult {
  ok: boolean;
  status: number;
  body: string;
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
