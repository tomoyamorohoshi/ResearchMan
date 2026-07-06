// ON/OFFワンカット遷移(「グリッド平面モーフ」)の純粋な座標変換。three.js/DOM非依存
// （Node直実行でスモークテスト可能に保つ。alignLayout.ts/graph.tsと同じ方針）。
// Graph3DView.tsxからのみ呼ばれる想定。
//
// 設計: DOMグリッドと3D星雲を「同じスプライト群の2つのポーズ」として扱う。
// 正準カメラ（位置(0,0,D)・垂直fov f・注視原点、平面はz=0）から見て、各スプライトが
// DOMグリッドの対応カードの画像部分と画素単位で一致して見えるワールド座標・スケールを
// 計算する（計画書の数式をそのまま純関数化したもの）。

export type CameraParams = { distance: number; vFovDeg: number };

/** ライブラリ既定のカメラ自動フレーミング距離（cbrt(n)*170）。整列解除・ON/OFFの
 * 「正準カメラ」の距離として共通利用する（force-graphの初期WARMUP後の自然な収まり）。 */
export function defaultCameraDistance(nodeCount: number): number {
  return Math.cbrt(Math.max(nodeCount, 1)) * 170;
}

/** 垂直画角(度)・距離から、その距離のz=0平面上でカメラに収まるワールド高さ。
 * V = 2 * D * tan(f/2) */
export function visibleWorldHeight(distance: number, vFovDeg: number): number {
  const vFov = (vFovDeg * Math.PI) / 180;
  return 2 * distance * Math.tan(vFov / 2);
}

/** canvas相対px座標(px,py)をワールドXY(z=0)へ変換する。
 * world_x = (px - W_px/2) / H_px * V
 * world_y = (H_px/2 - py) / H_px * V */
export function pxToWorld(
  px: number,
  py: number,
  canvasWidthPx: number,
  canvasHeightPx: number,
  camera: CameraParams,
): { x: number; y: number } {
  const v = visibleWorldHeight(camera.distance, camera.vFovDeg);
  const x = ((px - canvasWidthPx / 2) / canvasHeightPx) * v;
  const y = ((canvasHeightPx / 2 - py) / canvasHeightPx) * v;
  return { x, y };
}

/** canvas相対pxの幅をワールド幅へ変換する。world_w = w_px / H_px * V
 * （スプライトのscaleをこれに合わせる＝ポーズ中のみ） */
export function pxWidthToWorld(widthPx: number, canvasHeightPx: number, camera: CameraParams): number {
  const v = visibleWorldHeight(camera.distance, camera.vFovDeg);
  return (widthPx / canvasHeightPx) * v;
}

// カード画像部分（正方形）のビューポート絶対rect。heightは持たない（widthと同値の前提）
export type PlaneCardRect = { left: number; top: number; width: number };
// canvas要素（コンテナ）のビューポート絶対rectのうち、原点算出に使う左上座標のみ
export type PlaneCanvasOrigin = { left: number; top: number };

/**
 * カードの画像部分rect（ビューポート絶対px）とcanvasコンテナの原点・寸法から、
 * canvas相対座標に変換した上でワールド座標・世界幅（スプライトのx/y/scale）を返す。
 */
export function cardRectToPlanePose(
  cardRect: PlaneCardRect,
  canvasOrigin: PlaneCanvasOrigin,
  canvasWidthPx: number,
  canvasHeightPx: number,
  camera: CameraParams,
): { x: number; y: number; scale: number } {
  const centerPx = cardRect.left + cardRect.width / 2 - canvasOrigin.left;
  const centerPy = cardRect.top + cardRect.width / 2 - canvasOrigin.top; // 正方形なのでheight=width
  const { x, y } = pxToWorld(centerPx, centerPy, canvasWidthPx, canvasHeightPx, camera);
  const scale = pxWidthToWorld(cardRect.width, canvasHeightPx, camera);
  return { x, y, scale };
}
