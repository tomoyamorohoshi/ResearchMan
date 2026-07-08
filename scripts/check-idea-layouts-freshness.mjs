// data/idea-layouts.json の鮮度検査（DESIGN: goofy-hatching-mango.md 2026-07-08改訂・
// 事前計算方式）。pre-pushフックから呼ばれ、「data/idea-layouts.jsonの入力ハッシュ ==
// 現在のdata/ideas.json」でなければpushを拒否する（鮮度の機械保証。ビルド時フォールバックで
// 古いレイアウトを黙って使う方が有害という判断のため、フォールバックは作らずここで止める）。
//
// tsx不要（重いTSモジュールをimportしない）: pre-pushの度に毎回走るため、起動コストを
// 最小にする目的でハッシュ計算だけを行うプレーンなNode ESMスクリプトにしている。
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeIdeaLayoutsInputHash } from "./lib/idea-layouts-hash.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IDEAS_JSON_PATH = path.join(__dirname, "../data/ideas.json");
const LAYOUTS_PATH = path.join(__dirname, "../data/idea-layouts.json");

async function main() {
  const ideasRawText = await fs.readFile(IDEAS_JSON_PATH, "utf-8");
  const expectedHash = computeIdeaLayoutsInputHash(ideasRawText);

  let layouts;
  try {
    layouts = JSON.parse(await fs.readFile(LAYOUTS_PATH, "utf-8"));
  } catch (e) {
    console.error(`[idea-layouts鮮度検査] ${LAYOUTS_PATH} が読めません: ${e.message}`);
    console.error("npx tsx scripts/precompute-idea-layouts.mjs を実行し、生成物をコミットしてから再度pushしてください。");
    process.exit(1);
  }

  if (layouts.inputHash !== expectedHash) {
    console.error(
      "[idea-layouts鮮度検査] data/idea-layouts.json が現在のdata/ideas.jsonと一致しません（古いレイアウト）。",
    );
    console.error(`  期待ハッシュ = ${expectedHash}`);
    console.error(`  記録ハッシュ = ${layouts.inputHash}`);
    console.error("npx tsx scripts/precompute-idea-layouts.mjs を実行し、生成物をコミットしてから再度pushしてください。");
    process.exit(1);
  }

  console.log("[idea-layouts鮮度検査] OK: data/idea-layouts.json は現在のdata/ideas.jsonと一致しています。");
}

main().catch((e) => {
  console.error("[idea-layouts鮮度検査] 予期しないエラー:", e.message);
  process.exit(1);
});
