import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRequestText,
  extractAddCaseRequest,
  isAffirmativeText,
  isCancelText,
  isNegativeText,
  isOkText,
  matchMenuSelection,
} from "./classify.js";

test("classifyRequestText: 「調べて」→ Case Study", () => {
  const r = classifyRequestText("調べて 生成AIを使った屋外広告の事例");
  assert.deepEqual(r, { kind: "Case Study", rest: "生成AIを使った屋外広告の事例" });
});

test("classifyRequestText: 「技術調べて」→ Technology（「調べて」誤判定しない）", () => {
  const r = classifyRequestText("技術調べて 空間ディスプレイの新技術");
  assert.deepEqual(r, { kind: "Technology", rest: "空間ディスプレイの新技術" });
});

test("classifyRequestText: 「両方調べて」→ 両方（「調べて」「技術調べて」誤判定しない）", () => {
  const r = classifyRequestText("両方調べて AR広告 5件くらい");
  assert.deepEqual(r, { kind: "両方", rest: "AR広告 5件くらい" });
});

test("classifyRequestText: 「アイデア」→ idea", () => {
  const r = classifyRequestText("アイデア 若者向け音楽フェスの新しい体験");
  assert.deepEqual(r, { kind: "idea", rest: "若者向け音楽フェスの新しい体験" });
});

test("classifyRequestText: 先頭の空白を許容する", () => {
  const r = classifyRequestText("  調べて テーマ  ");
  assert.deepEqual(r, { kind: "Case Study", rest: "テーマ" });
});

test("classifyRequestText: どれにも一致しなければnull", () => {
  assert.equal(classifyRequestText("こんにちは"), null);
  assert.equal(classifyRequestText(""), null);
});

test("isOkText: OK/ok/OK！/おけ/実行 を受理する", () => {
  for (const t of ["OK", "ok", "OK！", "おけ", "実行", "  OK  "]) {
    assert.equal(isOkText(t), true, `expected true for ${t}`);
  }
});

test("isOkText: 部分一致・無関係な文字列は拒否する", () => {
  for (const t of ["OKです", "了解", "実行して", ""]) {
    assert.equal(isOkText(t), false, `expected false for ${t}`);
  }
});

test("isCancelText: キャンセル/やめる を受理する", () => {
  assert.equal(isCancelText("キャンセル"), true);
  assert.equal(isCancelText("やめる"), true);
  assert.equal(isCancelText(" やめる "), true);
});

test("isCancelText: 無関係な文字列は拒否する", () => {
  assert.equal(isCancelText("キャンセルします"), false);
  assert.equal(isCancelText(""), false);
});

test("matchMenuSelection: 番号（半角・全角・丸数字）を判定する", () => {
  assert.equal(matchMenuSelection("1"), "Case Study");
  assert.equal(matchMenuSelection("１"), "Case Study");
  assert.equal(matchMenuSelection("①"), "Case Study");
  assert.equal(matchMenuSelection("2"), "Technology");
  assert.equal(matchMenuSelection("3"), "両方");
  assert.equal(matchMenuSelection("4"), "idea");
});

test("matchMenuSelection: リッチメニューのボタン文言・寛容な語も判定する", () => {
  assert.equal(matchMenuSelection("事例調査"), "Case Study");
  assert.equal(matchMenuSelection("事例"), "Case Study");
  assert.equal(matchMenuSelection("技術調査"), "Technology");
  assert.equal(matchMenuSelection("事例+技術"), "両方");
  assert.equal(matchMenuSelection("両方"), "両方");
  assert.equal(matchMenuSelection("アイデア出し"), "idea");
  assert.equal(matchMenuSelection("アイデア"), "idea");
});

test("matchMenuSelection: 前後空白は許容し、部分一致・無関係な文字列は拒否する", () => {
  assert.equal(matchMenuSelection("  1  "), "Case Study");
  assert.equal(matchMenuSelection("事例調査のリサーチ"), null);
  assert.equal(matchMenuSelection("こんにちは"), null);
  assert.equal(matchMenuSelection(""), null);
});

test("isAffirmativeText: y/Y/yes/はい/OK/おけ/いいです/実行 を受理する", () => {
  for (const t of ["y", "Y", "yes", "はい", "OK", "おけ", "いいです", "実行", "  y  "]) {
    assert.equal(isAffirmativeText(t), true, `expected true for ${t}`);
  }
});

test("isAffirmativeText: 無関係な文字列は拒否する", () => {
  for (const t of ["yesですね", "うん", ""]) {
    assert.equal(isAffirmativeText(t), false, `expected false for ${t}`);
  }
});

test("isNegativeText: n/N/no/いいえ/ちがう/直す を受理する", () => {
  for (const t of ["n", "N", "no", "いいえ", "ちがう", "直す"]) {
    assert.equal(isNegativeText(t), true, `expected true for ${t}`);
  }
});

test("isNegativeText: 無関係な文字列は拒否する", () => {
  for (const t of ["違いますね", ""]) {
    assert.equal(isNegativeText(t), false, `expected false for ${t}`);
  }
});

// ── extractAddCaseRequest（LINEでURLを送ると事例が追加される機能） ──────────

test("extractAddCaseRequest: URLのみのテキストはurlのみ抽出しcontextは空", () => {
  const r = extractAddCaseRequest("https://example.com/article/123");
  assert.deepEqual(r, { url: "https://example.com/article/123", context: "" });
});

test("extractAddCaseRequest: URLの前後に補足があればcontextとして結合される", () => {
  const r = extractAddCaseRequest("これ面白い https://example.com/article/123 音楽視点で見て");
  assert.equal(r?.url, "https://example.com/article/123");
  assert.equal(r?.context, "これ面白い 音楽視点で見て");
});

test("extractAddCaseRequest: 複数URLがあれば最初のURLをurlとして採用し、残りはcontextに残る", () => {
  const r = extractAddCaseRequest("https://example.com/a https://example.com/b");
  assert.equal(r?.url, "https://example.com/a");
  assert.equal(r?.context, "https://example.com/b");
});

test("extractAddCaseRequest: URLが無ければnull", () => {
  assert.equal(extractAddCaseRequest("こんにちは"), null);
  assert.equal(extractAddCaseRequest(""), null);
});

test("extractAddCaseRequest: 全角記号・CJK文字が直後に続いてもURLを汚染しない", () => {
  assert.equal(extractAddCaseRequest("https://example.com/article。詳細見て")?.url, "https://example.com/article");
  assert.equal(extractAddCaseRequest("https://example.com/a、続き")?.url, "https://example.com/a");
  assert.equal(extractAddCaseRequest("（https://example.com/b）文脈")?.url, "https://example.com/b");
  assert.equal(extractAddCaseRequest("https://example.com/c」文脈")?.url, "https://example.com/c");
});
