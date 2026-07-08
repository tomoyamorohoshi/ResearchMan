// /ideas ポスターの「パズルカーニング」配置（DESIGN: goofy-hatching-mango.md 2026-07-07バッチ）。
// CSS Gridの行詰め(旧IdeasPoster.tsxのcomputeColStarts)を、サーバー計算の絶対配置コラージュに
// 置換する。輪郭サンプル点(ideaShapes.tsのoutlineToLayoutSpace)同士の最短距離を実測しながら、
// 隣接シルエットの隙間が目標値(2〜8px、hashで揺らぎ)になるまで詰める「パズルカーニング」を行う。
//
// 3ティア構成（実装詳細補足B.1）: mobile(<640px, 基準幅390) / compact(640-1024px, 基準幅576) /
// wide(1024px〜, 基準幅960)。mobileは1カラム縦積み+垂直カーニングのみ、compact/wideは行詰め+
// 水平・垂直カーニングの両方を行う。各ティアはサーバーで1回だけ計算し、IdeasPoster.tsx側は
// CSS %でフルイドスケールする（連続リサイズの動的再計算はしない。決定論・SSR整合を優先）。
//
// 純関数・決定論（Math.random不使用。hashId(id)由来のジッタのみ）。
import { hashId } from "./graph";
import {
  estimateReservedLinksHeightPx,
  fitDescription,
  isComplexShapeKind,
  KIND_WEIGHT,
  outlineToLayoutSpace,
  SHAPE_KINDS,
  shapeForIdea,
  type ContentRef,
  type IdeaShape,
  type Point,
  type ShapeKind,
} from "./ideaShapes";

export type CollageTier = "mobile" | "compact" | "wide";

// 実装詳細補足B.1: 各ティアの基準幅(px)。CSSのレスポンシブdisplayクラスで切替え、
// コンテナは`width:100%; aspect-ratio: 基準幅/計算済み合計高さ`によりこの基準幅1回の
// サーバー計算のみで任意の実viewport幅へ比率保存のままフルイドスケールする
// B.2: mobileはIdeasPoster.tsxのコンテナが`px-4`(16px×2=32px)を差し引く必要がある
// (compact/wideは`sm:px-8`=32px×2=64pxを既に差し引き済み=576=640-64・960=1024-64だったが、
// mobileの390はこの差し引きが漏れていた設計不整合。goofy-hatching-mango.md 2026-07-07バッチで
// 390-2×16=358に修正)
export const TIER_REF_WIDTH_PX: Record<CollageTier, number> = {
  mobile: 358,
  compact: 576,
  wide: 960,
};

// A.4: 説明文の実表示サイズ（物理px、viewBox非依存）のティアごとの下限。goofy-hatching-mango.md
// 2026-07-07バッチ（コンテンツ量に応じたシェイプ割り当て）。旧ideaShapes.tsのDESC_FONT_
// PHYSICAL_FLOOR_PX（全ティア共通5px）をここへ移設し、ティアごとの値に変えた。
//
// 経緯: 当初計画の目安は9pxだったが、前バッチ(d40b611)の実測でhashのみに基づくシェイプ選択
// では9px達成のためのカード拡大がパズルカーニングの敷き詰め感を実質的に破壊すること
// (行の大半が1カードのみの単一列になる)が判明し、5pxへ妥協した（ideaShapes.tsの旧コメント
// 参照）。本バッチはこの妥協を根治する: assignShapeKinds（下記）がコンテンツ量（説明文の
// 長さ・参照リンク数）に応じてsafeArea比率の大きいシェイプ種を優先的に割り当てることで、
// カードを過度に拡大しなくても下限に届くようにした。これにより実効値を
// wide/compact=8px・mobile=7pxへ引き上げ、全50カード×3ティアで下限未達ゼロを達成する
// （受け入れ条件。scripts/smoke-idea-shapes.mjsのbelowFloor===0アサート参照）
export const DESC_FONT_PHYSICAL_FLOOR_PX: Record<CollageTier, number> = {
  mobile: 7,
  compact: 8,
  wide: 8,
};

export type CollageCardInput = {
  id: string; // idea.id（hashIdジッタ・トレースに使う）
  shape: IdeaShape; // shapeForIdea(idea.id, idea.title, dateLabel, { seed, refs }) の結果
  seedText: string; // idea.seed（物理フォント下限判定用。IdeaShapeCardと同じ値を渡すこと）
  refs: readonly ContentRef[]; // idea.refs（同上）
};

