// gate-proposals.mjs の単体テスト（node:test）。実LINE送信・git・Claude CLIは使わない（注入）。
// 実行: node --test scripts/lib/gate-proposals.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCaseGate } from "./case-gate-criteria.mjs";
import {
  parseGateId,
  formatGateId,
  createProposal,
  loadProposals,
  getProposal,
  buildProposalMessage,
  sendProposal,
  proposeGateChange,
  applyProposal,
  restoreGate,
  markApproved,
  rejectProposal,
  addFeedback,
  completeRevision,
  expireProposals,
  buildRevisionPrompt,
  parseRevisionOutput,
  PROPOSAL_TTL_DAYS,
} from "./gate-proposals.mjs";

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gateprop-"));
  const gatePath = path.join(dir, "case-gate.json");
  fs.copyFileSync(new URL("../../data/case-gate.json", import.meta.url), gatePath);
  const file = path.join(dir, "inbox", "gate-proposals.json");
  const t0 = new Date("2026-10-20T12:00:00Z");
  return { dir, gatePath, file, t0, opts: { file, gatePath, now: t0 } };
}
const evidence = [
  { kind: "fav", title: "良い事例X", url: "https://example.com/x", signal: "fav" },
  { kind: "trash", title: "悪い事例Y", url: "https://example.com/y", signal: "trash" },
];
const gateText = (gatePath, id) => JSON.parse(fs.readFileSync(gatePath, "utf-8")).criteria.find((c) => c.id === id).text;

test("parseGateId: G12 / g12 / 12 / 全角を受け付ける", () => {
  for (const s of ["G12", "g12", "12", "Ｇ１２", "ｇ12", " G12 "]) assert.equal(parseGateId(s), 12, s);
  for (const s of ["", "G", "Gx", "12a", "-1", "G0", "abc"]) assert.equal(parseGateId(s), null, s);
  assert.equal(formatGateId(12), "G12");
});

test("createProposal: 連番ID・pending・7日後失効・before は現行文面", () => {
  const { gatePath, opts, t0 } = setup();
  const p1 = createProposal({ criterionId: "B", after: "新B", reason: "理由", evidence }, opts);
  const p2 = createProposal({ criterionId: "C", after: "新C", reason: "理由", evidence }, opts);
  assert.equal(p1.id, "G1");
  assert.equal(p2.id, "G2");
  assert.equal(p1.status, "pending");
  assert.equal(p1.before, gateText(gatePath, "B"));
  assert.equal(new Date(p1.expiresAt).getTime() - t0.getTime(), PROPOSAL_TTL_DAYS * 86400000);
  assert.equal(PROPOSAL_TTL_DAYS, 7);
  assert.deepEqual(p1.feedback, []);
  assert.equal(p1.supersedes, null);
  assert.equal(loadProposals(opts.file).proposals.length, 2);
});

test("createProposal: 不正な基準id・空after・変更なしは例外", () => {
  const { opts, gatePath } = setup();
  assert.throws(() => createProposal({ criterionId: "Z", after: "x", reason: "r", evidence }, opts));
  assert.throws(() => createProposal({ criterionId: "A", after: "  ", reason: "r", evidence }, opts));
  assert.throws(() => createProposal({ criterionId: "A", after: gateText(gatePath, "A"), reason: "r", evidence }, opts));
});

test("buildProposalMessage: ID・変更前後・理由・根拠・操作方法・期限が入る", () => {
  const { opts } = setup();
  const p = createProposal({ criterionId: "B", after: "新しいB文面", reason: "最近のトラッシュ傾向", evidence }, opts);
  const msg = buildProposalMessage(p);
  for (const s of ["基準の変更案 #G1", "基準B", "変更前", p.before, "変更後", "新しいB文面", "理由", "最近のトラッシュ傾向", "良い事例X", "https://example.com/y", "承認 G1", "却下 G1", "修正 G1", "期限", "2026-10-27"]) {
    assert.ok(msg.includes(s), `含まれない: ${s}`);
  }
});

test("sendProposal: 注入した送信関数へ本文を渡す", async () => {
  const { opts } = setup();
  const p = createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const sent = [];
  const r = await sendProposal(p, { sendLine: async (text) => (sent.push(text), { ok: true }) });
  assert.equal(r.ok, true);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes("#G1"));
});

test("proposeGateChange: 作成と送信を行う", async () => {
  const { opts } = setup();
  const sent = [];
  const { proposal, sent: s } = await proposeGateChange({ criterionId: "D", after: "新D", reason: "r", evidence }, { ...opts, sendLine: async (t) => (sent.push(t), { ok: true }) });
  assert.equal(proposal.id, "G1");
  assert.equal(s.ok, true);
  assert.equal(sent.length, 1);
});

test("applyProposal: 該当基準だけが変わり validate を通る。承認確定までは pending のまま", () => {
  const { opts, gatePath } = setup();
  const orig = loadCaseGate(gatePath);
  const p = createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const r = applyProposal(p.id, opts);
  assert.equal(r.ok, true);
  const now = loadCaseGate(gatePath);
  assert.equal(now.criteria.find((c) => c.id === "B").text, "新B");
  for (const id of ["A", "C", "D"]) assert.equal(now.criteria.find((c) => c.id === id).text, orig.criteria.find((c) => c.id === id).text);
  assert.deepEqual(now.tasteTypes, orig.tasteTypes);
  assert.deepEqual(now.litmus, orig.litmus);
  assert.equal(now.rejectTypical, orig.rejectTypical);
  assert.equal(getProposal(p.id, opts).status, "pending");
  markApproved(p.id, opts);
  assert.equal(getProposal(p.id, opts).status, "approved");
});

