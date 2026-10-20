/** レビュー指摘対応: ロック・直列化・修正中の承認拒否・未コミット検査・markApproved失敗。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProposal, getProposal } from "../../../scripts/lib/gate-proposals.mjs";
import { handleGateCommand, type GateFlowDeps } from "./gateProposalFlow.js";

const evidence = [{ kind: "fav", title: "t", url: "https://example.com/a", signal: "fav" }];

function setup(over: Partial<GateFlowDeps> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gateflow2-"));
  const gatePath = path.join(dir, "case-gate.json");
  fs.copyFileSync(new URL("../../../data/case-gate.json", import.meta.url), gatePath);
  const file = path.join(dir, "gate-proposals.json");
  const now = new Date("2026-10-20T12:00:00Z");
  const log: string[] = [];
  const deps: GateFlowDeps = {
    file,
    gatePath,
    now: () => now,
    audit: async () => (log.push("audit"), { ok: true, detail: "" }),
    commitPush: async () => (log.push("commit"), { ok: true }),
    generateRevision: async () => '{"after":"短いB","reason":"r"}',
    recordAlert: (title) => void log.push(`alert:${title}`),
    acquireLock: () => (log.push("lock"), { release: () => void log.push("unlock") }),
    checkClean: async () => (log.push("clean"), { ok: true, detail: "" }),
    ...over,
  };
  return { deps, log, opts: { file, gatePath, now }, gatePath, file };
}
const bText = (g: string): string => JSON.parse(fs.readFileSync(g, "utf-8")).criteria.find((c: { id: string }) => c.id === "B").text;

test("承認: ロック→未コミット検査→適用→監査→commit→解放の順", async () => {
  const { deps, log, opts } = setup();
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  await handleGateCommand({ action: "approve", id: 1, feedback: "" }, deps);
  assert.deepEqual(log, ["lock", "clean", "audit", "commit", "unlock"]);
});

test("承認: ロックが取れなければ書き込まず案内を返す", async () => {
  const { deps, opts, gatePath } = setup({ acquireLock: () => null });
  const before = fs.readFileSync(gatePath, "utf-8");
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const r = await handleGateCommand({ action: "approve", id: 1, feedback: "" }, deps);
  assert.match(r.reply, /使用中|後で/);
  assert.equal(fs.readFileSync(gatePath, "utf-8"), before);
  assert.equal(getProposal("G1", opts).status, "pending");
});

test("承認: 失敗でもロックは解放される", async () => {
  const { deps, log, opts } = setup({ audit: async () => ({ ok: false, detail: "x" }) });
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  await handleGateCommand({ action: "approve", id: 1, feedback: "" }, deps);
  assert.equal(log.filter((l) => l === "unlock").length, 1);
});

test("承認: 作業ツリーに未コミット変更があれば適用しない", async () => {
  const { deps, log, opts, gatePath } = setup({ checkClean: async () => ({ ok: false, detail: "diff" }) });
  const before = fs.readFileSync(gatePath, "utf-8");
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const r = await handleGateCommand({ action: "approve", id: 1, feedback: "" }, deps);
  assert.match(r.reply, /未コミット/);
  assert.equal(fs.readFileSync(gatePath, "utf-8"), before);
  assert.ok(!log.includes("audit"));
  assert.equal(getProposal("G1", opts).status, "pending");
});

test("承認同士は直列化される（同時に2つ走らない）", async () => {
  let running = 0;
  let maxRunning = 0;
  const { deps, opts } = setup({
    commitPush: async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 30));
      running--;
      return { ok: true };
    },
  });
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  createProposal({ criterionId: "C", after: "新C", reason: "r", evidence }, opts);
  await Promise.all([
    handleGateCommand({ action: "approve", id: 1, feedback: "" }, deps),
    handleGateCommand({ action: "approve", id: 2, feedback: "" }, deps),
  ]);
  assert.equal(maxRunning, 1);
  assert.equal(bText(opts.gatePath), "新B");
  assert.equal(getProposal("G2", opts).status, "approved");
});

test("修正の再生成中は承認・却下を処理せず案内する", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { deps, log, opts } = setup({ generateRevision: async () => (await gate, '{"after":"短いB","reason":"r"}') });
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const r = await handleGateCommand({ action: "revise", id: 1, feedback: "短く" }, deps);
  const bg = r.background!();
  for (const action of ["approve", "reject"] as const) {
    const x = await handleGateCommand({ action, id: 1, feedback: "" }, deps);
    assert.match(x.reply, /修正案を作成中です。完成後の新しい案に返信してください/);
  }
  assert.ok(!log.includes("commit"));
  assert.equal(getProposal("G1", opts).status, "pending");
  release();
  await bg;
});

test("push 成功後に markApproved が失敗したら『反映済み（台帳の更新に失敗）』＋alert", async () => {
  const { deps, log, opts, file } = setup();
  deps.commitPush = async () => {
    fs.writeFileSync(file, "{broken");
    return { ok: true };
  };
  createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const r = await handleGateCommand({ action: "approve", id: 1, feedback: "" }, deps);
  assert.match(r.reply, /反映済み/);
  assert.match(r.reply, /台帳の更新に失敗/);
  assert.equal(bText(opts.gatePath), "新B"); // ファイルは戻さない
  assert.ok(log.some((l) => l.startsWith("alert:")));
});