export type CardPlacement = {
  id: string;
  leftPx: number; // ボックス(ラッパーdiv)の左端。ティア基準幅を単位とするレイアウト座標
  topPx: number; // ボックスの上端
  widthPx: number; // ボックス幅
  heightPx: number; // ボックス高さ
  rotateDeg: number; // CSS transform:rotate()にそのまま渡す角度
};

export type CollageLayoutResult = {
  placements: readonly CardPlacement[]; // 入力cardsと同じ順序
  containerHeightPx: number; // コンテナのaspect-ratio算出に使う合計高さ(レイアウト座標単位)
  // B.4: カーニングで実際に達成された隣接ペアの最短距離(検証・スモークテスト用)。
  // horizontalGaps=同一行内の隣接カード間、verticalGaps=前の行との間(先頭行を除く)
  horizontalGaps: readonly number[];
  verticalGaps: readonly number[];
};

// 既存(旧IdeasPoster.tsx)のS/M/Lサイズ段階・col-span候補をそのまま流用（12分率）。
// CSS Gridのcol-span/col-start整数制約が無くなった（絶対配置＋CSS %）ため、丸めずに
// 連続値のまま扱う（A.2の物理下限拡大がなめらかに効くようにするため）
type SizeTier = "S" | "M" | "L";
const DESKTOP_SPAN_OPTIONS: Record<SizeTier, readonly number[]> = {
  S: [3],
  M: [4, 5],
  L: [5, 6],
};
const TOTAL_COLS = 12;

// 旧IdeasPoster.tsxのCARD_ASPECT_CLAMP_MIN/MAXを踏襲。極端に縦長/横長なシェイプ
// (実測: tallOvalでcropAspect0.49等)でもボックス自体の高さを常識的な範囲に収める
// （SVG自体は元のcropAspectのままpreserveAspectRatio既定のmeetでわずかな余白が生じるが、
// カーニング計算はfitContentSize経由でその実コンテンツサイズを使うため数学的整合は保たれる）
const CARD_ASPECT_CLAMP_MIN = 0.55;
const CARD_ASPECT_CLAMP_MAX = 1.7;

function clampBoxAspect(aspect: number): number {
  return Math.min(CARD_ASPECT_CLAMP_MAX, Math.max(CARD_ASPECT_CLAMP_MIN, aspect));
}

// ボックスの幅比率(12分率)をcropAspectで補正する（旧spanForAspectと同じ考え方。冪0.85）。
// 整数への丸めは行わない(旧実装との差分。絶対配置化で不要になった)
function spanForAspect(baseSpan: number, cropAspect: number): number {
  const clamped = clampBoxAspect(cropAspect);
  const factor = clamped ** 0.85;
  return Math.min(6, Math.max(3, baseSpan * factor));
}

function baseNaturalColSpan(id: string, cropAspect: number): number {
  const h = hashId(id);
  const tier: SizeTier = h % 3 === 0 ? "S" : h % 3 === 1 ? "M" : "L";
  const spanOptions = DESKTOP_SPAN_OPTIONS[tier];
  const baseSpan = spanOptions[Math.floor(h / 3) % spanOptions.length];
  return spanForAspect(baseSpan, cropAspect);
}

// SVGのpreserveAspectRatio既定(xMidYMid meet)は、ボックスのaspect-ratio(clampBoxAspect後)と
// 実コンテンツのaspect(cropAspect生値)が食い違う少数の外れ値ケースで、コンテンツをボックス中央に
// 収まる最大サイズへレターボックスする。カーニング計算・物理フォント下限判定は「実際に画面へ
// 描画されるコンテンツのサイズ」を基準にする必要があるため、ボックスサイズからこの実コンテンツ
// サイズを算出する（centerはボックス中心と一致=meetは常に中央寄せのため、centerX/centerYは
// ボックス自身の中心をそのまま使ってよい）
function fitContentSize(boxWidthPx: number, boxHeightPx: number, contentAspect: number): { width: number; height: number } {
  const boxAspect = boxWidthPx / boxHeightPx;
  if (boxAspect > contentAspect) {
    const height = boxHeightPx;
    return { width: height * contentAspect, height };
  }
  const width = boxWidthPx;
  return { width, height: width / contentAspect };
}

