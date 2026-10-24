/**
 * likes.userPicks（オーナーが自分で投稿した展示の例）の機械的な記録と、採点プロンプト用の整形。純関数。
 *
 * 目的: 「素点が低かったのにオーナーが投稿した」展示を嗜好の過小評価の証拠として残し、
 * 自動発見の採点にだけ小さく（最大 +10）効かせる。テーマ・発見クエリ・閾値は変更しない（母集団を広げない）。
 * 記録は processCandidates が返す userPicks（コードで機械的に抽出）を applyUserPicks で追記するだけ。
 */
import { normTitle } from "./norm-title.mjs";

export const USER_PICKS_MAX = 10;
export const USER_PICK_BOOST_MAX = 10;

const key = (p) => `${normTitle(String(p.title || "").normalize("NFKC"))}|${normTitle(String(p.venue || "").normalize("NFKC"))}`;
const isStr = (v) => typeof v === "string" && v.trim() !== "";
const valid = (p) => p && typeof p === "object" && isStr(p.title) && isStr(p.why);

/** profile.likes.userPicks に picks を追記（同題・同会場は無視）。最大 USER_PICKS_MAX 件で古いものから押し出す。入力は変更しない。 */
export function applyUserPicks(profile, picks) {
  const incoming = (Array.isArray(picks) ? picks : []).filter(valid);
  if (!incoming.length) return profile;
  const next = structuredClone(profile);
  next.likes = next.likes || {};
  const list = Array.isArray(next.likes.userPicks) ? next.likes.userPicks : [];
  const seen = new Set(list.map(key));
  for (const p of incoming) {
    if (seen.has(key(p))) continue;
    seen.add(key(p));
    list.push({
      title: String(p.title).trim(),
      venue: String(p.venue || "").trim(),
      tags: Array.isArray(p.tags) ? p.tags.filter((t) => typeof t === "string") : [],
      why: String(p.why).trim(),
      addedAt: String(p.addedAt || ""),
    });
  }
  next.likes.userPicks = list.slice(-USER_PICKS_MAX);
  return next;
}

/** 発見フェーズの採点プロンプトにだけ付けるブロック。userPicks が無ければ空文字。 */
export function userPicksPromptBlock(profile) {
  const picks = (profile?.likes?.userPicks || []).filter(valid);
  if (!picks.length) return "";
  const lines = picks.map((p) => `- ${p.title}（${p.venue || "会場不明"}） tags=${(p.tags || []).join(",") || "-"} / 好みのポイント: ${p.why}`).join("\n");
  return `

# オーナーが自分で投稿した展示の例（user_pick_similarity 用）
${lines}
- 候補がこれらと同種と**明確に言える**場合に限り、score に最大 +${USER_PICK_BOOST_MAX}（component \`user_pick_similarity\`）を加え、加点した値を候補の "userPickBoost"（0〜${USER_PICK_BOOST_MAX}の整数）に書く。加点しない候補は 0 または省略
- 似ているだけで技術・空間性の無いもの（単なる芸術祭・絵画中心など）には付けない。hard 除外は覆さない（該当は excludeCategory に入れる）
- 発見クエリ・探す範囲は広げない。これは採点の微調整であり、候補の探索対象ではない`;
}
