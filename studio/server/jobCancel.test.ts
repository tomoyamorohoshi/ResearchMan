/**
 * jobCancel.ts（ジョブ中断レジストリ + AsyncLocalStorageコンテキスト）の単体テスト。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CANCELLED_MESSAGE,
  CancelledError,
  beginCommit,
  currentJobSignal,
  endCommitPhase,
  isCancelledInContext,
  isJobCancelled,
  requestCancel,
  runInJobContext,
  throwIfCancelled,
} from "./jobCancel.js";

const nextId = (() => {
  let n = 0;
  return () => `jobcancel-test-${++n}`;
})();

test("コンテキスト外: signalはundefined・throwIfCancelled/beginCommitは何もしない", () => {
  assert.equal(currentJobSignal(), undefined);
  assert.equal(isCancelledInContext(), false);
  throwIfCancelled();
  beginCommit();
  endCommitPhase();
});

test("runInJobContext: 内側でsignalが取れ、requestCancelでabortされる（非同期境界を跨いでも）", async () => {
  const id = nextId();
  let signal: AbortSignal | undefined;
  const done = runInJobContext(id, async () => {
    await new Promise((r) => setTimeout(r, 5));
    signal = currentJobSignal();
    assert.equal(signal?.aborted, false);
    assert.equal(requestCancel(id), "cancelled");
    assert.equal(signal?.aborted, true);
    assert.equal(isCancelledInContext(), true);
    assert.throws(() => throwIfCancelled(), CancelledError);
  });
  await done;
  assert.ok(signal);
  assert.equal(isJobCancelled(id), true);
});

test("キャンセルはsticky: キャンセル済みジョブのコンテキストはfnを実行せずundefinedを返す", async () => {
  const id = nextId();
  requestCancel(id); // 生きたコントローラが無くても記録される（孤児/キュー待ち）
  let ran = false;
  const r = await runInJobContext(id, async () => {
    ran = true;
    return 1;
  });
  assert.equal(ran, false);
  assert.equal(r, undefined);
});

test("beginCommit: キャンセル済みならCancelledError（commit前チェックの保証）", async () => {
  const id = nextId();
  await runInJobContext(id, async () => {
    requestCancel(id);
    assert.throws(() => beginCommit(), CancelledError);
  });
});

test("beginCommit後のrequestCancelは 'too-late' を返し、abortもキャンセル記録もしない", async () => {
  const id = nextId();
  await runInJobContext(id, async () => {
    beginCommit();
    assert.equal(requestCancel(id), "too-late");
    assert.equal(currentJobSignal()?.aborted, false);
    assert.equal(isJobCancelled(id), false);
    throwIfCancelled(); // 投げない
  });
});

test("endCommitPhase: 「両方」の次フェーズ向けにcommit中フラグを戻すと再び中断できる", async () => {
  const id = nextId();
  await runInJobContext(id, async () => {
    beginCommit();
    endCommitPhase();
    assert.equal(requestCancel(id), "cancelled");
  });
});

test("コンテキスト終了後はレジストリから外れる（生きたコントローラが無い）", async () => {
  const id = nextId();
  await runInJobContext(id, async () => {});
  assert.equal(requestCancel(id), "cancelled"); // orphan扱い: 記録のみ
  assert.equal(isJobCancelled(id), true);
});

test("CancelledErrorのメッセージは定数と一致する", () => {
  assert.equal(new CancelledError().message, CANCELLED_MESSAGE);
  assert.equal(CANCELLED_MESSAGE, "キャンセルされました");
});

test("別ジョブのコンテキストは干渉しない", async () => {
  const a = nextId();
  const b = nextId();
  await Promise.all([
    runInJobContext(a, async () => {
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(isCancelledInContext(), true);
    }),
    runInJobContext(b, async () => {
      requestCancel(a);
      assert.equal(isCancelledInContext(), false);
    }),
  ]);
});
