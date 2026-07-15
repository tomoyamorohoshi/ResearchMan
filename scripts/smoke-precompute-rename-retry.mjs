// scripts/precompute-idea-layouts.mjs の rename-with-retry 堅牢化のスモークテスト。
// 背景(2026-07-15障害): rename瞬間に別プロセス(git pre-push監査等)がdata/idea-layouts.jsonを
// 一瞬開いていると、WindowsではEPERMでrenameが失敗し、呼び出し元のideaジョブ全体が
// ロールバックしてしまう。renameWithRetry/writeIdeaLayoutsAtomicが「EPERM等は指数バックオフで
// リトライし、それ以外(または全リトライ消化後)は従来どおり例外を投げる」ことを、
// 実FSでは再現が不安定なEPERMをモックfsで決定的に検証する。
// 実行: npx tsx scripts/smoke-precompute-rename-retry.mjs
// 注意: precompute-idea-layouts.mjs全体(main())は実データで約18分かかるため実行しない。
// このテストはrenameWithRetry/writeIdeaLayoutsAtomicという書き込み部分の純関数のみを対象にする。
import path from "node:path";
import { renameWithRetry, writeIdeaLayoutsAtomic } from "./precompute-idea-layouts.mjs";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

function makeErr(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

// テスト用: 即座に解決するsleepFn(実際に200〜3200ms待たずにテストを高速に保つ)。
// 呼び出された待機時間を記録し、バックオフの実測にも使う。
function makeFakeSleep() {
  const calls = [];
  const sleepFn = (ms) => {
    calls.push(ms);
    return Promise.resolve();
  };
  return { sleepFn, calls };
}

// ── 1. 2回EPERM→3回目成功 ──────────────────────────────────────────────
{
  let callCount = 0;
  const renameFn = async (tmp, dest) => {
    callCount++;
    if (callCount <= 2) throw makeErr("EPERM");
    assert(tmp === "/tmp/src", "3回目呼び出しのtmpPath引数が正しい");
    assert(dest === "/tmp/dest", "3回目呼び出しのdestPath引数が正しい");
  };
  const { sleepFn, calls } = makeFakeSleep();
  await renameWithRetry("/tmp/src", "/tmp/dest", { renameFn, sleepFn });
  assert(callCount === 3, `EPERM2回後、3回目で成功しrenameFnは計3回呼ばれる (実測=${callCount})`);
  assert(
    calls.length === 2 && calls[0] === 200 && calls[1] === 400,
    `バックオフ待機が指数的(200ms→400ms)に行われる (実測=${JSON.stringify(calls)})`,
  );
}

// ── 2. 全回失敗→例外(EPERMを最後まで投げ続けた場合、規定回数リトライして最後に例外) ──
{
  let callCount = 0;
  const renameFn = async () => {
    callCount++;
    throw makeErr("EPERM");
  };
  const { sleepFn, calls } = makeFakeSleep();
  let thrown = null;
  try {
    await renameWithRetry("/tmp/src", "/tmp/dest", { renameFn, sleepFn });
  } catch (e) {
    thrown = e;
  }
  assert(thrown !== null && thrown.code === "EPERM", "全回失敗時、最後のEPERMエラーがthrowされる");
  // delaysMsデフォルト[200,400,800,1600,3200](5回)ぶん待機し、初回+5リトライ=計6回呼ばれる
  assert(callCount === 6, `初回+5回リトライ=計6回呼ばれてから例外になる (実測=${callCount})`);
  assert(
    calls.length === 5 && calls.every((ms, i) => ms === [200, 400, 800, 1600, 3200][i]),
    `5回分の指数バックオフをすべて消化する (実測=${JSON.stringify(calls)})`,
  );
}

// ── 3. リトライ対象外のエラー(例: ENOENT)は即座に例外、リトライしない ──
{
  let callCount = 0;
  const renameFn = async () => {
    callCount++;
    throw makeErr("ENOENT");
  };
  const { sleepFn, calls } = makeFakeSleep();
  let thrown = null;
  try {
    await renameWithRetry("/tmp/src", "/tmp/dest", { renameFn, sleepFn });
  } catch (e) {
    thrown = e;
  }
  assert(thrown !== null && thrown.code === "ENOENT", "リトライ対象外エラーがそのままthrowされる");
  assert(callCount === 1, `リトライ対象外エラーは即座に失敗しrenameFnは1回しか呼ばれない (実測=${callCount})`);
  assert(calls.length === 0, "リトライ対象外エラーではsleepFnが一度も呼ばれない");
}

// ── 4. EBUSY/EACCESもEPERM同様にリトライ対象であること ──
for (const code of ["EBUSY", "EACCES"]) {
  let callCount = 0;
  const renameFn = async () => {
    callCount++;
    if (callCount === 1) throw makeErr(code);
  };
  const { sleepFn } = makeFakeSleep();
  await renameWithRetry("/tmp/src", "/tmp/dest", { renameFn, sleepFn });
  assert(callCount === 2, `${code}も1回失敗後リトライされ成功する (実測=${callCount})`);
}

// ── 5. writeIdeaLayoutsAtomic: tmpファイル命名規則・書き込み→rename呼び出し順序 ──
{
  const writeCalls = [];
  const renameCalls = [];
  const writeFileFn = async (p, content) => writeCalls.push({ p, content });
  const renameFn = async (tmp, dest) => renameCalls.push({ tmp, dest });
  const data = { hello: "world" };
  const pid = process.pid;
  const destPath = path.join("out", "data", "idea-layouts.json");
  await writeIdeaLayoutsAtomic(destPath, data, { writeFileFn, renameFn });

  assert(writeCalls.length === 1, "writeFileFnが1回だけ呼ばれる");
  assert(renameCalls.length === 1, "renameFnが1回だけ呼ばれる(writeFile成功時)");
  const expectedTmp = path.join("out", "data", `.idea-layouts.json.tmp-${pid}`);
  assert(
    writeCalls[0].p === expectedTmp,
    `tmpPathが従来のwriteJsonAtomicと同じ命名規則(.<basename>.tmp-<pid>) (実測=${writeCalls[0].p})`,
  );
  assert(
    writeCalls[0].content === JSON.stringify(data, null, 2) + "\n",
    "書き込み内容がJSON.stringify(data, null, 2)+改行と一致する",
  );
  assert(
    renameCalls[0].tmp === expectedTmp && renameCalls[0].dest === destPath,
    "renameFnがtmpPath→destPathの順で呼ばれる",
  );
}

// ── 6. writeIdeaLayoutsAtomic: rename側がEPERMでも最終的にリトライで成功する ──
{
  let renameCallCount = 0;
  const writeFileFn = async () => {};
  const renameFn = async () => {
    renameCallCount++;
    if (renameCallCount <= 1) throw makeErr("EPERM");
  };
  const { sleepFn } = makeFakeSleep();
  await writeIdeaLayoutsAtomic("/out/data/idea-layouts.json", { a: 1 }, { writeFileFn, renameFn, sleepFn });
  assert(renameCallCount === 2, `writeIdeaLayoutsAtomic経由でもrenameのEPERMがリトライされ成功する (実測=${renameCallCount})`);
}

// ── 7. writeIdeaLayoutsAtomic: rename側が全回失敗ならwriteIdeaLayoutsAtomicも例外で終わる
//       (既存挙動維持: tmpファイルの後始末はしない=呼び出し元に例外を伝播するのみ) ──
{
  const writeFileFn = async () => {};
  const renameFn = async () => {
    throw makeErr("EPERM");
  };
  const { sleepFn } = makeFakeSleep();
  let thrown = null;
  try {
    await writeIdeaLayoutsAtomic("/out/data/idea-layouts.json", { a: 1 }, { writeFileFn, renameFn, sleepFn });
  } catch (e) {
    thrown = e;
  }
  assert(thrown !== null && thrown.code === "EPERM", "rename全回失敗時、writeIdeaLayoutsAtomicも例外をそのまま伝播する");
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: precompute-idea-layouts rename-with-retry");
}
