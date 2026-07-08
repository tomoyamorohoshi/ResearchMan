// /ideas ポスターの「パズルカーニング」配置（DESIGN: goofy-hatching-mango.md 2026-07-07バッチ・
// 固定2サイズタイポグラフィ＋内容適応カードサイズ＋密着パッキング改訂計画）。
// CSS Gridの行詰め(旧IdeasPoster.tsxのcomputeColStarts)を、サーバー計算の絶対配置コラージュに
// 置換する。輪郭サンプル点(ideaShapes.tsのoutlineToLayoutSpace)同士の最短距離を実測しながら、
// 隣接シルエットの隙間が目標値(0.5〜3px、hashで揺らぎ)になるまで詰める「パズルカーニング」を行う。
//
// 3ティア構成（実装詳細補足B.1）: mobile(<640px, 基準幅358) / compact(640-1024px, 基準幅576) /
// wide(1024px〜, 基準幅960)。mobileは1カラム縦積み+垂直カーニングのみ、compact/wideは行詰め+
// 水平・垂直カーニングの両方を行う。各ティアはサーバーで1回だけ計算する。
//
// H: 固定2サイズタイポグラフィ(goofy-hatching-mango.md 2026-07-07バッチ・改訂計画)。旧方式は
// 「カード幅は行パッキングが決め、フォントを縮めて収める(下限のみ保証)」だったが、新方式は
// 「フォントは全カード共通の固定2サイズ(タイトル=サイズA・日付/本文/リンク=サイズB)。カード
// (シェイプ)のスケールを内容量から解き、固定サイズで全文が収まる大きさにする」。カードの
// 物理サイズはideaShapes.tsのsolveFixedSizeShapeが解いた値(scale)で一意に決まるため、旧来の
// colSpan(12分率)・S/M/Lサイズ段階・物理フォント下限保証(ensurePhysicalFontFloor)の仕組みは
// 全廃した。この結果、IdeasPoster.tsxのコンテナは「無限%拡大」をやめ、ティア基準幅を
// max-widthとして固定サイズを維持する（詳細はIdeasPoster.tsx参照）。
//
// 純関数・決定論（Math.random不使用。hashId(id)由来のジッタのみ）。
import { hashId } from "./graph";
import {
  isComplexShapeKind,
  KIND_WEIGHT,
  outlineToLayoutSpace,
  SHAPE_KINDS,
  solveFixedSizeShape,
  type ContentRef,
  type IdeaShape,
  type Point,
  type ShapeKind,
} from "./ideaShapes";

export type CollageTier = "mobile" | "compact" | "wide";

// 実装詳細補足B.1: 各ティアの基準幅(px)。CSSのレスポンシブdisplayクラスで切替える。
// B.2: mobileはIdeasPoster.tsxのコンテナが`px-4`(16px×2=32px)を差し引く必要がある
// (compact/wideは`sm:px-8`=32px×2=64pxを既に差し引き済み=576=640-64・960=1024-64だったが、
// mobileの390はこの差し引きが漏れていた設計不整合。390-2×16=358に修正済み)。
// H: 固定2サイズ改訂計画で、この基準幅はもはや「フルイド%拡大の基準」ではなく「コンテナの
// max-width」として使う(IdeasPoster.tsx参照。無限%拡大をやめ、この幅を超えて伸びなくする)
export const TIER_REF_WIDTH_PX: Record<CollageTier, number> = {
  mobile: 358,
  compact: 576,
  wide: 960,
};

// H: 固定2サイズタイポグラフィ(goofy-hatching-mango.md 2026-07-07バッチ・改訂計画)。
// サイズA=タイトル(輪郭沿いtextPath)・サイズB=日付/本文/リンク行。全カード同一(絶対条件)。
// 目安値は計画書のとおり: wide/compact=13px/8.5px・mobile=12px/8px（全景スクショで微調整可）
export const FIXED_TITLE_FONT_PX: Record<CollageTier, number> = {
  mobile: 12,
  compact: 13,
  wide: 13,
};
export const FIXED_BODY_FONT_PX: Record<CollageTier, number> = {
  mobile: 8,
  compact: 8.5,
  wide: 8.5,
};

