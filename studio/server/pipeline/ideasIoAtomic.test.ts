/**
 * scripts/lib/ideas-io.mjs::writeJsonAtomic の書き込み保証を検証する。
 *
 * 背景（件1・データ整合）: studio側のdata/cases.json・data/tech.json・ジョブJSONの書き込みは
 * 従来 fs.writeFile を直接呼んでいたため、書き込み中にプロセスが死ぬとJSONが途中切断され、
 * 以後 JSON.parse が全滅する。ideaResearch.ts:580 は既にこの writeJsonAtomic（temp書き込み→
 * rename）を使っており、addCase.ts/caseResearch.ts/techResearch.ts/jobs.ts::writeJobFile も
 * 同じヘルパー経由に統一した。ここでは全呼び出し元が共有するこの唯一のプリミティブについて、
 * 「書き込み後に読み戻して一致するか」「一時ファイルが残らないか」を確認する
 * （個々のパイプライン（addCase.ts等）はgit操作・Agent SDK呼び出しを大量に伴うため、
 * ユニットテストでは共有ヘルパー側の契約を検証するのが現実的）。
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeJsonAtomic } from "../../../scripts/lib/ideas-io.mjs";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rm-writeJsonAtomic-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("writeJsonAtomic: 書き込み後に読み戻すと同じデータになる", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "cases.json");
    const data = [{ id: "case-1", title: "テスト事例" }];
    await writeJsonAtomic(filePath, data);
    const raw = await readFile(filePath, "utf-8");
    assert.deepEqual(JSON.parse(raw), data);
  });
});

test("writeJsonAtomic: 書き込み後にディレクトリへ一時ファイル(.*.tmp-*)が残らない", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "tech.json");
    await writeJsonAtomic(filePath, [{ id: "tech-1" }]);
    const entries = await readdir(dir);
    assert.deepEqual(entries, ["tech.json"]);
  });
});

test("writeJsonAtomic: 既存ファイルへの再書き込みでも一時ファイルが残らず内容が更新される", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "jobId.json");
    await writeJsonAtomic(filePath, { status: "running" });
    await writeJsonAtomic(filePath, { status: "done" });
    const entries = await readdir(dir);
    assert.deepEqual(entries, ["jobId.json"]);
    const raw = await readFile(filePath, "utf-8");
    assert.deepEqual(JSON.parse(raw), { status: "done" });
  });
});