// A.3: physicalFontPxFor純関数として切り出す(goofy-hatching-mango.md 2026-07-07バッチ・
// コンテンツ量に応じたシェイプ割り当て)。ensurePhysicalFontFloorとassignShapeKindsの
// feasibility判定の両方から同じ式を呼ぶことで、二重実装によるズレを防ぐ
function physicalFontPxFor(card: CollageCardInput, tierRefWidthPx: number, colSpan: number): number {
  const { shape, seedText, refs } = card;
  const hasRefs = refs.length > 0;
  const reserved = hasRefs ? estimateReservedLinksHeightPx(shape.viewBoxW, shape.safeArea.w, refs) : 0;
  const descFit = fitDescription(shape.viewBoxW, shape.safeArea.w, shape.safeAreaMaxGrowH, reserved, seedText);
  const naturalWidthPx = (colSpan / TOTAL_COLS) * tierRefWidthPx;
  const boxAspect = clampBoxAspect(shape.cropAspect);
  const naturalHeightPx = naturalWidthPx / boxAspect;
  const content = fitContentSize(naturalWidthPx, naturalHeightPx, shape.cropAspect);
  const scale = content.width / shape.cropViewBox.w;
  return descFit.fontSizePx * scale;
}

// A.2/A.4: 物理フォント下限保証。descFit.fontSizePx(viewBox単位)は物理レンダリングサイズと
// 無関係(純粋にshape/seed/refsだけで決まる)なため、ボックス幅を大きくすれば実画面上の
// フォントサイズは線形に比例して大きくなる。よって反復探索は不要で、必要なスケール倍率を
// 閉じた式で解ける: requiredScale = floorPx / physicalFontPx
// A.4: floorはティアごとの値(DESC_FONT_PHYSICAL_FLOOR_PX[tier])を使う
function ensurePhysicalFontFloor(card: CollageCardInput, tierRefWidthPx: number, baseColSpan: number, tier: CollageTier): number {
  const physicalFontPx = physicalFontPxFor(card, tierRefWidthPx, baseColSpan);
  const floor = DESC_FONT_PHYSICAL_FLOOR_PX[tier];
  if (physicalFontPx >= floor || physicalFontPx <= 0) return baseColSpan;
  const requiredScale = floor / physicalFontPx;
  return baseColSpan * requiredScale;
}

// 目安上限(行幅の65〜70%程度=12分率で8前後)を超えてもなお物理下限に足りない場合は、
// 可読性を優先しさらに拡大する（正しさ＞デザインの変化量。実装詳細補足A.2参照）。
// 絶対上限としてはコンテナ全体の12分率(=1行いっぱい)でクランプする（それ以上は
// レイアウトの意味を成さないため。実データではこの上限に到達しない想定）
const ABSOLUTE_MAX_COL_SPAN = TOTAL_COLS;

function resolveNaturalColSpan(card: CollageCardInput, tierRefWidthPx: number, tier: CollageTier): number {
  const base = baseNaturalColSpan(card.id, card.shape.cropAspect);
  const floorAdjusted = ensurePhysicalFontFloor(card, tierRefWidthPx, base, tier);
  return Math.min(ABSOLUTE_MAX_COL_SPAN, floorAdjusted);
}

// ── A.5: コンテンツ量に応じたシェイプ割り当て ────────────────────────────────
// goofy-hatching-mango.md 2026-07-07バッチ（可読性の根治）。従来はshapeForIdeaがhashId(id)だけで
// シェイプ種を決めていたため、safeAreaの狭い形(lNotch/splat等)に長文が割り当たると、カードを
// 行幅いっぱいに拡大しても物理フォント下限に届かないケースが残っていた(前バッチの妥協:
// DESC_FONT_PHYSICAL_FLOOR_PXを5pxへ引き下げ)。本関数は各ideaについて、
// (1) hashベースのデフォルト種で3ティアとも下限を満たせるならそのまま採用（短文カードは
//     従来どおりhashで自由に選ぶ＝複雑形が自然と短文側に集まる）、
// (2) 満たせない場合のみ、9種(＋複雑形4種は浅い変種も)を全探索し、3ティアとも下限を満たせる
//     候補の集合からKIND_WEIGHTの重みでhash順に1つ選ぶ（満たせる種が複数あれば複雑形も選択肢に
//     残る＝全体の複雑さ低下を最小化）、
// (3) それでも候補が0件の場合のみ、3ティアの「達成px/下限px」の最小値(マージン比)を最大化する
//     (kind,generous)を選ぶフォールバック（この分岐が発動した場合はconsole.warnで通知する。
//     実データ50件で発動しないことが受け入れ条件）
// という優先順位で決定論的に(kind, generous)を決める。ジッタシードはshapeForIdea内部で
// hashId(id)から導出されるため、種が変わっても全図形ユニーク性・決定論は自動的に維持される
export type IdeaContentInput = {
  id: string;
  title: string;
  dateLabel: string;
  seed: string;
  refs: readonly ContentRef[];
};

export type ShapeAssignment = { kind: ShapeKind; generous: boolean };

