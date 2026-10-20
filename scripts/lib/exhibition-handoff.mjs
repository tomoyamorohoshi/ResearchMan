/**
 * Case Study 収集(auto-research-cc.mjs) → Exhibition 日次ジョブ(auto-research-exhibition.mjs) の引き継ぎ。
 *
 * cc の発見候補が「これから開催/開催中の展覧会・展示の告知」（会場と会期があり終了日が今日以降）だった場合、
 * cases には入れず data/inbox/exhibition-handoff.json（{version:1, items:[Exhibition候補…]}）へ積む。
 * Exhibition ジョブが発見フェーズの前に読み、processCandidates（公式ページ照合つき）へ渡す。
 * handoff はローカルのキュー（exhibition-unverified.json と同じ扱い・コミットしない）。
 */
import path from "path";
import { isValidYmd } from "./exhibition-status.mjs";
import { processCandidates } from "./exhibition-build.mjs";
import { readJson, writeJsonAtomic } from "./exhibition-io.mjs";

export const HANDOFF_REL = "data/inbox/exhibition-handoff.json";

const str = (v) => (typeof v === "string" ? v.trim() : "");
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : []);

/**
 * cc 発見候補 → Exhibition 候補。展覧会告知でなければ null（＝通常の cases 判定へ）。
 * 判定は「モデルの contentKind==="exhibition" 申告」＋「機械条件（会場・会期が妥当・終了日>=今日）」の両方を満たす時だけ。
 * @param {object} cand  cc の found 要素（contentKind, exhibition{venue,venueType,prefecture,city,startDate,endDate,admission,officialUrl,artists,tags,score}）
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
  const sourceUrl = str(cand.link);
  const n = Number(ex.score);
  return {
    title: str(cand.title),
    venue,
    venueType: str(ex.venueType),
    prefecture: str(ex.prefecture),
    city: str(ex.city),
    startDate,
    endDate,
    admission: str(ex.admission),
    matchReason: str(cand.note) || str(cand.gateReason),
    officialUrl: str(ex.officialUrl),
    artists: strList(ex.artists),
    tags: strList(ex.tags),
    sources: sourceUrl ? [{ name: "元記事", url: sourceUrl, kind: "news" }] : [],
    score: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0,
    sourceUrl,
  };
}

/** cc 発見プロンプトに差し込む「展覧会告知の振り分け」節（contentKind / exhibition フィールドの指示）。 */
export function exhibitionRoutingPromptSection() {
  return `## 展覧会・展示の振り分け（contentKind）
- 各候補に contentKind を付ける。"case"（通常の事例。既定）または "exhibition"。
- "exhibition" にするのは、**これから開催／開催中の展覧会・展示・インスタレーション展の告知で、会場と会期（終了日が今日以降）がはっきりしているもの**だけ。会期が終わった展示の振り返り記事、会場・会期が不明なものは "case"。
- "exhibition" の候補は Exhibition タブ側で公式ページ照合のうえ扱う。exhibition オブジェクトを必ず付ける（公式ページのURLはWebSearchで確認できたものだけ。不明なら空文字）:
  "exhibition": {"venue": "会場名", "venueType": "museum | alt_space | corporate | media_art_center | gallery | other", "prefecture": "都道府県（例: 東京都）", "city": "市区町村", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "admission": "入場料（不明ならUNKNOWN）", "officialUrl": "展覧会の公式ページURL", "artists": ["作家名"], "tags": [], "score": 0〜100（デジタル×クリエイティブ／メディアアート／空間体験の展示としての適合度。60以上で採用対象）}`;
}

const keyOf = (e) => `${e.title}|${e.officialUrl || ""}`;

/** handoff を読む。無ければ空、壊れていれば warning つきで空。 */
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

/** handoff へ追記（title+officialUrl で重複排除）。壊れた既存ファイルは作り直す。 */
export async function appendHandoff(root, items) {
  if (!items.length) return;
  const cur = await readHandoff(root);
  const seen = new Map(cur.items.filter((e) => e && typeof e === "object").map((e) => [keyOf(e), e]));
  for (const e of items) seen.set(keyOf(e), e);
  await writeJsonAtomic(path.join(root, HANDOFF_REL), { version: 1, items: [...seen.values()] });
}

/**
 * handoff の候補を processCandidates に渡し、処理済みを handoff から除去して原子的に書き戻す。
 * 除去しない（翌日へ持ち越す）のは daily-cap で見送られた分のみ。dryRun では書き換えない。
 * ファイル無しは何もしない。壊れていれば warning を返して data は変えない。
 * @returns {{data, added, updated, unverified, rejected, skipped, warning?: string}}
 */
export async function consumeHandoff({ root, data, today, deps, opts, dryRun }) {
  const empty = { data, added: [], updated: [], unverified: [], rejected: [], skipped: [] };
  const { items, warning } = await readHandoff(root);
  if (warning) return { ...empty, warning };
  if (!items.length) return empty;

  const out = await processCandidates({ data, candidates: items, today, deps, opts });
  if (!dryRun) {
    const carry = new Set(out.rejected.filter((r) => r.reason === "daily-cap").map((r) => r.title));
    const remaining = items.filter((e) => e && typeof e === "object" && carry.has(str(e.title)));
    await writeJsonAtomic(path.join(root, HANDOFF_REL), { version: 1, items: remaining });
  }
  return out;
}
