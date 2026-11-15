// 一覧カード用縮小サムネ生成（public/thumbnails/<name>.jpg → public/thumbnails-sm/<name>.webp）。
// パス規則は src/lib/thumbSm.ts と同じ（直下の jpg/jpeg のみ）。
import fs from "fs";
import path from "path";
import sharp from "sharp";

export const SM_WIDTH = 480;
export const SM_WEBP_QUALITY = 70;

/** 出力ファイル名。jpg/jpeg 以外は null。 */
export function smFileName(name) {
  const m = /^(.+)\.jpe?g$/i.exec(name);
  return m ? `${m[1]}.webp` : null;
}

/** 作り直すか。smMtimeMs が null＝縮小版なし。missingOnly は「無いものだけ」（ビルド時用）。 */
export function needsRebuild({ srcMtimeMs, smMtimeMs, force = false, missingOnly = false }) {
  if (force) return true;
  if (smMtimeMs == null) return true;
  if (missingOnly) return false;
  return srcMtimeMs > smMtimeMs;
}

/** 1枚生成。 */
export async function buildSmThumb(srcPath, outPath) {
  await sharp(srcPath)
    .rotate()
    .resize({ width: SM_WIDTH, withoutEnlargement: true })
    .webp({ quality: SM_WEBP_QUALITY })
    .toFile(outPath);
}

/** srcDir 直下の jpg を走査し、必要な分だけ outDir に生成。 */
export async function generateSmThumbs({ srcDir, outDir, force = false, missingOnly = false, concurrency = 8 }) {
  fs.mkdirSync(outDir, { recursive: true });
  const jobs = [];
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    const outName = smFileName(ent.name);
    if (!outName) continue;
    const src = path.join(srcDir, ent.name);
    const out = path.join(outDir, outName);
    const smMtimeMs = fs.existsSync(out) ? fs.statSync(out).mtimeMs : null;
    if (needsRebuild({ srcMtimeMs: fs.statSync(src).mtimeMs, smMtimeMs, force, missingOnly })) jobs.push({ src, out, name: ent.name });
  }
  let generated = 0;
  const failed = [];
  for (let i = 0; i < jobs.length; i += concurrency) {
    await Promise.all(
      jobs.slice(i, i + concurrency).map(async (j) => {
        try {
          await buildSmThumb(j.src, j.out);
          generated++;
        } catch (e) {
          failed.push(`${j.name}: ${e.message}`);
        }
      }),
    );
  }
  return { generated, failed, total: jobs.length };
}
