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
  dateArcLength: number; // dateArcPathの実長の近似（折れ線和）。日付ラベルに応じた可変フォントサイズの算出に使う
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

// Catmull-Rom→Bezier変換の1区間分の制御点計算（閉パス・開パス・浅弧判定の密サンプルで共有）
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
    const { c1, c2 } = catmullRomSegmentControls(p0, p1, p2, p3);
    d.push(`C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p2.x)} ${fmt(p2.y)}`);
  }
  return d.join(" ");
}

function cubicBezierPoint(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * p1.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * p1.y,
  };
}

// catmullRomOpenPathが実際に描画する曲線に沿って密にサンプルした点列を返す（浅い弧の判定専用）。
// 生の制御点(=points)の直線近似だけで浅さを判定すると、Catmull-Rom平滑化がセグメント間で
// 外側へ張り出す分を見落とし、レンダリング後の実接線角が判定時より大きくなってしまうため、
// 判定は必ずこの実曲線サンプルに対して行う（catmullRomOpenPathと同じ制御点計算を共有）
function denseCurvePoints(points: readonly Point[], samplesPerSegment: number): Point[] {
  const n = points.length;
  if (n < 3) return [...points];
  const dense: Point[] = [points[0]];
  for (let i = 0; i < n - 1; i++) {
    const p0 = i === 0 ? points[0] : points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i + 2 < n ? points[i + 2] : points[n - 1];
    const { c1, c2 } = catmullRomSegmentControls(p0, p1, p2, p3);
    for (let s = 1; s <= samplesPerSegment; s++) dense.push(cubicBezierPoint(p1, c1, c2, p2, s / samplesPerSegment));
  }
  return dense;
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

// タイトル弧・日付弧の「浅い弧」制約（DESIGN差分: goofy-hatching-mango.md 修正バッチ）。
// 輪郭の側面をそのまま辿ると（特にtallOval等の縦長シェイプで）接線角が急峻になり、textPath上の
// CJKグリフが接線回転で互いに衝突・重なって判読不能になる（Fable視覚検分で複数カード実測）。
// centerDeg（輪郭の極。90°=下極=タイトル用、-90°=上極=日付用）を軸にした左右対称の弧半幅を
// 二分探索で縮め、実際に描画される区間の接線角が全てTANGENT_TARGET_DEG以内・x座標が単調増加になる
// 最大の弧を採用する。輪郭に沿わせてinsetRatio分だけ中心へ縮小する方式自体は維持するため
// （=常に輪郭の内側に収まる）、形状ごとに手動チューニングせずとも全シェイプ・全シードで機械的に
// 安全な浅弧が求まる（縦長シェイプで側面区間を含めたくなければ、単に弧半幅が自動的に狭まる）。
// 要求仕様の上限は接線角±25度以内。探索の内部目標はCatmull-Rom平滑化後のオーバーシュートに
// 備えて上限より小さくとる。ただしisShallowの判定自体が既に「生の制御点」ではなくdenseCurvePoints
// (実際に描画される曲線を密サンプルした点列)に対して行われるため、残る誤差はサンプル間隔の分だけに
// 縮小されている。そのため安全マージンは小さめでよく、弧の実長を稼ぐため23度まで許容する
// （TANGENT_LIMIT_DEG=25度に対し2度の余白。全340件のスモークテストで実測25度以内を確認済み）
const TANGENT_TARGET_DEG = 23;
const MIN_SWEEP_DEG = 3; // これ未満には絞らない（実質点になるのを避ける下限）

function insetPointAt(
  pointAt: (angle: number) => Point,
  cx: number,
  cy: number,
  insetRatio: number,
  angleDeg: number,
): Point {
  const p = pointAt(deg2rad(angleDeg));
  return { x: cx + (p.x - cx) * (1 - insetRatio), y: cy + (p.y - cy) * (1 - insetRatio) };
}

const CENTER_SEARCH_RANGE_DEG = 30;
const CENTER_SEARCH_STEP_DEG = 2;

// centerDeg±sweepDegの範囲をnSamples点サンプルする。angleDirection=1は角度増加が左→右
// （上極=日付用）、angleDirection=-1は角度減少が左→右（下極=タイトル用）
function sampleShallowCandidate(
  pointAt: (angle: number) => Point,
  cx: number,
  cy: number,
  insetRatio: number,
  centerDeg: number,
  sweepDeg: number,
  nSamples: number,
  angleDirection: 1 | -1,
): Point[] {
  const from = centerDeg - angleDirection * sweepDeg;
  const to = centerDeg + angleDirection * sweepDeg;
  const pts: Point[] = [];
  for (let i = 0; i < nSamples; i++) {
    const t = nSamples === 1 ? 0 : i / (nSamples - 1);
    pts.push(insetPointAt(pointAt, cx, cy, insetRatio, from + (to - from) * t));
  }
  return pts;
}

// 弧が「浅い」(接線角がTANGENT_TARGET_DEG以内・x座標が単調増加=方向反転なし)かどうかを判定
function isShallow(points: readonly Point[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    if (dx <= 0) return false;
    const dy = points[i].y - points[i - 1].y;
    const angleDeg = (Math.abs(Math.atan2(dy, dx)) * 180) / Math.PI;
    if (angleDeg > TANGENT_TARGET_DEG) return false;
  }
  return true;
}

const SHALLOW_CHECK_SAMPLES_PER_SEGMENT = 6;

// centerDegを固定し、浅い弧の条件を満たす最大の弧半幅を二分探索で求める。MIN_SWEEP_DEGですら
// 条件を満たせない場合はnull（=このcenterDegは使えない）を返す
function fitSweepAtCenter(
  pointAt: (angle: number) => Point,
  cx: number,
  cy: number,
  insetRatio: number,
  centerDeg: number,
  maxSweepDeg: number,
  nSamples: number,
  angleDirection: 1 | -1,
  arcSmooth: boolean,
): Point[] | null {
  const candidateAt = (sweepDeg: number) =>
    sampleShallowCandidate(pointAt, cx, cy, insetRatio, centerDeg, sweepDeg, nSamples, angleDirection);
  const isCandidateShallow = (sweepDeg: number) => {
    const raw = candidateAt(sweepDeg);
    return isShallow(arcSmooth ? denseCurvePoints(raw, SHALLOW_CHECK_SAMPLES_PER_SEGMENT) : raw);
  };
  let lo = MIN_SWEEP_DEG;
  let hi = maxSweepDeg;
  if (!isCandidateShallow(lo)) return null;
  if (isCandidateShallow(hi)) return candidateAt(hi);
  for (let iter = 0; iter < 20; iter++) {
    const mid = (lo + hi) / 2;
    if (isCandidateShallow(mid)) lo = mid;
    else hi = mid;
  }
  return candidateAt(lo);
}

// 弧の実長がこの比率(viewBoxW比)未満だと、タイトル/日付を最小フォント+省略記号まで切り詰めても
// 実質「…」だけしか残らず読めない（実測: archive-40のblobでtitleArcLength=6.37/viewBoxW=100=6.4%
// まで狭まり、切り詰めた結果が"…"単独になるバグを確認）。センター探索で「最初に条件を満たした
// センター」を即採用すると、こうした極端に短い弧を掴んだまま止まってしまうため、この比率を
// 下回る間はより長い弧を探して探索を続ける。あくまで探索を続けるかどうかの目標値であり、
// tallOval等の縦長シェイプでは浅い弧の制約と両立できず届かないこともある（その場合でも
// 範囲内で見つかった最長の候補にフォールバックするため、探索自体が失敗することはない。
// scripts/smoke-idea-shapes.mjsの実測ベースの下限=8%は下回っていないことを確認済み）
const MIN_USABLE_ARC_RATIO = 0.2;

// nominalCenterDeg(輪郭の極。90°=下極=タイトル用、-90°=上極=日付用)を軸に、浅い弧の条件を
// 満たす最大の弧半幅を二分探索で求めてサンプル点を返す。harmonicジッターの影響で極そのものが
// 局所的にキンク（多角形の頂点や急な位相のジッター）に近く、MIN_SWEEP_DEGですら条件を
// 満たせないことがある（Fable視覚検分後の実装で実測。2点微分近似で最平坦点を推定する方式は
// キンクの直前だけを見て誤検出することが判明したため不採用）。そこでnominalCenterDegから
// ±CENTER_SEARCH_RANGE_DEGの範囲をCENTER_SEARCH_STEP_DEG刻みで実際に検証しながら走査する。
// nominalCenterDegに近い側から順に試し、実長がMIN_USABLE_ARC_RATIO以上ある最初の候補を採用する
// （=極からなるべく動かさない）。範囲内のどのcenterDegも閾値に届かない場合は、範囲内で見つかった
// 最長の候補にフォールバックする（浅さの条件を満たしつつ、極端に短い「実質読めない弧」を
// 避けるための保険）。
// arcSmooth=trueの場合、判定は生の制御点ではなくdenseCurvePoints(実際にcatmullRomOpenPathが
// 描画する曲線の密サンプル)に対して行う(生の制御点の直線近似だけで判定すると、Catmull-Rom
// 平滑化後のオーバーシュートを見落として実際には25度を超える弧を採用してしまうため)
function fitShallowArc(
  pointAt: (angle: number) => Point,
  cx: number,
  cy: number,
  insetRatio: number,
  nominalCenterDeg: number,
  maxSweepDeg: number,
  nSamples: number,
  angleDirection: 1 | -1,
  arcSmooth: boolean,
): Point[] {
  const minUsableLength = MIN_USABLE_ARC_RATIO * cx * 2; // cx*2 ≈ viewBoxW（cxは各シェイプでviewBoxW/2）
  let bestResult: Point[] | null = null;
  let bestLength = -Infinity;
  for (let off = 0; off <= CENTER_SEARCH_RANGE_DEG; off += CENTER_SEARCH_STEP_DEG) {
    const signs = off === 0 ? [1] : [1, -1];
    for (const sign of signs) {
      const centerDeg = nominalCenterDeg + sign * off;
      const result = fitSweepAtCenter(pointAt, cx, cy, insetRatio, centerDeg, maxSweepDeg, nSamples, angleDirection, arcSmooth);
      if (!result) continue;
      const length = polylineLength(result);
      if (length >= minUsableLength) return result; // 極に近い側から見て十分な長さの最初の候補を採用
      if (length > bestLength) {
        bestLength = length;
        bestResult = result;
      }
    }
  }
  if (bestResult) return bestResult;
  // 保険: ±CENTER_SEARCH_RANGE_DEG以内のどのcenterDegでも条件を満たせない場合
  // （実運用のharmonics振幅上限では発生しない想定）。これ以上探索を広げる代わりに
  // nominalCenterDeg・最小幅でそのまま返す
  return sampleShallowCandidate(pointAt, cx, cy, insetRatio, nominalCenterDeg, MIN_SWEEP_DEG, nSamples, angleDirection);
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
    // hは32（A3のタイトル側マージン予約で削られた後も、説明文3行+罫線+参照リンクが
    // 収まるだけの余裕を残すため、当初の30から実測ベースで+2。詳細はshapeForIdea側の
    // TITLE_ARC_SAFE_MARGIN_MULTのコメント参照）
    safeArea: { x: 13, y: cy + domeR * 0.15, w: viewBoxW - 26, h: 32 },
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
    // hは28（A3のタイトル側マージン予約で削られた後も、説明文3行+罫線+参照リンクが
    // 収まるだけの余裕を残すため、当初の26から実測ベースで+2）
    safeArea: { x: 24, y: 40, w: 52, h: 28 },
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

// 下辺タイトルのフォントサイズ比率（viewBoxW比）。IdeaShapeCard.tsxの実際の描画フォントサイズと
// 共有する単一の真実源（safeAreaのタイトル側マージン予約(A3)にも同じ値を使い、二重定義によるズレを防ぐ）
export const TITLE_FONT_RATIO = 0.076;
// タイトル弧とsafeAreaの垂直分離に予約するマージン（タイトルのフォント高み相当+行間の余裕分）
const TITLE_ARC_SAFE_MARGIN_MULT = 1.0;

// 極中心の角度スイープ(fitShallowArc)だけでは、tallOval等の縦長シェイプで実長が極端に短く
// なるケースが残る（adversarialレビューで実測: tallOvalのtitleArcLengthは中央値で
// viewBoxWの約13%に留まり、13文字前後の実タイトルが2〜3文字+省略記号まで切り詰められてしまう。
// 輪郭の極=下極/上極は同時に曲率が最大の点でもあるため、極を中心にどれだけ角度探索しても
// その近傍の急な曲率からは逃れられないことが原因）。
// そこで極中心の角度サンプルとは別に、水平帯の実測幅（輪郭とy=一定線の交点）を使った
// Cartesian座標系での「弦(chord)」候補も生成し、実長がより長い方を採用する。
// 弦候補はx=cx+t*halfWidth（t:-1..1）で単調増加を構造的に保証し、接線角も弦の半幅とsagittaの
// 比から解析的に上限を設定できるため、縦長シェイプでも「底部を横断する幅広い浅弧」を無理なく作れる
const CHORD_Y_SEARCH_STEPS = 12;

function quadraticBezierPoint(p0: Point, c: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return { x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x, y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y };
}

// outlinePath(M/L/C/Q/Zのみで構成される。本ファイルの全ジェネレータがこの組み合わせしか
// 出力しない)を実際に描画される曲線に沿って密にサンプルした閉多角形にする。
// chord探索の輪郭近似には、pointAt(角度→半径の関数)由来の値ではなく必ずこれを使う:
// polygonシェイプのpointAtは頂点間を「半径の角度線形補間」で近似するが、実際のoutlinePath
// (roundedPolygonPath)は頂点間を直線で結ぶため、この2つは頂点以外の角度でズレる
// （半径の線形補間は2頂点を結ぶ真の弦(直線)より外側に張り出す）。このズレを踏まえずに
// pointAtベースの多角形でchordの幅を測ると、実際の塗り形状より広く見積もってしまい、
// タイトル文字が輪郭の外へはみ出す実バグを起こす（Fable視覚検分で実測）
function densePointsFromOutlinePath(d: string, samplesPerCurve = 24): Point[] {
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
      // "Z"や未知のトークンはスキップ（閉パスの終端。chordWidthAtY側で(i+1)%nによる
      // 折り返しで暗黙的に閉じるため、Z自体の処理は不要）
      i += 1;
    }
  }
  return pts;
}

