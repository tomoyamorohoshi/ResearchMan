// tuneup-gate-proposal.mjs のテスト（node:test）。v3 §5-§6: 基準文の変更案の作成条件。
// 実行: node --test scripts/lib/tuneup-gate-proposal.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGateProposalStage } from "./tuneup-gate-proposal.mjs";

const NOW = new Date("2026-10-27T03:00:00Z");
const gate = { criteria: [{ id: "A", text: "現行A" }, { id: "B", text: "現行B" }, { id: "C", text: "現行C" }, { id: "D", text: "現行D" }] };
const pool = [
  { title: "良かった例", link: "https://ex.com/good", signal: "fav" },
  { title: "悪かった例", link: "https://ex.com/bad", signal: "trash" },
];
const ai = (o = {}) => ({
  criterionId: "B",
  after: "新B",
  reason: "borderline の trash が演出頼みに偏る",
  evidence: [{ title: "良かった例", signal: "fav" }, { title: "悪かった例", signal: "trash" }],
  ...o,
});
const noPending = () => ({ version: 1, nextSeq: 1, proposals: [] });
const mkFns = () => {
  const calls = [];
  return {
    calls,
    proposeFn: async (input) => {
      calls.push(input);
      return { proposal: { id: "G1", ...input }, sent: { ok: true } };
    },
  };
};

test("AI の案が null/未指定なら何もしない", async () => {
  const f = mkFns();
  for (const p of [null, undefined]) {
    const r = await runGateProposalStage({ aiProposal: p, gate, evidencePool: pool, loadFn: noPending, proposeFn: f.proposeFn, dryRun: false, now: NOW });
    assert.equal(r.status, "none");
  }
  assert.equal(f.calls.length, 0);
});

test("正常: proposeGateChange を {criterionId, after, reason, evidence} で呼ぶ。evidence は実在する fav/trash 例のみ(url/signalはpool由来)", async () => {
  const f = mkFns();
  const r = await runGateProposalStage({
    aiProposal: ai({ evidence: [{ title: "良かった例", signal: "trash" }, { title: "存在しない例", signal: "fav" }] }),
    gate, evidencePool: pool, loadFn: noPending, proposeFn: f.proposeFn, dryRun: false, now: NOW,
  });
  assert.equal(r.status, "proposed");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].criterionId, "B");
  assert.equal(f.calls[0].after, "新B");
  assert.deepEqual(f.calls[0].evidence, [{ kind: "fav", title: "良かった例", url: "https://ex.com/good", signal: "fav" }]);
});

test("同じ基準に pending の案があれば作らない / 別基準の pending なら作る", async () => {
  const f = mkFns();
  const store = (criterionId, status = "pending", expiresAt = "2026-11-01T00:00:00Z") => () => ({ version: 1, nextSeq: 2, proposals: [{ id: "G1", status, criterionId, expiresAt }] });
  const r1 = await runGateProposalStage({ aiProposal: ai(), gate, evidencePool: pool, loadFn: store("B"), proposeFn: f.proposeFn, dryRun: false, now: NOW });
  assert.equal(r1.status, "skipped-pending");
  assert.equal(f.calls.length, 0);
  const r2 = await runGateProposalStage({ aiProposal: ai(), gate, evidencePool: pool, loadFn: store("A"), proposeFn: f.proposeFn, dryRun: false, now: NOW });
  assert.equal(r2.status, "proposed");
  // pending 以外(承認済み・失効済み)や、期限切れの pending は重複扱いにしない
  const r3 = await runGateProposalStage({ aiProposal: ai(), gate, evidencePool: pool, loadFn: store("B", "approved"), proposeFn: f.proposeFn, dryRun: false, now: NOW });
  assert.equal(r3.status, "proposed");
  const r4 = await runGateProposalStage({ aiProposal: ai(), gate, evidencePool: pool, loadFn: store("B", "pending", "2026-10-01T00:00:00Z"), proposeFn: f.proposeFn, dryRun: false, now: NOW });
  assert.equal(r4.status, "proposed");
});

