import { test } from "node:test";
import assert from "node:assert/strict";
import { synthesizeGridRects } from "./gridRectSynth";
import type { PlaneCardRect } from "./planePose";

// cols列・セル幅w・横ピッチcp・各行のtop配列でn件分の実測rect相当を作る
function measured(ids: string[], cols: number, w: number, cp: number, rowTops: number[], left0 = 10): Map<string, PlaneCardRect> {
  const m = new Map<string, PlaneCardRect>();
  ids.forEach((id, i) => {
    m.set(id, { left: left0 + (i % cols) * cp, top: rowTops[Math.floor(i / cols)], width: w });
  });
  return m;
}
const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

test("描画済みが全件なら同じ内容のまま", () => {
  const all = ids(6);
  const rects = measured(all, 3, 100, 101, [0, 300]);
  const out = synthesizeGridRects(rects, all);
  assert.equal(out.size, 6);
  for (const id of all) assert.deepEqual(out.get(id), rects.get(id));
});

test("未描画の項目はグリッドの続きの位置に合成される（列数・横ピッチ・行ピッチ）", () => {
  const all = ids(23);
  const rects = measured(ids(10), 5, 100, 101, [50, 350]); // 2行描画済み、行ピッチ300
  const out = synthesizeGridRects(rects, all);
  assert.equal(out.size, 23);
  // 描画済みは実測のまま
  assert.deepEqual(out.get("c7"), rects.get("c7"));
  // c10 = 3行目の先頭、c12 = 3行目の3列目
  assert.deepEqual(out.get("c10"), { left: 10, top: 650, width: 100 });
  assert.deepEqual(out.get("c12"), { left: 10 + 2 * 101, top: 650, width: 100 });
  // c22 = 5行目(index4)の3列目
  assert.deepEqual(out.get("c22"), { left: 10 + 2 * 101, top: 50 + 4 * 300, width: 100 });
});

test("行の高さが不揃いでも、最終描画行の位置から平均ピッチで続ける", () => {
  const all = ids(20);
  // 4列・3行描画(12件): row tops 0, 280, 620 → 平均ピッチ310、最終行top=620
  const rects = measured(ids(12), 4, 100, 100, [0, 280, 620], 0);
  const out = synthesizeGridRects(rects, all);
  assert.equal(out.get("c12")?.top, 930);
  assert.equal(out.get("c16")?.top, 1240);
  assert.equal(out.get("c13")?.left, 100);
});

test("描画済みが行の途中で終わっていても、その行の残りは同じtopに置く", () => {
  const all = ids(20);
  const rects = measured(ids(7), 3, 100, 100, [0, 300, 600], 0); // 3行目は1件だけ
  const out = synthesizeGridRects(rects, all);
  assert.deepEqual(out.get("c7"), { left: 100, top: 600, width: 100 });
  assert.deepEqual(out.get("c8"), { left: 200, top: 600, width: 100 });
  assert.deepEqual(out.get("c9"), { left: 0, top: 900, width: 100 });
});

test("1列表示でも動く", () => {
  const all = ids(6);
  const rects = measured(ids(3), 1, 100, 0, [0, 200, 400], 5);
  const out = synthesizeGridRects(rects, all);
  assert.deepEqual(out.get("c5"), { left: 5, top: 1000, width: 100 });
});

test("描画済み0件・行ピッチが求まらない場合は入力をそのまま返す（従来どおり）", () => {
  assert.equal(synthesizeGridRects(new Map(), ids(5)).size, 0);
  const one = measured(ids(1), 1, 100, 0, [0]);
  assert.equal(synthesizeGridRects(one, ids(5)).size, 1);
  const oneRow = measured(ids(3), 3, 100, 100, [0], 0);
  assert.equal(synthesizeGridRects(oneRow, ids(9)).size, 3);
});

test("orderedIdsに無いrectは落とさず保持する", () => {
  const rects = measured(ids(10), 5, 100, 101, [0, 300]);
  rects.set("extra", { left: 1, top: 2, width: 3 });
  const out = synthesizeGridRects(rects, ids(12));
  assert.deepEqual(out.get("extra"), { left: 1, top: 2, width: 3 });
  assert.equal(out.size, 13);
});
