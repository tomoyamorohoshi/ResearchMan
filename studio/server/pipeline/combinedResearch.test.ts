/**
 * combinedResearch.ts のうち、依存注入で単体テスト可能な部分のみ検証する
 * （パイプライン本体はCase/Techパイプライン起動・ジョブ永続化に依存するためE2E/実運用の領分。
 * caseResearch.test.ts と同じ方針）。
 *
 * mergeCombinedPhases: Case→Tech直列実行後、2フェーズの結果を1つのJobパッチへ統合する。
 * DESIGN.md §6「両方」・タスク指示: 「途中失敗時はCaseは反映済み・Techは失敗を正確に伝える」。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mergeCombinedPhases, type PhaseResult } from "./combinedResearch.js";

function phase(overrides: Partial<PhaseResult> = {}): PhaseResult {
  return {
    label: "Case",
    status: "done",
    resultCards: [],
    commit: null,
    cost: 0,
    ...overrides,
  };
}

test("mergeCombinedPhases: 両方成功なら resultCards はCase→Techの順に結合される", () => {
  const caseCard = { kind: "case" as const, id: "a", url: "https://x/cases/a" };
  const techCard = { kind: "tech" as const, id: "b", url: "https://x/technology/b" };
  const merged = mergeCombinedPhases(
    phase({ label: "Case", resultCards: [caseCard], commit: "aaaa1111", cost: 0.5 }),
    phase({ label: "Tech", resultCards: [techCard], commit: "bbbb2222", cost: 0.3 }),
  );
  assert.equal(merged.status, "done");
  assert.deepEqual(merged.resultCards, [caseCard, techCard]);
  assert.equal(merged.cost, 0.8);
  assert.equal(merged.warning, undefined);
  assert.equal(merged.error, undefined);
});

test("mergeCombinedPhases: 両方成功で各々warningがあれば連結される", () => {
  const merged = mergeCombinedPhases(
    phase({ warning: "Case側の注意" }),
    phase({ label: "Tech", warning: "Tech側の注意" }),
  );
  assert.match(merged.warning ?? "", /Case側の注意/);
  assert.match(merged.warning ?? "", /Tech側の注意/);
});

test("mergeCombinedPhases: Case成功・Tech失敗なら全体はdone、Tech失敗をwarningで伝える", () => {
  const caseCard = { kind: "case" as const, id: "a", url: "https://x/cases/a" };
  const merged = mergeCombinedPhases(
    phase({ label: "Case", status: "done", resultCards: [caseCard], commit: "aaaa1111" }),
    phase({ label: "Tech", status: "error", error: "収集失敗" }),
  );
  assert.equal(merged.status, "done", "Case側はcommit済みのため全体を失敗扱いにしない");
  assert.deepEqual(merged.resultCards, [caseCard]);
  assert.match(merged.warning ?? "", /Case.*反映済み/s);
  assert.match(merged.warning ?? "", /Tech.*収集失敗/s);
  assert.equal(merged.error, undefined);
});

test("mergeCombinedPhases: Case失敗・Tech成功なら全体はdone、Case失敗をwarningで伝える", () => {
  const techCard = { kind: "tech" as const, id: "b", url: "https://x/technology/b" };
  const merged = mergeCombinedPhases(
    phase({ label: "Case", status: "error", error: "重複のみで却下" }),
    phase({ label: "Tech", status: "done", resultCards: [techCard], commit: "bbbb2222" }),
  );
  assert.equal(merged.status, "done");
  assert.deepEqual(merged.resultCards, [techCard]);
  assert.match(merged.warning ?? "", /Case.*重複のみで却下/s);
  assert.equal(merged.error, undefined);
});

test("mergeCombinedPhases: 両方失敗なら全体もerrorで両方の理由を含む", () => {
  const merged = mergeCombinedPhases(
    phase({ label: "Case", status: "error", error: "Case失敗理由" }),
    phase({ label: "Tech", status: "error", error: "Tech失敗理由" }),
  );
  assert.equal(merged.status, "error");
  assert.match(merged.error ?? "", /Case失敗理由/);
  assert.match(merged.error ?? "", /Tech失敗理由/);
  assert.deepEqual(merged.resultCards, []);
});

test("mergeCombinedPhases: commitはCase/Techどちらもあれば両方わかる形で残る", () => {
  const merged = mergeCombinedPhases(
    phase({ label: "Case", commit: "aaaa1111" }),
    phase({ label: "Tech", commit: "bbbb2222" }),
  );
  assert.match(merged.commit ?? "", /aaaa1111/);
  assert.match(merged.commit ?? "", /bbbb2222/);
});

test("mergeCombinedPhases: commitが片方のみならその値を残す", () => {
  const merged = mergeCombinedPhases(
    phase({ label: "Case", commit: "aaaa1111" }),
    phase({ label: "Tech", status: "error", error: "x", commit: null }),
  );
  assert.match(merged.commit ?? "", /aaaa1111/);
});
