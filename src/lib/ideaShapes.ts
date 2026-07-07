// /ideas ポスターUIの不定形シェイプ生成（DESIGN: goofy-hatching-mango.md）。
// 6→9種の生成器×hashId(idea.id)由来のシードで、決定論的に「同じ形でも1枚ごとに微妙に違う輪郭」を作る。
// Math.randomは使わない（mulberry32による純関数PRNGのみ）。同じidなら常に同じ結果 = リロードで変わらない。
//
// 座標系について: 各シェイプは自分の自然な縦横比に合ったviewBox（例: tallOvalは幅が狭い）を持つ。
// 全シェイプを共通の正方形viewBoxに詰めてCSS側でpreserveAspectRatio="none"により引き伸ばすと、
// SVG<text>のグリフまでX/Y非一様にスケールされ字が歪む。これを避けるため、カード外枠のCSS aspect-ratio
// をshape.aspect（=viewBoxW/viewBoxH）に一致させ、SVG側はデフォルトのxMidYMid meet（等倍scale）で
// 歪みなく収める設計にした。
//
// ============================================================================
// DESIGN差分（ユーザーフィードバック対応。goofy-hatching-mango.md 2026-07-07バッチ）:
// A: タイトルの「…」切り詰めを全廃。輪郭全周から低曲率の長い区間を選定して全文を辺沿いに流す
//    （縦走・斜め走可）。数学的保証（周長≥必要弧長）フォールバックあり。
// B: シェイプをBosmans級の複雑さへ（多葉・凹みのあるパズル的ブロブ/丸みのあるL・T字/
//    大きな切り欠きのある円形を過半に）。safeAreaは密サンプルベースの最大内接矩形探索。
// C/D: 密パッキング・ビビッド配色はIdeasPoster.tsx/ideas.ts側で対応（本ファイルは対象外）。
//
// 前回(5ac4e40)までの「浅い底辺弧限定＋省略記号」実装は全廃した。制約は「低曲率・滑らかな
// 連続性（ヘアピン・急な総回転なし）」のみとし、区間の向きは自由（縦・斜め可。Bosmans準拠）。
// ============================================================================
import { hashId } from "./graph";

export type ShapeKind =
  | "blob"
  | "polygon"
  | "waveRect"
  | "arch"
  | "tallOval"
  | "splat"
  | "multiLobe"
  | "lNotch"
  | "notchedCircle";

export const SHAPE_KINDS: readonly ShapeKind[] = [
  "blob",
  "polygon",
  "waveRect",
  "arch",
  "tallOval",
  "splat",
  "multiLobe",
  "lNotch",
  "notchedCircle",
];

// B: 複雑形（多葉・凹み・切り欠きのある形状）とみなす種。出現比率の重み付けと
// スモークテストの「過半が複雑形」アサートに使う
const COMPLEX_KINDS: ReadonlySet<ShapeKind> = new Set<ShapeKind>(["splat", "multiLobe", "lNotch", "notchedCircle"]);
export function isComplexShapeKind(kind: ShapeKind): boolean {
  return COMPLEX_KINDS.has(kind);
}

// 出現比率の重み。複雑形(4種)を単純形(5種)より高い重みにして「過半」を保証する
// (複雑形weight=3×4種=12 / 単純形weight=1×5種=5 → 複雑形出現率=12/17≈70.6%)
// A.1: goofy-hatching-mango.md 2026-07-07バッチ(コンテンツ量に応じたシェイプ割り当て)で、
// ideaCollageLayout.tsのassignShapeKindsが「満たせる種の候補集合」に同じ重み付けを適用する
// ためexportする
export const KIND_WEIGHT: Record<ShapeKind, number> = {
  blob: 1,
  polygon: 1,
  waveRect: 1,
  arch: 1,
  tallOval: 1,
  splat: 3,
  multiLobe: 3,
  lNotch: 3,
  notchedCircle: 3,
};
export const WEIGHTED_KIND_TABLE: readonly ShapeKind[] = SHAPE_KINDS.flatMap((k) =>
  Array<ShapeKind>(KIND_WEIGHT[k]).fill(k),
);

export type IdeaShape = {
  kind: ShapeKind;
  viewBoxW: number;
  viewBoxH: number;
  aspect: number; // viewBoxW / viewBoxH。カード外枠のCSS aspect-ratioに使う
  outlinePath: string; // 閉じたパス（fill用）
  dateArcPath: string; // 開いたパス（textPath用）
  titleArcPath: string; // 開いたパス（textPath用）
  dateArcLength: number; // dateArcPathの実長
  titleArcLength: number; // titleArcPathの実長
  dateFontSize: number; // 日付のフォントサイズ(px, viewBox座標系。曲率探索と同時に確定済み)
  titleFontSize: number; // タイトルのフォントサイズ(px, viewBox座標系)
  safeArea: { x: number; y: number; w: number; h: number }; // foreignObject安全領域
  // G: safeAreaを中心基準で上下に拡張してよい安全な上限の高さ（goofy-hatching-mango.md
  // 2026-07-07第4バッチ）。説明文の全文表示のためforeignObjectを拡張する際、この値を
  // 超えて拡張するとtitle/date弧との重なりや輪郭外へのはみ出しが起こりうる。growHeightSafely
  // (computeSafeArea内)がsafeAreaと同じ包含・クリアランス判定を使って安全に算出する
  safeAreaMaxGrowH: number;
  // 輪郭の実bbox外側の空白（viewBox座標系、上/右/下/左）。密サンプル済みの輪郭点(outlinePolygon)
  // から算出する決定論値。矩形の外箱(0..viewBoxW, 0..viewBoxH)いっぱいにシェイプが描かれるとは
  // 限らない（例: buildBlobは中心から不揃いに広がる有機形状で、外箱の四隅近くには余白が残る）。
  // goofy-hatching-mango.md 2026-07-07第3バッチまでは、この差分をIdeasPoster側のネガティブ
  // マージン+box拡大(growScale)で相殺していたが、CSS Gridはjustify-self側のマージンしか
  // 実際には効かないため近接度が不十分だった(実測: 中央値120px)。第4バッチでcropViewBox
  // （下記）に置き換え、box自体をこのインセット分だけクロップして「箱≒シルエット」にする
  // 根本解決に変更した。outlineInset自体は後方互換のフィールドとしてそのまま残す
  // （cropViewBoxの導出元・スモークテストの検証対象として引き続き使用）
  outlineInset: { top: number; right: number; bottom: number; left: number };
  // F: 輪郭の実bboxにクロップしたviewBox（goofy-hatching-mango.md 2026-07-07第4バッチ）。
  // outlineInsetから導出し、数%のstrokeマージン(CROP_MARGIN_RATIO)のみ残す。IdeaShapeCardの
  // <svg viewBox>にそのまま渡すことで「箱≒シルエット」にする。outlinePath/textPath/
  // foreignObjectの座標はすべて元のviewBox(0..viewBoxW, 0..viewBoxH)座標系のまま変更しない
  // （viewBox属性は同じ座標系の「見える窓」を変えるだけなので無変換で成立する）。
  // IdeasPoster側はこのcropAspectをCSS aspect-ratioに使うことで、素直なCSS gapがそのまま
  // シルエット間の近接距離になる
  cropViewBox: { x: number; y: number; w: number; h: number };
  cropAspect: number; // cropViewBox.w / cropViewBox.h。カード外枠のCSS aspect-ratioに使う
  // 数学的保証フォールバック(曲率制約を無視して全周長で確定するティア)が発動したかどうか。
  // 実運用の40件+妥当な合成ロングタイトルでは発動しない想定の診断用フィールド
  // (IdeaShapeCardは使わない。スモークテストが「切り詰めゼロ」の証明範囲を切り分けるために使う)
  titleUsedFallback: boolean;
  dateUsedFallback: boolean;
  // B: パズルカーニング配置用の輪郭サンプル点列（goofy-hatching-mango.md 2026-07-07バッチ。
  // 元のviewBox(0..viewBoxW, 0..viewBoxH)座標系のまま、閉じた輪郭を弧長ベースで一定点数に
  // リサンプルしたもの。ideaCollageLayout.tsがoutlineToLayoutSpaceでレイアウト座標(実際の
  // カード配置後の物理px)に変換し、隣接シルエット間の最短距離を測ってカーニングする
  outlineSamplePoints: readonly Point[];
  // H: 固定2サイズタイポグラフィ(goofy-hatching-mango.md 2026-07-07バッチ・改訂計画)。
  // solveFixedSizeShapeのみが設定する(旧shapeForIdeaではundefinedのまま)。titleFontSize/
  // dateFontSizeは既存フィールドをそのまま「サイズA・サイズB」として再利用する(dateFontSizeが
  // 説明文・参照リンクの本文フォントとも一致する＝同じviewbox単位値)。以下は説明文・参照
  // リンクの事前計算結果を保持し、IdeaShapeCard.tsx側での再計算(旧shrink-to-fit探索)を
  // 不要にする
  descLines?: number;
  descRequiredHeightPx?: number; // viewbox単位。説明文本文の必要高さ(dateFontSize基準)
  reservedLinksHeightPx?: number; // viewbox単位。罫線+参照リンク一覧の必要高さ
  refLineCounts?: readonly number[]; // refsと同じ順序。各参照リンクタイトルの折返し行数
  linkLabelFontSize?: number; // viewbox単位。CASE/TECHラベルの小さめフォント
};

const TAU = Math.PI * 2;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

function rad2deg(r: number): number {
  return (r * 180) / Math.PI;
}

// mulberry32: 32bit seedからの決定論的PRNG（Math.random禁止の代替）
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function pick<T>(rng: () => number, options: readonly T[]): T {
  return options[Math.floor(rng() * options.length) % options.length];
}

// B: ideaCollageLayout.tsの輪郭カーニング計算が同じ点型を使えるようexportする
// （goofy-hatching-mango.md 2026-07-07バッチ・実装詳細補足B.2）
export type Point = { x: number; y: number };

// 小数4桁: title/dateArcPathは密サンプル点(隣接間隔が最短で0.1〜0.2viewBox単位程度になりうる)を
// 直接つないだ折れ線であり、2桁(0.01刻み)では間隔の狭い区間で量子化誤差が接線角に対して
// 無視できない比率になり、実際には滑らかな区間でも「総回転」が数百度に見かけ上膨らむ現象を
// 実測で確認した(archive-40のnotchedCircle等)。4桁にすることでこの量子化ノイズを実質排除する
// （画面表示上の見た目は2桁でも4桁でも区別できない。スモークテストの接線角検証の前提を満たす
// ための精度であって、視覚的な理由ではない）
function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(4) : "0";
}

// 楕円の極座標半径（角度ごとにrx/ryをブレンド）
function ellipseR(angle: number, rx: number, ry: number): number {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const denom = Math.sqrt((ry * c) ** 2 + (rx * s) ** 2);
  return denom === 0 ? Math.max(rx, ry) : (rx * ry) / denom;
}

// 矩形寄りの極座標半径（スーパー楕円。kが大きいほど角が立つ）
function superRectR(angle: number, hw: number, hh: number, k: number): number {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const denom = (c / hw) ** k + (s / hh) ** k;
  return denom === 0 ? Math.max(hw, hh) : denom ** (-1 / k);
}

type Harmonic = { freq: number; amp: number; phase: number };

function makeHarmonics(
  rng: () => number,
  specs: readonly { freqMin: number; freqMax: number; ampMin: number; ampMax: number }[],
): Harmonic[] {
  return specs.map((s) => ({
    freq: Math.round(randRange(rng, s.freqMin, s.freqMax)),
    amp: randRange(rng, s.ampMin, s.ampMax),
    phase: randRange(rng, 0, TAU),
  }));
}

function harmonicJitter(angle: number, harmonics: readonly Harmonic[]): number {
  let j = 0;
  for (const h of harmonics) j += h.amp * Math.sin(h.freq * angle + h.phase);
  return j;
}

// Catmull-Rom→Bezier変換の1区間分の制御点計算
function catmullRomSegmentControls(p0: Point, p1: Point, p2: Point, p3: Point): { c1: Point; c2: Point } {
  return {
    c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
    c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
  };
}

// 閉じた点列 → Catmull-Rom→Bezier変換のスムーズな閉パス（ブロブ系のオーガニックな輪郭用）
function catmullRomClosedPath(points: readonly Point[]): string {
  const n = points.length;
  if (n < 3) return "";
  const d: string[] = [`M ${fmt(points[0].x)} ${fmt(points[0].y)}`];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const { c1, c2 } = catmullRomSegmentControls(p0, p1, p2, p3);
    d.push(`C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p2.x)} ${fmt(p2.y)}`);
  }
  d.push("Z");
  return d.join(" ");
}

function cubicBezierPoint(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * p1.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * p1.y,
  };
}

function quadraticBezierPoint(p0: Point, c: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return { x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x, y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y };
}

// 点列の折れ線長
function polylineLength(points: readonly Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

// 開いた点列 → 直線でつないだ開パス。titleArcPath/dateArcPathは常にこの形式（密サンプル
// 点列を直接つなぐため、区間長あたりの折れが十分小さければCatmull-Romで再平滑化せずとも
// 視覚上滑らかに見える。密度はOUTLINE_SAMPLES_PER_CURVE参照）
function straightOpenPath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  const d = [`M ${fmt(points[0].x)} ${fmt(points[0].y)}`];
  for (let i = 1; i < points.length; i++) d.push(`L ${fmt(points[i].x)} ${fmt(points[i].y)}`);
  return d.join(" ");
}

// 角丸多角形の輪郭パス（頂点をわずかにカットしてQ二次曲線で丸める）
function roundedPolygonPath(vertices: readonly Point[], cornerRatio: number): string {
  const n = vertices.length;
  if (n < 3) return "";
  const d: string[] = [];
  const cut = (from: Point, to: Point, ratio: number): Point => ({
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
  });
  const firstIn = cut(vertices[0], vertices[(n - 1 + n) % n], cornerRatio);
  d.push(`M ${fmt(firstIn.x)} ${fmt(firstIn.y)}`);
  for (let i = 0; i < n; i++) {
    const cur = vertices[i];
    const next = vertices[(i + 1) % n];
    const outPt = cut(cur, next, cornerRatio);
    d.push(`Q ${fmt(cur.x)} ${fmt(cur.y)} ${fmt(outPt.x)} ${fmt(outPt.y)}`);
    const nextIn = cut(next, cur, cornerRatio);
    d.push(`L ${fmt(nextIn.x)} ${fmt(nextIn.y)}`);
  }
  d.push("Z");
  return d.join(" ");
}

function rotatePoint(p: Point, cx: number, cy: number, angleRad: number): Point {
  const dx = p.x - cx;
  const dy = p.y - cy;
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

function normalizeAngle(a: number): number {
  let x = a;
  while (x <= -Math.PI) x += TAU;
  while (x > Math.PI) x -= TAU;
  return x;
}
function angleDiff(a: number, b: number): number {
  return normalizeAngle(a - b);
}

// 連続する2点がepsilon未満しか離れていない場合、後の点を除去する。丸め角(cornerRatio)が
// 大きく・元の辺が短いケースで、固定サンプル数(samplesPerCurve)のQ曲線が極小の物理弧長に
// 密集し、ほぼ同一点が連続することがある(実測: lNotchのT字の細い腕で発生)。
// これを放置すると隣接2点の距離がほぼ0になり、その区間の接線角(atan2(0,0)=0)が本来の
// 進行方向と無関係な値になって、曲率・総回転の計算に見かけ上の急激な向き反転を生む
function dedupClosePoints(points: readonly Point[]): Point[] {
  const EPS = 1e-6;
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > EPS) out.push(p);
  }
  // 閉パスの最終カーブセグメントの終点は、そのセグメントの定義上つねに始点(pts[0])と厳密に
  // 一致する（"M pts[0] ... 最後のC/QはZで閉じるためpts[0]へ戻る"）。この末尾の重複点を
  // 除かないと、findLongestRunが輪郭の"継ぎ目"をまたぐ区間を選んだ際に長さ0の区間が混入し、
  // atan2(0,0)由来の見かけ上の急な向き反転(実測179.8度)を生む
  while (out.length > 1 && Math.hypot(out[out.length - 1].x - out[0].x, out[out.length - 1].y - out[0].y) <= EPS) {
    out.pop();
  }
  return out;
}

