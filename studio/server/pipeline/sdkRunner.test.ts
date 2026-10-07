/**
 * sdkRunner.ts のキャンセル対応テスト。SDKのquery()は sdkDeps.query 経由で差し替える
 * （実Claude呼び出しは一切しない）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { requestCancel, runInJobContext } from "../jobCancel.js";
import { runAgentQuery, runPlainQuery, sdkDeps } from "./sdkRunner.js";

type QueryFn = typeof sdkDeps.query;

function fakeQuery(calls: unknown[], text = "ok"): QueryFn {
  return ((arg: unknown) => {
    calls.push(arg);
    return (async function* () {
      yield { type: "result", subtype: "success", result: text, total_cost_usd: 0.01, errors: [] };
    })();
  }) as unknown as QueryFn;
}

async function withFakeQuery<T>(fake: QueryFn, fn: () => Promise<T>): Promise<T> {
  const orig = sdkDeps.query;
  sdkDeps.query = fake;
  try {
    return await fn();
  } finally {
    sdkDeps.query = orig;
  }
}

const DEF = { description: "d", prompt: "p", tools: [], model: undefined } as never;

test("コンテキスト外: そのままSDKを呼ぶ（abortControllerは付けない）", async () => {
  const calls: Array<{ options: Record<string, unknown> }> = [];
  const r = await withFakeQuery(fakeQuery(calls), () => runPlainQuery("hi"));
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.abortController, undefined);
});

test("ジョブコンテキスト内: abortControllerをSDKへ渡す", async () => {
  const calls: Array<{ options: Record<string, unknown> }> = [];
  await runInJobContext("sdk-test-1", async () => {
    const r = await withFakeQuery(fakeQuery(calls), () => runAgentQuery("/tmp", "a", DEF, "p"));
    assert.equal(r.ok, true);
  });
  assert.ok(calls[0].options.abortController instanceof AbortController);
});

test("キャンセル済みジョブ: SDKを呼ばず即 {ok:false,error:キャンセルされました}。以降のqueryも全てfail-fast（sticky）", async () => {
  const calls: unknown[] = [];
  await runInJobContext("sdk-test-2", async () => {
    requestCancel("sdk-test-2");
    for (let i = 0; i < 3; i++) {
      const a = await withFakeQuery(fakeQuery(calls), () => runAgentQuery("/tmp", "a", DEF, "p"));
      const b = await withFakeQuery(fakeQuery(calls), () => runPlainQuery("p"));
      for (const r of [a, b]) {
        assert.equal(r.ok, false);
        assert.equal(r.error, "キャンセルされました");
      }
    }
  });
  assert.equal(calls.length, 0);
});

test("実行中にキャンセルされSDKがabort例外を投げたら ok:false・error=キャンセルされました", async () => {
  const fake = ((arg: { options: { abortController: AbortController } }) =>
    (async function* () {
      await new Promise<void>((_, reject) => {
        arg.options.abortController.signal.addEventListener("abort", () => reject(new Error("aborted by SDK")));
      });
      yield undefined;
    })()) as unknown as QueryFn;
  await runInJobContext("sdk-test-3", async () => {
    const p = withFakeQuery(fake, () => runPlainQuery("p"));
    setTimeout(() => requestCancel("sdk-test-3"), 10);
    const r = await p;
    assert.equal(r.ok, false);
    assert.equal(r.error, "キャンセルされました");
  });
});
