/**
 * data/idea-angles.json の初版生成CLI（一度きりの実行用。DESIGN.md §6 idea「初版は今回生成」）。
 * どのサーバコードからもimportされない（tsx watchの監視対象外・実行中サーバに影響しない）。
 *
 * 使い方: npx tsx server/pipeline/generateIdeaAnglesCli.ts   （studio/ をcwdに実行）
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateIdeaAngles, ideaAnglesPath } from "./ideaAngles.js";
import type { CaseRecord } from "./ideaPure.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", ".."); // studio/server/pipeline -> repo root

async function main(): Promise<void> {
  const cases = JSON.parse(await readFile(path.join(ROOT, "data", "cases.json"), "utf-8")) as CaseRecord[];
  console.log(`[generate-idea-angles] data/cases.json ${cases.length}件から切り口ライブラリを生成します…`);
  const angles = await generateIdeaAngles(cases);
  await writeFile(ideaAnglesPath(ROOT), JSON.stringify(angles, null, 2) + "\n");
  console.log(`[generate-idea-angles] ✅ ${angles.length}個の切り口を data/idea-angles.json へ書き出しました`);
  for (const a of angles) {
    console.log(`  - ${a.label}（${a.id}）: ${a.description} [exemplars: ${a.exemplarCaseIds.length}]`);
  }
}

main().catch((e) => {
  console.error("[generate-idea-angles] ❌ エラー:", e instanceof Error ? e.message : e);
  process.exit(1);
});
