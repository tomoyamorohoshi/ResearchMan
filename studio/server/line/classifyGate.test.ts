/** 基準の変更案（承認/却下/修正）コマンドの解釈テスト。既存の classify.test.ts は無改変。 */
import assert from "node:assert/strict";
import test from "node:test";
import { classifyRequestText, extractAddCaseRequest, isOkText, matchMenuSelection, parseGateCommand } from "./classify.js";

test("parseGateCommand: 承認 G12 / g12 / 12 / 全角空白・全角英数", () => {
  for (const t of ["承認 G12", "承認 g12", "承認 12", "承認　Ｇ１２", "  承認 G12  ", "承認G12", "承認　ｇ１２\n"]) {
    assert.deepEqual(parseGateCommand(t), { action: "approve", id: 12, feedback: "" }, t);
  }
});

test("parseGateCommand: 却下", () => {
  assert.deepEqual(parseGateCommand("却下 G3"), { action: "reject", id: 3, feedback: "" });
  assert.deepEqual(parseGateCommand("却下 3"), { action: "reject", id: 3, feedback: "" });
});

test("parseGateCommand: 修正は複数行の自由文を保持する", () => {
  assert.deepEqual(parseGateCommand("修正 G12 もっと短く\n2行目"), { action: "revise", id: 12, feedback: "もっと短く\n2行目" });
  assert.deepEqual(parseGateCommand("修正　Ｇ１２　全角で　書く"), { action: "revise", id: 12, feedback: "全角で　書く" });
  assert.deepEqual(parseGateCommand("修正 G12"), { action: "revise", id: 12, feedback: "" });
});

test("parseGateCommand: id なし・他の語・不正な id は null（誤作動しない）", () => {
  for (const t of ["承認", "却下", "修正", "承認 OK", "承認 G", "承認 G12abc", "承認しました", "承認 G0", "調べて 承認 G12", "OK", "1", "https://example.com 承認 G1", ""]) {
    assert.equal(parseGateCommand(t), null, t);
  }
});

test("parseGateCommand: 既存コマンドとは競合しない（既存の判定は従来どおり）", () => {
  for (const t of ["調べて 12", "OK", "キャンセル", "停止", "再開", "進捗", "1", "①", "5"]) assert.equal(parseGateCommand(t), null, t);
  assert.equal(isOkText("承認 G1"), false);
  assert.equal(matchMenuSelection("承認 G1"), null);
  assert.equal(classifyRequestText("承認 G1"), null);
  assert.equal(extractAddCaseRequest("承認 G1"), null);
});
