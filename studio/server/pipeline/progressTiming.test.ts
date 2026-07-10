/**
 * progressTiming.ts の単体テスト。P4 #6「サーバがフェーズ所要秒をjob JSONに記録
 * （将来のeta.ts calibration用）」のタイミング集計ロジック。now を明示的に渡せるため
 * 実時間待ちなしで決定的にテストできる。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { finishJob, startPhase } from "./progressTiming.js";

test("startPhase: 最初の呼び出しはまだ経過時間が無いので空のdurationsを返す", () => {
  const jobId = randomUUID();
  const durations = startPhase(jobId, "収集中", 1_000);
  assert.deepEqual(durations, {});
});

test("startPhase: 2回目以降は直前フェーズの経過時間が積算される", () => {
  const jobId = randomUUID();
  startPhase(jobId, "収集中", 0);
  const d1 = startPhase(jobId, "検証中", 5_000);
  assert.deepEqual(d1, { 収集中: 5_000 });
  const d2 = startPhase(jobId, "反映中", 8_000);
  assert.deepEqual(d2, { 収集中: 5_000, 検証中: 3_000 });
});

test("startPhase: 同名フェーズに複数回入る場合は積算される（例: リトライ）", () => {
  const jobId = randomUUID();
  startPhase(jobId, "生成中", 0);
  startPhase(jobId, "検証中", 1_000); // 生成中: 1000
  startPhase(jobId, "生成中", 1_500); // 検証中: 500
  const d = startPhase(jobId, "反映中", 3_000); // 生成中 += 1500
  assert.deepEqual(d, { 生成中: 1_000 + 1_500, 検証中: 500 });
});

test("finishJob: 最終フェーズの経過時間も含めて確定値を返す", () => {
  const jobId = randomUUID();
  startPhase(jobId, "収集中", 0);
  startPhase(jobId, "反映中", 4_000);
  const final = finishJob(jobId, 9_000);
  assert.deepEqual(final, { 収集中: 4_000, 反映中: 5_000 });
});

test("finishJob: 呼び出し後は状態がクリアされる（同一jobIdの次回startPhaseはリセットされる）", () => {
  const jobId = randomUUID();
  startPhase(jobId, "収集中", 0);
  finishJob(jobId, 1_000);
  const fresh = startPhase(jobId, "収集中", 5_000);
  assert.deepEqual(fresh, {}, "finishJob後は新しい計測として始まるはず");
});

test("finishJob: 未知のjobId（startPhase未呼び出し）は空オブジェクトを返し例外にしない", () => {
  const jobId = randomUUID();
  assert.deepEqual(finishJob(jobId, 1_000), {});
});

test("startPhase/finishJob: 異なるjobIdの計測は独立している（並行ジョブでも混線しない）", () => {
  const jobA = randomUUID();
  const jobB = randomUUID();
  startPhase(jobA, "A収集", 0);
  startPhase(jobB, "B収集", 100);
  startPhase(jobA, "A反映", 2_000);
  const finalA = finishJob(jobA, 3_000);
  const finalB = finishJob(jobB, 900);
  assert.deepEqual(finalA, { A収集: 2_000, A反映: 1_000 });
  assert.deepEqual(finalB, { B収集: 800 });
});
