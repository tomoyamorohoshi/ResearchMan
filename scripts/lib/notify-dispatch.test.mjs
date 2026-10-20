import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveNotifyKind, dispatchNotification, deriveAlertMeta } from "./notify-dispatch.mjs";
import { readSystemAlerts } from "./system-alerts.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-"));

test("resolveNotifyKind: 既定はsystem（安全側）", () => {
  assert.equal(resolveNotifyKind({ result: "ok", count: 3 }), "system");
  assert.equal(resolveNotifyKind({ kind: "bogus", result: "ok", count: 3 }), "system");
});

test("resolveNotifyKind: share明示 + ok + 新規1件以上 → share", () => {
  assert.equal(resolveNotifyKind({ kind: "share", result: "ok", count: 2 }), "share");
});

test("resolveNotifyKind: share明示でも 0件 / error / pushfail / unverified は system", () => {
  assert.equal(resolveNotifyKind({ kind: "share", result: "ok", count: 0 }), "system");
  for (const result of ["error", "pushfail", "unverified"]) {
    assert.equal(resolveNotifyKind({ kind: "share", result, count: 5 }), "system", result);
  }
});

test("resolveNotifyKind: --text-file のshare明示（アイデアの種）は件数に関係なく share", () => {
  assert.equal(resolveNotifyKind({ kind: "share", result: "ok", count: 0, hasTextFile: true }), "share");
});

test("resolveNotifyKind: share明示が無い --text-file は system（watchdog/tuneup/keeper）", () => {
  assert.equal(resolveNotifyKind({ result: "ok", count: 0, hasTextFile: true }), "system");
});

test("resolveNotifyKind: context=studio（ユーザー依頼への返信）は常に share", () => {
  for (const result of ["ok", "error", "pushfail", "unverified"]) {
    assert.equal(resolveNotifyKind({ context: "studio", result, count: 0 }), "share", result);
  }
});

test("deriveAlertMeta: result/件数からlevel・title・sourceを決める", () => {
  assert.equal(deriveAlertMeta({ result: "error", label: "Technology", text: "x" }).level, "error");
  assert.equal(deriveAlertMeta({ result: "pushfail", text: "x" }).level, "error");
  assert.equal(deriveAlertMeta({ result: "unverified", text: "x" }).level, "warn");
  assert.equal(deriveAlertMeta({ result: "ok", text: "x" }).level, "info");
  assert.equal(deriveAlertMeta({ result: "ok", level: "warn", text: "x" }).level, "warn");
  assert.equal(deriveAlertMeta({ result: "ok", text: "1行目\n2行目" }).title, "1行目");
  assert.equal(deriveAlertMeta({ result: "ok", title: "指定", text: "1行目" }).title, "指定");
  assert.equal(deriveAlertMeta({ result: "ok", source: "watchdog", text: "x" }).source, "watchdog");
  assert.equal(deriveAlertMeta({ result: "ok", label: "Technology", text: "x" }).source, "notify-line:Technology");
  assert.equal(deriveAlertMeta({ result: "ok", route: "exhibition", text: "x" }).source, "notify-line:exhibition");
});

test("dispatchNotification: share は送信関数が呼ばれ、jsonlには書かない", async () => {
  const dir = tmp();
  const sent = [];
  const r = await dispatchNotification(
    { kind: "share", result: "ok", count: 2, text: "追加しました" },
    { send: async (t) => { sent.push(t); return { ok: true }; }, logsDir: dir },
  );
  assert.equal(r.route, "share");
  assert.deepEqual(sent, ["追加しました"]);
  assert.equal(readSystemAlerts(dir).length, 0);
});

test("dispatchNotification: system は送信関数を呼ばず jsonl に追記する", async () => {
  const dir = tmp();
  let called = 0;
  const r = await dispatchNotification(
    { result: "error", label: "Technology", text: "❌ ResearchMan Technology: 収集がエラー終了\n\n詳細" },
    { send: async () => { called++; return { ok: true }; }, logsDir: dir },
  );
  assert.equal(r.route, "system");
  assert.equal(called, 0);
  const [a] = readSystemAlerts(dir);
  assert.equal(a.level, "error");
  assert.match(a.title, /収集がエラー終了/);
  assert.match(a.body, /詳細/);
  assert.equal(a.source, "notify-line:Technology");
});

test("dispatchNotification: share でも 0件ok は system に回る", async () => {
  const dir = tmp();
  let called = 0;
  const r = await dispatchNotification(
    { kind: "share", result: "ok", count: 0, text: "本日の新規追加なし" },
    { send: async () => { called++; }, logsDir: dir },
  );
  assert.equal(r.route, "system");
  assert.equal(called, 0);
  assert.equal(readSystemAlerts(dir).length, 1);
});

test("dispatchNotification: dryRun は送信も記録もしない", async () => {
  const dir = tmp();
  const r = await dispatchNotification(
    { result: "error", text: "x" },
    { send: async () => { throw new Error("no"); }, logsDir: dir, dryRun: true },
  );
  assert.equal(r.route, "system");
  assert.equal(r.recorded, false);
  assert.equal(readSystemAlerts(dir).length, 0);
});
