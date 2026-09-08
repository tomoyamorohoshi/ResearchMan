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

// URL・payloadの組み立てのみを行う純関数（実HTTPは呼ばない）。テストで push/broadcast の
// 振り分けを検証するために sendLineMessages 本体から切り出した。
export function resolveLineTarget(cfg, texts) {
  const url = cfg.to ? PUSH_URL : BROADCAST_URL;
  const messages = texts.map((t) => ({ type: "text", text: t }));
  const payload = cfg.to ? { to: cfg.to, messages } : { messages };
  return { url, payload };
}

// HTTPステータス・ボディから「実際に配信を試みられたか」を判定する純関数。
// 重要な注意（LINE公式ドキュメント/コミュニティ確認済み。詳細はレポート参照）:
//   宛先ユーザーが公式アカウントをブロックしている場合でも push は HTTP 200 を返す
//   （LINEプラットフォームがリクエストを「受理」したことしか意味しない）。
//   そのためこの関数のok=trueは「配信されたことの証明」ではなく「LINE側にリクエストが
//   正常受理されたこと」の証明にとどまる。4xx/5xxおよび200なのに異常なボディ
//   （エラー形式 {message, details} が混入している等）だけを確実にok=falseとして弾く。
export function evaluateLineResult(status, body) {
  if (status !== 200) {
    let reason = body || `status ${status}`;
    try {
      const parsed = body ? JSON.parse(body) : null;
      if (parsed && typeof parsed.message === "string") reason = parsed.message;
    } catch {
      // ボディがJSONでなければ生の文字列をそのままreasonにする
    }
    return { ok: false, reason };
  }
  // status === 200: ボディが空/{}なら正常。message フィールドを含むボディは
  // 念のため異常系として扱う（LINE実装上は200での通常成功ボディにmessageは乗らない想定だが、
  // 仕様変更・想定外レスポンスへの防御として弾く）。非JSONボディも異常として扱う。
  const trimmed = (body || "").trim();
  if (!trimmed) return { ok: true, reason: null };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && typeof parsed.message === "string") {
      return { ok: false, reason: parsed.message };
    }
    return { ok: true, reason: null };
  } catch {
    return { ok: false, reason: `200だが非JSONボディ: ${trimmed.slice(0, 200)}` };
  }
}

export function sendLineMessages(cfg, text) {
  // to があれば push（特定userId宛）、無ければ broadcast（全友だち宛）
  const texts = splitForLine(text);
  const { url, payload } = resolveLineTarget(cfg, texts);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (settled) return; settled = true; resolve(v); };
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
        const finish = () => {
          const status = res.statusCode;
          const bodyStr = Buffer.concat(chunks).toString();
          const { ok, reason } = evaluateLineResult(status, bodyStr);
          const requestId = res.headers && res.headers["x-line-request-id"] ? res.headers["x-line-request-id"] : null;
          settle({ status, body: bodyStr, ok, reason, requestId });
        };
        res.on("data", (d) => chunks.push(d));
        res.on("end", finish);
        // 本文受信中に接続が切れてもPromiseを必ず解決する（未解決awaitでプロセスが静かに死ぬのを防ぐ）
        res.on("close", finish);
        res.on("error", finish);
      }
    );
    req.on("error", (e) => settle({ status: 0, body: e.message, ok: false, reason: e.message, requestId: null }));
    req.setTimeout(15000, () => {
      settle({ status: 0, body: "timeout", ok: false, reason: "timeout", requestId: null });
      req.destroy();
    });
    req.write(body);
    req.end();
  });
}