// outlinePath(M/L/C/Q/Zのみで構成される。本ファイルの全ジェネレータがこの組み合わせしか
// 出力しない)を実際に描画される曲線に沿って密にサンプルした閉多角形にする。以後の曲率解析・
// 包含判定・safeArea探索は、すべてこの「実際に描画される点列」だけを唯一の真実源として行う
// （個別ビルダーのpointAt由来の近似は使わない。ビルダーごとの近似誤差が輪郭外はみ出しの
// 原因になっていた過去のバグ(Fable視覚検分で実測)を構造的に防ぐ）
function densePointsFromOutlinePath(d: string, samplesPerCurve: number): Point[] {
  const tokens = d.match(/[MLCQZ]|-?\d+\.?\d*/g) ?? [];
  const pts: Point[] = [];
  let cur: Point = { x: 0, y: 0 };
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i];
    if (cmd === "M" || cmd === "L") {
      cur = { x: Number(tokens[i + 1]), y: Number(tokens[i + 2]) };
      pts.push(cur);
      i += 3;
    } else if (cmd === "Q") {
      const c = { x: Number(tokens[i + 1]), y: Number(tokens[i + 2]) };
      const end = { x: Number(tokens[i + 3]), y: Number(tokens[i + 4]) };
      for (let s = 1; s <= samplesPerCurve; s++) pts.push(quadraticBezierPoint(cur, c, end, s / samplesPerCurve));
      cur = end;
      i += 5;
    } else if (cmd === "C") {
      const c1 = { x: Number(tokens[i + 1]), y: Number(tokens[i + 2]) };
      const c2 = { x: Number(tokens[i + 3]), y: Number(tokens[i + 4]) };
      const end = { x: Number(tokens[i + 5]), y: Number(tokens[i + 6]) };
      for (let s = 1; s <= samplesPerCurve; s++) pts.push(cubicBezierPoint(cur, c1, c2, end, s / samplesPerCurve));
      cur = end;
      i += 7;
    } else {
      i += 1; // "Z"や未知トークンはスキップ（閉パスの終端。呼び出し側が(i+1)%nで暗黙的に閉じる）
    }
  }
  return dedupClosePoints(pts);
}

// レイキャスト法による点-多角形包含判定（標準的な奇偶則）
function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

const SHRINK_MAX_ITERATIONS = 30;
const SHRINK_FACTOR = 0.97;
// outlinePolygonは輪郭の密サンプル近似であり、真の滑らかな曲線とはサンプル間隔ぶんの微小な
// 誤差がある。判定用の多角形はさらにこの比率ぶん内側へ縮めたものを使い、安全マージンを確保する
const CONTAINMENT_CHECK_MARGIN_RATIO = 0.995;

function scalePolygon(polygon: readonly Point[], cx: number, cy: number, factor: number): Point[] {
  return polygon.map((p) => ({ x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor }));
}

// 候補点列を中心(cx,cy)へわずかずつ縮小し、全点がoutlinePolygon(実際に描画されるoutlinePath)の
// 内側に収まるまで繰り返す最終防衛の安全網。本ファイルの全ビルダーは(cx,cy)から見て星形
// （中心から輪郭上の任意の点への線分が常に図形内部に収まる）になるよう設計しているため、
// インセット(中心方向への縮小)は理論上常に内側に収まる保証があるが、離散サンプルの誤差に
// 備えてこの安全網を残す
function shrinkUntilContained(points: readonly Point[], cx: number, cy: number, polygon: readonly Point[]): Point[] {
  const checkPolygon = scalePolygon(polygon, cx, cy, CONTAINMENT_CHECK_MARGIN_RATIO);
  let pts: Point[] = points as Point[];
  for (let iter = 0; iter < SHRINK_MAX_ITERATIONS; iter++) {
    if (pts.every((p) => pointInPolygon(p, checkPolygon))) return pts;
    pts = pts.map((p) => ({ x: cx + (p.x - cx) * SHRINK_FACTOR, y: cy + (p.y - cy) * SHRINK_FACTOR }));
  }
  return pts; // 上限まで縮めても収まらない場合はそのまま返す（実運用では発生しない想定の保険）
}

// ── ビルダー ─────────────────────────────────────────────────────────────
// 各ビルダーはoutlinePath(実際に描画される閉パス)と、そのビルダーが(cx,cy)から見て星形に
// なるよう選んだ中心点だけを返す。テキスト弧の選定・安全領域の算出は、以後すべて
// outlinePathを密サンプルした実点列に対して行う（ビルダー固有のpointAtには依存しない）
type ShapeBuildResult = {
  viewBoxW: number;
  viewBoxH: number;
  outlinePath: string;
  cx: number;
  cy: number;
};

// 1: 不揃い楕円（ブロブ）
// E: パラメータレンジを拡大（goofy-hatching-mango.md 2026-07-07第4バッチ・シェイプ全ユニーク化。
// 実測(全50件の輪郭を正規化した角度→半径プロファイルの突き合わせ)で同種同士の近接ペアが
// 見つかった(blob: archive-39 vs 2026-07-07-5 差分0.0754)。曲率制約の詳細な調整コメントが無い
// 単純形状(blob/arch/tallOval/notchedCircle)は元のレンジが狭すぎたため、視覚的な区別が
// 明確になるようレンジを広げる（rx/ryは元の6単位幅→14単位幅、harmonics ampも拡大）
function buildBlob(rng: () => number): ShapeBuildResult {
  const cx = 50;
  const cy = 50;
  const rx = randRange(rng, 34, 48);
  const ry = randRange(rng, 32, 46);
  const harmonics = makeHarmonics(rng, [
    { freqMin: 2, freqMax: 3, ampMin: 0.05, ampMax: 0.14 },
    { freqMin: 3, freqMax: 5, ampMin: 0.04, ampMax: 0.11 },
    { freqMin: 5, freqMax: 7, ampMin: 0.02, ampMax: 0.06 },
  ]);
  const radiusAt = (angle: number) => ellipseR(angle, rx, ry) * (1 + clamp(harmonicJitter(angle, harmonics), -0.3, 0.32));
  const pointAt = (angle: number): Point => {
    const r = radiusAt(angle);
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };
  const nOutline = 18;
  const points: Point[] = [];
  for (let i = 0; i < nOutline; i++) points.push(pointAt((i / nOutline) * TAU - Math.PI / 2));
  return { viewBoxW: 100, viewBoxH: 100, outlinePath: catmullRomClosedPath(points), cx, cy };
}

// 2: 不揃い角丸多角形（7〜9角）
function buildPolygon(rng: () => number): ShapeBuildResult {
  const cx = 50;
  const cy = 50;
  const n = pick(rng, [7, 8, 9] as const);
  const rBase = randRange(rng, 37, 42);
  const vertices: Point[] = [];
  const sector = TAU / n;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * sector + randRange(rng, -0.18, 0.18) * sector;
    const r = rBase * (1 + randRange(rng, -0.16, 0.16));
    vertices.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return { viewBoxW: 100, viewBoxH: 100, outlinePath: roundedPolygonPath(vertices, 0.16), cx, cy };
}

// 3: 台形がかった矩形（角にうねり）
function buildWaveRect(rng: () => number): ShapeBuildResult {
  const viewBoxW = 125;
  const viewBoxH = 100;
  const cx = viewBoxW / 2;
  const cy = 50;
  const hw = randRange(rng, 45, 50);
  const hh = randRange(rng, 37, 41);
  const k = randRange(rng, 2.8, 3.6);
  const shear = randRange(rng, -7, 7);
  const harmonics = makeHarmonics(rng, [
    { freqMin: 2, freqMax: 3, ampMin: 0.03, ampMax: 0.06 },
    { freqMin: 4, freqMax: 5, ampMin: 0.02, ampMax: 0.04 },
  ]);
  const radiusAt = (angle: number) =>
    superRectR(angle, hw, hh, k) * (1 + clamp(harmonicJitter(angle, harmonics), -0.12, 0.12));
  const pointAt = (angle: number): Point => {
    const r = radiusAt(angle);
    const py = cy + r * Math.sin(angle);
    const px = cx + r * Math.cos(angle) + shear * ((py - cy) / hh);
    return { x: px, y: py };
  };
  const nOutline = 28;
  const points: Point[] = [];
  for (let i = 0; i < nOutline; i++) points.push(pointAt((i / nOutline) * TAU - Math.PI / 2));
  return { viewBoxW, viewBoxH, outlinePath: catmullRomClosedPath(points), cx, cy };
}

// 4: アーチ（上半円+胴）
// E: パラメータレンジを拡大（シェイプ全ユニーク化バッチ。archは実測で最も近接したペア
// (archive-4 vs archive-27 差分0.0287)が出た種で、元のレンジ(cy/domeR/bodyBottomOffsetとも
// 4単位幅)が最も狭かった。3〜4倍のレンジ幅に広げ、視覚的な区別を明確にする）
function buildArch(rng: () => number): ShapeBuildResult {
  const viewBoxW = 92;
  const viewBoxH = 100;
  const cx = viewBoxW / 2;
  const cy = randRange(rng, 33, 47);
  const domeR = randRange(rng, 29, 43);
  const bodyBottomOffset = randRange(rng, 36, 52);
  const harmonics = makeHarmonics(rng, [{ freqMin: 2, freqMax: 3, ampMin: 0.03, ampMax: 0.11 }]);
  const radiusAt = (angleRaw: number) => {
    let angle = angleRaw;
    while (angle > Math.PI) angle -= TAU;
    while (angle <= -Math.PI) angle += TAU;
    const base =
      angle <= 0
        ? domeR
        : Math.min(domeR / Math.max(Math.abs(Math.cos(angle)), 1e-6), bodyBottomOffset / Math.max(Math.sin(angle), 1e-6));
    return base * (1 + clamp(harmonicJitter(angle, harmonics), -0.12, 0.12));
  };
  const pointAt = (angle: number): Point => {
    const r = radiusAt(angle);
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };
  const nOutline = 22;
  const points: Point[] = [];
  for (let i = 0; i < nOutline; i++) points.push(pointAt((i / nOutline) * TAU - Math.PI / 2));
  return { viewBoxW, viewBoxH, outlinePath: catmullRomClosedPath(points), cx, cy };
}

// 5: 縦長オーバル
// E: パラメータレンジを拡大（シェイプ全ユニーク化バッチ。実測でtallOval同士の近接ペアが複数
// 見つかった: archive-12 vs archive-36 差分0.0494等）。rx/ryとも元の4単位幅→12単位幅に広げる
function buildTallOval(rng: () => number): ShapeBuildResult {
  const viewBoxW = 64;
  const viewBoxH = 100;
  const cx = viewBoxW / 2;
  const cy = 50;
  const rx = randRange(rng, 16, 28);
  const ry = randRange(rng, 37, 46);
  const harmonics = makeHarmonics(rng, [
    { freqMin: 2, freqMax: 3, ampMin: 0.04, ampMax: 0.11 },
    { freqMin: 3, freqMax: 4, ampMin: 0.02, ampMax: 0.07 },
  ]);
  const radiusAt = (angle: number) => ellipseR(angle, rx, ry) * (1 + clamp(harmonicJitter(angle, harmonics), -0.22, 0.22));
  const pointAt = (angle: number): Point => {
    const r = radiusAt(angle);
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };
  const nOutline = 18;
  const points: Point[] = [];
  for (let i = 0; i < nOutline; i++) points.push(pointAt((i / nOutline) * TAU - Math.PI / 2));
  return { viewBoxW, viewBoxH, outlinePath: catmullRomClosedPath(points), cx, cy };
}

// 6: ぐにゃっとした花形・スプラット（複雑形。輪郭本体がフル暴れの有機形状）
// A.2: generous=trueは「浅い変種」（goofy-hatching-mango.md 2026-07-07バッチ・コンテンツ量に
// 応じたシェイプ割り当て）。assignShapeKindsが、長文カードにこの複雑形をどうしても割り当てる
// 必要がある場合にのみ使う。花弁の主振幅レンジを下げてsafeAreaが広く取れる方向に凹みを浅くする
// （実測校正: 通常0.16〜0.24 → 浅い変種0.08〜0.14。花弁感は残しつつ最大凹み量をほぼ半減させる）
function buildSplat(rng: () => number, generous = false): ShapeBuildResult {
  const cx = 50;
  const cy = 50;
  // freq 5〜6・amp 0.2〜0.3(旧値)は輪郭のほぼ全域で曲率半径が閾値を割り込み(実測:
  // minRadius=20でbestSmoothRunが全周の3〜5%まで低下)、Aの全周探索が長い低曲率区間を
  // 確保できず数学的保証フォールバックに落ちる(実測: 300件超のスモークテストで98%が発動)。
  // さらに調査すると、細かい"エッジ荒れ"用のfineHarmonics(freq 9〜11)がamp自体は小さくても
  // 曲率＝振幅×周波数²で効くため、周波数が高い分メインローブより曲率への寄与が大きく、
  // 実は主要因だった(モンテカルロ実測: fineのamp/freqを抑えるだけでbestSmoothRunの平均が
  // 19→71まで改善)。メインは花弁感を保つ振幅のまま、fineは控えめな周波数・振幅に絞る
  const rBase = randRange(rng, 34, 38);
  // 実測再校正: 当初generousレンジは0.08〜0.14(幅0.06)で元(幅0.08)より狭めていたが、レンジ幅を
  // 狭めるとgenerous=true同士のペアで乱数の当たり値が近接しやすくなり、シェイプ全ユニーク化
  // チェック(profileDist)で閾値未達のペアが実測で発生した。レンジ幅は元と同じ0.08を保ったまま
  // 平均だけ下げる(0.08〜0.16、平均0.12)ことで、safeArea拡大効果を保ちつつ個体差を維持する
  const mainAmp = generous ? { ampMin: 0.08, ampMax: 0.16 } : { ampMin: 0.16, ampMax: 0.24 };
  const lobeHarmonics = makeHarmonics(rng, [
    { freqMin: 3, freqMax: 4, ...mainAmp },
    { freqMin: 6, freqMax: 8, ampMin: 0.01, ampMax: 0.02 },
  ]);
  const radiusAt = (angle: number) => rBase * (1 + clamp(harmonicJitter(angle, lobeHarmonics), -0.3, 0.34));
  const pointAt = (angle: number): Point => {
    const r = radiusAt(angle);
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };
  const nOutline = 40;
  const points: Point[] = [];
  for (let i = 0; i < nOutline; i++) points.push(pointAt((i / nOutline) * TAU - Math.PI / 2));
  return { viewBoxW: 100, viewBoxH: 100, outlinePath: catmullRomClosedPath(points), cx, cy };
}

// 7: マルチローブブロブ（複雑形。B: 2〜4ローブ＋深いくびれのパズルピース感）
// A.2: generous=trueは「浅い変種」（goofy-hatching-mango.md 2026-07-07バッチ・コンテンツ量に
// 応じたシェイプ割り当て）。くびれの深さ(lobeAmp)を下げてsafeAreaが広く取れる方向にする
// （実測校正: 通常0.1〜0.22 → 浅い変種0.05〜0.12）
function buildMultiLobe(rng: () => number, generous = false): ShapeBuildResult {
  const cx = 50;
  const cy = 50;
  // 4ローブ・高振幅は輪郭ほぼ全域の曲率半径が閾値を割り込み(実測: minRadius=20でbestSmoothRun
  // が全周の6〜8%程度まで低下)、A(全周辺沿いテキスト)が長い低曲率区間を確保できず数学的保証
  // フォールバックに落ちやすい。2〜3ローブ・控えめな振幅に絞ることで「パズルピース感」を保ちつつ
  // 各ローブの腹に十分長い低曲率区間を残す（実測: この範囲ならfloorフォントサイズで
  // 全周の30%以上の低曲率区間を確保できる）
  // fineHarmonics(エッジ荒れ用)は曲率＝振幅×周波数²で効くため、周波数7〜9ではampが小さくても
  // メインローブより曲率への寄与が大きくなり得る(splatで実測した同種の問題。DESIGN差分参照)。
  // 周波数・振幅とも抑えることでbestSmoothRunの実測平均が68→91まで改善する
  // E: lobeAmpのレンジをわずかに拡大（シェイプ全ユニーク化バッチ。実測でmultiLobe同士の近接
  // ペアが見つかった: archive-13 vs archive-37 差分0.0546等）。曲率制約(上のコメント参照)を
  // 崩さないよう、既存レンジの外側にわずかに広げるだけの控えめな変更に留める
  const lobes = pick(rng, [2, 3] as const);
  const rBase = randRange(rng, 30, 36);
  // 実測再校正: 当初generousレンジは0.05〜0.12(幅0.07)で元(幅0.12)より狭めていたが、splatと
  // 同じ理由でシェイプ全ユニーク化チェックの近接ペアを誘発した。レンジ幅は元と同じ0.12を保ち
  // 平均だけ下げる(0.03〜0.15、平均0.09)
  const lobeAmp = generous ? randRange(rng, 0.03, 0.15) : randRange(rng, 0.1, 0.22);
  const lobePhase = randRange(rng, 0, TAU);
  const fineHarmonics = makeHarmonics(rng, [{ freqMin: 6, freqMax: 8, ampMin: 0.008, ampMax: 0.015 }]);
  const radiusAt = (angle: number) =>
    rBase *
    (1 + lobeAmp * Math.cos(lobes * angle + lobePhase)) *
    (1 + clamp(harmonicJitter(angle, fineHarmonics), -0.05, 0.05));
  const pointAt = (angle: number): Point => {
    const r = radiusAt(angle);
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };
  const nOutline = 48; // くびれをCatmull-Romが滑らかに拾えるよう密に
  const points: Point[] = [];
  for (let i = 0; i < nOutline; i++) points.push(pointAt((i / nOutline) * TAU - Math.PI / 2));
  return { viewBoxW: 100, viewBoxH: 100, outlinePath: catmullRomClosedPath(points), cx, cy };
}

