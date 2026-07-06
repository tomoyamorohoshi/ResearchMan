/**
 * 3Dグラフ用の縮小サムネイル生成。
 * Case: public/thumbnails/{id}.jpg → public/thumbnails-graph/{id}.jpg
 * Tech: public/thumbnails/tech/{id}(-kv).jpg → public/thumbnails-graph/tech/{id}.jpg
 * （いずれも256x256 cover, jpeg q60 mozjpeg。出力ファイル名は入力ファイル名でなく常に自身のid）
 * - 出力が存在し mtime が入力以上ならスキップ（差分生成・冪等）。--force で全再生成
 * - 入力実体が無い事例/技術は警告してスキップ（欠落検出は audit:thumbnails / audit:tech の責務）
 * 使い方: npm run thumbs:graph [-- --force]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const FORCE = process.argv.includes("--force");
const CHUNK_SIZE = 8;

async function processChunk(items, outDir, thumbPrefix) {
  return Promise.all(
    items.map(async (item) => {
      const t = item.thumbnail || "";
      if (!t.startsWith(thumbPrefix)) return { status: "skip" };
      const srcPath = path.join(ROOT, "public" + t);
      const outPath = path.join(outDir, `${item.id}.jpg`);

      if (!fs.existsSync(srcPath)) {
        console.log(`⚠ MISSING source: ${item.id} (${t})`);
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

async function generateFor(label, dataFile, outDir, thumbPrefix) {
  const items = JSON.parse(fs.readFileSync(path.join(ROOT, dataFile), "utf8"));
  fs.mkdirSync(outDir, { recursive: true });
  let generated = 0;
  let skipped = 0;
  let missing = 0;
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const results = await processChunk(chunk, outDir, thumbPrefix);
    for (const r of results) {
      if (r.status === "generated") generated++;
      else if (r.status === "skip") skipped++;
      else if (r.status === "missing") missing++;
    }
  }
  console.log(`[${label}] generated ${generated} / skipped ${skipped} / missing ${missing}`);
}

(async () => {
  await generateFor("cases", "data/cases.json", path.join(ROOT, "public/thumbnails-graph"), "/thumbnails/");
  await generateFor("tech", "data/tech.json", path.join(ROOT, "public/thumbnails-graph/tech"), "/thumbnails/tech/");
  process.exit(0);
})();
