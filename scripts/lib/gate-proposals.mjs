// 関門基準（data/case-gate.json の criteria A〜D）の変更案を LINE で承認／却下／修正する仕組みの台帳＋純ロジック。
// 仕様: docs/CASE_RESEARCH_V3_SPEC.md §6。
//
// 呼び出し側:
//   - 週次見直し(Phase 3): proposeGateChange() で案を作って LINE へ送る／expireProposals() で失効処理。
//   - Studio の LINE webhook(Phase 4): applyProposal / markApproved / restoreGate / rejectProposal /
//     addFeedback / completeRevision / buildRevisionPrompt / parseRevisionOutput。
//
// 台帳 data/inbox/gate-proposals.json はローカル運用状態のため git 追跡しない（.gitignore。exhibition-*.json と同じ慣例）。
// LINE送信・git・Claude CLI は呼び出し側から注入する（このファイルは実送信をしない。既定の送信関数だけ例外）。
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { CASE_GATE_PATH, validateCaseGate } from "./case-gate-criteria.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const GATE_PROPOSALS_PATH = path.join(__dirname, "..", "..", "data", "inbox", "gate-proposals.json");
export const PROPOSAL_TTL_DAYS = 7;
export const CRITERION_IDS = ["A", "B", "C", "D"];
export const STATUSES = ["pending", "approved", "rejected", "expired", "superseded"];
const DAY_MS = 86400000;

// ── ID ────────────────────────────────────────────────────────────

/** 全角英数字・全角空白を半角へ。 */
export function toHalfWidth(s) {
  return String(s ?? "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ");
}

/** "G12" / "g12" / "12" / "Ｇ１２" → 12。解釈できなければ null。 */
export function parseGateId(raw) {
  const m = toHalfWidth(raw).trim().match(/^[Gg]?(\d{1,6})$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? n : null;
}

export function formatGateId(n) {
  return `G${n}`;
}

// ── 台帳 IO ───────────────────────────────────────────────────────

export function loadProposals(file = GATE_PROPOSALS_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return { version: 1, nextSeq: 1, proposals: [] };
  }
  const data = JSON.parse(raw);
  if (!data || !Array.isArray(data.proposals)) throw new Error(`gate-proposals.json が不正: ${file}`);
  const maxSeq = data.proposals.reduce((m, p) => Math.max(m, parseGateId(p.id) ?? 0), 0);
  return { version: 1, nextSeq: Math.max(Number(data.nextSeq) || 1, maxSeq + 1), proposals: data.proposals };
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function saveProposals(store, file = GATE_PROPOSALS_PATH) {
  writeAtomic(file, `${JSON.stringify(store, null, 2)}\n`);
}

/** id 文字列（"G12"/"12"等）または数値で案を引く。見つからなければ null。 */
export function getProposal(idLike, { file = GATE_PROPOSALS_PATH } = {}) {
  const n = typeof idLike === "number" ? idLike : parseGateId(idLike);
  if (n == null) return null;
  return loadProposals(file).proposals.find((p) => p.id === formatGateId(n)) ?? null;
}

function updateProposal(id, mutate, file) {
  const store = loadProposals(file);
  const p = store.proposals.find((x) => x.id === id);
  if (!p) return null;
  mutate(p);
  saveProposals(store, file);
  return p;
}

// ── 作成 ──────────────────────────────────────────────────────────

const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";

function normalizeEvidence(evidence) {
  return (Array.isArray(evidence) ? evidence : [])
    .filter((e) => e && typeof e === "object")
    .map((e) => ({
      kind: String(e.kind ?? e.signal ?? ""),
      title: String(e.title ?? ""),
      url: String(e.url ?? ""),
      signal: String(e.signal ?? e.kind ?? ""),
    }));
}

/**
 * 案を作って台帳に保存する。before は作成時点の case-gate.json の現行文面。
 * @param {{criterionId:string, after:string, reason:string, evidence?:Array, supersedes?:string|null}} input
 * @param {{file?:string, gatePath?:string, now?:Date}} opts
 */
export function createProposal(input, { file = GATE_PROPOSALS_PATH, gatePath = CASE_GATE_PATH, now = new Date() } = {}) {
  const { criterionId, after, reason, evidence, supersedes = null } = input;
  if (!CRITERION_IDS.includes(criterionId)) throw new Error(`基準 id が不正: ${criterionId}`);
  if (!nonEmpty(after)) throw new Error("after（変更後の文面）が空");
  const gate = JSON.parse(fs.readFileSync(gatePath, "utf-8"));
  const before = gate.criteria.find((c) => c.id === criterionId)?.text;
  if (!nonEmpty(before)) throw new Error(`現行の基準 ${criterionId} が見つからない`);
  if (after.trim() === before.trim()) throw new Error("変更後が現行文面と同じ（変更案になっていない）");

  const store = loadProposals(file);
  const proposal = {
    id: formatGateId(store.nextSeq),
    status: "pending",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PROPOSAL_TTL_DAYS * DAY_MS).toISOString(),
    criterionId,
    before,
    after: after.trim(),
    reason: String(reason ?? ""),
    evidence: normalizeEvidence(evidence),
    feedback: [],
    supersedes,
  };
  store.nextSeq += 1;
  store.proposals.push(proposal);
  saveProposals(store, file);
  return proposal;
}