export type CollageCardInput = {
  id: string; // idea.id（hashIdジッタ・トレースに使う）
  shape: IdeaShape; // solveFixedSizeShape(...).shape の結果
  scale: number; // solveFixedSizeShape(...).scale（viewbox単位→物理pxの変換係数）
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
  containerHeightPx: number; // コンテナの高さ(レイアウト座標単位)
  containerWidthPx: number; // コンテナの幅(レイアウト座標単位。パッキングで実際に使われた最大行幅)
  // B.4: カーニングで実際に達成された隣接ペアの最短距離(検証・スモークテスト用)。
  // horizontalGaps=同一行内の隣接カード間、verticalGaps=前の行との間(先頭行を除く)
  horizontalGaps: readonly number[];
  verticalGaps: readonly number[];
};

// ── H: コンテンツ量に応じたシェイプ割り当て（解く向きの反転） ──────────────────────
// goofy-hatching-mango.md 2026-07-07バッチ・改訂計画。固定2サイズモデルでは「物理フォント
// 下限を満たせるか」という基準が意味を成さない(solveFixedSizeShapeはどんな内容量でも理論上
// 必ず解ける。カードを十分大きくすれば良いだけなので)。代わりに「hashデフォルトのシェイプ種
// で、カードがティア行幅(TIER_REF_WIDTH_PX)を超えずに済むか」を基準にする。超えてしまう
// 場合のみ、safeArea比率の大きい種(複雑形の浅い変種を含む)へ優先的に選び直すことで、
// 極端に巨大なカードを避ける(前バッチのassignShapeKindsと同じ優先順位構造を踏襲)
export type IdeaContentInput = {
  id: string;
  title: string;
  dateLabel: string;
  seed: string;
  refs: readonly ContentRef[];
};

export type ShapeAssignment = { kind: ShapeKind; generous: boolean };

const ASSIGN_TIERS: readonly CollageTier[] = ["mobile", "compact", "wide"];
const ASSIGN_FEASIBILITY_EPS = 1e-6;

type TierWidthProbe = { tier: CollageTier; widthPx: number; budgetPx: number };

// 指定(kind,generous)でsolveFixedSizeShapeを3ティア分呼び、各ティアで必要なカード物理幅
// (cropViewBox.w×scale)とそのティアの行幅予算(TIER_REF_WIDTH_PX)、実際に使われたシェイプ種
// (forceKind省略時はhashベースのデフォルト選定結果。3ティアともhと(kind選定式)は同一入力
// なので必ず同じkindになる)を返す
function probeTierWidths(
  idea: IdeaContentInput,
  opts?: { forceKind?: ShapeKind; generous?: boolean },
): { probes: TierWidthProbe[]; kind: ShapeKind } {
  const content = { seed: idea.seed, refs: idea.refs };
  let resolvedKind: ShapeKind = SHAPE_KINDS[0];
  const probes = ASSIGN_TIERS.map((tier) => {
    const { shape, scale } = solveFixedSizeShape(
      idea.id,
      idea.title,
      idea.dateLabel,
      content,
      FIXED_TITLE_FONT_PX[tier],
      FIXED_BODY_FONT_PX[tier],
      opts,
    );
    resolvedKind = shape.kind;
    return { tier, widthPx: shape.cropViewBox.w * scale, budgetPx: TIER_REF_WIDTH_PX[tier] };
  });
  return { probes, kind: resolvedKind };
}

function isFeasibleWidths(probes: readonly TierWidthProbe[]): boolean {
  return probes.every((p) => p.widthPx <= p.budgetPx + ASSIGN_FEASIBILITY_EPS);
}

// マージン比: 予算に対してどれだけ余裕があるか(budget/width)。1.0が境界、値が大きいほど
// 余裕がある。全探索でも収まらない場合のフォールバック選定に使う(最も余裕がある組み合わせを選ぶ)
function marginRatioWidths(probes: readonly TierWidthProbe[]): number {
  return Math.min(...probes.map((p) => p.budgetPx / p.widthPx));
}

