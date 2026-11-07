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
import { daysBetween, isValidYmd } from "./exhibition-status.mjs";
import { readJson, writeJsonAtomic } from "./exhibition-io.mjs";

export const PENDING_REL = "data/inbox/exhibition-pending.json";
/** 保留してから打ち切るまでの日数（日付が出ないまま残り続けない）。 */
export const PENDING_MAX_DAYS = 180;
/** 1回の日次ジョブで再調査する保留の最大件数（Claude 呼び出しの上限）。 */
export const PENDING_MAX_PER_RUN = 5;

const str = (v) => (typeof v === "string" ? v.trim() : "");
/** 保留のキー: 投稿URL + 最初の題名(pendingTitle)。再調査で title が変わってもキーは変わらない。 */
export const pendingKey = (e) => `${normLink(str(e.intakeUrl)) || str(e.intakeUrl)}|${str(e.pendingTitle) || str(e.title)}`;
/** 再調査してもこの回数で日付が出ない/追加できない保留は理由を残して外す。 */
export const PENDING_MAX_ATTEMPTS = 14;

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
    // pendingSince が不正な値なら今日で補正する
    seen.set(pendingKey(e), { ...e, pendingTitle: str(e.pendingTitle) || str(e.title), pendingSince: isValidYmd(e.pendingSince) ? e.pendingSince : today, attempts: Number(e.attempts) || 0 });
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
  // pendingSince が不正なら今日扱い（期限切れにしない）
  const since = (e) => (isValidYmd(e.pendingSince) ? e.pendingSince : today);
  const tooOld = (e) => daysBetween(since(e), today) > PENDING_MAX_DAYS;
  const tooMany = (e) => (Number(e.attempts) || 0) >= PENDING_MAX_ATTEMPTS;
  const dead = cur.items.filter((e) => tooOld(e) || tooMany(e));
  const batch = cur.items.filter((e) => !tooOld(e) && !tooMany(e)).slice(0, PENDING_MAX_PER_RUN);
  // 外した保留は理由を残して unverified キュー（appendUnverified → 通知サマリー）に返す
  const expired = dead.map((e) => ({
    title: str(e.pendingTitle) || str(e.title), venue: str(e.venue), link: "", intakeUrl: str(e.intakeUrl), at: deps.now(),
    reason: "pending-expired: " + (tooMany(e) ? `${PENDING_MAX_ATTEMPTS}回再調査しても` : `${PENDING_MAX_DAYS}日たっても`) + `追加できなかったため保留から外しました（最後の理由: ${str(e.pendingReason) || "不明"}）`,
  }));
  const deadKeys = dead.map(pendingKey);
  if (!batch.length) return { ...empty, unverified: expired, plan: deadKeys.length ? { processed: deadKeys, keep: [] } : null };

  const cands = batch.map((e) => ({ ...e, origin: "intake" }));
  const out = await processCandidates({ data, candidates: cands, today, deps, opts: { ...opts, trustOrigin: true, ownerIntake: true } });
  const byKey = new Map(batch.map((e) => [pendingKey(e), e]));
  const keep = [];
  const bump = (orig, p) => {
    const attempts = (Number(orig.attempts) || 0) + 1;
    const k = { ...orig, attempts, lastCheckedAt: today, ...(p?.pendingReason ? { pendingReason: p.pendingReason } : {}) };
    // 今回の再調査で確認できた項目（題名・日付など）は引き継ぐ。ただし保留のキー(pendingTitle/intakeUrl)は不変
    if (p) Object.assign(k, { ...p, pendingTitle: orig.pendingTitle || orig.title, intakeUrl: orig.intakeUrl, attempts, lastCheckedAt: today, pendingSince: orig.pendingSince });
    keep.push(k);
  };
  for (const p of out.pending) {
    const orig = byKey.get(pendingKey(p));
    if (orig) bump(orig, p);
  }
  for (const r of out.rejected) {
    if (!TRANSIENT_REJECT.has(r.reason)) continue;
    const orig = byKey.get(pendingKey({ intakeUrl: r.intakeUrl, title: r.title, pendingTitle: r.pendingTitle }));
    if (orig && !keep.some((k) => pendingKey(k) === pendingKey(orig))) bump(orig, null);
  }
  // 上限に達した保留はここで外す（理由を残す）。次回まで持ち越さない
  const stillOk = [];
  for (const k of keep) {
    if ((Number(k.attempts) || 0) >= PENDING_MAX_ATTEMPTS) {
      expired.push({ title: str(k.pendingTitle) || str(k.title), venue: str(k.venue), link: "", intakeUrl: str(k.intakeUrl), at: deps.now(), reason: `pending-expired: ${PENDING_MAX_ATTEMPTS}回再調査しても追加できなかったため保留から外しました（最後の理由: ${str(k.pendingReason) || "不明"}）` });
    } else stillOk.push(k);
  }
  return { ...out, unverified: [...out.unverified, ...expired], plan: { processed: [...batch.map(pendingKey), ...deadKeys], keep: stillOk } };
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
