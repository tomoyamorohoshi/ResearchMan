/**
 * リサーチの仕組みの健全性レビューCLI。
 *   node scripts/research-health.mjs [--llm] [--dry-run]
 * --dry-run: ファイルを書かず標準出力のみ。--llm: 週1回のAIレビュー（Claude sonnet・ツールなし）も実行。
 * 出力: logs/research-health-latest.md、high/med は logs/system-alerts.jsonl に追記（LINE送信はしない）。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runResearchHealthReview } from "./lib/research-health.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const { findings, markdown, written } = await runResearchHealthReview({ root, llm: args.has("--llm"), dryRun });
console.log(markdown);
console.log(dryRun ? "[research-health] --dry-run: ファイルは書いていません" : `[research-health] 書き込み: ${written.markdown} / system-alerts 追記 ${written.alerts}件`);
console.log(`[research-health] findings=${findings.length}`);
