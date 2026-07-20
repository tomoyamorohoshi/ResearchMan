/**
 * debugDump.ts::dumpAgentDebug のテスト（node:test）。
 *
 * job 66218d63の死因対策: パース失敗したAgent生出力をどこにも保存せず捨てていたため
 * 死因特定が不可能だった。studio/workdir/debug/<jobId>-<label>.txt へ保存するヘルパーの
 * 契約（保存先パス・mkdir recursive・同名上書き）をテストする
 * （ideasIoAtomic.test.ts と同じ一時ディレクトリ方式）。
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dumpAgentDebug } from "./debugDump.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rm-dumpAgentDebug-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("dumpAgentDebug: workdir/debug/<jobId>-<label>.txt へ保存し、そのパスを返す", async () => {
  await withTempDir(async (workdir) => {
    const savedPath = await dumpAgentDebug(workdir, "job-123", "writer-chunk-0", "生テキスト出力");
    assert.equal(savedPath, path.join(workdir, "debug", "job-123-writer-chunk-0.txt"));
    assert.ok(savedPath);
    const content = await readFile(savedPath, "utf-8");
    assert.equal(content, "生テキスト出力");
  });
});

test("dumpAgentDebug: debugディレクトリが無くてもmkdir recursiveで作成される", async () => {
  await withTempDir(async (workdir) => {
    const savedPath = await dumpAgentDebug(workdir, "job-456", "link-verify", "text");
    assert.ok(savedPath);
    const content = await readFile(savedPath, "utf-8");
    assert.equal(content, "text");
  });
});

test("dumpAgentDebug: 同名（同一jobId+label）は上書きされる", async () => {
  await withTempDir(async (workdir) => {
    await dumpAgentDebug(workdir, "job-789", "writer-chunk-0", "1回目");
    const savedPath = await dumpAgentDebug(workdir, "job-789", "writer-chunk-0", "2回目");
    assert.ok(savedPath);
    const content = await readFile(savedPath, "utf-8");
    assert.equal(content, "2回目");
  });
});

// ── レビュー指摘C: 例外の握り潰し ──────────────────────────────────
// ダンプはあくまで補助的なデバッグ情報であり、これ自体の失敗（mkdir/writeFile例外）が
// パース失敗時の部分成功設計（一部のチャンク/ケースが失敗しても他は成功させる設計）を
// 巻き込んで全滅させてはならない。書き込み不能なパスを渡してもthrowせずundefinedを
// 返すことを検証する（実ファイルシステムの権限操作はせず、workdirとして「ディレクトリでは
// なく既存のファイル」を渡すことで mkdir が自然にENOTDIRで失敗する状況を再現する）。
test("dumpAgentDebug: 書き込み不能なパスを渡してもthrowせずundefinedを返す", async () => {
  await withTempDir(async (dir) => {
    const notADir = path.join(dir, "not-a-directory.txt");
    await writeFile(notADir, "this is a file, not a directory");
    // notADir配下にdebugディレクトリをmkdirしようとするとENOTDIRで失敗するはず。
    const result = await dumpAgentDebug(notADir, "job-fail", "writer-chunk-0", "テキスト");
    assert.equal(result, undefined);
  });
});
