/**
 * pipeline/autoFavorite.ts の純粋関数テスト（node:test）。
 * 実際にPOSTするpostFavoriteはネットワークI/Oのため自動テスト対象外
 * （thumbnail.ts/xMedia.tsの手動確認と同じ既存の慣習）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildFavoritePayload, classifyFavoriteResponse } from "./autoFavorite.js";

// ── buildFavoritePayload ──────────────────────────────────────────

test("buildFavoritePayload: 指定idをfav:trueで含むペイロードを組み立てる", () => {
  const payload = buildFavoritePayload("some-case-id", 1_700_000_000_000);
  assert.deepEqual(payload, {
    items: { "some-case-id": { fav: true, ts: 1_700_000_000_000 } },
  });
});

test("buildFavoritePayload: idが異なれば別キーになる", () => {
  const payload = buildFavoritePayload("other-id", 123);
  assert.deepEqual(payload, { items: { "other-id": { fav: true, ts: 123 } } });
});

// ── classifyFavoriteResponse ────────────────────────────────────

test("classifyFavoriteResponse: 200はok", () => {
  assert.equal(classifyFavoriteResponse(200), "ok");
});

test("classifyFavoriteResponse: 503（Blob未設定）はskip", () => {
  assert.equal(classifyFavoriteResponse(503), "skip");
});

test("classifyFavoriteResponse: 400/401/500等、200以外はすべてskip", () => {
  for (const status of [400, 401, 404, 500, 502, 503]) {
    assert.equal(classifyFavoriteResponse(status), "skip");
  }
});
