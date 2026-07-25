import assert from "node:assert/strict";
import test from "node:test";
import { CURL_STATUS_MARKER, htmlToText, isChallengeResponse, isHtmlContentType, parseCurlOutput } from "./pageFetch.js";

// ── isChallengeResponse（scripts/save-thumbnail.mjsと同じ判定思想をstudio側に移植） ──

test("isChallengeResponse: 400以上のステータスはチャレンジ扱い", () => {
  assert.equal(isChallengeResponse(403, "<html>ok</html>"), true);
  assert.equal(isChallengeResponse(404, ""), true);
  assert.equal(isChallengeResponse(500, ""), true);
});

test("isChallengeResponse: 200かつ通常本文はチャレンジではない", () => {
  assert.equal(isChallengeResponse(200, "<html><body>普通の記事本文</body></html>"), false);
});

test("isChallengeResponse: 200でも'Just a moment'を含む本文はチャレンジ扱い", () => {
  assert.equal(isChallengeResponse(200, "<html>Just a moment...</html>"), true);
});

test("isChallengeResponse: 200でもcf-chl等のCloudflareマーカーを含む本文はチャレンジ扱い", () => {
  assert.equal(isChallengeResponse(200, '<div class="cf-chl-widget">x</div>'), true);
  assert.equal(isChallengeResponse(200, "cf_chl_opt"), true);
  assert.equal(isChallengeResponse(200, "challenge-platform"), true);
});

// ── isHtmlContentType（指摘3: PDF/画像等のバイナリをhtmlToTextに通さないための事前検査） ──

test("isHtmlContentType: text/html系はtrue", () => {
  assert.equal(isHtmlContentType("text/html; charset=utf-8"), true);
  assert.equal(isHtmlContentType("text/html"), true);
});

test("isHtmlContentType: 非html(application/pdf・image/png等)はfalse", () => {
  assert.equal(isHtmlContentType("application/pdf"), false);
  assert.equal(isHtmlContentType("image/png"), false);
  assert.equal(isHtmlContentType("application/octet-stream"), false);
});

test("isHtmlContentType: 空/null/undefinedは判定不能として通す(true)", () => {
  assert.equal(isHtmlContentType(null), true);
  assert.equal(isHtmlContentType(undefined), true);
  assert.equal(isHtmlContentType(""), true);
});

// ── parseCurlOutput（指摘1: curl `-w` 出力から本文とHTTPステータスを分離する） ──

test("parseCurlOutput: 本文とステータスコードを分離できる（200・正常HTML）", () => {
  const stdout = `<html>ok</html>${CURL_STATUS_MARKER}200`;
  const result = parseCurlOutput(stdout);
  assert.deepEqual(result, { status: 200, html: "<html>ok</html>" });
});

test("parseCurlOutput: 4xx/5xxのステータスも取得できる（死リンク検知に使う）", () => {
  const notFound = parseCurlOutput(`<html>Not Found</html>${CURL_STATUS_MARKER}404`);
  assert.equal(notFound?.status, 404);
  const serverError = parseCurlOutput(`error page${CURL_STATUS_MARKER}500`);
  assert.equal(serverError?.status, 500);
});

test("parseCurlOutput: マーカーが見つからない想定外の出力はnull", () => {
  assert.equal(parseCurlOutput("本文のみ、マーカー無し"), null);
  assert.equal(parseCurlOutput(""), null);
});

test("parseCurlOutput: ステータス部分が数値でなければnull", () => {
  assert.equal(parseCurlOutput(`本文${CURL_STATUS_MARKER}NaN`), null);
});

// ── isChallengeResponse × curl経路の想定シナリオ（指摘1: 死リンク/チャレンジをnull扱いにする） ──
// fetchPageWithFallback本体はネットワークI/Oのためテスト対象外だが、curl経路が実際に使う
// 「parseCurlOutputで得たstatus/htmlをisChallengeResponseに通す」という組み合わせを検証する。

test("curl経路のシナリオ: 4xxならisChallengeResponseがtrueを返し、呼び出し元はnull扱いにできる", () => {
  const parsed = parseCurlOutput(`<html>Not Found</html>${CURL_STATUS_MARKER}404`);
  assert.ok(parsed);
  assert.equal(isChallengeResponse(parsed.status, parsed.html), true);
});

test("curl経路のシナリオ: 200でもチャレンジ本文ならisChallengeResponseがtrueを返す", () => {
  const parsed = parseCurlOutput(`<html>Just a moment...</html>${CURL_STATUS_MARKER}200`);
  assert.ok(parsed);
  assert.equal(isChallengeResponse(parsed.status, parsed.html), true);
});

test("curl経路のシナリオ: 200かつ通常本文はisChallengeResponseがfalseを返す（信頼してよい）", () => {
  const parsed = parseCurlOutput(`<html><body>普通の記事本文</body></html>${CURL_STATUS_MARKER}200`);
  assert.ok(parsed);
  assert.equal(isChallengeResponse(parsed.status, parsed.html), false);
});

// ── htmlToText（Agentプロンプトに埋め込む用のプレーンテキスト抽出。純粋関数） ──

test("htmlToText: script/styleタグの中身を除去する", () => {
  const html = "<html><head><style>.a{color:red}</style></head><body><script>alert(1)</script>本文です</body></html>";
  const text = htmlToText(html);
  assert.doesNotMatch(text, /color:red/);
  assert.doesNotMatch(text, /alert/);
  assert.match(text, /本文です/);
});

test("htmlToText: タグを除去してテキストのみ残す", () => {
  const html = "<article><h1>タイトル</h1><p>段落1</p><p>段落2</p></article>";
  const text = htmlToText(html);
  assert.doesNotMatch(text, /<[a-z]/i);
  assert.match(text, /タイトル/);
  assert.match(text, /段落1/);
  assert.match(text, /段落2/);
});

test("htmlToText: HTMLエンティティをデコードする", () => {
  const html = "<p>Tom &amp; Jerry &lt;test&gt;</p>";
  const text = htmlToText(html);
  assert.match(text, /Tom & Jerry <test>/);
});

test("htmlToText: 空白を圧縮する", () => {
  const html = "<p>a</p>\n\n\n<p>b</p>   <p>c</p>";
  const text = htmlToText(html);
  assert.doesNotMatch(text, /\n{3,}/);
});

test("htmlToText: maxCharsを超える分は切り詰める", () => {
  const html = `<p>${"あ".repeat(100)}</p>`;
  const text = htmlToText(html, 20);
  assert.ok(text.length <= 20, `expected length <= 20, got ${text.length}`);
});