// 水平線y=Yと閉多角形の交点のうち、cxを内側に挟む最も近い左右のペアを返す（両側に交点が
// 無ければ=その高さでは輪郭の外＝null）
function chordWidthAtY(polygon: readonly Point[], y: number, cx: number): { left: number; right: number } | null {
  const n = polygon.length;
  let left = -Infinity;
  let right = Infinity;
  for (let i = 0; i < n; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % n];
    if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
      const t = (y - p1.y) / (p2.y - p1.y);
      const x = p1.x + t * (p2.x - p1.x);
      if (x <= cx) left = Math.max(left, x);
      else right = Math.min(right, x);
    }
  }
  if (left === -Infinity || right === Infinity) return null;
  return { left, right };
}

// yLevel(弦の両端のy)・halfWidth(半幅)・sagitta(中央の弓なり量)から浅い弦弧の点列を作る。
// x=cx+t*halfWidthで単調増加を構造的に保証。bowSign=1は中央がyLevelより下(=safeAreaから
// 遠ざかる方向。タイトル用)、bowSign=-1は中央がyLevelより上(日付用)
function buildChordPoints(
  cx: number,
  yLevel: number,
  halfWidth: number,
  sagitta: number,
  bowSign: 1 | -1,
  nSamples: number,
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < nSamples; i++) {
    const t = -1 + (2 * i) / (nSamples - 1);
    pts.push({ x: cx + t * halfWidth, y: yLevel + bowSign * sagitta * (1 - t * t) });
  }
  return pts;
}

