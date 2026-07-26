// scripts/save-thumbnail.mjs のチャレンジ検知・og:image抽出ロジックの単体テスト（node:test）。
// lbbonline.com / adweek.com 等がCloudflareのTLSフィンガープリント判定でNodeのhttp(s)
// クライアントにだけ403チャレンジページ（"Just a moment..."）を返す問題への対応
// （curlフォールバック）の判定ロジックを検証する。実際のネットワークアクセスは行わない。
// 実行: node --test scripts/save-thumbnail.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import {
  extractOgImage,
  isChallengeResponse,
  extractImgFallbackCandidates,
  saveThumbnailFromPage,
  _deps,
} from "./save-thumbnail.mjs";

// ── フロー系テスト（saveThumbnailFromPage）用のヘルパー ──────────
// _deps（ネットワーク境界の差し替え口）をモックして実ネットワークアクセスなしで検証する。
// saveThumbnail() 自体はファイルシステム（public/thumbnails/）へ実際に書き込むため、
// 使い捨てIDを使い、各テストの t.after で必ず生成物を削除する
// （CLAUDE.mdの「public/thumbnails/にゴミを残さない」原則）。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THUMBNAILS_DIR = path.join(__dirname, "../public/thumbnails");
const thumbnailPath = (id) => path.join(THUMBNAILS_DIR, `${id}.jpg`);

/** ノイズ画素からJPEGバッファを生成する（フラットカラーだと圧縮でサイズ予測がぶれるため）。 */
async function makeNoiseJpeg(width, height) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
}

/** _deps を差し替え、テスト終了後に必ず元に戻す（他テストへの汚染防止）。 */
function stubDeps(t, overrides) {
  const originals = {};
  for (const key of Object.keys(overrides)) {
    originals[key] = _deps[key];
    _deps[key] = overrides[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) _deps[key] = originals[key];
  });
}

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

// ── extractImgFallbackCandidates ────────────────────────────
// og:image/twitter:imageを持たないページ（例: archive.aec.at）向けの<img>タグ
// フォールバック抽出。誤サムネ根絶の除外フィルタを維持しつつ候補を返す。

test("extractImgFallbackCandidates: 複数の<img>タグから候補URLを絶対URLで抽出する", () => {
  const html = `
    <body>
      <img src="/asset/1/preview/" alt="a">
      <img src="/asset/2/preview/" alt="b">
    </body>`;
  const candidates = extractImgFallbackCandidates(html, "https://archive.aec.at/prix/320401/");
  assert.deepEqual(candidates, [
    "https://archive.aec.at/asset/1/preview/",
    "https://archive.aec.at/asset/2/preview/",
  ]);
});

test("extractImgFallbackCandidates: 相対パスをページURL基準で絶対URLに解決する", () => {
  const html = `<img src="../images/photo.jpg">`;
  const candidates = extractImgFallbackCandidates(html, "https://example.com/sub/page/");
  assert.deepEqual(candidates, ["https://example.com/sub/images/photo.jpg"]);
});

test("extractImgFallbackCandidates: .svg / logo / icon / sprite / pixel / spacer / avatar / emoji を含む画像を除外する", () => {
  const html = `
    <img src="https://example.com/logo.png">
    <img src="https://example.com/icon-menu.png">
    <img src="https://example.com/sprite.png">
    <img src="https://example.com/pixel.gif">
    <img src="https://example.com/spacer.gif">
    <img src="https://example.com/avatar-user.jpg">
    <img src="https://example.com/emoji-smile.png">
    <img src="https://example.com/graphic.svg">
    <img src="https://example.com/LOGO-BIG.PNG">
    <img src="https://example.com/real-photo.jpg">
  `;
  const candidates = extractImgFallbackCandidates(html, "https://example.com/");
  assert.deepEqual(candidates, ["https://example.com/real-photo.jpg"]);
});

test("extractImgFallbackCandidates: data:URIは除外する", () => {
  const html = `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="><img src="https://example.com/real.jpg">`;
  const candidates = extractImgFallbackCandidates(html, "https://example.com/");
  assert.deepEqual(candidates, ["https://example.com/real.jpg"]);
});

