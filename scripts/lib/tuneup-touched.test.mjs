// tuneup-touched.mjs のテスト: 未コミット差分の検知と「tuneup が実際に変更したファイルだけ add」の受け渡し。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirtyPathsFromPorcelain, writeTouched, readTouched, clearTouched, GUARDED_PATHS, buildSkipAlert } from "./tuneup-touched.mjs";

test("dirtyPathsFromPorcelain: 変更・追加・未追跡・リネームのパスを拾う", () => {
  const text = " M data/case-gate.json\n?? data/litmus-history.json\nA  data/sources.json\nR  old.json -> data/new.json\n";
  assert.deepEqual(dirtyPathsFromPorcelain(text), ["data/case-gate.json", "data/litmus-history.json", "data/sources.json", "data/new.json"]);
  assert.deepEqual(dirtyPathsFromPorcelain(""), []);
  assert.deepEqual(dirtyPathsFromPorcelain(undefined), []);
});

test("buildSkipAlert: 未コミットの対象ファイル名と手での対処を含む warn。差分なしなら null", () => {
  assert.equal(buildSkipAlert([]), null);
  assert.equal(buildSkipAlert(["package.json"]), null);
  const a = buildSkipAlert(["data/case-gate.json", "data/sources.json"]);
  assert.equal(a.level, "warn");
  assert.equal(a.source, "tuneup");
  assert.match(a.body, /data\/case-gate\.json/);
  assert.match(a.body, /data\/sources\.json/);
  assert.match(a.body, /コミット/);
  assert.match(a.body, /破棄/);
});

test("週次見直し本体: writeTouched は verifySteps より前、clearTouched は DRY_RUN で呼ばない、スキップ時に appendSystemAlert", async () => {
  const fs2 = await import("node:fs");
  const src = fs2.readFileSync(new URL("../biweekly-tuneup.mjs", import.meta.url), "utf-8");
  assert.ok(src.indexOf("writeTouched(touchedRel)") > 0);
  assert.ok(src.indexOf("writeTouched(touchedRel)") < src.indexOf("verifySteps:"), "writeTouched は検証より前");
  assert.match(src, /if \(!DRY_RUN\) clearTouched\(\)/);
  assert.match(src, /appendSystemAlert\(/);
});

test("GUARDED_PATHS は case-gate / sources / litmus-history", () => {
  assert.deepEqual([...GUARDED_PATHS].sort(), ["data/case-gate.json", "data/litmus-history.json", "data/sources.json"]);
});

test("writeTouched / readTouched / clearTouched: ガード対象外のパスは無視、ファイル無しは空", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "touched-")), "t.json");
  assert.deepEqual(readTouched(f), []);
  writeTouched(["data/case-gate.json", "../evil", "package.json"], f);
  assert.deepEqual(readTouched(f), ["data/case-gate.json"]);
  clearTouched(f);
  assert.deepEqual(readTouched(f), []);
  fs.writeFileSync(f, "not json");
  assert.deepEqual(readTouched(f), []);
});
