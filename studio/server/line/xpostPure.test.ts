import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMetaBubbleText,
  buildSelfReplyBubbleText,
  buildXPostBubbles,
  IMAGE_OMITTED_NOTE,
  parseXPostUrl,
  validateXPostDraft,
  xWeightedLength,
} from "./xpostPure.js";

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

// ── validateXPostDraft（2026-09-27: claims必須・改行必須の新スキーマ） ───────

const ENTRY_FIELDS = {
  summary: "これは事例の概要テキストです。詳細な説明が含まれています。",
  overview: "背景・企画意図に関する説明文です。",
};

function validPost(overrides: Partial<{ text: string; claims: Array<{ sourceField: string; quote: string }> }> = {}) {
  return {
    text: overrides.text ?? "1行目のフック。\n\n本文の説明。\n\n締めの一言。",
    claims: overrides.claims ?? [{ sourceField: "summary", quote: "事例の概要テキスト" }],
  };
}

test("validateXPostDraft: 正常なJSON（claims付き・改行あり）はok", () => {
  const r = validateXPostDraft({ postA: validPost(), postB: validPost({ claims: [{ sourceField: "overview", quote: "背景・企画意図" }] }) }, ENTRY_FIELDS);
  assert.equal(r.ok, true);
});

test("validateXPostDraft: オブジェクトでなければ拒否", () => {
  const r = validateXPostDraft("not an object", ENTRY_FIELDS);
  assert.equal(r.ok, false);
});

test("validateXPostDraft: postA欠落は拒否", () => {
  const r = validateXPostDraft({ postB: validPost() }, ENTRY_FIELDS);
  assert.equal(r.ok, false);
});

test("validateXPostDraft: postB欠落は拒否", () => {
  const r = validateXPostDraft({ postA: validPost() }, ENTRY_FIELDS);
  assert.equal(r.ok, false);
});

test("validateXPostDraft: postA.textが空文字は拒否", () => {
  const r = validateXPostDraft({ postA: validPost({ text: "" }), postB: validPost() }, ENTRY_FIELDS);
  assert.equal(r.ok, false);
});

test("validateXPostDraft: 280文字超（加重）は拒否", () => {
  const long = "あ".repeat(141) + "\n\nダミー\n\n締め"; // 本体だけで加重282超
  const r = validateXPostDraft({ postA: validPost({ text: long }), postB: validPost() }, ENTRY_FIELDS);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /280文字を超えています/);
});

test("validateXPostDraft: 本文にURLがあれば拒否（postA）", () => {
  const r = validateXPostDraft(
    { postA: validPost({ text: "詳細はこちら https://example.com\n\n本文\n\n締め" }), postB: validPost() },
    ENTRY_FIELDS,
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /URL/);
});

test("validateXPostDraft: 本文にURLがあれば拒否（postB）", () => {
  const r = validateXPostDraft(
    { postA: validPost(), postB: validPost({ text: "詳細はこちら https://example.com\n\n本文\n\n締め" }) },
    ENTRY_FIELDS,
  );
  assert.equal(r.ok, false);
});

test("validateXPostDraft: 改行が2箇所未満（壁テキスト）は拒否", () => {
  const r = validateXPostDraft({ postA: validPost({ text: "改行が無い一文だけです" }), postB: validPost() }, ENTRY_FIELDS);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /改行/);
});

test("validateXPostDraft: 改行がちょうど2箇所（3ブロック）ならok", () => {
  const r = validateXPostDraft({ postA: validPost({ text: "フック\n\n本文\n\n締め" }), postB: validPost() }, ENTRY_FIELDS);
  assert.equal(r.ok, true);
});

test("validateXPostDraft: claimsが空配列なら拒否（事実の裏付けが無い）", () => {
  const r = validateXPostDraft({ postA: validPost({ claims: [] }), postB: validPost() }, ENTRY_FIELDS);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /claims/);
});

test("validateXPostDraft: claimsが欠落（配列でない）なら拒否", () => {
  const r = validateXPostDraft({ postA: { text: "フック\n\n本文\n\n締め" }, postB: validPost() }, ENTRY_FIELDS);
  assert.equal(r.ok, false);
});

