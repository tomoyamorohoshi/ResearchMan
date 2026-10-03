// Exhibition intake API のスモークテスト（scripts/smoke-favorites-api.mjs と同型）。
// 前提: `next dev` を PORT=3111 で起動し、次の env を渡す。
//   EXHIBITION_INTAKE_TOKEN=smoke-intake-token FAVORITES_SYNC_TOKEN=smoke-test-token
//
// 1) Blob 未設定（BLOB_READ_WRITE_TOKEN / BLOB_STORE_ID 無し）で確認できる範囲（常に実行）:
//    認証(401)・検証(400)・honeypot(200 非保存)・Blob 未設定(503) の順序。
// 2) 実 Blob がある場合のみ（EXHIBITION_SMOKE_BLOB=1。専用テストストアで実行すること。
//    キューにテスト URL が入り、最後に rejected で処理済み化する）:
//    accepted / duplicate / GET / PATCH / already_processed / 429。
// 実行例:
//   EXHIBITION_INTAKE_TOKEN=smoke-intake-token FAVORITES_SYNC_TOKEN=smoke-test-token PORT=3111 npx next dev &
//   node scripts/smoke-exhibition-intake-api.mjs
const BASE_URL = process.env.EXHIBITION_SMOKE_URL || "http://localhost:3111";
const INTAKE_TOKEN = process.env.EXHIBITION_INTAKE_TOKEN || "smoke-intake-token";
const SYNC_TOKEN = process.env.FAVORITES_SYNC_TOKEN || "smoke-test-token";
const WITH_BLOB = process.env.EXHIBITION_SMOKE_BLOB === "1";
const ENDPOINT = `${BASE_URL}/api/exhibition-intake`;

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

async function post(body, { token = INTAKE_TOKEN, rawBody } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token !== null) headers["x-intake-token"] = token;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: rawBody !== undefined ? rawBody : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // 本文なし
  }
  return { status: res.status, json };
}

async function authed(method, body, auth = `Bearer ${SYNC_TOKEN}`) {
  const headers = { "Content-Type": "application/json" };
  if (auth !== null) headers.Authorization = auth;
  const res = await fetch(ENDPOINT, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // 本文なし
  }
  return { status: res.status, json };
}

const GOOD = "https://x.com/ayupys/status/2105985301751693583";

