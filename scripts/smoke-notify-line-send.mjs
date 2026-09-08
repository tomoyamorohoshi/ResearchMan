// scripts/lib/notify-line-send.mjs の単体検証（TDD: 実装前にこのテストを書き、失敗を確認してから実装した）。
// LINE通知が「送信OK」とログに出るのに実際には届いていない問題の回帰テスト。
//   1. cfg.to がある場合はpushエンドポイントが選ばれる
//   2. cfg.to が無い場合はbroadcastエンドポイントが選ばれる
//   3. HTTP 200 + 正常ボディ → 成功(ok=true)
//   4. HTTP 200 だがエラーボディ → 失敗(ok=false)として扱われる
//   5. HTTP 4xx（無効な宛先など）→ 失敗(ok=false)として扱われ、ボディが読める
// 実際のHTTPは一切叩かない（純関数のみを検証）。
// 実行: node scripts/smoke-notify-line-send.mjs
import { resolveLineTarget, evaluateLineResult } from "./lib/notify-line-send.mjs";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

// ── 1. cfg.to がある場合はpushエンドポイントが選ばれる ──
{
  const { url, payload } = resolveLineTarget({ to: "Uabc123", channelAccessToken: "x" }, ["hello"]);
  assert(url === "https://api.line.me/v2/bot/message/push", `to指定時はpush URL (${url})`);
  assert(payload.to === "Uabc123", "payload.to が cfg.to と一致");
  assert(Array.isArray(payload.messages) && payload.messages.length === 1, "messagesが1件");
}

// ── 2. cfg.to が無い場合はbroadcastエンドポイントが選ばれる ──
{
  const { url, payload } = resolveLineTarget({ channelAccessToken: "x" }, ["hello"]);
  assert(url === "https://api.line.me/v2/bot/message/broadcast", `to未指定時はbroadcast URL (${url})`);
  assert(!("to" in payload), "payloadにtoキーが無い");
}

// ── 3. HTTP 200 + 正常ボディ（空オブジェクト）→ 成功 ──
{
  const r = evaluateLineResult(200, "{}");
  assert(r.ok === true, `200+正常ボディはok=true (${JSON.stringify(r)})`);
}

// ── 3b. HTTP 200 + 空文字ボディ → 成功扱い ──
{
  const r = evaluateLineResult(200, "");
  assert(r.ok === true, `200+空ボディはok=true (${JSON.stringify(r)})`);
}

// ── 4. HTTP 200 だがエラーボディ（messageフィールドを含む）→ 失敗 ──
{
  const r = evaluateLineResult(200, JSON.stringify({ message: "something went wrong" }));
  assert(r.ok === false, `200+エラーボディはok=false (${JSON.stringify(r)})`);
  assert(typeof r.reason === "string" && r.reason.length > 0, "reasonが埋まる");
}

// ── 5. HTTP 4xx（無効な宛先など）→ 失敗として扱われ、ボディが読める ──
{
  const body = JSON.stringify({
    message: "The request body has 1 error(s)",
    details: [{ message: "May not be empty", property: "to" }],
  });
  const r = evaluateLineResult(400, body);
  assert(r.ok === false, `400はok=false (${JSON.stringify(r)})`);
  assert(r.reason.includes("The request body has 1 error"), `reasonにエラーメッセージが入る (${r.reason})`);
}

// ── 6. ネットワークエラー相当（status=0）→ 失敗 ──
{
  const r = evaluateLineResult(0, "timeout");
  assert(r.ok === false, "status=0はok=false");
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: notify-line-send");
}
