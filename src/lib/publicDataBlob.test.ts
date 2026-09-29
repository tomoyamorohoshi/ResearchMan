import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_DATA_FILES,
  blobPathnameFor,
  isAllowedBlobPathname,
  isAuthorizedBearer,
  isBlobDataEnabled,
  dataUrlCandidates,
  fetchDataJson,
  acceptsBrotliAndGzip,
} from "./publicDataBlob";

test("blobPathnameFor: public-data/ 配下の固定パス（brotli圧縮済みbytesなので .br）", () => {
  assert.equal(blobPathnameFor("idea-layouts.json"), "public-data/idea-layouts.json.br");
});

test("isAllowedBlobPathname: 許可リストの3ファイルのみtrue", () => {
  for (const f of PUBLIC_DATA_FILES) assert.equal(isAllowedBlobPathname(blobPathnameFor(f)), true);
  assert.equal(isAllowedBlobPathname("favorites/favorites.json"), false);
  assert.equal(isAllowedBlobPathname("public-data/../favorites/favorites.json"), false);
  assert.equal(isAllowedBlobPathname("public-data/other.json"), false);
  assert.equal(isAllowedBlobPathname("public-data/cases.json"), false); // 旧・非圧縮パスは許可しない
  assert.equal(isAllowedBlobPathname(""), false);
});

test("isAuthorizedBearer: 一致のみtrue・トークン未設定は常にfalse", () => {
  assert.equal(isAuthorizedBearer("Bearer abc", "abc"), true);
  assert.equal(isAuthorizedBearer("Bearer abd", "abc"), false);
  assert.equal(isAuthorizedBearer("", "abc"), false);
  assert.equal(isAuthorizedBearer(null, "abc"), false);
  assert.equal(isAuthorizedBearer("Bearer ", ""), false);
  assert.equal(isAuthorizedBearer("Bearer undefined", undefined), false);
});

test("isBlobDataEnabled: BLOB_STORE_IDがあればtrue（ビルド時にNEXT_PUBLIC_DATA_FROM_BLOBへ）", () => {
  assert.equal(isBlobDataEnabled("store_AbC123"), true);
  assert.equal(isBlobDataEnabled(undefined), false);
  assert.equal(isBlobDataEnabled("  "), false);
});

test("dataUrlCandidates: Blob有効→[プロキシAPI, ローカル]、無効→[ローカルのみ]", () => {
  assert.deepEqual(dataUrlCandidates("cases.json", true), ["/api/public-data/cases.json", "/data/cases.json"]);
  assert.deepEqual(dataUrlCandidates("cases.json", false), ["/data/cases.json"]);
});

function fakeRes(ok: boolean, body: unknown, status = ok ? 200 : 404) {
  return { ok, status, json: async () => body } as unknown as Response;
}

test("fetchDataJson: 1番目が成功すればそれを返す（2番目は呼ばない）", async () => {
  const calls: string[] = [];
  const data = await fetchDataJson<number[]>("cases.json", true, async (u) => {
    calls.push(u);
    return fakeRes(true, [1]);
  });
  assert.deepEqual(data, [1]);
  assert.equal(calls.length, 1);
});

test("fetchDataJson: Blobが404/例外ならローカルへフォールバック", async () => {
  const calls: string[] = [];
  const data = await fetchDataJson<number[]>("cases.json", true, async (u) => {
    calls.push(u);
    if (u.startsWith("/api/")) return fakeRes(false, null);
    return fakeRes(true, [2]);
  });
  assert.deepEqual(data, [2]);
  assert.equal(calls.length, 2);
  const data2 = await fetchDataJson<number[]>("cases.json", true, async (u) => {
    if (u.startsWith("/api/")) throw new Error("net");
    return fakeRes(true, [3]);
  });
  assert.deepEqual(data2, [3]);
});

test("fetchDataJson: 全候補失敗ならthrow", async () => {
  await assert.rejects(
    fetchDataJson("cases.json", true, async () => fakeRes(false, null)),
    /cases\.json/,
  );
});

test("acceptsBrotliAndGzip: ブラウザ標準(gzip,br併記)のみtrue。br単独・identity・gzipのみは不可", () => {
  // 実測: Vercel CDNは gzip を含まない Accept-Encoding(br単独/zstd,br)だとbr事前圧縮を素通しせず
  // 約20MBへ再圧縮＋CDN MISSになる。実ブラウザは常にgzipも併記するため、併記を要求して防ぐ
  assert.equal(acceptsBrotliAndGzip("gzip, deflate, br, zstd"), true);
  assert.equal(acceptsBrotliAndGzip("br, gzip;q=0.8"), true);
  assert.equal(acceptsBrotliAndGzip("br"), false);
  assert.equal(acceptsBrotliAndGzip("zstd, br"), false);
  assert.equal(acceptsBrotliAndGzip("gzip"), false);
  assert.equal(acceptsBrotliAndGzip("identity"), false);
  assert.equal(acceptsBrotliAndGzip(""), false);
  assert.equal(acceptsBrotliAndGzip(null), false);
  assert.equal(acceptsBrotliAndGzip("br;q=0, gzip"), false);
});
