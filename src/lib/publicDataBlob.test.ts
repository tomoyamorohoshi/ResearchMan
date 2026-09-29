import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_DATA_FILES,
  blobPathnameFor,
  isAllowedBlobPathname,
  isAuthorizedBearer,
  blobBaseUrlFromStoreId,
  dataUrlCandidates,
  fetchDataJson,
} from "./publicDataBlob";

test("blobPathnameFor: public-data/ 配下の固定パス", () => {
  assert.equal(blobPathnameFor("idea-layouts.json"), "public-data/idea-layouts.json");
});

test("isAllowedBlobPathname: 許可リストの3ファイルのみtrue", () => {
  for (const f of PUBLIC_DATA_FILES) assert.equal(isAllowedBlobPathname(blobPathnameFor(f)), true);
  assert.equal(isAllowedBlobPathname("favorites/favorites.json"), false);
  assert.equal(isAllowedBlobPathname("public-data/../favorites/favorites.json"), false);
  assert.equal(isAllowedBlobPathname("public-data/other.json"), false);
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

test("blobBaseUrlFromStoreId: store_ 接頭辞を除き小文字化。未設定は空文字", () => {
  assert.equal(blobBaseUrlFromStoreId("store_AbC123"), "https://abc123.public.blob.vercel-storage.com");
  assert.equal(blobBaseUrlFromStoreId("AbC123"), "https://abc123.public.blob.vercel-storage.com");
  assert.equal(blobBaseUrlFromStoreId(undefined), "");
  assert.equal(blobBaseUrlFromStoreId(""), "");
});

test("dataUrlCandidates: Blob設定あり→[Blob, ローカル]、なし→[ローカルのみ]", () => {
  assert.deepEqual(dataUrlCandidates("cases.json", "https://x.public.blob.vercel-storage.com"), [
    "https://x.public.blob.vercel-storage.com/public-data/cases.json",
    "/data/cases.json",
  ]);
  assert.deepEqual(dataUrlCandidates("cases.json", ""), ["/data/cases.json"]);
});

function fakeRes(ok: boolean, body: unknown, status = ok ? 200 : 404) {
  return { ok, status, json: async () => body } as unknown as Response;
}

test("fetchDataJson: 1番目が成功すればそれを返す（2番目は呼ばない）", async () => {
  const calls: string[] = [];
  const data = await fetchDataJson<number[]>("cases.json", "https://b", async (u) => {
    calls.push(u);
    return fakeRes(true, [1]);
  });
  assert.deepEqual(data, [1]);
  assert.equal(calls.length, 1);
});

test("fetchDataJson: Blobが404/例外ならローカルへフォールバック", async () => {
  const calls: string[] = [];
  const data = await fetchDataJson<number[]>("cases.json", "https://b", async (u) => {
    calls.push(u);
    if (u.startsWith("https://b")) return fakeRes(false, null);
    return fakeRes(true, [2]);
  });
  assert.deepEqual(data, [2]);
  assert.equal(calls.length, 2);
  const data2 = await fetchDataJson<number[]>("cases.json", "https://b", async (u) => {
    if (u.startsWith("https://b")) throw new Error("net");
    return fakeRes(true, [3]);
  });
  assert.deepEqual(data2, [3]);
});

test("fetchDataJson: 全候補失敗ならthrow", async () => {
  await assert.rejects(
    fetchDataJson("cases.json", "https://b", async () => fakeRes(false, null)),
    /cases\.json/,
  );
});