// 8: 丸みのあるL字/T字型（複雑形。B: 凹角を持つブロック形状）
// A.2: generous=trueは「浅い変種」（goofy-hatching-mango.md 2026-07-07バッチ・コンテンツ量に
// 応じたシェイプ割り当て）。T字はstemW/barHを、L字はarmTを大きくすることで、外箱に対する
// 凹み(くり抜き・欠けた角)の相対面積を減らしsafeAreaが広く取れる方向にする
// （実測校正: T字 barH 30〜38→40〜48・stemW 26〜34→38〜46、L字 armT 36〜46→46〜56）
function buildLNotch(rng: () => number, generous = false): ShapeBuildResult {
  const cx = 50;
  const cy = 50;
  const isT = rng() < 0.5;
  const margin = randRange(rng, 5, 9);
  const lo = margin;
  const hi = 100 - margin;
  let vertices: Point[];
  let kernelPoint: Point; // 星形の核（この点から全頂点・全辺が遮られず見通せる位置）
  if (isT) {
    const barH = generous ? randRange(rng, 40, 48) : randRange(rng, 30, 38);
    const stemW = generous ? randRange(rng, 38, 46) : randRange(rng, 26, 34);
    const stemLeft = cx - stemW / 2;
    const stemRight = cx + stemW / 2;
    const barBottom = lo + barH;
    vertices = [
      { x: lo, y: lo },
      { x: hi, y: lo },
      { x: hi, y: barBottom },
      { x: stemRight, y: barBottom },
      { x: stemRight, y: hi },
      { x: stemLeft, y: hi },
      { x: stemLeft, y: barBottom },
      { x: lo, y: barBottom },
    ];
    // T字の核(星形の中心)は「バーのうちステム幅と重なる部分」＝y:[lo,barBottom]の範囲内でなければ
    // ならない(バー全体・ステム全体の両方を直視できる唯一の領域)。誤ってy:[barBottom,hi]
    // (ステム側)に置いていたバグを修正（shrinkUntilContainedが多重に縮小し、Aの数学的保証
    // フォールバックが想定より大幅に短くなる原因になっていた: 実測でtitleArcLengthが
    // 必要弧長を下回るケースを確認）
    kernelPoint = { x: cx, y: lo + (barBottom - lo) * 0.5 };
  } else {
    const armT = generous ? randRange(rng, 46, 56) : randRange(rng, 36, 46);
    vertices = [
      { x: lo, y: lo },
      { x: lo + armT, y: lo },
      { x: lo + armT, y: hi - armT },
      { x: hi, y: hi - armT },
      { x: hi, y: hi },
      { x: lo, y: hi },
    ];
    // L字の核は[lo,lo+armT]×[hi-armT,hi]の重なり矩形内。丸め(cornerRatio)が凹角付近を
    // 削るぶんの余裕を持たせるため、境界寄りの0.6ではなく矩形の中心(0.5)を採用する
    kernelPoint = { x: lo + armT * 0.5, y: hi - armT * 0.5 };
  }
  // 手描き感のための微小な頂点ジッター + 4方向のランダム回転で見た目のバリエーションを出す
  const jitterAmp = 2.2;
  const jittered = vertices.map((v) => ({
    x: v.x + randRange(rng, -jitterAmp, jitterAmp),
    y: v.y + randRange(rng, -jitterAmp, jitterAmp),
  }));
  const rotation = pick(rng, [0, 1, 2, 3] as const) * (Math.PI / 2);
  const rotated = jittered.map((v) => rotatePoint(v, cx, cy, rotation));
  const kernelRotated = rotatePoint(kernelPoint, cx, cy, rotation);
  // L/T字の凸角は90度・凹角は270度と、多角形(buildPolygon、7〜9角で1角あたり40〜51度)より
  // 遥かに急な曲がりを丸め区間に圧縮する必要がある。cornerRatio 0.1〜0.16(旧値)では丸め区間の
  // 物理弧長が短すぎて曲率半径が閾値を割り込みやすく、A(全周辺沿いテキスト)が長い低曲率区間を
  // 確保できず数学的保証フォールバックに落ちやすかった(実測)。丸めを大きくして角の曲がりを
  // 長い弧長に分散させる（「丸みのあるL/T字型」の見た目にもより合致する）
  const cornerRatio = randRange(rng, 0.24, 0.34);
  return {
    viewBoxW: 100,
    viewBoxH: 100,
    outlinePath: roundedPolygonPath(rotated, cornerRatio),
    cx: kernelRotated.x,
    cy: kernelRotated.y,
  };
}

// 9: 大きな切り欠きのある円形（複雑形。B: 1〜2箇所の深い凹み）
// E: 切り欠きの幅・深さのレンジを拡大（シェイプ全ユニーク化バッチ。実測でnotchedCircle同士の
// 近接ペアが見つかった: 2026-07-07-1 vs 2026-07-07-9 差分0.0382）。firstCenterは元々全周
// ランダムだが、切り欠きの幅・深さ自体のレンジが狭いと偶然近い角度になったペアが酷似して
// 見えるため、rBase・halfWidth・depthのレンジを広げて個体差を強める
// A.2: generous=trueは「浅い変種」（goofy-hatching-mango.md 2026-07-07バッチ・コンテンツ量に
// 応じたシェイプ割り当て）。切り欠きの深さ(depth)を下げてsafeAreaが広く取れる方向にする。
// 実測再校正: 当初は主0.32〜0.62(幅0.30)→0.15〜0.30(幅0.15)・副0.22〜0.46(幅0.24)→
// 0.10〜0.22(幅0.12)とレンジ幅を約半分に狭めていたが、generous=true同士のペアで乱数の
// 当たり値が近接しやすくなり、シェイプ全ユニーク化チェック(profileDist)で閾値未達のペアが
// 実測で発生した(archive-6 vs 2026-07-07-7、実測距離0.0269)。レンジ幅を元より広め(主0.34・
// 副0.28)にして平均を下げる(主0.08〜0.42・副0.04〜0.32)ことで、safeArea拡大効果を保ちつつ
// 個体差を維持する(再校正後の実測最小距離: 同ペアで0.041台まで改善)
function buildNotchedCircle(rng: () => number, generous = false): ShapeBuildResult {
  const cx = 50;
  const cy = 50;
  const rBase = randRange(rng, 33, 44);
  const notchCount = pick(rng, [1, 1, 2] as const);
  const firstCenter = randRange(rng, 0, TAU);
  const notches: { center: number; halfWidth: number; depth: number }[] = [
    {
      center: firstCenter,
      halfWidth: deg2rad(randRange(rng, 30, 66)),
      depth: generous ? randRange(rng, 0.08, 0.42) : randRange(rng, 0.32, 0.62),
    },
  ];
  if (notchCount === 2) {
    notches.push({
      center: firstCenter + Math.PI + randRange(rng, -0.4, 0.4),
      halfWidth: deg2rad(randRange(rng, 20, 46)),
      depth: generous ? randRange(rng, 0.04, 0.32) : randRange(rng, 0.22, 0.46),
    });
  }
  const fineHarmonics = makeHarmonics(rng, [{ freqMin: 6, freqMax: 8, ampMin: 0.015, ampMax: 0.03 }]);
  const radiusAt = (angle: number) => {
    let r = rBase;
    for (const notch of notches) {
      const d = Math.abs(angleDiff(angle, notch.center));
      if (d < notch.halfWidth) {
        const bump = 0.5 * (1 + Math.cos((Math.PI * d) / notch.halfWidth));
        r -= rBase * notch.depth * bump;
      }
    }
    return r * (1 + clamp(harmonicJitter(angle, fineHarmonics), -0.03, 0.03));
  };
  const pointAt = (angle: number): Point => {
    const r = radiusAt(angle);
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };
  const nOutline = 48;
  const points: Point[] = [];
  for (let i = 0; i < nOutline; i++) points.push(pointAt((i / nOutline) * TAU - Math.PI / 2));
  return { viewBoxW: 100, viewBoxH: 100, outlinePath: catmullRomClosedPath(points), cx, cy };
}

// A.2: generousは複雑形4種(splat/multiLobe/lNotch/notchedCircle)のみが使う第2引数。他5種は
// シグネチャを変えていない(TSの構造的部分型により(rng)=>Xは(rng,generous?)=>Xが要求される
// このRecordに代入可能。呼び出し時に余分な第2引数を渡してもJSは単に無視する)
const BUILDERS: Record<ShapeKind, (rng: () => number, generous?: boolean) => ShapeBuildResult> = {
  blob: buildBlob,
  polygon: buildPolygon,
  waveRect: buildWaveRect,
  arch: buildArch,
  tallOval: buildTallOval,
  splat: buildSplat,
  multiLobe: buildMultiLobe,
  lNotch: buildLNotch,
  notchedCircle: buildNotchedCircle,
};

// ── A: 全周辺沿いテキスト選定 ────────────────────────────────────────────
// idea.titleの推定表示幅（em単位）。全角(CJK仮名漢字等)は1.0em、半角(ASCII等)は0.6em という
// 実測（getComputedTextLength）に基づく簡易ヒューリスティック
export function estimateTextWidthEm(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    width += code > 0x2e7f ? 1.0 : 0.6;
  }
  return width;
}

// E: foreignObject内の説明文・参照リンクタイトルの行数ベース切り詰め（ユーザーフィードバック
// 修正バッチ）。estimateTextWidthEmと同じ簡易ヒューリスティックで先頭から文字幅を積算し、
// budget(em)を超える手前で切って省略記号を付す。
// SVG foreignObject内にネストした-webkit-line-clampは、実測(Playwright)で「クランプ指定行数を
// 超えて描画される／明示heightを与えても無視される」という信頼できない挙動を示した(行の途中で
// グリフが半分だけ見える・罫線がテキストと重なる、というユーザー報告の不具合の原因)。
// 行数(=どこまで表示するか)の計算自体はJS側で行い、実際にDOMへ渡す文字列そのものをここで
// 確定させることで、CSSのクランプ機構に依存しないようにする
export function truncateToEmBudget(text: string, maxEm: number): string {
  const chars = Array.from(text);
  let width = 0;
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].codePointAt(0) ?? 0;
    const charEm = code > 0x2e7f ? 1.0 : 0.6;
    if (width + charEm > maxEm) {
      return `${chars.slice(0, i).join("").trimEnd()}…`;
    }
    width += charEm;
  }
  return text;
}

// <text letterSpacing>と幅見積もりの両方で共有する単一の真実源（日付ラベルのuppercase表示に使う）
export const DATE_LETTER_SPACING_EM = 0.14;
// H: タイトル文字間の追加スペーシング（ユーザーフィードバック修正バッチ）。曲率がきつい区間では
// textPathが弧長ベースでグリフを配置するため隣接グリフの見た目上の間隔が詰まりやすい
// （凹凸に沿って回転した矩形グリフ同士がタイトな曲率で内側の角を接近させる）。字間を少し
// 空けることで詰まりの見た目を緩和する。日付ほど大きくしない(0.14だとfont-weight:900の
// タイトルには間延びして見える)ため小さめの値にする。DATE同様、幅見積もり側にも同じ値を
// 反映して「切り詰めゼロ」の保証を崩さない
export const TITLE_LETTER_SPACING_EM = 0.02;

// 曲率半径がフォントサイズの何倍以上あれば「低曲率＝グリフ衝突が起きない緩さ」とみなすか
export const CURVATURE_RADIUS_MULT = 2.5;
// 必要弧長 = フォントサイズ×推定文字幅合計×このマージン（実測の折れ線長近似誤差を相殺）
export const ARC_LENGTH_MARGIN = 1.06;
// 区間全体の総回転（ヘアピン・方向反転の代理指標）の上限。この値を超えて回り込む区間は
// 打ち切る（例: 円に近い形状で低曲率が全周に渡っていても、半周以上テキストを回り込ませると
// 文字が上下逆になってしまうため。低曲率かつ滑らかな連続性の両方が要件 — DESIGN参照）
const MAX_RUN_TOTAL_TURN_DEG = 150;
const MAX_RUN_TOTAL_TURN_RAD = deg2rad(MAX_RUN_TOTAL_TURN_DEG);

const TITLE_FONT_MAX_RATIO = 0.076;
const TITLE_FONT_FLOOR_RATIO = 0.03;
const DATE_FONT_MAX_RATIO = 0.036;
const DATE_FONT_FLOOR_RATIO = 0.02;
const FONT_SHRINK_STEP = 0.92; // 1段階あたりの縮小率
// 数学的保証フォールバック（全周長 ≥ 必要弧長になるフォントサイズ）が万一さらに小さい値を
// 要求しても、完全に不可視にはしないための絶対下限（実運用の40件+合成ロングタイトルでは
// 到達しない想定の保険）
const ABSOLUTE_MIN_FONT_SIZE = 0.6;

const INSET_BASE_RATIO = 0.07;
const INSET_GAIN_RATIO = 0.14; // 曲率が閾値ぎりぎり(=平均曲率係数1.0)のとき、最大でBASE+GAINまで増やす

// F: cropViewBoxの輪郭bboxに残す余白比率（クロップ後のbbox幅/高さに対する比率、片側あたり）。
// 0にすると輪郭の最外周サンプル点がviewBoxの端に厳密に一致し、密サンプル近似誤差(凸曲線の弦は
// 真の曲線よりわずかに内側になるため、サンプル密度が有限な以上わずかな取りこぼしが起こりうる)
// ぶんの安全マージンが無くなる。「数%のstrokeマージンのみ残す」という設計意図どおり、
// ごく小さい値に留める（大きくすると箱がシルエットから離れ、本バッチの目的=ニアタッチが崩れる）
const CROP_MARGIN_RATIO = 0.03;

