/**
 * 基準の変更案の LINE 返信処理（承認/却下/修正）のフロー統合テスト。
 * 台帳・case-gate.json は一時ディレクトリ。git push・監査・Claude CLI・LINE送信はすべて注入（モック）。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProposal, getProposal } from "../../../scripts/lib/gate-proposals.mjs";
import { handleGateCommand, type GateFlowDeps } from "./gateProposalFlow.js";

const evidence = [{ kind: "fav", title: "良い事例", url: "https://example.com/a", signal: "fav" }];

function setup(over: Partial<GateFlowDeps> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gateflow-"));
  const gatePath = path.join(dir, "case-gate.json");
  fs.copyFileSync(new URL("../../../data/case-gate.json", import.meta.url), gatePath);
  const file = path.join(dir, "gate-proposals.json");
  const now = new Date("2026-10-20T12:00:00Z");
  const calls = { audit: 0, commit: [] as string[], alerts: [] as string[], prompts: [] as string[] };
  const deps: GateFlowDeps = {
    file,
    gatePath,
    now: () => now,
    audit: async () => (calls.audit++, { ok: true, detail: "" }),
    commitPush: async (msg) => (calls.commit.push(msg), { ok: true }),
    generateRevision: async (prompt) => (calls.prompts.push(prompt), '{"after":"短いB","reason":"短くした"}'),
    recordAlert: (title, body) => void calls.alerts.push(`${title}|${body}`),
    ...over,
  };
  const opts = { file, gatePath, now };
  return { deps, calls, opts, gatePath, file };
}
const bText = (gatePath: string): string => JSON.parse(fs.readFileSync(gatePath, "utf-8")).criteria.find((c: { id: string }) => c.id === "B").text;

test("承認: 適用→監査→commit/push→『反映しました』・approved", async () => {
  const { deps, calls, opts, gatePath } = setup();
  const p = createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const r = await handleGateCommand({ action: "approve", id: 1, feedback: "" }, deps);
  assert.match(r.reply, /反映しました/);
  assert.equal(bText(gatePath), "新B");
  assert.equal(calls.audit, 1);
  assert.equal(calls.commit.length, 1);
  assert.match(calls.commit[0], /G1/);
  assert.equal(getProposal(p.id, opts).status, "approved");
});

test("承認: 監査失敗 → ファイルを戻し、失敗を返信・alert・pending のまま", async () => {
  const { deps, calls, opts, gatePath } = setup({ audit: async () => ({ ok: false, detail: "テスト失敗" }) });
  const before = fs.readFileSync(gatePath, "utf-8");
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const r = await handleGateCommand({ action: "approve", id: 1, feedback: "" }, deps);
  assert.match(r.reply, /失敗/);
  assert.equal(fs.readFileSync(gatePath, "utf-8"), before);
  assert.equal(calls.commit.length, 0);
  assert.equal(calls.alerts.length, 1);
  assert.equal(getProposal("G1", opts).status, "pending");
});

test("承認: commit/push 失敗 → ファイルを戻し、失敗を返信・alert", async () => {
  const { deps, calls, opts, gatePath } = setup({ commitPush: async () => ({ ok: false, error: "main ではない" }) });
  const before = fs.readFileSync(gatePath, "utf-8");
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const r = await handleGateCommand({ action: "approve", id: 1, feedback: "" }, deps);
  assert.match(r.reply, /失敗/);
  assert.match(r.reply, /main ではない/);
  assert.equal(fs.readFileSync(gatePath, "utf-8"), before);
  assert.equal(calls.alerts.length, 1);
  assert.equal(getProposal("G1", opts).status, "pending");
});

test("承認: before 不一致(衝突)は適用せず監査・pushもしない", async () => {
  const { deps, calls, opts, gatePath } = setup();
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const g = JSON.parse(fs.readFileSync(gatePath, "utf-8"));
  g.criteria.find((c: { id: string }) => c.id === "B").text = "先に変更";
  fs.writeFileSync(gatePath, JSON.stringify(g, null, 2));
  const r = await handleGateCommand({ action: "approve", id: 1, feedback: "" }, deps);
  assert.match(r.reply, /変わっている|衝突/);
  assert.equal(bText(gatePath), "先に変更");
  assert.equal(calls.audit, 0);
  assert.equal(calls.commit.length, 0);
});

test("承認: 存在しないid・処理済み・期限切れは状態が分かる返信で何もしない", async () => {
  const { deps, calls, opts } = setup();
  let r = await handleGateCommand({ action: "approve", id: 9, feedback: "" }, deps);
  assert.match(r.reply, /G9/);
  assert.match(r.reply, /ありません/);
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  await handleGateCommand({ action: "approve", id: 1, feedback: "" }, deps);
  r = await handleGateCommand({ action: "approve", id: 1, feedback: "" }, deps);
  assert.match(r.reply, /処理済み/);
  assert.match(r.reply, /承認済み/);
  assert.equal(calls.commit.length, 1); // 再承認では commit しない
  createProposal({ criterionId: "C", after: "新C", reason: "r", evidence }, { ...opts, now: new Date("2026-10-01T00:00:00Z") });
  r = await handleGateCommand({ action: "approve", id: 2, feedback: "" }, deps);
  assert.match(r.reply, /期限切れ/);
});

test("承認: 送信失敗(send-failed)の案は承認不可で、状態ラベルが分かる返信", async () => {
  const { deps, calls, opts } = setup();
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const store = JSON.parse(fs.readFileSync(opts.file, "utf-8"));
  store.proposals[0].status = "send-failed";
  fs.writeFileSync(opts.file, JSON.stringify(store));
  const r = await handleGateCommand({ action: "approve", id: 1, feedback: "" }, deps);
  assert.match(r.reply, /送信失敗/);
  assert.equal(calls.commit.length, 0);
});

test("却下: rejected・返信。再却下は処理済み", async () => {
  const { deps, opts } = setup();
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  let r = await handleGateCommand({ action: "reject", id: 1, feedback: "" }, deps);
  assert.match(r.reply, /却下/);
  assert.equal(getProposal("G1", opts).status, "rejected");
  r = await handleGateCommand({ action: "reject", id: 1, feedback: "" }, deps);
  assert.match(r.reply, /処理済み/);
});

test("修正: 受付時は『作成中』、バックグラウンドで新id案を作り superseded、再送文を返す", async () => {
  const { deps, calls, opts } = setup();
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const r = await handleGateCommand({ action: "revise", id: 1, feedback: "もっと短く\n2行目" }, deps);
  assert.match(r.reply, /修正案を作成中/);
  assert.ok(r.background);
  assert.equal(getProposal("G1", opts).feedback[0].text, "もっと短く\n2行目");
  const msgs = await r.background!();
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /#G2/);
  assert.match(msgs[0], /短いB/);
  assert.equal(getProposal("G1", opts).status, "superseded");
  assert.equal(getProposal("G2", opts).supersedes, "G1");
  assert.match(calls.prompts[0], /もっと短く/);
});

test("修正: 生成失敗時は失敗を返信・alert、元の案は pending のまま", async () => {
  const { deps, calls, opts } = setup({
    generateRevision: async () => {
      throw new Error("claude落ちた");
    },
  });
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const r = await handleGateCommand({ action: "revise", id: 1, feedback: "短く" }, deps);
  const msgs = await r.background!();
  assert.match(msgs[0], /失敗/);
  assert.equal(calls.alerts.length, 1);
  assert.equal(getProposal("G1", opts).status, "pending");
});

test("修正: フィードバック空・存在しないid・処理済みは background なし", async () => {
  const { deps, opts } = setup();
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  let r = await handleGateCommand({ action: "revise", id: 1, feedback: "" }, deps);
  assert.match(r.reply, /修正 G1/);
  assert.equal(r.background, undefined);
  r = await handleGateCommand({ action: "revise", id: 5, feedback: "x" }, deps);
  assert.match(r.reply, /ありません/);
  assert.equal(r.background, undefined);
  await handleGateCommand({ action: "reject", id: 1, feedback: "" }, deps);
  r = await handleGateCommand({ action: "revise", id: 1, feedback: "x" }, deps);
  assert.match(r.reply, /処理済み/);
  assert.equal(r.background, undefined);
});
