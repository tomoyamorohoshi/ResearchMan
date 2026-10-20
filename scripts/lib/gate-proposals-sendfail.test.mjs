// proposeGateChange: LINE 送信に失敗した案を pending のまま残さない（承認できない案が重複判定を塞ぐのを防ぐ）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { proposeGateChange, loadProposals, STATUSES } from "./gate-proposals.mjs";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gps-"));
  const gatePath = path.join(dir, "gate.json");
  fs.writeFileSync(gatePath, JSON.stringify({ criteria: [{ id: "A", text: "現行A" }, { id: "B", text: "現行B" }, { id: "C", text: "c" }, { id: "D", text: "d" }] }));
  return { file: path.join(dir, "p.json"), gatePath };
}
const input = { criterionId: "A", after: "新A", reason: "r", evidence: [] };

test("送信失敗なら状態は send-failed（pending でない）", async () => {
  const { file, gatePath } = fixture();
  const r = await proposeGateChange(input, { file, gatePath, sendLine: async () => ({ ok: false, reason: "no-token" }) });
  assert.equal(r.sent.ok, false);
  assert.equal(r.proposal.status, "send-failed");
  assert.equal(loadProposals(file).proposals[0].status, "send-failed");
  assert.ok(STATUSES.includes("send-failed"));
});

test("送信成功なら pending のまま", async () => {
  const { file, gatePath } = fixture();
  const r = await proposeGateChange(input, { file, gatePath, sendLine: async () => ({ ok: true }) });
  assert.equal(r.proposal.status, "pending");
  assert.equal(loadProposals(file).proposals[0].status, "pending");
});

test("sendLine が例外でも send-failed", async () => {
  const { file, gatePath } = fixture();
  const r = await proposeGateChange(input, { file, gatePath, sendLine: async () => { throw new Error("boom"); } });
  assert.equal(r.proposal.status, "send-failed");
});
