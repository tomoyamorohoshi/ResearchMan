/**
 * index.ts の HTTP ルートの単体テスト（Vite middleware・main()の起動は含めない）。
 *
 * createApp() はルート登録のみを行う express.Express を返す（Vite mount・app.listen・
 * ブラウザ自動起動は main() 側の責務）。テストは実HTTPサーバをephemeralポートで起動し、
 * 生の fetch でSSEストリームを読む（supertest等の新規依存を追加せず、既存の express +
 * Node組み込みfetchだけで完結させる）。
 *
 * P4 #2: GET /api/jobs/:id/stream（SSE進捗）。jobs.ts::updateJob() が subscribeJob() 経由で
 * emitするイベントをそのままSSEフレームとして流す契約を確認する。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "./index.js";
import { updateJob, writeJobFile, type Job } from "./jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_DIR = path.join(__dirname, "..", "workdir", "jobs");

function makeFixtureJob(overrides: Partial<Job> = {}): Job {
  return {
    id: randomUUID(),
    tab: "research",
    request: {},
    status: "running",
    resultCards: [],
    commit: null,
    deployedUrl: null,
    cost: null,
    at: new Date().toISOString(),
    ...overrides,
  };
}

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** `data: {...}\n\n` フレームからJSONを1件読み出す（テスト用の最小SSEパーサ）。 */
async function readNextEvent(reader: ReadableStreamDefaultReader<Uint8Array>, buffer: { text: string }): Promise<Job> {
  const decoder = new TextDecoder();
  while (!buffer.text.includes("\n\n")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("stream ended before an event was received");
    buffer.text += decoder.decode(value, { stream: true });
  }
  const idx = buffer.text.indexOf("\n\n");
  const frame = buffer.text.slice(0, idx);
  buffer.text = buffer.text.slice(idx + 2);
  const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
  if (!dataLine) throw new Error(`no data line in frame: ${frame}`);
  return JSON.parse(dataLine.slice("data: ".length)) as Job;
}

test("GET /api/jobs/:id/stream: 存在しないジョブは404", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/jobs/${randomUUID()}/stream`);
    assert.equal(res.status, 404);
  });
});

test("GET /api/jobs/:id/stream: Content-Typeがtext/event-streamで、接続直後に現在のジョブ状態を1件目として送る", async () => {
  const job = makeFixtureJob({ progress: "収集中" });
  await writeJobFile(job);
  try {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/jobs/${job.id}/stream`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
      const reader = res.body!.getReader();
      const buffer = { text: "" };
      const first = await readNextEvent(reader, buffer);
      assert.equal(first.id, job.id);
      assert.equal(first.progress, "収集中");
      reader.cancel();
    });
  } finally {
    await rm(path.join(JOBS_DIR, `${job.id}.json`), { force: true });
  }
});

test("GET /api/jobs/:id/stream: updateJob()による進捗更新がイベントとして届く（ポーリングではなくpush）", async () => {
  const job = makeFixtureJob({ progress: "収集中" });
  await writeJobFile(job);
  try {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/jobs/${job.id}/stream`);
      const reader = res.body!.getReader();
      const buffer = { text: "" };
      await readNextEvent(reader, buffer); // 初期スナップショット

      await updateJob(job.id, { progress: "検証中" });
      const second = await readNextEvent(reader, buffer);
      assert.equal(second.progress, "検証中");
      assert.equal(second.status, "running");

      reader.cancel();
    });
  } finally {
    await rm(path.join(JOBS_DIR, `${job.id}.json`), { force: true });
  }
});

test("GET /api/jobs/:id/stream: statusが done/error になったらストリームを終了する", async () => {
  const job = makeFixtureJob({ progress: "収集中" });
  await writeJobFile(job);
  try {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/jobs/${job.id}/stream`);
      const reader = res.body!.getReader();
      const buffer = { text: "" };
      await readNextEvent(reader, buffer); // 初期スナップショット

      await updateJob(job.id, { status: "done", progress: undefined, resultCards: [] });
      const final = await readNextEvent(reader, buffer);
      assert.equal(final.status, "done");

      // ストリームがcloseされ、これ以上読めない（done()）ことを確認する
      const { done } = await reader.read();
      assert.equal(done, true, "status=doneの後、サーバがストリームを閉じるはず");
    });
  } finally {
    await rm(path.join(JOBS_DIR, `${job.id}.json`), { force: true });
  }
});

