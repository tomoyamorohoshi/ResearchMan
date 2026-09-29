// idea単位シェイプ割り当てキャッシュ(scripts/lib/idea-shape-cache.mjs)のテスト。
// 実行: node --test scripts/lib/idea-shape-cache.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildShapeCacheSalt,
  computeCodeFingerprint,
  createFileShapeCache,
  isDefaultIdeasInput,
  shapeAssignmentCacheKey,
} from "./idea-shape-cache.mjs";

const KINDS = ["blob", "polygon", "splat"];
const baseIdea = {
  id: "i-1",
  title: "タイトル",
  dateLabel: "2026.07.27",
  seed: "本文",
  refs: [{ type: "case", id: "c1", title: "T", desc: "D" }],
};
const consts = { titleFontPx: { mobile: 13 }, bodyFontPx: { mobile: 9.5 }, tierRefWidthPx: { mobile: 358 } };
const mkSalt = (over = {}) =>
  buildShapeCacheSalt({ algoVersion: "v-test", codeFingerprint: "fp", constants: consts, ...over });
const salt = mkSalt();

function tmpFile(name = "cache.json") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shape-cache-test-"));
  return path.join(dir, name);
}

test("cache key: 同一入力は同一キー、形状に効く入力が1つでも違えば別キー", () => {
  const k = shapeAssignmentCacheKey(baseIdea, salt);
  assert.equal(shapeAssignmentCacheKey({ ...baseIdea }, salt), k);
  const variants = [
    { id: "i-2" },
    { title: "タイトル2" },
    { dateLabel: "ARCHIVE" },
    { seed: "本文2" },
    { refs: [] },
    { refs: [{ ...baseIdea.refs[0], desc: "D2" }] },
    { refs: [{ ...baseIdea.refs[0], title: "T2" }] },
    { refs: [{ ...baseIdea.refs[0], type: "tech" }] },
  ];
  for (const v of variants) {
    assert.notEqual(shapeAssignmentCacheKey({ ...baseIdea, ...v }, salt), k, JSON.stringify(v));
  }
});

test("cache key: 引数の境界が曖昧にならない(title/dateLabel連結衝突なし)", () => {
  const a = shapeAssignmentCacheKey({ ...baseIdea, title: "ab", dateLabel: "c" }, salt);
  const b = shapeAssignmentCacheKey({ ...baseIdea, title: "a", dateLabel: "bc" }, salt);
  assert.notEqual(a, b);
});

test("salt: ALGO_VERSION・コード指紋・フォント/幅定数のどれが変わってもキーが変わる", () => {
  const k = shapeAssignmentCacheKey(baseIdea, mkSalt());
  assert.notEqual(shapeAssignmentCacheKey(baseIdea, mkSalt({ algoVersion: "v-test2" })), k);
  assert.notEqual(shapeAssignmentCacheKey(baseIdea, mkSalt({ codeFingerprint: "fp2" })), k);
  assert.notEqual(
    shapeAssignmentCacheKey(baseIdea, mkSalt({ constants: { ...consts, titleFontPx: { mobile: 14 } } })),
    k,
  );
  assert.notEqual(
    shapeAssignmentCacheKey(baseIdea, mkSalt({ constants: { ...consts, bodyFontPx: { mobile: 10 } } })),
    k,
  );
  assert.notEqual(
    shapeAssignmentCacheKey(baseIdea, mkSalt({ constants: { ...consts, tierRefWidthPx: { mobile: 360 } } })),
    k,
  );
});

test("computeCodeFingerprint: ファイル内容が変われば指紋が変わる", () => {
  const f = tmpFile("src.ts");
  fs.writeFileSync(f, "a");
  const a = computeCodeFingerprint([f]);
  assert.equal(computeCodeFingerprint([f]), a);
  fs.writeFileSync(f, "b");
  assert.notEqual(computeCodeFingerprint([f]), a);
});

test("file cache: set→flush→別インスタンスでget(ラウンドトリップ)", () => {
  const file = tmpFile();
  const c1 = createFileShapeCache({ filePath: file, salt, validKinds: KINDS });
  assert.equal(c1.get(baseIdea), undefined);
  c1.set(baseIdea, { kind: "splat", generous: true });
  c1.flush();
  const c2 = createFileShapeCache({ filePath: file, salt, validKinds: KINDS });
  assert.deepEqual(c2.get(baseIdea), { kind: "splat", generous: true });
  // saltが違えば(=ALGO_VERSION等が変われば)ヒットしない
  const c3 = createFileShapeCache({ filePath: file, salt: mkSalt({ algoVersion: "other" }), validKinds: KINDS });
  assert.equal(c3.get(baseIdea), undefined);
});

test("file cache: 壊れたJSON・不正エントリは黙って無視(throwしない)", () => {
  const file = tmpFile();
  fs.writeFileSync(file, "{not json");
  const warns = [];
  const c = createFileShapeCache({ filePath: file, salt, validKinds: KINDS, warn: (m) => warns.push(m) });
  assert.equal(c.get(baseIdea), undefined);
  c.set(baseIdea, { kind: "blob", generous: false });
  c.flush(); // 壊れたファイルを上書きして復旧できる
  const ok = createFileShapeCache({ filePath: file, salt, validKinds: KINDS });
  assert.deepEqual(ok.get(baseIdea), { kind: "blob", generous: false });

  const key = shapeAssignmentCacheKey(baseIdea, salt);
  const bad = tmpFile();
  fs.writeFileSync(bad, JSON.stringify({ version: 1, entries: { [key]: { kind: "nonexistent", generous: false } } }));
  const c2 = createFileShapeCache({ filePath: bad, salt, validKinds: KINDS });
  assert.equal(c2.get(baseIdea), undefined);
});

