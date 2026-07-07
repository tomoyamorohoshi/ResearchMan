// scripts/lib/tuneup-apply.mjs の単体検証（TDD: 実装前にこのテストを書き、失敗を確認してから実装した）。
// biweekly-tuneup.mjsのmain()は即時実行スクリプトのため単体テストできない
// （OPERATIONS.md「main()を即実行するスクリプトをimportしない」参照）。
// 「書き込み→検証→dry-runなら必ず戻す／検証失敗なら必ず戻す／本番成功なら戻さない」という
// revertルールを、実ファイルI/O・実Claude CLI呼び出しなしにスタブで高速に検証する。
// 実行: node scripts/smoke-tuneup-apply.mjs
import { applyCandidateWithVerification } from "./lib/tuneup-apply.mjs";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

function makeCalls() {
  const calls = [];
  return { calls, record: (name) => calls.push(name) };
}

async function run() {
  // ── 1. dry-run + 全検証成功 → 必ずrevertが呼ばれ、reverted:trueを返す ──
  {
    const { calls, record } = makeCalls();
    const result = await applyCandidateWithVerification({
      writeFiles: async () => record("write"),
      verifySteps: [async () => { record("verify1"); return true; }, async () => { record("verify2"); return true; }],
      revert: async () => record("revert"),
      dryRun: true,
    });
    assert(result.ok === true && result.reverted === true, "dry-run成功時: ok=true, reverted=true");
    assert(JSON.stringify(calls) === JSON.stringify(["write", "verify1", "verify2", "revert"]), `呼び出し順が正しい (${JSON.stringify(calls)})`);
  }

  // ── 2. 本番(dryRun=false) + 全検証成功 → revertは呼ばれない ──
  {
    const { calls, record } = makeCalls();
    const result = await applyCandidateWithVerification({
      writeFiles: async () => record("write"),
      verifySteps: [async () => { record("verify1"); return true; }],
      revert: async () => record("revert"),
      dryRun: false,
    });
    assert(result.ok === true && result.reverted === false, "本番成功時: ok=true, reverted=false");
    assert(!calls.includes("revert"), "本番成功時はrevertを呼ばない（変更を維持する）");
  }

  // ── 3. 検証ステップが false を返す → dryRunに関わらず必ずrevertし、以降のステップは実行しない ──
  {
    const { calls, record } = makeCalls();
    const result = await applyCandidateWithVerification({
      writeFiles: async () => record("write"),
      verifySteps: [
        async () => { record("verify1"); return true; },
        async () => { record("verify2-fails"); return false; },
        async () => { record("verify3-should-not-run"); return true; },
      ],
      revert: async () => record("revert"),
      dryRun: false,
    });
    assert(result.ok === false, "検証失敗時: ok=false");
    assert(calls.includes("revert"), "検証失敗時（本番モードでも）必ずrevertする");
    assert(!calls.includes("verify3-should-not-run"), "失敗後の残りステップは実行しない");
  }

  // ── 4. 検証ステップが例外を投げる → 握りつぶさず必ずrevertしてから ok:false を返す ──
  {
    const { calls, record } = makeCalls();
    const result = await applyCandidateWithVerification({
      writeFiles: async () => record("write"),
      verifySteps: [async () => { record("verify1-throws"); throw new Error("boom"); }],
      revert: async () => record("revert"),
      dryRun: true,
    });
    assert(result.ok === false && /boom/.test(result.reason || ""), `例外はok:falseとreasonに反映される (${JSON.stringify(result)})`);
    assert(calls.includes("revert"), "検証中の例外でも必ずrevertする（作業ツリーを汚したままにしない）");
  }

  // ── 5. writeFiles自体が例外を投げる → まだ何も書いていない想定でもrevertを試みる(冪等な安全策) ──
  {
    const { calls, record } = makeCalls();
    const result = await applyCandidateWithVerification({
      writeFiles: async () => { record("write-throws"); throw new Error("write failed"); },
      verifySteps: [async () => { record("verify-should-not-run"); return true; }],
      revert: async () => record("revert"),
      dryRun: false,
    });
    assert(result.ok === false, "writeFiles失敗時: ok=false");
    assert(!calls.includes("verify-should-not-run"), "writeFiles失敗後は検証ステップを実行しない");
    assert(calls.includes("revert"), "writeFiles失敗時もrevertを試みる");
  }

  if (failures > 0) {
    console.error(`\n${failures} 件失敗`);
    process.exit(1);
  } else {
    console.log("\n全テストPASS: tuneup-apply");
  }
}

run();
