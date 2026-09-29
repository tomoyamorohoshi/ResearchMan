/**
 * ベイクオフの候補選択・tier案・Markdownレポート生成（純関数。DB非破壊）。
 * bakeoff-sources.mjs（main即実行スクリプト）から分離してテスト可能にしている。
 */

export const BAKEOFF_MAX_PER_RUN = 30;

const pct = (r) => (r === null || r === undefined ? "-" : `${Math.round(r * 100)}%`);
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/**
 * 今回実行する候補を選ぶ。kind=web のみ・enabled問わず・tier昇順(同tierは登録順)。
 * 既に採点済みは除外。1回の実行は最大30候補（超過分は次回）。skip は並列実行の分割用。
 */
export function selectCandidates(sources, { scoredIds = new Set(), limit = BAKEOFF_MAX_PER_RUN, skip = 0 } = {}) {
  const lim = Math.min(Math.max(1, limit | 0), BAKEOFF_MAX_PER_RUN);
  const pending = sources
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => s.kind === "web" && !scoredIds.has(s.id))
    .sort((a, b) => (a.s.tier - b.s.tier) || (a.idx - b.idx))
    .map(({ s }) => s);
  const after = pending.slice(Math.max(0, skip | 0));
  return { picked: after.slice(0, lim), remaining: Math.max(0, after.length - lim) };
}

/** accept率からのtier案（機械的な目安。最終判断はオーナー） */
export function suggestTier(summary) {
  if (!summary || summary.count === 0) return "取得失敗";
  if (summary.count < 5) return "保留(件数不足)";
  if (summary.acceptRate >= 0.5) return "tier1推奨";
  if (summary.acceptRate >= 0.3) return "tier2推奨";
  return "見送り";
}

/**
 * @param {{date:string, results:Array<{id,locator,tier,summary,fetchNote}>, unscored:string[], n:number}} p
 */
export function renderReport({ date, results, unscored = [], n = 10 }) {
  const ok = results.filter((r) => r.summary.count > 0).sort((a, b) => b.summary.acceptRate - a.summary.acceptRate || b.summary.count - a.summary.count);
  const failed = results.filter((r) => r.summary.count === 0);
  const lines = [];
  lines.push(`# 情報源ベイクオフ結果 ${date}`);
  lines.push("");
  lines.push(`- 生成: \`scripts/bakeoff-sources.mjs\`（設計書 docs/RADAR_V2_DESIGN.md §4-8）。kind=web のみ。1候補1回のClaude CLI呼び出しで、一覧ページの直近最大${n}件を取得し、関門A/B/C基準（\`scripts/lib/case-gate-criteria.mjs\`）で採点。`);
  lines.push(`- 採点済み ${results.length} 候補（取得成功 ${ok.length} / 取得失敗 ${failed.length}）。cases.json・sources.json は変更していない（read-only）。`);
  lines.push(`- **読み方**: accept率 = 関門A/B/Cのいずれかを満たした件数 ÷ 取得件数。1候補あたり最大${n}件の**小標本**なので、±20pt程度の揺れは誤差。tier案は目安（件数5件以上で accept率50%↑=tier1、30%↑=tier2、それ未満=見送り）。最終判断（\`enabled\`/\`tier\`）はオーナー。`);
  lines.push(`- 採点はモデルが一覧のタイトル・要約から行うため、告知記事の見抜きは得意だがクラフト(B)の過大評価に注意。代表例は必ず目視で確認すること。`);
  lines.push(`- **既知のバイアス**: 採点は一覧のタイトル・要約のみ（本文は開かない）。ブランドID系（リブランド紹介）・受賞/審査系の媒体は「要点が本文にある」ため過小評価されやすい。逆に制作会社の作品一覧は「企画そのもの」が題名になるため accept 寄りに出る。0%は「事例が無い」ではなく「一覧の要約からは判定不能」を含む。0%の媒体を除外する前に代表的な記事を目視すること。`);
  lines.push("");
  lines.push("## 結果（accept率の高い順）");
  lines.push("");
  lines.push("| 情報源 | 現tier | 件数 | accept率 | 基準内訳 | tier案 | 代表例（最大3件） |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const r of ok) {
    const s = r.summary;
    const ex = s.examples.map((e) => `[${esc(e.title).slice(0, 60)}](${e.url}) (${e.criterion}: ${esc(e.reason).slice(0, 40)})`).join("<br>");
    lines.push(
      `| ${esc(r.id)} | ${r.tier} | ${s.count} | ${pct(s.acceptRate)} (${s.accepted}/${s.count}) | A${s.byCriterion.A} / B${s.byCriterion.B} / C${s.byCriterion.C} | ${suggestTier(s)} | ${ex || "-"} |`
    );
  }
  lines.push("");
  lines.push("## 取得失敗");
  lines.push("");
  if (failed.length === 0) lines.push("なし");
  else {
    lines.push("| 情報源 | URL | 理由 |");
    lines.push("|---|---|---|");
    for (const r of failed) lines.push(`| ${esc(r.id)} | ${r.locator} | ${esc(r.fetchNote) || "取得0件（理由不明）"} |`);
  }
  lines.push("");
  lines.push("## 未実行（次回へ持ち越し）");
  lines.push("");
  lines.push(unscored.length ? `未実行: ${unscored.join(", ")}` : "なし");
  lines.push("");
  lines.push("## 対象外");
  lines.push("");
  lines.push("- X系候補（x_account / x_list / x_query）は Phase 0（捨て垢Cookie登録）未完了のため今回対象外。sources.json には登録のみ。");
  lines.push("");
  return lines.join("\n");
}
