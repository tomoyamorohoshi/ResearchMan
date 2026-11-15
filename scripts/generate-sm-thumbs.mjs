/**
 * 一覧カード用の縮小サムネ生成（幅480px・WebP）。
 * public/thumbnails/{id}.jpg → public/thumbnails-sm/{id}.webp
 * - 縮小版が無い、または元画像の方が新しいものだけ作る（冪等）。--force で全再生成
 * - --missing-only: 縮小版が無いものだけ作る（prebuild 用。git checkout では mtime が揃わないため）
 * 使い方: npm run thumbs:sm [-- --force | --missing-only]
 * 失敗しても exit 0（一覧は元画像へフォールバックするため、ビルドを止めない）
 */
import path from "path";
import { fileURLToPath } from "url";
import { generateSmThumbs } from "./lib/thumb-sm.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = await generateSmThumbs({
  srcDir: path.join(ROOT, "public/thumbnails"),
  outDir: path.join(ROOT, "public/thumbnails-sm"),
  force: process.argv.includes("--force"),
  missingOnly: process.argv.includes("--missing-only"),
});
console.log(`[thumbs-sm] generated ${r.generated} / targets ${r.total} / failed ${r.failed.length}`);
for (const f of r.failed) console.log(`⚠ ${f}`);
