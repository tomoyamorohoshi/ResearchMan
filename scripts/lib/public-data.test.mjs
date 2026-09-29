import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPublicDataText, sha256Text, filesNeedingUpload, uploadUrlFromEndpoint } from "./public-data.mjs";

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
