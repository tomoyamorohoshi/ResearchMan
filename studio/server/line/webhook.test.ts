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
  createJobImpl?: (tab: string, request: Record<string, unknown>) => Promise<unknown>;
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
      return { id: "job-1" };
    },
    loadPending: async () => fakes.pendingStore,
    savePending: async (p) => {
      fakes.pendingStore = p;
    },
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
