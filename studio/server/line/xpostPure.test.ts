import assert from "node:assert/strict";
import test from "node:test";
import { buildReplyBubbleText, buildXPostBubbles, parseXPostUrl, validateXPostDraft, xWeightedLength } from "./xpostPure.js";

// ── parseXPostUrl ────────────────────────────────────────────────────

test("parseXPostUrl: 事例URL（末尾スラッシュ無し）", () => {
  assert.deepEqual(parseXPostUrl("https://research-man.vercel.app/cases/foo-2026"), { kind: "case", id: "foo-2026" });
});

test("parseXPostUrl: 事例URL（末尾スラッシュあり）", () => {
  assert.deepEqual(parseXPostUrl("https://research-man.vercel.app/cases/foo-2026/"), { kind: "case", id: "foo-2026" });
});

test("parseXPostUrl: 技術URL（クエリ付き）", () => {
  assert.deepEqual(parseXPostUrl("https://research-man.vercel.app/technology/mulacover?utm_source=x"), {
    kind: "tech",
    id: "mulacover",
  });
});

test("parseXPostUrl: ハッシュ付き", () => {
  assert.deepEqual(parseXPostUrl("https://research-man.vercel.app/cases/foo-2026#section"), { kind: "case", id: "foo-2026" });
});

test("parseXPostUrl: 前後に文章が付いていても最初のURLを拾う", () => {
  assert.deepEqual(parseXPostUrl("これ見て https://research-man.vercel.app/cases/foo-2026 良さそう"), {
    kind: "case",
    id: "foo-2026",
  });
});

test("parseXPostUrl: www.付きは拒否", () => {
  assert.equal(parseXPostUrl("https://www.research-man.vercel.app/cases/foo-2026"), null);
});

test("parseXPostUrl: httpは拒否（https必須）", () => {
  assert.equal(parseXPostUrl("http://research-man.vercel.app/cases/foo-2026"), null);
});

test("parseXPostUrl: 別ホスト（プレビュー等）は拒否", () => {
  assert.equal(parseXPostUrl("https://research-man-git-preview.vercel.app/cases/foo-2026"), null);
});

test("parseXPostUrl: RM以外のURLは拒否", () => {
  assert.equal(parseXPostUrl("https://example.com/cases/foo-2026"), null);
});

test("parseXPostUrl: パスが不明（cases/technology以外）は拒否", () => {
  assert.equal(parseXPostUrl("https://research-man.vercel.app/ideas/foo"), null);
});

test("parseXPostUrl: URLが全く無ければnull", () => {
  assert.equal(parseXPostUrl("これは事例です"), null);
});

test("parseXPostUrl: 空文字はnull", () => {
  assert.equal(parseXPostUrl("   "), null);
});

// ── xWeightedLength ──────────────────────────────────────────────────

test("xWeightedLength: 英数字は1文字1カウント", () => {
  assert.equal(xWeightedLength("abcde"), 5);
});

test("xWeightedLength: CJKは1文字2カウント", () => {
  assert.equal(xWeightedLength("こんにちは"), 10);
});

test("xWeightedLength: 混在（CJK+英数字）", () => {
  assert.equal(xWeightedLength("abc日本語123"), 3 + 3 * 2 + 3);
});

test("xWeightedLength: URLは実長に関わらず23固定", () => {
  const short = xWeightedLength("見て https://x.co/a");
  const long = xWeightedLength("見て https://example.com/very/long/path/that/keeps/going/and/going");
  assert.equal(short, long);
  // 「見て 」= 3(CJK2+space1) + URL23
  assert.equal(short, 2 + 2 + 1 + 23);
});

test("xWeightedLength: URLが複数あればそれぞれ23", () => {
  const text = "https://a.co https://b.co";
  assert.equal(xWeightedLength(text), 23 + 1 + 23);
});

test("xWeightedLength: 空文字は0", () => {
  assert.equal(xWeightedLength(""), 0);
});

// ── validateXPostDraft ───────────────────────────────────────────────

test("validateXPostDraft: 正常なJSONはok", () => {
  const r = validateXPostDraft({ postA: "こんにちは、これは事例紹介です。", postB: "別の切り口の投稿文です。" });
  assert.equal(r.ok, true);
});

