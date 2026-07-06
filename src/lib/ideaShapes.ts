// /ideas ポスターUIの不定形シェイプ生成（DESIGN: goofy-hatching-mango.md）。
// 6種の生成器×hashId(idea.id)由来のシードで、決定論的に「同じ形でも1枚ごとに微妙に違う輪郭」を作る。
// Math.randomは使わない（mulberry32による純関数PRNGのみ）。同じidなら常に同じ結果 = リロードで変わらない。
//
// 座標系について: 各シェイプは自分の自然な縦横比に合ったviewBox（例: tallOvalは幅が狭い）を持つ。
// 全シェイプを共通の正方形viewBoxに詰めてCSS側でpreserveAspectRatio="none"により引き伸ばすと、
// SVG<text>のグリフまでX/Y非一様にスケールされ字が歪む。これを避けるため、カード外枠のCSS aspect-ratio
// をshape.aspect（=viewBoxW/viewBoxH）に一致させ、SVG側はデフォルトのxMidYMid meet（等倍scale）で
// 歪みなく収める設計にした（計画書ではviewBox 0 0 100 100固定を想定していたが、テキスト歪み回避のため
// シェイプごとのviewBoxに変更。計画書側にも反映済み）。
import { hashId } from "./graph";

export type ShapeKind = "blob" | "polygon" | "waveRect" | "arch" | "tallOval" | "splat";

export const SHAPE_KINDS: readonly ShapeKind[] = ["blob", "polygon", "waveRect", "arch", "tallOval", "splat"];

export type IdeaShape = {
  kind: ShapeKind;
  viewBoxW: number;
  viewBoxH: number;
  aspect: number; // viewBoxW / viewBoxH。カード外枠のCSS aspect-ratioに使う
  outlinePath: string; // 閉じたパス（fill用）
  dateArcPath: string; // 開いたパス（上部・textPath用。左→右に読める向き）
  titleArcPath: string; // 開いたパス（下部・textPath用。左→右に読める向き）
  titleArcLength: number; // titleArcPathの実長の近似（折れ線和）。タイトル文字数に応じた可変フォントサイズの算出に使う
  safeArea: { x: number; y: number; w: number; h: number }; // foreignObject安全領域（このシェイプの座標系）
};

const TAU = Math.PI * 2;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
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

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "0";
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
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d.push(`C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2.x)} ${fmt(p2.y)}`);
  }
  d.push("Z");
  return d.join(" ");
}

// 開いた点列 → Catmull-Rom→Bezierのスムーズな開パス（textPath用の弧。端は複製してクランプ）
function catmullRomOpenPath(points: readonly Point[]): string {
  const n = points.length;
  if (n < 2) return "";
  if (n === 2) return `M ${fmt(points[0].x)} ${fmt(points[0].y)} L ${fmt(points[1].x)} ${fmt(points[1].y)}`;
  const d: string[] = [`M ${fmt(points[0].x)} ${fmt(points[0].y)}`];
  for (let i = 0; i < n - 1; i++) {
    const p0 = i === 0 ? points[0] : points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i + 2 < n ? points[i + 2] : points[n - 1];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d.push(`C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2.x)} ${fmt(p2.y)}`);
  }
  return d.join(" ");
}

// 点列の折れ線長（Catmull-Romで滑らかにした実パスの実長の近似値。誤差は実測で+1〜+5%程度と
// 安全側=長め寄りに出るため、可変フォントサイズ側で余裕率を掛けて相殺する）
function polylineLength(points: readonly Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

// 開いた点列 → 直線でつないだ開パス（多角形系の"角ばった"textPath用）
function straightOpenPath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  const d = [`M ${fmt(points[0].x)} ${fmt(points[0].y)}`];
  for (let i = 1; i < points.length; i++) d.push(`L ${fmt(points[i].x)} ${fmt(points[i].y)}`);
  return d.join(" ");
}

// fromDeg→toDegを直線ステップでnSamples点サンプルし、pointAt(輪郭上の実点)をcentroid基準に
// insetRatio分だけ内側へ縮小して弧の点列を作る。fromDeg<toDegなら左→右（上部の弧＝日付用）、
// fromDeg>toDegでも同じ式で右→左に見える範囲を逆順にサンプルすることで左→右になる（下部の弧＝タイトル用）
function sampleArcPoints(
  pointAt: (angleRad: number) => Point,
  cx: number,
  cy: number,
  fromDeg: number,
  toDeg: number,
  nSamples: number,
  insetRatio: number,
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < nSamples; i++) {
    const t = nSamples === 1 ? 0 : i / (nSamples - 1);
    const angleDeg = fromDeg + (toDeg - fromDeg) * t;
    const angle = deg2rad(angleDeg);
    const p = pointAt(angle);
    pts.push({ x: cx + (p.x - cx) * (1 - insetRatio), y: cy + (p.y - cy) * (1 - insetRatio) });
  }
  return pts;
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

