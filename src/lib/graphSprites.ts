// 3Dグラフ用ノードオブジェクト（サムネイル+浮遊タイトルラベルのGroup）。client専用（three静的import）。
// Graph3DView（"use client"・ssr:false経由）からのみimportされる想定。
import * as THREE from "three";
import type { Case } from "./cases";

// 画像カード寸法（canvas px）。テキスト帯は廃止し、画像のみの正方形にした
export const CARD_W = 256;
export const IMG_H = 256; // 正方形（グリッドの aspect-square と一致）
export const SPRITE_W = 16; // world単位。linkDistanceの最小値40より十分小さいこと
export const SPRITE_H = SPRITE_W; // 画像が正方形になったため縦横同値

// 読み込み済み画像のキャッシュ（id単位）。
//
// 注意: ここでキャッシュするのは画像データのみで、Sprite/Material/Texture自体は
// createNodeObject()の呼び出しごとに必ず新規生成する。3d-force-graphは
// nodeThreeObjectが返したObject3Dの所有権を握り、そのノードがデータから
// 一時的に外れる（フィルタで絞られる等）と内部でmaterial.map.dispose()を
// 含む解放処理を自動実行する（Group を返す場合も children を再帰して解放する）。
// 同じインスタンスをキャッシュして使い回すと、ノード再出現時に「既に解放済みの
// texture/material」を持つオブジェクトを再度シーンに追加することになり、
// 次の解放処理で二重disposeが発生して内部Mapの参照が壊れクラッシュする
// （実装中にPlaywrightで100%再現・特定）。画像データだけをキャッシュして
// ネットワーク再取得は避けつつ、Three.jsオブジェクトは常にフレッシュにすることで解決する。
const imageCache = new Map<string, HTMLImageElement | null>();

// 画像の同時ロード数を制限するシンプルなキュー
const MAX_CONCURRENT_LOADS = 12;
let activeLoads = 0;
const pending: Array<() => void> = [];

function runWithLimit<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve) => {
    const start = () => {
      activeLoads++;
      task()
        .then(resolve)
        .finally(() => {
          activeLoads--;
          const next = pending.shift();
          if (next) next();
        });
    };
    if (activeLoads < MAX_CONCURRENT_LOADS) start();
    else pending.push(start);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

async function loadThumbnail(c: Case): Promise<HTMLImageElement | null> {
  try {
    return await loadImage(`/thumbnails-graph/${c.id}.jpg`);
  } catch {
    try {
      // 縮小版未生成の新規事例向けフォールバック（フル解像度）
      return await loadImage(c.thumbnail);
    } catch {
      return null;
    }
  }
}

function drawCardBase(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, CARD_W, IMG_H);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CARD_W, IMG_H);
  ctx.strokeStyle = "#d4d0c8";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_W - 2, IMG_H - 2);
}

function drawPlaceholderImage(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#eeece7";
  ctx.fillRect(0, 0, CARD_W, IMG_H);
  ctx.fillStyle = "#c8c2b6";
  ctx.font = "900 32px 'Helvetica Neue', Helvetica, Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("RM", CARD_W / 2, IMG_H / 2);
}

function drawCoverImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement) {
  const scale = Math.max(CARD_W / img.width, IMG_H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = (CARD_W - w) / 2;
  const y = (IMG_H - h) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, CARD_W, IMG_H);
  ctx.clip();
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

/**
 * 画像スプライト生成。呼び出しごとに必ず新規のSprite/Material/Textureを作る
 * （理由は上部の imageCache コメント参照）。画像が未キャッシュならプレースホルダを
 * 同期描画した上で非同期ロードして再描画し、ロード済みなら即座に反映する。
 */
function createImageSprite(c: Case): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = IMG_H;
  const ctx = canvas.getContext("2d")!;

  drawCardBase(ctx);

  const cached = imageCache.get(c.id);
  if (cached) {
    drawCoverImage(ctx, cached);
  } else {
    drawPlaceholderImage(ctx);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const material = new THREE.SpriteMaterial({ map: texture });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(SPRITE_W, SPRITE_H, 1);

  if (cached === undefined) {
    runWithLimit(() => loadThumbnail(c)).then((img) => {
      imageCache.set(c.id, img);
      if (!img) return;
      drawCardBase(ctx);
      drawCoverImage(ctx, img);
      texture.needsUpdate = true;
    });
  }

  return sprite;
}

// ── タイトルラベル（画像の外側に浮かぶ独立スプライト） ──────────────

// 切詰め判定に使う論理キャンバス寸法（devicePixelRatio 2x相当で描画して文字を鮮明にする）
const LABEL_LOGICAL_MAX_W = 256;
const LABEL_LOGICAL_H = 48;
const LABEL_CANVAS_SCALE = 2;
const LABEL_FONT_LOGICAL_PX = 22;
const LABEL_PAD_LOGICAL = 10; // 左右余白（片側）
const LABEL_WORLD_H = 2.6;
const LABEL_WORLD_MAX_W = 22;
// タイトルラベルの既定の不透明度（非ホバー時）。整列モード(C)のフェード演出が
// 復帰先として参照するためexportする
export const LABEL_OPACITY = 0.75;
// 高さ基準のpx/world比。幅にも同じ比を使うことでテクスチャの歪みを防ぐ
const LABEL_PX_PER_WORLD = LABEL_LOGICAL_H / LABEL_WORLD_H;
const LABEL_FONT = (px: number) => `bold ${px}px 'Helvetica Neue', Helvetica, Arial`;

// 幅に収まるまで末尾から1文字ずつ削り「…」を付ける（英語の単語区切りに依存しないためCJKタイトルでも安全）
function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 0 && ctx.measureText(`${s}…`).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return `${s}…`;
}

