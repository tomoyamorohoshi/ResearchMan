// tuneup-touched.mjs のテスト: 未コミット差分の検知と「tuneup が実際に変更したファイルだけ add」の受け渡し。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirtyPathsFromPorcelain, writeTouched, readTouched, clearTouched, GUARDED_PATHS } from "./tuneup-touched.mjs";

test("dirtyPathsFromPorcelain: 変更・追加・未追跡・リネームのパスを拾う", () => {
  const text = " M data/case-gate.json\n?? data/litmus-history.json\nA  data/sources.json\nR  old.json -> data/new.json\n";
  assert.deepEqual(dirtyPathsFromPorcelain(text), ["data/case-gate.json", "data/litmus-history.json", "data/sources.json", "data/new.json"]);
  assert.deepEqual(dirtyPathsFromPorcelain(""), []);
  assert.deepEqual(dirtyPathsFromPorcelain(undefined), []);
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
