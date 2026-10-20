/**
 * webhook の「承認/却下/修正 <ID>」配線テスト（webhook.test.ts と同じ流儀。既存テストは無改変）。
 * gateProposalFlow 自体の挙動は gateProposalFlow.test.ts が担い、ここでは優先順位・応答経路だけを見る。
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createLineWebhookHandler, type LineWebhookDeps } from "./webhook.js";
import type { LineConfig } from "./config.js";
import type { LinePending } from "./pending.js";
import type { GateCommand } from "./classify.js";

const SECRET = "test-secret";
const USER_ID = "Uallowed123";
const CONFIG: LineConfig = { channelSecret: SECRET, channelAccessToken: "tok", allowedUserId: USER_ID };

interface Rec {
  sent: Array<{ replyToken: string | undefined; text: string }>;
  gate: GateCommand[];
  pending: LinePending | null;
  jobs: number;
}

function deps(rec: Rec, extra: Partial<LineWebhookDeps> = {}): Partial<LineWebhookDeps> {
  return {
    getConfig: () => CONFIG,
    respond: async (_t, replyToken, _u, text) => void rec.sent.push({ replyToken, text }),
    createJob: async () => {
      rec.jobs++;
      throw new Error("not expected");
    },
    loadPending: async () => rec.pending,
    savePending: async (p) => void (rec.pending = p),
    listActiveJobs: async () => [],
    findLatestFinishedJob: async () => null,
    handleGateCommand: async (cmd) => {
      rec.gate.push(cmd);
      return { reply: `gate:${cmd.action}:${cmd.id}` };
    },
    now: () => new Date("2026-10-20T00:00:00.000Z"),
    ...extra,
  };
}

async function send(d: Partial<LineWebhookDeps>, text: string, userId = USER_ID): Promise<void> {
  const app = express();
  app.post("/hook", express.raw({ type: "*/*" }), createLineWebhookHandler(d));
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  try {
    const body = Buffer.from(JSON.stringify({ events: [{ type: "message", replyToken: "rt-1", message: { type: "text", text }, source: { userId } }] }));
    const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64");
    const res = await fetch(`http://127.0.0.1:${port}/hook`, { method: "POST", headers: { "Content-Type": "application/json", "x-line-signature": sig }, body: new Uint8Array(body) });
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 150));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("承認 G12 は gate ハンドラへ渡り、replyToken で返信する", async () => {
  const rec: Rec = { sent: [], gate: [], pending: null, jobs: 0 };
  await send(deps(rec), "承認　Ｇ１２");
  assert.deepEqual(rec.gate, [{ action: "approve", id: 12, feedback: "" }]);
  assert.deepEqual(rec.sent, [{ replyToken: "rt-1", text: "gate:approve:12" }]);
});

test("ウィザード進行中でも gate コマンドが優先され、pending は触らない", async () => {
  const rec: Rec = { sent: [], gate: [], pending: { userId: USER_ID, state: "await_theme" } as unknown as LinePending, jobs: 0 };
  const before = rec.pending;
  await send(deps(rec), "却下 3");
  assert.equal(rec.gate.length, 1);
  assert.equal(rec.pending, before);
});

test("修正: 即時返信のあと background の結果を replyToken なし(push)で追送する", async () => {
  const rec: Rec = { sent: [], gate: [], pending: null, jobs: 0 };
  await send(
    deps(rec, { handleGateCommand: async () => ({ reply: "作成中", background: async () => ["新案1", "新案2"] }) }),
    "修正 G1 短く\n2行目",
  );
  assert.deepEqual(rec.sent, [
    { replyToken: "rt-1", text: "作成中" },
    { replyToken: undefined, text: "新案1" },
    { replyToken: undefined, text: "新案2" },
  ]);
});

test("ハンドラが例外でも落ちずエラー返信する", async () => {
  const rec: Rec = { sent: [], gate: [], pending: null, jobs: 0 };
  await send(
    deps(rec, {
      handleGateCommand: async () => {
        throw new Error("boom");
      },
    }),
    "承認 G1",
  );
  assert.equal(rec.sent.length, 1);
  assert.match(rec.sent[0].text, /エラー/);
});

test("「修正 2026 年の予定」: G なしで台帳に無い番号は通常文として扱い、gate に渡さない", async () => {
  const rec: Rec = { sent: [], gate: [], pending: null, jobs: 0 };
  await send(deps(rec, { isKnownGateId: () => false }), "修正 2026 年の予定");
  assert.equal(rec.gate.length, 0);
  const rec2: Rec = { sent: [], gate: [], pending: null, jobs: 0 };
  await send(deps(rec2, { isKnownGateId: () => true }), "修正 2026 年の予定");
  assert.equal(rec2.gate.length, 1);
  // G 付きは台帳に無くても gate に渡して「ありません」と返す
  const rec3: Rec = { sent: [], gate: [], pending: null, jobs: 0 };
  await send(deps(rec3, { isKnownGateId: () => false }), "修正 G99 短く");
  assert.equal(rec3.gate.length, 1);
});

test("「承認」だけ（id なし）は gate に渡さない／許可外ユーザーも無視", async () => {
  const rec: Rec = { sent: [], gate: [], pending: null, jobs: 0 };
  await send(deps(rec), "承認");
  assert.equal(rec.gate.length, 0);
  const rec2: Rec = { sent: [], gate: [], pending: null, jobs: 0 };
  await send(deps(rec2), "承認 G1", "Uother");
  assert.equal(rec2.gate.length, 0);
  assert.equal(rec2.sent.length, 0);
});
