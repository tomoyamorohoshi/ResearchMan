// scripts/lib/thumbnail-constraints.mjs の単体テスト（node:test）。
// 2026-08-07 pre-push 8日間ブロック障害の再発防止テスト:
// 正規化前は閾値を超えていても、正規化（幅上限リサイズ＋JPEG再エンコード）後に
// 閾値未満へ縮小したバッファは採用してはならない（= null を返す）ことを検証する。
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { MIN_THUMB_BYTES, normalizeAndEnforceMinBytes } from "./thumbnail-constraints.mjs";

/** ノイズ画素からJPEGバッファを生成する（フラットカラーだと圧縮でサイズ予測がぶれるため）。 */
async function makeNoiseJpeg(width, height, quality = 100) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer();
}

/** 単色に近い（=再エンコードで大きく縮む）画像バッファを生成する。 */
async function makeFlatJpeg(width, height, quality = 100) {
  const raw = Buffer.alloc(width * height * 3, 10); // ほぼ単色（黒に近いグレー）
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer();
}

// maskvidexperiments.jpg実例の再現用: 単色領域が多い画像は quality100 JPEG では
// MIN_THUMB_BYTESを超えていても、正規化(quality80 mozjpeg再エンコード)で大きく縮む。
const FLAT_DIMENSION = 1600;

test("MIN_THUMB_BYTES は 5000（audit-tech.mjs の閾値と同一）", () => {
  assert.equal(MIN_THUMB_BYTES, 5000);
});

test("normalizeAndEnforceMinBytes: 正規化後も閾値以上なら正規化済みバッファを返す", async () => {
  const buf = await makeNoiseJpeg(300, 300);
  const result = await normalizeAndEnforceMinBytes(buf);
  assert.ok(result, "正規化後バッファが返るはず");
  assert.ok(result.length >= MIN_THUMB_BYTES);
});

test("normalizeAndEnforceMinBytes: 正規化前は閾値を超えていても、正規化後に閾値未満へ縮小した場合はnullを返す（再発防止）", async () => {
  // 単色に近い画像は、正規化前(quality100)は閾値を超えていても、正規化(quality80
  // mozjpeg再エンコード)後に大きく縮むことがある（maskvidexperiments.jpg実例の再現）。
  const raw = await makeFlatJpeg(FLAT_DIMENSION, FLAT_DIMENSION, 100);
  // 前提: 正規化前は閾値を超えている（そうでないとテストの意図が成立しない）
  assert.ok(raw.length >= MIN_THUMB_BYTES, `テスト前提: raw(${raw.length}B) >= ${MIN_THUMB_BYTES}B`);

  // 正規化後は極端に小さくなることを、意図的に高いminBytesを指定して確認する
  // （実運用のMIN_THUMB_BYTESより厳しい閾値を使い、正規化後サイズが閾値未満になる状況を再現）
  const normalizedOnly = await normalizeAndEnforceMinBytes(raw, 0);
  const strictThreshold = normalizedOnly.length + 1; // 正規化後サイズよりわずかに大きい閾値
  const result = await normalizeAndEnforceMinBytes(raw, strictThreshold);
  assert.equal(result, null, "正規化後に閾値未満へ縮小したバッファは不採用（null）であるべき");
});

test("normalizeAndEnforceMinBytes: bufがnull/undefinedならnullを返す", async () => {
  assert.equal(await normalizeAndEnforceMinBytes(null), null);
  assert.equal(await normalizeAndEnforceMinBytes(undefined), null);
});