// 再割り当て候補プール専用の重み(adversarial-reviewer指摘の反映。goofy-hatching-mango.md
// 2026-07-07バッチ追補で導入。改訂計画でも同じ考え方を維持する)。KIND_WEIGHT(複雑形3・
// 単純形1)をそのまま流用すると、feasibleな複雑形候補の件数が単純形より少ないカードでは
// 重み3倍を掛けてもなお単純形に競り負けやすく、複雑形比率が過半ぎりぎりまで下がることが
// 実測で判明した。KIND_WEIGHT自体(全体のデフォルト分布)は変えず、assignShapeKindsの
// 候補選抜だけに使う専用の重みとして複雑形をさらに優先する
const REASSIGN_COMPLEX_KIND_WEIGHT = 4;
function reassignWeightFor(kind: ShapeKind): number {
  return isComplexShapeKind(kind) ? REASSIGN_COMPLEX_KIND_WEIGHT : KIND_WEIGHT[kind];
}

export function assignShapeKinds(ideas: readonly IdeaContentInput[]): Map<string, ShapeAssignment> {
  const result = new Map<string, ShapeAssignment>();
  for (const idea of ideas) {
    const defaultResult = probeTierWidths(idea);
    if (isFeasibleWidths(defaultResult.probes)) {
      result.set(idea.id, { kind: defaultResult.kind, generous: false });
      continue;
    }

    type Evaluated = { kind: ShapeKind; generous: boolean; feasible: boolean; margin: number };
    const evaluated: Evaluated[] = [];
    for (const kind of SHAPE_KINDS) {
      const { probes } = probeTierWidths(idea, { forceKind: kind });
      evaluated.push({ kind, generous: false, feasible: isFeasibleWidths(probes), margin: marginRatioWidths(probes) });
      if (isComplexShapeKind(kind)) {
        const { probes: gProbes } = probeTierWidths(idea, { forceKind: kind, generous: true });
        evaluated.push({ kind, generous: true, feasible: isFeasibleWidths(gProbes), margin: marginRatioWidths(gProbes) });
      }
    }

    const feasibleCandidates = evaluated.filter((e) => e.feasible);
    if (feasibleCandidates.length > 0) {
      const weighted = feasibleCandidates.flatMap((c) => Array<Evaluated>(reassignWeightFor(c.kind)).fill(c));
      const picked = weighted[hashId(idea.id) % weighted.length];
      result.set(idea.id, { kind: picked.kind, generous: picked.generous });
      continue;
    }

    let best = evaluated[0];
    for (const e of evaluated) if (e.margin > best.margin) best = e;
    console.warn(
      `assignShapeKinds: ${idea.id} は全9種×浅い変種でも3ティアいずれかの行幅予算に収まらない。` +
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
// 別の凹部で先に食い込みが起きているケースがある)。一方の輪郭サンプル点がもう一方の
// 塗りつぶし多角形の内部に入っていないかを直接判定し、入っていれば非重なり探索が
// 「targetよりさらに遠ざける必要がある」と判断できるよう負のセンチネル値を返す
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
      let lo = nextV;
      let hi = prevDist > target ? v : prevV;
      for (let b = 0; b < KERNING_BINARY_ITERS; b++) {
        const mid = (lo + hi) / 2;
        const midDist = distAt(mid);
        if (midDist > target) hi = mid;
        else lo = mid;
      }
      let finalV = lo;
      if (distAt(finalV) < 0) finalV = hi;
      for (let r = 0; r < OVERLAP_RECOVERY_MAX_ITER && distAt(finalV) < 0; r++) {
        finalV += OVERLAP_RECOVERY_STEP;
      }
      return finalV;
    }
    prevV = v;
    prevDist = nextDist;
    v = nextV;
  }
  return v;
}

// ── カード配置本体 ────────────────────────────────────────────────────────
// H: 固定2サイズ改訂計画で、ボックスサイズ(boxWidthPx/boxHeightPx)はsolveFixedSizeShapeが
// 解いたscaleから直接決まる(scale×cropViewBox.w/h)。旧colSpan・S/M/Lサイズ段階・
// clampBoxAspect(letterboxing対応)は全廃した: ボックス=シェイプの実寸そのものになるため、
// letterboxingが発生する余地が無くなり、contentWidthPx/HeightPxはboxWidthPx/HeightPxと
// 常に一致する(fitContentSizeが不要になった)
type PreparedCard = {
  input: CollageCardInput;
  boxWidthPx: number;
  boxHeightPx: number;
  rotateDeg: number;
  gapH: number; // 直前カードとの水平目標ギャップ(C: 0.5〜3px)
  gapV: number; // 直前行との垂直目標ギャップ(C: 0.5〜3px。行の代表として先頭カードの値を使う)
};

