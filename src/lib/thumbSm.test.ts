// 一覧カード用縮小サムネ（/thumbnails-sm/*.webp）のパス組み立て・フォールバック判定の単体テスト。
// 実行: npx tsx --test src/lib/thumbSm.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { smThumbnailPath, pickThumbnailSrc } from "./thumbSm";

test("/thumbnails/<name>.jpg は /thumbnails-sm/<name>.webp になる", () => {
  assert.equal(smThumbnailPath("/thumbnails/abba-voyage.jpg"), "/thumbnails-sm/abba-voyage.webp");
});

test("大文字拡張子・jpeg も対応する", () => {
  assert.equal(smThumbnailPath("/thumbnails/a.JPG"), "/thumbnails-sm/a.webp");
  assert.equal(smThumbnailPath("/thumbnails/a.jpeg"), "/thumbnails-sm/a.webp");
});

test("サブディレクトリ（tech/exhibition）・外部URL・空・別接頭辞は null（縮小版なし）", () => {
  assert.equal(smThumbnailPath("/thumbnails/tech/x.jpg"), null);
  assert.equal(smThumbnailPath("/thumbnails/exhibition/x.jpg"), null);
  assert.equal(smThumbnailPath("https://example.com/a.jpg"), null);
  assert.equal(smThumbnailPath("/thumbnails-graph/a.jpg"), null);
  assert.equal(smThumbnailPath(""), null);
  assert.equal(smThumbnailPath(undefined), null);
});

test("jpg/jpeg 以外の拡張子は null", () => {
  assert.equal(smThumbnailPath("/thumbnails/a.png"), null);
});

test("pickThumbnailSrc: 通常は縮小版、失敗後は元画像", () => {
  assert.equal(pickThumbnailSrc("/thumbnails/a.jpg", false), "/thumbnails-sm/a.webp");
  assert.equal(pickThumbnailSrc("/thumbnails/a.jpg", true), "/thumbnails/a.jpg");
});

test("pickThumbnailSrc: 縮小版が定義できないパスは常に元画像", () => {
  assert.equal(pickThumbnailSrc("/thumbnails/tech/x.jpg", false), "/thumbnails/tech/x.jpg");
  assert.equal(pickThumbnailSrc("https://e.com/a.jpg", false), "https://e.com/a.jpg");
});
