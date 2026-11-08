// thumbnail-page-check.mjs の Case Study(cases.json起点)検査の単体テスト。
// 2026-07-19以降トップHTMLにimgが無くなり、HTML起点の検査が毎回誤報していた再発防止。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { caseThumbnailSrcs, checkThumbnailSrcs, checkCaseThumbnails } from "./thumbnail-page-check.mjs";

const SITE = "https://example.test";

test("caseThumbnailSrcs: quarantined と thumbnail 無しを除き、配列順(新着順)を保つ", () => {
  const cases = [
    { id: "a", thumbnail: "/thumbnails/a.jpg" },
    { id: "b", thumbnail: "/thumbnails/b.jpg", quarantined: true },
    { id: "c", thumbnail: "" },
    { id: "d", thumbnail: "https://cdn.test/d.jpg" },
  ];
  assert.deepEqual(caseThumbnailSrcs(cases), ["/thumbnails/a.jpg", "https://cdn.test/d.jpg"]);
});

test("checkThumbnailSrcs: 先頭2件+ランダムでsampleCount件、相対はorigin前置で検証", async () => {
  const srcs = Array.from({ length: 10 }, (_, i) => `/thumbnails/${i}.jpg`);
  srcs.push("https://cdn.test/x.jpg");
  const seen = [];
  const fails = await checkThumbnailSrcs(srcs, SITE, {
    sampleCount: 4,
    checkUrl: async (u) => { seen.push(u); return { ok: true, status: 200, contentType: "image/jpeg" }; },
  });
  assert.deepEqual(fails, []);
  assert.equal(seen.length, 4);
  assert.equal(seen[0], `${SITE}/thumbnails/0.jpg`);
  assert.equal(seen[1], `${SITE}/thumbnails/1.jpg`);
});

test("checkThumbnailSrcs: 絶対URLはそのまま検証", async () => {
  const seen = [];
  await checkThumbnailSrcs(["https://cdn.test/x.jpg"], SITE, {
    checkUrl: async (u) => { seen.push(u); return { ok: true }; },
  });
  assert.deepEqual(seen, ["https://cdn.test/x.jpg"]);
});

test("checkThumbnailSrcs: 失敗を src/resolvedUrl/status 付きで返す", async () => {
  const fails = await checkThumbnailSrcs(["/thumbnails/a.jpg"], SITE, {
    checkUrl: async () => ({ ok: false, status: 404, contentType: "text/html" }),
  });
  assert.equal(fails.length, 1);
  assert.equal(fails[0].src, "/thumbnails/a.jpg");
  assert.equal(fails[0].resolvedUrl, `${SITE}/thumbnails/a.jpg`);
  assert.equal(fails[0].status, 404);
});

test("checkThumbnailSrcs: srcが空なら『対象なし』失敗を返す", async () => {
  const fails = await checkThumbnailSrcs([], SITE, { checkUrl: async () => ({ ok: true }) });
  assert.equal(fails.length, 1);
  assert.match(fails[0].reason, /対象/);
});

test("checkCaseThumbnails: cases.json 読み込み失敗は専用メッセージ", async () => {
  const fails = await checkCaseThumbnails("/no/such/cases.json", SITE, { checkUrl: async () => ({ ok: true }) });
  assert.equal(fails.length, 1);
  assert.match(fails[0].reason, /cases\.json 読み込み失敗/);
});

test("checkCaseThumbnails: ファイルから読み、quarantinedは検査しない", async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cases-")), "cases.json");
  fs.writeFileSync(f, JSON.stringify([
    { id: "q", thumbnail: "/thumbnails/q.jpg", quarantined: true },
    { id: "a", thumbnail: "/thumbnails/a.jpg" },
  ]));
  const seen = [];
  const fails = await checkCaseThumbnails(f, SITE, { checkUrl: async (u) => { seen.push(u); return { ok: true }; } });
  assert.deepEqual(fails, []);
  assert.deepEqual(seen, [`${SITE}/thumbnails/a.jpg`]);
});
