/**
 * LINEリッチメニュー用の画像（2500x843px、横5等分）を生成するスクリプト。
 *
 * 2026-09-27フォローアップ: 実際に本番登録済みの画像（暖色系オフホワイト背景・細い
 * ベージュの縦区切り線・ネイビーの細いラインアイコン・太字の日本語ラベル＋グレーの
 * 英語サブタイトル）を確認できたため、そのスタイルを再現する。アイコンはLucide
 * （MITライセンスのラインアイコンセット。stroke-basedの24x24 viewBox）のパスを
 * SVGへ直接埋め込み、同じ描画スタイル（線のみ・角丸キャップ）で再現する
 * （search=事例調査/sun=技術調査/trophy=AWARDS/sparkles=アイデア出し/
 * send（紙飛行機。Xブランドロゴは使わない）=X投稿）。
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

const BG_COLOR = "#F1EEE6";
const DIVIDER_COLOR = "#DCD5C2";
const NAVY = "#1B2440";
const SUBTITLE_GREY = "#9C9484";

// Lucide（MITライセンス）のラインアイコンをそのまま埋め込む（24x24 viewBox、stroke-based）。
// scripts/setup-line-richmenu.mjs::BUTTON_LABELS と必ず一致させること。
const BUTTONS = [
  {
    label: "事例調査",
    subtitle: "Case Study",
    // lucide "search"
    icon: `<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`,
  },
  {
    label: "技術調査",
    subtitle: "Technology",
    // lucide "sun"
    icon: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>`,
  },
  {
    label: "AWARDS",
    subtitle: "Award Research",
    // lucide "trophy"
    icon: `<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>`,
  },
  {
    label: "アイデア出し",
    subtitle: "Ideas",
    // lucide "sparkles"
    icon: `<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>`,
  },
  {
    label: "X投稿",
    subtitle: "X Post",
    // lucide "send"（紙飛行機。Xブランドロゴは使わない — レビュー指摘）
    icon: `<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>`,
  },
];

// 24x24 viewBoxのLucideアイコンを、各カラム中央に約ICON_RENDER_SIZEpxで配置するスケール。
const ICON_VIEWBOX = 24;
const ICON_RENDER_SIZE = 130;
const ICON_SCALE = ICON_RENDER_SIZE / ICON_VIEWBOX;
const ICON_STROKE_WIDTH_SOURCE = 1.4; // 24単位系でのstroke-width（Lucide既定の2よりやや細くして「thin-stroke」に寄せる）

// レイアウト基準座標（2026-09-27フォローアップ: live-richmenu.pngの実測に合わせて再調整。
// 2500x843スケールでアイコン中心≈y285・日本語ラベルベースライン中心≈y470・
// 英語サブタイトル≈y600＝ブロック全体が縦方向中央寄りになるよう配置する）。
const ICON_CENTER_Y = 285;
const LABEL_BASELINE_Y = 470;
const SUBTITLE_BASELINE_Y = 600;
// レビュー指摘: 「アイデア出し」が500px幅のカラムで左右each ≥24pxの余白を保てる範囲で
// 日本語ラベルのfont-sizeを最大化する（live版は今回の初版より大きい字面だったため）。
const LABEL_MARGIN_X = 24;

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 全カラム共通の日本語ラベルfont-sizeを、最長ラベルが500px幅のカラムに左右≥24pxの余白を
 * 保ったまま収まる最大値として逆算する（レビュー指摘: 1カラムだけ縮小/拡大するのではなく
 * 全カラム統一のサイズにする）。太字日本語（全角）1文字あたりの実測相当幅をfont-sizeの
 * 約0.98倍として概算する。
 */
function computeUniformLabelFontSize() {
  const maxChars = Math.max(...BUTTONS.map((b) => [...b.label].length));
  const available = COL_WIDTH - LABEL_MARGIN_X * 2;
  const perCharWidthRatio = 0.98;
  return Math.floor(available / (maxChars * perCharWidthRatio));
}

const LABEL_FONT_SIZE = computeUniformLabelFontSize();

function buildSvg() {
  const columns = BUTTONS.map((btn, i) => {
    const x = i * COL_WIDTH;
    const cx = x + COL_WIDTH / 2;
    const iconX = cx - ICON_RENDER_SIZE / 2;
    const iconY = ICON_CENTER_Y - ICON_RENDER_SIZE / 2;
    return `
      <g>
        <g transform="translate(${iconX}, ${iconY}) scale(${ICON_SCALE})" fill="none" stroke="${NAVY}" stroke-width="${ICON_STROKE_WIDTH_SOURCE}" stroke-linecap="round" stroke-linejoin="round">
          ${btn.icon}
        </g>
        <text x="${cx}" y="${LABEL_BASELINE_Y}" text-anchor="middle" font-size="${LABEL_FONT_SIZE}" font-weight="700" fill="${NAVY}" font-family="'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif">${escapeXml(btn.label)}</text>
        <text x="${cx}" y="${SUBTITLE_BASELINE_Y}" text-anchor="middle" font-size="30" letter-spacing="3" fill="${SUBTITLE_GREY}" font-family="'Helvetica Neue',Arial,sans-serif">${escapeXml(btn.subtitle)}</text>
      </g>`;
  }).join("\n");

  const dividers = Array.from({ length: COLS - 1 }, (_, i) => {
    const x = (i + 1) * COL_WIDTH;
    return `<line x1="${x}" y1="0" x2="${x}" y2="${HEIGHT}" stroke="${DIVIDER_COLOR}" stroke-width="2" />`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="${BG_COLOR}" />
    ${columns}
    ${dividers}
  </svg>`;
}

async function main() {
  const svg = buildSvg();
  const outputs = [OUT_PATH];
  const extraOut = argOf("--also", null);
  if (extraOut) outputs.push(extraOut);

  for (const out of outputs) {
    await fs.promises.mkdir(path.dirname(out), { recursive: true });
    await sharp(Buffer.from(svg)).png().toFile(out);
    console.log(`[generate-line-richmenu-image] 生成しました: ${out} (${WIDTH}x${HEIGHT}, ${COLS}等分, labelFontSize=${LABEL_FONT_SIZE})`);
  }
}

main().catch((err) => {
  console.error("[generate-line-richmenu-image] 失敗", err);
  process.exitCode = 1;
});
