/**
 * audit.ts の git 操作のうち、実git挙動への依存が強く誤りが致命的な gitRestorePaths /
 * rollbackTouchedFiles を、一時gitリポジトリのfixtureで検証する。
 *
 * adversarial-reviewer指摘#1の再発防止: `git restore -- <paths>` は既定でINDEXを
 * ソースにするため、`git add` 済み（staged）の内容に対しては実質no-op（index/working tree
 * ともに新内容のまま残る）。次のデイリーjobはpathspec無し`git commit`のためindex全体
 * （researchSources.ts等）を巻き込みcommitしてしまい「明示パスのみ」制約に違反する。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gitRestorePaths, rollbackTouchedFiles, run } from "./audit.js";

function makeTempRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-audit-test-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(path.join(dir, "a.txt"), "original\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return dir;
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

test("gitRestorePaths: addでstage済みの変更もHEADへ完全に戻す（index/working tree両方）", async () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(path.join(dir, "a.txt"), "modified\n");
    execFileSync("git", ["add", "a.txt"], { cwd: dir });

    const result = await gitRestorePaths(dir, ["a.txt"]);
    assert.equal(result.ok, true);

    const content = readFileSync(path.join(dir, "a.txt"), "utf-8");
    assert.equal(content, "original\n", "working treeがHEADへ戻っていない");

    const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf-8" });
    assert.equal(status.trim(), "", `indexにstaged差分が残っている: ${status}`);
  } finally {
    cleanup(dir);
  }
});

test("gitRestorePaths: add前（working treeのみの変更）でも従来どおり戻せる", async () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(path.join(dir, "a.txt"), "modified-not-staged\n");
    // git add はしない

    const result = await gitRestorePaths(dir, ["a.txt"]);
    assert.equal(result.ok, true);

    const content = readFileSync(path.join(dir, "a.txt"), "utf-8");
    assert.equal(content, "original\n");
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf-8" });
    assert.equal(status.trim(), "");
  } finally {
    cleanup(dir);
  }
});

test("gitRestorePaths: 空配列はno-op（okのみ返す）", async () => {
  const dir = makeTempRepo();
  try {
    const result = await gitRestorePaths(dir, []);
    assert.equal(result.ok, true);
  } finally {
    cleanup(dir);
  }
});

// ── rollbackTouchedFiles: 指摘2【重大】新規winners.jsonがあるとrollbackが丸ごと失敗 ──
// `git restore --source=HEAD` はHEADに存在しない新規ファイルがpathspecに混ざると
// 「pathspec did not match」でコマンド全体が失敗し、HEADに存在する他のtracked pathspec
// （cases.json等）まで巻き添えで戻らない（このファイル冒頭のBash検証で再現済みの実挙動）。
// awardResearch.tsのP5は「初回アワード実行時に新規生成されるwinners.json」を
// 既存trackedファイルと同じ配列（trackedTouched）に入れて渡すため、この組み合わせで
// 発生する。rollbackTouchedFilesはHEAD追跡有無を自分で判定し、tracked分はrestore・
// 新規分はrmで戻すことで、両方が確実に元に戻ることを保証する。
test("rollbackTouchedFiles: HEADに無い新規ファイルが混ざっていてもtracked分は正しくrestoreされ、新規分はrmで消える", async () => {
  const dir = makeTempRepo();
  try {
    // 既存追跡ファイル(a.txt)を変更
    writeFileSync(path.join(dir, "a.txt"), "modified\n");
    // HEADに存在しない新規ファイル（初回winners.json生成を模す）。呼び出し側が
    // 誤って「tracked」扱いの配列に入れてしまうケースを再現する。
    writeFileSync(path.join(dir, "new-winners.json"), '{"winners":[]}\n');

    await rollbackTouchedFiles(dir, ["a.txt", "new-winners.json"], []);

    const content = readFileSync(path.join(dir, "a.txt"), "utf-8");
    assert.equal(
      content,
      "original\n",
      "tracked分(a.txt)がHEADへ戻っていない（新規ファイル混在によるpathspecエラーで全体失敗した旧バグ）",
    );
    assert.equal(existsSync(path.join(dir, "new-winners.json")), false, "HEADに無い新規ファイルが削除されていない");
  } finally {
    cleanup(dir);
  }
});

test("rollbackTouchedFiles: newUntrackedPathsで渡したファイルも従来どおりrmで消える", async () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(path.join(dir, "thumb.jpg"), "binary-ish\n");
    await rollbackTouchedFiles(dir, [], ["thumb.jpg"]);
    assert.equal(existsSync(path.join(dir, "thumb.jpg")), false);
  } finally {
    cleanup(dir);
  }
});

// ── run(): 非ブロッキング化（P4 #1） ─────────────────────────────────
// 2026-07-10までの実装は spawnSync でイベントループを丸ごとブロックしていた
// （子プロセス完了までタイマーもI/Oも一切進まない）。async spawn化後は、子プロセス実行中も
// イベントループが生きていること（＝他のsetInterval等が刻み続けること）を確認する。
// 旧spawnSync実装に対してこのテストを流すと、ブロック中はタイマーが一切発火しないため
// ticks.length はほぼ0のまま失敗する（RED確認済み）。
test("run: 子プロセス実行中もイベントループがブロックされない（非同期spawn）", async () => {
  const ticks: number[] = [];
  const timer = setInterval(() => ticks.push(Date.now()), 30);
  try {
    const result = await run(process.execPath, ["-e", "setTimeout(() => {}, 900)"], process.cwd(), 5000);
    assert.equal(result.ok, true);
    assert.ok(
      ticks.length >= 10,
      `イベントループがブロックされていた可能性がある（900ms中のtick数=${ticks.length}）`,
    );
  } finally {
    clearInterval(timer);
  }
});

test("run: 正常終了時は ok=true・code=0 で stdout を取得できる", async () => {
  const result = await run(process.execPath, ["-e", "process.stdout.write('hello-studio')"], process.cwd(), 5000);
  assert.equal(result.ok, true);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "hello-studio");
});

test("run: 非ゼロ終了は ok=false・code に終了コードが入る", async () => {
  const result = await run(process.execPath, ["-e", "process.exit(1)"], process.cwd(), 5000);
  assert.equal(result.ok, false);
  assert.equal(result.code, 1);
});

test("run: timeout超過はkillされ ok=false になる（従来のspawnSync timeoutと同じ契約）", async () => {
  const result = await run(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], process.cwd(), 300);
  assert.equal(result.ok, false);
});

// ── run(): maxBuffer超過（独立レビュー指摘#7） ────────────────────────
// 旧spawnSync実装はmaxBuffer超過時に子プロセスをkillしてENOBUFSエラーにし、ok:falseを
// 返していた。async spawn化後の初期実装は超過分を黙って切り捨てるだけでok:trueのまま
// 成功扱いにしてしまっていた（監査ログが実は途中で切れているのに成功と誤判定するリスク）。
// 第5引数でmaxBufferBytesを注入可能にし、テストでは20MBを待たずに小さい値で再現する
// （既存呼び出し元は省略時MAX_BUFFER=20MBのまま、挙動は変えない）。
test("run: maxBuffer超過は子プロセスをkillしてok:falseにする（spawnSyncの旧挙動と同じ契約）", async () => {
  const result = await run(
    process.execPath,
    ["-e", "process.stdout.write('x'.repeat(10000))"],
    process.cwd(),
    5000,
    100, // maxBufferBytes（テスト専用の小さい上限）
  );
  assert.equal(result.ok, false);
  assert.match(result.stderr, /maxBuffer/);
});

test("run: maxBuffer以内の出力は従来どおりok:trueで全文取得できる", async () => {
  const result = await run(
    process.execPath,
    ["-e", "process.stdout.write('short-output')"],
    process.cwd(),
    5000,
    100,
  );
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "short-output");
});
