// Case Study(cases.json)向けの3Dノードグラフ・ドメインアダプタ（GraphDomainAdapter<Case>実装）。
// 数値・語彙の意味は既存挙動を1件も変えない（P1は「挙動完全不変のリファクタ」）。
import type { Case } from "./cases";
import type { GraphDomainAdapter } from "./graphDomain";
import { tagLabel } from "./tags";

// 軸別重み: 技術の共有を最重視（発想の逆引きという用途に合わせる）。
// 旧 src/lib/graph.ts の AXIS_WEIGHTS/tagWeight をそのまま移設（値は不変）
const AXIS_WEIGHTS: Record<string, number> = { Tech: 1.5, Form: 1.0, Theme: 1.0 };
function tagWeight(tag: string): number {
  const axis = tag.split("/")[0];
  return AXIS_WEIGHTS[axis] ?? 1.0;
}

export const caseGraphAdapter: GraphDomainAdapter<Case> = {
  id: (c) => c.id,
  title: (c) => c.title,
  groupKeys: (c) => c.tags ?? [],
  groupLabel: (key) => tagLabel(key).toUpperCase(),
  keyWeight: tagWeight,
  minClusterSize: 5,
  thumbSources: (c) => [`/thumbnails-graph/${c.id}.jpg`, c.thumbnail],
  cardIdAttr: "data-case-id",
  detailHrefPrefix: "/cases/",
};
