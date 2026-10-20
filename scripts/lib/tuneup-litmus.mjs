/**
 * 判定の具体例（リトマス。data/case-gate.json の litmus.accept / litmus.reject）の自動入れ替え。
 * 仕様: docs/CASE_RESEARCH_V3_SPEC.md §5 表1行目。決定的な純関数（AI非依存。why は候補側が持つ要約を使う）。
 *
 * 規則:
 *   - borderline で fav されたもの → accept 候補、トラッシュされたもの → reject 候補（呼び出し側が渡す。新しい順を推奨）
 *   - 各側最大 LITMUS_SIDE_MAX(8)件。1回の入れ替えは追加・置換の合計 LITMUS_SWAP_MAX(3)件まで。accept/reject を交互に採る
 *   - 空きがあれば追加、満杯なら置換。外す順（ORIGIN_KEEP_RANK の小さい=外しやすい順→同順位は addedAt が古い順→配列の前方）:
 *       tuneup(過去の自動追加) < その他(media 等) < award < seed / owner-fav
 *   - origin の全滅を避ける: 外す結果その origin が側から消えるなら外さない（新規は origin="tuneup" なので tuneup だけは外してよい）
 *   - 今回追加した候補は同じ回で外さない
 *   - 既存の URL（normLink）・タイトル（normTitle）と重複する候補、反対側と重複する候補、候補同士の重複は入れない
 *   - 外せるものが無ければその候補はスキップ（置換しない）
 *   - 結果は validateCaseGate を通す。通らなければ変更なし
 */
import { normLink } from "./norm-link.mjs";
import { normTitle } from "./norm-title.mjs";
import { validateCaseGate } from "./case-gate-criteria.mjs";

export const LITMUS_SIDE_MAX = 8;
export const LITMUS_SWAP_MAX = 3;
/** 履歴（追加・外した・見送った例）の保持上限。古い順に切る */
export const HISTORY_MAX = 400;
const WHY_MAX = 140;
/** 値が小さいほど外しやすい。未知の origin は 1（media 等と同列） */
export const ORIGIN_KEEP_RANK = { tuneup: 0, award: 2, seed: 3, "owner-fav": 3 };
const DEFAULT_RANK = 1;
const NEW_ORIGIN = "tuneup";

const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";
const rankOf = (origin) => ORIGIN_KEEP_RANK[origin] ?? DEFAULT_RANK;
const ymd = (d) => d.toISOString().slice(0, 10);

function keysOf(e) {
  return { link: normLink(e.url), title: normTitle(e.title) };
}

/** 外す1件のインデックスを選ぶ。無ければ -1。list は現在の側の配列、fresh は今回追加済みの要素集合。 */
function pickEviction(list, fresh) {
  const originCount = {};
  for (const e of list) originCount[e.origin] = (originCount[e.origin] || 0) + 1;
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (fresh.has(e)) continue;
    if (e.origin !== NEW_ORIGIN && originCount[e.origin] <= 1) continue; // 全滅回避
    if (best < 0) {
      best = i;
      continue;
    }
    const b = list[best];
    const dr = rankOf(e.origin) - rankOf(b.origin);
    if (dr < 0 || (dr === 0 && String(e.addedAt) < String(b.addedAt))) best = i;
  }
  return best;
}

/**
 * @param {object} gate case-gate.json の中身（破壊しない）
 * @param {{favCandidates?: Array<{title:string,url?:string,why:string}>, trashCandidates?: Array, now?: Date, max?: number, cap?: number}} o
 * @returns {{gate: object, changed: boolean, changes: Array<{side:'accept'|'reject', action:'add'|'replace', added:object, removed:object|null}>}}
 */
/**
 * borderline の fav / トラッシュ一覧（{title, link}）と AI が書いた why から入れ替え候補を作る。
 * why が無い・空・側が違う候補は採らない（記事の要約は流用しない）。一覧は cases.json の追加順なので新しい順に並べ直す。
 * @param {Array<{title:string, link?:string}>} list
 * @param {Array<{title:string, side:'accept'|'reject', why:string}>|undefined} whys
 */
