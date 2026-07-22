// LINE Messaging API への実送信ロジック（notify-line.mjs から切り出し。
// notify-digest.mjs（logs/notify-queue.jsonl のダイジェスト送信）とも共有する）。
// 挙動不変: 4,800字上限・空行境界での分割・最大5メッセージ・push/broadcast判定・15秒timeout。
import https from "https";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const BROADCAST_URL = "https://api.line.me/v2/bot/message/broadcast";

// LINE の1メッセージは5,000字上限・1リクエストで最大5メッセージ。
// ref付きアイデアの種は数千字になりうるため、空行（種の境界）で分割する。
export const LINE_MSG_LIMIT = 4800;
export const LINE_MAX_MESSAGES = 5;

export function splitForLine(text) {
  if (text.length <= LINE_MSG_LIMIT) return [text];
  // 空行区切りブロック（見出し＋各種）を、上限内で貪欲に結合する
  const blocks = text.split(/\n\n+/);
  const messages = [];
  let cur = "";
  for (const b of blocks) {
    const piece = cur ? `${cur}\n\n${b}` : b;
    if (piece.length > LINE_MSG_LIMIT && cur) {
      messages.push(cur);
      cur = b;
    } else {
      cur = piece;
    }
  }
  if (cur) messages.push(cur);
  // 最大5メッセージに収める（超過分は末尾メッセージへ結合。上限超過は稀）
  if (messages.length > LINE_MAX_MESSAGES) {
    const head = messages.slice(0, LINE_MAX_MESSAGES - 1);
    const tail = messages.slice(LINE_MAX_MESSAGES - 1).join("\n\n").slice(0, LINE_MSG_LIMIT);
    return [...head, tail];
  }
  return messages;
}

export function sendLineMessages(cfg, text) {
  // to があれば push（特定userId宛）、無ければ broadcast（全友だち宛）
  const url = cfg.to ? PUSH_URL : BROADCAST_URL;
  const texts = splitForLine(text);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (settled) return; settled = true; resolve(v); };
    const messages = texts.map((t) => ({ type: "text", text: t }));
    const payload = cfg.to ? { to: cfg.to, messages } : { messages };
    const body = JSON.stringify(payload);
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${cfg.channelAccessToken}`,
        },
      },
      (res) => {
        const chunks = [];
        const finish = () => settle({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
        res.on("data", (d) => chunks.push(d));
        res.on("end", finish);
        // 本文受信中に接続が切れてもPromiseを必ず解決する（未解決awaitでプロセスが静かに死ぬのを防ぐ）
        res.on("close", finish);
        res.on("error", finish);
      }
    );
    req.on("error", (e) => settle({ status: 0, body: e.message }));
    req.setTimeout(15000, () => { settle({ status: 0, body: "timeout" }); req.destroy(); });
    req.write(body);
    req.end();
  });
}
