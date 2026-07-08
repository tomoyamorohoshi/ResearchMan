/**
 * scripts/lib/log-health.mjs のスモークテスト。
 *
 * ~/Library/Logs/researchman-*.log の実ログ抜粋（このリポジトリで実際に出力される
 * 開始マーカー・完了マーカー文字列）を fixture として、parseJobRuns / filterRecentRuns /
 * hasConsecutiveOutcome / countTodayRejections を検証する。ファイルI/O以外は副作用なし。
 *
 * 使い方: node scripts/smoke-watchdog-log-health.mjs
 */
import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import {
  parseJobRuns,
  filterRecentRuns,
  hasConsecutiveOutcome,
  countTodayRejections,
  readLogSafe,
} from "./lib/log-health.mjs";

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

// ── fixture: 実ログ抜粋（researchman-tech.log の実出力。成功1回+収集エラー0件パターン混在） ──
const TECH_LOG_SAMPLE = `本日10時0分の実行時刻を経過・本日分は未実行 → 実行します
===== Tech run start: Tue Jul  7 10:00:01 JST 2026 =====
X radar素材: 11件をプロンプトに挿入
── ラウンド 1/2: 発見フェーズ ──
候補: 1件
[verify-deploy] ✓ 反映確認（試行1回目）: push landed / home 200 / thumbs一致 / 新規ページ0件 200
[verify-tech] ✓ 全ページ200（試行6回目）: /technology/comfyui-ttp-toolset-smart-tile-2-0
反映まで確認OK: Tue Jul  7 10:43:30 JST 2026
Tech completed: Tue Jul  7 10:43:30 JST 2026
本日10時0分の実行時刻を経過・本日分は未実行 → 実行します
===== Tech run start: Wed Jul  8 10:00:01 JST 2026 =====
── ラウンド 1/2: 発見フェーズ ──
候補: 0件
── ラウンド 2/2: 発見フェーズ ──
発見フェーズ失敗: Claude CLI エラー: spawnSync /Users/tm/.local/bin/claude ETIMEDOUT
本日の新規候補なし
変更なし（新規技術なし）: Wed Jul  8 10:16:05 JST 2026
Tech completed: Wed Jul  8 10:16:06 JST 2026
`;

// ── fixture: 直近2run連続errorを模したログ（Case Study収集想定） ──
const CC_LOG_CONSECUTIVE_ERROR = `===== Run start: Mon Jul  6 10:00:01 JST 2026 =====
発見フェーズ失敗: Claude CLI エラー: spawnSync ETIMEDOUT
収集エラー終了: Mon Jul  6 10:05:00 JST 2026
Completed: Mon Jul  6 10:05:00 JST 2026
===== Run start: Tue Jul  7 10:00:02 JST 2026 =====
発見フェーズ失敗: Claude CLI エラー: spawnSync ETIMEDOUT
収集エラー終了: Tue Jul  7 10:05:01 JST 2026
Completed: Tue Jul  7 10:05:01 JST 2026
===== Run start: Wed Jul  8 10:00:03 JST 2026 =====
発見フェーズ失敗: Claude CLI エラー: spawnSync ETIMEDOUT
収集エラー終了: Wed Jul  8 10:05:02 JST 2026
Completed: Wed Jul  8 10:05:02 JST 2026
`;

check("parseJobRuns: 空文字列は空配列", () => {
  assert.deepStrictEqual(parseJobRuns(""), []);
  assert.deepStrictEqual(parseJobRuns(null), []);
});

check("parseJobRuns: Tech runログを2run・outcome success/zeroに分類", () => {
  const runs = parseJobRuns(TECH_LOG_SAMPLE);
  assert.strictEqual(runs.length, 2, `2run想定だが${runs.length}件: ${JSON.stringify(runs)}`);
  assert.strictEqual(runs[0].outcome, "success");
  assert.strictEqual(runs[1].outcome, "zero");
  assert.ok(runs[0].startedAt instanceof Date && !Number.isNaN(runs[0].startedAt.getTime()), "startedAtがDateとしてパースされること");
});

check("parseJobRuns: 収集エラー終了マーカーをerrorに分類", () => {
  const runs = parseJobRuns(CC_LOG_CONSECUTIVE_ERROR);
  assert.strictEqual(runs.length, 3);
  assert.ok(runs.every((r) => r.outcome === "error"), `全runがerror想定: ${JSON.stringify(runs)}`);
});

check("hasConsecutiveOutcome: 直近2run連続errorを検知", () => {
  const runs = parseJobRuns(CC_LOG_CONSECUTIVE_ERROR);
  assert.strictEqual(hasConsecutiveOutcome(runs, "error", 2), true);
  assert.strictEqual(hasConsecutiveOutcome(runs, "error", 3), true);
  assert.strictEqual(hasConsecutiveOutcome(runs, "success", 2), false);
});

check("hasConsecutiveOutcome: run数がcountに満たない場合はfalse", () => {
  const runs = parseJobRuns(TECH_LOG_SAMPLE); // successの後にzero→末尾2件は success,zero で連続一致しない
  assert.strictEqual(hasConsecutiveOutcome(runs, "error", 5), false);
  assert.strictEqual(hasConsecutiveOutcome(runs, "zero", 2), false);
});

check("filterRecentRuns: sinceMsより古いrunを除外する", () => {
  const now = Date.now();
  const runs = [
    { startedAt: new Date(now - 10 * 24 * 3600 * 1000), outcome: "success" }, // 10日前
    { startedAt: new Date(now - 1 * 3600 * 1000), outcome: "error" }, // 1時間前
    { startedAt: null, outcome: "unknown" },
  ];
  const recent = filterRecentRuns(runs, 2 * 24 * 3600 * 1000); // 直近2日
  assert.strictEqual(recent.length, 1);
  assert.strictEqual(recent[0].outcome, "error");
});

check("readLogSafe: 存在しないファイルは空文字（例外を投げない）", () => {
  assert.strictEqual(readLogSafe("/tmp/researchman-watchdog-smoke-nonexistent.log"), "");
});

check("countTodayRejections: 存在しないディレクトリ/ファイルは0（例外を投げない）", () => {
  assert.strictEqual(countTodayRejections("/tmp/researchman-watchdog-smoke-nonexistent-dir"), 0);
});

check("countTodayRejections: 本日分の行だけをカウントする", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "researchman-watchdog-smoke-"));
  const month = new Date().toISOString().slice(0, 7);
  const todayIso = new Date().toISOString();
  const yesterdayIso = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const file = path.join(tmpDir, `rejections-${month}.jsonl`);
  const lines = [
    { date: todayIso, pipeline: "cc", title: "A", reason: "link-dead" },
    { date: todayIso, pipeline: "cc", title: "B", reason: "thumbnail-unavailable" },
    { date: yesterdayIso, pipeline: "cc", title: "C", reason: "link-dead" },
    "not-json-should-be-skipped",
  ];
  fs.writeFileSync(file, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
  assert.strictEqual(countTodayRejections(tmpDir), 2);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

console.log(`\n${passed}件PASS`);
if (process.exitCode) {
  console.error("FAIL: 上記のテストが失敗しました");
} else {
  console.log("ALL PASS");
}