test("validateXPostDraft: claimsのsourceFieldが事実データに存在しなければ拒否", () => {
  const r = validateXPostDraft(
    { postA: validPost({ claims: [{ sourceField: "nonexistentField", quote: "何か" }] }), postB: validPost() },
    ENTRY_FIELDS,
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /事実データに存在しません/);
});

test("validateXPostDraft: claimsのquoteが原文に存在しない（捏造）なら拒否", () => {
  const r = validateXPostDraft(
    { postA: validPost({ claims: [{ sourceField: "summary", quote: "存在しない架空の引用文" }] }), postB: validPost() },
    ENTRY_FIELDS,
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /見つかりません|捏造/);
});

test("validateXPostDraft: quoteの改行・空白の差異は正規化して許容する", () => {
  const fieldsWithNewline = { summary: "これは\n複数行に\nまたがる概要です。" };
  const r = validateXPostDraft(
    { postA: validPost({ claims: [{ sourceField: "summary", quote: "複数行に またがる概要" }] }), postB: validPost({ claims: [{ sourceField: "summary", quote: "複数行に またがる概要" }] }) },
    fieldsWithNewline,
  );
  assert.equal(r.ok, true);
});

// ── buildSelfReplyBubbleText（paste-ready。DESIGN案内文を含めない） ───────────

test("buildSelfReplyBubbleText: RMページURLのみ（動画・出典なし）", () => {
  const text = buildSelfReplyBubbleText({ rmUrl: "https://research-man.vercel.app/cases/foo" });
  assert.equal(text, "詳しくはこちら\nhttps://research-man.vercel.app/cases/foo");
});

test("buildSelfReplyBubbleText: 動画があれば「公式動画」ラベル付きで追加される（案内文は含めない）", () => {
  const text = buildSelfReplyBubbleText({
    rmUrl: "https://research-man.vercel.app/cases/foo",
    videoUrl: "https://www.youtube.com/watch?v=abc123",
  });
  assert.equal(text, "詳しくはこちら\nhttps://research-man.vercel.app/cases/foo\n公式動画\nhttps://www.youtube.com/watch?v=abc123");
  assert.doesNotMatch(text, /ダウンロード|転載|メモ/);
});

test("buildSelfReplyBubbleText: 動画が無く出典があれば「出典」ラベル付きで追加される", () => {
  const text = buildSelfReplyBubbleText({
    rmUrl: "https://research-man.vercel.app/cases/foo",
    sourceUrl: "https://example.com/article",
  });
  assert.equal(text, "詳しくはこちら\nhttps://research-man.vercel.app/cases/foo\n出典\nhttps://example.com/article");
});

test("buildSelfReplyBubbleText: 動画と出典の両方があれば動画を優先し出典は表示しない", () => {
  const text = buildSelfReplyBubbleText({
    rmUrl: "https://research-man.vercel.app/cases/foo",
    sourceUrl: "https://example.com/article",
    videoUrl: "https://www.youtube.com/watch?v=abc123",
  });
  assert.doesNotMatch(text, /出典/);
  assert.match(text, /公式動画/);
});

test("buildSelfReplyBubbleText: 画像省略の注記や運用メモを含まない（paste-ready）", () => {
  const text = buildSelfReplyBubbleText({ rmUrl: "https://research-man.vercel.app/cases/foo" });
  assert.doesNotMatch(text, /サムネイル|メモ/);
});

// ── buildMetaBubbleText（📝メモ。投稿には含めない運用ガイダンス専用） ─────────

test("buildMetaBubbleText: 動画も画像省略も無ければnull（メモ吹き出し自体を作らない）", () => {
  assert.equal(buildMetaBubbleText({ rmUrl: "https://research-man.vercel.app/cases/foo" }, false), null);
});