// feasibility判定・フォールバックのマージン比計算はどちらも「3ティアとも行幅いっぱい
// (colSpan=ABSOLUTE_MAX_COL_SPAN)まで拡大した場合の物理フォントpx」を評価する。実際のレイアウトが
// この列幅まで拡大するとは限らないが、「この種を選べば理論上下限に届き得るか」を判定する
// feasibility探索としてはこれが正しい評価点になる(実際のcolSpan決定はresolveNaturalColSpanが
// 別途行う)
const ASSIGN_FEASIBILITY_EPS = 1e-6;
const ASSIGN_TIERS: readonly CollageTier[] = ["mobile", "compact", "wide"];

function probeTierFontPx(shape: IdeaShape, seedText: string, refs: readonly ContentRef[]): { tier: CollageTier; px: number; floor: number }[] {
  return ASSIGN_TIERS.map((tier) => {
    const card: CollageCardInput = { id: "assign-probe", shape, seedText, refs };
    const px = physicalFontPxFor(card, TIER_REF_WIDTH_PX[tier], ABSOLUTE_MAX_COL_SPAN);
    return { tier, px, floor: DESC_FONT_PHYSICAL_FLOOR_PX[tier] };
  });
}

function isFeasibleAtFullWidth(probes: readonly { px: number; floor: number }[]): boolean {
  return probes.every((p) => p.px >= p.floor - ASSIGN_FEASIBILITY_EPS);
}

function marginRatio(probes: readonly { px: number; floor: number }[]): number {
  return Math.min(...probes.map((p) => p.px / p.floor));
}

export function assignShapeKinds(ideas: readonly IdeaContentInput[]): Map<string, ShapeAssignment> {
  const result = new Map<string, ShapeAssignment>();
  for (const idea of ideas) {
    const content = { seed: idea.seed, refs: idea.refs };

    const defaultShape = shapeForIdea(idea.id, idea.title, idea.dateLabel, content);
    if (isFeasibleAtFullWidth(probeTierFontPx(defaultShape, idea.seed, idea.refs))) {
      result.set(idea.id, { kind: defaultShape.kind, generous: false });
      continue;
    }

    // 満たせない場合のみ、9種(複雑形は通常/浅い変種の両方)を全探索する
    type Evaluated = { kind: ShapeKind; generous: boolean; feasible: boolean; margin: number };
    const evaluated: Evaluated[] = [];
    for (const kind of SHAPE_KINDS) {
      const shape = shapeForIdea(idea.id, idea.title, idea.dateLabel, content, { forceKind: kind });
      const probes = probeTierFontPx(shape, idea.seed, idea.refs);
      evaluated.push({ kind, generous: false, feasible: isFeasibleAtFullWidth(probes), margin: marginRatio(probes) });
      if (isComplexShapeKind(kind)) {
        const gShape = shapeForIdea(idea.id, idea.title, idea.dateLabel, content, { forceKind: kind, generous: true });
        const gProbes = probeTierFontPx(gShape, idea.seed, idea.refs);
        evaluated.push({ kind, generous: true, feasible: isFeasibleAtFullWidth(gProbes), margin: marginRatio(gProbes) });
      }
    }

    const feasibleCandidates = evaluated.filter((e) => e.feasible);
    if (feasibleCandidates.length > 0) {
      // KIND_WEIGHTと同じ考え方で重み展開したリストからhashId(id)で決定論的に1つ選ぶ
      const weighted = feasibleCandidates.flatMap((c) => Array<Evaluated>(KIND_WEIGHT[c.kind]).fill(c));
      const picked = weighted[hashId(idea.id) % weighted.length];
      result.set(idea.id, { kind: picked.kind, generous: picked.generous });
      continue;
    }

    // フォールバック: 9種×variant全探索でも3ティアいずれかで下限未達だった場合のみ、
    // マージン比(達成px/下限pxの3ティア最小値)を最大化する組み合わせを選ぶ
    let best = evaluated[0];
    for (const e of evaluated) if (e.margin > best.margin) best = e;
    console.warn(
      `assignShapeKinds: ${idea.id} は全9種×浅い変種でも3ティアいずれかの物理フォント下限に届かない。` +
        `最もマージン比の高い組み合わせへフォールバック (kind=${best.kind}, generous=${best.generous}, マージン比=${best.margin.toFixed(3)})`,
    );
    result.set(idea.id, { kind: best.kind, generous: best.generous });
  }
  return result;
}

// ── カーニング探索（B.3: 粗探索→二分探索の2段階 + 非重なり防御チェック） ──────────────
function minPointCloudDistance(a: readonly Point[], b: readonly Point[]): number {
  let min = Infinity;
  for (const pa of a) {
    for (const pb of b) {
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const d = dx * dx + dy * dy;
      if (d < min) min = d;
    }
  }
  return Math.sqrt(min);
}