// I: グリフの外周はみ出し防止のためのインセット下限（ユーザーフィードバック修正バッチ）。
// 上記のINSET_BASE_RATIO/INSET_GAIN_RATIOは「低曲率区間でのグリフ同士の詰まり」対策として
// 曲率だけを見て決めており、フォントサイズに対する絶対的な余白は考慮していなかった。
// 低曲率（＝直線に近い）区間ではinsetRatioがBASE(0.07)付近まで下がるが、直線区間でも
// textPathのグリフはベースラインから外側(輪郭の外周方向)へキャップハイト分せり出すため、
// 局所半径が小さい（＝輪郭が細い/丸まっている）形状ではその分だけ真の輪郭外へ食み出し、
// 白背景に対してグリフの一部が欠けて見える（ユーザーがスクショで指摘した不具合の実測原因:
// notchedCircleの直線的な右辺で発生）。
// 「中心からの距離に比例するインセット」という単純化は、凹み(切り欠き)を持つ複雑形状では
// 実際の輪郭までの最短距離とずれる（実測で不十分だった）ため、insetAndOrient後の点列から
// outlinePolygonまでの最短距離を実際に測り、フォントサイズに対して不足する場合は段階的に
// インセットを増やして再測定する（曲率ベースのinsetRatioを初期値とし、弧長要件を割り込まない
// 範囲でのみ増やす。字間の詰まり対策はTITLE_LETTER_SPACING_EMで別途補う）
// 実測(Playwrightでの拡大スクショ)では、全角(CJK)グリフはほぼ正方形の字面を持ち、曲線に沿って
// 回転した状態での外周方向の実効的な張り出しはcap-height基準の0.82では不足していた
// （字面のアセント+回転による対角成分を考慮し、より大きい値に補正）
const GLYPH_OUTWARD_EM_RATIO = 0.88;
const MAX_TEXT_INSET_RATIO = 0.45; // 極端な安全網（中心近くまで縮めすぎないための上限）
const GLYPH_CONTAINMENT_MAX_ITER = 6;
const GLYPH_CONTAINMENT_INSET_STEP = 0.03;

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function minDistanceToPolygonBoundary(p: Point, polygon: readonly Point[]): number {
  let minDist = Infinity;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const d = distanceToSegment(p, polygon[i], polygon[(i + 1) % n]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function minClearanceToOutline(points: readonly Point[], outlinePolygon: readonly Point[]): number {
  let minC = Infinity;
  for (const p of points) {
    const d = minDistanceToPolygonBoundary(p, outlinePolygon);
    if (d < minC) minC = d;
  }
  return minC;
}

// initialInsetRatioを起点に、グリフの外周張り出し(GLYPH_OUTWARD_EM_RATIO×fontSize)ぶんの
// クリアランスがoutlinePolygonまで確保できるまでインセットを段階的に増やす。ただし弧長が
// minAcceptableLength(=必要弧長)を下回ってしまう場合はそこで打ち切り、切り詰めゼロの保証
// (A)を優先する（グリフの張り出しをわずかに残す方が、テキストの切り詰めより許容できる）
function refineInsetForGlyphClearance(
  basePoints: readonly Point[],
  cx: number,
  cy: number,
  initialInsetRatio: number,
  outlinePolygon: readonly Point[],
  fontSize: number,
  applyMonotonicTrim: boolean,
  minAcceptableLength: number,
): { points: Point[]; length: number } {
  let insetRatio = initialInsetRatio;
  let points = insetAndOrient(basePoints, cx, cy, insetRatio, outlinePolygon, applyMonotonicTrim);
  let length = polylineLength(points);
  const requiredClearance = GLYPH_OUTWARD_EM_RATIO * fontSize;
  for (let iter = 0; iter < GLYPH_CONTAINMENT_MAX_ITER && insetRatio < MAX_TEXT_INSET_RATIO; iter++) {
    if (minClearanceToOutline(points, outlinePolygon) >= requiredClearance) break;
    const nextInsetRatio = Math.min(MAX_TEXT_INSET_RATIO, insetRatio + GLYPH_CONTAINMENT_INSET_STEP);
    if (nextInsetRatio === insetRatio) break;
    const nextPoints = insetAndOrient(basePoints, cx, cy, nextInsetRatio, outlinePolygon, applyMonotonicTrim);
    const nextLength = polylineLength(nextPoints);
    if (nextLength < minAcceptableLength) break; // これ以上増やすと必要弧長を割り込む
    insetRatio = nextInsetRatio;
    points = nextPoints;
    length = nextLength;
  }
  return { points, length };
}

const OUTLINE_SAMPLES_PER_CURVE = 24; // 曲率解析・弧選定に使う密サンプリング解像度
const SAFE_AREA_SAMPLES_PER_CURVE = 8; // safeArea探索専用の粗いサンプリング（性能優先）
// B: ideaCollageLayout.tsのパズルカーニングが使う輪郭サンプル点数（実装詳細補足B.2の目安96点）。
// カーニングの最短距離探索は隣接点間の間隔が狭いほど正確になるが、行内・行間の全ペア距離計算の
// コストにも直結するため、視覚的に十分滑らかで計算コストも妥当な点数に固定する
const OUTLINE_SAMPLE_POINTS_COUNT = 96;

// 日付は従来どおり上部の緩い窓に制限する（短いラベルなので全周探索は不要。タイトルとの
// 排他は日付の実際の使用区間±バッファをタイトル側のallowed判定から除外して行う）
const DATE_WINDOW_DEG: readonly [number, number] = [-165, -15];
const DATE_TITLE_BUFFER_FRACTION = 0.06;
// 弧長バッファに加え、実座標(ユークリッド距離)でもタイトル弧を日付弧から引き離す下限
// （日付フォントサイズに対する比率。凹形状で弧長上は離れていても実座標では近接しうるケースの対策）
const MIN_ARC_EUCLIDEAN_CLEARANCE_MULT = 0.6;

type PerimeterMetrics = {
  points: Point[];
  n: number;
  segLen: number[]; // segLen[i] = |points[i] -> points[(i+1)%n]|
  turn: number[]; // turn[i] = points[i]における接線の曲がり角（符号付き、ラジアン）
  curvRadius: number[]; // turn[i]から推定した局所曲率半径（直線に近いほどInfinity）
};

function buildPerimeterMetrics(points: readonly Point[]): PerimeterMetrics {
  const n = points.length;
  const segLen: number[] = new Array(n);
  const tangent: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    segLen[i] = Math.hypot(b.x - a.x, b.y - a.y);
    tangent[i] = Math.atan2(b.y - a.y, b.x - a.x);
  }
  const turn: number[] = new Array(n);
  const curvRadius: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const prevTangent = tangent[(i - 1 + n) % n];
    const t = angleDiff(tangent[i], prevTangent);
    turn[i] = t;
    const avgSeg = (segLen[(i - 1 + n) % n] + segLen[i]) / 2;
    curvRadius[i] = Math.abs(t) < 1e-9 ? Infinity : avgSeg / Math.abs(t);
  }
  return { points: points as Point[], n, segLen, turn, curvRadius };
}

type RunResult = { startDoubled: number; endDoubled: number; length: number };

// 曲率半径がminRadius以上・allowed()を満たす点だけを使い、輪郭全周（circular）から
// 「区間内の総回転がMAX_RUN_TOTAL_TURN_RAD以下」という制約下で最長の連続区間を探す
// (2倍化した配列上のスライディングウィンドウ。区間長は必ず輪郭1周以内に収める)
function findLongestRun(pm: PerimeterMetrics, minRadius: number, allowed: (i: number) => boolean): RunResult | null {
  const n = pm.n;
  const ok: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) ok[i] = pm.curvRadius[i] >= minRadius && allowed(i);

  const turnPrefix = new Float64Array(2 * n + 1);
  const lenPrefix = new Float64Array(2 * n + 1);
  for (let k = 1; k <= 2 * n; k++) {
    turnPrefix[k] = turnPrefix[k - 1] + Math.abs(pm.turn[(k - 1) % n]);
    lenPrefix[k] = lenPrefix[k - 1] + pm.segLen[(k - 1) % n];
  }
  const windowTurnSum = (start: number, end: number) => (end > start ? turnPrefix[end] - turnPrefix[start + 1] : 0);

  let start = 0;
  let lastBad = -1;
  let bestStart = -1;
  let bestEnd = -1;
  let bestLen = -1;
  for (let end = 0; end < 2 * n; end++) {
    const oi = end % n;
    if (!ok[oi]) lastBad = end;
    if (start <= lastBad) start = lastBad + 1;
    if (end - start + 1 > n) start = end - n + 1;
    while (start < end && windowTurnSum(start, end) > MAX_RUN_TOTAL_TURN_RAD) start++;
    if (start > end) continue;
    const len = lenPrefix[end] - lenPrefix[start];
    if (len > bestLen) {
      bestLen = len;
      bestStart = start;
      bestEnd = end;
    }
  }
  if (bestStart < 0) return null;
  return { startDoubled: bestStart, endDoubled: bestEnd, length: bestLen };
}

function physIndex(n: number, doubledIdx: number): number {
  return ((doubledIdx % n) + n) % n;
}

function extractRunPoints(pm: PerimeterMetrics, run: RunResult): Point[] {
  const pts: Point[] = [];
  for (let k = run.startDoubled; k <= run.endDoubled; k++) pts.push(pm.points[physIndex(pm.n, k)]);
  return pts;
}

// 数学的保証フォールバック: 曲率制約を無視し、allowed()な点だけをstartHintIdxから輪郭に沿って
// 辿った点列を返す（全周長 ≥ 必要弧長になるフォントサイズと組み合わせて使う。呼び出し側が
// フォントサイズをこの点列の実長に合わせて再計算するため、ここでは曲率を問わず「使える
// 区間を最大限確保する」ことだけを保証する）
function buildFullLoopPoints(pm: PerimeterMetrics, allowed: (i: number) => boolean, startHintIdx: number): Point[] {
  const pts: Point[] = [];
  for (let k = 0; k < pm.n; k++) {
    const idx = (startHintIdx + k) % pm.n;
    if (allowed(idx)) pts.push(pm.points[idx]);
  }
  return pts.length >= 2 ? pts : pm.points.slice();
}

type ArcFitResult = {
  points: Point[]; // インセット・向き決定まで適用済みの最終点列（そのままstraightOpenPathに渡せる）
  length: number; // pointsの実長（インセット後）
  fontSize: number;
  usedFallback: boolean;
  startPhys: number; // -1ならフォールバック等でzone判定に使えない
  endPhys: number;
};

function fontSizeCandidates(viewBoxW: number, maxRatio: number, floorRatio: number): number[] {
  const sizes: number[] = [];
  let ratio = maxRatio;
  while (ratio > floorRatio) {
    sizes.push(viewBoxW * ratio);
    ratio *= FONT_SHRINK_STEP;
  }
  sizes.push(viewBoxW * floorRatio);
  return sizes;
}