export function buildLitmusCandidates(list, whys, side) {
  const byTitle = new Map();
  for (const w of Array.isArray(whys) ? whys : []) {
    if (!w || w.side !== side || !nonEmpty(w.why) || !nonEmpty(w.title)) continue;
    const k = normTitle(w.title);
    if (!byTitle.has(k)) byTitle.set(k, w.why.replace(/\s+/g, " ").trim().slice(0, WHY_MAX));
  }
  return [...(list || [])]
    .reverse()
    .map((c) => ({ title: c.title, url: c.link, why: byTitle.get(normTitle(c.title)) }))
    .filter((c) => nonEmpty(c.title) && nonEmpty(c.why));
}

export function planLitmusSwap(gate, { favCandidates = [], trashCandidates = [], now = new Date(), max = LITMUS_SWAP_MAX, cap = LITMUS_SIDE_MAX, history = [] } = {}) {
  const next = JSON.parse(JSON.stringify(gate));
  const lists = { accept: [...(next.litmus?.accept || [])], reject: [...(next.litmus?.reject || [])] };
  const queues = {
    accept: Array.isArray(favCandidates) ? [...favCandidates] : [],
    reject: Array.isArray(trashCandidates) ? [...trashCandidates] : [],
  };
  const seenLinks = new Set();
  const seenTitles = new Set();
  for (const e of [...lists.accept, ...lists.reject]) {
    const k = keysOf(e);
    if (k.link) seenLinks.add(k.link);
    if (k.title) seenTitles.add(k.title);
  }
  const fresh = new Set();
  const changes = [];
  const today = ymd(now);
  // 履歴: 過去に追加した/外した/見送った例は再採用しない（毎週の入れ替わり続けを防ぐ）
  const nextHistory = Array.isArray(history) ? [...history] : [];
  const histLinks = new Set();
  const histTitles = new Set();
  const addHistKeys = (e) => {
    const k = keysOf(e);
    if (k.link) histLinks.add(k.link);
    if (k.title) histTitles.add(k.title);
  };
  nextHistory.forEach(addHistKeys);
  const record = (e, outcome) => {
    const h = { title: e.title, ...(nonEmpty(e.url) ? { url: e.url } : {}), outcome, at: today };
    nextHistory.push(h);
    addHistKeys(h);
  };

  const nextCandidate = (side) => {
    const q = queues[side];
    while (q.length) {
      const c = q.shift();
      if (!c || !nonEmpty(c.title) || !nonEmpty(c.why)) continue;
      const k = keysOf(c);
      if ((k.link && seenLinks.has(k.link)) || (k.title && seenTitles.has(k.title))) continue;
      if ((k.link && histLinks.has(k.link)) || (k.title && histTitles.has(k.title))) continue;
      return c;
    }
    return null;
  };

  let exhausted = { accept: false, reject: false };
  let side = "accept";
  while (changes.length < max && !(exhausted.accept && exhausted.reject)) {
    if (exhausted[side]) {
      side = side === "accept" ? "reject" : "accept";
      continue;
    }
    const c = nextCandidate(side);
    if (!c) {
      exhausted[side] = true;
      side = side === "accept" ? "reject" : "accept";
      continue;
    }
    const entry = { title: c.title.trim(), ...(nonEmpty(c.url) ? { url: c.url.trim() } : {}), why: c.why.trim(), origin: NEW_ORIGIN, addedAt: today };
    const list = lists[side];
    let removed = null;
    if (list.length >= cap) {
      const idx = pickEviction(list, fresh);
      if (idx < 0) {
        // この側は置換不能。候補は見送りとして履歴に残し、側ごと諦める（別候補でも結果は同じ）
        record(c, "skipped");
        exhausted[side] = true;
        side = side === "accept" ? "reject" : "accept";
        continue;
      }
      removed = list.splice(idx, 1)[0];
      record(removed, "removed");
    }
    list.push(entry);
    fresh.add(entry);
    record(entry, "added");
    const k = keysOf(entry);
    if (k.link) seenLinks.add(k.link);
    if (k.title) seenTitles.add(k.title);
    changes.push({ side, action: removed ? "replace" : "add", added: entry, removed });
    side = side === "accept" ? "reject" : "accept";
  }

  const trimmedHistory = nextHistory.slice(-HISTORY_MAX);
  if (!changes.length) return { gate: next, changed: false, changes: [], history: trimmedHistory };
  next.litmus = { ...next.litmus, accept: lists.accept, reject: lists.reject };
  next.updatedAt = today;
  if (validateCaseGate(next).length) return { gate: JSON.parse(JSON.stringify(gate)), changed: false, changes: [], history: Array.isArray(history) ? history : [] };
  return { gate: next, changed: true, changes, history: trimmedHistory };
}
