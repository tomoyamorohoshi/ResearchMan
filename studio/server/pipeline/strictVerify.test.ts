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

// ── 独立レビュー指摘#5: HTMLエスケープされるマーカーへの耐性 ─────────────────
// ReactのSSR出力は "&"/"<"/">" を含む文字列を自動でHTMLエンティティ化する（例:
// "Tom & Jerry" → "Tom &amp; Jerry"）。body.includes(marker)を生の形のままで行うと、
// これらの文字を含むマーカー（cases.jsonに413件実在するタイトル等）は本文に絶対に
// 現れないため恒久的に不一致になり、毎回タイムアウトまで無駄待ちした上で誤ったwarningを
// 出してしまう。エスケープ済み形とのOR一致で救う。

test("pollStrictVerify: '&'を含むマーカーはHTMLエスケープ済み('&amp;')な本文でも一致する", async () => {
  const targets: StrictVerifyTarget[] = [{ url: "https://x/cases/a", markers: ["Tom & Jerry"] }];
  const fetchImpl = fakeFetch({
    "https://x/cases/a": { status: 200, body: "<title>Tom &amp; Jerry</title>" },
  });
  const result = await pollStrictVerify(targets, { fetchImpl, maxTries: 1, sleepImpl: async () => {} });
  assert.equal(result.ok, true);
});

test("pollStrictVerify: '<'/'>'を含むマーカーもエスケープ済み形('&lt;'/'&gt;')で一致する", async () => {
  const targets: StrictVerifyTarget[] = [{ url: "https://x/cases/a", markers: ["<Reboot>"] }];
  const fetchImpl = fakeFetch({
    "https://x/cases/a": { status: 200, body: "<title>&lt;Reboot&gt;</title>" },
  });
  const result = await pollStrictVerify(targets, { fetchImpl, maxTries: 1, sleepImpl: async () => {} });
  assert.equal(result.ok, true);
});

test("pollStrictVerify: 生の形でもエスケープ済み形でも本文に無ければ従来どおり不一致", async () => {
  const targets: StrictVerifyTarget[] = [{ url: "https://x/cases/a", markers: ["Tom & Jerry"] }];
  const fetchImpl = fakeFetch({
    "https://x/cases/a": { status: 200, body: "<title>全く違うタイトル</title>" },
  });
  const result = await pollStrictVerify(targets, { fetchImpl, maxTries: 1, sleepImpl: async () => {} });
  assert.equal(result.ok, false);
});

// ── 独立レビュー指摘#6: fetchのタイムアウト ────────────────────────────
// fetchImplがハングする（応答が返らない）場合、AbortControllerによるper-request
// タイムアウトが無いと、lockを保持したままパイプライン全体が無期限にハングしうる。

test("pollStrictVerify: fetchがハングしてもrequestTimeoutMsで打ち切られ、全体がハングしない", async () => {
  // AbortSignalに反応する「ハングするfetch」を模す（実際にネットワーク待ちする代わりに
  // abortイベントでのみ解決する。requestTimeoutMsが機能していなければこのPromiseは
  // 永久に解決せずテストがタイムアウトする）。
  const hangingFetch = ((_url: string | URL, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }) as unknown as typeof fetch;

  const start = Date.now();
  const result = await pollStrictVerify([{ url: "https://x/cases/a", markers: ["x"] }], {
    fetchImpl: hangingFetch,
    maxTries: 1,
    sleepImpl: async () => {},
    requestTimeoutMs: 50,
  });
  const elapsedMs = Date.now() - start;
  assert.equal(result.ok, false);
  assert.ok(elapsedMs < 2000, `requestTimeoutMsが機能していれば数十ms程度で終わるはず（実測${elapsedMs}ms）`);
});
