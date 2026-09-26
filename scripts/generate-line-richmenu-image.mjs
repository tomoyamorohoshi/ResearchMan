/**
 * LINEリッチメニュー用の画像（2500x843px、横5等分）を生成するスクリプト。
 *
 * 背景: 既存のリッチメニュー画像はリポジトリに一度も存在しておらず（scripts/setup-line-richmenu.mjs
 * は --image 引数で外部から与えられた画像を送信するだけで、画像生成自体はこのスクリプトの
 * 責務外だった）、手作業で用意されたものと推測される。実物のスタイルを確認する手段が無いため、
 * 本スクリプトは studio/server/line/messages.ts::buildMenuText の絵文字番号
 * （1️⃣2️⃣3️⃣4️⃣5️⃣）と揃えたシンプルなフラットカラー＋白文字ラベルのデザインで新規生成する
 * （5ボタン: 事例調査/技術調査/AWARDS/アイデア出し/X投稿。scripts/setup-line-richmenu.mjs の
 * BUTTON_LABELSと必ず一致させること）。
 *
 * 依存追加はしない（package.jsonに既にある devDependency の sharp を使う。SVG→PNGラスタライズ）。
 *
 * 使い方:
 *   node scripts/generate-line-richmenu-image.mjs --out path/to/richmenu.png
 *   （既定の出力先は studio/workdir/richmenu.png。workdir/はgit管理外のため、生成のたびに
 *   同じ場所へ書き出せば運用手順は変わらない）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "studio", "workdir", "richmenu.png");

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const OUT_PATH = argOf("--out", DEFAULT_OUT);

const WIDTH = 2500;
const HEIGHT = 843;
const COLS = 5;
const COL_WIDTH = WIDTH / COLS;

// scripts/setup-line-richmenu.mjs::BUTTON_LABELS と必ず一致させること。
const BUTTONS = [
  { emoji: "1\u{FE0F}\u{20E3}", label: "事例調査", color: "#2563eb" },
  { emoji: "2\u{FE0F}\u{20E3}", label: "技術調査", color: "#0891b2" },
  { emoji: "3\u{FE0F}\u{20E3}", label: "AWARDS", color: "#d97706" },
  { emoji: "4\u{FE0F}\u{20E3}", label: "アイデア出し", color: "#7c3aed" },
  { emoji: "5\u{FE0F}\u{20E3}", label: "X投稿", color: "#111827" },
];

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSvg() {
  const columns = BUTTONS.map((btn, i) => {
    const x = i * COL_WIDTH;
    const cx = x + COL_WIDTH / 2;
    const cy = HEIGHT / 2;
    return `
      <g>
        <rect x="${x}" y="0" width="${COL_WIDTH}" height="${HEIGHT}" fill="${btn.color}" />
        <text x="${cx}" y="${cy - 40}" text-anchor="middle" font-size="110" font-family="'Noto Color Emoji','Apple Color Emoji','Segoe UI Emoji',sans-serif">${btn.emoji}</text>
        <text x="${cx}" y="${cy + 90}" text-anchor="middle" font-size="72" font-weight="700" fill="#ffffff" font-family="'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif">${escapeXml(btn.label)}</text>
      </g>`;
  }).join("\n");

  const dividers = Array.from({ length: COLS - 1 }, (_, i) => {
    const x = (i + 1) * COL_WIDTH;
    return `<line x1="${x}" y1="0" x2="${x}" y2="${HEIGHT}" stroke="#ffffff" stroke-opacity="0.25" stroke-width="4" />`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    ${columns}
    ${dividers}
  </svg>`;
}

async function main() {
  const svg = buildSvg();
  await fs.promises.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(OUT_PATH);
  console.log(`[generate-line-richmenu-image] 生成しました: ${OUT_PATH} (${WIDTH}x${HEIGHT}, ${COLS}等分)`);
}

main().catch((err) => {
  console.error("[generate-line-richmenu-image] 失敗", err);
  process.exitCode = 1;
});
