// 段階描画（先頭N件だけDOMにある）でも3D遷移の平面ポーズを全ノードに与えるため、
// 描画済みカードの実測rectから「グリッドの続きの位置」を合成する純関数。
// 合成位置はほぼ画面外（平面は画面外へ延長され、そこからスプライトが飛んでくる/飛んでいく）。
import type { PlaneCardRect } from "./planePose";

const SAME_ROW_TOLERANCE_PX = 2;

/**
 * rects: 実測した画像rect（id→rect）。orderedIds: グリッドの表示順の全id（先頭から順にDOMに描かれる）。
 * 先頭から連続して実測できた件数nから、列数・横ピッチ・行ピッチ（最終描画行までの平均）を求め、
 * 未実測のidに合成rectを追加した新しいMapを返す。
 * 描画済みが全件・0件、または2行未満で行ピッチが求まらない場合は入力と同じ内容を返す。
 */
export function synthesizeGridRects(
  rects: Map<string, PlaneCardRect>,
  orderedIds: string[],
): Map<string, PlaneCardRect> {
  const out = new Map(rects);

  let n = 0;
  while (n < orderedIds.length && rects.has(orderedIds[n])) n++;
  if (n === 0 || n >= orderedIds.length) return out;

  const first = rects.get(orderedIds[0])!;
  let cols = 1;
  while (cols < n) {
    const r = rects.get(orderedIds[cols])!;
    if (Math.abs(r.top - first.top) > SAME_ROW_TOLERANCE_PX || r.left <= rects.get(orderedIds[cols - 1])!.left) break;
    cols++;
  }

  const lastRow = Math.floor((n - 1) / cols);
  if (lastRow === 0) return out; // 1行分しか無く行ピッチが求まらない
  const lastRowRect = rects.get(orderedIds[lastRow * cols])!;
  const rowPitch = (lastRowRect.top - first.top) / lastRow;
  const colPitch = cols >= 2 ? (rects.get(orderedIds[cols - 1])!.left - first.left) / (cols - 1) : 0;

  for (let i = n; i < orderedIds.length; i++) {
    const row = Math.floor(i / cols);
    out.set(orderedIds[i], {
      left: first.left + (i % cols) * colPitch,
      top: lastRowRect.top + (row - lastRow) * rowPitch,
      width: first.width,
    });
  }
  return out;
}
