/**
 * 3Dグラフ用の縮小サムネイル生成。
 * public/thumbnails/{id}.jpg → public/thumbnails-graph/{id}.jpg（256x256 cover, jpeg q60 mozjpeg）
 * - 出力が存在し mtime が入力以上ならスキップ（差分生成・冪等）。--force で全再生成
 * - 入力実体が無い事例は警告してスキップ（欠落検出は audit:thumbnails の責務）
 * 使い方: npm run thumbs:graph [-- --force]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public/thumbnails-graph");
const FORCE = process.argv.includes("--force");

const cases = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cases.json"), "utf8"));
fs.mkdirSync(OUT_DIR, { recursive: true });

async function processChunk(items) {
  return Promise.all(
    items.map(async (c) => {
      const t = c.thumbnail || "";
      if (!t.startsWith("/thumbnails/")) return { status: "skip" };
      const srcPath = path.join(ROOT, "public" + t);
      const outPath = path.join(OUT_DIR, `${c.id}.jpg`);

      if (!fs.existsSync(srcPath)) {
        console.log(`⚠ MISSING source: ${c.id} (${t})`);
        return { status: "missing" };
      }
      if (!FORCE && fs.existsSync(outPath)) {
        const srcMtime = fs.statSync(srcPath).mtimeMs;
        const outMtime = fs.statSync(outPath).mtimeMs;
        if (outMtime >= srcMtime) return { status: "skip" };
      }
      await sharp(srcPath)
        .resize(256, 256, { fit: "cover" })
        .jpeg({ quality: 60, mozjpeg: true })
        .toFile(outPath);
      return { status: "generated" };
    }),
  );
}

const CHUNK_SIZE = 8;
let generated = 0;
let skipped = 0;
let missing = 0;

(async () => {
  for (let i = 0; i < cases.length; i += CHUNK_SIZE) {
    const chunk = cases.slice(i, i + CHUNK_SIZE);
    const results = await processChunk(chunk);
    for (const r of results) {
      if (r.status === "generated") generated++;
      else if (r.status === "skip") skipped++;
      else if (r.status === "missing") missing++;
    }
  }
  console.log(`\ngenerated ${generated} / skipped ${skipped} / missing ${missing}`);
  process.exit(missing > 0 ? 0 : 0);
})();
