// 3Dノードグラフのデータ構築（純関数のみ・ランタイムimportゼロ）。ドメイン非依存の汎用実装。
// Node直実行でスモークテスト可能に保つこと（計画書 Phase 2 参照）。
// ドメイン固有の意味（Case: id/tags, Tech: id/domains 等）は呼び出し側がgetId/getKeys/keyWeightで
// 注入する（src/lib/graphDomain.ts の GraphDomainAdapter 参照）。このファイル自体はどのドメイン型も
// importしない（Case/Tech双方のスモークテストが同一モジュールに対して成立することの前提）。
export type GraphNode<T> = { id: string; item: T; x?: number; y?: number; z?: number };
export type GraphLink = { source: string; target: string; sim: number };
export type GraphData<T> = { nodes: GraphNode<T>[]; links: GraphLink[] };

export const DEFAULT_TOP_K = 4; // 1ノードあたりのリンク候補上限
export const DEFAULT_MIN_SIM = 0.2; // これ未満はリンクしない

// 重み付きJaccard係数: Σw(共通キー) / Σw(和集合キー)。どちらか空なら0、完全一致なら1
export function keySimilarity(a: string[], b: string[], weight: (key: string) => number): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const seen = new Set<string>();
  let intersectionWeight = 0;
  let unionWeight = 0;
  for (const k of a) {
    if (seen.has(k)) continue;
    seen.add(k);
    const w = weight(k);
    unionWeight += w;
    if (setB.has(k)) intersectionWeight += w;
  }
  for (const k of b) {
    if (seen.has(k)) continue;
    seen.add(k);
    unionWeight += weight(k);
  }
  return unionWeight === 0 ? 0 : intersectionWeight / unionWeight;
}

export type BuildGraphDataOptions<T> = {
  getId: (item: T) => string;
  getKeys: (item: T) => string[];
  // 類似度計算のキー別重み。省略時は全キー等重み(1.0)
  keyWeight?: (key: string) => number;
  topK?: number;
  minSim?: number;
};

/**
 * フィルタ済みアイテム集合からグラフデータを構築する（ドメイン非依存）。
 * 全ペア(i<j)で類似度を計算し、各ノードでsim>=minSimの相手をsim降順にtopK件だけ採用、
 * [min(id),max(id)]キーでdedupeしてリンク化する。キー0〜1件のアイテムも全てノード化する
 * （孤立ノードを許容）。戻り値は毎回新規オブジェクト
 * （3d-force-graphがx,y,z等を破壊的に書き込むため呼び出しごとに再生成する必要がある）。
 */
export function buildGraphData<T>(items: T[], opts: BuildGraphDataOptions<T>): GraphData<T> {
  const { getId, getKeys, keyWeight = () => 1.0, topK = DEFAULT_TOP_K, minSim = DEFAULT_MIN_SIM } = opts;
  const n = items.length;
  const ids = items.map(getId);
  const keysByIndex = items.map(getKeys);

  const nodes: GraphNode<T>[] = items.map((item, i) => ({ id: ids[i], item }));
  const candidatesByIndex: Array<Array<{ j: number; sim: number }>> = items.map(() => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = keySimilarity(keysByIndex[i], keysByIndex[j], keyWeight);
      if (sim < minSim) continue;
      candidatesByIndex[i].push({ j, sim });
      candidatesByIndex[j].push({ j: i, sim });
    }
  }

  const linkMap = new Map<string, GraphLink>();
  for (let i = 0; i < n; i++) {
    const top = candidatesByIndex[i].sort((a, b) => b.sim - a.sim).slice(0, topK);
    for (const { j, sim } of top) {
      const idA = ids[i];
      const idB = ids[j];
      const source = idA < idB ? idA : idB;
      const target = idA < idB ? idB : idA;
      const key = `${source}::${target}`;
      if (!linkMap.has(key)) {
        linkMap.set(key, { source, target, sim });
      }
    }
  }

  return { nodes, links: Array.from(linkMap.values()) };
}

// リンク距離: 類似度が高いほど近い。スプライト幅(16world単位)より常に大きい
export function linkDistance(l: { sim: number }): number {
  return 40 + 140 * (1 - l.sim);
}

// リンク強度: 類似度が高いほど強く引き合う
export function linkStrength(l: { sim: number }): number {
  return 0.2 + 0.8 * l.sim;
}

// id文字列 → 32bit非負整数（FNV-1a）。決定論的（同じidなら常に同じ値）で
// 揺れの位相・周波数をノードごとにばらつかせるために使う（見た目の乱数風だが再現可能）
export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type SwayParams = { phase: number; freq: number; ampSeed: number };

// idから決定論的に位相・周波数係数・振幅シードを導出
export function swayParamsForId(id: string): SwayParams {
  const h = hashId(id);
  const phase = ((h % 1000) / 1000) * Math.PI * 2;
  const freq = 0.7 + (((h >>> 10) % 600) / 1000); // 0.7〜1.3倍
  const ampSeed = ((h >>> 20) % 1000) / 1000; // 0〜1
  return { phase, freq, ampSeed };
}

/**
 * レイアウト確定位置からの揺れオフセット（world単位）。tは秒（performance.now()/1000等）。
 * 振幅1.5〜2.5（カード幅16に対し控えめ）、周期5〜9秒相当。軸ごとに位相・周波数をずらし
 * 単純な円運動にならないようにする。純粋関数（同じid・tなら常に同じ値）
 */
export function swayOffset(id: string, t: number): { dx: number; dy: number; dz: number } {
  const { phase, freq, ampSeed } = swayParamsForId(id);
  const amp = 1.5 + ampSeed * 1.0;
  const dx = amp * Math.sin(t * freq + phase);
  const dy = amp * Math.sin(t * freq * 0.8 + phase * 1.3 + 1.0);
  const dz = amp * Math.sin(t * freq * 1.1 + phase * 0.7 + 2.0);
  return { dx, dy, dz };
}