test("applyProposal: restoreGate で元に戻る", () => {
  const { opts, gatePath } = setup();
  const before = fs.readFileSync(gatePath, "utf-8");
  const p = createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const r = applyProposal(p.id, opts);
  assert.notEqual(fs.readFileSync(gatePath, "utf-8"), before);
  restoreGate(r.backup, gatePath);
  assert.equal(fs.readFileSync(gatePath, "utf-8"), before);
});

test("applyProposal: 現行文面が before と違えば衝突で書き込まない", () => {
  const { opts, gatePath } = setup();
  const p = createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const g = JSON.parse(fs.readFileSync(gatePath, "utf-8"));
  g.criteria.find((c) => c.id === "B").text = "誰かが先に変えた";
  fs.writeFileSync(gatePath, JSON.stringify(g, null, 2));
  const snapshot = fs.readFileSync(gatePath, "utf-8");
  const r = applyProposal(p.id, opts);
  assert.equal(r.ok, false);
  assert.equal(r.code, "conflict");
  assert.equal(fs.readFileSync(gatePath, "utf-8"), snapshot);
});

test("applyProposal: validateCaseGate に落ちる結果なら書き込まない", () => {
  const { opts, gatePath } = setup();
  const p = createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  // 台帳を直接改ざんして after を空にする（想定外データの防御）
  const store = loadProposals(opts.file);
  store.proposals[0].after = "";
  fs.writeFileSync(opts.file, JSON.stringify(store));
  const snapshot = fs.readFileSync(gatePath, "utf-8");
  const r = applyProposal(p.id, opts);
  assert.equal(r.ok, false);
  assert.equal(r.code, "invalid");
  assert.equal(fs.readFileSync(gatePath, "utf-8"), snapshot);
});

test("applyProposal: 存在しないid・処理済み・期限切れ", () => {
  const { opts } = setup();
  assert.equal(applyProposal("G99", opts).code, "not-found");
  const p = createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const later = { ...opts, now: new Date(opts.now.getTime() + 8 * 86400000) };
  const r = applyProposal(p.id, later);
  assert.equal(r.ok, false);
  assert.equal(r.code, "expired");
  assert.equal(getProposal(p.id, opts).status, "expired");
  const p2 = createProposal({ criterionId: "C", after: "新C", reason: "r", evidence }, opts);
  assert.equal(applyProposal(p2.id, opts).ok, true);
  markApproved(p2.id, opts);
  const again = applyProposal(p2.id, opts);
  assert.equal(again.ok, false);
  assert.equal(again.code, "not-pending");
  assert.equal(again.proposal.status, "approved");
});

test("rejectProposal: rejected になる。処理済みへの再却下は not-pending", () => {
  const { opts } = setup();
  const p = createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const r = rejectProposal(p.id, opts);
  assert.equal(r.ok, true);
  assert.equal(getProposal(p.id, opts).status, "rejected");
  assert.equal(rejectProposal(p.id, opts).code, "not-pending");
  assert.equal(rejectProposal("G77", opts).code, "not-found");
});

test("修正: フィードバック記録→新idで再作成、元は superseded、supersedes と evidence を引き継ぐ", () => {
  const { opts } = setup();
  const p = createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  const fb = addFeedback(p.id, "もっと短く\n2行目", opts);
  assert.equal(fb.ok, true);
  assert.equal(getProposal(p.id, opts).feedback[0].text, "もっと短く\n2行目");
  const r = completeRevision(p.id, { after: "短いB", reason: "短縮した" }, opts);
  assert.equal(r.ok, true);
  assert.notEqual(r.proposal.id, p.id);
  assert.equal(r.proposal.supersedes, p.id);
  assert.equal(r.proposal.status, "pending");
  assert.equal(r.proposal.after, "短いB");
  assert.equal(r.proposal.criterionId, "B");
  assert.deepEqual(r.proposal.evidence, evidence);
  assert.equal(getProposal(p.id, opts).status, "superseded");
  // 処理済みへの修正は受け付けない
  assert.equal(addFeedback(p.id, "x", opts).code, "not-pending");
});

test("expireProposals: 7日超の pending だけ expired にする", () => {
  const { opts } = setup();
  const a = createProposal({ criterionId: "A", after: "新A", reason: "r", evidence }, opts);
  const later = { ...opts, now: new Date(opts.now.getTime() + 3 * 86400000) };
  const b = createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, later);
  const check = { ...opts, now: new Date(opts.now.getTime() + 8 * 86400000) };
  const expired = expireProposals(check);
  assert.deepEqual(expired.map((p) => p.id), [a.id]);
  assert.equal(getProposal(a.id, opts).status, "expired");
  assert.equal(getProposal(b.id, opts).status, "pending");
});

test("buildRevisionPrompt / parseRevisionOutput", () => {
  const { opts, gatePath } = setup();
  const p = createProposal({ criterionId: "B", after: "新B", reason: "r", evidence }, opts);
  addFeedback(p.id, "もっと短く", opts);
  const prompt = buildRevisionPrompt(getProposal(p.id, opts), loadCaseGate(gatePath));
  for (const s of [p.before, "新B", "もっと短く", "良い事例X", "基準B", "JSON"]) assert.ok(prompt.includes(s), s);
  assert.deepEqual(parseRevisionOutput('前置き {"after":"短いB","reason":"短縮"} 後書き'), { after: "短いB", reason: "短縮" });
  assert.equal(parseRevisionOutput("JSONなし"), null);
  assert.equal(parseRevisionOutput('{"after":"","reason":"x"}'), null);
});
