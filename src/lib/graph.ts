// 3Dノードグラフのデータ構築（純関数のみ・ランタイムimportゼロ）。
// Node直実行でスモークテスト可能に保つこと（計画書 Phase 2 参照）。
import type { Case } from "./cases";

export type GraphNode = { id: string; c: Case; x?: number; y?: number; z?: number };
export type GraphLink = { source: string; target: string; sim: number };
export type GraphData = { nodes: GraphNode[]; links: GraphLink[] };

// 軸別重み: 技術の共有を最重視（発想の逆引きという用途に合わせる）
export const AXIS_WEIGHTS: Record<string, number> = { Tech: 1.5, Form: 1.0, Theme: 1.0 };

export const DEFAULT_TOP_K = 4; // 1ノードあたりのリンク候補上限
export const DEFAULT_MIN_SIM = 0.2; // これ未満はリンクしない

// tags.ts の tagAxis と同じロジックだが、ここではimportせずローカル実装する
// （このファイルはNode直実行でのスモークテストのためランタイムimportをゼロに保つ）
function tagWeight(tag: string): number {
  const axis = tag.split("/")[0];
  return AXIS_WEIGHTS[axis] ?? 1.0;
}

// 重み付きJaccard係数: Σw(共通タグ) / Σw(和集合タグ)。どちらか空なら0、完全一致なら1
export function tagSimilarity(a?: string[], b?: string[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const seen = new Set<string>();
  let intersectionWeight = 0;
  let unionWeight = 0;
  for (const t of a) {
    if (seen.has(t)) continue;
    seen.add(t);
    const w = tagWeight(t);
    unionWeight += w;
    if (setB.has(t)) intersectionWeight += w;
  }
  for (const t of b) {
    if (seen.has(t)) continue;
    seen.add(t);
    unionWeight += tagWeight(t);
  }
  return unionWeight === 0 ? 0 : intersectionWeight / unionWeight;
}

/**
 * フィルタ済み事例集合からグラフデータを構築。
 * 全ペア(i<j)で類似度を計算し、各ノードでsim>=minSimの相手をsim降順にtopK件だけ採用、
 * [min(id),max(id)]キーでdedupeしてリンク化する。タグ0〜1件の事例も全てノード化する
 * （孤立ノードを許容）。戻り値は毎回新規オブジェクト
 * （3d-force-graphがx,y,z等を破壊的に書き込むため呼び出しごとに再生成する必要がある）。
 */
export function buildGraphData(
  cases: Case[],
  opts?: { topK?: number; minSim?: number },
): GraphData {
  const topK = opts?.topK ?? DEFAULT_TOP_K;
  const minSim = opts?.minSim ?? DEFAULT_MIN_SIM;
  const n = cases.length;

  const nodes: GraphNode[] = cases.map((c) => ({ id: c.id, c }));
  const candidatesByIndex: Array<Array<{ j: number; sim: number }>> = cases.map(() => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = tagSimilarity(cases[i].tags, cases[j].tags);
      if (sim < minSim) continue;
      candidatesByIndex[i].push({ j, sim });
      candidatesByIndex[j].push({ j: i, sim });
    }
  }

  const linkMap = new Map<string, GraphLink>();
  for (let i = 0; i < n; i++) {
    const top = candidatesByIndex[i].sort((a, b) => b.sim - a.sim).slice(0, topK);
    for (const { j, sim } of top) {
      const idA = cases[i].id;
      const idB = cases[j].id;
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
