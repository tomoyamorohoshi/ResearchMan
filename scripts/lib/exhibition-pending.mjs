/**
 * 会期未発表の投稿の保留リスト（data/inbox/exhibition-pending.json。exhibition-handoff.json と同じ流儀のローカルキュー・コミットしない）。
 *
 * 投稿(trustOrigin の intake)で開始日・終了日が実在の YYYY-MM-DD で取れなかったものを積む（processCandidates の戻り値 pending）。
 * 日次の Exhibition ジョブが processPending で再調査（deps.reinvestigate）→ 日付が出れば通常の追加（公式照合 → 投稿者確認）に進む。
 * 除去は最終書き込み成功後（commitPending）。巻き戻し等で失わないよう、それまでファイルは変更しない。
 */
import path from "path";
import { processCandidates } from "./exhibition-build.mjs";
import { normLink } from "./norm-link.mjs";
import { daysBetween } from "./exhibition-status.mjs";
import { readJson, writeJsonAtomic } from "./exhibition-io.mjs";

export const PENDING_REL = "data/inbox/exhibition-pending.json";
/** 保留してから打ち切るまでの日数（日付が出ないまま残り続けない）。 */
export const PENDING_MAX_DAYS = 180;
/** 1回の日次ジョブで再調査する保留の最大件数（Claude 呼び出しの上限）。 */
export const PENDING_MAX_PER_RUN = 5;

const str = (v) => (typeof v === "string" ? v.trim() : "");
export const pendingKey = (e) => `${normLink(str(e.intakeUrl)) || str(e.intakeUrl)}|${str(e.title)}`;

async function readPending(root) {
  const p = path.join(root, PENDING_REL);
  let raw;
  try {
    raw = await readJson(p);
  } catch (e) {
    if (e?.code === "ENOENT") return { items: [] };
    return { items: [], warning: `pending 読込失敗（${e.message}）` };
  }
  if (!raw || !Array.isArray(raw.items)) return { items: [], warning: "pending の形式が不正（items 配列なし）" };
  return { items: raw.items.filter((e) => e && typeof e === "object") };
}

export { readPending };

/** 保留へ追記（intakeUrl+title で重複排除）。読めないファイルは上書きせず throw。 */
export async function appendPending(root, entries, today) {
  const add = (entries || []).filter((e) => e && str(e.title) && str(e.intakeUrl));
  if (!add.length) return 0;
  const cur = await readPending(root);
  if (cur.warning) throw new Error(cur.warning);
  const seen = new Map(cur.items.map((e) => [pendingKey(e), e]));
  let n = 0;
  for (const e of add) {
    if (seen.has(pendingKey(e))) continue;
    seen.set(pendingKey(e), { ...e, pendingSince: e.pendingSince || today, attempts: Number(e.attempts) || 0 });
    n++;
  }
  await writeJsonAtomic(path.join(root, PENDING_REL), { version: 1, items: [...seen.values()] });
  return n;
}

// 再試行に値する一時失敗（サムネ取得失敗・候補処理の例外）。それ以外の reject/unverified は恒久扱いで保留から外す
const TRANSIENT_REJECT = new Set(["thumbnail-unavailable", "candidate-error"]);

/**
 * 保留の候補を processCandidates（ownerIntake）に渡す。**ファイルは書き換えない**。plan を最終書き込み後に commitPending へ。
 * @returns {Promise<{data, added, updated, unverified, rejected, skipped, pending, plan, warning?:string}>}
 */
export async function processPending({ root, data, today, deps, opts }) {
  const empty = { data, added: [], updated: [], unverified: [], rejected: [], skipped: [], pending: [], plan: null };
  const cur = await readPending(root);
  if (cur.warning) return { ...empty, warning: cur.warning };
  const expired = (e) => e.pendingSince && daysBetween(e.pendingSince, today) > PENDING_MAX_DAYS;
  const batch = cur.items.filter((e) => !expired(e)).slice(0, PENDING_MAX_PER_RUN);
  const dropped = cur.items.filter(expired).map(pendingKey);
  if (!batch.length) return { ...empty, plan: dropped.length ? { processed: dropped, keep: [] } : null };

  const cands = batch.map((e) => ({ ...e, origin: "intake" }));
  const out = await processCandidates({ data, candidates: cands, today, deps, opts: { ...opts, trustOrigin: true, ownerIntake: true } });
  const byKey = new Map(batch.map((e) => [pendingKey(e), e]));
  const keep = [];
  for (const p of out.pending) {
    const orig = byKey.get(pendingKey(p));
    if (orig) keep.push({ ...orig, attempts: (Number(orig.attempts) || 0) + 1, lastCheckedAt: today });
  }
  for (const r of out.rejected) {
    if (!TRANSIENT_REJECT.has(r.reason)) continue;
    const orig = byKey.get(pendingKey({ intakeUrl: r.intakeUrl, title: r.title }));
    if (orig && !keep.some((k) => pendingKey(k) === pendingKey(orig))) keep.push({ ...orig, attempts: (Number(orig.attempts) || 0) + 1, lastCheckedAt: today });
  }
  return { ...out, plan: { processed: [...batch.map(pendingKey), ...dropped], keep } };
}

/** 処理済み分を保留から除去し、まだ未発表の分は更新して残す（最終書き込み成功後だけ呼ぶ。処理中に追記された分は残す）。 */
export async function commitPending(root, plan) {
  if (!plan) return;
  const cur = await readPending(root);
  if (cur.warning) throw new Error(cur.warning);
  const processed = new Set(plan.processed);
  const keepMap = new Map(plan.keep.map((e) => [pendingKey(e), e]));
  const next = [];
  for (const e of cur.items) {
    const k = pendingKey(e);
    if (!processed.has(k)) next.push(e);
    else if (keepMap.has(k)) next.push(keepMap.get(k));
  }
  await writeJsonAtomic(path.join(root, PENDING_REL), { version: 1, items: next });
}