// レイキャスト法による点-多角形包含判定（標準的な奇偶則。ideaShapes.ts内部の同名関数と同じ
// アルゴリズムだが、こちらは輪郭サンプル点(密だが有限個)をそのまま多角形として使う簡易版）
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

// 非重なりの実測クリアランス。境界(輪郭サンプル点)同士の最短ユークリッド距離は定義上つねに
// 0以上のため、それだけでは「凹形状の別の場所(切り欠き・くびれ等)で塗りつぶし同士が実際に
// 食い込んでいる」真の重なりを検出できない(2つの凸部分が近接目標を満たしていても、
// 別の凹部で先に食い込みが起きているケースがある。実装中の検証で実測した回帰)。
// 一方の輪郭サンプル点がもう一方の塗りつぶし多角形の内部に入っていないかを直接判定し、
// 入っていれば非重なり探索が「target(2〜8px)よりさらに遠ざける必要がある」と判断できるよう
// 負のセンチネル値を返す(通常の正の距離とは値域が重ならないため、探索の目標判定
// (distAt(v) <= target)に自然に組み込める)
const OVERLAP_SENTINEL = -1;
function clearance(a: readonly Point[], b: readonly Point[]): number {
  for (const p of a) if (pointInPolygon(p, b)) return OVERLAP_SENTINEL;
  for (const p of b) if (pointInPolygon(p, a)) return OVERLAP_SENTINEL;
  return minPointCloudDistance(a, b);
}

const KERNING_COARSE_STEPS = 80;
const KERNING_BINARY_ITERS = 30;
// 数値誤差で万一0未満になった場合に戻す1回あたりの微小量（非重なり防御チェック用）
const OVERLAP_RECOVERY_STEP = 0.25;
const OVERLAP_RECOVERY_MAX_ITER = 200;

// f(v)は「vを近づける方向(x:減少 / y:減少)に動かすほどdistが小さくなる」ことを前提にした
// 粗探索→二分探索。実際の凹凸形状では厳密な単調性は保証できないため、粗探索は評価点ごとに
// 逐次的に判定し(飛び越し防止)、最初にtargetを跨いだ区間だけを二分探索で精緻化する
function solveKerningPosition(
  farValue: number,
  stepSize: number,
  target: number,
  distAt: (v: number) => number,
): number {
  let v = farValue;
  let prevV = v;
  let prevDist = distAt(v);
  for (let i = 0; i < KERNING_COARSE_STEPS; i++) {
    const nextV = v - stepSize;
    const nextDist = distAt(nextV);
    if (nextDist <= target) {
      // [nextV, v] の区間で二分探索(nextV側がdist<=target、v側がdist>target寄り)
      let lo = nextV;
      let hi = prevDist > target ? v : prevV;
      for (let b = 0; b < KERNING_BINARY_ITERS; b++) {
        const mid = (lo + hi) / 2;
        const midDist = distAt(mid);
        if (midDist > target) hi = mid;
        else lo = mid;
      }
      // 非重なり防御チェック: 凹形状では、二分探索が収束したlo(境界最短距離としてはtargetに
      // 近い)が、別の凹部(切り欠き・くびれ等)で塗りつぶし同士が食い込んでいる
      // (distAt()がOVERLAP_SENTINEL相当の負値を返す)ことがある。二分探索の不変条件により、
      // hi側は常にdistAt(hi) > target(=非重なりかつtarget超過)が成立することが保証されている
      // ため、loが重なりを示す場合はhiへフォールバックする(達成ギャップはtargetよりわずかに
      // 大きくなるが、非重なりを優先する)
      let finalV = lo;
      if (distAt(finalV) < 0) finalV = hi;
      // それでも万一(数値誤差等で)負になっていたら、非重なりが確認できるまでさらに遠ざける
      for (let r = 0; r < OVERLAP_RECOVERY_MAX_ITER && distAt(finalV) < 0; r++) {
        finalV += OVERLAP_RECOVERY_STEP;
      }
      return finalV;
    }
    prevV = v;
    prevDist = nextDist;
    v = nextV;
  }
  // 上限ステップ数まで交差が見つからない場合(通常発生しない想定の安全網): 最後に評価した
  // 位置をそのまま返す(farValueは呼び出し側が確実に非重複な位置を渡す前提のため、
  // これでも重なりは生じない)
  return v;
}

