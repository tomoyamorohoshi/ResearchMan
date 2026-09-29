// scripts/lib/sources-registry.mjs の単体テスト（node:test）。
// 実行: node --test scripts/lib/sources-registry.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSourcesRegistry } from "./sources-registry.mjs";

const ok = (o = {}) => ({
  id: "a",
  kind: "web",
  locator: "https://a.com",
  lang: "en",
  region: "欧州",
  tier: 1,
  hitDensity: null,
  enabled: false,
  note: "",
  ...o,
});

test("正常な1件はok", () => {
  assert.deepEqual(validateSourcesRegistry([ok()]), { ok: true, errors: [] });
});

test("配列でなければNG", () => {
  assert.equal(validateSourcesRegistry({}).ok, false);
});

test("id重複・空idはNG", () => {
  assert.equal(validateSourcesRegistry([ok(), ok()]).ok, false);
  assert.equal(validateSourcesRegistry([ok({ id: "" })]).ok, false);
});

test("kind不正はNG", () => {
  assert.equal(validateSourcesRegistry([ok({ kind: "rss" })]).ok, false);
  for (const kind of ["web", "x_account", "x_list", "x_query"]) {
    assert.equal(validateSourcesRegistry([ok({ kind, locator: kind === "x_account" ? "@a" : kind === "web" ? "https://a.com" : "l" })]).ok, true, kind);
  }
});

test("tierは1〜3の整数のみ", () => {
  for (const t of [0, 4, 1.5, "1", null]) assert.equal(validateSourcesRegistry([ok({ tier: t })]).ok, false, String(t));
});

test("hitDensityは0〜1かnull", () => {
  assert.equal(validateSourcesRegistry([ok({ hitDensity: 0.6 })]).ok, true);
  assert.equal(validateSourcesRegistry([ok({ hitDensity: 1.2 })]).ok, false);
  assert.equal(validateSourcesRegistry([ok({ hitDensity: "0.5" })]).ok, false);
});

test("enabledはboolean必須・locator非空必須", () => {
  assert.equal(validateSourcesRegistry([ok({ enabled: "no" })]).ok, false);
  assert.equal(validateSourcesRegistry([ok({ locator: "" })]).ok, false);
});

test("web の locator は http(s) URL、x_account は @handle", () => {
  assert.equal(validateSourcesRegistry([ok({ locator: "example.com" })]).ok, false);
  assert.equal(validateSourcesRegistry([ok({ kind: "x_account", locator: "ideafuls" })]).ok, false);
});

test("data/sources.json 実ファイルがスキーマを満たし、Phase 1では全件 enabled:false", () => {
  const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "sources.json");
  const data = JSON.parse(fs.readFileSync(p, "utf-8"));
  const r = validateSourcesRegistry(data);
  assert.deepEqual(r.errors, []);
  assert.ok(data.length >= 40);
  assert.ok(data.every((s) => s.enabled === false));
  assert.ok(data.some((s) => s.id === "x_ideafuls" && s.kind === "x_account"));
});