/** タイトルラベルスプライトを生成。世界幅はテキスト実測幅に比例（最大 LABEL_WORLD_MAX_W） */
function createLabelSprite(title: string): THREE.Sprite {
  const physFont = LABEL_FONT_LOGICAL_PX * LABEL_CANVAS_SCALE;

  // 測定専用の一時canvasでフォントを設定し、1行・末尾…切詰めした実測幅を得る
  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d")!;
  mctx.font = LABEL_FONT(physFont);
  const maxTextPhysW = (LABEL_LOGICAL_MAX_W - LABEL_PAD_LOGICAL * 2) * LABEL_CANVAS_SCALE;
  const truncated = truncateToWidth(mctx, title, maxTextPhysW);
  const textPhysW = mctx.measureText(truncated).width;

  const canvasLogicalW = Math.ceil(textPhysW / LABEL_CANVAS_SCALE) + LABEL_PAD_LOGICAL * 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvasLogicalW * LABEL_CANVAS_SCALE;
  canvas.height = LABEL_LOGICAL_H * LABEL_CANVAS_SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.font = LABEL_FONT(physFont);
  ctx.fillStyle = "#111111";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(truncated, LABEL_PAD_LOGICAL * LABEL_CANVAS_SCALE, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: LABEL_OPACITY,
  });
  const sprite = new THREE.Sprite(material);
  const worldW = Math.min(canvasLogicalW / LABEL_PX_PER_WORLD, LABEL_WORLD_MAX_W);
  sprite.scale.set(worldW, LABEL_WORLD_H, 1);
  return sprite;
}

// createNodeObject()が返すGroupに添える内部情報。userDataはthree.jsの型がRecord<string, any>の
// ためどんなキーでも代入できるが、読み出し側は必ずこの型でキャストして使う
type NodeUserData = {
  image: THREE.Sprite;
  label: THREE.Sprite;
  // ラベルの画像に対する相対オフセット。x成分はカメラのright vector方向、
  // y成分はworld up方向に適用する（updateLabelFacing参照）
  labelOffsetX: number;
  labelUpOffset: THREE.Vector3;
};

function getUserData(group: THREE.Group): NodeUserData {
  return group.userData as NodeUserData;
}

/**
 * ノードオブジェクト生成。画像スプライト＋タイトルラベルスプライトをまとめたGroupを返す。
 * 呼び出しごとに必ず新規のGroup/Sprite/Material/Textureを作る（imageCacheコメント参照）。
 * ラベルは画像の右肩に浮かべる基準位置を初期値として持つが、実際の画面上の見え方は
 * Graph3DView側のswayループが毎フレーム「カメラのright vector」で上書きする
 * （world固定オフセットだと視点によって画像の裏に回りこんでしまうため）。
 */
export function createNodeObject(c: Case): THREE.Group {
  const group = new THREE.Group();
  const image = createImageSprite(c);
  const label = createLabelSprite(c.title);

  const labelWorldW = label.scale.x;
  const labelOffsetX = SPRITE_W / 2 + labelWorldW / 2 + 1.2;
  const labelUpOffset = new THREE.Vector3(0, SPRITE_W / 2 - 1.3, 0);
  label.position.copy(labelUpOffset); // 初回描画用の暫定値。次フレームでswayループが上書きする

  group.add(image, label);
  const userData: NodeUserData = { image, label, labelOffsetX, labelUpOffset };
  group.userData = userData;
  return group;
}

/**
 * ラベル位置をカメラ向きに追従させる。cameraRightはカメラのright vector
 * （setFromMatrixColumn(camera.matrixWorld, 0)）。毎フレーム呼ぶことを想定
 * （sway中かどうかに関わらず、カメラを回しただけでもラベルは追従する必要がある）。
 */
export function updateLabelFacing(group: THREE.Group, cameraRight: THREE.Vector3): void {
  const { label, labelOffsetX, labelUpOffset } = getUserData(group);
  label.position.copy(cameraRight).multiplyScalar(labelOffsetX).add(labelUpOffset);
}

/** ホバー強調。画像は1.15倍拡大+前面化（現行同等）、ラベルは不透明度0.75→1 */
export function setNodeHover(group: THREE.Group, on: boolean): void {
  const { image, label } = getUserData(group);
  image.scale.set(on ? SPRITE_W * 1.15 : SPRITE_W, on ? SPRITE_H * 1.15 : SPRITE_H, 1);
  image.material.depthTest = !on;
  image.renderOrder = on ? 1 : 0;
  label.material.opacity = on ? 1 : LABEL_OPACITY;
}

/** タイトルラベルの不透明度を直接設定する。整列モード(C)のフェード演出専用 */
export function setLabelOpacity(group: THREE.Group, opacity: number): void {
  const { label } = getUserData(group);
  label.material.opacity = opacity;
}