test("extractImgFallbackCandidates: class に media/main を含む画像を優先する", () => {
  const html = `
    <img src="https://example.com/first.jpg">
    <img class="media" src="https://example.com/priority.jpg">
  `;
  const candidates = extractImgFallbackCandidates(html, "https://example.com/");
  assert.deepEqual(candidates, ["https://example.com/priority.jpg", "https://example.com/first.jpg"]);
});

test("extractImgFallbackCandidates: 上位5件までに制限する", () => {
  const imgs = Array.from({ length: 8 }, (_, i) => `<img src="https://example.com/img${i}.jpg">`).join("\n");
  const candidates = extractImgFallbackCandidates(imgs, "https://example.com/");
  assert.equal(candidates.length, 5);
});

test("extractImgFallbackCandidates: srcが無い/HTMLが空なら空配列", () => {
  assert.deepEqual(extractImgFallbackCandidates("<img alt='no src'>", "https://example.com/"), []);
  assert.deepEqual(extractImgFallbackCandidates("", "https://example.com/"), []);
});

// ── review指摘 D/E の回帰テスト ──────────────────────────────

test("extractImgFallbackCandidates: class部分一致で post-media__img / mainContent 等の実サイトで多用されるクラス名も優先する（review指摘D）", () => {
  const html = `
    <img src="https://example.com/first.jpg">
    <img class="post-media__img" src="https://example.com/priority1.jpg">
    <img class="mainContent" src="https://example.com/priority2.jpg">
  `;
  const candidates = extractImgFallbackCandidates(html, "https://example.com/");
  assert.deepEqual(candidates, [
    "https://example.com/priority1.jpg",
    "https://example.com/priority2.jpg",
    "https://example.com/first.jpg",
  ]);
});

test("extractImgFallbackCandidates: data-width=\"1\" 等の別属性は1x1トラッカー除外に誤マッチしない（review指摘E）", () => {
  const html = `<img data-width="1" data-height="1" src="https://example.com/real2.jpg">`;
  const candidates = extractImgFallbackCandidates(html, "https://example.com/");
  assert.deepEqual(candidates, ["https://example.com/real2.jpg"]);
});

test("extractImgFallbackCandidates: 実際のwidth=\"1\"/height=\"1\"（1x1トラッカー）は引き続き除外する", () => {
  const html = `
    <img width="1" height="1" src="https://example.com/tracker.gif">
    <img src="https://example.com/real3.jpg">
  `;
  const candidates = extractImgFallbackCandidates(html, "https://example.com/");
  assert.deepEqual(candidates, ["https://example.com/real3.jpg"]);
});

// ── フロー系テスト（saveThumbnailFromPage）────────────────────
// _deps（ネットワーク境界）をモックし、実ネットワークアクセスなしで検証する。

test("saveThumbnailFromPage: og:image取得に成功した場合はimgタグフォールバックを一切呼ばない", async (t) => {
  const html = `
    <meta property="og:image" content="https://example.com/og.jpg">
    <img src="https://example.com/should-not-be-fetched.jpg">
  `;
  const validJpeg = await makeNoiseJpeg(120, 120);
  assert.ok(validJpeg.length > 5000, "テスト前提: og:image用画像はsaveThumbnailの既定閾値5000バイトを超えること");
  const fetchImageCalls = [];

  stubDeps(t, {
    fetchOgImagePage: async () => ({ status: 200, html }),
    curlFetchText: async () => { throw new Error("og:imageが見つかった場合curlFetchTextは呼ばれないはず"); },
    fetchImage: async (url) => { fetchImageCalls.push(url); return validJpeg; },
  });

  const id = `test-flow-og-success-${Date.now()}`;
  t.after(() => fs.rm(thumbnailPath(id), { force: true }));

  const result = await saveThumbnailFromPage(id, "https://example.com/article");
  assert.equal(result, `/thumbnails/${id}.jpg`);
  // og:imageのURLのみが取得され、img候補（should-not-be-fetched.jpg）は一切取得されない
  assert.deepEqual(fetchImageCalls, ["https://example.com/og.jpg"]);
});

