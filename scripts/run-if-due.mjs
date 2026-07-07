/**
 * 自動リサーチの実行判定ゲート。
 *
 * launchd の StartCalendarInterval は「スリープ/電源OFF中に迎えた実行時刻」を確実には
 * 実行しない。そこで launchd は 10:00〜23:00 の毎正時に起動し、このゲートが
 * 「本日の実行時刻(10時)を過ぎていて、かつ本日分が未実行なら exit 0（=実行）」を判定する。
 * これにより、10時にPCが落ちていても復帰後の次の正時に必ずキャッチアップされ、
 * 1日1回を超えて走ることもない。
 *
 * モード:
 *   --daily-at <hour>       … 毎日<hour>時の日次ゲート（Case Study / Technology の現行運用）
 *   --minute <n>            … --daily-at の分（既定0。隔週チューンアップの08:30等に使う）
 *   --monthly-days <csv>    … --daily-at と併用し「その月内の指定日のみ」に絞る
 *                              （例: --monthly-days 1,15。隔週チューンアップ用。既存の日次ジョブは未使用）
 *   --hours <n>             … 前回実行から<n>時間経過で発火する周期ゲート（旧方式）
 *   --mark                  … 判定せず「今実行した」と記録して exit 0（エラー時に本日分を消化扱いにする用）
 *   --state <file>          … 状態ファイル（リポジトリルートからの相対）。既定 .last-research-run.txt
 *
 * exit 0 … 実行してよい / exit 3 … まだ期限前・対象日でない（ログは出さない＝スパム防止）
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const LAST_RUN_PATH = path.join(__dirname, "..", argOf("--state", ".last-research-run.txt"));

// ── --mark: 実行記録の強制更新（収集スクリプトがクラッシュした回を「本日実行済み」扱いにし、
//    毎正時のリトライでClaude CLIとLINE通知を連打しないための安全弁） ──
if (args.includes("--mark")) {
  await fs.writeFile(LAST_RUN_PATH, new Date().toISOString());
  console.log(`実行記録を更新: ${LAST_RUN_PATH}`);
  process.exit(0);
}

// ── --daily-at: 毎日<hour>時の日次ゲート（--monthly-days併用で「特定の日だけ」に絞れる） ──
const dailyAt = argOf("--daily-at", null);
if (dailyAt !== null) {
  const hour = Number(dailyAt);
  if (Number.isNaN(hour) || hour < 0 || hour > 23) {
    console.error(`--daily-at の値が不正: ${dailyAt}`);
    process.exit(2);
  }
  const minute = Number(argOf("--minute", "0"));
  if (Number.isNaN(minute) || minute < 0 || minute > 59) {
    console.error(`--minute の値が不正: ${argOf("--minute", "0")}`);
    process.exit(2);
  }
  const now = new Date();
  const monthlyDaysArg = argOf("--monthly-days", null);
  if (monthlyDaysArg) {
    const days = monthlyDaysArg.split(",").map((s) => Number(s.trim()));
    if (!days.includes(now.getDate())) process.exit(3); // 対象日でない
  }
  const dueToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0);
  if (now < dueToday) process.exit(3); // 本日の実行時刻前
  try {
    const raw = await fs.readFile(LAST_RUN_PATH, "utf-8");
    const last = new Date(raw.trim());
    if (!Number.isNaN(last.getTime()) && last >= dueToday) process.exit(3); // 本日分は実行済み
  } catch {}
  console.log(`本日${hour}時${minute}分の実行時刻を経過・本日分は未実行 → 実行します`);
  process.exit(0);
}

// ── --hours: 周期ゲート（旧方式・後方互換） ──
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
