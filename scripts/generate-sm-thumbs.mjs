/**
 * 一覧カード用の縮小サムネ生成（幅480px・WebP）。
 * public/thumbnails/{id}.jpg → public/thumbnails-sm/{id}.webp
 * - 縮小版が無い、または元画像の方が新しいものだけ作る（冪等）。--force で全再生成
 * - --missing-only: 縮小版が無いものだけ作る（prebuild 用。git checkout では mtime が揃わないため）
 * - --root <dir>: プロジェクトルートの差し替え（テスト用）
 * 使い方: npm run thumbs:sm [-- --force | --missing-only]
 * どんな失敗（sharp の import 失敗・ディレクトリ欠落含む）でも警告だけで exit 0
 * （一覧は元画像へフォールバックするため、ビルドを止めない）
 */
import path from "path";
import { fileURLToPath } from "url";

try {
  const { generateSmThumbs } = await import("./lib/thumb-sm.mjs");
  const argv = process.argv;
  const ri = argv.indexOf("--root");
  const ROOT = ri >= 0 ? path.resolve(argv[ri + 1]) : path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const r = await generateSmThumbs({
    srcDir: path.join(ROOT, "public/thumbnails"),
    outDir: path.join(ROOT, "public/thumbnails-sm"),
    force: argv.includes("--force"),
    missingOnly: argv.includes("--missing-only"),
  });
  console.log(`[thumbs-sm] generated ${r.generated} / targets ${r.total} / failed ${r.failed.length}`);
  for (const f of r.failed) console.log(`⚠ ${f}`);
} catch (e) {
  console.log(`⚠ [thumbs-sm] 縮小版の生成をスキップ（元画像へフォールバック）: ${e?.message ?? e}`);
}
process.exit(0);