test("AI が前提にした文面と現行文面が違えば（分析中に承認で変わった）提案を見送る", async () => {
  const f = mkFns();
  const premiseGate = { criteria: gate.criteria.map((c) => (c.id === "B" ? { ...c, text: "分析開始時のB" } : c)) };
  const r = await runGateProposalStage({ aiProposal: ai(), gate, premiseGate, evidencePool: pool, loadFn: noPending, proposeFn: f.proposeFn, dryRun: false, now: NOW });
  assert.equal(r.status, "skipped-changed");
  assert.match(r.reason, /B/);
  assert.equal(f.calls.length, 0);
  // 他の基準が変わっていても、提案対象の基準が同じなら進める
  const premise2 = { criteria: gate.criteria.map((c) => (c.id === "A" ? { ...c, text: "別のA" } : c)) };
  const r2 = await runGateProposalStage({ aiProposal: ai(), gate, premiseGate: premise2, evidencePool: pool, loadFn: noPending, proposeFn: f.proposeFn, dryRun: false, now: NOW });
  assert.equal(r2.status, "proposed");
});

test("gate が読めない(null)ときは提案しない（v3関連のみスキップ）", async () => {
  const f = mkFns();
  const r = await runGateProposalStage({ aiProposal: ai(), gate: null, evidencePool: pool, loadFn: noPending, proposeFn: f.proposeFn, dryRun: false, now: NOW });
  assert.equal(r.status, "none");
  assert.equal(f.calls.length, 0);
});

test("dry-run では proposeFn(=LINE送信) を呼ばず、案の内容を返す", async () => {
  const f = mkFns();
  const r = await runGateProposalStage({ aiProposal: ai(), gate, evidencePool: pool, loadFn: noPending, proposeFn: f.proposeFn, dryRun: true, now: NOW });
  assert.equal(r.status, "dry-run");
  assert.equal(f.calls.length, 0);
  assert.equal(r.normalized.criterionId, "B");
  assert.equal(r.normalized.before, "現行B");
  assert.equal(r.normalized.after, "新B");
});

test("不正な案は invalid（基準ID不正・after空・現行と同文・根拠ゼロ・reason空）", async () => {
  const f = mkFns();
  const bad = [ai({ criterionId: "Z" }), ai({ after: "  " }), ai({ after: "現行B" }), ai({ evidence: [] }), ai({ evidence: [{ title: "存在しない", signal: "fav" }] }), ai({ reason: "" })];
  for (const p of bad) {
    const r = await runGateProposalStage({ aiProposal: p, gate, evidencePool: pool, loadFn: noPending, proposeFn: f.proposeFn, dryRun: false, now: NOW });
    assert.equal(r.status, "invalid", JSON.stringify(p));
    assert.ok(r.reason);
  }
  assert.equal(f.calls.length, 0);
});

test("proposeFn が例外でも落ちず status=error を返す(週次見直し本体を止めない)", async () => {
  const r = await runGateProposalStage({ aiProposal: ai(), gate, evidencePool: pool, loadFn: noPending, proposeFn: async () => { throw new Error("boom"); }, dryRun: false, now: NOW });
  assert.equal(r.status, "error");
  assert.match(r.reason, /boom/);
});

test("LINE送信失敗(sent.ok=false)でも案は保存済みとして proposed を返し sent を伝える", async () => {
  const r = await runGateProposalStage({ aiProposal: ai(), gate, evidencePool: pool, loadFn: noPending, proposeFn: async (i) => ({ proposal: { id: "G2", ...i }, sent: { ok: false, reason: "no-token" } }), dryRun: false, now: NOW });
  assert.equal(r.status, "proposed");
  assert.equal(r.sent.ok, false);
});

test("週次見直し本体は実行の最初(データ読み込みより前)に expireProposals を呼ぶ", () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "biweekly-tuneup.mjs"), "utf-8");
  const iExpire = src.indexOf("expireProposals(");
  const iFirstRead = src.indexOf("await readJson(CASES_PATH)");
  assert.ok(iExpire > 0, "expireProposals の呼び出しが無い");
  assert.ok(iFirstRead > 0);
  assert.ok(iExpire < iFirstRead, "expireProposals は最初の読み込みより前");
  assert.ok(src.includes("proposeGateChange"), "proposeGateChange の配線が無い");
});
