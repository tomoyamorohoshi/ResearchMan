// ISR Reads削減対応（2026-07-19）。ビルド前（npm lifecycleの"prebuild"）に、ページ埋め込み
// (RSCペイロード)ではなく public/data/ 配下の静的アセットとしてクライアントfetch可能な形で
// 巨大JSONを書き出す。public/配下の静的アセット配信はVercelのISR Reads課金対象外だが、
// ページのHTML/RSCペイロードに丸ごと埋め込まれるとISR Reads(耐久キャッシュからの読み出し量)
// として課金される。data/cases.json(2MB)・data/ideas.json(183KB)・data/idea-layouts.json
// (14.5MB)がその埋め込みの主犯だったため、ここでビルド時に一度だけ public/data/ へコピーし、
// クライアント側(GalleryClient.tsx/IdeasPoster.tsx)はmount後にfetchする設計に変える。
// data/*.json 自体は変更しない（読み取り専用）。
// 使い方: node scripts/prepare-public-data.mjs （package.jsonの"prebuild"から自動実行される）
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUT_DIR = path.join(ROOT, "public", "data");

fs.mkdirSync(OUT_DIR, { recursive: true });

function writeJson(outName, data) {
  const outPath = path.join(OUT_DIR, outName);
  const text = JSON.stringify(data);
  fs.writeFileSync(outPath, text);
  console.log(`✓ ${outName}: ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB → ${outPath}`);
}

// cases.json: src/lib/cases.ts の現行フィルタ（quarantined===trueを除外）と同じロジック
const casesData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "cases.json"), "utf8"));
const publicCases = casesData.filter((c) => !c.quarantined);
writeJson("cases.json", publicCases);

// ideas.json: フィルタ・ソート不要（そのままコピー。ソートはクライアント側のsortIdeasで行う）
const ideasData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "ideas.json"), "utf8"));
writeJson("ideas.json", ideasData);

// idea-layouts.json: そのままコピー
const ideaLayoutsData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "idea-layouts.json"), "utf8"));
writeJson("idea-layouts.json", ideaLayoutsData);

console.log("✓ public/data/ の準備完了");
