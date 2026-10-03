import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decideLocalBodyCheck, readLocalLayoutsInputHash } from "./idea-layouts-local.mjs";

const M = "abc123";

test("decideLocalBodyCheck: changed x body present/missing/mismatched", () => {
  assert.equal(decideLocalBodyCheck({ changed: true, bodyHash: M, manifestHash: M }), "ok");
  assert.equal(decideLocalBodyCheck({ changed: true, bodyHash: null, manifestHash: M }), "fail");
  assert.equal(decideLocalBodyCheck({ changed: true, bodyHash: "zzz", manifestHash: M }), "fail");
});

test("decideLocalBodyCheck: unchanged x body present/missing/mismatched", () => {
  assert.equal(decideLocalBodyCheck({ changed: false, bodyHash: M, manifestHash: M }), "ok");
  assert.equal(decideLocalBodyCheck({ changed: false, bodyHash: null, manifestHash: M }), "warn");
  assert.equal(decideLocalBodyCheck({ changed: false, bodyHash: "zzz", manifestHash: M }), "warn");
});

test("decideLocalBodyCheck: undefined bodyHash is treated as missing", () => {
  assert.equal(decideLocalBodyCheck({ changed: true, bodyHash: undefined, manifestHash: undefined }), "fail");
});

test("readLocalLayoutsInputHash: reads head of file / falls back to full parse / throws when missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "layouts-"));
  try {
    const head = path.join(dir, "head.json");
    fs.writeFileSync(head, JSON.stringify({ inputHash: "deadbeef", tiers: { x: "y".repeat(20000) } }, null, 2));
    assert.equal(readLocalLayoutsInputHash(head), "deadbeef");

    // inputHashが先頭4KBの外にある場合は全体パースにフォールバック
    const late = path.join(dir, "late.json");
    fs.writeFileSync(late, JSON.stringify({ pad: "p".repeat(10000), inputHash: "cafe01" }));
    assert.equal(readLocalLayoutsInputHash(late), "cafe01");

    assert.throws(() => readLocalLayoutsInputHash(path.join(dir, "missing.json")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
