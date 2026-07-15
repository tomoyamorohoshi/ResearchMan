import assert from "node:assert/strict";
import test from "node:test";
import { extractJsonObject, parseAwardStructuredResponse, parseStructuredResponse } from "./structure.js";

test("extractJsonObject: 前置き・後書き付きのJSONオブジェクトを抽出する", () => {
  const text = 'はい、抽出しました:\n{"theme": "AR広告", "count": 3}\nご確認ください。';
  assert.deepEqual(extractJsonObject(text), { theme: "AR広告", count: 3 });
});

test("extractJsonObject: JSONが無ければnull", () => {
  assert.equal(extractJsonObject("わかりません"), null);
});

test("extractJsonObject: 配列はオブジェクトとして扱わずnull", () => {
  assert.equal(extractJsonObject("[1,2,3]"), null);
});

test("parseStructuredResponse: research系はkindを保持し、count未指定はpure.tsの既定値(5件)になる", () => {
  const r = parseStructuredResponse("Case Study", '{"theme": "生成AI広告", "viewpoint": null, "refUrl": null, "count": null}');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.tab, "research");
    const v = r.value as { kind: string; theme: string; count: number };
    assert.equal(v.kind, "Case Study");
    assert.equal(v.theme, "生成AI広告");
    assert.equal(v.count, 5, "countがnullなら既定値5件になるはず（Number(null)=0の罠を回避）");
  }
});

test("parseStructuredResponse: 件数が明示されていればそれが使われる", () => {
  const r = parseStructuredResponse("Technology", '{"theme": "空間ディスプレイ", "viewpoint": null, "refUrl": null, "count": 3}');
  assert.equal(r.ok, true);
  if (r.ok) {
    const v = r.value as { count: number };
    assert.equal(v.count, 3);
  }
});

test("parseStructuredResponse: idea はcount未指定でideaPure.tsの既定値(6件)になる", () => {
  const r = parseStructuredResponse("idea", '{"theme": "音楽フェス", "constraint": null, "count": null}');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.tab, "idea");
    const v = r.value as { theme: string; count: number };
    assert.equal(v.theme, "音楽フェス");
    assert.equal(v.count, 6);
  }
});

test("parseStructuredResponse: themeが読み取れなければバリデーションエラーを返す", () => {
  const r = parseStructuredResponse("Case Study", '{"theme": "", "viewpoint": null, "refUrl": null, "count": null}');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /テーマ/);
});

test("parseStructuredResponse: JSONが取れなければ読み取り失敗エラー", () => {
  const r = parseStructuredResponse("Case Study", "すみません、わかりませんでした");
  assert.equal(r.ok, false);
});

// ── AWARDS構造化（Q1/Q2の2問から{awardName,year,categories,minLevel}への正規化） ──

test("parseAwardStructuredResponse: 全部門+レベルの組み合わせを正しく正規化する", () => {
  const r = parseAwardStructuredResponse('{"awardName": "D&AD", "year": "2026", "categories": "all", "minLevel": "Bronze"}');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.awardName, "D&AD");
    assert.equal(r.value.year, "2026");
    assert.equal(r.value.categories, "all");
    assert.equal(r.value.minLevel, "Bronze");
  }
});

test("parseAwardStructuredResponse: 個別部門の配列も通す", () => {
  const r = parseAwardStructuredResponse(
    '{"awardName": "One Show", "year": "2026", "categories": ["Film", "Digital Design"], "minLevel": "Gold"}',
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value.categories, ["Film", "Digital Design"]);
});

test("parseAwardStructuredResponse: awardNameが空ならエラー", () => {
  const r = parseAwardStructuredResponse('{"awardName": "", "year": "2026", "categories": "all", "minLevel": "Bronze"}');
  assert.equal(r.ok, false);
});

test("parseAwardStructuredResponse: JSONが取れなければ読み取り失敗エラー", () => {
  const r = parseAwardStructuredResponse("わかりません");
  assert.equal(r.ok, false);
});
