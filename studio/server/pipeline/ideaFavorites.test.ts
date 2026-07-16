/**
 * pipeline/ideaFavorites.ts のうち、ネットワークを伴わない部分のみ検証する
 * （fetchFavoriteIds自体はhttps呼び出しを伴うため対象外。sdkRunner.ts等と同じ方針）。
 *
 * 「お気に入り同期が未設定/設定不完全なら偽装せずnullを返す」ことは、ideaResearch.ts が
 * job.warningを出す全事例フォールバックの根幹なので明示的にカバーする。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deriveIdeaSignalEndpoint, loadFavSyncConfig } from "./ideaFavorites.js";

test("loadFavSyncConfig: ファイルが無ければnull", async () => {
  const cfg = await loadFavSyncConfig(path.join(os.tmpdir(), "researchman-studio-test-nonexistent-favsync.json"));
  assert.equal(cfg, null);
});

test("loadFavSyncConfig: JSONが壊れていればnull", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "researchman-favsync-test-"));
  const p = path.join(dir, "favsync.json");
  try {
    await writeFile(p, "{not valid json");
    const cfg = await loadFavSyncConfig(p);
    assert.equal(cfg, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadFavSyncConfig: endpoint/tokenが欠けていればnull", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "researchman-favsync-test-"));
  const p = path.join(dir, "favsync.json");
  try {
    await writeFile(p, JSON.stringify({ endpoint: "https://example.com" })); // tokenが無い
    const cfg = await loadFavSyncConfig(p);
    assert.equal(cfg, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadFavSyncConfig: endpoint/token両方あれば読み込める", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "researchman-favsync-test-"));
  const p = path.join(dir, "favsync.json");
  try {
    await writeFile(p, JSON.stringify({ endpoint: "https://example.com/api/favorites", token: "secret" }));
    const cfg = await loadFavSyncConfig(p);
    assert.deepEqual(cfg, { endpoint: "https://example.com/api/favorites", token: "secret" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── deriveIdeaSignalEndpoint（/api/idea-likes・/api/idea-trash のURL導出） ────
// scripts/lib/tuneup-stats.mjs の deriveTrashEndpoint と同じ考え方: 末尾が
// /api/favorites[/]の形にマッチしない場合は導出失敗としてnullを返す（誤ったURLを叩いて
// 別種のレスポンスを取り違える事故の防止。scripts/は改変禁止のためロジックはここに複製する）。
test("deriveIdeaSignalEndpoint: /api/favorites → /api/idea-likes", () => {
  const url = deriveIdeaSignalEndpoint("https://example.com/api/favorites", "idea-likes");
  assert.equal(url, "https://example.com/api/idea-likes");
});

test("deriveIdeaSignalEndpoint: /api/favorites → /api/idea-trash", () => {
  const url = deriveIdeaSignalEndpoint("https://example.com/api/favorites", "idea-trash");
  assert.equal(url, "https://example.com/api/idea-trash");
});

test("deriveIdeaSignalEndpoint: 末尾スラッシュも許容する", () => {
  const url = deriveIdeaSignalEndpoint("https://example.com/api/favorites/", "idea-likes");
  assert.equal(url, "https://example.com/api/idea-likes/");
});

test("deriveIdeaSignalEndpoint: /api/favoritesで終わらない非標準URLはnull（導出失敗を明示）", () => {
  const url = deriveIdeaSignalEndpoint("https://example.com/api/somethingelse", "idea-likes");
  assert.equal(url, null);
});
