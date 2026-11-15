// 縮小サムネ生成の「作り直し判定」「出力ファイル名」の単体テスト。
// 実行: node --test scripts/lib/thumb-sm.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { needsRebuild, smFileName } from "./thumb-sm.mjs";

test("縮小版が無ければ作る", () => {
  assert.equal(needsRebuild({ srcMtimeMs: 100, smMtimeMs: null }), true);
});

test("元画像が新しければ作り直す", () => {
  assert.equal(needsRebuild({ srcMtimeMs: 200, smMtimeMs: 100 }), true);
});

test("縮小版が同時刻以降ならスキップ（冪等）", () => {
  assert.equal(needsRebuild({ srcMtimeMs: 100, smMtimeMs: 100 }), false);
  assert.equal(needsRebuild({ srcMtimeMs: 100, smMtimeMs: 200 }), false);
});

test("force なら常に作る", () => {
  assert.equal(needsRebuild({ srcMtimeMs: 100, smMtimeMs: 200, force: true }), true);
});

test("missingOnly なら縮小版があれば元が新しくてもスキップ、無ければ作る", () => {
  assert.equal(needsRebuild({ srcMtimeMs: 200, smMtimeMs: 100, missingOnly: true }), false);
  assert.equal(needsRebuild({ srcMtimeMs: 200, smMtimeMs: null, missingOnly: true }), true);
});

test("smFileName: jpg/jpeg を .webp に", () => {
  assert.equal(smFileName("a-b.jpg"), "a-b.webp");
  assert.equal(smFileName("a.JPEG"), "a.webp");
  assert.equal(smFileName("a.png"), null);
});

// ── ensureSmThumb（保存経路から呼ぶ。例外を外に出さず、一時ファイル→rename で書く）──
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { ensureSmThumb } from "./thumb-sm.mjs";

async function makeJpg(file, w = 1200, color = "#c33") {
  await sharp({ create: { width: w, height: 800, channels: 3, background: color } }).jpeg().toFile(file);
}

test("ensureSmThumb: 縮小版を作り、幅480以下で一時ファイルを残さない", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sm-"));
  const src = path.join(d, "a.jpg");
  const outDir = path.join(d, "sm");
  await makeJpg(src);
  assert.equal(await ensureSmThumb(src, outDir), true);
  const meta = await sharp(path.join(outDir, "a.webp")).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 480);
  assert.deepEqual(fs.readdirSync(outDir), ["a.webp"]);
});

test("ensureSmThumb: 元画像の差し替えで縮小版も作り直される", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sm-"));
  const src = path.join(d, "a.jpg");
  const outDir = path.join(d, "sm");
  await makeJpg(src, 1200, "#ff0000");
  await ensureSmThumb(src, outDir);
  const before = await sharp(path.join(outDir, "a.webp")).stats();
  await makeJpg(src, 1200, "#0000ff");
  await ensureSmThumb(src, outDir);
  const after = await sharp(path.join(outDir, "a.webp")).stats();
  assert.ok(before.channels[0].mean > 200 && after.channels[0].mean < 60, "赤→青に更新される");
});

test("ensureSmThumb: 壊れた画像・存在しない元画像でも throw せず false、縮小版を残さない", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sm-"));
  const bad = path.join(d, "bad.jpg");
  fs.writeFileSync(bad, "not an image");
  const outDir = path.join(d, "sm");
  assert.equal(await ensureSmThumb(bad, outDir), false);
  assert.equal(await ensureSmThumb(path.join(d, "none.jpg"), outDir), false);
  assert.equal(fs.existsSync(outDir) ? fs.readdirSync(outDir).length : 0, 0);
});

test("ensureSmThumb: jpg 以外は何もしない(false)", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sm-"));
  assert.equal(await ensureSmThumb(path.join(d, "a.png"), path.join(d, "sm")), false);
});

test("generate-sm-thumbs.mjs: 入力ディレクトリ欠落などの失敗でも exit 0 で警告", () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "../generate-sm-thumbs.mjs");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sm-"));
  const r = spawnSync(process.execPath, [script, "--root", d], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout + r.stderr, /⚠|WARN|warn/);
});