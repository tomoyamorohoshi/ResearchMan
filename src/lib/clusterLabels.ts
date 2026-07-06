// クラスタ名（タグ名）の空間浮遊表示。ノードを束ねるタグの重心に大きく薄いラベルを浮かせる。
// client専用（three静的import）。Graph3DViewからのみimportされる想定。
//
// 重要: このモジュールはgraph.scene()に直接オブジェクトを追加する＝3d-force-graphの
// ライブラリ管理外（自動disposeの対象外）。そのため graphSprites.ts とは逆に、
// このモジュール自身がテクスチャ/マテリアル/スプライトの生成・キャッシュ・破棄を担う。
// タグ集合は不変（フィルタで変わるのは所属数と重心のみ）なので、スプライトは
// タグごとに初回生成のみ・以降は位置とvisibleの更新だけに留める（使い回してよい）。
import * as THREE from "three";
import type { Case } from "./cases";
import type { GraphNode } from "./graph";
import { tagLabel } from "./tags";

// グルーピングキー: このケースをどのクラスタに束ねるか。1箇所に集約し、
// categoriesベースへの差し替えが1行で済むようにする（Fable設計判断・plan参照）
function groupingKeys(c: Case): string[] {
  return c.tags ?? [];
}

const MIN_CLUSTER_SIZE = 5;
const LABEL_COLOR = "#9c7a1f";
const LABEL_OPACITY = 0.3;
const LABEL_FONT_WEIGHT = 900;
const LABEL_FONT_LOGICAL_PX = 40;
const LABEL_CANVAS_SCALE = 2;
const LABEL_PAD_LOGICAL = 20;
const LABEL_Y_LIFT = 6; // 重心よりわずかに上へ
// クラスタの世界幅: 所属数が多いほど大きく
const clusterWorldWidth = (count: number): number => 28 + Math.sqrt(count) * 3;

type ClusterEntry = { sprite: THREE.Sprite; aspect: number };

export type ClusterLabelHandle = {
  update(nodes: GraphNode[]): void;
  dispose(): void;
};

function createLabelTexture(text: string): { texture: THREE.CanvasTexture; aspect: number } {
  const physFont = LABEL_FONT_LOGICAL_PX * LABEL_CANVAS_SCALE;
  const font = `${LABEL_FONT_WEIGHT} ${physFont}px 'Helvetica Neue', Helvetica, Arial`;

  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d")!;
  mctx.font = font;
  const textPhysW = mctx.measureText(text).width;
  const padPhys = LABEL_PAD_LOGICAL * LABEL_CANVAS_SCALE;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(textPhysW) + padPhys * 2;
  canvas.height = physFont * 1.6;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.fillStyle = LABEL_COLOR;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, padPhys, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return { texture, aspect: canvas.width / canvas.height };
}

/**
 * クラスタ名ラベルのハンドルを生成する。update(nodes)は現在レイアウトが確定している
 * ノード集合からタグごとの重心を再計算し、所属数がMIN_CLUSTER_SIZE以上のタグだけ表示する。
 * 空配列で呼べば全ラベルが非表示になる（再収束中に前回位置の古いラベルを隠す用途）。
 */
export function createClusterLabels(scene: THREE.Scene): ClusterLabelHandle {
  const entries = new Map<string, ClusterEntry>();

  function getOrCreate(tag: string): ClusterEntry {
    const existing = entries.get(tag);
    if (existing) return existing;
    const { texture, aspect } = createLabelTexture(tagLabel(tag).toUpperCase());
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity: LABEL_OPACITY,
    });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    scene.add(sprite);
    const entry: ClusterEntry = { sprite, aspect };
    entries.set(tag, entry);
    return entry;
  }

  function update(nodes: GraphNode[]) {
    const sums = new Map<string, { x: number; y: number; z: number; count: number }>();
    for (const node of nodes) {
      if (node.x === undefined || node.y === undefined || node.z === undefined) continue;
      for (const tag of groupingKeys(node.c)) {
        const s = sums.get(tag) ?? { x: 0, y: 0, z: 0, count: 0 };
        s.x += node.x;
        s.y += node.y;
        s.z += node.z;
        s.count += 1;
        sums.set(tag, s);
      }
    }

    // 既存ラベルのうち今回対象外（所属タグ消滅・閾値未満）になったものは非表示に戻す
    for (const [tag, entry] of entries) {
      const s = sums.get(tag);
      if (!s || s.count < MIN_CLUSTER_SIZE) entry.sprite.visible = false;
    }

    for (const [tag, s] of sums) {
      if (s.count < MIN_CLUSTER_SIZE) continue;
      const entry = getOrCreate(tag);
      entry.sprite.position.set(s.x / s.count, s.y / s.count + LABEL_Y_LIFT, s.z / s.count);
      const worldW = clusterWorldWidth(s.count);
      entry.sprite.scale.set(worldW, worldW / entry.aspect, 1);
      entry.sprite.visible = true;
    }
  }

  function dispose() {
    for (const entry of entries.values()) {
      scene.remove(entry.sprite);
      entry.sprite.material.map?.dispose();
      entry.sprite.material.dispose();
    }
    entries.clear();
  }

  return { update, dispose };
}