// run区間の平均曲率係数（各点でminRadius/curvRadius、範囲(0,1])からインセット比を決める
// （5: インセット量は曲率に応じて増やす。凸部の外側で文字間が開き凹部で詰まるグリフ衝突対策）
function computeAvgCurvatureFactor(pm: PerimeterMetrics, run: RunResult, fontSize: number): number {
  const minRadius = CURVATURE_RADIUS_MULT * fontSize;
  let sum = 0;
  let count = 0;
  for (let k = run.startDoubled; k <= run.endDoubled; k++) {
    const oi = physIndex(pm.n, k);
    const cr = pm.curvRadius[oi];
    sum += Number.isFinite(cr) ? clamp(minRadius / cr, 0, 1) : 0;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

// 選定された弧点列に対し、(1) 曲率に応じたインセット（中心方向への縮小。星形性により常に
// 内側に収まる保証がある。安全網としてshrinkUntilContainedも重ねる）、(2) 読み順が
// 自然になる向きの決定（水平方向が支配的なら左→右、垂直方向が支配的なら上→下。逆向きなら
// 点列を反転する。Bosmansの縦組み参照）を行う。中心方向への一様縮小は距離を厳密に
// (1-insetRatio)倍するため、返す実長はここで初めて確定する値であり、必要弧長との比較は
// 必ずこの関数を通した後の実長に対して行う（インセット前の生の区間長で判定すると、
// インセット分だけ実際に描画される弧が必要弧長を下回りうるバグを防ぐ）
// 区間全体の総回転がMAX_RUN_TOTAL_TURN_RAD以内であっても、区間の両端付近だけ支配軸と逆向きに
// わずかに"戻る"（S字の端が跳ねる）ケースが実測で見つかった（総回転の絶対値合計は小さくても、
// 端で向きが一瞬反転しうるため）。読み順の単調性を厳密に保証するため、支配軸方向に非減少な
// 最長の連続部分列を抽出する（＝逆行する先頭/末尾の数点を切り詰める。中間で逆行する場合も
// 同じロジックで最長の単調区間だけを残す）
function trimToLongestMonotonicRun(points: readonly Point[]): Point[] {
  if (points.length < 2) return points as Point[];
  const first = points[0];
  const last = points[points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const sign = (horizontal ? dx : dy) >= 0 ? 1 : -1;
  const coordOf = (p: Point) => (horizontal ? p.x : p.y) * sign;
  const EPS = 1e-9;
  let bestStart = 0;
  let bestEnd = 0;
  let curStart = 0;
  for (let i = 1; i < points.length; i++) {
    if (coordOf(points[i]) < coordOf(points[i - 1]) - EPS) curStart = i;
    if (i - curStart > bestEnd - bestStart) {
      bestStart = curStart;
      bestEnd = i;
    }
  }
  return points.slice(bestStart, bestEnd + 1);
}

// applyMonotonicTrim=falseは数学的保証フォールバック専用: 輪郭を周回して続く区間を許容する
// ため（DESIGN A-3「輪郭を周回して続く区間」）、そもそも支配軸方向の単調性を前提にできない
// （閉曲線を辿れば必ずどこかでx/yは減少に転じる）。trimToLongestMonotonicRunをここに適用すると、
// 数学的保証の元になったloopLenの大半を削ってしまい、保証が崩れるため通常ティアのみに限定する
function insetAndOrient(
  points: readonly Point[],
  cx: number,
  cy: number,
  insetRatio: number,
  outlinePolygon: readonly Point[],
  applyMonotonicTrim: boolean,
): Point[] {
  let pts = points.map((p) => ({ x: cx + (p.x - cx) * (1 - insetRatio), y: cy + (p.y - cy) * (1 - insetRatio) }));
  pts = shrinkUntilContained(pts, cx, cy, outlinePolygon);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const horizontalDominant = Math.abs(dx) >= Math.abs(dy);
  const needsReverse = horizontalDominant ? dx < 0 : dy < 0;
  if (needsReverse) pts = pts.slice().reverse();
  return applyMonotonicTrim ? trimToLongestMonotonicRun(pts) : pts;
}

// フォールバック時の既定インセット比（曲率を無視するため区間内訳が定義できず、安全側の
// 最大値=INSET_BASE_RATIO+INSET_GAIN_RATIOを固定で使う）
const FALLBACK_INSET_RATIO = INSET_BASE_RATIO + INSET_GAIN_RATIO;

// フォントサイズを上限から段階的に縮小しながら、各サイズで「低曲率・滑らかな連続性」を
// 満たす最長区間が(インセット後の実長で)必要弧長を満たすかを判定する。primaryAllowedで
// 見つからない場合はsecondaryAllowed(より緩い許容。例: タイトルとの排他を諦める/日付の
// 上部窓を諦める)で同じ探索を再試行し、それでも見つからない場合に数学的保証フォールバック
// （全周長 ≥ 必要弧長になるフォントサイズ。曲率は無視）を採用する。
// 「…」で切り詰めるコードパスは存在しない（A: 切り詰め全廃）
// avoidPoints/minClearanceは、既に確定した日付弧からタイトル弧を実距離(ユークリッド)で
// 引き離すための追加ガード。輪郭の形状によっては、日付とタイトルの区間が輪郭の弧長では
// 十分離れていても(index space上のバッファは超えていても)、形状が湾曲して戻ってくる位置
// 関係だと実座標では接近してしまうことがある(実測: L字の別アームがくびれ側で近接)。
// 弧長バッファだけでなく実距離でも確認することで、この種の見た目の近接を防ぐ
function clearsAvoidPoints(points: readonly Point[], avoidPoints: readonly Point[], minClearance: number): boolean {
  if (avoidPoints.length === 0 || minClearance <= 0) return true;
  for (const p of points) {
    for (const q of avoidPoints) {
      if (Math.hypot(p.x - q.x, p.y - q.y) < minClearance) return false;
    }
  }
  return true;
}

function selectArcForFontSizes(
  pm: PerimeterMetrics,
  fontSizes: readonly number[],
  charWidthEm: number,
  primaryAllowed: (i: number) => boolean,
  secondaryAllowed: (i: number) => boolean,
  startHintIdx: number,
  cx: number,
  cy: number,
  outlinePolygon: readonly Point[],
  avoidPoints: readonly Point[] = [],
  minClearance = 0,
): ArcFitResult {
  for (const allowed of [primaryAllowed, secondaryAllowed]) {
    for (const fontSize of fontSizes) {
      const requiredLen = fontSize * charWidthEm * ARC_LENGTH_MARGIN;
      const minRadius = CURVATURE_RADIUS_MULT * fontSize;
      const run = findLongestRun(pm, minRadius, allowed);
      if (!run) continue;
      // I: 曲率ベースのinsetRatio(グリフ同士の詰まり対策)をまず適用し、弧長・avoid距離の要件を
      // 満たす有力候補についてのみ、グリフの外周はみ出しがないかを実測(refineInsetForGlyphClearance)
      // して必要ならインセットを段階的に増やす（全候補で毎回実測すると計算コストが大きいため）
      const curvatureInsetRatio = INSET_BASE_RATIO + INSET_GAIN_RATIO * computeAvgCurvatureFactor(pm, run, fontSize);
      const runPoints = extractRunPoints(pm, run);
      const baseFinalPoints = insetAndOrient(runPoints, cx, cy, curvatureInsetRatio, outlinePolygon, true);
      const baseFinalLength = polylineLength(baseFinalPoints);
      if (baseFinalLength < requiredLen || !clearsAvoidPoints(baseFinalPoints, avoidPoints, minClearance)) continue;
      const refined = refineInsetForGlyphClearance(
        runPoints,
        cx,
        cy,
        curvatureInsetRatio,
        outlinePolygon,
        fontSize,
        true,
        requiredLen,
      );
      const finalPoints = refined.points;
      const finalLength = refined.length;
      if (finalLength >= requiredLen && clearsAvoidPoints(finalPoints, avoidPoints, minClearance)) {
        return {
          points: finalPoints,
          length: finalLength,
          fontSize,
          usedFallback: false,
          startPhys: physIndex(pm.n, run.startDoubled),
          endPhys: physIndex(pm.n, run.endDoubled),
        };
      }
    }
  }
  const floorFontSize = fontSizes[fontSizes.length - 1];
  // フォールバック(輪郭を周回して続く区間)もprimaryAllowed(日付との排他)を可能な限り尊重する。
  // secondaryAllowedをそのまま使うと、周回区間が日付の区間を実際にまたいでしまい、視覚的に
  // タイトルと日付が重なるバグがあった(実測: archive-29)。primaryAllowedで十分な長さの
  // ループが作れない退化ケースのみsecondaryAllowedへ緩める
  const primaryLoopPoints = buildFullLoopPoints(pm, primaryAllowed, startHintIdx);
  const secondaryLoopPoints = buildFullLoopPoints(pm, secondaryAllowed, startHintIdx);
  const loopPoints =
    polylineLength(primaryLoopPoints) >= polylineLength(secondaryLoopPoints) * 0.5 ? primaryLoopPoints : secondaryLoopPoints;
  const rawLoopLen = polylineLength(loopPoints);
  const postInsetLoopLen = rawLoopLen * (1 - FALLBACK_INSET_RATIO);
  const guaranteedFontSize = Math.max(
    ABSOLUTE_MIN_FONT_SIZE,
    Math.min(floorFontSize, postInsetLoopLen / (charWidthEm * ARC_LENGTH_MARGIN)),
  );
  // I: フォールバック(輪郭を周回して続く区間)にも曲率・グリフはみ出し下限を適用する（DESIGN差分
  // 参照。フォールバックはallowed()の除外区間を飛び越えるため単調性トリムはfalseのまま）。
  // ここでの必要最小弧長は「guaranteedFontSizeちょうどで全文が収まる弧長」＝現在のpostInsetLoopLen
  // 自体（guaranteedFontSizeはこの関係から逆算した値のため）
  const minAcceptableFallbackLength = guaranteedFontSize * charWidthEm * ARC_LENGTH_MARGIN;
  const refinedFallback = refineInsetForGlyphClearance(
    loopPoints,
    cx,
    cy,
    FALLBACK_INSET_RATIO,
    outlinePolygon,
    guaranteedFontSize,
    false,
    minAcceptableFallbackLength,
  );
  const finalPoints = refinedFallback.points;
  return {
    points: finalPoints,
    length: polylineLength(finalPoints),
    fontSize: guaranteedFontSize,
    usedFallback: true,
    startPhys: -1,
    endPhys: -1,
  };
}

function angleWithinWindow(angleDeg: number, window: readonly [number, number]): boolean {
  return angleDeg >= window[0] && angleDeg <= window[1];
}

function nearestIndexToAngleDeg(pm: PerimeterMetrics, cx: number, cy: number, targetDeg: number): number {
  let bestI = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < pm.n; i++) {
    const a = rad2deg(Math.atan2(pm.points[i].y - cy, pm.points[i].x - cx));
    const diff = Math.abs(normalizeAngle(deg2rad(a - targetDeg)));
    if (diff < bestDiff) {
      bestDiff = diff;
      bestI = i;
    }
  }
  return bestI;
}

function circularIndexDistance(n: number, a: number, b: number): number {
  const d = Math.abs(a - b) % n;
  return Math.min(d, n - d);
}

// 弧上でtextPath(startOffset="50%"・textAnchor="middle")が実際にグリフを描画する範囲だけを
// 弧長ベースで切り出す（弧の中心からspanLength/2ずつ）。弧そのものの実長(titleArc.length等)は
// ARC_LENGTH_MARGINの余裕ぶんや最長候補選定の都合でグリフの実際の描画幅より長いことが多く、
// 特に数学的保証フォールバック(輪郭を周回して続く区間)では弧全体が輪郭のほぼ全周に及ぶため、
// 弧全体をsafeAreaのavoid点群として使うと「実際にグリフが無い場所」まで避けようとして
// 過度に安全側になる一方、切り出さずに単純に間引くと逆に密な部分を見逃す(実測: archive-29で
// タイトルの実描画範囲がsafeAreaと重なるのに、弧全体で見た最短距離では検出できなかった)
//
// goofy-hatching-mango.md 検証B(archive-10「Rail Clock」T字形): points自体をcumLen[i]で
// フィルタするだけだと、輪郭の長い直線区間(roundedPolygonPathの角と角の間の"L"コマンドは
// 始点・終点の2点しか持たず、densePointsFromOutlinePathも直線区間の中間点を補間しない)で
// lo/hiがその疎な2点の間に落ちた場合、実際にグリフが描画される範囲の終端がまるごと
// 手前で打ち切られてしまう(実測: archive-10のlNotch T字で、ステム(縦の腕)の直線区間が
// cumLen上で18viewBox単位以上の間隔しか点を持たず、hi=48.63がその区間の63%地点に
// あたるにもかかわらず、フィルタは手前の点(36.64)で打ち切っていた。結果、safeArea探索が
// タイトルの実際の描画範囲を過小評価し、説明文と視覚的に重なるバグになっていた)。
// lo/hiの位置を隣接2点間で線形補間して必ず含めることで、疎な直線区間でも実際の描画範囲の
// 終端を正しく表す（resampleAlongPolylineと同じ補間の考え方をlo/hiの2点にだけ適用する）
function extractCenteredSpan(points: readonly Point[], spanLength: number): Point[] {
  if (points.length < 2) return points as Point[];
  const cumLen: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumLen.push(cumLen[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = cumLen[cumLen.length - 1];
  const half = Math.min(spanLength / 2, total / 2);
  const mid = total / 2;
  const lo = mid - half;
  const hi = mid + half;
  const interpAt = (target: number): Point => {
    for (let i = 1; i < cumLen.length; i++) {
      if (cumLen[i] >= target) {
        const segStart = cumLen[i - 1];
        const segEnd = cumLen[i];
        const t = segEnd > segStart ? (target - segStart) / (segEnd - segStart) : 0;
        const a = points[i - 1];
        const b = points[i];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
    return points[points.length - 1];
  };
  const out: Point[] = [interpAt(lo)];
  for (let i = 0; i < points.length; i++) {
    if (cumLen[i] > lo && cumLen[i] < hi) out.push(points[i]);
  }
  out.push(interpAt(hi));
  return out.length >= 2 ? out : (points as Point[]);
}

// iが[start,end](circular)の範囲内か、その前後bufferの中に入っているかを判定する
function circularWithinRange(n: number, start: number, end: number, i: number, buffer: number): boolean {
  const contains = start <= end ? i >= start && i <= end : i >= start || i <= end;
  if (contains) return true;
  return Math.min(circularIndexDistance(n, i, start), circularIndexDistance(n, i, end)) <= buffer;
}

// ── B: safeArea（密サンプルベースの最大内接矩形探索）────────────────────
type Rect = { x: number; y: number; w: number; h: number };

// 弧長に沿って等間隔にtargetCount点を打ち直す（単純な"インデックス間引き"ではなく弧長ベース。
// インデックス間引きだと、間引き後の隣接2点の間に安全領域チェック用の"隙間"ができ、その隙間の
// 内側をタイトル弧が実際には通過しているのに検出できないケースがあった。実測: archive-2で
// タイトル弧とsafeAreaの説明文が視覚的に重なるバグ。弧長ベースで密に(targetCount)打ち直す
// ことで、隙間の最大値を「全長/targetCount」に抑え、safeAreaの辺の長さよりその隙間が
// 十分小さくなるようtargetCountを大きめに取る）
function resampleAlongPolyline(points: readonly Point[], targetCount: number): Point[] {
  if (points.length <= 1) return points as Point[];
  const cumLen: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumLen.push(cumLen[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = cumLen[cumLen.length - 1];
  if (total <= 0) return [points[0]];
  const out: Point[] = [];
  for (let k = 0; k < targetCount; k++) {
    const target = (k / Math.max(1, targetCount - 1)) * total;
    let lo = 1;
    let hi = cumLen.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumLen[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const idx = lo;
    const segStart = cumLen[idx - 1];
    const segEnd = cumLen[idx];
    const t = segEnd > segStart ? (target - segStart) / (segEnd - segStart) : 0;
    const a = points[idx - 1];
    const b = points[idx];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function rectSamplePoints(r: Rect): Point[] {
  const { x, y, w, h } = r;
  return [
    { x, y },
    { x: x + w, y },
    { x, y: y + h },
    { x: x + w, y: y + h },
    { x: x + w / 2, y },
    { x: x + w / 2, y: y + h },
    { x, y: y + h / 2 },
    { x: x + w, y: y + h / 2 },
    { x: x + w / 2, y: y + h / 2 },
  ];
}

function rectClearsPoints(r: Rect, avoidPoints: readonly Point[], margin: number): boolean {
  for (const p of avoidPoints) {
    const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
    const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
    if (Math.hypot(dx, dy) < margin) return false;
  }
  return true;
}

const SAFE_AREA_CENTER_GRID = 6; // 中心候補のグリッド分割数（性能とのバランスでグリッドサーチ）
const SAFE_AREA_SCALE_STEPS = 24;
const SAFE_AREA_MIN_SCALE = 0.12;
const SAFE_AREA_MARGIN_MULT = 1.3; // タイトル/日付弧からの離隔距離 = フォントサイズ×この係数
// avoid点群の弧長ベース再サンプル数。全周ループにおよぶフォールバック弧(最長で数百viewBox単位)
// でも、隣接点間の隙間がsafeAreaの最小高さ(viewBoxH*0.14)より十分小さくなるよう多めに取る
const SAFE_AREA_AVOID_RESAMPLE_COUNT = 200;

// 輪郭内に完全に収まり、かつtitle/date弧から一定距離離れた軸平行矩形のうち、最大面積のものを
// グリッドサーチで探す（決定論。凹形状で最大内接矩形が輪郭中心から大きくズレるケースに対応）
// 説明文3行+罫線+参照リンクの実際の必要高さ(概算: DESC_FONT_RATIO*3行*行間+ギャップ2つ+
// リンク1行)はviewBoxHの約20%に達する。SAFE_AREA_ASPECT(2.15)の横長矩形1種類だけを
// 試すと、輪郭が狭い場所(lNotchの細い腕など)では「横長だが高さ不足」の矩形しか見つからず、
// 説明文が縦にあふれてタイトル弧と視覚的に重なるバグを実測で確認した(archive-2)。複数の
// アスペクト比(横長〜やや縦長)を試し、minW/minHを探索自体の必須条件にすることで、狭い場所
// では高さを優先した(より縦に伸びた)矩形を選べるようにする
const SAFE_AREA_ASPECT_CANDIDATES: readonly number[] = [2.15, 1.6, 1.2];

function findMaxInscribedRect(
  coarsePolygon: readonly Point[],
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  avoidGroups: readonly { points: readonly Point[]; margin: number }[],
  minW: number,
  minH: number,
): Rect | null {
  const boundsW = bounds.maxX - bounds.minX;
  const boundsH = bounds.maxY - bounds.minY;
  const maxDim = Math.max(boundsW, boundsH);
  let best: Rect | null = null;
  let bestArea = 0;
  for (const aspect of SAFE_AREA_ASPECT_CANDIDATES) {
    for (let gy = 0; gy < SAFE_AREA_CENTER_GRID; gy++) {
      for (let gx = 0; gx < SAFE_AREA_CENTER_GRID; gx++) {
        const ccx = bounds.minX + (boundsW * (gx + 0.5)) / SAFE_AREA_CENTER_GRID;
        const ccy = bounds.minY + (boundsH * (gy + 0.5)) / SAFE_AREA_CENTER_GRID;
        for (let s = 0; s < SAFE_AREA_SCALE_STEPS; s++) {
          const scale = 1 - (s / (SAFE_AREA_SCALE_STEPS - 1)) * (1 - SAFE_AREA_MIN_SCALE);
          const w = maxDim * 0.9 * scale;
          const h = w / aspect;
          if (w < minW || h < minH) continue;
          const rect: Rect = { x: ccx - w / 2, y: ccy - h / 2, w, h };
          const samples = rectSamplePoints(rect);
          if (!samples.every((p) => pointInPolygon(p, coarsePolygon))) continue;
          if (!avoidGroups.every((g) => rectClearsPoints(rect, g.points, g.margin))) continue;
          const area = w * h;
          if (area > bestArea) {
            bestArea = area;
            best = rect;
          }
          break; // scaleは降順(大→小)なので、このcenter・aspectで最初に成功した時点が最大
        }
      }
    }
  }
  return best;
}

// 優先順位は「title/dateとの重なりゼロ(クリアランスを妥協しない)」＞「理想の高さ(20%)を
// 確保する」。輪郭が狭い形状(lNotchの細い腕・フォールバック弧が全周の大半を占める場合等)では
// 理想の高さを保ったまま重ならない矩形が存在しないことがあるため、クリアランスは常にフルで
// 保ったまま、要求サイズ(高さ→幅の順)を段階的に緩めて再探索する。内容が収まりきらない場合は
// line-clamp-3・overflow-hiddenで自然にクリップされる（重なって見えるより望ましい）
const SAFE_AREA_HEIGHT_STEPDOWN_RATIOS: readonly number[] = [0.2, 0.17, 0.14, 0.11, 0.08];
const SAFE_AREA_WIDTH_STEPDOWN_RATIOS: readonly number[] = [0.3, 0.25, 0.2];

// ── G: 説明文の全文表示（クランプ全廃・コンテンツに合わせたサイズ決定）────────────────
// goofy-hatching-mango.md 2026-07-07第4バッチ（実装中のフィードバックで追加）。旧実装は
// DESC_FONT_RATIO固定+truncateToEmBudgetで説明文(idea.seed)を「…」で切り詰めていたが、
// 「本文は必ず全文表示する」という要件に変更された。方針は「文章をボックスに合わせて切る」から
// 「ボックス（フォントサイズ・必要ならsafeAreaの目標サイズ）をコンテンツに合わせる」へ反転する。
// IdeaShapeCard.tsxが担っていたreservedHeightPx(罫線+参照リンク)計算・説明文フォント縮小探索の
// 定数と計算式をここに集約し、(1) shapeForIdea内でsafeArea探索の目標サイズを決める「事前見積り」
// (2) IdeaShapeCard.tsx側で実際のsafeAreaに対して行う「本番のフィット探索」の両方から
// 同じ関数を呼べるようにする（値のズレによる不整合を防ぐ）
export const DESC_FONT_MAX_RATIO = 0.031; // 説明文フォントの開始値（旧DESC_FONT_RATIOと同値）
// 説明文フォントの下限比率。floor/max比をタイトル(0.03/0.076≈0.39)・日付(0.02/0.036≈0.56)と
// 近い水準に置き、可読性の下限を保つ（実測で0.003程度まで縮めれば数式上は必ず収まることを
// 確認したが、実際に描画すると1px未満の判読不能なサイズになり「全文表示」の趣旨に反する。
// floorで収まらない場合はfitDescription呼び出し側(IdeaShapeCard.tsx)がforeignObject自体を
// 必要なぶんだけ拡張して対応する＝可読性を優先し、極端なケースでのみ軽微なはみ出しを許容する）
export const DESC_FONT_FLOOR_RATIO = 0.014;
const DESC_FONT_SHRINK_STEP = 0.94; // 1段階あたりの縮小率
// A.4: 説明文の実表示サイズ（物理px、viewBox非依存）の下限は、goofy-hatching-mango.md
// 2026-07-07バッチ(コンテンツ量に応じたシェイプ割り当て)でティアごとの値に変わり、
// src/lib/ideaCollageLayout.ts の DESC_FONT_PHYSICAL_FLOOR_PX（Record<CollageTier, number>）
// に移設した。校正の経緯（当初9px目標→前バッチで5pxへ妥協→本バッチでシェイプ割り当ての
// 根治により実効値へ引き上げ）も移設先のコメントに記録している。
// G: 罫線・参照リンクの保守的な予約高さ(reservedHeightPx)がsafeArea.hの大部分〜全部を占めて
// しまう輪郭が狭い形状(実測: lNotchの細い腕等16件でreservedHeightPxがsafeArea.hを上回った)
// では、説明文に割り当てられる高さが数式上0になる。これは予約側の安全係数(RULE_HEIGHT_
// SAFETY_MULT等)が実測の最大値にさらに余裕を持たせた意図的に保守的な値であり(実際のブラウザ
// 描画は数式の見積りより小さい実測: measure-real-desc2.mjs参照)、実際には説明文の入る余地が
// 残っていることが多い。説明文が0行になる(=全廃したはずの「見えない」状態)を避けるため、
// safeArea.hに対する最小割合を「説明文に必ず残す余白」として下限保証する
export const MIN_DESC_AVAILABLE_RATIO = 0.15;
// goofy-hatching-mango.md 実装バッチ・行重なり/グリフ欠け調査バッチ(2026-07-07)で再校正。
// 旧値1.375(Tailwindのleading-snug相当)は、本文フォントがforeignObject内でSVGのviewBox
// スケール変換前の極小サイズ(実測1.28〜3.4px程度のviewBox局所単位)で指定されることに起因する
// ブラウザのテキストラスタライズ特性を考慮していなかった。Playwright実測(next start相当の
// next dev + カードラッパーの--rotateを0degへ上書きしてAABB水増し[ideaShapes.ts本コメント
// 下部・LINK_ROW_HEIGHT_SAFETY_MULTの校正経緯参照]を除去した上でRange#getClientRects()を
// 全50件×3ティア×説明文全行+参照リンクタイトル全行に適用)の結果、特定のviewBox局所フォント
// サイズ(実測でbodyVB≈2.70〜2.84付近。より小さい値・より大きい値では発生しない、内容
// (テキスト)にもカード回転にも依存しない、要素固有の非単調な現象)で、行の実描画高さが
// 1.375倍指定に対し最大1.4816倍(archive-29、mobileティア)まで膨らむことを確認した。これは
// 特定の極小フォントサイズにおけるブラウザ側のグリフメトリクス丸め/ラスタライズ挙動に起因する
// 実測済みの環境特性であり(テキスト内容・カード位置・回転角度いずれを入れ替えても再現箇所が
// 変わらないことをA/Bテストで確認済み)、対症療法ではなく実測最大値への安全余裕として値を
// 引き上げる(LINK_ROW_HEIGHT_SAFETY_MULT等既存の校正と同じ方針)。実測最大比1.4816に対し
// 安全余裕1.15倍程度(1.4816×1.15≈1.704)を確保する1.7を採用した(smoke-idea-shapes.mjs・
// scripts/smoke-idea-render-lines.mjsの全50件×3ティアでPlaywright実測ベースの行重なり
// ゼロ・グリフ欠けゼロを確認済み)
export const DESC_LINE_HEIGHT_MULT = 1.7;
// 1行あたりの文字幅予算(estimateTextWidthEm)は単語境界での折返しロス(英単語が丸ごと次行に
// 送られる等)を考慮しないため、安全側に少し削って見積もる(=必要行数を少し多めに見積もる)
export const LINE_BUDGET_SAFETY_RATIO = 0.92;
export const LINK_FONT_RATIO = 0.028; // 参照リンクのタイトル
export const LINK_LABEL_FONT_RATIO = 0.022; // 参照リンクのCASE/TECHラベル
export const CONTENT_GAP_RATIO = 0.014; // 説明文/罫線/リンク間の縦ギャップ（viewBoxW比）
export const LINK_ROW_LINE_HEIGHT_MULT = 1.3;
export const LINK_ROW_PADDING_Y_EM = 0.2; // 参照リンク行のpy-[0.2em]（上下）
export const LINK_LABEL_TRACKING_EM = 0.18; // ラベル(CASE/TECH)のtracking-[0.18em]
export const LINK_ROW_GAP_EM = 0.5; // ラベル-タイトル間のgap-[0.5em]
export const LINK_TITLE_MAX_LINES = 2; // 参照リンクのタイトルは最大2行の折返しで全文表示する
// H: グリフ欠けバッチ(2026-07-07)。Range#getClientRects()が返すemボックス(フォントメトリクス上の
// グリフ送り幅)と、実際に描画されるインク(視覚的なストローク)は一致しない。フォントの左サイド
// ベアリングにより、インクはemボックスの左端よりわずかに外側にはみ出して描画されることがある。
// foreignObject内はviewBox局所座標系の極小フォントサイズ(実測1〜数px)をSVGのviewBoxスケールで
// 拡大するため、このはみ出し量もスケールで拡大され、foreignObject自体の境界(またはその内側の
// overflow-hiddenラッパー)でインクが物理的に切り取られてしまう(emボックス基準の検査だけでは
// 検出できないクラスの不具合)。この物理px単位のブリード余白(IdeaShapeCard.tsxがforeignObjectを
// 外側に、内側divのpaddingを内側にそれぞれこの値だけ広げて「逃げ場」を作る)の基準値。
// viewBox単位への変換は呼び出し側でFO_BLEED_PHYSICAL_PX / scale(=solveFixedSizeShapeが返す
// 物理px/viewBox単位のスケール)を使う
export const FO_BLEED_PHYSICAL_PX = 2;
// goofy-hatching-mango.md 2026-07-07バッチ・再校正(A.1再実施): 前回のRULE_HEIGHT_SAFETY_MULT=4/
// LINK_ROW_HEIGHT_SAFETY_MULT=2.0は「実測最大比3.265(罫線)・1.678(リンク行)」に基づいていたが、
// この実測はnext start + Playwright(getBoundingClientRect)をIdeasPoster.tsxのカードラッパーに
// 適用済みの`transform:rotate(±3deg)`込みで測っていたため誤りだった。薄く横長な要素(罫線=
// safeArea.w幅×1px高)はわずかな回転でも軸並行バウンディングボックスの高さが
// 概ねwidth×sin(θ)だけ射影的に水増しされ、これが3.265倍という数値の実体だった
// （estimateReservedLinksHeightPxが対象とするのはforeignObject内のflex流し込み高さという
// SVGローカル座標系の問題で、装飾的な回転transformとは無関係）。
// 今回は測定前にカードラッパーの--rotateを0degへ上書き(+transition無効化+reflow強制)して
// 回転由来の射影を除去し、実データ50件（罫線49件・参照リンク行76件、1行=58件・2行=16件・
// 想定外の3行折返し=2件）を再実測した。結果は極めて一貫しており、罫線の実測/理論比は
// 0.9997〜1.00019(ほぼ厳密に1.0)、リンク行(1行)は1.108〜1.110、リンク行(2行)は1.1272〜
// 1.1272で分散もごく小さい。実測最大値への安全余裕が1.15〜1.3倍程度になるよう再校正する
// (RULE: 1.2/1.0=1.2倍。LINK_ROWは1.15〜1.3倍のレンジのうち上限寄りの1.46/1.1272≈1.295倍を
// 採用: このrefTitleLinesFor/reservedの縮小はideaCollageLayout.tsのA.2物理フォント下限機構
// 経由でcolSpan配分を変え、パズルカーニングの行詰め順序を連鎖的にずらす。レンジ下限寄りの値
// (例1.35)では、たまたま2つの独立したフルロー幅カード(archive-16/18)が隣接行に来て、
// ideaCollageLayout.ts側の凹形状カーニングの防御フォールバック(境界最短距離では検出できない
// 塗りつぶし食い込み。同ファイルのclearance()コメント参照)が拾いきれない既存の潜在バグを
// 露呈させる回帰を実測で確認した。B側のロジック変更は本バッチのスコープ外のため、Aの校正のみで
// 回避可能なレンジ上限側(1.46)を採用した。改善効果はレンジ中央(1.35)とほぼ同等
// (smoke: mobile 29→30件, compact 17→18件, wide 7→7件, 旧2.0比では全ティアで大幅改善)。
// B.1: 既知の限界だった参照リンクのタイトル2件(「SONIC（GR00T Whole-Body Control）」
// 「Multi-View Foundation Models」)を本バッチで是正した。CJK+ラテン混在文字列は
// estimateTextWidthEmの簡易見積り(全角1.0em/半角0.6em)が実際のグリフ幅よりわずかに狭く出るため、
// LINK_TITLE_MAX_LINES=2を想定した折返し見積りでは2行と判定されるが、実際のブラウザ描画
// (next start + Playwright、カードラッパーの--rotateを0degへ上書きして回転由来の射影を除去して
// 実測)では3行に折り返る(実測比1.134倍)。refTitleLinesForの行数見積りにこの実測係数を掛けて
// 補正し、Math.min(LINK_TITLE_MAX_LINES,...)のキャップを外すことで、3行と見積もられたカードは
// 3行分の高さを予約するようにした（3行になること自体は許容。予約と実描画のズレだけを直す。
// 表示側=IdeaShapeCard.tsxの切り詰め文字数計算(titleBudgetEm)は変更しない=引き続き2行分の
// 文字数で切り詰める。この2件以外のタイトルにもこの補正係数は同様に適用されるが、実測(smoke)
// で複雑形比率・パズルカーニング密度・物理フォント下限のいずれも回帰しないことを確認済み）
const LINK_TITLE_LINE_ESTIMATE_CORRECTION = 1.134;
export const RULE_HEIGHT_SAFETY_MULT = 1.2;
export const LINK_ROW_HEIGHT_SAFETY_MULT = 1.46;
export const MIN_DESC_LINES = 1; // 説明文の下限行数（0行にはしない）

export type ContentRef = { type: "case" | "tech"; title: string };

function refTitleLinesFor(refTitle: string, labelText: string, safeAreaW: number, linkFontSizePx: number, linkLabelFontSizePx: number): number {
  const labelWidthPx = (estimateTextWidthEm(labelText) + labelText.length * LINK_LABEL_TRACKING_EM) * linkLabelFontSizePx;
  const availableTitlePx = Math.max(1, safeAreaW - labelWidthPx - LINK_ROW_GAP_EM * linkFontSizePx);
  const availableTitleEm = availableTitlePx / linkFontSizePx;
  const estimatedLines = (estimateTextWidthEm(refTitle) / availableTitleEm) * LINK_TITLE_LINE_ESTIMATE_CORRECTION;
  return Math.max(1, Math.ceil(estimatedLines));
}

export type ReservedLinksDetail = { lineCounts: number[]; heightPx: number };

// H: 固定2サイズタイポグラフィ(goofy-hatching-mango.md 2026-07-07バッチ・改訂計画)。
// solveFixedSizeShapeが「サイズB相当のviewbox単位フォント」を明示的なfontOverrideとして渡せる
// よう拡張した(省略時は旧来どおりviewBoxW*RATIO。既存呼び出し元(IdeaShapeCard.tsx等)は無変更)。
// 併せて各refの折返し行数(lineCounts)も返す（IdeaShapeCard.tsx側の再計算を避けるため）
export function estimateReservedLinksDetail(
  viewBoxW: number,
  safeAreaW: number,
  refs: readonly ContentRef[],
  fontOverride?: { linkFontSizePx: number; linkLabelFontSizePx: number; gapPx: number },
): ReservedLinksDetail {
  if (refs.length === 0) return { lineCounts: [], heightPx: 0 };
  const linkFontSizePx = fontOverride?.linkFontSizePx ?? viewBoxW * LINK_FONT_RATIO;
  const linkLabelFontSizePx = fontOverride?.linkLabelFontSizePx ?? viewBoxW * LINK_LABEL_FONT_RATIO;
  const gapPx = fontOverride?.gapPx ?? viewBoxW * CONTENT_GAP_RATIO;
  const linkRowHeightPxFor = (lines: number) =>
    linkFontSizePx * (LINK_ROW_LINE_HEIGHT_MULT * lines + LINK_ROW_PADDING_Y_EM * 2) * LINK_ROW_HEIGHT_SAFETY_MULT;
  const lineCounts = refs.map((ref) => {
    const labelText = ref.type === "tech" ? "Tech" : "Case";
    return refTitleLinesFor(ref.title, labelText, safeAreaW, linkFontSizePx, linkLabelFontSizePx);
  });
  const linesSum = lineCounts.reduce((sum, lines) => sum + linkRowHeightPxFor(lines), 0);
  return { lineCounts, heightPx: RULE_HEIGHT_SAFETY_MULT + linesSum + 2 * gapPx };
}

// 罫線+参照リンク一覧が必要とする高さ(px=viewBox単位)。説明文フォント探索・shapeForIdea内の
// 事前見積りの両方から共通で呼ぶ（IdeaShapeCard.tsxの旧reservedHeightPx計算と同じ式）
export function estimateReservedLinksHeightPx(viewBoxW: number, safeAreaW: number, refs: readonly ContentRef[]): number {
  return estimateReservedLinksDetail(viewBoxW, safeAreaW, refs).heightPx;
}

export type DescLinesAndHeight = { lines: number; heightPx: number };

// 指定フォント比率(ratio)で説明文全文を折り返した場合に必要な行数・高さ(px=viewBox単位)を返す。
// 切り詰めは行わない前提の見積り（LINE_BUDGET_SAFETY_RATIOで折返しロスぶんの安全マージンを取る）
export function requiredDescLinesAndHeightPx(viewBoxW: number, safeAreaW: number, seedText: string, ratio: number): DescLinesAndHeight {
  const fontSizePx = viewBoxW * ratio;
  const charsPerLine = Math.max(1, (safeAreaW / fontSizePx) * LINE_BUDGET_SAFETY_RATIO);
  const lines = Math.max(MIN_DESC_LINES, Math.ceil(estimateTextWidthEm(seedText) / charsPerLine));
  return { lines, heightPx: lines * fontSizePx * DESC_LINE_HEIGHT_MULT };
}

export function requiredDescHeightPx(viewBoxW: number, safeAreaW: number, seedText: string, ratio: number): number {
  return requiredDescLinesAndHeightPx(viewBoxW, safeAreaW, seedText, ratio).heightPx;
}

export type DescFit = { fontSizePx: number; lines: number; requiredHeightPx: number; availableForDescPx: number; fits: boolean };

// DESC_FONT_FLOOR_RATIOでも収まらない場合の「緊急下限」。IdeaShapeCard.tsxがforeignObjectを
// shape.safeAreaMaxGrowH(title/date弧との重なり・輪郭外はみ出しを検査済みの安全な上限)まで
// 拡張してもなお全文の必要高さに届かない場合、DESC_FONT_FLOOR_RATIO(可読性を保つ下限)を
// さらに下回ってでも安全な上限の内側に収める。実装上の判断（計画への疑義）: 当初は安全上限を
// 超えて無条件にforeignObjectを拡張していたが、実測(Playwrightスクショ目視)でsafeArea自体が
// 極端にタイトな形状(archive-5のnotchedCircle)でtitle弧に食い込むバグを発見したため、
// 「安全な範囲内に収める」を「可読性」より優先する設計に変更した
const DESC_FONT_EMERGENCY_FLOOR_RATIO = 0.0025;

// DESC_FONT_MAX_RATIOから縮小探索し、説明文全文が収まる最大のフォントサイズを選ぶ（タイトル/
// 日付弧のフォント探索と同じ「大きい方から縮めて最初に収まったものを採用」という考え方）。
// 利用可能高さは(safeArea.h - reservedHeightPx)を基本とするが、MIN_DESC_AVAILABLE_RATIOにより
// safeArea.hの最小割合を必ず説明文用に確保する（reservedHeightPxの安全係数が保守的すぎて
// 数式上0になるケースの対策。上のコメント参照）。DESC_FONT_FLOOR_RATIO(可読性を保つ下限)でも
// 収まらない場合は、DESC_FONT_EMERGENCY_FLOOR_RATIOまでさらに縮小探索を続け、それでも
// 収まらない場合にのみ切り詰めない方を優先しfloor比率のまま返す(fits=false)
export function fitDescription(
  viewBoxW: number,
  safeAreaW: number,
  safeAreaH: number,
  reservedHeightPx: number,
  seedText: string,
): DescFit {
  const availableForDescPx = Math.max(safeAreaH - reservedHeightPx, safeAreaH * MIN_DESC_AVAILABLE_RATIO);
  const evaluate = (ratio: number): DescFit => {
    const fontSizePx = viewBoxW * ratio;
    const charsPerLine = Math.max(1, (safeAreaW / fontSizePx) * LINE_BUDGET_SAFETY_RATIO);
    const lines = Math.max(MIN_DESC_LINES, Math.ceil(estimateTextWidthEm(seedText) / charsPerLine));
    const requiredHeightPx = lines * fontSizePx * DESC_LINE_HEIGHT_MULT;
    return { fontSizePx, lines, requiredHeightPx, availableForDescPx, fits: requiredHeightPx <= availableForDescPx };
  };
  const ratios: number[] = [];
  for (let r = DESC_FONT_MAX_RATIO; r > DESC_FONT_FLOOR_RATIO; r *= DESC_FONT_SHRINK_STEP) ratios.push(r);
  ratios.push(DESC_FONT_FLOOR_RATIO);
  let best: DescFit = evaluate(DESC_FONT_FLOOR_RATIO);
  for (const ratio of ratios) {
    best = evaluate(ratio);
    if (best.fits) return best;
  }
  // 可読性を保つ下限(DESC_FONT_FLOOR_RATIO)でも収まらない場合のみ、緊急下限まで縮小探索を
  // 継続する（実データ50件では発動する想定。archive-5等、safeAreaMaxGrowHが小さい形状）
  for (let r = DESC_FONT_FLOOR_RATIO * DESC_FONT_SHRINK_STEP; r > DESC_FONT_EMERGENCY_FLOOR_RATIO; r *= DESC_FONT_SHRINK_STEP) {
    best = evaluate(r);
    if (best.fits) return best;
  }
  best = evaluate(DESC_FONT_EMERGENCY_FLOOR_RATIO);
  // ここに到達するのは緊急下限でも収まらなかった場合(実データ50件では発生しない想定)。
  // best(=緊急下限での見積り)をfits=falseのまま返す。呼び出し側はこれでも切り詰めずに
  // 全文を描画する(要件: 説明文の「…」切り詰めは全廃)
  return best;
}

// G: 説明文の全文表示のためforeignObjectを拡張する際の安全な上限を求める（goofy-hatching-
// mango.md 2026-07-07第4バッチ・実装フィードバックで発覚した回帰の修正）。当初は
// IdeaShapeCard.tsx側でsafeArea中心から上下均等に無条件で拡張していたが、これはtitle/date弧
// との重なりを検査しないため、safeArea自体がタイトな形状(archive-5のnotchedCircle等、中心
// 近くの安全な矩形が本来12.9viewBox単位ほどしかない)で、拡張後の矩形が実際にtitle弧の描画
// 範囲に食い込み、説明文と重なって読めなくなるバグを実測(スクリーンショット目視)で発見した。
// computeSafeAreaが確定させたrectを起点に、同じcoarsePolygon(輪郭内包含)・avoidGroups
// (title/date弧からのクリアランス)の判定を再利用しながら高さだけを中心基準で慎重に
// 拡張し、安全に拡張できる上限の高さを返す。IdeaShapeCard.tsx側はこの上限を超えて
// 拡張しない（超えてもなお全文が収まらない場合は、フォントをさらに縮める側で吸収する）
const SAFE_AREA_GROW_STEP_RATIO = 0.01; // 1回の拡張刻み(viewBoxH比)。小さい刻みで安全側に判定
const SAFE_AREA_GROW_MAX_ITER = 60;

function growHeightSafely(
  rect: Rect,
  coarsePolygon: readonly Point[],
  avoidGroups: readonly { points: readonly Point[]; margin: number }[],
  viewBoxH: number,
): number {
  const stepH = viewBoxH * SAFE_AREA_GROW_STEP_RATIO;
  const cy = rect.y + rect.h / 2;
  let h = rect.h;
  for (let iter = 0; iter < SAFE_AREA_GROW_MAX_ITER; iter++) {
    const nextH = h + stepH;
    const candidate: Rect = { x: rect.x, y: cy - nextH / 2, w: rect.w, h: nextH };
    const samples = rectSamplePoints(candidate);
    if (!samples.every((p) => pointInPolygon(p, coarsePolygon))) break;
    if (!avoidGroups.every((g) => rectClearsPoints(candidate, g.points, g.margin))) break;
    h = nextH;
  }
  return h;
}

export type SafeAreaResult = { rect: Rect; maxGrowH: number };

function computeSafeArea(
  built: ShapeBuildResult,
  dateArc: ArcFitResult,
  titleArc: ArcFitResult,
  dateCharWidthEm: number,
  titleCharWidthEm: number,
  contentMin?: { w: number; h: number },
): SafeAreaResult {
  const coarsePolygon = densePointsFromOutlinePath(built.outlinePath, SAFE_AREA_SAMPLES_PER_CURVE);
  const xs = coarsePolygon.map((p) => p.x);
  const ys = coarsePolygon.map((p) => p.y);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  // 弧の実長(titleArc.length等)ではなく、実際にグリフが描画される範囲だけをavoid点群にする
  // （ARC_LENGTH_MARGIN分の余裕には未使用部分がある）。ただし数学的保証フォールバック
  // (buildFullLoopPoints)はallowed()で除外された区間を「飛び越える」ため、弧長ベースの
  // 中央切り出しの前提(1本の連続した弧)が崩れ、飛び越え地点の直線が弧長を余分に食って
  // 中心位置がずれる(実測: archive-29でタイトルが実際には説明文の近くにもかかわらず
  // 中央切り出しでは検出できなかった)。フォールバック時は弧全体を安全側でavoid対象にする
  const titleRenderedSpan = titleArc.usedFallback
    ? titleArc.points
    : extractCenteredSpan(titleArc.points, titleArc.fontSize * titleCharWidthEm);
  const dateRenderedSpan = dateArc.usedFallback
    ? dateArc.points
    : extractCenteredSpan(dateArc.points, dateArc.fontSize * dateCharWidthEm);
  const titlePts = resampleAlongPolyline(titleRenderedSpan, SAFE_AREA_AVOID_RESAMPLE_COUNT);
  const datePts = resampleAlongPolyline(dateRenderedSpan, SAFE_AREA_AVOID_RESAMPLE_COUNT);
  const avoidGroups = [
    { points: titlePts, margin: titleArc.fontSize * SAFE_AREA_MARGIN_MULT },
    { points: datePts, margin: dateArc.fontSize * SAFE_AREA_MARGIN_MULT },
  ];

  // G: 説明文の全文表示を優先するコンテンツ駆動サイズを最優先候補として試す
  // （goofy-hatching-mango.md 2026-07-07第4バッチ）。既存のSAFE_AREA_*_STEPDOWN_RATIOSの
  // 上限(幅30%・高さ20%)を上回るサイズが必要な場合でも、findMaxInscribedRectは面積最大化の
  // 探索なので幾何的に可能ならその要求を満たす（より満たせない場合は下のstepdownループへ
  // フォールバックし、既存の挙動を維持する＝この形状で幾何的制約が強い場合の後方互換）
  const finalize = (rect: Rect): SafeAreaResult => ({
    rect,
    maxGrowH: growHeightSafely(rect, coarsePolygon, avoidGroups, built.viewBoxH),
  });

  if (contentMin) {
    const rect = findMaxInscribedRect(coarsePolygon, bounds, avoidGroups, contentMin.w, contentMin.h);
    if (rect) return finalize(rect);
  }

  for (const hRatio of SAFE_AREA_HEIGHT_STEPDOWN_RATIOS) {
    for (const wRatio of SAFE_AREA_WIDTH_STEPDOWN_RATIOS) {
      const minW = built.viewBoxW * wRatio;
      const minH = built.viewBoxH * hRatio;
      const rect = findMaxInscribedRect(coarsePolygon, bounds, avoidGroups, minW, minH);
      if (rect) return finalize(rect);
    }
  }

  // 保険: 最小サイズまで緩めてもクリアランスを保った矩形が見つからない場合
  // （実運用の9シェイプ・全シードでは発動しない想定）。クリアランスは妥協せず、
  // 中心固定ではなくtitle/dateから最も遠い位置を選んで重なりを最小化する
  const w = built.viewBoxW * SAFE_AREA_WIDTH_STEPDOWN_RATIOS[SAFE_AREA_WIDTH_STEPDOWN_RATIOS.length - 1];
  const h = built.viewBoxH * SAFE_AREA_HEIGHT_STEPDOWN_RATIOS[SAFE_AREA_HEIGHT_STEPDOWN_RATIOS.length - 1];
  let bestCx = built.cx;
  let bestCy = built.cy;
  let bestMinDist = -Infinity;
  for (let gy = 0; gy < SAFE_AREA_CENTER_GRID; gy++) {
    for (let gx = 0; gx < SAFE_AREA_CENTER_GRID; gx++) {
      const ccx = bounds.minX + ((bounds.maxX - bounds.minX) * (gx + 0.5)) / SAFE_AREA_CENTER_GRID;
      const ccy = bounds.minY + ((bounds.maxY - bounds.minY) * (gy + 0.5)) / SAFE_AREA_CENTER_GRID;
      const candidate: Rect = { x: ccx - w / 2, y: ccy - h / 2, w, h };
      if (!rectSamplePoints(candidate).every((p) => pointInPolygon(p, coarsePolygon))) continue;
      let minDist = Infinity;
      for (const g of avoidGroups) {
        for (const p of g.points) {
          const dx = Math.max(candidate.x - p.x, 0, p.x - (candidate.x + candidate.w));
          const dy = Math.max(candidate.y - p.y, 0, p.y - (candidate.y + candidate.h));
          minDist = Math.min(minDist, Math.hypot(dx, dy) - g.margin);
        }
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestCx = ccx;
        bestCy = ccy;
      }
    }
  }
  return finalize({ x: bestCx - w / 2, y: bestCy - h / 2, w, h });
}

// idea.id・title・dateLabelから決定論的にシェイプ1枚を組み立てる（Math.random不使用）。
// A: タイトル/日付の弧・フォントサイズは輪郭全周からの曲率ベース選定で確定し、切り詰めはしない
// G: content省略時は既存の(幾何のみで決める)stepdown挙動のまま。content指定時は、説明文が
// DESC_FONT_FLOOR_RATIOで全文収まるだけの高さをsafeArea探索の最優先候補にする（実際に
// 達成されるsafeArea.wはこの見積りに使った仮定幅(SAFE_AREA_WIDTH_STEPDOWN_RATIOSの最大=30%)
// と異なりうるが、findMaxInscribedRectは面積最大化探索のため広い側にずれるぶんには問題なく、
// IdeaShapeCard.tsx側が実際のsafeAreaに対して最終フィット探索を行うため多少のズレは吸収される）
export function shapeForIdea(
  ideaId: string,
  title: string,
  dateLabel: string,
  content?: { seed: string; refs: readonly ContentRef[] },
  // A.1: goofy-hatching-mango.md 2026-07-07バッチ(コンテンツ量に応じたシェイプ割り当て)。
  // ideaCollageLayout.tsのassignShapeKindsが、hashベースのデフォルト種で物理フォント下限を
  // 満たせないカードについて、種(forceKind)・複雑形の浅い変種(generous)を上書きするために使う。
  // rngはhashId由来のまま変えない(kind/variantが変わっても同じidなら同じ乱数列＝ジッタの
  // 一意性と決定論は自動的に維持される)
  opts?: { forceKind?: ShapeKind; generous?: boolean },
): IdeaShape {
  const h = hashId(ideaId);
  const kind = opts?.forceKind ?? WEIGHTED_KIND_TABLE[h % WEIGHTED_KIND_TABLE.length];
  const rng = mulberry32(h);
  const built = BUILDERS[kind](rng, opts?.generous ?? false);
  const outlinePolygon = densePointsFromOutlinePath(built.outlinePath, OUTLINE_SAMPLES_PER_CURVE);
  const pm = buildPerimeterMetrics(outlinePolygon);
  // B: 輪郭全周(閉じたループ)を弧長ベースで一定点数にリサンプルする。resampleAlongPolylineは
  // 開いた折れ線(points[0]→points[last])を前提とするため、末尾に始点を複製して渡すことで
  // ループを1周ぶん含めた開いた折れ線として扱い、閉じた輪郭全体を均等にリサンプルする
  const outlineSamplePoints = resampleAlongPolyline([...outlinePolygon, outlinePolygon[0]], OUTLINE_SAMPLE_POINTS_COUNT);

  // 日付: 上部の窓(DATE_WINDOW_DEG)を優先し、複雑形(多葉・切り欠き)でその窓に低曲率区間が
  // 無い場合は全周探索へフォールバックする(4: 日付は従来どおり上部の緩い区間が第一候補)
  const dateWindowAllowed = (i: number) => {
    const angleDeg = rad2deg(Math.atan2(pm.points[i].y - built.cy, pm.points[i].x - built.cx));
    return angleWithinWindow(angleDeg, DATE_WINDOW_DEG);
  };
  const allowAll = () => true;
  const dateCharWidthEm = estimateTextWidthEm(dateLabel) + dateLabel.length * DATE_LETTER_SPACING_EM;
  const dateStartHint = nearestIndexToAngleDeg(pm, built.cx, built.cy, -90);
  const dateFit = selectArcForFontSizes(
    pm,
    fontSizeCandidates(built.viewBoxW, DATE_FONT_MAX_RATIO, DATE_FONT_FLOOR_RATIO),
    dateCharWidthEm,
    dateWindowAllowed,
    allowAll,
    dateStartHint,
    built.cx,
    built.cy,
    outlinePolygon,
  );

  // タイトル: 日付の実使用区間±バッファを除いた全周が第一候補。それでも見つからない
  // （＝日付が全周の大半を使う極端なケース）場合は排他を諦めて全周を使う
  const bufferCount = Math.max(2, Math.round(pm.n * DATE_TITLE_BUFFER_FRACTION));
  const titleAllowedExclDate = (i: number) => {
    if (dateFit.startPhys < 0) return true;
    return !circularWithinRange(pm.n, dateFit.startPhys, dateFit.endPhys, i, bufferCount);
  };
  // H: 字間(TITLE_LETTER_SPACING_EM)ぶんを幅見積もりにも反映し、切り詰めゼロの保証を崩さない
  // （DATE_LETTER_SPACING_EMと同じ考え方）
  const titleCharWidthEm = estimateTextWidthEm(title) + title.length * TITLE_LETTER_SPACING_EM;
  const titleStartHint = nearestIndexToAngleDeg(pm, built.cx, built.cy, 90);
  const titleFit = selectArcForFontSizes(
    pm,
    fontSizeCandidates(built.viewBoxW, TITLE_FONT_MAX_RATIO, TITLE_FONT_FLOOR_RATIO),
    titleCharWidthEm,
    titleAllowedExclDate,
    allowAll,
    titleStartHint,
    built.cx,
    built.cy,
    outlinePolygon,
    dateFit.points,
    dateFit.fontSize * MIN_ARC_EUCLIDEAN_CLEARANCE_MULT,
  );

  let contentMin: { w: number; h: number } | undefined;
  if (content) {
    const assumedWidth = built.viewBoxW * SAFE_AREA_WIDTH_STEPDOWN_RATIOS[0];
    const reserved = estimateReservedLinksHeightPx(built.viewBoxW, assumedWidth, content.refs);
    const descAtFloor = requiredDescHeightPx(built.viewBoxW, assumedWidth, content.seed, DESC_FONT_FLOOR_RATIO);
    contentMin = { w: assumedWidth, h: reserved + descAtFloor };
  }
  const safeAreaResult = computeSafeArea(built, dateFit, titleFit, dateCharWidthEm, titleCharWidthEm, contentMin);
  const safeArea = safeAreaResult.rect;
  const safeAreaMaxGrowH = safeAreaResult.maxGrowH;

  // outlinePolygon(実際に描画される輪郭の密サンプル点列。上で曲率解析等に使ったものと同一)から
  // 実bboxを求め、外箱(0..viewBoxW, 0..viewBoxH)との差分をインセットとする
  const outlineXs = outlinePolygon.map((p) => p.x);
  const outlineYs = outlinePolygon.map((p) => p.y);
  const outlineMinX = Math.min(...outlineXs);
  const outlineMaxX = Math.max(...outlineXs);
  const outlineMinY = Math.min(...outlineYs);
  const outlineMaxY = Math.max(...outlineYs);
  const outlineInset = {
    top: Math.max(0, outlineMinY),
    right: Math.max(0, built.viewBoxW - outlineMaxX),
    bottom: Math.max(0, built.viewBoxH - outlineMaxY),
    left: Math.max(0, outlineMinX),
  };

  // F: outlineInsetから輪郭bbox±小マージンのcropViewBoxを導出する。タイトル/日付弧・safeAreaは
  // (shrinkUntilContained・findMaxInscribedRectの包含判定により)常に輪郭ポリゴンの内側にあり、
  // 輪郭ポリゴンのbboxは outlineMinX..outlineMaxX / outlineMinY..outlineMaxY そのものなので、
  // マージンを足すcropViewBoxに対しても自動的に内包される
  const bboxW = Math.max(1e-6, outlineMaxX - outlineMinX);
  const bboxH = Math.max(1e-6, outlineMaxY - outlineMinY);
  const marginX = bboxW * CROP_MARGIN_RATIO;
  const marginY = bboxH * CROP_MARGIN_RATIO;
  const cropViewBox = {
    x: outlineMinX - marginX,
    y: outlineMinY - marginY,
    w: bboxW + marginX * 2,
    h: bboxH + marginY * 2,
  };

  return {
    kind,
    viewBoxW: built.viewBoxW,
    viewBoxH: built.viewBoxH,
    aspect: built.viewBoxW / built.viewBoxH,
    outlinePath: built.outlinePath,
    dateArcPath: straightOpenPath(dateFit.points),
    titleArcPath: straightOpenPath(titleFit.points),
    dateArcLength: dateFit.length,
    titleArcLength: titleFit.length,
    dateFontSize: dateFit.fontSize,
    titleFontSize: titleFit.fontSize,
    safeArea,
    safeAreaMaxGrowH,
    outlineInset,
    cropViewBox,
    cropAspect: cropViewBox.w / cropViewBox.h,
    titleUsedFallback: titleFit.usedFallback,
    dateUsedFallback: dateFit.usedFallback,
    outlineSamplePoints,
  };
}

// ── H: 固定2サイズタイポグラフィ＋内容適応カードサイズ（goofy-hatching-mango.md 2026-07-07
// バッチ・改訂計画。旧「フォント下限＋コンテンツ量割り当て」計画を置換）─────────────────────
// 設計の反転: 旧shapeForIdeaは「viewBox内で収まる最大フォント比率」をshrink-to-fit探索し、
// カードの物理サイズ(ideaCollageLayout.tsのcolSpan)は別途決まっていた(フォントは下限のみ
// 保証)。新方式は「フォントは全カード共通の固定物理px(タイトル=titleFontPx、日付/本文/
// リンク=bodyFontPx)」を先に固定し、「この固定フォントで全文が収まるシェイプのレンダリング
// スケールS(viewbox単位→物理pxの変換係数)」を各カードごとに解く。
//
// 数学的な仕組み: viewBoxWは形状生成時に決まる固定値(shapeのkind依存、~64〜125)で、物理
// フォントサイズ=(viewbox単位のフォントサイズ)×S。日付/本文/リンクタイトルはすべて
// bodyFontPxで統一するため、bodyVB(=日付/本文/リンクのviewbox単位フォントサイズ、共通の
// 1つの値)とSの関係はS=bodyFontPx/bodyVBで一意に決まる。タイトルはtitleVB=bodyVB×
// (titleFontPx/bodyFontPx)とbodyVBに比例させることで、同じSで物理titleFontPxに自動的に
// 厳密一致する(誤差は浮動小数点のみ。追加の逆算調整は不要)。
//
// bodyVBが小さいほど(=Sが大きい・カードが物理的に大きいほど)、safeArea内によりコンテンツが
// 収まりやすくなる(絶対的なviewbox幾何は固定なので、フォントをviewbox単位で相対的に小さく
// すればするほど同じ幾何内により多くの文字が入る)。よってbodyVBを「収まる範囲でできるだけ
// 大きく(＝カードをできるだけ小さく)」二分探索し、説明文＋参照リンク＋罫線がsafeAreaに全文
// 収まり、かつタイトル・日付が固定フォントサイズちょうどで弧に収まる(数学的保証フォール
// バックが発動してもフォントサイズ自体は縮小されない)最小のSを求める。
// 各試行がfindMaxInscribedRectの密なグリッドサーチ(3アスペクト×6×6グリッド×24スケール
// 段階=2592回のrect評価)を伴うため非常に重く、assignShapeKindsが複数のkind候補についてこの
// 探索を3ティア分繰り返し呼ぶ(最大13候補×3ティア=39回のsolveFixedSizeShape)ため合計コストが
// 嵩む(実測: 反復数18では50件で数分規模)。二分探索の収束精度は「カードをどれだけ理論上の
// 最小サイズに近づけられるか」にのみ影響し、固定フォントサイズの厳密一致(受け入れ条件)には
// 影響しない(titleVB=bodyVB×A/Bの比例関係で常に厳密一致するため)。実用上カードが理論最小
// よりわずかに大きくなる程度の精度低下と引き換えに、反復数を大きく減らして体感速度を優先する
const FIXED_SIZE_SEARCH_ITERATIONS = 6;
// 二分探索の初期範囲(viewBoxWに対する比率)。上限(小さいカード側)は「かなり窮屈な最小限の
// カード」、下限(大きいカード側)は「実務上あり得ないほど大きいカード」に相当する比率で、
// 実データで下限側は常にfeasibleになる想定(feasibleでなければ最終手段としてそのまま使う)
const FIXED_SIZE_RATIO_HI = 0.09;
const FIXED_SIZE_RATIO_LO = 0.0004;
// 数学的保証フォールバックの下限クランプにより、目標フォントサイズよりわずかでも縮小したら
// 不合格とみなす許容誤差(浮動小数点誤差の吸収のみが目的)
const FIXED_SIZE_FEASIBILITY_EPS = 1e-4;

type FixedSizeTrial = {
  dateFit: ArcFitResult;
  titleFit: ArcFitResult;
  safeArea: Rect;
  safeAreaMaxGrowH: number;
  descLines: number;
  descRequiredHeightPx: number;
  reservedLinksHeightPx: number;
  refLineCounts: number[];
  linkLabelFontSize: number;
  fits: boolean;
};

// 候補bodyVB(=titleVBもbodyVBに比例して決まる)1点について、日付・タイトルの弧選定と
// safeArea配置・説明文/参照リンクの必要高さを実際に計算し、固定フォントサイズちょうどで
// 全文が収まるかどうかを判定する。shapeForIdeaの本体ロジックと同じ関数群を、font-size-
// candidateを単一値([bodyVB]・[titleVB])にして呼ぶ点だけが異なる
function evaluateFixedSizeTrial(
  built: ShapeBuildResult,
  outlinePolygon: readonly Point[],
  pm: PerimeterMetrics,
  title: string,
  dateLabel: string,
  seed: string,
  refs: readonly ContentRef[],
  bodyVB: number,
  titleVB: number,
): FixedSizeTrial {
  const dateWindowAllowed = (i: number) => {
    const angleDeg = rad2deg(Math.atan2(pm.points[i].y - built.cy, pm.points[i].x - built.cx));
    return angleWithinWindow(angleDeg, DATE_WINDOW_DEG);
  };
  const allowAll = () => true;
  const dateCharWidthEm = estimateTextWidthEm(dateLabel) + dateLabel.length * DATE_LETTER_SPACING_EM;
  const dateStartHint = nearestIndexToAngleDeg(pm, built.cx, built.cy, -90);
  const dateFit = selectArcForFontSizes(
    pm,
    [bodyVB],
    dateCharWidthEm,
    dateWindowAllowed,
    allowAll,
    dateStartHint,
    built.cx,
    built.cy,
    outlinePolygon,
  );

  const bufferCount = Math.max(2, Math.round(pm.n * DATE_TITLE_BUFFER_FRACTION));
  const titleAllowedExclDate = (i: number) => {
    if (dateFit.startPhys < 0) return true;
    return !circularWithinRange(pm.n, dateFit.startPhys, dateFit.endPhys, i, bufferCount);
  };
  const titleCharWidthEm = estimateTextWidthEm(title) + title.length * TITLE_LETTER_SPACING_EM;
  const titleStartHint = nearestIndexToAngleDeg(pm, built.cx, built.cy, 90);
  const titleFit = selectArcForFontSizes(
    pm,
    [titleVB],
    titleCharWidthEm,
    titleAllowedExclDate,
    allowAll,
    titleStartHint,
    built.cx,
    built.cy,
    outlinePolygon,
    dateFit.points,
    dateFit.fontSize * MIN_ARC_EUCLIDEAN_CLEARANCE_MULT,
  );

  // リンクのタイトル文字はbodyVBと同じ(=サイズB)。CASE/TECHラベルは旧LINK_LABEL_FONT_RATIO/
  // LINK_FONT_RATIOの比率を保ったまま、viewBoxW基準からbodyVB基準へ変換する(旧モデルとの
  // 相対的な見た目の比率を維持するため)。罫線・コンテンツ間ギャップも同様にbodyVBへ
  // 比例させる(旧CONTENT_GAP_RATIO/DESC_FONT_MAX_RATIOの比率を維持)
  const linkLabelFontSize = bodyVB * (LINK_LABEL_FONT_RATIO / LINK_FONT_RATIO);
  const gapPx = bodyVB * (CONTENT_GAP_RATIO / DESC_FONT_MAX_RATIO);
  const fontOverride = { linkFontSizePx: bodyVB, linkLabelFontSizePx: linkLabelFontSize, gapPx };

  const assumedWidth = built.viewBoxW * SAFE_AREA_WIDTH_STEPDOWN_RATIOS[0];
  const reservedAssumed = estimateReservedLinksDetail(built.viewBoxW, assumedWidth, refs, fontOverride).heightPx;
  const descRatio = bodyVB / built.viewBoxW;
  const descAtAssumed = requiredDescLinesAndHeightPx(built.viewBoxW, assumedWidth, seed, descRatio).heightPx;
  const contentMin = { w: assumedWidth, h: reservedAssumed + descAtAssumed };

  const safeAreaResult = computeSafeArea(built, dateFit, titleFit, dateCharWidthEm, titleCharWidthEm, contentMin);
  const safeArea = safeAreaResult.rect;

  // 実際に確定したsafeArea.w(assumedWidthと異なりうる)で必要高さを再計算する
  const reservedDetail = estimateReservedLinksDetail(built.viewBoxW, safeArea.w, refs, fontOverride);
  const descDetail = requiredDescLinesAndHeightPx(built.viewBoxW, safeArea.w, seed, descRatio);
  const totalRequired = reservedDetail.heightPx + descDetail.heightPx;

  // fits判定: (1) 説明文+参照リンク+罫線がsafeArea(拡張上限まで)に収まる (2) 日付・タイトルが
  // 数学的保証フォールバックの下限クランプ(guaranteedFontSize)で縮小されず、狙った固定
  // フォントサイズちょうどを達成している(フォールバック自体=usedFallback=trueは許容。
  // フォントサイズが目標未満に縮む場合のみ不合格)
  const contentFits = totalRequired <= safeAreaResult.maxGrowH + 1e-6;
  const dateSizeOk = dateFit.fontSize >= bodyVB - FIXED_SIZE_FEASIBILITY_EPS;
  const titleSizeOk = titleFit.fontSize >= titleVB - FIXED_SIZE_FEASIBILITY_EPS;

  return {
    dateFit,
    titleFit,
    safeArea,
    safeAreaMaxGrowH: safeAreaResult.maxGrowH,
    descLines: descDetail.lines,
    descRequiredHeightPx: descDetail.heightPx,
    reservedLinksHeightPx: reservedDetail.heightPx,
    refLineCounts: reservedDetail.lineCounts,
    linkLabelFontSize,
    fits: contentFits && dateSizeOk && titleSizeOk,
  };
}

export type FixedSizeShapeResult = { shape: IdeaShape; scale: number };

// idea.id・title・dateLabel・content(説明文+参照リンク)・固定物理フォントサイズ(titleFontPx/
// bodyFontPx、ティアごとの値をideaCollageLayout.tsから渡す)から、その固定フォントで全文が
// 収まる最小のカードスケールS(物理px/viewbox単位)を解き、決定論的にシェイプ1枚を組み立てる。
// shapeForIdea同様Math.random不使用(mulberry32由来のジッタのみ)。rngはhashId由来のまま
// 変えないため、kind/variantが変わっても同じidなら同じ乱数列＝ジッタの一意性は維持される
export function solveFixedSizeShape(
  ideaId: string,
  title: string,
  dateLabel: string,
  content: { seed: string; refs: readonly ContentRef[] },
  titleFontPx: number,
  bodyFontPx: number,
  opts?: { forceKind?: ShapeKind; generous?: boolean },
): FixedSizeShapeResult {
  const h = hashId(ideaId);
  const kind = opts?.forceKind ?? WEIGHTED_KIND_TABLE[h % WEIGHTED_KIND_TABLE.length];
  const rng = mulberry32(h);
  const built = BUILDERS[kind](rng, opts?.generous ?? false);
  const outlinePolygon = densePointsFromOutlinePath(built.outlinePath, OUTLINE_SAMPLES_PER_CURVE);
  const pm = buildPerimeterMetrics(outlinePolygon);
  const outlineSamplePoints = resampleAlongPolyline([...outlinePolygon, outlinePolygon[0]], OUTLINE_SAMPLE_POINTS_COUNT);

  const titleToBodyRatio = titleFontPx / bodyFontPx;
  const trialAt = (bodyVB: number) =>
    evaluateFixedSizeTrial(built, outlinePolygon, pm, title, dateLabel, content.seed, content.refs, bodyVB, bodyVB * titleToBodyRatio);

  const hiVB = built.viewBoxW * FIXED_SIZE_RATIO_HI;
  const loVB = built.viewBoxW * FIXED_SIZE_RATIO_LO;
  const loTrial = trialAt(loVB);
  let bestVB = loVB;
  let bestTrial = loTrial;
  // loTrial.fitsがfalseになるのは実運用では発生しない想定(あり得ないほど大きいカードでも
  // 収まらない場合の保険)。その場合はloVBをそのまま最終手段として使う(呼び出し側の
  // assignShapeKindsが別途フォールバック検知・警告を行う)
  if (loTrial.fits) {
    const hiTrial = trialAt(hiVB);
    if (hiTrial.fits) {
      // 最小のカード候補(hiVB)でも収まる＝非常に短い内容。カードを不必要に大きくしない
      bestVB = hiVB;
      bestTrial = hiTrial;
    } else {
      // 二分探索: [loVB(feasible), hiVB(infeasible)]の間でfeasibleな最大のbodyVB
      // (=最小のカード)を探す
      let lo = loVB;
      let hi = hiVB;
      for (let i = 0; i < FIXED_SIZE_SEARCH_ITERATIONS; i++) {
        const mid = (lo + hi) / 2;
        const trial = trialAt(mid);
        if (trial.fits) {
          lo = mid;
          bestVB = mid;
          bestTrial = trial;
        } else {
          hi = mid;
        }
      }
    }
  }

  const bodyVB = bestVB;
  const { dateFit, titleFit, safeArea, safeAreaMaxGrowH, descLines, descRequiredHeightPx, reservedLinksHeightPx, refLineCounts, linkLabelFontSize } =
    bestTrial;

  const outlineXs = outlinePolygon.map((p) => p.x);
  const outlineYs = outlinePolygon.map((p) => p.y);
  const outlineMinX = Math.min(...outlineXs);
  const outlineMaxX = Math.max(...outlineXs);
  const outlineMinY = Math.min(...outlineYs);
  const outlineMaxY = Math.max(...outlineYs);
  const outlineInset = {
    top: Math.max(0, outlineMinY),
    right: Math.max(0, built.viewBoxW - outlineMaxX),
    bottom: Math.max(0, built.viewBoxH - outlineMaxY),
    left: Math.max(0, outlineMinX),
  };
  const bboxW = Math.max(1e-6, outlineMaxX - outlineMinX);
  const bboxH = Math.max(1e-6, outlineMaxY - outlineMinY);
  const marginX = bboxW * CROP_MARGIN_RATIO;
  const marginY = bboxH * CROP_MARGIN_RATIO;
  const cropViewBox = {
    x: outlineMinX - marginX,
    y: outlineMinY - marginY,
    w: bboxW + marginX * 2,
    h: bboxH + marginY * 2,
  };

  const shape: IdeaShape = {
    kind,
    viewBoxW: built.viewBoxW,
    viewBoxH: built.viewBoxH,
    aspect: built.viewBoxW / built.viewBoxH,
    outlinePath: built.outlinePath,
    dateArcPath: straightOpenPath(dateFit.points),
    titleArcPath: straightOpenPath(titleFit.points),
    dateArcLength: dateFit.length,
    titleArcLength: titleFit.length,
    dateFontSize: dateFit.fontSize,
    titleFontSize: titleFit.fontSize,
    safeArea,
    safeAreaMaxGrowH,
    outlineInset,
    cropViewBox,
    cropAspect: cropViewBox.w / cropViewBox.h,
    titleUsedFallback: titleFit.usedFallback,
    dateUsedFallback: dateFit.usedFallback,
    outlineSamplePoints,
    descLines,
    descRequiredHeightPx,
    reservedLinksHeightPx,
    refLineCounts,
    linkLabelFontSize,
  };

  const scale = bodyFontPx / bodyVB;
  return { shape, scale };
}

// B: パズルカーニング配置用の座標変換（goofy-hatching-mango.md 2026-07-07バッチ・実装詳細補足
// B.2）。shape.outlineSamplePoints(元のviewBox座標系のまま)を、実際にカードが配置された後の
// レイアウト座標(tier基準幅を単位とした物理px)へ変換する。処理順序:
// (1) cropViewBox.x/yを引きcrop-local化 (2) x方向はwidthPx/cropViewBox.w、y方向は
// heightPx/cropViewBox.hでスケール (3) crop中心(widthPx/2, heightPx/2)を原点に平行移動
// (4) rotateDegだけ原点中心に回転 (5) (centerX, centerY)へ平行移動。
// 純粋関数・決定論（乱数不使用）。
// 重要: (4)の回転はCSSの`transform:rotate()`が要素自身の中心を軸に回転するのと厳密に一致させる
// 必要がある。CSSは要素をleft/top/width/heightで配置した後、その要素の幾何中心
// (left+width/2, top+height/2)を軸に回転するため、ここでの(centerX, centerY)は「回転後の
// 最終位置」ではなく「ボックス自身の幾何中心」を渡す。widthPx/heightPxは呼び出し側が
// letterboxing(SVGのpreserveAspectRatio既定xMidYMid meetによる余白)を考慮済みの実コンテンツ
// サイズを渡すことで、実際に画面に描画される輪郭と数学的に一致させる（ideaCollageLayout.ts参照）
export function outlineToLayoutSpace(
  shape: IdeaShape,
  opts: { widthPx: number; heightPx: number; rotateDeg: number; centerX: number; centerY: number },
): Point[] {
  const { widthPx, heightPx, rotateDeg, centerX, centerY } = opts;
  const cb = shape.cropViewBox;
  const scaleX = widthPx / cb.w;
  const scaleY = heightPx / cb.h;
  const rotateRad = deg2rad(rotateDeg);
  return shape.outlineSamplePoints.map((p) => {
    const localX = (p.x - cb.x) * scaleX - widthPx / 2;
    const localY = (p.y - cb.y) * scaleY - heightPx / 2;
    const rotated = rotatePoint({ x: localX, y: localY }, 0, 0, rotateRad);
    return { x: rotated.x + centerX, y: rotated.y + centerY };
  });
}
