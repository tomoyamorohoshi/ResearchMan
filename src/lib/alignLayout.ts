// 整列モード（スペース5の倍数回目: カテゴリ列グリッド整列）の純粋なレイアウト計算。
// three.js/DOM非依存（Node直実行でスモークテスト可能に保つ。src/lib/graph.tsと同じ方針）。
// Graph3DView.tsxからのみ呼ばれる想定。力学シミュレーション(node.x/y/z)には一切触れず、
// 「グリッド上の目標座標」を計算するだけ。実際にスプライトをそこへトゥイーンするのは
// Graph3DView側の自前rAFの役割（計画C-1参照）。

export type ColumnAssignInput = { id: string; tags: string[]; x: number; y: number; z: number };
export type ClusterInput = { tag: string; center: { x: number; y: number; z: number }; count: number; worldWidth: number };

type Point3 = { x: number; y: number; z: number };

function dist3(a: Point3, b: Point3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * 各ノードを「所属列（タグ）」へ割り当てる。自分のtagsのうちクラスタ重心が現在位置に
 * 最も近いタグを選ぶ（移動距離が最小＝モーフが有機的）。所属タグが無い/どれもクラスタ
 * 未満の場合は、最も近いクラスタへフォールバックする。クラスタが1つも無ければ空を返す。
 */
export function assignColumns(nodes: ColumnAssignInput[], clusters: ClusterInput[]): Map<string, string> {
  const result = new Map<string, string>();
  if (clusters.length === 0) return result;
  const clusterByTag = new Map(clusters.map((c) => [c.tag, c]));

  for (const node of nodes) {
    let bestTag: string | null = null;
    let bestDist = Infinity;
    for (const tag of node.tags) {
      const cluster = clusterByTag.get(tag);
      if (!cluster) continue;
      const d = dist3(node, cluster.center);
      if (d < bestDist) {
        bestDist = d;
        bestTag = tag;
      }
    }
    if (bestTag === null) {
      // フォールバック: 所属タグがクラスタと一致しない場合、最も近いクラスタ全体から選ぶ
      for (const cluster of clusters) {
        const d = dist3(node, cluster.center);
        if (d < bestDist) {
          bestDist = d;
          bestTag = cluster.tag;
        }
      }
    }
    if (bestTag !== null) result.set(node.id, bestTag);
  }
  return result;
}

export type GridLayoutOptions = { cell: number; maxRows: number };
export type NodeGridPosition = { x: number; y: number; z: number };
export type HeaderGridPosition = { x: number; y: number; z: number; width: number };
export type GridBBox = { minX: number; maxX: number; minY: number; maxY: number; maxHeaderY: number };
export type GridLayoutResult = {
  positions: Map<string, NodeGridPosition>;
  headers: Map<string, HeaderGridPosition>;
  bbox: GridBBox;
  columnOrder: string[]; // クラスタ重心のX昇順（スタガー順の基準にもなる）
};

// ヘッダーの上端クリアランス（列の最上段からどれだけ上に離すか。目視で調整可）
const HEADER_GAP_FACTOR = 0.8;

/**
 * カテゴリ列グリッドのレイアウトを計算する。列はクラスタ重心のX昇順。
 * 1列の行数がmaxRowsを超えるカテゴリは隣接サブ列へ折返す。ワールドXY平面(z=0)に配置し、
 * 全体をワールド原点中心にセンタリングする（上端は全列で揃える＝列は上から詰める）。
 */
export function computeGridLayout(
  nodes: ColumnAssignInput[],
  assignment: Map<string, string>,
  clusters: ClusterInput[],
  opts: GridLayoutOptions,
): GridLayoutResult {
  const { cell, maxRows } = opts;
  const orderedClusters = [...clusters].sort((a, b) => a.center.x - b.center.x);
  const columnOrder = orderedClusters.map((c) => c.tag);

  // タグごとにノードidを積む（nodes[]の順序を保持。行の並び順に決定性を持たせるだけで
  // 視覚的な意味はない）
  const byTag = new Map<string, string[]>();
  for (const node of nodes) {
    const tag = assignment.get(node.id);
    if (!tag) continue;
    const list = byTag.get(tag);
    if (list) list.push(node.id);
    else byTag.set(tag, [node.id]);
  }

  // サブ列の列を作る（同一カテゴリのサブ列は隣接、カテゴリ間だけ1セル分の追加ギャップ）
  type SubColumn = { tag: string; ids: string[] };
  const subColumns: SubColumn[] = [];
  const tagSubColumnIndices = new Map<string, number[]>();
  for (const tag of columnOrder) {
    const ids = byTag.get(tag) ?? [];
    const numSub = Math.max(1, Math.ceil(ids.length / maxRows));
    const indices: number[] = [];
    for (let s = 0; s < numSub; s++) {
      indices.push(subColumns.length);
      subColumns.push({ tag, ids: ids.slice(s * maxRows, (s + 1) * maxRows) });
    }
    tagSubColumnIndices.set(tag, indices);
  }

  const rawX: number[] = [];
  let cursor = 0;
  let prevTag: string | null = null;
  for (const sub of subColumns) {
    if (prevTag !== null && sub.tag !== prevTag) cursor += cell; // カテゴリ間ギャップ
    rawX.push(cursor);
    cursor += cell;
    prevTag = sub.tag;
  }
  const totalWidth = subColumns.length > 0 ? rawX[rawX.length - 1] : 0;
  const xOffset = totalWidth / 2;

  const maxRowsUsed = subColumns.length > 0 ? Math.max(...subColumns.map((s) => s.ids.length), 1) : 0;
  const topY = ((maxRowsUsed - 1) * cell) / 2;

  const positions = new Map<string, NodeGridPosition>();
  subColumns.forEach((sub, k) => {
    const x = rawX[k] - xOffset;
    sub.ids.forEach((id, r) => {
      const y = topY - r * cell;
      positions.set(id, { x, y, z: 0 });
    });
  });

  const headers = new Map<string, HeaderGridPosition>();
  const headerGap = cell * HEADER_GAP_FACTOR;
  for (const cluster of orderedClusters) {
    const indices = tagSubColumnIndices.get(cluster.tag) ?? [];
    if (indices.length === 0) continue;
    const xs = indices.map((k) => rawX[k] - xOffset);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const centerX = (minX + maxX) / 2;
    const width = maxX - minX + cell; // ブロック幅（サブ列全体にまたがる）
    headers.set(cluster.tag, { x: centerX, y: topY + headerGap, z: 0, width });
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!isFinite(minX)) {
    minX = 0;
    maxX = 0;
    minY = 0;
    maxY = 0;
  }
  let maxHeaderY = maxY;
  for (const h of headers.values()) maxHeaderY = Math.max(maxHeaderY, h.y);

  return { positions, headers, bbox: { minX, maxX, minY, maxY, maxHeaderY }, columnOrder };
}

/** ease-in-out-cubic。0→1の進捗を滑らかに補間する（トゥイーンの標準イージング） */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * 全件が収まるカメラ距離を計算する。vFovDegは垂直画角(度)、aspectはwidth/height。
 * 縦横それぞれを収める距離のうち大きい方(=より引かないと収まらない方)を採用し、
 * marginを掛けて安全マージンを持たせる。
 */
export function computeCameraFitDistance(
  totalW: number,
  totalH: number,
  vFovDeg: number,
  aspect: number,
  margin: number,
): number {
  const vFov = (vFovDeg * Math.PI) / 180;
  const distV = totalH / 2 / Math.tan(vFov / 2);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const distH = totalW / 2 / Math.tan(hFov / 2);
  return Math.max(distV, distH) * margin;
}

/** 列順に0〜maxStaggerMsへ線形に広がるスタガー遅延。列が1つ以下なら常に0 */
export function computeStaggerDelay(columnIndex: number, columnCount: number, maxStaggerMs: number): number {
  if (columnCount <= 1) return 0;
  return (columnIndex / (columnCount - 1)) * maxStaggerMs;
}