test("buildMetaBubbleText: 動画があればダウンロード・転載禁止のガイダンスを含む", () => {
  const text = buildMetaBubbleText({ rmUrl: "https://research-man.vercel.app/cases/foo", videoUrl: "https://youtu.be/abc" }, false);
  assert.match(text ?? "", /^📝メモ（投稿には含めない）/);
  assert.match(text ?? "", /ダウンロード|転載/);
});

test("buildMetaBubbleText: 画像省略ありなら注記を含む", () => {
  const text = buildMetaBubbleText({ rmUrl: "https://research-man.vercel.app/cases/foo" }, true);
  assert.match(text ?? "", new RegExp(IMAGE_OMITTED_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("buildMetaBubbleText: 動画・画像省略の両方があれば両方を1つの吹き出しにまとめる", () => {
  const text = buildMetaBubbleText({ rmUrl: "https://research-man.vercel.app/cases/foo", videoUrl: "https://youtu.be/abc" }, true);
  assert.match(text ?? "", /ダウンロード|転載/);
  assert.match(text ?? "", new RegExp(IMAGE_OMITTED_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// ── buildXPostBubbles ──────────────────────────────────────────────────

const DRAFT = { postA: "A", postB: "B" };

test("buildXPostBubbles: 画像あり・動画なしなら4吹き出し（メモ無し）", () => {
  const messages = buildXPostBubbles(
    DRAFT,
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

test("buildXPostBubbles: includeImage=falseなら画像を省略し、末尾にメモ吹き出しが付く（4吹き出し）", () => {
  const messages = buildXPostBubbles(
    DRAFT,
    { rmUrl: "https://research-man.vercel.app/cases/foo", thumbnailUrl: "https://research-man.vercel.app/thumbnails/foo.jpg" },
    false,
  );
  assert.equal(messages.length, 4);
  assert.equal(messages.some((m) => m.type === "image"), false);
  const last = messages[3];
  assert.equal(last.type, "text");
  if (last.type === "text") assert.match(last.text, /^📝メモ（投稿には含めない）/);
});

test("buildXPostBubbles: thumbnailUrl未指定でも画像省略のメモ吹き出しが付く", () => {
  const messages = buildXPostBubbles(DRAFT, { rmUrl: "https://research-man.vercel.app/cases/foo" }, true);
  assert.equal(messages.length, 4);
});

test("buildXPostBubbles: 動画があり画像も含む場合は動画メモ吹き出しが付く（5吹き出し）", () => {
  const messages = buildXPostBubbles(
    DRAFT,
    {
      rmUrl: "https://research-man.vercel.app/cases/foo",
      videoUrl: "https://youtu.be/abc123",
      thumbnailUrl: "https://research-man.vercel.app/thumbnails/foo.jpg",
    },
    true,
  );
  assert.equal(messages.length, 5);
  assert.equal(messages[2].type, "text");
  if (messages[2].type === "text") assert.match(messages[2].text, /公式動画/);
  assert.equal(messages[3].type, "image");
  assert.equal(messages[4].type, "text");
  if (messages[4].type === "text") assert.match(messages[4].text, /^📝メモ（投稿には含めない）/);
});

test("buildXPostBubbles: 画像が無い（thumbnailUrl未指定）場合もincludeImage=falseと同様にメモ吹き出しが付く", () => {
  // showImage=falseになる限り常にimageOmittedノートを付ける仕様（thumbnailUrlの有無を
  // 問わない）。「画像がそもそも無かった」場合と「HEAD確認に失敗した」場合を呼び出し側で
  // 区別する情報を持たないため、どちらも同じ注記で統一している。
  const messages = buildXPostBubbles(DRAFT, { rmUrl: "https://research-man.vercel.app/cases/foo" }, false);
  assert.equal(messages.length, 4);
});

test("buildXPostBubbles: 常に5件以下に切り詰める", () => {
  const messages = buildXPostBubbles(
    DRAFT,
    {
      rmUrl: "https://research-man.vercel.app/cases/foo",
      videoUrl: "https://youtu.be/abc123",
      thumbnailUrl: "https://research-man.vercel.app/thumbnails/foo.jpg",
    },
    true,
  );
  assert.ok(messages.length <= 5);
});
