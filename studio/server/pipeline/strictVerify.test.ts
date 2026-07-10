/**
 * strictVerify.ts の単体テスト。fetch/sleep をDIし、実ネットワークを一切使わない
 * （P4 #5: 「push 後、新規追加したidが本番に実際に出たことをマーカー確認するポーリング。
 * タイムアウトはwarningでdone（P1 #2の流儀）」の判定ロジック）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { pollStrictVerify, type StrictVerifyTarget } from "./strictVerify.js";

function fakeFetch(responses: Record<string, { status: number; body: string }>): typeof fetch {
  return (async (url: string | URL) => {
    const key = String(url);
    const r = responses[key] ?? { status: 404, body: "" };
    return {
      status: r.status,
      text: async () => r.body,
    } as Response;
  }) as typeof fetch;
}

test("pollStrictVerify: 対象0件は即ok（fetchを一度も呼ばない）", async () => {
  let called = 0;
  const fetchImpl = (async () => {
    called++;
    return { status: 200, text: async () => "" } as Response;
  }) as typeof fetch;
  const result = await pollStrictVerify([], { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(called, 0);
});

test("pollStrictVerify: 200かつ本文にマーカー文字列を含めば1回目でok", async () => {
  const targets: StrictVerifyTarget[] = [
    { url: "https://x/cases/a", markers: ["新事例タイトル"] },
  ];
  const fetchImpl = fakeFetch({
    "https://x/cases/a": { status: 200, body: "<html>...新事例タイトル...</html>" },
  });
  let slept = 0;
  const result = await pollStrictVerify(targets, {
    fetchImpl,
    sleepImpl: async () => {
      slept++;
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failedUrls, []);
  assert.equal(slept, 0, "1回目で成功したらsleepしない");
});

test("pollStrictVerify: 200でもマーカーが本文に無ければ失敗扱い（200だけでは反映済みと見なさない）", async () => {
  const targets: StrictVerifyTarget[] = [{ url: "https://x/cases/a", markers: ["新事例タイトル"] }];
  const fetchImpl = fakeFetch({
    "https://x/cases/a": { status: 200, body: "<html>古いビルドのキャッシュ</html>" },
  });
  const result = await pollStrictVerify(targets, { fetchImpl, maxTries: 1, sleepImpl: async () => {} });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failedUrls, ["https://x/cases/a"]);
});

test("pollStrictVerify: 1つのURLに複数マーカーがある場合、全マーカーが揃って初めてok", async () => {
  const targets: StrictVerifyTarget[] = [{ url: "https://x/ideas", markers: ["案A", "案B"] }];
  const fetchImpl = fakeFetch({
    "https://x/ideas": { status: 200, body: "<html>案A のみ</html>" },
  });
  const result = await pollStrictVerify(targets, { fetchImpl, maxTries: 1, sleepImpl: async () => {} });
  assert.equal(result.ok, false);
});

test("pollStrictVerify: 初回失敗→2回目で成功するとリトライを経てokになる", async () => {
  let attempt = 0;
  const fetchImpl = (async () => {
    attempt++;
    return {
      status: 200,
      text: async () => (attempt >= 2 ? "新事例タイトル" : "まだ反映されていない"),
    } as Response;
  }) as typeof fetch;
  let slept = 0;
  const result = await pollStrictVerify([{ url: "https://x/cases/a", markers: ["新事例タイトル"] }], {
    fetchImpl,
    maxTries: 5,
    sleepImpl: async () => {
      slept++;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(slept, 1, "1回リトライして成功したはず");
});

test("pollStrictVerify: maxTries回とも失敗すればタイムアウトでok=false・failedUrlsを返す", async () => {
  const fetchImpl = fakeFetch({}); // 常に404
  let slept = 0;
  const result = await pollStrictVerify([{ url: "https://x/cases/a", markers: ["x"] }], {
    fetchImpl,
    maxTries: 3,
    sleepImpl: async () => {
      slept++;
    },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failedUrls, ["https://x/cases/a"]);
  assert.equal(slept, 2, "最後の試行後はsleepしない（maxTries-1回）");
});

test("pollStrictVerify: fetch自体が例外を投げても失敗として扱い、クラッシュしない", async () => {
  const fetchImpl = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const result = await pollStrictVerify([{ url: "https://x/cases/a", markers: ["x"] }], {
    fetchImpl,
    maxTries: 1,
    sleepImpl: async () => {},
  });
  assert.equal(result.ok, false);
});

test("pollStrictVerify: 複数targetのうち1つでも未達なら全体はfalseで、失敗分のみfailedUrlsに残る", async () => {
  const fetchImpl = fakeFetch({
    "https://x/cases/a": { status: 200, body: "A案の本文" },
    "https://x/cases/b": { status: 200, body: "全く違う本文" },
  });
  const result = await pollStrictVerify(
    [
      { url: "https://x/cases/a", markers: ["A案"] },
      { url: "https://x/cases/b", markers: ["B案"] },
    ],
    { fetchImpl, maxTries: 1, sleepImpl: async () => {} },
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.failedUrls, ["https://x/cases/b"]);
});