// yStart(safeAreaのすぐ外側)からyEnd(輪郭の先端側。実際の形状より先まで指定してよい=
// chordWidthAtYがnullを返して自然にクランプされる)まで水平帯の実測幅を探索し、浅い弧の
// 条件(isShallow。arcSmooth時は実際に描画される曲線での判定)を満たしつつ最も実長の長い
// 弦弧を返す（見つからなければnull＝呼び出し側は既存のradial候補にフォールバックする）
function fitChordArc(
  polygon: readonly Point[],
  cx: number,
  yStart: number,
  yEnd: number,
  insetRatio: number,
  bowSign: 1 | -1,
  nSamples: number,
  arcSmooth: boolean,
): Point[] | null {
  let best: Point[] | null = null;
  let bestLength = -Infinity;
  for (let i = 0; i <= CHORD_Y_SEARCH_STEPS; i++) {
    const t = i / CHORD_Y_SEARCH_STEPS;
    const yLevel = yStart + (yEnd - yStart) * t;
    const w = chordWidthAtY(polygon, yLevel, cx);
    if (!w) continue;
    const halfWidth = Math.min(cx - w.left, w.right - cx) * (1 - insetRatio);
    if (halfWidth <= 0) continue;
    const maxSagitta = (halfWidth * Math.tan(deg2rad(TANGENT_TARGET_DEG))) / 2;
    const sagitta = maxSagitta * 0.85; // Catmull-Rom平滑化のオーバーシュートに備えた安全マージン
    const candidate = buildChordPoints(cx, yLevel, halfWidth, sagitta, bowSign, nSamples);
    const checkPoints = arcSmooth ? denseCurvePoints(candidate, SHALLOW_CHECK_SAMPLES_PER_SEGMENT) : candidate;
    if (!isShallow(checkPoints)) continue;
    const length = polylineLength(candidate);
    if (length > bestLength) {
      bestLength = length;
      best = candidate;
    }
  }
  return best;
}

