/**
 * combinedResearch.ts のうち、依存注入で単体テスト可能な部分のみ検証する
 * （パイプライン本体はCase/Techパイプライン起動・ジョブ永続化に依存するためE2E/実運用の領分。
 * caseResearch.test.ts と同じ方針）。
 *
 * mergeCombinedPhases: Case→Tech直列実行後、2フェーズの結果を1つのJobパッチへ統合する。
 * DESIGN.md §6「両方」・タスク指示: 「途中失敗時はCaseは反映済み・Techは失敗を正確に伝える」。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { getJob, updateJob, writeJobFile, type Job } from "../jobs.js";
import { buildFailPatch, buildPushFailPatch, terminalStatus as techTerminalStatus } from "./techResearch.js";
import { terminalStatus as caseTerminalStatus } from "./caseResearch.js";
import { mergeCombinedPhases, phaseFromJob, TECH_PHASE_RESET_PATCH, type PhaseResult } from "./combinedResearch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_DIR = path.join(__dirname, "..", "..", "workdir", "jobs");

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

/** パイプラインを起動せず、Caseフェーズ完了直後のジョブ状態を直接ファイルに用意するfixture。 */
function makeCaseDoneJob(overrides: Partial<Job> = {}): Job {
  return {
    id: randomUUID(),
    tab: "research",
    request: { kind: "両方", theme: "テスト", refUrl: "", viewpoint: "", count: "3" },
    status: "done",
    resultCards: [],
    commit: null,
    deployedUrl: "https://research-man.vercel.app",
    cost: null,
    at: new Date().toISOString(),
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

// ── phaseDurationsMs（P4 #6） ────────────────────────────────────────
// progressTiming.ts はjobId単位でCase→Techが直列に上書きし合う（Tech開始時にCaseの計測
// 状態が破棄される）ため、最終的なマージ結果へはCase/Tech両方をラベル付きキーで残す。

test("mergeCombinedPhases: phaseDurationsMsはCase/Techそれぞれラベル付きキーで合成される", () => {
  const merged = mergeCombinedPhases(
    phase({ label: "Case", phaseDurationsMs: { 収集中: 1000, 検証中: 500 } }),
    phase({ label: "Tech", phaseDurationsMs: { 技術収集中: 2000 } }),
  );
  assert.deepEqual(merged.phaseDurationsMs, {
    "Case: 収集中": 1000,
    "Case: 検証中": 500,
    "Tech: 技術収集中": 2000,
  });
});

test("mergeCombinedPhases: phaseDurationsMs未指定でも空オブジェクトになり例外を投げない", () => {
  const merged = mergeCombinedPhases(phase({ label: "Case" }), phase({ label: "Tech" }));
  assert.deepEqual(merged.phaseDurationsMs, {});
});

test("mergeCombinedPhases: commitが片方のみならその値を残す", () => {
  const merged = mergeCombinedPhases(
    phase({ label: "Case", commit: "aaaa1111" }),
    phase({ label: "Tech", status: "error", error: "x", commit: null }),
  );
  assert.match(merged.commit ?? "", /aaaa1111/);
});

// ── phaseFromJob: SSE対応・statusではなくerrorフィールドで成否判定（P4 adversarial-review
//    指摘#1の再発防止） ────────────────────────────────────────────────
// SSE導入前は、各パイプラインが自身の終端で status:"done"/"error" を書いていたため
// phaseFromJob は job.status を見れば十分だった。SSE導入後は、combined実行中
// （caseResearch.ts/techResearch.ts::terminalStatus 参照）は status を "running" に
// 据え置くようになったため、phaseFromJob は error フィールドの有無で成否を判定する
// よう変更した。これにより、Case/Techどちらの終端も status:"done" にならず、SSE購読側が
// Caseフェーズ完了を「ジョブ全体の終了」と誤認してTech結果が届く前にストリームを閉じてしまう
// 回帰（実際に発生した）を防ぐ。

test("phaseFromJob: terminalStatus(false, ...)相当のstatus:runningでも、errorが無ければdone扱いになる", () => {
  const job: Job = {
    id: randomUUID(),
    tab: "research",
    request: {},
    status: caseTerminalStatus(false, "done"), // combined実行中の書き方 = "running"
    resultCards: [{ kind: "case", id: "a", url: "https://x/cases/a" }],
    commit: "aaaa1111",
    deployedUrl: null,
    cost: 0.5,
    at: new Date().toISOString(),
  };
  assert.equal(job.status, "running", "前提: combined実行中はstatusがrunningのまま書かれる");
  const result = phaseFromJob("Case", job);
  assert.equal(result.status, "done", "errorが無い以上、statusがrunningでもdone扱いにする必要がある");
});

test("phaseFromJob: terminalStatus(false, ...)相当のstatus:runningでも、errorがあればerror扱いになる", () => {
  const job: Job = {
    id: randomUUID(),
    tab: "research",
    request: {},
    status: techTerminalStatus(false, "error"), // combined実行中の書き方 = "running"
    resultCards: [],
    commit: null,
    deployedUrl: null,
    cost: 0.1,
    error: "収集フェーズで候補が得られませんでした",
    at: new Date().toISOString(),
  };
  assert.equal(job.status, "running", "前提: combined実行中はstatusがrunningのまま書かれる");
  const result = phaseFromJob("Tech", job);
  assert.equal(result.status, "error", "errorフィールドがある以上、statusがrunningでもerror扱いにする必要がある");
});

// ── TECH_PHASE_RESET_PATCH（adversarial-reviewer指摘#1） ─────────────────
// Techフェーズ開始前にジョブを running へ戻すだけでなく、Caseフェーズの
// resultCards/commit/cost/deployedUrl も明示的にクリアしないと、Tech側の失敗パスが
// これらを上書きしなかった場合にCaseの値をそのまま引き継いでしまう（カード二重化・
// コスト誤算・commit誤表記の直接原因）。

test("TECH_PHASE_RESET_PATCH: resultCards/commit/cost/deployedUrlを明示的にクリアする", () => {
  assert.deepEqual(TECH_PHASE_RESET_PATCH.resultCards, []);
  assert.equal(TECH_PHASE_RESET_PATCH.commit, null);
  assert.equal(TECH_PHASE_RESET_PATCH.cost, null);
  assert.equal(TECH_PHASE_RESET_PATCH.deployedUrl, null);
  assert.equal(TECH_PHASE_RESET_PATCH.status, "running");
});

// ── 結合経路テスト（adversarial-reviewer指摘#1・最重要） ─────────────────
// mergeCombinedPhasesへの理想入力ではなく、実際に「Case完了状態のジョブを書く→
// リセット→Tech失敗相当のupdateJob→phaseFromJobで復元」という実運用と同じ経路を
// 通してテストする（この経路を通さないテストは今回のバグを再現できない）。

test("結合経路: Case成功→Tech早期失敗でもCaseカードは二重化されず、costは合算のみ、Tech側commitは誤表記されない", async () => {
  const jobId = randomUUID();
  const caseCard = { kind: "case" as const, id: "case-a", url: "https://x/cases/case-a" };
  await writeJobFile(
    makeCaseDoneJob({ id: jobId, resultCards: [caseCard], commit: "caseHash1111", cost: 1.23 }),
  );
  try {
    const casePhase = phaseFromJob("Case", await getJob(jobId));

    await updateJob(jobId, TECH_PHASE_RESET_PATCH);
    // techResearch.ts::fail() が実際に書くのと同じパッチ（buildFailPatch）を適用する
    await updateJob(jobId, buildFailPatch("収集フェーズで候補が得られませんでした", 0.05));

    const techPhase = phaseFromJob("Tech", await getJob(jobId));
    const merged = mergeCombinedPhases(casePhase, techPhase);

    assert.deepEqual(merged.resultCards, [caseCard], "Caseカードが二重化されていないこと");
    assert.equal(merged.status, "done", "Case側はcommit済みのため全体を失敗扱いにしない");
    assert.equal(merged.cost, 1.23 + 0.05, "コストはCase実費+Tech実費の合算のみ（Case分の二重加算をしない）");
    assert.match(merged.commit ?? "", /caseHash1111/);
    const caseHashOccurrences = (merged.commit ?? "").split("caseHash1111").length - 1;
    assert.equal(caseHashOccurrences, 1, "Tech側にCaseのcommit hashが誤って乗っていないこと");
    assert.match(merged.warning ?? "", /Tech.*収集フェーズで候補が得られませんでした/s);
  } finally {
    await rm(path.join(JOBS_DIR, `${jobId}.json`), { force: true });
  }
});

test("結合経路: Case成功→Techのpush失敗でもCase/Tech両方のカードが失われず二重化もされない", async () => {
  const jobId = randomUUID();
  const caseCard = { kind: "case" as const, id: "case-a", url: "https://x/cases/case-a" };
  const techCard = { kind: "tech" as const, id: "tech-b", url: "https://x/technology/tech-b" };
  await writeJobFile(
    makeCaseDoneJob({ id: jobId, resultCards: [caseCard], commit: "caseHash1111", cost: 1.0 }),
  );
  try {
    const casePhase = phaseFromJob("Case", await getJob(jobId));

    await updateJob(jobId, TECH_PHASE_RESET_PATCH);
    // techResearch.ts のpush失敗パスが実際に書くのと同じパッチ（buildPushFailPatch）。
    // push失敗はcommit済みなのでresultCards/commitHash/costは保持される。
    await updateJob(
      jobId,
      buildPushFailPatch("push に失敗しました", "techHash2222", [techCard], 0.3),
    );

    const techPhase = phaseFromJob("Tech", await getJob(jobId));
    const merged = mergeCombinedPhases(casePhase, techPhase);

    assert.deepEqual(merged.resultCards, [caseCard, techCard], "Case/Tech両方のカードが揃う（二重化も欠落もない）");
    assert.equal(merged.status, "done");
    assert.equal(merged.cost, 1.0 + 0.3);
    assert.match(merged.commit ?? "", /caseHash1111/);
    assert.match(merged.commit ?? "", /techHash2222/);
  } finally {
    await rm(path.join(JOBS_DIR, `${jobId}.json`), { force: true });
  }
});
