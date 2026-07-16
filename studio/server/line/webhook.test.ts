/**
 * POST /api/line-webhook の統合テスト。index.test.ts と同じ流儀（実HTTPサーバをephemeral
 * ポートで起動しfetchで叩く）。config/push/pending/createJob/structureはすべて
 * createLineWebhookHandler の依存性注入（overrides）でフェイクに差し替え、実ファイル書き込みや
 * 実LINE API・実Claude呼び出しを一切行わない。
 *
 * 状態遷移の単体網羅は wizard.test.ts が担う。ここでは
 * 「webhook層の配線（署名検証・許可送信者判定・stepWizardの出力に応じたcreateJob/structure呼び出し）」
 * の確認に絞る。
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createLineWebhookHandler, type LineWebhookDeps } from "./webhook.js";
import type { LineConfig } from "./config.js";
import type { Job } from "../jobs.js";
import type { LinePending } from "./pending.js";

const SECRET = "test-secret";
const USER_ID = "Uallowed123";

function sign(body: Buffer): string {
  return crypto.createHmac("sha256", SECRET).update(body).digest("base64");
}

interface Fakes {
  pushes: Array<{ token: string; userId: string; text: string }>;
  createJobCalls: Array<{ tab: string; request: Record<string, unknown> }>;
  pendingStore: LinePending | null;
  createJobImpl?: (tab: string, request: Record<string, unknown>) => Promise<Job>;
  resumableAwardsJob?: { id: string } | null;
  resumeAwardsJobCalls?: string[];
  activeJobs?: Job[];
  latestFinishedJob?: Job | null;
}

/** createJobの戻り値フェイク。テストが見るのは主にid/statusなので、残りはダミー値で埋める。 */
function fakeCreatedJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    tab: "add-case",
    request: {},
    status: "running",
    resultCards: [],
    commit: null,
    deployedUrl: null,
    cost: null,
    at: new Date().toISOString(),
    ...overrides,
  };
}

function buildDeps(config: LineConfig | null, fakes: Fakes, extra: Partial<LineWebhookDeps> = {}): Partial<LineWebhookDeps> {
  return {
    getConfig: () => config,
    sendPush: async (token, userId, text) => {
      fakes.pushes.push({ token, userId, text });
    },
    createJob: async (tab, request) => {
      fakes.createJobCalls.push({ tab, request });
      if (fakes.createJobImpl) return fakes.createJobImpl(tab, request);
      return fakeCreatedJob();
    },
    loadPending: async () => fakes.pendingStore,
    savePending: async (p) => {
      fakes.pendingStore = p;
    },
    findResumableAwardsJob: async () => fakes.resumableAwardsJob ?? null,
    resumeAwardsJob: async (jobId: string) => {
      (fakes.resumeAwardsJobCalls ??= []).push(jobId);
    },
    listActiveJobs: async () => fakes.activeJobs ?? [],
    findLatestFinishedJob: async () => fakes.latestFinishedJob ?? null,
    now: () => new Date("2026-07-12T00:00:00.000Z"),
    ...extra,
  };
}

async function withApp<T>(deps: Partial<LineWebhookDeps>, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.post("/api/line-webhook", express.raw({ type: "*/*" }), createLineWebhookHandler(deps));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function eventBody(events: unknown[]): Buffer {
  return Buffer.from(JSON.stringify({ destination: "xxx", events }), "utf-8");
}

function textEvent(text: string, userId = USER_ID): Record<string, unknown> {
  return { type: "message", message: { type: "text", text }, source: { type: "user", userId } };
}

async function post(baseUrl: string, body: Buffer, opts: { withSignature?: boolean } = { withSignature: true }): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.withSignature !== false) headers["x-line-signature"] = sign(body);
  return fetch(`${baseUrl}/api/line-webhook`, { method: "POST", headers, body: new Uint8Array(body) });
}

