/**
 * scripts/lib/quarantine.mjs のスモークテスト（fixtureのみ・実ファイル/git/CLI呼び出しなし）。
 * 敵対的レビューで検出された2件の回帰防止:
 *   - 隔離候補の重複計上（同一dataset+idが複数理由で複数回pushされ、5件上限がユニーク数と
 *     ズレる）
 *   - audit-tech.mjsのORPHANED行から実在しないtech id（例:"public"）が抽出される
 *
 * 使い方: node scripts/smoke-watchdog-quarantine.mjs
 */
import assert from "assert";
import { dedupeCandidates, extractKnownTechIdsFromAuditFailLines } from "./lib/quarantine.mjs";

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

check("dedupeCandidates: 同一dataset+idの重複を1件にまとめ理由を結合する", () => {
  const candidates = [
    { dataset: "tech", id: "foo-tech", reason: "audit-tech.mjs FAIL" },
    { dataset: "tech", id: "foo-tech", reason: "tech links[0]死活確認失敗(二重確認済): https://example.com" },
    { dataset: "cases", id: "bar-case", reason: "thumbnail: ローカルファイル欠損" },
  ];
  const result = dedupeCandidates(candidates);
  assert.strictEqual(result.length, 2, `2件にまとまる想定だが${result.length}件`);
  const fooTech = result.find((c) => c.dataset === "tech" && c.id === "foo-tech");
  assert.ok(fooTech, "foo-techが残っていること");
  assert.ok(fooTech.reason.includes("audit-tech.mjs FAIL") && fooTech.reason.includes("死活確認失敗"), "理由が結合されていること");
});

check("dedupeCandidates: 空配列/未指定は空配列", () => {
  assert.deepStrictEqual(dedupeCandidates([]), []);
  assert.deepStrictEqual(dedupeCandidates(undefined), []);
});

check("dedupeCandidates: 異なるdatasetの同名idは別entryとして残る", () => {
  const candidates = [
    { dataset: "tech", id: "same-id", reason: "a" },
    { dataset: "cases", id: "same-id", reason: "b" },
  ];
  const result = dedupeCandidates(candidates);
  assert.strictEqual(result.length, 2);
});

check("extractKnownTechIdsFromAuditFailLines: 実在するtech idのみ抽出する", () => {
  const lines = [
    "✗ MISSING FIELDS: real-tech-id → point",
    "✗ ORPHANED THUMBNAIL FILE: public/thumbnails/tech/xxx.jpg（tech.jsonから未参照）",
    "✗ INVALID TYPE: another-real-id = \"Foo\"",
    "✗ INVALID DOMAIN: not-a-known-id = \"Bar\"",
  ];
  const knownIds = ["real-tech-id", "another-real-id"];
  const ids = extractKnownTechIdsFromAuditFailLines(lines, knownIds);
  assert.deepStrictEqual(ids.sort(), ["another-real-id", "real-tech-id"], `抽出結果: ${JSON.stringify(ids)}`);
  assert.ok(!ids.includes("public"), "ORPHANED行から偽id'public'が抽出されないこと");
  assert.ok(!ids.includes("not-a-known-id"), "knownIdsに無いidは採用しないこと");
});

check("extractKnownTechIdsFromAuditFailLines: 空入力は空配列（例外を投げない）", () => {
  assert.deepStrictEqual(extractKnownTechIdsFromAuditFailLines([], []), []);
  assert.deepStrictEqual(extractKnownTechIdsFromAuditFailLines(undefined, undefined), []);
});

console.log(`\n${passed}件PASS`);
if (process.exitCode) {
  console.error("FAIL: 上記のテストが失敗しました");
} else {
  console.log("ALL PASS");
}
