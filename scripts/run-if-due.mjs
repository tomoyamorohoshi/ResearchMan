/**
 * 自動リサーチの実行判定ゲート。
 *
 * launchd は StartInterval で「スリープ/電源OFF中に迎えた実行時刻」を実行しない。
 * そこで launchd 自体は毎時起動（+ ログイン時起動）にして、このゲートが
 * 「前回実行から72時間経過していたら exit 0（=実行）」を判定する。
 * これにより、リサーチ時刻にPCが落ちていても復帰後1時間以内に必ず実行される。
 *
 * exit 0 … 実行してよい（72時間経過 or 記録なし）
 * exit 3 … まだ期限前（呼び出し側はそのまま終了する。ログは出さない＝毎時のスパム防止）
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 引数で状態ファイルと周期を差し替え可能（Technology日次収集が23hゲートで共用）。
// 無引数なら従来どおりCase Study用の72hゲート（後方互換）。
//   例: node scripts/run-if-due.mjs --state .last-tech-research-run.txt --hours 23
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const LAST_RUN_PATH = path.join(__dirname, "..", argOf("--state", ".last-research-run.txt"));

// 毎時チェックの取りこぼしで周期が後ろにずれ続けないよう、公称周期より少し手前で発火させる
const DUE_HOURS = Number(argOf("--hours", "71"));

try {
  const raw = await fs.readFile(LAST_RUN_PATH, "utf-8");
  const last = new Date(raw.trim());
  const hours = (Date.now() - last.getTime()) / (1000 * 60 * 60);
  if (Number.isNaN(hours) || hours >= DUE_HOURS) {
    console.log(`前回実行から${Math.round(hours)}時間経過 → 実行します`);
    process.exit(0);
  }
  process.exit(3);
} catch {
  console.log("実行記録なし → 初回実行します");
  process.exit(0);
}
