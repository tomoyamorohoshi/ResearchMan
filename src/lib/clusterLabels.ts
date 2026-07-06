// クラスタ名（グルーピングキー）の空間浮遊表示。ノードを束ねるキーの重心に大きく薄いラベルを
// 浮かせる。client専用（three静的import）。Graph3DViewからのみimportされる想定。
// ドメイン非依存（GraphDomainAdapterのgroupKeys/groupLabel/minClusterSizeを注入して使う）。
//
// 重要: このモジュールはgraph.scene()に直接オブジェクトを追加する＝3d-force-graphの
// ライブラリ管理外（自動disposeの対象外）。そのため graphSprites.ts とは逆に、
// このモジュール自身がテクスチャ/マテリアル/スプライトの生成・キャッシュ・破棄を担う。
// グルーピングキー集合は不変（フィルタで変わるのは所属数と重心のみ）なので、スプライトは
// キーごとに初回生成のみ・以降は位置とvisibleの更新だけに留める（使い回してよい）。
import * as THREE from "three";
import type { GraphNode } from "./graph";
import type { GraphDomainAdapter } from "./graphDomain";

const LABEL_COLOR = "#9c7a1f";
const LABEL_OPACITY = 0.3;
const LABEL_FONT_WEIGHT = 900;
const LABEL_FONT_LOGICAL_PX = 40;
const LABEL_CANVAS_SCALE = 2;
const LABEL_PAD_LOGICAL = 20;
const LABEL_Y_LIFT = 6; // 重心よりわずかに上へ
// クラスタの世界幅: 所属数が多いほど大きく
const clusterWorldWidth = (count: number): number => 28 + Math.sqrt(count) * 3;

type ClusterEntry = { sprite: THREE.Sprite; aspect: number; center: { x: number; y: number; z: number }; count: number };

// スペースキー接近機能向け: 現在表示中（count>=minClusterSize）のクラスタ一覧
// aspect: ラベルテクスチャの幅/高さ比（テキスト長で変わる）。整列モードの見出しサイズ
// 統一（高さ固定・幅=高さ×aspect）で使う
export type ClusterInfo = { tag: string; center: { x: number; y: number; z: number }; count: number; worldWidth: number; aspect: number };

export type ClusterLabelHandle<T> = {
  update(nodes: GraphNode<T>[]): void;
  dispose(): void;
  getClusters(): ClusterInfo[];
  // 整列モード(C)向け: 指定タグのスプライトを直接position/scaleへ反映する
  // （updateのsums再計算を経由しない）。entry.centerも同期させるため、直後に
  // getClusters()を呼べば常に「今どこに見えているか」を返す。整列解除後は
  // update(nodes)を呼べば重心配置に戻り、以後は自然にそちらへ追従する
  setTransform(tag: string, center: { x: number; y: number; z: number }, worldWidth: number): void;
};

export type ClusterLabelsOptions<T> = Pick<GraphDomainAdapter<T>, "groupKeys" | "groupLabel" | "minClusterSize">;

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
 * ノード集合からグルーピングキーごとの重心を再計算し、所属数がminClusterSize以上の
 * キーだけ表示する。空配列で呼べば全ラベルが非表示になる（再収束中に前回位置の古い
 * ラベルを隠す用途）。
 */
export function createClusterLabels<T>(scene: THREE.Scene, opts: ClusterLabelsOptions<T>): ClusterLabelHandle<T> {
  const { groupKeys, groupLabel, minClusterSize } = opts;
  const entries = new Map<string, ClusterEntry>();

  function getOrCreate(tag: string): ClusterEntry {
    const existing = entries.get(tag);
    if (existing) return existing;
    const { texture, aspect } = createLabelTexture(groupLabel(tag));
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity: LABEL_OPACITY,
    });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    scene.add(sprite);
    const entry: ClusterEntry = { sprite, aspect, center: { x: 0, y: 0, z: 0 }, count: 0 };
    entries.set(tag, entry);
    return entry;
  }

  function update(nodes: GraphNode<T>[]) {
    const sums = new Map<string, { x: number; y: number; z: number; count: number }>();
    for (const node of nodes) {
      if (node.x === undefined || node.y === undefined || node.z === undefined) continue;
      for (const tag of groupKeys(node.item)) {
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
      if (!s || s.count < minClusterSize) entry.sprite.visible = false;
    }

    for (const [tag, s] of sums) {
      if (s.count < minClusterSize) continue;
      const entry = getOrCreate(tag);
      const center = { x: s.x / s.count, y: s.y / s.count + LABEL_Y_LIFT, z: s.z / s.count };
      entry.sprite.position.set(center.x, center.y, center.z);
      entry.center = center;
      entry.count = s.count;
      const worldW = clusterWorldWidth(s.count);
      entry.sprite.scale.set(worldW, worldW / entry.aspect, 1);
      entry.sprite.visible = true;
    }
  }

  function getClusters(): ClusterInfo[] {
    const result: ClusterInfo[] = [];
    for (const [tag, entry] of entries) {
      if (!entry.sprite.visible) continue;
      result.push({
        tag,
        center: { ...entry.center },
        count: entry.count,
        worldWidth: clusterWorldWidth(entry.count),
        aspect: entry.aspect,
      });
    }
    return result;
  }

  function setTransform(tag: string, center: { x: number; y: number; z: number }, worldWidth: number) {
    const entry = entries.get(tag);
    if (!entry) return;
    entry.sprite.position.set(center.x, center.y, center.z);
    entry.sprite.scale.set(worldWidth, worldWidth / entry.aspect, 1);
    entry.center = center; // getClusters()が常に現在の見た目を返すよう同期させる
  }

  function dispose() {
    for (const entry of entries.values()) {
      scene.remove(entry.sprite);
      entry.sprite.material.map?.dispose();
      entry.sprite.material.dispose();
    }
    entries.clear();
  }

  return { update, dispose, getClusters, setTransform };
}