// ── カード配置本体 ────────────────────────────────────────────────────────
type PreparedCard = {
  input: CollageCardInput;
  colSpan: number;
  boxWidthPx: number;
  boxHeightPx: number;
  contentWidthPx: number;
  contentHeightPx: number;
  rotateDeg: number;
  gapH: number; // 直前カードとの水平目標ギャップ(2〜8px)
  gapV: number; // 直前行との垂直目標ギャップ(2〜8px。行の代表として先頭カードの値を使う)
};

function prepareCard(input: CollageCardInput, tierRefWidthPx: number, tier: CollageTier): PreparedCard {
  const colSpan = resolveNaturalColSpan(input, tierRefWidthPx, tier);
  const boxWidthPx = (colSpan / TOTAL_COLS) * tierRefWidthPx;
  const boxAspect = clampBoxAspect(input.shape.cropAspect);
  const boxHeightPx = boxWidthPx / boxAspect;
  const content = fitContentSize(boxWidthPx, boxHeightPx, input.shape.cropAspect);
  const h = hashId(input.id);
  // 実装詳細補足B.3: 既存のhashId(id) >>> Nビットシフトの流儀通り。rotate/z-indexは
  // 旧IdeasPoster.tsxと同じビット域を踏襲(意味的な連続性)、G_h/G_vは旧widthPct/marginで
  // 使っていた空きビット域を再利用する
  const rotateDeg = (((h >>> 4) % 1000) / 1000 - 0.5) * 6; // -3..3deg（旧layoutForと同じ）
  const gapH = 2 + (((h >>> 9) % 1000) / 1000) * 6; // 2..8px
  const gapV = 2 + (((h >>> 18) % 1000) / 1000) * 6; // 2..8px
  return { input, colSpan, boxWidthPx, boxHeightPx, contentWidthPx: content.width, contentHeightPx: content.height, rotateDeg, gapH, gapV };
}

type RowSlot = { card: PreparedCard; leftPx: number };

function packRows(cards: readonly PreparedCard[]): RowSlot[][] {
  const rows: RowSlot[][] = [];
  let current: PreparedCard[] = [];
  let used = 0;
  for (const c of cards) {
    if (used + c.colSpan > TOTAL_COLS && current.length > 0) {
      rows.push(current.map((cc) => ({ card: cc, leftPx: 0 })));
      current = [];
      used = 0;
    }
    current.push(c);
    used += c.colSpan;
  }
  if (current.length > 0) rows.push(current.map((cc) => ({ card: cc, leftPx: 0 })));
  return rows;
}

function outlineAt(card: PreparedCard, leftPx: number, topPx: number): Point[] {
  const centerX = leftPx + card.boxWidthPx / 2;
  const centerY = topPx + card.boxHeightPx / 2;
  return outlineToLayoutSpace(card.input.shape, {
    widthPx: card.contentWidthPx,
    heightPx: card.contentHeightPx,
    rotateDeg: card.rotateDeg,
    centerX,
    centerY,
  });
}

// 行内の水平カーニング: 左から順に、直前カードの輪郭と次カードの輪郭の最短距離が
// gapH(次カード基準)になるまで次カードのleftPxを詰める。戻り値は各隣接ペアで実際に
// 達成された最短距離(B.4スモーク・検証レポート用)
function kernRowHorizontally(row: RowSlot[], rowTopY: number, startLeftPx: number): number[] {
  if (row.length === 0) return [];
  row[0].leftPx = startLeftPx;
  const achieved: number[] = [];
  let prevOutline = outlineAt(row[0].card, row[0].leftPx, rowTopY);
  for (let i = 1; i < row.length; i++) {
    const slot = row[i];
    const prevMaxX = Math.max(...prevOutline.map((p) => p.x));
    const farLeft = prevMaxX + slot.card.contentWidthPx * 1.2;
    const stepSize = Math.max(0.5, (slot.card.contentWidthPx * 3) / KERNING_COARSE_STEPS);
    const distAt = (leftPx: number) => clearance(prevOutline, outlineAt(slot.card, leftPx, rowTopY));
    slot.leftPx = solveKerningPosition(farLeft, stepSize, slot.card.gapH, distAt);
    // 達成距離はprevOutlineを次カード自身のものへ再代入する"前"に測る（再代入後だと
    // distAtのprevOutlineが次カード自身になり、自分自身との距離=0を記録してしまうバグを
    // 避けるため。実装中の検証(distAt(nextV)経由の粗探索は正しいがpush時点の再測定が
    // ずれていた)で発見した）
    achieved.push(distAt(slot.leftPx));
    prevOutline = outlineAt(slot.card, slot.leftPx, rowTopY);
  }
  return achieved;
}

