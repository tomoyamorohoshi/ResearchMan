// scripts/lib/reinject-descriptions.mjs の単体検証。
// 実行: node scripts/smoke-reinject-descriptions.mjs
import { reinjectDescriptions } from "./lib/reinject-descriptions.mjs";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

// ── ネストした_descriptionを、LLM出力(_description落ち)に再注入する ──
{
  const oldObj = {
    _description: "root desc",
    tech: { _description: "tech desc", lanes: [{ label: "L1", sources: "S1" }] },
    cc: { _description: "cc desc", roundFoci: [{ label: "R1", sources: "S1", diversity: "D1" }] },
  };
  const newObj = {
    // _descriptionを全て落とした状態（LLMが出力例通りに省略した想定）
    tech: { lanes: [{ label: "L1-changed", sources: "S1-changed" }] },
    cc: { roundFoci: [{ label: "R1", sources: "S1", diversity: "D1" }] },
  };
  const result = reinjectDescriptions(oldObj, newObj);
  assert(result._description === "root desc", "ルートの_descriptionが再注入される");
  assert(result.tech._description === "tech desc", "tech._descriptionが再注入される");
  assert(result.cc._description === "cc desc", "cc._descriptionが再注入される");
  assert(result.tech.lanes[0].label === "L1-changed", "lanes配列の中身自体は変更されない(newObj優先)");
  assert(Array.isArray(result.tech.lanes) && result.tech.lanes.length === 1, "lanes配列はそのまま保持される");
}

// ── oldObjに_descriptionが無い場合は追加しない ──
{
  const oldObj = { tech: { lanes: [] } };
  const newObj = { tech: { lanes: [] } };
  const result = reinjectDescriptions(oldObj, newObj);
  assert(result._description === undefined, "oldに無ければ_descriptionは追加されない");
}

// ── newObjが配列そのものの場合はそのまま返す ──
{
  const result = reinjectDescriptions({ _description: "x" }, [1, 2, 3]);
  assert(JSON.stringify(result) === "[1,2,3]", "newObjが配列ならそのまま返す");
}

// ── _descriptionはoldの元の位置（先頭）に復元される。末尾に追加され直すと
//    JSON.stringifyでのキー順が変わり、実運用のgit diffが「全体書き換え」に
//    見えてしまう（2026-07-08 実機テストで実際に発生したバグの再発防止） ──
{
  const oldObj = {
    _description: "root desc",
    tech: { _description: "tech desc", lanes: [{ label: "L1", sources: "S1" }] },
  };
  const newObj = {
    tech: { lanes: [{ label: "L1-changed", sources: "S1-changed" }] },
  };
  const result = reinjectDescriptions(oldObj, newObj);
  assert(
    JSON.stringify(Object.keys(result)) === JSON.stringify(["_description", "tech"]),
    `ルートのキー順は旧オブジェクトの並びを保つ（_descriptionが先頭） (got ${JSON.stringify(Object.keys(result))})`
  );
  assert(
    JSON.stringify(Object.keys(result.tech)) === JSON.stringify(["_description", "lanes"]),
    `ネストしたオブジェクトのキー順も保たれる (got ${JSON.stringify(Object.keys(result.tech))})`
  );
}

// ── newObjにしか無い新規キーは末尾に追加される（順序はnewObjの並び） ──
{
  const oldObj = { _description: "d", a: 1 };
  const newObj = { a: 2, b: 3 };
  const result = reinjectDescriptions(oldObj, newObj);
  assert(
    JSON.stringify(Object.keys(result)) === JSON.stringify(["_description", "a", "b"]),
    `新規キーはold由来のキーの後に追加される (got ${JSON.stringify(Object.keys(result))})`
  );
  assert(result.a === 2 && result.b === 3, "値そのものはnewObj優先で保持される");
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: reinject-descriptions");
}