test("saveThumbnailFromPage: og:imageが無い場合、候補1件目が小さすぎて失敗しても2件目で成功する", async (t) => {
  const html = `
    <img src="https://example.com/too-small.jpg">
    <img src="https://example.com/big-enough.jpg">
  `;
  const tooSmallJpeg = await makeNoiseJpeg(2, 2); // 10KB閾値未満のはず
  const bigEnoughJpeg = await makeNoiseJpeg(300, 300); // 10KB閾値を超えるはず
  assert.ok(tooSmallJpeg.length < 10 * 1024, "テスト前提: too-small画像は10KB未満であること");
  assert.ok(bigEnoughJpeg.length > 10 * 1024, "テスト前提: big-enough画像は10KBを超えること");

  const fetchImageCalls = [];
  stubDeps(t, {
    fetchOgImagePage: async () => ({ status: 200, html: "<html>no og meta</html>" }),
    curlFetchText: async () => html, // og:image無し判定後のcurl全文再取得（img候補を含む）
    fetchImage: async (url) => {
      fetchImageCalls.push(url);
      if (url === "https://example.com/too-small.jpg") return tooSmallJpeg;
      if (url === "https://example.com/big-enough.jpg") return bigEnoughJpeg;
      return null;
    },
  });

  const id = `test-flow-second-candidate-${Date.now()}`;
  t.after(() => fs.rm(thumbnailPath(id), { force: true }));

  const result = await saveThumbnailFromPage(id, "https://example.com/article");
  assert.equal(result, `/thumbnails/${id}.jpg`);
  assert.deepEqual(fetchImageCalls, [
    "https://example.com/too-small.jpg",
    "https://example.com/big-enough.jpg",
  ]);
});

test("saveThumbnailFromPage: 候補がデコード不能（画像ではないバッファ）な場合は不採用にし次候補へ進む", async (t) => {
  const html = `
    <img src="https://example.com/not-an-image.jpg">
    <img src="https://example.com/valid.jpg">
  `;
  // 10KBは超えるが画像としてデコード不能なバッファ（404 HTML等を模す）
  const undecodable = Buffer.alloc(11 * 1024, "a");
  const validJpeg = await makeNoiseJpeg(300, 300);
  assert.ok(validJpeg.length > 10 * 1024, "テスト前提: valid画像は10KBを超えること");

  stubDeps(t, {
    fetchOgImagePage: async () => ({ status: 200, html: "<html>no og meta</html>" }),
    curlFetchText: async () => html,
    fetchImage: async (url) => {
      if (url === "https://example.com/not-an-image.jpg") return undecodable;
      if (url === "https://example.com/valid.jpg") return validJpeg;
      return null;
    },
  });

  const id = `test-flow-undecodable-${Date.now()}`;
  t.after(() => fs.rm(thumbnailPath(id), { force: true }));

  const result = await saveThumbnailFromPage(id, "https://example.com/article");
  assert.equal(result, `/thumbnails/${id}.jpg`);
});

test("saveThumbnailFromPage: [img-fallback] OK/NG ログが期待通り出力される", async (t) => {
  const html = `
    <img src="https://example.com/fail-candidate.jpg">
    <img src="https://example.com/ok-candidate.jpg">
  `;
  const tooSmallJpeg = await makeNoiseJpeg(2, 2);
  const bigEnoughJpeg = await makeNoiseJpeg(300, 300);

  stubDeps(t, {
    fetchOgImagePage: async () => ({ status: 200, html: "<html>no og meta</html>" }),
    curlFetchText: async () => html,
    fetchImage: async (url) => {
      if (url === "https://example.com/fail-candidate.jpg") return tooSmallJpeg;
      if (url === "https://example.com/ok-candidate.jpg") return bigEnoughJpeg;
      return null;
    },
  });

  const logSpy = t.mock.method(console, "log");
  const id = `test-flow-log-${Date.now()}`;
  t.after(() => fs.rm(thumbnailPath(id), { force: true }));

  await saveThumbnailFromPage(id, "https://example.com/article");

  const messages = logSpy.mock.calls.map((c) => c.arguments[0]);
  assert.ok(
    messages.some((m) => m === "[img-fallback] NG https://example.com/fail-candidate.jpg"),
    `NGログが見つからない: ${JSON.stringify(messages)}`
  );
  assert.ok(
    messages.some((m) => m === "[img-fallback] OK https://example.com/ok-candidate.jpg"),
    `OKログが見つからない: ${JSON.stringify(messages)}`
  );
});
