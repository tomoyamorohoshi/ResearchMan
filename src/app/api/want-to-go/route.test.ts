// want-to-go APIが favorites と同じ認証・同じマージ設定（syncRouteHandlers 経由）であることの検証。
// Blob・ネットワークには触れない（Blob未設定のまま、検証→認証の順序で返るレスポンスだけを見る）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import * as favoritesRoute from "../favorites/route";
import * as wantRoute from "./route";
import { WANT_TO_GO_BLOB_PATHNAME, FAVORITES_BLOB_PATHNAME } from "@/lib/favoritesStore";

const TOKEN = "test-token";

function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved = {
    t: process.env.FAVORITES_SYNC_TOKEN,
    b: process.env.BLOB_READ_WRITE_TOKEN,
    s: process.env.BLOB_STORE_ID,
  };
  process.env.FAVORITES_SYNC_TOKEN = TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  return fn().finally(() => {
    for (const [k, v] of [
      ["FAVORITES_SYNC_TOKEN", saved.t],
      ["BLOB_READ_WRITE_TOKEN", saved.b],
      ["BLOB_STORE_ID", saved.s],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

function post(body: string) {
  return new NextRequest("http://localhost/api/x", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
}
function get(auth?: string) {
  return new NextRequest("http://localhost/api/x", {
    headers: auth ? { authorization: auth } : {},
  });
}
async function snap(res: Response) {
  return { status: res.status, body: await res.json() };
}

test("want-to-go route は GET/POST/dynamic を公開する", () => {
  assert.equal(typeof wantRoute.GET, "function");
  assert.equal(typeof wantRoute.POST, "function");
  assert.equal(wantRoute.dynamic, "force-dynamic");
});

test("POST: 不正JSON・不正items は favorites と同じ 400", async () => {
  await withEnv(async () => {
    for (const raw of ["{not json", JSON.stringify({ items: { a: { fav: "x", ts: 1 } } }), JSON.stringify({})]) {
      const a = await snap(await favoritesRoute.POST(post(raw)));
      const b = await snap(await wantRoute.POST(post(raw)));
      assert.equal(b.status, 400);
      assert.deepEqual(b, a);
    }
  });
});

test("POST: 正常入力でBlob未設定なら 503（文言のみ want-to-go 固有）", async () => {
  await withEnv(async () => {
    const raw = JSON.stringify({ items: { x: { fav: true, ts: Date.now() } } });
    const a = await snap(await favoritesRoute.POST(post(raw)));
    const b = await snap(await wantRoute.POST(post(raw)));
    assert.equal(a.status, 503);
    assert.equal(b.status, 503);
    assert.equal(b.body.error, "want-to-go sync not configured");
  });
});

test("GET: 認証なし・不一致トークンは favorites と同じ 401、トークン未設定は 503", async () => {
  await withEnv(async () => {
    for (const auth of [undefined, "Bearer wrong", TOKEN]) {
      const a = await snap(await favoritesRoute.GET(get(auth)));
      const b = await snap(await wantRoute.GET(get(auth)));
      assert.equal(b.status, 401);
      assert.deepEqual(b, a);
    }
    // 正しいトークンでもBlob未設定なら 503（認証は通過している）
    const ok = await snap(await wantRoute.GET(get(`Bearer ${TOKEN}`)));
    assert.equal(ok.status, 503);
    delete process.env.FAVORITES_SYNC_TOKEN;
    assert.equal((await wantRoute.GET(get(`Bearer ${TOKEN}`))).status, 503);
  });
});

test("ストアのパスだけが違い、ルートは同じ createSyncRouteHandlers を使う", () => {
  assert.equal(WANT_TO_GO_BLOB_PATHNAME, "want-to-go/want-to-go.json");
  assert.notEqual(WANT_TO_GO_BLOB_PATHNAME, FAVORITES_BLOB_PATHNAME);
  const strip = (s: string) => s.replace(/\/\/.*$/gm, "");
  const fav = strip(readFileSync(new URL("../favorites/route.ts", import.meta.url), "utf8"));
  const want = strip(readFileSync(new URL("./route.ts", import.meta.url), "utf8"));
  for (const src of [fav, want]) {
    assert.match(src, /createSyncRouteHandlers/);
    assert.match(src, /from "@\/lib\/syncRouteHandlers"/);
  }
  assert.match(want, /readWantToGoBlob/);
  assert.match(want, /writeWantToGoBlob/);
  // 関数名・文言・ラベル以外（= オプションの形）が一致すること
  const norm = (s: string) =>
    s
      .replace(/Favorites|WantToGo/g, "X")
      .replace(/"[^"]*"/g, '"S"')
      .replace(/\s+/g, " ");
  assert.equal(norm(want), norm(fav));
});