type ShapeBuildResult = {
  viewBoxW: number;
  viewBoxH: number;
  outlinePath: string;
  pointAt: (angle: number) => Point; // 輪郭上の実点（jitter・剪断込み。textPathの弧サンプルにも使う）
  cx: number;
  cy: number;
  dateSpanDeg: [number, number];
  titleSpanDeg: [number, number];
  insetRatio: number;
  arcSmooth: boolean; // true: Catmull-Romで滑らかに / false: 直線でつなぐ
  safeArea: { x: number; y: number; w: number; h: number };
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
  return {
    viewBoxW: 100,
    viewBoxH: 100,
    outlinePath: catmullRomClosedPath(points),
    pointAt,
    cx,
    cy,
    dateSpanDeg: [-160, -20],
    titleSpanDeg: [160, 20],
    insetRatio: 0.11,
    arcSmooth: true,
    safeArea: { x: 20, y: 41, w: 60, h: 25 },
  };
}

// 2: 不揃い角丸多角形（7〜9角）
function buildPolygon(rng: () => number): ShapeBuildResult {
  const cx = 50;
  const cy = 50;
  const n = pick(rng, [7, 8, 9] as const);
  const rBase = randRange(rng, 37, 42);
  const vertexAngles: number[] = [];
  const vertexRadii: number[] = [];
  const sector = TAU / n;
  for (let i = 0; i < n; i++) {
    vertexAngles.push(-Math.PI / 2 + i * sector + randRange(rng, -0.18, 0.18) * sector);
    vertexRadii.push(rBase * (1 + randRange(rng, -0.16, 0.16)));
  }
  const vertices: Point[] = vertexAngles.map((a, i) => ({
    x: cx + vertexRadii[i] * Math.cos(a),
    y: cy + vertexRadii[i] * Math.sin(a),
  }));
  // 弧サンプル用: 頂点(angle,radius)ペアを角度昇順に並べ、区間線形補間する連続半径関数
  const sortedByAngle = vertexAngles
    .map((a, i) => ({ a, r: vertexRadii[i] }))
    .sort((p, q) => p.a - q.a);
  const radiusAt = (angleIn: number): number => {
    let angle = angleIn;
    while (angle <= sortedByAngle[0].a - TAU) angle += TAU;
    const m = sortedByAngle.length;
    for (let i = 0; i < m; i++) {
      const cur = sortedByAngle[i];
      const next = sortedByAngle[(i + 1) % m];
      const curA = cur.a;
      const nextA = next.a > curA ? next.a : next.a + TAU;
      let a = angle;
      while (a < curA) a += TAU;
      while (a - TAU >= curA) a -= TAU;
      if (a >= curA && a <= nextA) {
        const t = (a - curA) / (nextA - curA);
        return cur.r + (next.r - cur.r) * t;
      }
    }
    return sortedByAngle[0].r;
  };
  const pointAt = (angle: number): Point => {
    const r = radiusAt(angle);
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };
  return {
    viewBoxW: 100,
    viewBoxH: 100,
    outlinePath: roundedPolygonPath(vertices, 0.16),
    pointAt,
    cx,
    cy,
    dateSpanDeg: [-160, -20],
    titleSpanDeg: [160, 20],
    insetRatio: 0.12,
    arcSmooth: false,
    safeArea: { x: 27, y: 40, w: 46, h: 25 },
  };
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
  // 剪断（台形化）込みの実点。radiusAtだけではx方向のshearが反映されないため、
  // 弧サンプル・輪郭生成の両方でこのpointAtを唯一の真実源として使う
  const pointAt = (angle: number): Point => {
    const r = radiusAt(angle);
    const py = cy + r * Math.sin(angle);
    const px = cx + r * Math.cos(angle) + shear * ((py - cy) / hh);
    return { x: px, y: py };
  };
  const nOutline = 28;
  const points: Point[] = [];
  for (let i = 0; i < nOutline; i++) points.push(pointAt((i / nOutline) * TAU - Math.PI / 2));
  return {
    viewBoxW,
    viewBoxH,
    outlinePath: catmullRomClosedPath(points),
    pointAt,
    cx,
    cy,
    dateSpanDeg: [-158, -22],
    titleSpanDeg: [158, 22],
    insetRatio: 0.1,
    arcSmooth: true,
    safeArea: { x: 22, y: 35, w: 81, h: 33 },
  };
}