// P4 adversarial-review指摘#1の再発防止（実際に発生した回帰）: 「両方」（combined）ジョブは
// Caseフェーズ完了時、caseResearch.ts::terminalStatus(ownsLock=false, "done") により
// status を "done" ではなく "running" のまま据え置いて書く（combinedResearch.ts::phaseFromJob
// はerrorフィールドで成否を読み取るため、これでも成否は正しく伝わる）。この据え置きが
// 無いと、SSE購読側がCaseフェーズ完了時点のstatus:"done"をジョブ全体の終了と誤認し、
// Techフェーズの結果が届く前にストリームを閉じてしまっていた。
test("GET /api/jobs/:id/stream: 「両方」のCaseフェーズ完了(status維持running)ではストリームを終了せず、最終的な統合結果まで受信できる", async () => {
  const job = makeFixtureJob({
    request: { kind: "両方", theme: "テスト" },
    progress: "収集を開始しています…",
  });
  await writeJobFile(job);
  try {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/jobs/${job.id}/stream`);
      const reader = res.body!.getReader();
      const buffer = { text: "" };
      await readNextEvent(reader, buffer); // 初期スナップショット

      // Caseフェーズ「完了」相当（terminalStatus(false, "done")と同じ書き方）。
      // status は running のまま・resultCards に Case のカードが入る。
      const caseCard = { kind: "case" as const, id: "case-a", url: "https://x/cases/case-a" };
      await updateJob(job.id, { status: "running", progress: undefined, resultCards: [caseCard], commit: "caseHash" });
      const afterCase = await readNextEvent(reader, buffer);
      assert.equal(afterCase.status, "running", "Caseフェーズ完了時点でストリームが終端してはいけない");

      // combinedResearch.ts::TECH_PHASE_RESET_PATCH 相当（Techフェーズ開始前のリセット）。
      await updateJob(job.id, { status: "running", progress: "技術収集を開始しています…", resultCards: [], commit: null });
      const reset = await readNextEvent(reader, buffer);
      assert.equal(reset.status, "running");

      // Techフェーズ「完了」相当（同じくstatus維持running）。
      const techCard = { kind: "tech" as const, id: "tech-b", url: "https://x/technology/tech-b" };
      await updateJob(job.id, { status: "running", progress: undefined, resultCards: [techCard], commit: "techHash" });
      const afterTech = await readNextEvent(reader, buffer);
      assert.equal(afterTech.status, "running", "Techフェーズ完了時点でもまだ終端してはいけない（combinedResearch.tsの最終mergeを待つ）");

      // combinedResearch.ts の最終merge（実際にstatus:"done"になる、ここが唯一の真の終端）。
      await updateJob(job.id, {
        status: "done",
        progress: undefined,
        resultCards: [caseCard, techCard],
        commit: "caseHash / techHash",
      });
      const final = await readNextEvent(reader, buffer);
      assert.equal(final.status, "done");
      assert.deepEqual(final.resultCards, [caseCard, techCard], "Case/Tech両方の結果が最終的に揃って届く");

      const { done } = await reader.read();
      assert.equal(done, true, "最終mergeの後、サーバがストリームを閉じるはず");
    });
  } finally {
    await rm(path.join(JOBS_DIR, `${job.id}.json`), { force: true });
  }
});

// ── AWARDS: pausedの間はSSEストリームを維持する（要件B.3・D） ────────────────

test("GET /api/jobs/:id/stream: status=pausedになってもストリームを閉じない（running同様に維持する）", async () => {
  const job = makeFixtureJob({ tab: "awards", progress: "参照リスト構築中" });
  await writeJobFile(job);
  try {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/jobs/${job.id}/stream`);
      const reader = res.body!.getReader();
      const buffer = { text: "" };
      await readNextEvent(reader, buffer); // 初期スナップショット

      await updateJob(job.id, { status: "paused", pausedReason: "priority-job" });
      const paused = await readNextEvent(reader, buffer);
      assert.equal(paused.status, "paused", "pausedになってもストリームは閉じないはず");

      // pausedから再びrunningへ戻ってもまだ閉じない
      await updateJob(job.id, { status: "running", pausedReason: undefined });
      const resumed = await readNextEvent(reader, buffer);
      assert.equal(resumed.status, "running");

      // 最終的にdoneになったら閉じる
      await updateJob(job.id, { status: "done", progress: undefined, progressPercent: 100 });
      const final = await readNextEvent(reader, buffer);
      assert.equal(final.status, "done");
      const { done } = await reader.read();
      assert.equal(done, true);
    });
  } finally {
    await rm(path.join(JOBS_DIR, `${job.id}.json`), { force: true });
  }
});

test("GET /api/jobs/:id/stream: 既にpaused状態のジョブに接続しても、その時点ではストリームを閉じない", async () => {
  const job = makeFixtureJob({ tab: "awards", status: "paused", pausedReason: "budget" });
  await writeJobFile(job);
  try {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/jobs/${job.id}/stream`);
      const reader = res.body!.getReader();
      const buffer = { text: "" };
      const first = await readNextEvent(reader, buffer);
      assert.equal(first.status, "paused");
      reader.cancel();
    });
  } finally {
    await rm(path.join(JOBS_DIR, `${job.id}.json`), { force: true });
  }
});

test("GET /api/jobs/:id/stream: 既にdone状態のジョブに接続すると初期スナップショット後すぐ終了する", async () => {
  const job = makeFixtureJob({ status: "done", progress: undefined, resultCards: [] });
  await writeJobFile(job);
  try {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/jobs/${job.id}/stream`);
      const reader = res.body!.getReader();
      const buffer = { text: "" };
      const first = await readNextEvent(reader, buffer);
      assert.equal(first.status, "done");
      const { done } = await reader.read();
      assert.equal(done, true);
    });
  } finally {
    await rm(path.join(JOBS_DIR, `${job.id}.json`), { force: true });
  }
});

// ── POST /api/jobs（tab="add-case"。LINEでURLを送ると事例が追加される機能のAPI入口） ──
// 有効なリクエストは実パイプライン（Agent SDK/git/ネットワーク）を起動してしまうため、
// ここではバリデーションエラー（同期的に400で返る）経路のみを確認する
// （jobs.test.ts::createJobの既存方針と同じ。研究/ideaタブも同様に無テスト）。

test("POST /api/jobs: 未知のtabは400", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: "unknown", request: {} }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /add-case/);
  });
});

test("POST /api/jobs: tab=add-caseはurl未指定だと400（実パイプラインは起動しない）", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: "add-case", request: {} }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /URL/);
  });
});

// ── POST /api/jobs（tab="awards"）: 受理経路の確認。有効リクエストは実パイプライン
// （Agent SDK/git/ネットワーク）を起動してしまうため、バリデーションエラー経路のみ確認する
// （add-case/research/ideaと同じ既存方針）。

test("POST /api/jobs: tab=awardsはtabとして受理される（awardName未指定は400で実パイプラインは起動しない）", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: "awards", request: {} }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /アワード名/);
  });
});
