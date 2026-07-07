// お気に入りサーバ同期API（バッチ1）のスモークテスト。
// 実際のVercel Blob接続は無い前提（BLOB_READ_WRITE_TOKEN未設定のローカル環境）で、
// - 検証（不正id・型・件数上限）が400を返すこと
// - Blob未設定時に503へ自然フォールバックすること（現状=localStorageのみ動作の担保）
// - GET認証（Bearer FAVORITES_SYNC_TOKEN）が401/503を正しく返すこと
// を確認する。実Blobでの200成功パスの検証は、ユーザーがenv設定後に
// OPERATIONS.md記載の手順で別途行う（このスクリプトの対象外）。
//
// 前提: `next dev` を PORT=3111 で起動し、BLOB_READ_WRITE_TOKEN は未設定、
// FAVORITES_SYNC_TOKEN=smoke-test-token を設定した状態で実行すること。
// 実行例:
//   FAVORITES_SYNC_TOKEN=smoke-test-token PORT=3111 npx next dev &
//   npx tsx scripts/smoke-favorites-api.mjs
import { MAX_ITEMS } from "../src/lib/favoritesMerge.ts";

const BASE_URL = process.env.FAVORITES_SMOKE_URL || "http://localhost:3111";
const SYNC_TOKEN = process.env.FAVORITES_SYNC_TOKEN || "smoke-test-token";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

async function postFavorites(body, { rawBody } = {}) {
  return fetch(`${BASE_URL}/api/favorites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody !== undefined ? rawBody : JSON.stringify(body),
  });
}

async function getFavorites(headers = {}) {
  return fetch(`${BASE_URL}/api/favorites`, { headers });
}

async function main() {
  // --- POST: 検証エラー(400) ---
  {
    const res = await postFavorites(undefined, { rawBody: "{not valid json" });
    assert(res.status === 400, `不正なJSONボディは400を返す (got ${res.status})`);
  }
  {
    const res = await postFavorites({ notItems: true });
    assert(res.status === 400, `itemsフィールド欠落は400を返す (got ${res.status})`);
  }
  {
    const res = await postFavorites({ items: { "bad id!": { fav: true, ts: 1 } } });
    assert(res.status === 400, `不正なid形式は400を返す (got ${res.status})`);
  }
  {
    const res = await postFavorites({ items: { "valid-id": { fav: "yes", ts: 1 } } });
    assert(res.status === 400, `favが真偽値でないと400を返す (got ${res.status})`);
  }
  {
    const tooMany = {};
    for (let i = 0; i < MAX_ITEMS + 1; i++) tooMany[`id-${i}`] = { fav: true, ts: 1 };
    const res = await postFavorites({ items: tooMany });
    assert(res.status === 400, `件数上限(${MAX_ITEMS})超は400を返す (got ${res.status})`);
  }

  // --- POST: 検証は通るがBlob未設定 → 503（現状=localStorageのみへの自然フォールバック） ---
  {
    const res = await postFavorites({
      items: { "even-realities-2026": { fav: true, ts: Date.now() } },
    });
    assert(
      res.status === 503,
      `Blob未設定時、妥当なリクエストは503を返す(検証は通過している) (got ${res.status})`
    );
  }

  // --- GET: FAVORITES_SYNC_TOKEN前提の認証 ---
  {
    const res = await getFavorites({ Authorization: `Bearer ${SYNC_TOKEN}` });
    // BLOB_READ_WRITE_TOKENが無い環境なので、認証OKでも最終的には503（Blob未設定）になる。
    // ここでは「401ではない」ことを見て認証自体は通っていることを確認する
    assert(res.status !== 401, `正しいBearerトークンは401にならない (got ${res.status})`);
    assert(res.status === 503, `Blob未設定時はGETも503を返す (got ${res.status})`);
  }
  {
    const res = await getFavorites({ Authorization: "Bearer wrong-token" });
    assert(res.status === 401, `誤ったBearerトークンは401を返す (got ${res.status})`);
  }
  {
    const res = await getFavorites();
    // FAVORITES_SYNC_TOKEN環境変数自体が無い場合は503だが、本テストでは設定済みの前提なので
    // Authorizationヘッダ無し=401として扱われることを確認する
    assert(res.status === 401, `Authorizationヘッダ無しは401を返す (got ${res.status})`);
  }

  if (failures > 0) {
    console.error(`\n${failures} 件失敗`);
    process.exit(1);
  } else {
    console.log("\n全テストPASS: favorites API");
  }
}

main().catch((err) => {
  console.error("smoke-favorites-api failed to run:", err);
  process.exit(1);
});
