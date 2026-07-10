/**
 * clampCount の軽量ユニットテスト（node:test、tsx経由で実行）。
 * P0はUI/配線が主体でロジックのテスト比重は低いが、件数の範囲外入力の
 * 扱いは型のある明確なロジックなのでカバーしておく。
 *
 * getJob/listJobs のテストは、adversarial-reviewer指摘（パス・トラバーサル
 * 脆弱性・壊れたJSONでのlistJobs全滅）の再発防止用。
 *
 * research/idea どちらも、正常系（有効リクエスト）は createJob 内部で実際に
 * Agent SDK パイプラインをバックグラウンド起動し、idea側はP3以降 data/ideas.json への
 * 書き込み〜git pushまで走ってしまう（adversarial-reviewer指摘: P3で
 * `createJob("idea", { count: 1 })` を使うround-trip/壊れJSON耐性テストにテーマを
 * 足しただけの「修正」は本番pushを誘発するため絶対に不可）。
 * ここで見るのは同期的に投げられるバリデーションエラーのみ。round-trip/壊れJSON耐性の
 * 確認は、パイプラインを経由しない `writeJobFile` で直接ジョブJSONを用意して行う
 * （検証したいのは「ジョブJSONの永続化と読み出し」であってパイプラインの起動ではない）。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clampCount, createJob, getJob, listJobs, writeJobFile, ValidationError, type Job } from "./jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_DIR = path.join(__dirname, "..", "workdir", "jobs");

/** パイプラインを起動せず、ジョブJSONの永続化(writeJobFile)だけを検証するためのfixture。 */
function makeFixtureJob(overrides: Partial<Job> = {}): Job {
  return {
    id: randomUUID(),
    tab: "idea",
    request: {},
    status: "done",
    resultCards: [],
    commit: null,
    deployedUrl: null,
    cost: null,
    at: new Date().toISOString(),
    ...overrides,
  };
}

test("clampCount: 範囲内の数値はそのまま", () => {
  assert.equal(clampCount(5, 1, 8, 8), 5);
});

test("clampCount: 文字列の数値も変換される", () => {
  assert.equal(clampCount("3", 1, 8, 8), 3);
});

test("clampCount: 上限超えはmaxにクランプ", () => {
  assert.equal(clampCount(100, 1, 8, 8), 8);
});

test("clampCount: 下限未満(0以下)はminにクランプ", () => {
  assert.equal(clampCount(0, 1, 8, 8), 1);
  assert.equal(clampCount(-5, 1, 8, 8), 1);
});

test("clampCount: NaN/未指定/非数値文字列はfallback", () => {
  assert.equal(clampCount(undefined, 1, 8, 8), 8);
  assert.equal(clampCount("abc", 1, 8, 8), 8);
  assert.equal(clampCount(NaN, 1, 8, 8), 8);
});

test("clampCount: 小数は丸められる", () => {
  assert.equal(clampCount(3.6, 1, 8, 8), 4);
});

test("clampCount: idea用の範囲(1〜6)でも動く", () => {
  assert.equal(clampCount(10, 1, 6, 6), 6);
  assert.equal(clampCount("2", 1, 6, 6), 2);
});

test("getJob: パス・トラバーサル(../../../package)はnullを返す（例外を投げない）", async () => {
  const result = await getJob("../../../package");
  assert.equal(result, null);
});

test("getJob: パス・トラバーサル(../../package.json)もnullを返す", async () => {
  const result = await getJob("../../package.json");
  assert.equal(result, null);
});

test("getJob: 正常なUUID形式のidは既存どおり取得できる（回帰確認）", async () => {
  // createJobは使わない（idea/researchとも有効リクエストは実パイプラインを起動してしまう）。
  // writeJobFileで直接ジョブJSONを永続化し、getJobのround-tripだけを検証する。
  const job = makeFixtureJob();
  await writeJobFile(job);
  try {
    const found = await getJob(job.id);
    assert.ok(found);
    assert.equal(found?.id, job.id);
  } finally {
    await rm(path.join(JOBS_DIR, `${job.id}.json`), { force: true });
  }
});

test("createJob: research + Technology種別はValidationErrorでP2案内", async () => {
  await assert.rejects(
    () => createJob("research", { kind: "Technology", theme: "AI" }),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      assert.match((err as Error).message, /P2/);
      return true;
    },
  );
});

test("createJob: research + テーマ空はValidationError", async () => {
  await assert.rejects(
    () => createJob("research", { kind: "Case Study", theme: "" }),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      return true;
    },
  );
});

test("createJob: idea + お題空はValidationError（実パイプラインを起動しない）", async () => {
  await assert.rejects(
    () => createJob("idea", { count: 1 }), // themeを与えない = validateIdeaRequestで弾かれるはず
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      assert.match((err as Error).message, /お題/);
      return true;
    },
  );
});

test("getJob: UUID形式に一致しないidは存在有無に関わらずnullを返す", async () => {
  const result = await getJob("not-a-uuid");
  assert.equal(result, null);
});

test("listJobs: 壊れたJSONファイルが1件混ざっていても残りの正常なジョブを返す", async () => {
  await mkdir(JOBS_DIR, { recursive: true });
  const good = makeFixtureJob();
  await writeJobFile(good);
  const brokenPath = path.join(JOBS_DIR, "broken-test-fixture.json");
  await writeFile(brokenPath, "{ this is not valid json", "utf-8");
  try {
    const jobs = await listJobs();
    assert.ok(jobs.some((j) => j.id === good.id));
  } finally {
    await rm(brokenPath, { force: true });
    await rm(path.join(JOBS_DIR, `${good.id}.json`), { force: true });
  }
});