// 直前行・当該行はいずれも複数カードを含みうる。それぞれのカードの輪郭点列を1つの多角形として
// 結合(concat)してしまうと、無関係な2カードの輪郭点が"辺"として繋がってしまいpointInPolygonが
// 誤判定する(実装中の検証で発見: 境界最短距離だけを見るminPointCloudDistanceのみでは検出でき
// なかった、凹形状の切り欠き・くびれ部分での真の塗りつぶし食い込みバグの原因調査で判明)。
// カードごとの輪郭点列をグループとして保持し、2グループの全カードペアそれぞれにclearance()を
// 適用した最小値を取ることで、この誤判定を避ける
function outlinesForRow(row: readonly RowSlot[], topY: number): Point[][] {
  return row.map((slot) => outlineAt(slot.card, slot.leftPx, topY));
}

function minClearanceBetweenGroups(a: readonly Point[][], b: readonly Point[][]): number {
  let min = Infinity;
  for (const oa of a) {
    for (const ob of b) {
      const c = clearance(oa, ob);
      if (c < min) min = c;
    }
  }
  return min;
}

// 行単位の垂直カーニング: 直前行の全カード輪郭と当該行の全カード輪郭(水平配置確定後)の
// 最短距離がgapV(当該行の代表=先頭カード基準)になるまで行全体をΔyだけ持ち上げる。
// 戻り値のachievedGapは先頭行(直前行が無い)ではnull
function kernRowVertically(
  row: RowSlot[],
  prevRowOutlines: readonly Point[][] | null,
  nominalTopY: number,
): { topY: number; achievedGap: number | null } {
  if (prevRowOutlines === null || row.length === 0) return { topY: nominalTopY, achievedGap: null };
  const target = row[0].card.gapV;
  const maxBoxHeight = Math.max(...row.map((s) => s.card.boxHeightPx));
  const farTopY = nominalTopY + maxBoxHeight * 1.2;
  const stepSize = Math.max(0.5, (maxBoxHeight * 3) / KERNING_COARSE_STEPS);
  const distAt = (topY: number) => minClearanceBetweenGroups(prevRowOutlines, outlinesForRow(row, topY));
  const topY = solveKerningPosition(farTopY, stepSize, target, distAt);
  return { topY, achievedGap: distAt(topY) };
}

// compact/wideティア: 行詰め+水平・垂直カーニングの両方
function computeGridTierLayout(cards: readonly CollageCardInput[], tier: "compact" | "wide"): CollageLayoutResult {
  const tierRefWidthPx = TIER_REF_WIDTH_PX[tier];
  const prepared = cards.map((c) => prepareCard(c, tierRefWidthPx, tier));
  const rows = packRows(prepared);

  const placementById = new Map<string, CardPlacement>();
  let prevRowOutlines: Point[][] | null = null;
  let nominalTopY = 0;
  let maxBottomY = 0;
  const horizontalGaps: number[] = [];
  const verticalGaps: number[] = [];

  for (const row of rows) {
    const rowSpanSum = row.reduce((s, slot) => s + slot.card.colSpan, 0);
    const slackCols = Math.max(0, TOTAL_COLS - rowSpanSum);
    const slackPx = (slackCols / TOTAL_COLS) * tierRefWidthPx;
    const rowSeedH = hashId(row[0].card.input.id);
    const startLeftPx = slackPx > 0 ? ((rowSeedH % 1000) / 1000) * slackPx : 0;

    // 水平カーニング: まずnominalTopYで仮配置(垂直カーニングは後段でΔy分だけ一様に動かすため、
    // 行内の相対位置には影響しない)
    const rowHGaps = kernRowHorizontally(row, nominalTopY, startLeftPx);
    horizontalGaps.push(...rowHGaps);

    // 垂直カーニング: 直前行との最短距離がgapVになるまで行全体をnominalTopYから調整
    const { topY: finalTopY, achievedGap } = kernRowVertically(row, prevRowOutlines, nominalTopY);
    if (achievedGap !== null) verticalGaps.push(achievedGap);

    for (const slot of row) {
      placementById.set(slot.card.input.id, {
        id: slot.card.input.id,
        leftPx: slot.leftPx,
        topPx: finalTopY,
        widthPx: slot.card.boxWidthPx,
        heightPx: slot.card.boxHeightPx,
        rotateDeg: slot.card.rotateDeg,
      });
      maxBottomY = Math.max(maxBottomY, finalTopY + slot.card.boxHeightPx);
    }

    prevRowOutlines = outlinesForRow(row, finalTopY);
    nominalTopY = maxBottomY;
  }

  const placements = cards.map((c) => placementById.get(c.id)!);
  return { placements, containerHeightPx: maxBottomY, horizontalGaps, verticalGaps };
}

