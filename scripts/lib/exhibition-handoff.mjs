/**
 * Case Study 収集(auto-research-cc.mjs) → Exhibition 日次ジョブ(auto-research-exhibition.mjs) の引き継ぎ。
 *
 * cc の発見候補が「これから開催/開催中の国内の展覧会・展示の告知（会場と会期があり終了日が今日以降）」だった場合、
 * cases には入れず data/inbox/exhibition-handoff.json（{version:1, items:[Exhibition候補…]}）へ積む。
 * Exhibition ジョブが発見フェーズの前に読み、processCandidates（公式ページ照合つき）へ渡す。
 * 除去は main() 末尾の最終書き込み成功後（commitHandoff）。巻き戻し等で失わないよう、それまで handoff は変更しない。
 * handoff はローカルのキュー（exhibition-unverified.json と同じ扱い・コミットしない）。
 */
import path from "path";
import { isValidYmd } from "./exhibition-status.mjs";
import { processCandidates, PREFECTURES } from "./exhibition-build.mjs";
import { readJson, writeJsonAtomic } from "./exhibition-io.mjs";

export const HANDOFF_REL = "data/inbox/exhibition-handoff.json";
/** 一時失敗の持ち越し上限（この回数目の失敗で除去）。 */
export const MAX_ATTEMPTS = 3;

const str = (v) => (typeof v === "string" ? v.trim() : "");
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : []);

function canonicalPrefecture(p) {
  const s = str(p);
  if (PREFECTURES.includes(s)) return s;
  return PREFECTURES.find((x) => x.slice(0, -1) === s) || "";
}

/**
 * cc 発見候補 → Exhibition 候補。展覧会告知でなければ null（＝通常の cases 判定へ）。
 * 判定は「モデルの contentKind==="exhibition" 申告」＋「機械条件」の両方を満たす時だけ。
 * 機械条件: 会場あり・会期が妥当・終了日>=今日・国内（都道府県を確定できる）・score が数値。
 * @param {object} cand  cc の found 要素
 * @param {string} today JST YYYY-MM-DD
 */
export function toHandoffItem(cand, today) {
  if (!cand || cand.contentKind !== "exhibition") return null;
  const ex = cand.exhibition && typeof cand.exhibition === "object" ? cand.exhibition : null;
  if (!ex) return null;
  const venue = str(ex.venue);
  const startDate = str(ex.startDate);
  const endDate = str(ex.endDate);
  if (!venue || !isValidYmd(startDate) || !isValidYmd(endDate)) return null;
  if (startDate > endDate || endDate < today) return null;
  const prefecture = canonicalPrefecture(ex.prefecture);
  if (!prefecture) return null;
  const rawScore = typeof ex.score === "string" ? (ex.score.trim() === "" ? NaN : Number(ex.score)) : ex.score;
  if (typeof rawScore !== "number" || !Number.isFinite(rawScore)) return null;
  const sourceUrl = str(cand.link);
  return {
    title: str(cand.title),
    venue,
    venueType: str(ex.venueType),
    prefecture,
    city: str(ex.city),
    startDate,
    endDate,
    admission: str(ex.admission),
    matchReason: str(cand.note) || str(cand.gateReason),
    officialUrl: str(ex.officialUrl),
    artists: strList(ex.artists),
    tags: strList(ex.tags),
    sources: sourceUrl ? [{ name: "元記事", url: sourceUrl, kind: "news" }] : [],
    score: Math.max(0, Math.min(100, Math.round(rawScore))),
    sourceUrl,
  };
}

/** 照合キー（追記の重複排除・持ち越し照合で共通）。 */
const keyOf = (e) => `${str(e.title)}|${str(e.officialUrl)}`;

/** handoff を読む。無ければ空、読めない/形式不正は warning つきで空。 */
async function readHandoff(root) {
  const p = path.join(root, HANDOFF_REL);
  let raw;
  try {
    raw = await readJson(p);
  } catch (e) {
    if (e?.code === "ENOENT") return { items: [] };
    return { items: [], warning: `handoff 読込失敗（${e.message}）` };
  }
  if (!raw || !Array.isArray(raw.items)) return { items: [], warning: "handoff の形式が不正（items 配列なし）" };
  return { items: raw.items };
}

/** handoff へ追記（重複排除）。ファイルが ENOENT 以外で読めないときは上書きせず throw。 */
export async function appendHandoff(root, items) {
  if (!items.length) return;
  const cur = await readHandoff(root);
  if (cur.warning) throw new Error(cur.warning);
  const seen = new Map(cur.items.filter((e) => e && typeof e === "object").map((e) => [keyOf(e), e]));
  for (const e of items) if (!seen.has(keyOf(e))) seen.set(keyOf(e), e);
  await writeJsonAtomic(path.join(root, HANDOFF_REL), { version: 1, items: [...seen.values()] });
}

