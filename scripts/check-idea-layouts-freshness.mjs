// data/idea-layouts.json の鮮度検査（DESIGN: goofy-hatching-mango.md 2026-07-08改訂・
// 事前計算方式）。pre-pushフックから呼ばれ、「data/idea-layouts.jsonの入力ハッシュ ==
// 現在のdata/ideas.json」でなければpushを拒否する（鮮度の機械保証。ビルド時フォールバックで
// 古いレイアウトを黙って使う方が有害という判断のため、フォールバックは作らずここで止める）。
//
// tsx不要（重いTSモジュールをimportしない）: pre-pushの度に毎回走るため、起動コストを
// 最小にする目的でハッシュ計算だけを行うプレーンなNode ESMスクリプトにしている。
//
// 重要: 検査対象は**作業ツリーではなくHEAD（=pushされる中身）**。作業ツリーを読むと
// 「ディスク上は両ファイル更新済みだが、コミットには ideas.json しか入っていない」ケース
// （launchdラッパーの git add 漏れ等）を素通しし、リモート/Vercelビルドが新ideas.json×
// 旧idea-layouts.jsonの不整合ペアになる（2026-07-08レビューで実際に検出した経路）。
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computeIdeaLayoutsInputHash } from "./lib/idea-layouts-hash.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function readFromHead(repoRelPath) {
  return execFileSync("git", ["show", `HEAD:${repoRelPath}`], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024, // idea-layouts.jsonは数MB規模
  });
}

async function main() {
  let ideasRawText;
  let layouts;
  try {
    ideasRawText = readFromHead("data/ideas.json");
    layouts = JSON.parse(readFromHead("data/idea-layouts.json"));
  } catch (e) {
    console.error(`[idea-layouts鮮度検査] HEADのdata/ideas.json / data/idea-layouts.jsonが読めません: ${e.message}`);
    console.error("npx tsx scripts/precompute-idea-layouts.mjs を実行し、生成物を**コミットしてから**再度pushしてください。");
    process.exit(1);
  }
  const expectedHash = computeIdeaLayoutsInputHash(ideasRawText);

  if (layouts.inputHash !== expectedHash) {
    console.error(
      "[idea-layouts鮮度検査] HEADのdata/idea-layouts.json がHEADのdata/ideas.jsonと一致しません（古いレイアウトをpushしようとしています）。",
    );
    console.error(`  期待ハッシュ = ${expectedHash}`);
    console.error(`  記録ハッシュ = ${layouts.inputHash}`);
    console.error("npx tsx scripts/precompute-idea-layouts.mjs を実行し、生成物を**コミットしてから**再度pushしてください。");
    process.exit(1);
  }

  console.log("[idea-layouts鮮度検査] OK: HEADのdata/idea-layouts.json はHEADのdata/ideas.jsonと一致しています。");
}

main().catch((e) => {
  console.error("[idea-layouts鮮度検査] 予期しないエラー:", e.message);
  process.exit(1);
});
