/**
 * 週次見直し: 採用基準 A〜D の文面の変更案（AI 出力）を、条件を満たすときだけ proposeGateChange へ渡す段。
 * 仕様: docs/CASE_RESEARCH_V3_SPEC.md §5 表3行目・§6。基準文は自動では書き換えない（LINE 承認でのみ変わる）。
 *
 * 作成条件:
 *   - AI の案が妥当（基準ID A〜D・after 非空かつ現行文面と異なる・reason 非空・根拠が実在する fav/トラッシュ例 1件以上）
 *   - 同じ基準に pending（期限内）の案が既にあれば作らない
 *   - dry-run では送信しない（案の内容を返すだけ。呼び出し側がレポートに書く）
 * 根拠(evidence)は AI の自己申告をそのまま信用せず、今回の fav/トラッシュ一覧（evidencePool）に実在するものだけ残し、
 * url と signal は pool 側の値で上書きする。
 * LINE 送信・台帳書き込みは proposeFn（= gate-proposals.mjs の proposeGateChange）に委ね、ここでは実送信しない。
 * 実行の最初の expireProposals 呼び出しは biweekly-tuneup.mjs の main() 冒頭で行う。
 */
import { normTitle } from "./norm-title.mjs";

const CRITERION_IDS = ["A", "B", "C", "D"];
const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";

/**
 * @param {object} o
 * @param {object|null|undefined} o.aiProposal {criterionId, after, reason, evidence:[{title, signal?}]}
 * @param {{criteria: Array<{id:string,text:string}>}} o.gate 現行の case-gate.json
 * @param {Array<{title:string, link?:string, signal:'fav'|'trash'}>} o.evidencePool
 * @param {() => {proposals: Array}} o.loadFn loadProposals
 * @param {(input: object) => Promise<{proposal: object, sent: object}>} o.proposeFn proposeGateChange
 * @param {boolean} o.dryRun
 * @param {Date} [o.now]
 * @returns {Promise<{status: 'none'|'invalid'|'skipped-pending'|'dry-run'|'proposed'|'error', reason?: string, normalized?: object, proposal?: object, sent?: object}>}
 */
export async function runGateProposalStage({ aiProposal, gate, premiseGate, evidencePool, loadFn, proposeFn, dryRun, now = new Date() }) {
  if (!aiProposal || typeof aiProposal !== "object") return { status: "none" };
  if (!gate || typeof gate !== "object") return { status: "none" }; // case-gate.json が読めない（v3関連のみスキップ）

  const criterionId = String(aiProposal.criterionId ?? "").trim().toUpperCase();
  if (!CRITERION_IDS.includes(criterionId)) return { status: "invalid", reason: `基準IDが不正: ${aiProposal.criterionId}` };
  if (!nonEmpty(aiProposal.after)) return { status: "invalid", reason: "変更後の文面が空" };
  if (!nonEmpty(aiProposal.reason)) return { status: "invalid", reason: "理由が空" };
  const before = (gate?.criteria || []).find((c) => c?.id === criterionId)?.text;
  if (!nonEmpty(before)) return { status: "invalid", reason: `現行の基準 ${criterionId} が見つからない` };
  if (aiProposal.after.trim() === before.trim()) return { status: "invalid", reason: "変更後が現行文面と同じ" };
  // AI が分析の前提にした文面(premiseGate=分析開始時)と現行が違う＝分析中に承認で変わった。古い前提の案は出さない
  if (premiseGate) {
    const premise = (premiseGate.criteria || []).find((c) => c?.id === criterionId)?.text;
    if (nonEmpty(premise) && premise.trim() !== before.trim()) {
      return { status: "skipped-changed", reason: `基準${criterionId}の文面が分析中に変更されたため見送り` };
    }
  }

  const poolByTitle = new Map();
  for (const p of evidencePool || []) {
    const k = normTitle(p?.title);
    if (k && !poolByTitle.has(k)) poolByTitle.set(k, p);
  }
  const evidence = [];
  const seen = new Set();
  for (const e of Array.isArray(aiProposal.evidence) ? aiProposal.evidence : []) {
    const k = normTitle(e?.title);
    const hit = k && poolByTitle.get(k);
    if (!hit || seen.has(k)) continue;
    seen.add(k);
    evidence.push({ kind: hit.signal, title: hit.title, url: hit.link || "", signal: hit.signal });
  }
  if (!evidence.length) return { status: "invalid", reason: "根拠の fav/トラッシュ例が今回のデータに実在しない" };

  const normalized = { criterionId, before, after: aiProposal.after.trim(), reason: aiProposal.reason.trim(), evidence };

  let store;
  try {
    store = loadFn();
  } catch (e) {
    return { status: "error", reason: `台帳の読み込みに失敗: ${e.message}` };
  }
  const nowMs = now.getTime();
  const hasPending = (store?.proposals || []).some(
    (p) => p?.status === "pending" && p.criterionId === criterionId && !(Date.parse(p.expiresAt) <= nowMs)
  );
  if (hasPending) return { status: "skipped-pending", normalized };

  if (dryRun) return { status: "dry-run", normalized };

  try {
    const res = await proposeFn({ criterionId, after: normalized.after, reason: normalized.reason, evidence });
    return { status: "proposed", normalized, proposal: res?.proposal, sent: res?.sent };
  } catch (e) {
    return { status: "error", reason: e.message, normalized };
  }
}