// C: パズル密着（goofy-hatching-mango.md 2026-07-07バッチ・改訂計画）。目標ギャップ帯を
// 旧2〜8pxから0.5〜3pxへ狭め、シルエット間距離を「接するか接しないか」の見た目にする
const KERNING_GAP_MIN_PX = 0.5;
const KERNING_GAP_MAX_PX = 3;
const KERNING_GAP_RANGE_PX = KERNING_GAP_MAX_PX - KERNING_GAP_MIN_PX;

function prepareCard(input: CollageCardInput): PreparedCard {
  const boxWidthPx = input.shape.cropViewBox.w * input.scale;
  const boxHeightPx = input.shape.cropViewBox.h * input.scale;
  const h = hashId(input.id);
  // 実装詳細補足B.3: 既存のhashId(id) >>> Nビットシフトの流儀通り
  const rotateDeg = (((h >>> 4) % 1000) / 1000 - 0.5) * 6; // -3..3deg（旧layoutForと同じ）
  const gapH = KERNING_GAP_MIN_PX + (((h >>> 9) % 1000) / 1000) * KERNING_GAP_RANGE_PX;
  const gapV = KERNING_GAP_MIN_PX + (((h >>> 18) % 1000) / 1000) * KERNING_GAP_RANGE_PX;
  return { input, boxWidthPx, boxHeightPx, rotateDeg, gapH, gapV };
}

type RowSlot = { card: PreparedCard; leftPx: number };

// B.3: 大小混在カードに対応する行パッキング。旧colSpan(12分率)の合計ではなく、実際の
// 物理幅(boxWidthPx)の合計がrowBudgetPxを超えない範囲で貪欲に詰める(先頭カードは
// 必ず行に入れる。1枚だけでもrowBudgetPxを超える大型カードは単独行になる)
function packRows(cards: readonly PreparedCard[], rowBudgetPx: number): RowSlot[][] {
  const rows: RowSlot[][] = [];
  let current: PreparedCard[] = [];
  let used = 0;
  for (const c of cards) {
    if (used + c.boxWidthPx > rowBudgetPx && current.length > 0) {
      rows.push(current.map((cc) => ({ card: cc, leftPx: 0 })));
      current = [];
      used = 0;
    }
    current.push(c);
    used += c.boxWidthPx;
  }
  if (current.length > 0) rows.push(current.map((cc) => ({ card: cc, leftPx: 0 })));
  return rows;
}