// mobileティア: 1カラム縦積み。垂直カーニングのみ(各カードを「1カードだけの行」として扱う)
function computeMobileTierLayout(cards: readonly CollageCardInput[]): CollageLayoutResult {
  const tierRefWidthPx = TIER_REF_WIDTH_PX.mobile;
  const placements: CardPlacement[] = [];
  let prevOutlines: Point[][] | null = null;
  let nominalTopY = 0;
  let maxBottomY = 0;
  const verticalGaps: number[] = [];

  for (const input of cards) {
    // mobileは常にフル幅(colSpan=12固定。既存MOBILE_FULLと同じ思想)。物理下限はフル幅到達後の
    // 値をそのまま使う(これ以上ボックスを広げる余地がないため。実データでは未発動想定)
    const prepared = prepareCard(input, tierRefWidthPx, "mobile");
    const boxWidthPx = tierRefWidthPx;
    const boxAspect = clampBoxAspect(input.shape.cropAspect);
    const boxHeightPx = boxWidthPx / boxAspect;
    const content = fitContentSize(boxWidthPx, boxHeightPx, input.shape.cropAspect);
    const card: PreparedCard = { ...prepared, boxWidthPx, boxHeightPx, contentWidthPx: content.width, contentHeightPx: content.height };
    const row: RowSlot[] = [{ card, leftPx: 0 }];

    const { topY: finalTopY, achievedGap } = kernRowVertically(row, prevOutlines, nominalTopY);
    if (achievedGap !== null) verticalGaps.push(achievedGap);
    placements.push({
      id: input.id,
      leftPx: 0,
      topPx: finalTopY,
      widthPx: boxWidthPx,
      heightPx: boxHeightPx,
      rotateDeg: card.rotateDeg,
    });
    maxBottomY = finalTopY + boxHeightPx;
    prevOutlines = [outlineAt(card, 0, finalTopY)];
    nominalTopY = maxBottomY;
  }

  return { placements, containerHeightPx: maxBottomY, horizontalGaps: [], verticalGaps };
}

// 決定論・純関数。同じcards配列(内容が同一)を渡せば常に同じ結果を返す
export function computeCollageLayout(cards: readonly CollageCardInput[], tier: CollageTier): CollageLayoutResult {
  if (cards.length === 0) return { placements: [], containerHeightPx: 0, horizontalGaps: [], verticalGaps: [] };
  if (tier === "mobile") return computeMobileTierLayout(cards);
  return computeGridTierLayout(cards, tier);
}

// スモークテスト・検証用に隣接ペアの最短距離を計測するヘルパー(B.4)。
// 同一行内の隣接ペア(水平)・行をまたぐ全ペア(垂直)を区別せず、全カードペアの中で
// レイアウト上「近そうな」ペアだけに絞ると見落としのリスクがあるため、視覚的に近接しうる
// 候補ペア(ボックス距離が近いもの)を対象に全ペアの最短輪郭距離を計測する
export function measurePairwiseDistances(
  cards: readonly CollageCardInput[],
  layout: CollageLayoutResult,
): { minDistances: number[]; overlapCount: number } {
  const outlines = cards.map((c, i) => {
    const p = layout.placements[i];
    return outlineToLayoutSpace(c.shape, {
      widthPx: fitContentSize(p.widthPx, p.heightPx, c.shape.cropAspect).width,
      heightPx: fitContentSize(p.widthPx, p.heightPx, c.shape.cropAspect).height,
      rotateDeg: p.rotateDeg,
      centerX: p.leftPx + p.widthPx / 2,
      centerY: p.topPx + p.heightPx / 2,
    });
  });
  const minDistances: number[] = [];
  let overlapCount = 0;
  const NEAR_BOX_MARGIN = 60; // この距離を超えて離れたボックス同士は近接候補から除外(性能用)
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const pi = layout.placements[i];
      const pj = layout.placements[j];
      const boxDx = Math.max(0, Math.abs(pi.leftPx + pi.widthPx / 2 - (pj.leftPx + pj.widthPx / 2)) - (pi.widthPx + pj.widthPx) / 2);
      const boxDy = Math.max(0, Math.abs(pi.topPx + pi.heightPx / 2 - (pj.topPx + pj.heightPx / 2)) - (pi.heightPx + pj.heightPx) / 2);
      if (boxDx > NEAR_BOX_MARGIN || boxDy > NEAR_BOX_MARGIN) continue;
      const d = minPointCloudDistance(outlines[i], outlines[j]);
      minDistances.push(d);
      if (d < -1e-6) overlapCount++;
    }
  }
  return { minDistances, overlapCount };
}
