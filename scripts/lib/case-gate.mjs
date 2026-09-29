/**
 * 事例収集（auto-research-cc.mjs）の関門ロジック。docs/RADAR_V2_DESIGN.md §4-4・§4-7 / 追補§B。
 *
 * 関門の判定はモデル出力への同梱（ADR-3）。このファイルの役割は判定の実行ではなく、
 *   - 発見・記事化の両プロンプトに差し込む基準文言の組み立て（文言の実体は case-gate-criteria.mjs
 *     の1箇所のみ。ここでは再定義しない＝ベイクオフと判定基準がズレないようにする）
 *   - モデル出力（gateVerdict/gateCriterion/gateScore/gateReason/announcementType）の検証・正規化
 *     （不正値・欠落・矛盾は reject 扱い＝安全側）
 *   - 発見候補の accept/reject 分割と、却下ログ用 detail の生成
 * の3つ。
 */
import {
  GATE_CRITERIA_TEXT,
  GATE_LITMUS_TEXT,
  TASTE_TYPES_TEXT,
  ANNOUNCEMENT_TYPES,
  normalizeGateItem,
} from "./case-gate-criteria.mjs";

export { GATE_CRITERIA_TEXT, GATE_LITMUS_TEXT, TASTE_TYPES_TEXT, ANNOUNCEMENT_TYPES };

const ANNOUNCEMENT_SET = new Set(ANNOUNCEMENT_TYPES);
const str = (v) => (typeof v === "string" ? v.trim() : "");

/** 発見プロンプトに差し込む「採用基準＋4類型＋リトマス例＋自己判定の指示」節。 */
export function discoveryGatePromptSection() {
  return `${TASTE_TYPES_TEXT}

${GATE_CRITERIA_TEXT}

${GATE_LITMUS_TEXT}

## 自己判定（関門1回目）
- 各候補に gateVerdict（accept / reject）・gateCriterion（A / B / C / none）・gateReason（一言・40字以内）を付ける。
- accept は A/B/C のいずれかを満たす時だけ（その記号を gateCriterion に）。満たさない・迷うものは reject（gateCriterion は none）。
- 一覧・見出しの情報だけで「告知・ニュースのみ」と分かるものは reject。
- 探索中に見つけたが基準を満たさなかった候補は reject として含めてよい（最大3件。却下ログに記録され基準の調整に使われる）。無理に探す必要はない。`;
}

/** 記事化プロンプトに差し込む「最終関門（関門2回目）」節。 */
export function articleGatePromptSection() {
  return `## 採用判定（最終関門・関門2回目）
WebSearchで確認できた**事実に基づいて**、この事例が採用基準を満たすか最終判定する。見出しの印象ではなく、中身（企画の核・演出やクラフトの発明・技術/手法の新規性）が確認できたかで決める。

${GATE_CRITERIA_TEXT}

${GATE_LITMUS_TEXT}

- gateVerdict: accept / reject
- gateCriterion: A / B / C / none（reject は none）
- gateScore: 1〜5の整数（採用基準をどれだけ強く満たすか。5=非常に強い、1=ほぼ満たさない）
- gateReason: 判定理由を一言（40字以内）
- announcementType: 「発売・開催・発表・買収・コンテスト告知などの告知のみ」と判定した場合の種別（${ANNOUNCEMENT_TYPES.join(" / ")}）。告知のみでなければ空文字。告知のみなら必ず reject。
- reject の場合でも JSON の形は崩さない（summary・overview 等の本文は空文字でよい）。`;
}

/**
 * 発見候補の自己判定を正規化する（関門1回目）。不正値・欠落は reject。
 * @returns {{gateVerdict: "accept"|"reject", gateCriterion: "A"|"B"|"C"|"none", gateReason: string}}
 */
export function normalizeDiscoveryGate(cand) {
  const o = cand && typeof cand === "object" ? cand : {};
  const g = normalizeGateItem({ verdict: o.gateVerdict, criterion: o.gateCriterion, reason: o.gateReason });
  return { gateVerdict: g.verdict, gateCriterion: g.criterion, gateReason: g.reason };
}

/**
 * 記事化出力の最終判定を正規化する（関門2回目）。accept になるのは次が全て揃った時のみ:
 * verdict=accept・criterion∈{A,B,C}・gateScore が1〜5の整数（数値文字列は許容）・告知のみでない。
 * 「告知のみ」と言いつつ accept の矛盾は reject に倒す。
 * @returns {{gateVerdict, gateCriterion, gateScore: number, gateReason: string, announcementType: string}}
 */
export function normalizeArticleGate(art) {
  const o = art && typeof art === "object" ? art : {};
  const g = normalizeGateItem({ verdict: o.gateVerdict, criterion: o.gateCriterion, reason: o.gateReason });

  const rawScore = typeof o.gateScore === "string" && o.gateScore.trim() !== "" ? Number(o.gateScore) : o.gateScore;
  const scoreOk = typeof rawScore === "number" && Number.isInteger(rawScore) && rawScore >= 1 && rawScore <= 5;
  const gateScore = scoreOk ? rawScore : 0;

  let announcementType = str(o.announcementType);
  if (announcementType.toLowerCase() === "none") announcementType = "";
  if (announcementType && !ANNOUNCEMENT_SET.has(announcementType)) announcementType = "other";

  let verdict = g.verdict;
  if (verdict === "accept" && (!scoreOk || announcementType)) verdict = "reject";
  return {
    gateVerdict: verdict,
    gateCriterion: verdict === "accept" ? g.criterion : "none",
    gateScore,
    gateReason: g.reason,
    announcementType,
  };
}

/** 却下ログ(logRejection)の detail 文字列。発見段階は "criterion:reason"、記事化段階は "article:種別:reason"。 */
export function gateRejectionDetail(gate, stage = "discovery") {
  if (stage === "article") return `article:${gate.announcementType || "-"}:${gate.gateReason}`;
  return `${gate.gateCriterion}:${gate.gateReason}`;
}

/**
 * 発見候補を関門1回目の自己判定で accept/reject に分ける。accept 側の候補には正規化済みの
 * gateCriterion/gateReason を載せて返す。reject 側は却下ログ用 detail を付ける。
 */
export function partitionByGate(found) {
  const accepted = [];
  const rejected = [];
  for (const cand of found || []) {
    const g = normalizeDiscoveryGate(cand);
    if (g.gateVerdict === "accept") {
      accepted.push({ ...cand, ...g });
    } else {
      rejected.push({ cand, ...g, detail: gateRejectionDetail(g, "discovery") });
    }
  }
  return { accepted, rejected };
}
