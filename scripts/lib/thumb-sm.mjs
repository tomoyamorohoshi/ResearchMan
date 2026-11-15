// 一覧カード用縮小サムネ生成（public/thumbnails/<name>.jpg → public/thumbnails-sm/<name>.webp）。
// パス規則は src/lib/thumbSm.ts と同じ（直下の jpg/jpeg のみ）。
import fs from "fs";
import path from "path";
import sharp from "sharp";

// Windows では sharp がファイルを開いたまま保持して上書き rename が EPERM になるため、ファイルキャッシュを切る
sharp.cache(false);

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

/** Windows の一時的な EPERM/EBUSY に備え数回リトライする rename。 */
function renameWithRetry(from, to, tries = 5) {
  for (let i = 0; ; i++) {
    try { return fs.renameSync(from, to); } catch (e) {
      if (i >= tries - 1 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1));
    }
  }
}

/** 1枚生成。一時ファイルに書いてから rename（書き込み途中の壊れたファイルを残さない）。 */
export async function buildSmThumb(srcPath, outPath) {
  const tmp = `${outPath}.${process.pid}.${Date.now()}.tmp.webp`;
  try {
    await sharp(srcPath)
      .rotate()
      .resize({ width: SM_WIDTH, withoutEnlargement: true })
      .webp({ quality: SM_WEBP_QUALITY })
      .toFile(tmp);
    renameWithRetry(tmp, outPath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

/**
 * 元画像を保存・上書きした経路から呼ぶ。縮小版を作り直す（成否は戻り値。例外は外に出さない）。
 * 元画像の保存処理の成否には影響させないこと。
 */
export async function ensureSmThumb(srcPath, outDir) {
  try {
    const outName = smFileName(path.basename(srcPath));
    if (!outName) return false;
    fs.mkdirSync(outDir, { recursive: true });
    await buildSmThumb(srcPath, path.join(outDir, outName));
    return true;
  } catch (e) {
    console.warn(`[thumbs-sm] WARN 縮小版の生成に失敗（元画像へフォールバック）: ${path.basename(srcPath)}: ${e.message}`);
    return false;
  }
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
