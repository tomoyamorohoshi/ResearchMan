// 3Dグラフ用カードスプライト（サムネ+タイトルの常時表示ノード）。client専用（three静的import）。
// Graph3DView（"use client"・ssr:false経由）からのみimportされる想定。
import * as THREE from "three";
import type { Case } from "./cases";

// カード寸法（canvas px）
export const CARD_W = 256;
export const IMG_H = 256; // 正方形（グリッドの aspect-square と一致）
export const TEXT_H = 64;
export const SPRITE_W = 16; // world単位。linkDistanceの最小値40より十分小さいこと
export const SPRITE_H = SPRITE_W * ((IMG_H + TEXT_H) / CARD_W);

const CARD_H = IMG_H + TEXT_H;

// 読み込み済み画像のキャッシュ（id単位）。
//
// 注意: ここでキャッシュするのは画像データのみで、Sprite/Material/Texture自体は
// createCardSprite()の呼び出しごとに必ず新規生成する。3d-force-graphは
// nodeThreeObjectが返したObject3Dの所有権を握り、そのノードがデータから
// 一時的に外れる（フィルタで絞られる等）と内部でmaterial.map.dispose()を
// 含む解放処理を自動実行する。同じSpriteインスタンスをキャッシュして使い回すと、
// ノード再出現時に「既に解放済みのtexture/material」を持つオブジェクトを
// 再度シーンに追加することになり、次の解放処理で二重disposeが発生して
// 内部Mapの参照が壊れクラッシュする（実装中にPlaywrightで100%再現・特定）。
// 画像データだけをキャッシュしてネットワーク再取得は避けつつ、
// Three.jsオブジェクトは常にフレッシュにすることで解決する。
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
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.strokeStyle = "#d4d0c8";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_W - 2, CARD_H - 2);
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

// 幅に収まるよう文字単位で折り返す（英語の単語区切りに依存しないためCJKタイトルでも安全）
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const ch of text) {
    const test = current + ch;
    if (current && ctx.measureText(test).width > maxWidth) {
      lines.push(current);
      current = ch;
      if (lines.length === maxLines) break;
    } else {
      current = test;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);

  const consumedLen = lines.reduce((n, l) => n + l.length, 0);
  if (lines.length === maxLines && consumedLen < text.length) {
    let last = lines[maxLines - 1];
    while (last.length > 0 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function drawTitle(ctx: CanvasRenderingContext2D, title: string) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, IMG_H, CARD_W, TEXT_H);
  ctx.fillStyle = "#111111";
  ctx.font = "bold 20px 'Helvetica Neue', Helvetica, Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const pad = 12;
  const maxWidth = CARD_W - pad * 2;
  const lines = wrapText(ctx, title, maxWidth, 2);
  lines.forEach((line, i) => ctx.fillText(line, pad, IMG_H + 8 + i * 24));
}

/**
 * カードスプライト生成。呼び出しごとに必ず新規のSprite/Material/Textureを作る
 * （理由は上部の imageCache コメント参照）。画像が未キャッシュならプレースホルダ+
 * タイトルを同期描画した上で非同期ロードして再描画し、ロード済みなら即座に反映する。
 */
export function createCardSprite(c: Case): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d")!;

  drawCardBase(ctx);

  const cached = imageCache.get(c.id);
  if (cached) {
    drawCoverImage(ctx, cached);
  } else {
    drawPlaceholderImage(ctx);
  }
  drawTitle(ctx, c.title);

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
      drawTitle(ctx, c.title);
      texture.needsUpdate = true;
    });
  }

  return sprite;
}

/** ホバー強調（1.15倍拡大+前面化）。offで基準サイズへ復元 */
export function setSpriteHover(s: THREE.Sprite, on: boolean): void {
  s.scale.set(on ? SPRITE_W * 1.15 : SPRITE_W, on ? SPRITE_H * 1.15 : SPRITE_H, 1);
  s.material.depthTest = !on;
  s.renderOrder = on ? 1 : 0;
}
