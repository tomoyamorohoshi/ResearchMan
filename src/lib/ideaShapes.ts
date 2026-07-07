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
const KIND_WEIGHT: Record<ShapeKind, number> = {
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
const WEIGHTED_KIND_TABLE: readonly ShapeKind[] = SHAPE_KINDS.flatMap((k) =>
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
  // 数学的保証フォールバック(曲率制約を無視して全周長で確定するティア)が発動したかどうか。
  // 実運用の40件+妥当な合成ロングタイトルでは発動しない想定の診断用フィールド
  // (IdeaShapeCardは使わない。スモークテストが「切り詰めゼロ」の証明範囲を切り分けるために使う)
  titleUsedFallback: boolean;
  dateUsedFallback: boolean;
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

type Point = { x: number; y: number };

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
function buildBlob(rng: () => number): ShapeBuildResult {
  const cx = 50;
  const cy = 50;
  const rx = randRange(rng, 38, 44);
  const ry = randRange(rng, 36, 42);
  const harmonics = makeHarmonics(rng, [
    { freqMin: 2, freqMax: 3, ampMin: 0.06, ampMax: 0.11 },
    { freqMin: 3, freqMax: 5, ampMin: 0.05, ampMax: 0.09 },
    { freqMin: 5, freqMax: 7, ampMin: 0.02, ampMax: 0.05 },
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
function buildArch(rng: () => number): ShapeBuildResult {
  const viewBoxW = 92;
  const viewBoxH = 100;
  const cx = viewBoxW / 2;
  const cy = randRange(rng, 38, 42);
  const domeR = randRange(rng, 34, 38);
  const bodyBottomOffset = randRange(rng, 42, 46);
  const harmonics = makeHarmonics(rng, [{ freqMin: 2, freqMax: 3, ampMin: 0.04, ampMax: 0.07 }]);
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
function buildTallOval(rng: () => number): ShapeBuildResult {
  const viewBoxW = 64;
  const viewBoxH = 100;
  const cx = viewBoxW / 2;
  const cy = 50;
  const rx = randRange(rng, 20, 24);
  const ry = randRange(rng, 42, 46);
  const harmonics = makeHarmonics(rng, [
    { freqMin: 2, freqMax: 3, ampMin: 0.05, ampMax: 0.08 },
    { freqMin: 3, freqMax: 4, ampMin: 0.03, ampMax: 0.05 },
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
function buildSplat(rng: () => number): ShapeBuildResult {
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
  const lobeHarmonics = makeHarmonics(rng, [
    { freqMin: 3, freqMax: 4, ampMin: 0.16, ampMax: 0.24 },
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
function buildMultiLobe(rng: () => number): ShapeBuildResult {
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
  const lobes = pick(rng, [2, 3] as const);
  const rBase = randRange(rng, 30, 36);
  const lobeAmp = randRange(rng, 0.12, 0.2);
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
function buildLNotch(rng: () => number): ShapeBuildResult {
  const cx = 50;
  const cy = 50;
  const isT = rng() < 0.5;
  const margin = randRange(rng, 5, 9);
  const lo = margin;
  const hi = 100 - margin;
  let vertices: Point[];
  let kernelPoint: Point; // 星形の核（この点から全頂点・全辺が遮られず見通せる位置）
  if (isT) {
    const barH = randRange(rng, 30, 38);
    const stemW = randRange(rng, 26, 34);
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
    const armT = randRange(rng, 36, 46);
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
function buildNotchedCircle(rng: () => number): ShapeBuildResult {
  const cx = 50;
  const cy = 50;
  const rBase = randRange(rng, 36, 41);
  const notchCount = pick(rng, [1, 1, 2] as const);
  const firstCenter = randRange(rng, 0, TAU);
  const notches: { center: number; halfWidth: number; depth: number }[] = [
    { center: firstCenter, halfWidth: deg2rad(randRange(rng, 38, 58)), depth: randRange(rng, 0.38, 0.56) },
  ];
  if (notchCount === 2) {
    notches.push({
      center: firstCenter + Math.PI + randRange(rng, -0.4, 0.4),
      halfWidth: deg2rad(randRange(rng, 26, 40)),
      depth: randRange(rng, 0.28, 0.42),
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

const BUILDERS: Record<ShapeKind, (rng: () => number) => ShapeBuildResult> = {
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

// <text letterSpacing>と幅見積もりの両方で共有する単一の真実源（日付ラベルのuppercase表示に使う）
export const DATE_LETTER_SPACING_EM = 0.14;

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

const OUTLINE_SAMPLES_PER_CURVE = 24; // 曲率解析・弧選定に使う密サンプリング解像度
const SAFE_AREA_SAMPLES_PER_CURVE = 8; // safeArea探索専用の粗いサンプリング（性能優先）

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
      const insetRatio = INSET_BASE_RATIO + INSET_GAIN_RATIO * computeAvgCurvatureFactor(pm, run, fontSize);
      const finalPoints = insetAndOrient(extractRunPoints(pm, run), cx, cy, insetRatio, outlinePolygon, true);
      const finalLength = polylineLength(finalPoints);
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
  const finalPoints = insetAndOrient(loopPoints, cx, cy, FALLBACK_INSET_RATIO, outlinePolygon, false);
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
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (cumLen[i] >= lo && cumLen[i] <= hi) out.push(points[i]);
  }
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

function computeSafeArea(
  built: ShapeBuildResult,
  dateArc: ArcFitResult,
  titleArc: ArcFitResult,
  dateCharWidthEm: number,
  titleCharWidthEm: number,
): Rect {
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

  for (const hRatio of SAFE_AREA_HEIGHT_STEPDOWN_RATIOS) {
    for (const wRatio of SAFE_AREA_WIDTH_STEPDOWN_RATIOS) {
      const minW = built.viewBoxW * wRatio;
      const minH = built.viewBoxH * hRatio;
      const rect = findMaxInscribedRect(coarsePolygon, bounds, avoidGroups, minW, minH);
      if (rect) return rect;
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
  return { x: bestCx - w / 2, y: bestCy - h / 2, w, h };
}

// idea.id・title・dateLabelから決定論的にシェイプ1枚を組み立てる（Math.random不使用）。
// A: タイトル/日付の弧・フォントサイズは輪郭全周からの曲率ベース選定で確定し、切り詰めはしない
export function shapeForIdea(ideaId: string, title: string, dateLabel: string): IdeaShape {
  const h = hashId(ideaId);
  const kind = WEIGHTED_KIND_TABLE[h % WEIGHTED_KIND_TABLE.length];
  const rng = mulberry32(h);
  const built = BUILDERS[kind](rng);
  const outlinePolygon = densePointsFromOutlinePath(built.outlinePath, OUTLINE_SAMPLES_PER_CURVE);
  const pm = buildPerimeterMetrics(outlinePolygon);

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
  const titleCharWidthEm = estimateTextWidthEm(title);
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

  const safeArea = computeSafeArea(built, dateFit, titleFit, dateCharWidthEm, titleCharWidthEm);

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
    titleUsedFallback: titleFit.usedFallback,
    dateUsedFallback: dateFit.usedFallback,
  };
}
