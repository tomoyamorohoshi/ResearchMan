// scripts/save-thumbnail.mjs のチャレンジ検知・og:image抽出ロジックの単体テスト（node:test）。
// lbbonline.com / adweek.com 等がCloudflareのTLSフィンガープリント判定でNodeのhttp(s)
// クライアントにだけ403チャレンジページ（"Just a moment..."）を返す問題への対応
// （curlフォールバック）の判定ロジックを検証する。実際のネットワークアクセスは行わない。
// 実行: node --test scripts/save-thumbnail.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOgImage, isChallengeResponse } from "./save-thumbnail.mjs";

test("extractOgImage: property→content の順のog:imageタグを抽出する", () => {
  const html = `<meta property="og:image" content="https://example.com/a.jpg">`;
  assert.equal(extractOgImage(html), "https://example.com/a.jpg");
});

test("extractOgImage: content→property の順（属性順序違い）も抽出する", () => {
  const html = `<meta content="https://example.com/b.jpg" property="og:image">`;
  assert.equal(extractOgImage(html), "https://example.com/b.jpg");
});

test("extractOgImage: og:imageが無ければtwitter:imageにフォールバックする", () => {
  const html = `<meta name="twitter:image" content="https://example.com/c.jpg">`;
  assert.equal(extractOgImage(html), "https://example.com/c.jpg");
});

test("extractOgImage: HTMLエンティティ &amp; を & にデコードする", () => {
  const html = `<meta property="og:image" content="https://example.com/img?a=1&amp;b=2">`;
  assert.equal(extractOgImage(html), "https://example.com/img?a=1&b=2");
});

test("extractOgImage: og:image/twitter:imageが無ければnull", () => {
  assert.equal(extractOgImage("<html><head></head><body>no meta</body></html>"), null);
  assert.equal(extractOgImage(""), null);
});

test("extractOgImage: httpで始まらない値はnullとして扱う（相対パス等を誤採用しない）", () => {
  const html = `<meta property="og:image" content="/relative/a.jpg">`;
  assert.equal(extractOgImage(html), null);
});

test("isChallengeResponse: ステータス403はチャレンジ扱い", () => {
  assert.equal(isChallengeResponse(403, "<html>ordinary</html>"), true);
});

test("isChallengeResponse: 5xxもチャレンジ/異常系として扱う", () => {
  assert.equal(isChallengeResponse(503, "<html>ordinary</html>"), true);
});

test("isChallengeResponse: 本文に Just a moment を含めばステータス200でもチャレンジ扱い", () => {
  assert.equal(isChallengeResponse(200, "<html><title>Just a moment...</title></html>"), true);
});

test("isChallengeResponse: cf-chl 等のCloudflareチャレンジマーカーもチャレンジ扱い", () => {
  assert.equal(isChallengeResponse(200, `<div id="cf-chl-widget"></div>`), true);
});

test("isChallengeResponse: 通常の200 HTMLはチャレンジではない", () => {
  assert.equal(
    isChallengeResponse(200, `<html><head><meta property="og:image" content="https://x.com/a.jpg"></head></html>`),
    false
  );
});