// radial候補とchord候補のうち実長が長い方を採用する（chordが見つからない場合はradialを使う）
function pickLongerArc(radial: Point[], chord: Point[] | null): Point[] {
  if (!chord) return radial;
  return polylineLength(chord) > polylineLength(radial) ? chord : radial;
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
const SHRINK_FACTOR = 0.96;
// outlinePolygonは輪郭の密サンプル近似であり、真の滑らかな曲線とはサンプル間隔ぶんの
// 微小な誤差がある（実測でviewBox比0.01未満オーダー）。判定をこの近似ぎりぎりで通すと、
// より高解像度な検証（スモークテスト等）でごく僅かに外側と判定されることがあるため、
// 判定用の多角形はさらにMARGIN_RATIOぶん内側へ縮めたものを使い、安全マージンを確保する
const CONTAINMENT_CHECK_MARGIN_RATIO = 0.99;

function scalePolygon(polygon: readonly Point[], cx: number, cy: number, factor: number): Point[] {
  return polygon.map((p) => ({ x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor }));
}

// 候補点列を中心(cx,cy)へわずかずつ縮小し、全点がoutlinePolygon(実際に描画されるoutlinePath)の
// 内側に収まるまで繰り返す最終防衛の安全網。splatはpointAtが実際の輪郭(ロブ形状)と意図的に
// 異なる（可読性優先でtextの弧をほぼ真円にする設計。ビルダー内のコメント参照）ため、
// insetRatioによる縮小だけでは輪郭内に収まる保証ができない。また弦(chord)候補もsagitta分だけ
// 弓なりにする際、単一Yレベルでの幅測定が想定していない局所的な凹みを踏むことがある
// （splatのような激しくジッターした輪郭で発生。Fable視覚検分後の実装で実測）。
// (cx,cy)を中心とした一様スケール(相似変換)は接線角・x単調増加のどちらも保つため
// （角度不変・符号保存）、他の保証を壊さずに安全に縮められる。
// arcSmooth=trueの場合、判定は生の候補点ではなくdenseCurvePoints(実際にcatmullRomOpenPathが
// 描画する曲線の密サンプル)に対して行う。生の点だけを見て縮小をやめると、Catmull-Rom平滑化が
// 隣接する2点の間で外側へ張り出す分を見落とし、実際にレンダリングされる曲線は輪郭の外に
// はみ出したままになる（tangent角チェックのisCandidateShallowと同じ理由。Fable視覚検分後の
// 実装で実測: 生の点は輪郭内でも、平滑化後の曲線が輪郭外に張り出すケースがあった）
function shrinkUntilContained(
  points: readonly Point[],
  cx: number,
  cy: number,
  polygon: readonly Point[],
  arcSmooth: boolean,
): readonly Point[] {
  const checkPolygon = scalePolygon(polygon, cx, cy, CONTAINMENT_CHECK_MARGIN_RATIO);
  const isContained = (candidate: readonly Point[]) => {
    const checkPoints = arcSmooth ? denseCurvePoints(candidate, SHALLOW_CHECK_SAMPLES_PER_SEGMENT) : candidate;
    return checkPoints.every((p) => pointInPolygon(p, checkPolygon));
  };
  let pts: readonly Point[] = points;
  for (let iter = 0; iter < SHRINK_MAX_ITERATIONS; iter++) {
    if (isContained(pts)) return pts;
    pts = pts.map((p) => ({ x: cx + (p.x - cx) * SHRINK_FACTOR, y: cy + (p.y - cy) * SHRINK_FACTOR }));
  }
  return pts; // 上限まで縮めても収まらない場合はそのまま返す（実運用では発生しない想定の保険）
}

// idea.idから決定論的にシェイプ1枚を組み立てる（Math.random不使用。同じidなら常に同じ結果）
export function shapeForIdea(ideaId: string): IdeaShape {
  const h = hashId(ideaId);
  const kind = SHAPE_KINDS[h % SHAPE_KINDS.length];
  const rng = mulberry32(h);
  const built = BUILDERS[kind](rng);
  const outlinePolygon = densePointsFromOutlinePath(built.outlinePath);

  // 日付弧(上極=-90°起点、角度増加が左→右)・タイトル弧(下極=90°起点、角度減少が左→右)を
  // それぞれ浅い弧に自動フィットする。既存のdateSpanDeg/titleSpanDeg幅は探索の上限(=これ以上は
  // 広げない)として使う
  const [dateFrom, dateTo] = built.dateSpanDeg;
  const [titleFrom, titleTo] = built.titleSpanDeg;
  const dateMaxSweep = Math.abs(dateTo - dateFrom) / 2;
  const titleMaxSweep = Math.abs(titleFrom - titleTo) / 2;
  const dateRadialPts = fitShallowArc(built.pointAt, built.cx, built.cy, built.insetRatio, -90, dateMaxSweep, 7, 1, built.arcSmooth);
  const titleRadialPts = fitShallowArc(built.pointAt, built.cx, built.cy, built.insetRatio, 90, titleMaxSweep, 9, -1, built.arcSmooth);

  // chord候補: safeAreaのすぐ外側から輪郭の先端側まで水平帯の実測幅で探す。タイトル側の
  // 開始位置はA3のマージン予約と同じ式を使い、そもそも margin不足で後からsafeAreaを
  // 削る事態を極力避ける（日付側はA3ほど厳密な予約要件がないため同じ式を流用する近似でよい）
  const titleMarginPxForChordStart = built.viewBoxW * TITLE_FONT_RATIO * TITLE_ARC_SAFE_MARGIN_MULT;
  const dateChordPts = fitChordArc(
    outlinePolygon,
    built.cx,
    built.safeArea.y - titleMarginPxForChordStart,
    built.cy - built.viewBoxH,
    built.insetRatio,
    -1,
    7,
    built.arcSmooth,
  );
  const titleChordPts = fitChordArc(
    outlinePolygon,
    built.cx,
    built.safeArea.y + built.safeArea.h + titleMarginPxForChordStart,
    built.cy + built.viewBoxH,
    built.insetRatio,
    1,
    9,
    built.arcSmooth,
  );

  // 最終防衛: どちらの候補が勝っても、実際に描画されるoutlinePathの内側に収まることを保証する
  // （splatのpointAtは意図的に実輪郭と異なる真円のため、insetRatioの縮小だけでは保証できない。
  // shrinkUntilContainedは相似変換なので接線角・x単調増加の保証は壊さない）
  const datePts = shrinkUntilContained(
    pickLongerArc(dateRadialPts, dateChordPts),
    built.cx,
    built.cy,
    outlinePolygon,
    built.arcSmooth,
  );
  const titlePts = shrinkUntilContained(
    pickLongerArc(titleRadialPts, titleChordPts),
    built.cx,
    built.cy,
    outlinePolygon,
    built.arcSmooth,
  );

  const dateArcPath = built.arcSmooth ? catmullRomOpenPath(datePts) : straightOpenPath(datePts);
  const titleArcPath = built.arcSmooth ? catmullRomOpenPath(titlePts) : straightOpenPath(titlePts);

  // A3: タイトル弧とsafeArea(説明文・リンク)の垂直分離。タイトルのフォント高ぶんのマージンを
  // 予約し、重なりゼロを保証する。safeArea.hだけを縮めるとy(上端)を据え置いたままになり、
  // 元のhの大小に関わらず縮小後の高さがmaxSafeBottom-safeArea.yに一意に決まってしまう
  // （=説明文3行+罫線+参照リンクの表示に必要な高さを確保できないケースが実測で発生。
  // Fable視覚検分後の実装で発見: 説明文3行目が罫線に重なって見えるバグ）。
  // そこで先にsafeArea自体を上(日付弧側)へシフトしてhをできるだけ保ち、日付弧の余白
  // (dateNearY)を侵さない範囲でシフトしても足りない場合だけ最終手段としてhを縮める。
  // titleNearY/dateNearYは生の点(datePts/titlePts)ではなく、arcSmooth時は実際に描画される
  // denseCurvePointsに対して計算する（Catmull-Rom平滑化は隣接2点の間で外側へ張り出すため、
  // 生の点だけを見ると実際のレンダリング結果より安全側に寄っていない値になる。shrinkUntilContained
  // やisCandidateShallowと同じ理由でここでも必要）
  const titleCheckPts = built.arcSmooth ? denseCurvePoints(titlePts, SHALLOW_CHECK_SAMPLES_PER_SEGMENT) : titlePts;
  const dateCheckPts = built.arcSmooth ? denseCurvePoints(datePts, SHALLOW_CHECK_SAMPLES_PER_SEGMENT) : datePts;
  const titleNearY = Math.min(...titleCheckPts.map((p) => p.y));
  const dateNearY = Math.max(...dateCheckPts.map((p) => p.y));
  const titleMarginPx = built.viewBoxW * TITLE_FONT_RATIO * TITLE_ARC_SAFE_MARGIN_MULT;
  const maxSafeBottom = titleNearY - titleMarginPx;
  let safeArea = built.safeArea;
  if (safeArea.y + safeArea.h > maxSafeBottom) {
    // 負の高さを避けるための最低保証（通常のharmonics範囲では到達しない想定の保険）。
    // scripts/smoke-idea-shapes.mjsのsafeArea高さ下限アサート(viewBoxHの15%)と同じ値に揃え、
    // 将来この保険が実際に発動した場合でもスモークテストと矛盾しないようにする
    const minH = built.viewBoxH * 0.15;
    const desiredY = maxSafeBottom - safeArea.h; // 元のhを保ったまま収めるために必要なy
    // dateNearYぴったりまでは詰めない: denseCurvePointsのサンプル数(6)は検証用の高解像度チェック
    // （スモークテスト等の8サンプル）と厳密には一致しないため、境界ぴったりだとより細かい
    // 解像度の検証でごく僅かに外側と判定されうる。安全マージンを乗せておく
    const dateSafetyMargin = built.viewBoxH * 0.006;
    const newY = Math.max(dateNearY + dateSafetyMargin, desiredY);
    const newH = Math.max(minH, maxSafeBottom - newY);
    safeArea = { ...safeArea, y: newY, h: newH };
  }

  return {
    kind,
    viewBoxW: built.viewBoxW,
    viewBoxH: built.viewBoxH,
    aspect: built.viewBoxW / built.viewBoxH,
    outlinePath: built.outlinePath,
    dateArcPath,
    titleArcPath,
    dateArcLength: polylineLength(datePts),
    titleArcLength: polylineLength(titlePts),
    safeArea,
  };
}
