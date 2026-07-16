// アイデアの「ゴミ箱」サーバ同期API（/ideas ページ機能追加）のスモークテスト。
// scripts/smoke-trash-api.mjs と同型: 実際のVercel Blob接続は無い前提
// （BLOB_READ_WRITE_TOKEN未設定のローカル環境）で、
// - 検証（不正id・型・件数上限）が400を返すこと
// - Blob未設定時に503へ自然フォールバックすること（現状=localStorageのみ動作の担保）
// - GET認証（Bearer FAVORITES_SYNC_TOKEN。favorites/trash/idea-likes APIと共用のtoken）が
//   401/503を正しく返すこと
// を確認する。実Blobでの200成功パスの検証は対象外（favorites API同様）。
//
// 前提: `next dev` を PORT=3457 で起動し、BLOB_READ_WRITE_TOKEN は未設定、
// FAVORITES_SYNC_TOKEN=smoke-test-token を設定した状態で実行すること。
// 実行例:
//   FAVORITES_SYNC_TOKEN=smoke-test-token PORT=3457 npx next dev &
//   npx tsx scripts/smoke-idea-trash-api.mjs
import { MAX_ITEMS } from "../src/lib/favoritesMerge.ts";

const BASE_URL = process.env.IDEA_TRASH_SMOKE_URL || "http://localhost:3457";
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

async function postIdeaTrash(body, { rawBody } = {}) {
  return fetch(`${BASE_URL}/api/idea-trash`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody !== undefined ? rawBody : JSON.stringify(body),
  });
}

async function getIdeaTrash(headers = {}) {
  return fetch(`${BASE_URL}/api/idea-trash`, { headers });
}

async function main() {
  // --- POST: 検証エラー(400) ---
  {
    const res = await postIdeaTrash(undefined, { rawBody: "{not valid json" });
    assert(res.status === 400, `不正なJSONボディは400を返す (got ${res.status})`);
  }
  {
    const res = await postIdeaTrash({ notItems: true });
    assert(res.status === 400, `itemsフィールド欠落は400を返す (got ${res.status})`);
  }
  {
    const res = await postIdeaTrash({ items: { "bad id!": { fav: true, ts: 1 } } });
    assert(res.status === 400, `不正なid形式は400を返す (got ${res.status})`);
  }
  {
    const res = await postIdeaTrash({ items: { "valid-id": { fav: "yes", ts: 1 } } });
    assert(res.status === 400, `favが真偽値でないと400を返す (got ${res.status})`);
  }
  {
    const tooMany = {};
    for (let i = 0; i < MAX_ITEMS + 1; i++) tooMany[`id-${i}`] = { fav: true, ts: 1 };
    const res = await postIdeaTrash({ items: tooMany });
    assert(res.status === 400, `件数上限(${MAX_ITEMS})超は400を返す (got ${res.status})`);
  }

  // --- POST: 検証は通るがBlob未設定 → 503（現状=localStorageのみへの自然フォールバック） ---
  {
    const res = await postIdeaTrash({
      items: { "2026-07-08-3": { fav: true, ts: Date.now() } },
    });
    assert(
      res.status === 503,
      `Blob未設定時、妥当なリクエストは503を返す(検証は通過している) (got ${res.status})`
    );
  }

  // --- GET: FAVORITES_SYNC_TOKEN前提の認証（favorites/trash/idea-likesと共用） ---
  {
    const res = await getIdeaTrash({ Authorization: `Bearer ${SYNC_TOKEN}` });
    assert(res.status !== 401, `正しいBearerトークンは401にならない (got ${res.status})`);
    assert(res.status === 503, `Blob未設定時はGETも503を返す (got ${res.status})`);
  }
  {
    const res = await getIdeaTrash({ Authorization: "Bearer wrong-token" });
    assert(res.status === 401, `誤ったBearerトークンは401を返す (got ${res.status})`);
  }
  {
    const res = await getIdeaTrash();
    assert(res.status === 401, `Authorizationヘッダ無しは401を返す (got ${res.status})`);
  }

  if (failures > 0) {
    console.error(`\n${failures} 件失敗`);
    process.exit(1);
  } else {
    console.log("\n全テストPASS: idea-trash API");
  }
}

main().catch((err) => {
  console.error("smoke-idea-trash-api failed to run:", err);
  process.exit(1);
});