async function main() {
  // --- POST: 認証(401)。検証より先 ---
  assert((await post({ url: GOOD }, { token: null })).status === 401, "トークン無しは401");
  assert((await post({ url: GOOD }, { token: "wrong" })).status === 401, "誤トークンは401");
  assert((await post(undefined, { token: "wrong", rawBody: "{bad" })).status === 401, "認証は検証より先(不正JSON+誤トークンは401)");

  // --- POST: 検証(400) ---
  assert((await post(undefined, { rawBody: "{not json" })).status === 400, "不正JSONは400");
  assert((await post({})).status === 400, "url欠落は400");
  {
    const r = await post({ url: "https://example.com/a/status/1" });
    assert(r.status === 400 && r.json?.error === "invalid_url", "不許可ホストは400 invalid_url");
  }
  assert((await post({ url: "http://x.com/a/status/1" })).status === 400, "httpは400");
  assert((await post({ url: "https://x.com/a/status/abc" })).status === 400, "statusが数字でないと400");
  assert((await post({ url: "https://user@x.com/a/status/1" })).status === 400, "userinfo付きは400");
  assert((await post({ url: "https://x.com:444/a/status/1" })).status === 400, "ポート指定は400");
  assert((await post({ url: "https://x.com/a/status/" + "1".repeat(300) })).status === 400, "300字超は400");

  // --- honeypot: 検証済みなら Blob 未設定でも 200（保存しない） ---
  {
    const r = await post({ url: GOOD, website: "http://spam.example" });
    assert(r.status === 200 && r.json?.status === "accepted", "honeypot非空は200 accepted（保存しない）");
  }

  if (!WITH_BLOB) {
    // --- Blob 未設定 → 503（検証・認証・honeypot が 503 より先） ---
    assert((await post({ url: GOOD })).status === 503, "Blob未設定で妥当なPOSTは503");

    // --- GET / PATCH 認証 ---
    assert((await authed("GET", undefined, null)).status === 401, "GET: Authorization無しは401");
    assert((await authed("GET", undefined, "Bearer wrong")).status === 401, "GET: 誤Bearerは401");
    assert((await authed("GET")).status === 503, "GET: 認証OK・Blob未設定は503");
    assert((await authed("PATCH", { results: [] }, null)).status === 401, "PATCH: Authorization無しは401");
    assert((await authed("PATCH", { results: [] }, "Bearer wrong")).status === 401, "PATCH: 誤Bearerは401");
    assert((await authed("PATCH", { nope: 1 })).status === 400, "PATCH: results欠落は400");
    assert((await authed("PATCH", { results: [] })).status === 503, "PATCH: 認証OK・Blob未設定は503");
    // INTAKE_TOKEN で GET は通らない（別系統のトークン）
    assert((await authed("GET", undefined, `Bearer ${INTAKE_TOKEN}`)).status === 401, "GET: intakeトークンでは401");
  } else {
    // --- 実 Blob あり ---
    const unique = `https://x.com/smoke_${Date.now() % 1000000}/status/${Date.now()}`;
    let r = await post({ url: unique + "?s=20" });
    assert(r.status === 200 && r.json?.status === "accepted", "受付: accepted");
    r = await post({ url: unique });
    assert(r.status === 200 && r.json?.status === "duplicate", "同一URL(正規化後)は duplicate");

    let g = await authed("GET");
    assert(g.status === 200 && g.json.items.some((i) => i.url === unique && i.attempts === 0), "GET: pendingに含まれる");

    let p = await authed("PATCH", { results: [{ url: unique, status: "retry" }] });
    assert(p.status === 200 && p.json.updated === 1, "PATCH retry: updated=1");
    g = await authed("GET");
    assert(g.json.items.find((i) => i.url === unique)?.attempts === 1, "retry後 attempts=1 でpendingのまま");

    p = await authed("PATCH", { results: [{ url: unique, status: "added", exhibitionId: "2026-smoke-test" }] });
    assert(p.status === 200 && p.json.updated === 1, "PATCH added: updated=1");
    g = await authed("GET");
    assert(!g.json.items.some((i) => i.url === unique), "処理済みはGETに出ない");

    r = await post({ url: unique });
    assert(r.status === 200 && r.json?.status === "already_processed", "処理済みの再投稿は already_processed");

    p = await authed("PATCH", { results: [{ url: "https://x.com/nobody/status/1", status: "added" }] });
    assert(p.status === 200 && p.json.updated === 0, "未知URLは無視 updated=0");

    // 429: 当日30件上限（または pending 50）に達するまで投稿
    let got429 = false;
    const posted = [];
    for (let i = 0; i < 60 && !got429; i++) {
      const u = `https://x.com/smoke_rl/status/${Date.now()}${i}`;
      const rr = await post({ url: u });
      if (rr.status === 429) got429 = true;
      else if (rr.status === 200 && rr.json?.status === "accepted") posted.push(u);
    }
    assert(got429, "上限超過で429");
    if (posted.length > 0) {
      await authed("PATCH", { results: posted.map((u) => ({ url: u, status: "rejected", reason: "smoke cleanup" })) });
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} 件失敗`);
    process.exit(1);
  }
  console.log(`\n全テストPASS: exhibition intake API${WITH_BLOB ? " (Blobあり)" : " (Blob未設定の範囲)"}`);
}

main().catch((err) => {
  console.error("smoke-exhibition-intake-api failed to run:", err);
  process.exit(1);
});
