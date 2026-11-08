// 画像としてデコードできないサムネ（HTML等）の検出ヘルパーのテスト。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import { isDecodableImageFile } from "./thumbnail-decodable.mjs";

test("isDecodableImageFile: 実JPEGはtrue、HTML/空/欠落ファイルはfalse", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "decodable-"));
  try {
    const good = path.join(dir, "good.jpg");
    await fs.writeFile(good, await sharp({ create: { width: 8, height: 8, channels: 3, background: "#f00" } }).jpeg().toBuffer());
    const html = path.join(dir, "html.jpg");
    await fs.writeFile(html, "<!DOCTYPE html><html></html>");
    const empty = path.join(dir, "empty.jpg");
    await fs.writeFile(empty, "");
    assert.equal(await isDecodableImageFile(good), true);
    assert.equal(await isDecodableImageFile(html), false);
    assert.equal(await isDecodableImageFile(empty), false);
    assert.equal(await isDecodableImageFile(path.join(dir, "none.jpg")), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
