/**
 * pipeline/jobQueue.ts の単体テスト。
 *
 * 重要な制約（タスク指示・jobs.test.tsの既存注意書きと同じ理由）: startQueueWorker()
 * （実タイマー版）はここでは呼ばない。setTimeoutのtimerが残るとNodeのテストプロセスが
 * ハングしうるため。processQueueOnce()は「lockが埋まっている(busy)」「対応ジョブが
 * 存在しない/status不一致(skipped)」「キューが空(empty)」の経路のみをテストし、実際に
 * パイプラインを起動する"dispatched"経路には至らないよう組み立てる（実パイプライン起動は
 * Claude Agent SDK/git/ネットワークを叩くため単体テストで踏んではいけない）。
 *
 * FIFO順序・復元順序(recoverQueueOnStartupのsort)は enqueueJob/queueSnapshot/
 * writeJobFile だけで検証できる。recoverQueueOnStartupのテストは、キューに積んだ後
 * processQueueOnce等で消費させない（=このファイル内で最後に置く。同一プロセス内の
 * 他テストへ「消費されない実ジョブが混入したまま残る」影響を避けるため、対象ジョブ
 * ファイルはテスト内で確実にrm済みにする＝仮に後で誰かがdrainしてもgetJobがnullを返し
 * "skipped"にしかならない）。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { writeJobFile, type Job } from "../jobs.js";
import { DEFAULT_LOCK_PATH } from "./lock.js";
import { enqueueJob, processQueueOnce, queueSnapshot, recoverQueueOnStartup } from "./jobQueue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// jobQueue.test.ts は server/pipeline/ に置かれる（server/直下のjobs.test.tsより1階層深い）ため、
// jobs.ts::JOBS_DIR（server/../workdir/jobs = studio/workdir/jobs）と揃えるには ".." が1つ多く要る。
const JOBS_DIR = path.join(__dirname, "..", "..", "workdir", "jobs");

function makeFixtureJob(overrides: Partial<Job> = {}): Job {
  return {
    id: randomUUID(),
    tab: "idea",
    request: {},
    status: "queued",
    resultCards: [],
    commit: null,
    deployedUrl: null,
    cost: null,
    at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * 他テスト（このファイル内）の残骸を掃除する。このファイルで積まれる残骸は常に
 * 「対応するジョブファイルが存在しない」か「statusがqueuedでない」ものだけになるよう
 * 各テストが設計されているため、ここでのprocessQueueOnce呼び出しは実パイプラインを
 * 起動しない（"busy"のときは無理に空にせずそのまま返す）。
 */
async function drainQueue(): Promise<void> {
  for (;;) {
    const result = await processQueueOnce();
    if (result === "empty" || result === "busy") return;
  }
}

test("enqueueJob/queueSnapshot: FIFO順で積まれる", async () => {
  await drainQueue();
  const a = randomUUID();
  const b = randomUUID();
  const c = randomUUID();
  enqueueJob(a);
  enqueueJob(b);
  enqueueJob(c);
  assert.deepEqual(queueSnapshot(), [a, b, c]);
  await drainQueue(); // 後片付け（いずれもファイル無し=skippedとして消費される）
});

test("processQueueOnce: キューが空なら'empty'を返す", async () => {
  await drainQueue();
  assert.equal(await processQueueOnce(), "empty");
});

test("processQueueOnce: lockが埋まっていれば'busy'を返し、先頭をshiftしない", async () => {
  await drainQueue();
  const fakeId = randomUUID();
  enqueueJob(fakeId);
  mkdirSync(DEFAULT_LOCK_PATH);
  try {
    const result = await processQueueOnce();
    assert.equal(result, "busy");
    assert.ok(queueSnapshot().includes(fakeId), "busyのときは先頭をshiftしてはいけない");
  } finally {
    rmSync(DEFAULT_LOCK_PATH, { recursive: true, force: true });
  }
  await drainQueue(); // lock解放後にfakeIdを片付ける（ファイル無し=skipped）
});

test("processQueueOnce: 対応するジョブファイルが存在しなければ'skipped'を返し、キューからは取り除く", async () => {
  await drainQueue();
  const missingId = randomUUID(); // writeJobFileしない = 存在しないジョブ
  enqueueJob(missingId);
  const result = await processQueueOnce();
  assert.equal(result, "skipped");
  assert.ok(!queueSnapshot().includes(missingId), "skippedでもキューからは取り除かれるはず");
});

test("processQueueOnce: ジョブのstatusが'queued'でなければ'skipped'を返す（実パイプラインは起動しない）", async () => {
  await drainQueue();
  const job = makeFixtureJob({ status: "done" });
  await writeJobFile(job);
  enqueueJob(job.id);
  try {
    const result = await processQueueOnce();
    assert.equal(result, "skipped");
  } finally {
    await rm(path.join(JOBS_DIR, `${job.id}.json`), { force: true });
  }
});

// ── recoverQueueOnStartup（サーバ起動時の復元）。このファイル内で最後に置く: ────────
// キューに積んだ後は消費させず、対象ジョブファイルを確実にrmしてから終える
// （後でこのファイル内の他テストがdrainしても、getJobがnullを返すため"skipped"にしかならない）。

test("recoverQueueOnStartup: status='queued'のジョブをat昇順でキューに積む", async () => {
  await drainQueue();
  const older = makeFixtureJob({ status: "queued", at: "2026-01-01T00:00:00.000Z" });
  const newer = makeFixtureJob({ status: "queued", at: "2026-01-02T00:00:00.000Z" });
  // 書き込み順をわざと逆にして、sortが効いていることを確認する
  await writeJobFile(newer);
  await writeJobFile(older);
  try {
    await recoverQueueOnStartup();
    const snapshot = queueSnapshot();
    const olderIdx = snapshot.indexOf(older.id);
    const newerIdx = snapshot.indexOf(newer.id);
    assert.ok(olderIdx !== -1 && newerIdx !== -1, "両方ともキューに積まれているはず");
    assert.ok(olderIdx < newerIdx, "at昇順（古い方が先）でキューに積まれるはず");
  } finally {
    await rm(path.join(JOBS_DIR, `${older.id}.json`), { force: true });
    await rm(path.join(JOBS_DIR, `${newer.id}.json`), { force: true });
  }
});

test("recoverQueueOnStartup: status='running'かつtab!=='awards'の孤児ジョブをerrorへ落とす（awardsは触らない）", async () => {
  await drainQueue();
  const orphanedResearch = makeFixtureJob({ tab: "research", status: "running", request: { kind: "Case Study" } });
  const orphanedAwards = makeFixtureJob({ tab: "awards", status: "running" });
  await writeJobFile(orphanedResearch);
  await writeJobFile(orphanedAwards);
  try {
    await recoverQueueOnStartup();
    const { getJob } = await import("../jobs.js");
    const afterResearch = await getJob(orphanedResearch.id);
    const afterAwards = await getJob(orphanedAwards.id);
    assert.equal(afterResearch?.status, "error");
    assert.match(afterResearch?.error ?? "", /再起動/);
    assert.equal(afterAwards?.status, "running", "awardsは孤児回収の対象外（recoverAwardJobsOnStartupが別途処理する）");
  } finally {
    await rm(path.join(JOBS_DIR, `${orphanedResearch.id}.json`), { force: true });
    await rm(path.join(JOBS_DIR, `${orphanedAwards.id}.json`), { force: true });
  }
});