// ── LINE 送信文 ───────────────────────────────────────────────────

/** 共通接頭辞・接尾辞を除いた「旧→新」の差分1行。 */
export function summarizeDiff(before, after) {
  let i = 0;
  while (i < before.length && i < after.length && before[i] === after[i]) i++;
  let j = 0;
  while (j < before.length - i && j < after.length - i && before[before.length - 1 - j] === after[after.length - 1 - j]) j++;
  const oldPart = before.slice(i, before.length - j);
  const newPart = after.slice(i, after.length - j);
  const clip = (s) => (s.length > 200 ? `${s.slice(0, 200)}…` : s);
  return `差分: 「${clip(oldPart) || "（なし）"}」→「${clip(newPart) || "（なし）"}」`;
}

function formatDate(iso) {
  return String(iso).slice(0, 10);
}

export function buildProposalMessage(p) {
  const lines = [`基準の変更案 #${p.id}`, `対象: 基準${p.criterionId}`, ""];
  lines.push("【変更前】", p.before, "", "【変更後】", p.after, "", summarizeDiff(p.before, p.after), "");
  lines.push("【理由】", p.reason || "（記載なし）");
  const ev = p.evidence ?? [];
  if (ev.length) {
    lines.push("", "【根拠の例】");
    for (const e of ev) {
      const mark = e.signal === "trash" ? "トラッシュ" : e.signal === "fav" ? "fav" : e.signal || e.kind;
      lines.push(`- [${mark}] ${e.title}${e.url ? `\n  ${e.url}` : ""}`);
    }
  }
  if (p.supersedes) lines.push("", `（${p.supersedes} へのフィードバックを反映した修正案です）`);
  lines.push("", "【操作】", `承認 ${p.id}　→ 反映して公開`, `却下 ${p.id}　→ 破棄`, `修正 ${p.id} ＜フィードバック＞　→ 修正案を作り直し`, "", `期限: ${formatDate(p.expiresAt)}（返信がなければ失効）`);
  return lines.join("\n");
}

// ── 送信（既定は既存の notify-line-send を使う。テストでは sendLine を注入） ─────