// 4: アーチ（上半円+胴）。上半分=真円のドーム、下半分=矩形の胴（極座標での矩形交差式）
function buildArch(rng: () => number): ShapeBuildResult {
  const viewBoxW = 92;
  const viewBoxH = 100;
  const cx = viewBoxW / 2;
  const cy = randRange(rng, 38, 42);
  const domeR = randRange(rng, 34, 38);
  const bodyBottomOffset = randRange(rng, 42, 46);
  const harmonics = makeHarmonics(rng, [{ freqMin: 2, freqMax: 3, ampMin: 0.04, ampMax: 0.07 }]);
  const radiusAt = (angleRaw: number) => {
    // (-π, π]に正規化してから上半分/下半分を判定する。未正規化のままだと出力サンプルが一周
    // (0..2π)全体に及ぶ際に180°超をそのまま「下半分」と誤判定し、sinが負になってrが負転する
    // （輪郭が原点の反対側へ跳ねる)バグがあったため必須の正規化
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
  return {
    viewBoxW,
    viewBoxH,
    outlinePath: catmullRomClosedPath(points),
    pointAt,
    cx,
    cy,
    dateSpanDeg: [-172, -8],
    // radiusAtは側面(domeR/cosθ)と底面(bodyBottomOffset/sinθ)の2式を角度で切り替えており、
    // 切替点(domeR・bodyBottomOffsetの実際の乱数範囲でおよそ48〜54°)を跨ぐとxが単調増加でなくなり
    // 弧が"フック"して文字が絡む。底面のみに収まる[56,124]の内側に留める
    titleSpanDeg: [124, 56],
    insetRatio: 0.11,
    arcSmooth: true,
    safeArea: { x: 13, y: cy + domeR * 0.15, w: viewBoxW - 26, h: 30 },
  };
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
  return {
    viewBoxW,
    viewBoxH,
    outlinePath: catmullRomClosedPath(points),
    pointAt,
    cx,
    cy,
    dateSpanDeg: [-150, -30],
    titleSpanDeg: [150, 30],
    insetRatio: 0.11,
    arcSmooth: true,
    safeArea: { x: 12, y: 42, w: 40, h: 20 },
  };
}

// 6: ぐにゃっとした花形・スプラット
function buildSplat(rng: () => number): ShapeBuildResult {
  const cx = 50;
  const cy = 50;
  const rBase = randRange(rng, 34, 38);
  const lobeHarmonics = makeHarmonics(rng, [
    { freqMin: 5, freqMax: 6, ampMin: 0.2, ampMax: 0.3 },
    { freqMin: 9, freqMax: 11, ampMin: 0.05, ampMax: 0.09 },
  ]);
  // textの弧は輪郭のロブ形状を追わず、ほぼ真円（jitterなし）にして可読性を確保する
  // （輪郭本体はフル暴れのスプラット形状のまま。弧まで暴れさせると文字が乱れて読めなくなるため）
  const outlineRadiusAt = (angle: number) => rBase * (1 + clamp(harmonicJitter(angle, lobeHarmonics), -0.42, 0.55));
  const outlinePointAt = (angle: number): Point => {
    const r = outlineRadiusAt(angle);
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };
  // textの弧は輪郭本体(rBase*ロブjitter)を追わずrBaseの真円でサンプルする（読みやすさ優先。輪郭はフル暴れのまま）
  const arcPointAt = (angle: number): Point => ({ x: cx + rBase * Math.cos(angle), y: cy + rBase * Math.sin(angle) });
  const nOutline = 36;
  const points: Point[] = [];
  for (let i = 0; i < nOutline; i++) points.push(outlinePointAt((i / nOutline) * TAU - Math.PI / 2));
  return {
    viewBoxW: 100,
    viewBoxH: 100,
    outlinePath: catmullRomClosedPath(points),
    pointAt: arcPointAt,
    cx,
    cy,
    dateSpanDeg: [-160, -20],
    titleSpanDeg: [160, 20],
    insetRatio: 0.13,
    arcSmooth: true,
    safeArea: { x: 24, y: 40, w: 52, h: 26 },
  };
}

const BUILDERS: Record<ShapeKind, (rng: () => number) => ShapeBuildResult> = {
  blob: buildBlob,
  polygon: buildPolygon,
  waveRect: buildWaveRect,
  arch: buildArch,
  tallOval: buildTallOval,
  splat: buildSplat,
};

// idea.idから決定論的にシェイプ1枚を組み立てる（Math.random不使用。同じidなら常に同じ結果）
export function shapeForIdea(ideaId: string): IdeaShape {
  const h = hashId(ideaId);
  const kind = SHAPE_KINDS[h % SHAPE_KINDS.length];
  const rng = mulberry32(h);
  const built = BUILDERS[kind](rng);

  const [dateFrom, dateTo] = built.dateSpanDeg;
  const [titleFrom, titleTo] = built.titleSpanDeg;
  const datePts = sampleArcPoints(built.pointAt, built.cx, built.cy, dateFrom, dateTo, 7, built.insetRatio);
  const titlePts = sampleArcPoints(built.pointAt, built.cx, built.cy, titleFrom, titleTo, 9, built.insetRatio);

  const dateArcPath = built.arcSmooth ? catmullRomOpenPath(datePts) : straightOpenPath(datePts);
  const titleArcPath = built.arcSmooth ? catmullRomOpenPath(titlePts) : straightOpenPath(titlePts);

  return {
    kind,
    viewBoxW: built.viewBoxW,
    viewBoxH: built.viewBoxH,
    aspect: built.viewBoxW / built.viewBoxH,
    outlinePath: built.outlinePath,
    dateArcPath,
    titleArcPath,
    titleArcLength: polylineLength(titlePts),
    safeArea: built.safeArea,
  };
}
