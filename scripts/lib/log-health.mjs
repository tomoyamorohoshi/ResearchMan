/**
 * パイプラインログの健全性解析（scripts/watchdog.mjs 用の共有ロジック）。
 *
 * ~/Library/Logs/researchman-auto.log（Windowsでは %USERPROFILE%\.researchman\logs\
 * researchman-auto.log。scripts/windows/run-job.mjs が同じファイル名規則で書く）等は
 * 各jobの開始マーカー行（"===== Run start:" 等）で区切られている。このモジュールは
 * ログ本文を「run単位」に分割し、既知の日本語マーカー文字列（実ログから採取済み。
 * 一字一句そのまま）でoutcomeを分類する。
 * 全関数は例外を投げない設計（ファイル無し/読めない場合は空扱い）。
 */
import fs from "fs";
import os from "os";
import path from "path";

const START_MARKERS = [
  /^===== Run start:/,
  /^===== Tech run start:/,
  /^===== Idea seeds start:/,
  /^===== Tuneup start:/,
  /^===== Watchdog start/,
];

function isStartLine(line) {
  return START_MARKERS.some((re) => re.test(line));
}

// "===== Run start: Wed Jul  8 10:00:01 JST 2026 =====" のようなマーカー行から
// 日時文字列を取り出しDateへ変換する。タイムゾーン略称(JST等)はNodeのDate.parseが
// 認識できないため取り除く（このマシンは常にJST=Asia/Tokyoで動くので、略称を除いて
// ローカル時刻としてparseすれば実時刻と一致する）。パース失敗はnull。
function parseLogDate(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+[A-Z]{2,5}\s+(\d{4})\s*$/, " $1");
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d;
}

// outcome判定マーカー（実ログから採取済みの文字列。一字一句そのまま使う）。
// 優先順位あり: 1つのrunブロックに複数該当しても最初に一致した種別を採用する
// （各パイプラインのシェル分岐は排他的なので通常は1種別のみヒットする）。
const OUTCOME_MARKERS = [
  { outcome: "error", strings: ["収集エラー終了", "生成エラー終了", "チューンアップエラー終了", "watchdogエラー終了"] },
  {
    outcome: "zero",
    strings: [
      "変更なし（新規事例なし）",
      "変更なし（新規技術なし）",
      "ideas.json変更なし（追記対象なし）",
      "変更なし（分析結果は現状維持",
    ],
  },
  { outcome: "success", strings: ["反映まで確認OK", "ideas.json push成功"] },
  { outcome: "unverified", strings: ["push成功だが反映未確認（時間切れ）"] },
  { outcome: "pushfail", strings: ["push失敗（pre-push監査で中止の可能性）"] },
];

function classifyOutcome(blockText) {
  for (const { outcome, strings } of OUTCOME_MARKERS) {
    if (strings.some((s) => blockText.includes(s))) return outcome;
  }
  return "unknown";
}

// ログ本文を開始マーカー行で run 単位に分割し、各runの開始時刻とoutcomeを返す。
// 開始マーカーが1つも無ければ空配列（期限前スキップのみのログ等）。
export function parseJobRuns(logText) {
  if (!logText) return [];
  const lines = logText.split("\n");
  const startIdxs = [];
  lines.forEach((l, i) => {
    if (isStartLine(l)) startIdxs.push(i);
  });
  if (!startIdxs.length) return [];

  const runs = [];
  for (let k = 0; k < startIdxs.length; k++) {
    const start = startIdxs[k];
    const end = k + 1 < startIdxs.length ? startIdxs[k + 1] : lines.length;
    const blockLines = lines.slice(start, end);
    const blockText = blockLines.join("\n");
    const dateMatch = blockLines[0].match(/:\s*([A-Za-z]{3}\s+[A-Za-z]{3}.*?)\s*=====\s*$/);
    const startedAt = dateMatch ? parseLogDate(dateMatch[1]) : null;
    runs.push({ startedAt, outcome: classifyOutcome(blockText) });
  }
  return runs;
}

// startedAtが直近sinceMsミリ秒以内のrunだけを残す。startedAtが取れなかった(null)runは
// 鮮度判定できないため除外する（誤って古いrunを「直近」扱いしない安全側の判断）。
export function filterRecentRuns(runs, sinceMs) {
  const cutoff = Date.now() - sinceMs;
  return (runs || []).filter((r) => r.startedAt instanceof Date && r.startedAt.getTime() >= cutoff);
}

// 直近（配列末尾）からcount件連続で同一outcomeが続いているか。
// runs配列は古い→新しい順（ログの出現順）を前提とする。
export function hasConsecutiveOutcome(runs, outcome, count) {
  if (!runs || runs.length < count) return false;
  const tail = runs.slice(-count);
  return tail.every((r) => r.outcome === outcome);
}

// logs/rejections-YYYY-MM.jsonl（存在すれば）から本日分の件数を数える。
// ファイル無し・ディレクトリ無し・JSON解析失敗行は無視して0扱い（例外を投げない）。
export function countTodayRejections(logsDir) {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const file = path.join(logsDir, `rejections-${month}.jsonl`);
    if (!fs.existsSync(file)) return 0;
    const text = fs.readFileSync(file, "utf-8");
    const todayStr = new Date().toISOString().slice(0, 10);
    let count = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (typeof entry.date === "string" && entry.date.slice(0, 10) === todayStr) count++;
      } catch {
        // JSON以外の行は無視
      }
    }
    return count;
  } catch {
    return 0;
  }
}

// researchman-<name>.log を安全に読む（無ければ空文字。例外を投げない）。
export function readLogSafe(logPath) {
  try {
    return fs.readFileSync(logPath, "utf-8");
  } catch {
    return "";
  }
}

// job種別 → 標準ログパスの対応（watchdog.mjsから使う）。
// macOS: ~/Library/Logs/researchman-<name>.log（launchd plistのStandardOutPathと同じ）
// それ以外（Windows等）: ~/.researchman/logs/researchman-<name>.log
//   （scripts/windows/run-job.mjs が同じ規則でログを書く。ジョブ名の短縮形
//   auto/tech/ideas/tuneup/watchdog もplist時代の命名をそのまま踏襲する）
export function defaultLogPath(name) {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Logs", `researchman-${name}.log`);
  }
  return path.join(os.homedir(), ".researchman", "logs", `researchman-${name}.log`);
}
