/**
 * reply.ts::replyOrPushLineMessage の分岐テスト（reply優先・失敗時push フォールバック）。
 * 実HTTP通信はしない。webhook.tsのdeps注入と同じ流儀で、reply/push呼び出し自体を
 * フェイクに差し替えて分岐だけを検証する。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { replyOrPushLineMessage, replyOrPushLineMessages, type ReplyResult } from "./reply.js";
import type { LineMessage } from "./xpostPure.js";

interface Calls {
  replyCalls: Array<{ token: string; replyToken: string; text: string }>;
  pushCalls: Array<{ token: string; userId: string; text: string }>;
}

function buildDeps(calls: Calls, replyResult: ReplyResult) {
  return {
    reply: async (token: string, replyToken: string, text: string): Promise<ReplyResult> => {
      calls.replyCalls.push({ token, replyToken, text });
      return replyResult;
    },
    push: async (token: string, userId: string, text: string): Promise<void> => {
      calls.pushCalls.push({ token, userId, text });
    },
  };
}

test("replyTokenがありreply成功なら、pushへはフォールバックしない", async () => {
  const calls: Calls = { replyCalls: [], pushCalls: [] };
  await replyOrPushLineMessage("tok", "replyTok-1", "U1", "こんにちは", buildDeps(calls, { ok: true, status: 200, body: "{}" }));
  assert.deepEqual(calls.replyCalls, [{ token: "tok", replyToken: "replyTok-1", text: "こんにちは" }]);
  assert.equal(calls.pushCalls.length, 0);
});

test("replyが失敗（期限切れ等）ならpushへフォールバックする", async () => {
  const calls: Calls = { replyCalls: [], pushCalls: [] };
  await replyOrPushLineMessage("tok", "replyTok-expired", "U1", "こんにちは", buildDeps(calls, { ok: false, status: 400, body: "Invalid reply token" }));
  assert.equal(calls.replyCalls.length, 1);
  assert.deepEqual(calls.pushCalls, [{ token: "tok", userId: "U1", text: "こんにちは" }]);
});

test("reply呼び出しが例外を投げてもpushへフォールバックする", async () => {
  const calls: Calls = { replyCalls: [], pushCalls: [] };
  const deps = {
    reply: async (): Promise<ReplyResult> => {
      throw new Error("network error");
    },
    push: async (token: string, userId: string, text: string): Promise<void> => {
      calls.pushCalls.push({ token, userId, text });
    },
  };
  await replyOrPushLineMessage("tok", "replyTok-1", "U1", "こんにちは", deps);
  assert.deepEqual(calls.pushCalls, [{ token: "tok", userId: "U1", text: "こんにちは" }]);
});

test("replyTokenが無ければreplyを試さずpushする", async () => {
  const calls: Calls = { replyCalls: [], pushCalls: [] };
  await replyOrPushLineMessage("tok", undefined, "U1", "こんにちは", buildDeps(calls, { ok: true, status: 200, body: "{}" }));
  assert.equal(calls.replyCalls.length, 0);
  assert.deepEqual(calls.pushCalls, [{ token: "tok", userId: "U1", text: "こんにちは" }]);
});

// ── replyOrPushLineMessages（複数吹き出し。X投稿） ──────────────────────

interface MessagesCalls {
  replyCalls: Array<{ token: string; replyToken: string; messages: LineMessage[] }>;
  pushCalls: Array<{ token: string; userId: string; messages: LineMessage[] }>;
}

function buildMessagesDeps(calls: MessagesCalls, replyResult: ReplyResult) {
  return {
    reply: async (token: string, replyToken: string, messages: LineMessage[]): Promise<ReplyResult> => {
      calls.replyCalls.push({ token, replyToken, messages });
      return replyResult;
    },
    push: async (token: string, userId: string, messages: LineMessage[]): Promise<void> => {
      calls.pushCalls.push({ token, userId, messages });
    },
  };
}

const SAMPLE_MESSAGES: LineMessage[] = [
  { type: "text", text: "postA" },
  { type: "text", text: "postB" },
  { type: "text", text: "reply" },
  { type: "image", originalContentUrl: "https://research-man.vercel.app/thumbnails/foo.jpg", previewImageUrl: "https://research-man.vercel.app/thumbnails/foo.jpg" },
];

test("replyOrPushLineMessages: reply成功ならpushへフォールバックしない", async () => {
  const calls: MessagesCalls = { replyCalls: [], pushCalls: [] };
  await replyOrPushLineMessages("tok", "replyTok-1", "U1", SAMPLE_MESSAGES, buildMessagesDeps(calls, { ok: true, status: 200, body: "{}" }));
  assert.deepEqual(calls.replyCalls, [{ token: "tok", replyToken: "replyTok-1", messages: SAMPLE_MESSAGES }]);
  assert.equal(calls.pushCalls.length, 0);
});

test("replyOrPushLineMessages: reply失敗ならpushへフォールバックする", async () => {
  const calls: MessagesCalls = { replyCalls: [], pushCalls: [] };
  await replyOrPushLineMessages("tok", "replyTok-1", "U1", SAMPLE_MESSAGES, buildMessagesDeps(calls, { ok: false, status: 400, body: "Invalid reply token" }));
  assert.equal(calls.replyCalls.length, 1);
  assert.deepEqual(calls.pushCalls, [{ token: "tok", userId: "U1", messages: SAMPLE_MESSAGES }]);
});

test("replyOrPushLineMessages: replyTokenが無ければreplyを試さずpushする", async () => {
  const calls: MessagesCalls = { replyCalls: [], pushCalls: [] };
  await replyOrPushLineMessages("tok", undefined, "U1", SAMPLE_MESSAGES, buildMessagesDeps(calls, { ok: true, status: 200, body: "{}" }));
  assert.equal(calls.replyCalls.length, 0);
  assert.deepEqual(calls.pushCalls, [{ token: "tok", userId: "U1", messages: SAMPLE_MESSAGES }]);
});