// 非同期(fire-and-forget)のイベント処理がpushへ届くのを待つための短いポーリング。
async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("channelSecret未設定なら503", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null };
  await withApp(buildDeps({}, fakes), async (baseUrl) => {
    const res = await post(baseUrl, eventBody([]), { withSignature: false });
    assert.equal(res.status, 503);
  });
});

test("署名不一致は401", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    const body = eventBody([textEvent("1")]);
    const res = await fetch(`${baseUrl}/api/line-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-line-signature": "invalid==" },
      body: new Uint8Array(body),
    });
    assert.equal(res.status, 401);
  });
});

test("署名検証OKなら常に200（業務エラーでも200のまま）", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok" }; // allowedUserId未設定
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    const res = await post(baseUrl, eventBody([textEvent("何か")]));
    assert.equal(res.status, 200);
  });
});

test("allowedUserId未設定なら、送信者にuserIdを案内するpushを返す", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok" };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("こんにちは")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.match(fakes.pushes[0].text, new RegExp(USER_ID));
    assert.match(fakes.pushes[0].text, /allowedUserId/);
  });
});

test("allowedUserIdと一致しない送信者は無視する（pushしない）", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: "Uother" };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("調べて テーマ", USER_ID)]));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(fakes.pushes.length, 0);
  });
});

test("text以外のメッセージ種別・message以外のイベントは無視する", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(
      baseUrl,
      eventBody([
        { type: "message", message: { type: "image" }, source: { userId: USER_ID } },
        { type: "follow", source: { userId: USER_ID } },
      ]),
    );
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(fakes.pushes.length, 0);
  });
});

// ── 会話例1: メニュー経路（idle→menu相当→await_theme→…→final_confirm→実行） ──────

test("メニュー経路: 未知のテキストでメニュー提示 → 番号選択 → テーマ入力・確認 → 観点・参考をなしで進め → final_confirmでy → 実行", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("こんにちは")]));
    await waitFor(() => fakes.pendingStore?.state === "menu");
    assert.match(fakes.pushes.at(-1)!.text, /何をしますか/);

    await post(baseUrl, eventBody([textEvent("1")]));
    await waitFor(() => fakes.pendingStore?.state === "await_theme");
    assert.equal(fakes.pendingStore?.kind, "Case Study");

    await post(baseUrl, eventBody([textEvent("生成AI広告")]));
    await waitFor(() => fakes.pendingStore?.state === "confirm_theme");
    assert.match(fakes.pushes.at(-1)!.text, /テーマ: 生成AI広告/);

    await post(baseUrl, eventBody([textEvent("y")]));
    await waitFor(() => fakes.pendingStore?.state === "await_viewpoint");

    // 「なし」は確認(y/n)を挟まず直行する（2026-07-12 実使用フィードバック:
    // 空値確認の「n=無い」誤読による質問ループを排除）
    await post(baseUrl, eventBody([textEvent("なし")]));
    await waitFor(() => fakes.pendingStore?.state === "await_refs");

    await post(baseUrl, eventBody([textEvent("なし")]));
    await waitFor(() => fakes.pendingStore?.state === "final_confirm");
    assert.match(fakes.pushes.at(-1)!.text, /この内容で実行しますか/);
    assert.match(fakes.pushes.at(-1)!.text, /件数: 5件/);

    await post(baseUrl, eventBody([textEvent("y")]));
    await waitFor(() => fakes.createJobCalls.length > 0);
    assert.equal(fakes.createJobCalls[0].tab, "research");
    assert.deepEqual(fakes.createJobCalls[0].request, {
      kind: "Case Study",
      theme: "生成AI広告",
      viewpoint: "",
      refUrl: "",
      count: 5,
    });
    assert.match(fakes.pushes.at(-1)!.text, /実行開始/);
    assert.equal(fakes.pendingStore, null);
  });
});

test("リッチメニュー導線: idleでもメニュー語（アイデア出し）を直接受理し、menu提示を飛ばしてaway_themeへ入る", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("アイデア出し")]));
    await waitFor(() => fakes.pendingStore?.state === "await_theme");
    assert.equal(fakes.pendingStore?.kind, "idea");
    assert.match(fakes.pushes.at(-1)!.text, /テーマ/);
  });
});

// ── 会話例2: ショートカット経路（キーワード開始→Claude構造化→final_confirm→実行） ────

test("ショートカット経路: 「調べて」開始は即Claude構造化されfinal_confirmに直行する", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  const structured = {
    ok: true as const,
    tab: "research" as const,
    value: { kind: "Case Study" as const, theme: "生成AI広告", viewpoint: "", refUrl: "", count: 5 },
  };
  await withApp(buildDeps(config, fakes, { structure: async () => structured }), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("調べて 生成AI広告")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.equal(fakes.pendingStore?.state, "final_confirm");
    assert.match(fakes.pushes[0].text, /Case Study/);
    assert.match(fakes.pushes[0].text, /この内容で実行しますか/);

    await post(baseUrl, eventBody([textEvent("y")]));
    await waitFor(() => fakes.createJobCalls.length > 0);
    assert.equal(fakes.createJobCalls[0].tab, "research");
    assert.match(fakes.pushes.at(-1)!.text, /実行開始/);
    assert.equal(fakes.pendingStore, null);
  });
});

test("ショートカット経路: 解釈失敗時はエラー理由をpushし、pendingは保存しない", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes, { structure: async () => ({ ok: false, error: "テーマを入力してください" }) }), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("調べて")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.match(fakes.pushes[0].text, /テーマを入力してください/);
    assert.equal(fakes.pendingStore, null);
  });
});

test("ショートカット経路で作られたfinal_confirmでも「件数 3」インライン編集が効く（改修動機の再現確認）", async () => {
  const fakes: Fakes = {
    pushes: [],
    createJobCalls: [],
    pendingStore: {
      userId: USER_ID,
      state: "final_confirm",
      kind: "Case Study",
      theme: "生成AI広告",
      viewpoint: "",
      refs: "",
      expiresAt: "2026-07-12T00:29:00.000Z",
    },
  };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("件数 3")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.equal(fakes.pendingStore?.state, "final_confirm");
    assert.equal(fakes.pendingStore?.count, 3);
    assert.match(fakes.pushes[0].text, /件数: 3件/);

    await post(baseUrl, eventBody([textEvent("y")]));
    await waitFor(() => fakes.createJobCalls.length > 0);
    assert.equal(fakes.createJobCalls[0].request.count, 3);
  });
});

// ── AWARDS（要件A: メニュー3→Q1→Q2→即実行・final_confirmを挟まない） ────────────

test("AWARDS経路: メニュー3番選択→Q1→Q2→構造化→即実行（final_confirmを挟まない）", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  const structured = {
    ok: true as const,
    value: { awardName: "D&AD", year: "2026", categories: "all" as const, minLevel: "Bronze" as const, lineUserId: "", dryRun: false },
  };
  await withApp(buildDeps(config, fakes, { structureAward: async () => structured }), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("3")]));
    await waitFor(() => fakes.pendingStore?.state === "await_award_name");

    await post(baseUrl, eventBody([textEvent("D&AD 2026")]));
    await waitFor(() => fakes.pendingStore?.state === "await_award_categories");
    assert.match(fakes.pushes.at(-1)!.text, /部門/);

    await post(baseUrl, eventBody([textEvent("全部門(ブロンズ以上)")]));
    await waitFor(() => fakes.createJobCalls.length > 0);
    assert.equal(fakes.createJobCalls[0].tab, "awards");
    assert.equal(fakes.createJobCalls[0].request.awardName, "D&AD");
    assert.equal(fakes.createJobCalls[0].request.lineUserId, USER_ID);
    assert.match(fakes.pushes.at(-1)!.text, /受け付けました/);
    // final_confirmを挟まないため、実行後はpendingがクリアされている
    assert.equal(fakes.pendingStore, null);
  });
});

test("AWARDS経路: 構造化失敗時はエラー理由をpushしpendingはクリアされる", async () => {
  const fakes: Fakes = {
    pushes: [],
    createJobCalls: [],
    pendingStore: { userId: USER_ID, state: "await_award_categories", kind: "awards", awardNameRaw: "D&AD 2026", expiresAt: "2026-07-12T00:29:00.000Z" },
  };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(
    buildDeps(config, fakes, { structureAward: async () => ({ ok: false, error: "アワード名を入力してください" }) }),
    async (baseUrl) => {
      await post(baseUrl, eventBody([textEvent("よくわからない")]));
      await waitFor(() => fakes.pushes.length > 0);
      assert.match(fakes.pushes[0].text, /アワード名を入力してください/);
      assert.equal(fakes.pendingStore, null);
      assert.equal(fakes.createJobCalls.length, 0);
    },
  );
});

test("キーワード「アワード」でもQ1から開始する", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("アワード")]));
    await waitFor(() => fakes.pendingStore?.state === "await_award_name");
    assert.match(fakes.pushes.at(-1)!.text, /アワード名/);
  });
});

// ── 「再開」キーワード（要件A.3・D.3: 予算超過で一時停止中のAWARDSジョブの再開） ─────

test("「再開」: 再開可能なジョブが見つかれば受付pushしresumeAwardsJobを呼ぶ", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null, resumableAwardsJob: { id: "job-paused-1" } };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("再開")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.match(fakes.pushes[0].text, /再開/);
    await waitFor(() => (fakes.resumeAwardsJobCalls?.length ?? 0) > 0);
    assert.deepEqual(fakes.resumeAwardsJobCalls, ["job-paused-1"]);
  });
});

test("「再開」: 再開可能なジョブが無ければその旨をpushし、resumeAwardsJobは呼ばない", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null, resumableAwardsJob: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("再開")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.match(fakes.pushes[0].text, /再開できるAWARDS/);
    assert.equal(fakes.resumeAwardsJobCalls ?? undefined, undefined);
  });
});

// ── 「進捗」「状況」（要件A: LINE対話的進捗照会） ────────────────────────────

function makeActiveJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-progress",
    tab: "research",
    request: { kind: "Case Study" },
    status: "running",
    resultCards: [],
    commit: null,
    deployedUrl: null,
    cost: null,
    at: "2026-07-11T23:48:00.000Z", // now(2026-07-12T00:00:00.000Z)の12分前
    ...overrides,
  };
}

test("進捗: 実行中ジョブがあればその状態をpushし、pendingには触れない（idle状態）", async () => {
  const fakes: Fakes = {
    pushes: [],
    createJobCalls: [],
    pendingStore: null,
    activeJobs: [makeActiveJob({ progress: "収集中" })],
  };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("進捗")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.match(fakes.pushes[0].text, /事例調査/);
    assert.match(fakes.pushes[0].text, /収集中/);
    assert.match(fakes.pushes[0].text, /12分経過/);
    assert.equal(fakes.pendingStore, null);
  });
});

test("進捗: ウィザード進行中（await_theme）に「状況」で割り込んでも応答し、pendingは変化しない", async () => {
  const pending: LinePending = { userId: USER_ID, state: "await_theme", kind: "Case Study", expiresAt: "2026-07-12T00:29:00.000Z" };
  const fakes: Fakes = {
    pushes: [],
    createJobCalls: [],
    pendingStore: { ...pending },
    activeJobs: [],
    latestFinishedJob: null,
  };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("状況")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.match(fakes.pushes[0].text, /実行中のジョブはありません/);
    assert.deepEqual(fakes.pendingStore, pending);
    assert.equal(fakes.createJobCalls.length, 0);
  });
});

test("進捗: final_confirm中に「進捗」で割り込んでもpendingが壊れず、以降のyがそのまま効く", async () => {
  const pending: LinePending = {
    userId: USER_ID,
    state: "final_confirm",
    kind: "Case Study",
    theme: "生成AI広告",
    viewpoint: "",
    refs: "",
    expiresAt: "2026-07-12T00:29:00.000Z",
  };
  const fakes: Fakes = {
    pushes: [],
    createJobCalls: [],
    pendingStore: { ...pending },
    activeJobs: [],
    latestFinishedJob: null,
  };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("進捗")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.deepEqual(fakes.pendingStore, pending);

    await post(baseUrl, eventBody([textEvent("y")]));
    await waitFor(() => fakes.createJobCalls.length > 0);
    assert.equal(fakes.createJobCalls[0].tab, "research");
    assert.equal(fakes.pendingStore, null);
  });
});

test("進捗: 実行中が無ければ直近の完了ジョブ1件を案内する", async () => {
  const fakes: Fakes = {
    pushes: [],
    createJobCalls: [],
    pendingStore: null,
    activeJobs: [],
    latestFinishedJob: makeActiveJob({ id: "job-done", tab: "add-case", request: {}, status: "done", at: "2026-07-11T23:25:00.000Z" }),
  };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("進捗")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.match(fakes.pushes[0].text, /実行中のジョブはありません/);
    assert.match(fakes.pushes[0].text, /事例・技術追加/);
    assert.match(fakes.pushes[0].text, /done/);
    assert.match(fakes.pushes[0].text, /35分前/);
  });
});

test("進捗: 実行中も完了ジョブも無ければ「実行中のジョブはありません」のみ", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null, activeJobs: [], latestFinishedJob: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("進捗")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.equal(fakes.pushes[0].text, "実行中のジョブはありません");
  });
});

// ── 事例追加（LINEでURLを送ると事例が cases.json に追加される機能） ─────────

test("事例追加: URL入りテキストは確認なしで即ジョブ投入し、受け付け済みをpushする", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("https://example.com/article/123")]));
    await waitFor(() => fakes.createJobCalls.length > 0);
    assert.equal(fakes.createJobCalls[0].tab, "add-case");
    assert.deepEqual(fakes.createJobCalls[0].request, {
      url: "https://example.com/article/123",
      context: "",
      lineUserId: USER_ID,
    });
    assert.match(fakes.pushes[0].text, /受け付け/);
    // 確認ステップが無いためpendingは作られない
    assert.equal(fakes.pendingStore, null);
  });
});

test("事例追加: URL+補足テキストはcontextとしてジョブに渡される", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("これ見て https://example.com/article/123 音楽視点で")]));
    await waitFor(() => fakes.createJobCalls.length > 0);
    assert.equal(fakes.createJobCalls[0].request.context, "これ見て 音楽視点で");
  });
});

// ── ジョブキュー: createJobがstatus='queued'のジョブを返した場合、受付文言をqueued専用に切り替える ──
// （デイリーgitロック待ちで順番待ちに入った場合。pipeline/jobQueue.ts参照）

test("事例追加: createJobがstatus='queued'を返したら、受付文言をキュー投入用に切り替える", async () => {
  const fakes: Fakes = {
    pushes: [],
    createJobCalls: [],
    pendingStore: null,
    createJobImpl: async () => fakeCreatedJob({ id: "job-queued-1", status: "queued" }),
  };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("https://example.com/article/999")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.match(fakes.pushes[0].text, /順番待ち/);
  });
});

test("事例追加: createJobがstatus='running'を返せば、従来どおりの受付文言のまま", async () => {
  const fakes: Fakes = {
    pushes: [],
    createJobCalls: [],
    pendingStore: null,
    createJobImpl: async () => fakeCreatedJob({ id: "job-running-1", status: "running" }),
  };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("https://example.com/article/998")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.match(fakes.pushes[0].text, /受け付け/);
    assert.doesNotMatch(fakes.pushes[0].text, /順番待ち/);
  });
});

test("final_confirm実行: createJobがstatus='queued'を返したら、受付文言をキュー投入用に切り替える", async () => {
  const fakes: Fakes = {
    pushes: [],
    createJobCalls: [],
    pendingStore: {
      userId: USER_ID,
      state: "final_confirm",
      kind: "Case Study",
      theme: "t",
      viewpoint: "",
      refs: "",
      expiresAt: "2026-07-12T00:29:00.000Z",
    },
    createJobImpl: async () => fakeCreatedJob({ id: "job-queued-2", status: "queued", tab: "research" }),
  };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("y")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.match(fakes.pushes[0].text, /順番待ち/);
    assert.equal(fakes.pendingStore, null);
  });
});

test("事例追加: createJobが例外を投げたら失敗理由をpushする", async () => {
  const fakes: Fakes = {
    pushes: [],
    createJobCalls: [],
    pendingStore: null,
    createJobImpl: async () => {
      throw new Error("URLを入力してください");
    },
  };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("https://example.com/article/123")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.match(fakes.pushes[0].text, /URLを入力してください/);
  });
});

// ── OK: 実行系（final_confirmでのy/n） ─────────────────────────────

test("final_confirm: createJobが例外を投げたら失敗理由をpushし、pendingは消える", async () => {
  const fakes: Fakes = {
    pushes: [],
    createJobCalls: [],
    pendingStore: {
      userId: USER_ID,
      state: "final_confirm",
      kind: "Case Study",
      theme: "t",
      viewpoint: "",
      refs: "",
      expiresAt: "2026-07-12T00:29:00.000Z",
    },
    createJobImpl: async () => {
      throw new Error("boom");
    },
  };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("y")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.match(fakes.pushes[0].text, /実行開始に失敗しました/);
    assert.match(fakes.pushes[0].text, /boom/);
    assert.equal(fakes.pendingStore, null);
  });
});

test("final_confirm: nで「どこを直しますか」に遷移する", async () => {
  const fakes: Fakes = {
    pushes: [],
    createJobCalls: [],
    pendingStore: {
      userId: USER_ID,
      state: "final_confirm",
      kind: "Case Study",
      theme: "t",
      viewpoint: "",
      refs: "",
      expiresAt: "2026-07-12T00:29:00.000Z",
    },
  };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("n")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.equal(fakes.pendingStore?.state, "select_edit_field");
    assert.match(fakes.pushes[0].text, /どこを直しますか/);
  });
});

// ── キャンセル（全状態で有効） ──────────────────────────────────────

test("キャンセル: 有効なpendingを破棄し、その旨をpushする", async () => {
  const fakes: Fakes = {
    pushes: [],
    createJobCalls: [],
    pendingStore: {
      userId: USER_ID,
      state: "await_theme",
      kind: "idea",
      expiresAt: "2026-07-12T00:29:00.000Z",
    },
  };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("キャンセル")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.equal(fakes.pendingStore, null);
    assert.match(fakes.pushes[0].text, /キャンセルしました/);
  });
});

test("キャンセル: pendingが無ければその旨をpushする", async () => {
  const fakes: Fakes = { pushes: [], createJobCalls: [], pendingStore: null };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("やめる")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.match(fakes.pushes[0].text, /キャンセルする依頼はありません/);
  });
});

// ── 期限切れ ────────────────────────────────────────────────────

test("期限切れ状態でメッセージが来たら、期限切れ通知とメニューを再提示する", async () => {
  const fakes: Fakes = {
    pushes: [],
    createJobCalls: [],
    pendingStore: {
      userId: USER_ID,
      state: "await_theme",
      kind: "Case Study",
      expiresAt: "2026-07-11T00:00:00.000Z", // now(2026-07-12)より過去
    },
  };
  const config: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };
  await withApp(buildDeps(config, fakes), async (baseUrl) => {
    await post(baseUrl, eventBody([textEvent("生成AI広告")]));
    await waitFor(() => fakes.pushes.length > 0);
    assert.match(fakes.pushes[0].text, /期限切れ/);
    assert.match(fakes.pushes[0].text, /何をしますか/);
    assert.equal(fakes.pendingStore?.state, "menu");
  });
});
