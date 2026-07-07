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

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: reinject-descriptions");
}