test("file cache: 書き込み失敗(親がファイル)でもthrowしない", () => {
  const blocker = tmpFile("blocker");
  fs.writeFileSync(blocker, "x");
  const warns = [];
  const c = createFileShapeCache({
    filePath: path.join(blocker, "sub", "cache.json"),
    salt,
    validKinds: KINDS,
    warn: (m) => warns.push(m),
  });
  c.set(baseIdea, { kind: "blob", generous: false });
  assert.doesNotThrow(() => c.flush());
  assert.ok(warns.length > 0);
  // メモリ上のキャッシュは引き続き有効
  assert.deepEqual(c.get(baseIdea), { kind: "blob", generous: false });
});

test("finalize: 今回触れなかった古いエントリは掃除される", () => {
  const file = tmpFile();
  const old = { ...baseIdea, id: "old" };
  const c1 = createFileShapeCache({ filePath: file, salt, validKinds: KINDS });
  c1.set(old, { kind: "blob", generous: false });
  c1.set(baseIdea, { kind: "polygon", generous: false });
  c1.finalize();
  const c2 = createFileShapeCache({ filePath: file, salt, validKinds: KINDS });
  assert.ok(c2.get(baseIdea)); // touch
  c2.finalize();
  const c3 = createFileShapeCache({ filePath: file, salt, validKinds: KINDS });
  assert.equal(c3.get(old), undefined);
  assert.ok(c3.get(baseIdea));
});

test("finalize: 別salt(別ブランチ/worktree/旧ソース)のエントリは残す(本番キャッシュを消さない)", () => {
  const file = tmpFile();
  const saltB = mkSalt({ codeFingerprint: "other-branch" });
  const b = createFileShapeCache({ filePath: file, salt: saltB, validKinds: KINDS });
  b.set(baseIdea, { kind: "polygon", generous: false });
  b.finalize();
  // 別saltで(未使用のまま)finalizeしてもB側は消えない
  const a = createFileShapeCache({ filePath: file, salt, validKinds: KINDS });
  a.set({ ...baseIdea, id: "a-only" }, { kind: "blob", generous: false });
  a.finalize();
  const b2 = createFileShapeCache({ filePath: file, salt: saltB, validKinds: KINDS });
  assert.deepEqual(b2.get(baseIdea), { kind: "polygon", generous: false });
});

test("finalize: 別saltのエントリは長期間(TTL)未使用なら掃除される", () => {
  const file = tmpFile();
  const saltB = mkSalt({ codeFingerprint: "old" });
  const DAY = 24 * 3600 * 1000;
  const t0 = 1_000_000_000_000;
  const b = createFileShapeCache({ filePath: file, salt: saltB, validKinds: KINDS, now: () => t0 });
  b.set(baseIdea, { kind: "polygon", generous: false });
  b.finalize();
  const a = createFileShapeCache({ filePath: file, salt, validKinds: KINDS, now: () => t0 + 8 * DAY, otherSaltTtlMs: 30 * DAY });
  a.finalize();
  assert.ok(createFileShapeCache({ filePath: file, salt: saltB, validKinds: KINDS }).get(baseIdea)); // 8日: 残る
  const a2 = createFileShapeCache({ filePath: file, salt, validKinds: KINDS, now: () => t0 + 31 * DAY, otherSaltTtlMs: 30 * DAY });
  a2.finalize();
  assert.equal(createFileShapeCache({ filePath: file, salt: saltB, validKinds: KINDS }).get(baseIdea), undefined); // 31日: 消える
});

test("isDefaultIdeasInput: 既定のdata/ideas.json(絶対パス比較)のときだけtrue", () => {
  const def = path.resolve("/repo/data/ideas.json");
  assert.equal(isDefaultIdeasInput(def, def), true);
  assert.equal(isDefaultIdeasInput(path.resolve("/repo/data/../data/ideas.json"), def), true);
  assert.equal(isDefaultIdeasInput(path.resolve("/tmp/fixture-ideas.json"), def), false);
  assert.equal(isDefaultIdeasInput(path.resolve("/other-worktree/data/ideas.json"), def), false);
});

test("precompute: 隔離入力(IDEAS_JSON_PATH差し替え)ではキャッシュファイルに触れない(統合)", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "precompute-iso-"));
  const ideas = path.join(dir, "ideas.json");
  fs.writeFileSync(
    ideas,
    JSON.stringify([{ id: "iso-1", title: "隔離", date: "2026-07-27", seed: "短い本文", refs: [] }]),
  );
  const cachePath = path.join(dir, "cache.json");
  const sentinel = JSON.stringify({ version: 2, entries: { keep: { kind: "blob", generous: false, s: "x", t: 1 } } });
  fs.writeFileSync(cachePath, sentinel);
  const r = spawnSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "scripts/precompute-idea-layouts.mjs")], {
    encoding: "utf-8",
    env: { ...process.env, IDEAS_JSON_PATH: ideas, IDEA_LAYOUTS_JSON_PATH: path.join(dir, "out.json"), IDEA_SHAPE_CACHE_PATH: cachePath },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(cachePath, "utf-8"), sentinel);
  assert.ok(fs.existsSync(path.join(dir, "out.json")));
});
