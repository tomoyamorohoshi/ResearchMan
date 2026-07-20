// scripts/lib/studio-verify.mjs の純関数部分の単体テスト（node:test）。
// 実CLI呼び出し・実HTTP通信を含む runDeepVerification() 自体はここではテストしない
// （fixtureのみで判定ロジックを検証する。log-health.mjs/quarantine.mjs と同じ方針）。
// 実行: node --test scripts/lib/studio-verify.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyHttpCheck, classifyTaskState, buildDeepVerificationReport } from "./studio-verify.mjs";

test("classifyHttpCheck: statusがexpectedと一致すればok=true", () => {
  const c = classifyHttpCheck("GET /api/jobs", 200, 200);
  assert.equal(c.ok, true);
  assert.equal(c.label, "GET /api/jobs");
});

test("classifyHttpCheck: statusが不一致ならok=false", () => {
  assert.equal(classifyHttpCheck("POST /line-webhook", 500, 401).ok, false);
  assert.equal(classifyHttpCheck("GET /api/jobs", 0, 200).ok, false); // 接続失敗はstatus=0想定
});

// タスク状態は `schtasks /query /fo LIST /v` のテキスト出力ではなく、PowerShellの
// Get-ScheduledTask の .State.ToString()（Ready/Disabled/Running/Queued/Unknownという
// カルチャ非依存のenum文字列）から判定する。
// 実機検証で判明: 日本語ロケールWindows上で `spawnSync("schtasks", [...], {encoding:"utf-8"})`
// を呼ぶと、schtasksがOEMコードページ(cp932)で出す項目名（"タスク名:"等）をNodeがUTF-8として
// 強制デコードし文字化けする。結果、英語ラベル固定の正規表現が一致せず、実際は有効な
// タスクでも「無効」と誤判定していた（本番環境で実測: 2タスクとも有効なのに両方falseと出た）。
// netstat側のSTATE列（LISTENING/ESTABLISHED等）はローカライズされない技術用語のため
// この問題は起きない（実測確認済み）。
const TASK_QUERY_ENABLED = "Ready";
const TASK_QUERY_DISABLED = "Disabled";

test("classifyTaskState: Ready(有効)ならexists=true, enabled=true, ok=true", () => {
  const r = classifyTaskState("ResearchMan-Studio", TASK_QUERY_ENABLED);
  assert.deepEqual(r, { name: "ResearchMan-Studio", exists: true, enabled: true, ok: true });
});

test("classifyTaskState: Running(実行中)もenabled=true扱い（Disabled以外はすべて有効側）", () => {
  const r = classifyTaskState("ResearchMan-Studio", "Running");
  assert.deepEqual(r, { name: "ResearchMan-Studio", exists: true, enabled: true, ok: true });
});

test("classifyTaskState: Disabled(無効)ならok=false", () => {
  const r = classifyTaskState("ResearchMan-studiokeeper", TASK_QUERY_DISABLED);
  assert.deepEqual(r, { name: "ResearchMan-studiokeeper", exists: true, enabled: false, ok: false });
});

test("classifyTaskState: NOT_FOUND（未登録）センチネルはexists=false, ok=false", () => {
  const r = classifyTaskState("ResearchMan-NoSuchTask", "NOT_FOUND");
  assert.deepEqual(r, { name: "ResearchMan-NoSuchTask", exists: false, enabled: false, ok: false });
});

test("classifyTaskState: 空文字・前後空白のみもexists=false扱い（例外を投げない）", () => {
  assert.equal(classifyTaskState("x", "").exists, false);
  assert.equal(classifyTaskState("x", "  \n").exists, false);
  assert.equal(classifyTaskState("x", undefined).exists, false);
});

test("buildDeepVerificationReport: 全okなら「すべて正常」を含む", () => {
  const text = buildDeepVerificationReport([
    { label: "a", ok: true },
    { label: "b", ok: true },
  ]);
  assert.match(text, /すべて正常/);
  assert.match(text, /✅ a/);
  assert.match(text, /✅ b/);
});

test("buildDeepVerificationReport: 1件でもng含めば「異常」を含む", () => {
  const text = buildDeepVerificationReport([
    { label: "a", ok: true },
    { label: "b", ok: false },
  ]);
  assert.match(text, /異常/);
  assert.match(text, /❌ b/);
});
