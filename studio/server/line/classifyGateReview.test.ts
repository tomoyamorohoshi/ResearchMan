/** レビュー指摘対応: 誤爆の削減と #G12 / 全角コロン等の表記ゆれ。 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseGateCommand } from "./classify.js";

test("承認・却下は ID の後ろに文が続くと一致しない（誤爆防止）", () => {
  for (const t of ["承認 3 件お願いします", "却下 1 は不要", "却下 12 ではなく 13 を承認", "承認 12 です", "承認 G12 お願いします"]) {
    assert.equal(parseGateCommand(t), null, t);
  }
});

test("承認・却下は末尾の句読点・空白・!・。だけなら一致", () => {
  for (const t of ["承認 G12。", "承認 G12!", "承認 G12！", "承認 G12 。", "却下 G3、", "承認 G12 \n"]) {
    assert.ok(parseGateCommand(t), t);
  }
});

test("#G12 / ＃G12 / コロン区切りを受け付ける", () => {
  for (const t of ["承認 #G12", "承認：G12", "承認:G12", "承認 ＃Ｇ１２", "承認 G12。"]) {
    assert.deepEqual(parseGateCommand(t), { action: "approve", id: 12, feedback: "" }, t);
  }
  assert.deepEqual(parseGateCommand("修正 #G12 短く"), { action: "revise", id: 12, feedback: "短く" });
  assert.deepEqual(parseGateCommand("修正：G12 短く"), { action: "revise", id: 12, feedback: "短く" });
});

test("修正は ID の後に空白/改行＋自由文がある場合のみ（ID直後に文字が続くと null）", () => {
  assert.deepEqual(parseGateCommand("修正 G12\n短く"), { action: "revise", id: 12, feedback: "短く" });
  assert.equal(parseGateCommand("修正 12abc"), null);
  assert.equal(parseGateCommand("修正12年"), null);
});
