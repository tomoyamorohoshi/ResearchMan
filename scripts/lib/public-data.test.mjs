import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPublicDataText, sha256Text, filesNeedingUpload, uploadUrlFromEndpoint, buildBlobStaleReport, blobStaleReasonKey, withTimeout, shouldSkipBlobStaleCheck } from "./public-data.mjs";

test("buildPublicDataText: cases.jsonはquarantined===trueを除外、他はそのまま", () => {
  const raw = { cases: JSON.stringify([{ id: "a" }, { id: "b", quarantined: true }]), ideas: "[1]", layouts: '{"x":1}' };
  assert.deepEqual(JSON.parse(buildPublicDataText("cases.json", raw.cases)), [{ id: "a" }]);
  assert.equal(buildPublicDataText("ideas.json", raw.ideas), "[1]");
  assert.equal(buildPublicDataText("idea-layouts.json", raw.layouts), '{"x":1}');
  assert.throws(() => buildPublicDataText("other.json", "{}"), /other\.json/);
});

test("sha256Text: 決定的で内容依存", () => {
  assert.equal(sha256Text("a"), sha256Text("a"));
  assert.notEqual(sha256Text("a"), sha256Text("b"));
});

test("filesNeedingUpload: 前回成功ハッシュと異なる/未記録のものだけ返す。forceは全件", () => {
  const hashes = { "cases.json": "h1", "ideas.json": "h2", "idea-layouts.json": "h3" };
  assert.deepEqual(filesNeedingUpload(hashes, { "cases.json": "h1", "ideas.json": "old" }), ["ideas.json", "idea-layouts.json"]);
  assert.deepEqual(filesNeedingUpload(hashes, hashes), []);
  assert.deepEqual(filesNeedingUpload(hashes, hashes, { force: true }), ["cases.json", "ideas.json", "idea-layouts.json"]);
});

test("uploadUrlFromEndpoint: favsyncのendpointと同一オリジンの /api/data-upload", () => {
  assert.equal(uploadUrlFromEndpoint("https://research-man.vercel.app/api/favorites"), "https://research-man.vercel.app/api/data-upload");
  assert.throws(() => uploadUrlFromEndpoint("not a url"));
});

test("buildBlobStaleReport: 古いファイル名と復旧コマンドを含む", () => {
  const t = buildBlobStaleReport(["idea-layouts.json"]);
  assert.match(t, /idea-layouts\.json/);
  assert.match(t, /upload-public-data\.mjs --force/);
});

test("blobStaleReasonKey: 同じ集合なら同じキー（重複通知抑制用）、順序非依存", () => {
  assert.equal(blobStaleReasonKey(["b", "a"]), blobStaleReasonKey(["a", "b"]));
  assert.notEqual(blobStaleReasonKey(["a"]), blobStaleReasonKey(["a", "b"]));
});

test("withTimeout: 期限内なら結果を返し、超過ならrejectする（SDKがabortSignalを署名取得fetchへ渡さないための保険）", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 1000, "x"), 7);
  await assert.rejects(withTimeout(new Promise(() => {}), 30, "upload cases.json"), /upload cases\.json.*timeout/i);
  await assert.rejects(withTimeout(Promise.reject(new Error("boom")), 1000, "x"), /boom/);
});

test("shouldSkipBlobStaleCheck: gitロックが存在する間（ジョブがdata更新〜Blob同期の最中）はスキップ", () => {
  assert.equal(shouldSkipBlobStaleCheck("/tmp/lock", () => true), true);
  assert.equal(shouldSkipBlobStaleCheck("/tmp/lock", () => false), false);
  assert.equal(shouldSkipBlobStaleCheck("/tmp/lock", () => { throw new Error("EPERM"); }), false);
});