test("validateXPostDraft: オブジェクトでなければ拒否", () => {
  const r = validateXPostDraft("not an object");
  assert.equal(r.ok, false);
});

test("validateXPostDraft: postA欠落は拒否", () => {
  const r = validateXPostDraft({ postB: "本文B" });
  assert.equal(r.ok, false);
});

test("validateXPostDraft: postB欠落は拒否", () => {
  const r = validateXPostDraft({ postA: "本文A" });
  assert.equal(r.ok, false);
});

test("validateXPostDraft: 280文字超（加重）は拒否", () => {
  const long = "あ".repeat(141); // 141*2=282 > 280
  const r = validateXPostDraft({ postA: long, postB: "本文B" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /280文字を超えています/);
});

test("validateXPostDraft: ちょうど280文字（加重）はok", () => {
  const exact = "あ".repeat(140); // 140*2=280
  const r = validateXPostDraft({ postA: exact, postB: "本文B" });
  assert.equal(r.ok, true);
});

test("validateXPostDraft: 本文にURLがあれば拒否（postA）", () => {
  const r = validateXPostDraft({ postA: "詳細はこちら https://example.com", postB: "本文B" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /URL/);
});

test("validateXPostDraft: 本文にURLがあれば拒否（postB）", () => {
  const r = validateXPostDraft({ postA: "本文A", postB: "詳細はこちら https://example.com" });
  assert.equal(r.ok, false);
});

// ── buildReplyBubbleText / buildXPostBubbles ──────────────────────────

test("buildReplyBubbleText: RMページURLのみ", () => {
  const text = buildReplyBubbleText({ rmUrl: "https://research-man.vercel.app/cases/foo" });
  assert.equal(text, "RMページ: https://research-man.vercel.app/cases/foo");
});

test("buildReplyBubbleText: 一次ソース・動画ありなら追記される", () => {
  const text = buildReplyBubbleText({
    rmUrl: "https://research-man.vercel.app/cases/foo",
    sourceUrl: "https://example.com/article",
    videoUrl: "https://www.youtube.com/watch?v=abc123",
  });
  assert.match(text, /RMページ: https:\/\/research-man\.vercel\.app\/cases\/foo/);
  assert.match(text, /一次ソース: https:\/\/example\.com\/article/);
  assert.match(text, /動画: https:\/\/www\.youtube\.com\/watch\?v=abc123（公式動画/);
});

test("buildXPostBubbles: 画像ありなら4吹き出し", () => {
  const messages = buildXPostBubbles(
    { postA: "A", postB: "B" },
    { rmUrl: "https://research-man.vercel.app/cases/foo", thumbnailUrl: "https://research-man.vercel.app/thumbnails/foo.jpg" },
    true,
  );
  assert.equal(messages.length, 4);
  assert.deepEqual(messages[0], { type: "text", text: "A" });
  assert.deepEqual(messages[3], {
    type: "image",
    originalContentUrl: "https://research-man.vercel.app/thumbnails/foo.jpg",
    previewImageUrl: "https://research-man.vercel.app/thumbnails/foo.jpg",
  });
});

test("buildXPostBubbles: includeImage=falseなら画像を省略し3吹き出し", () => {
  const messages = buildXPostBubbles(
    { postA: "A", postB: "B" },
    { rmUrl: "https://research-man.vercel.app/cases/foo", thumbnailUrl: "https://research-man.vercel.app/thumbnails/foo.jpg" },
    false,
  );
  assert.equal(messages.length, 3);
});

test("buildXPostBubbles: thumbnailUrl未指定なら画像を省略", () => {
  const messages = buildXPostBubbles({ postA: "A", postB: "B" }, { rmUrl: "https://research-man.vercel.app/cases/foo" }, true);
  assert.equal(messages.length, 3);
});

test("buildXPostBubbles: 常に5件以下に切り詰める", () => {
  const messages = buildXPostBubbles(
    { postA: "A", postB: "B" },
    { rmUrl: "https://research-man.vercel.app/cases/foo", thumbnailUrl: "https://research-man.vercel.app/thumbnails/foo.jpg" },
    true,
  );
  assert.ok(messages.length <= 5);
});