/** ~/.researchman-line.json の { channelAccessToken, to } で既存の sendLineMessages を呼ぶ既定の送信関数。 */
export async function defaultSendLine(text) {
  const { sendLineMessages } = await import("./notify-line-send.mjs");
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".researchman-line.json"), "utf-8"));
  } catch (e) {
    return { ok: false, reason: `LINE設定を読めない: ${e.message}` };
  }
  if (!cfg.channelAccessToken) return { ok: false, reason: "channelAccessToken が未設定" };
  return sendLineMessages({ channelAccessToken: cfg.channelAccessToken, to: cfg.to || cfg.allowedUserId }, text);
}

export async function sendProposal(proposal, { sendLine = defaultSendLine } = {}) {
  try {
    const r = await sendLine(buildProposalMessage(proposal));
    return { ok: Boolean(r?.ok), reason: r?.reason ?? null };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** 週次見直し(Phase 3)向け: 案の作成と LINE 送信をまとめて行う。 */
export async function proposeGateChange(input, { sendLine, ...opts } = {}) {
  const proposal = createProposal(input, opts);
  const sent = await sendProposal(proposal, { sendLine });
  return { proposal, sent };
}

// ── 承認の適用 ────────────────────────────────────────────────────

const fail = (code, proposal, message) => ({ ok: false, code, proposal, message });

/** pending 以外・期限切れ・不在を判定する共通ガード。期限切れなら expired に更新する。 */
function guardPending(idLike, { file, now }) {
  const p = getProposal(idLike, { file });
  if (!p) return { error: fail("not-found", null, "該当する案がありません") };
  if (p.status !== "pending") return { error: fail("not-pending", p, `この案は ${p.status} です`) };
  if (now.getTime() > Date.parse(p.expiresAt)) {
    const updated = updateProposal(p.id, (x) => (x.status = "expired"), file);
    return { error: fail("expired", updated, "この案は期限切れです") };
  }
  return { proposal: p };
}

/**
 * 承認の適用: case-gate.json の該当基準だけを after に差し替え → validateCaseGate → 書き込み。
 * 現行文面が before と一致しなければ conflict で書き込まない。状態は pending のまま
 * （commit/push 成功後に markApproved を呼ぶ。失敗時は restoreGate(backup) で戻す）。
 */
export function applyProposal(idLike, { file = GATE_PROPOSALS_PATH, gatePath = CASE_GATE_PATH, now = new Date() } = {}) {
  const g = guardPending(idLike, { file, now });
  if (g.error) return g.error;
  const p = g.proposal;
  let backup;
  let gate;
  try {
    backup = fs.readFileSync(gatePath, "utf-8");
    gate = JSON.parse(backup);
  } catch (e) {
    return fail("invalid", p, `case-gate.json を読めない: ${e.message}`);
  }
  const target = Array.isArray(gate.criteria) ? gate.criteria.find((c) => c.id === p.criterionId) : null;
  if (!target) return fail("invalid", p, `基準 ${p.criterionId} が case-gate.json にない`);
  if (target.text !== p.before) return fail("conflict", p, "現行の基準文が案の作成時から変わっているため適用できません（修正でやり直せます）");
  target.text = p.after;
  gate.updatedAt = now.toISOString().slice(0, 10);
  const errs = validateCaseGate(gate);
  if (errs.length) return fail("invalid", p, `検証エラー: ${errs.join(" / ")}`);
  writeAtomic(gatePath, `${JSON.stringify(gate, null, 2)}\n`);
  return { ok: true, code: "applied", proposal: p, backup };
}

/** applyProposal の書き込みを元に戻す。 */
export function restoreGate(backup, gatePath = CASE_GATE_PATH) {
  writeAtomic(gatePath, backup);
}

export function markApproved(idLike, { file = GATE_PROPOSALS_PATH, now = new Date() } = {}) {
  const p = getProposal(idLike, { file });
  if (!p) return null;
  return updateProposal(p.id, (x) => {
    x.status = "approved";
    x.decidedAt = now.toISOString();
  }, file);
}

export function rejectProposal(idLike, { file = GATE_PROPOSALS_PATH, now = new Date() } = {}) {
  const g = guardPending(idLike, { file, now });
  if (g.error) return g.error;
  const updated = updateProposal(g.proposal.id, (x) => {
    x.status = "rejected";
    x.decidedAt = now.toISOString();
  }, file);
  return { ok: true, code: "rejected", proposal: updated };
}

// ── 修正（フィードバック→再生成） ─────────────────────────────────

export function addFeedback(idLike, text, { file = GATE_PROPOSALS_PATH, now = new Date() } = {}) {
  const g = guardPending(idLike, { file, now });
  if (g.error) return g.error;
  const updated = updateProposal(g.proposal.id, (x) => x.feedback.push({ at: now.toISOString(), text: String(text) }), file);
  return { ok: true, code: "feedback-recorded", proposal: updated };
}

/** 修正案を新 id で作成し、元の案を superseded にする。元が pending でなければ作らない。 */
export function completeRevision(oldIdLike, { after, reason }, { file = GATE_PROPOSALS_PATH, gatePath = CASE_GATE_PATH, now = new Date() } = {}) {
  const g = guardPending(oldIdLike, { file, now });
  if (g.error) return g.error;
  const old = g.proposal;
  let proposal;
  try {
    proposal = createProposal({ criterionId: old.criterionId, after, reason, evidence: old.evidence, supersedes: old.id }, { file, gatePath, now });
  } catch (e) {
    return fail("invalid", old, e instanceof Error ? e.message : String(e));
  }
  updateProposal(old.id, (x) => {
    x.status = "superseded";
    x.supersededBy = proposal.id;
  }, file);
  return { ok: true, code: "revised", proposal };
}

export function buildRevisionPrompt(p, gate) {
  const criteria = (gate.criteria ?? []).map((c) => `- 基準${c.id}: ${c.text}`).join("\n");
  const fb = (p.feedback ?? []).map((f, i) => `${i + 1}. ${f.text}`).join("\n") || "（なし）";
  const ev = (p.evidence ?? []).map((e) => `- [${e.signal}] ${e.title} ${e.url}`).join("\n") || "（なし）";
  return `あなたは Case Study 関門の基準文を整える編集者です。オーナーが基準${p.criterionId}の変更案にフィードバックしました。フィードバックを踏まえ、変更案を作り直してください。

## 現行の基準文（case-gate.json）
${criteria}

## 作り直す対象: 基準${p.criterionId}
現行文面(before):
${p.before}

直前の変更案(after):
${p.after}

直前の変更理由:
${p.reason}

## オーナーのフィードバック
${fb}

## 根拠となった fav / トラッシュの例
${ev}

## 制約
- 変更するのは基準${p.criterionId}の文面だけ。他の基準・文面は変えない。
- 他の基準(A〜D)と役割が重ならないようにする。
- 現行文面と同一にしない。

出力はJSONオブジェクトのみ（前置き・後書き・コードブロック記法なし）:
{"after": "修正後の基準文", "reason": "修正の理由（フィードバックをどう反映したか）"}`;
}

export function parseRevisionOutput(text) {
  const s = String(text ?? "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  try {
    const obj = JSON.parse(s.slice(start, end + 1));
    if (!obj || !nonEmpty(obj.after)) return null;
    return { after: obj.after.trim(), reason: String(obj.reason ?? "") };
  } catch {
    return null;
  }
}

// ── 失効 ──────────────────────────────────────────────────────────

/** 期限(expiresAt)を過ぎた pending を expired にする。週次見直しが呼ぶ。失効した案の配列を返す。 */
export function expireProposals({ file = GATE_PROPOSALS_PATH, now = new Date() } = {}) {
  const store = loadProposals(file);
  const expired = [];
  for (const p of store.proposals) {
    if (p.status === "pending" && now.getTime() > Date.parse(p.expiresAt)) {
      p.status = "expired";
      expired.push(p);
    }
  }
  if (expired.length) saveProposals(store, file);
  return expired;
}