// 再試行に値する一時失敗（公式ページ取得失敗・5xx・候補処理の例外・日次上限）。それ以外の reject/unverified は恒久扱い。
const TRANSIENT_UNVERIFIED = /official-fetch-(error|failed)|official-status-5\d\d/;
const TRANSIENT_REJECT = new Set(["daily-cap", "candidate-error"]);

/**
 * handoff の候補を processCandidates に渡す。**handoff ファイルは書き換えない**。
 * 戻り値の plan を、最終書き込み成功後に commitHandoff へ渡して除去する。
 * 壊れていれば warning を返して data は変えない。
 * @returns {{data, added, updated, unverified, rejected, skipped, plan: {carry: string[]}, warning?: string}}
 */
export async function consumeHandoff({ root, data, today, deps, opts }) {
  const empty = { data, added: [], updated: [], unverified: [], rejected: [], skipped: [], plan: null };
  const { items, warning } = await readHandoff(root);
  if (warning) return { ...empty, warning };
  if (!items.length) return empty;

  const out = await processCandidates({ data, candidates: items, today, deps, opts });
  const carry = new Set();
  for (const r of out.rejected) if (TRANSIENT_REJECT.has(r.reason)) carry.add(`${str(r.title)}|${str(r.link)}`);
  const sourceByKey = new Map(items.filter((e) => e && typeof e === "object").map((e) => [keyOf(e), str(e.sourceUrl)]));
  const unverified = out.unverified.map((u) => {
    const k = `${str(u.title)}|${str(u.link)}`;
    if (TRANSIENT_UNVERIFIED.test(String(u.reason))) carry.add(k);
    const sourceUrl = sourceByKey.get(k);
    return sourceUrl ? { ...u, sourceUrl } : u;
  });
  return { ...out, unverified, plan: { processed: items.filter((e) => e && typeof e === "object").map(keyOf), carry: [...carry] } };
}

/**
 * 処理済み分を handoff から除去する（最終書き込み成功後・cliFatal でない時だけ呼ぶ）。
 * 書き戻し直前に再読込し、処理済み(plan.processed)の分だけ操作する＝処理中に追記された分は残す。
 * 一時失敗(plan.carry)は attempts を +1 して持ち越し、MAX_ATTEMPTS 到達で除去。
 */
export async function commitHandoff(root, plan) {
  if (!plan) return;
  const cur = await readHandoff(root);
  if (cur.warning) throw new Error(cur.warning);
  const processed = new Set(plan.processed);
  const carry = new Set(plan.carry);
  const next = [];
  for (const e of cur.items) {
    if (!e || typeof e !== "object") continue;
    const k = keyOf(e);
    if (!processed.has(k)) {
      next.push(e);
      continue;
    }
    if (!carry.has(`${str(e.title)}|${str(e.officialUrl)}`)) continue;
    const attempts = (Number(e.attempts) || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) continue;
    next.push({ ...e, attempts });
  }
  await writeJsonAtomic(path.join(root, HANDOFF_REL), { version: 1, items: next });
}

/** cc 発見プロンプトに差し込む「展覧会告知の振り分け」節（contentKind / exhibition フィールドの指示）。 */
export function exhibitionRoutingPromptSection() {
  return `## 展覧会・展示の振り分け（contentKind）
- 各候補に contentKind を付ける。"case"（通常の事例。既定）または "exhibition"。
- "exhibition" にするのは、**これから開催／開催中の日本国内の展覧会・展示・インスタレーション展の告知で、会場と会期（終了日が今日以降）がはっきりしているもの**だけ。会期が終わった展示の振り返り記事、会場・会期が不明なもの、海外の展覧会は "case"。
- "exhibition" の候補は Exhibition タブ側で公式ページ照合のうえ扱う。exhibition オブジェクトを必ず付ける（公式ページのURLはWebSearchで確認できたものだけ。不明なら空文字）:
  "exhibition": {"venue": "会場名", "venueType": "museum | alt_space | corporate | media_art_center | gallery | other", "prefecture": "都道府県（例: 東京都）", "city": "市区町村", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "admission": "入場料（不明ならUNKNOWN）", "officialUrl": "展覧会の公式ページURL", "artists": ["作家名"], "tags": [], "score": 0〜100の数値（デジタル×クリエイティブ／メディアアート／空間体験の展示としての適合度。60以上で採用対象）}`;
}