function outlineAt(card: PreparedCard, leftPx: number, topPx: number): Point[] {
  const centerX = leftPx + card.boxWidthPx / 2;
  const centerY = topPx + card.boxHeightPx / 2;
  return outlineToLayoutSpace(card.input.shape, {
    widthPx: card.boxWidthPx,
    heightPx: card.boxHeightPx,
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
    const farLeft = prevMaxX + slot.card.boxWidthPx * 1.2;
    const stepSize = Math.max(0.5, (slot.card.boxWidthPx * 3) / KERNING_COARSE_STEPS);
    const distAt = (leftPx: number) => clearance(prevOutline, outlineAt(slot.card, leftPx, rowTopY));
    slot.leftPx = solveKerningPosition(farLeft, stepSize, slot.card.gapH, distAt);
    achieved.push(distAt(slot.leftPx));
    prevOutline = outlineAt(slot.card, slot.leftPx, rowTopY);
  }
  return achieved;
}

// 直前行・当該行はいずれも複数カードを含みうる。それぞれのカードの輪郭点列を1つの多角形として
// 結合(concat)してしまうと、無関係な2カードの輪郭点が"辺"として繋がってしまいpointInPolygonが
// 誤判定する。カードごとの輪郭点列をグループとして保持し、2グループの全カードペアそれぞれに
// clearance()を適用した最小値を取ることで、この誤判定を避ける
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
  const prepared = cards.map((c) => prepareCard(c));
  const rows = packRows(prepared, tierRefWidthPx);

  const placementById = new Map<string, CardPlacement>();
  let prevRowOutlines: Point[][] | null = null;
  let nominalTopY = 0;
  let maxBottomY = 0;
  let maxRowWidth = 0;
  const horizontalGaps: number[] = [];
  const verticalGaps: number[] = [];

  for (const row of rows) {
    const rowWidthSum = row.reduce((s, slot) => s + slot.card.boxWidthPx, 0);
    const slackPx = Math.max(0, tierRefWidthPx - rowWidthSum);
    const rowSeedH = hashId(row[0].card.input.id);
    const startLeftPx = slackPx > 0 ? ((rowSeedH % 1000) / 1000) * slackPx : 0;

    // 水平カーニング: まずnominalTopYで仮配置(垂直カーニングは後段でΔy分だけ一様に動かすため、
    // 行内の相対位置には影響しない)
    const rowHGaps = kernRowHorizontally(row, nominalTopY, startLeftPx);
    horizontalGaps.push(...rowHGaps);

    // 垂直カーニング: 直前行との最短距離がgapVになるまで行全体をnominalTopYから調整
    const { topY: finalTopY, achievedGap } = kernRowVertically(row, prevRowOutlines, nominalTopY);
    if (achievedGap !== null) verticalGaps.push(achievedGap);

    let rowMaxRight = 0;
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
      rowMaxRight = Math.max(rowMaxRight, slot.leftPx + slot.card.boxWidthPx);
    }
    maxRowWidth = Math.max(maxRowWidth, rowMaxRight);

    prevRowOutlines = outlinesForRow(row, finalTopY);
    nominalTopY = maxBottomY;
  }

  const placements = cards.map((c) => placementById.get(c.id)!);
  return { placements, containerHeightPx: maxBottomY, containerWidthPx: maxRowWidth, horizontalGaps, verticalGaps };
}

// mobileティア: 1カラム縦積み。垂直カーニングのみ(各カードを「1カードだけの行」として扱う)。
// H: 固定2サイズ改訂計画で、旧「常にフル幅」の強制を廃止した(内容適応でカードごとに
// 自然な幅になる)。横位置はティア基準幅内で中央寄せする
function computeMobileTierLayout(cards: readonly CollageCardInput[]): CollageLayoutResult {
  const tierRefWidthPx = TIER_REF_WIDTH_PX.mobile;
  const placements: CardPlacement[] = [];
  let prevOutlines: Point[][] | null = null;
  let nominalTopY = 0;
  let maxBottomY = 0;
  let maxWidth = 0;
  const verticalGaps: number[] = [];

  for (const input of cards) {
    const card = prepareCard(input);
    const leftPx = Math.max(0, (tierRefWidthPx - card.boxWidthPx) / 2);
    const row: RowSlot[] = [{ card, leftPx }];

    const { topY: finalTopY, achievedGap } = kernRowVertically(row, prevOutlines, nominalTopY);
    if (achievedGap !== null) verticalGaps.push(achievedGap);
    placements.push({
      id: input.id,
      leftPx,
      topPx: finalTopY,
      widthPx: card.boxWidthPx,
      heightPx: card.boxHeightPx,
      rotateDeg: card.rotateDeg,
    });
    maxBottomY = finalTopY + card.boxHeightPx;
    maxWidth = Math.max(maxWidth, card.boxWidthPx);
    prevOutlines = [outlineAt(card, leftPx, finalTopY)];
    nominalTopY = maxBottomY;
  }

  return { placements, containerHeightPx: maxBottomY, containerWidthPx: maxWidth, horizontalGaps: [], verticalGaps };
}

// 決定論・純関数。同じcards配列(内容が同一)を渡せば常に同じ結果を返す
export function computeCollageLayout(cards: readonly CollageCardInput[], tier: CollageTier): CollageLayoutResult {
  if (cards.length === 0) return { placements: [], containerHeightPx: 0, containerWidthPx: 0, horizontalGaps: [], verticalGaps: [] };
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
      widthPx: p.widthPx,
      heightPx: p.heightPx,
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
