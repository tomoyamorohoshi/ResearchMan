// TOPギャラリー用の「軽量インデックス」と「事例ごとの詳細JSON」を作る純関数群。
// 一覧・絞り込み・検索（summary全文を含む）・ソート・カード・3Dグラフ・パネル冒頭が使う項目だけを
// cases-index.json に残し、長文（overview/background/execution/...）は cases/<id>.json に分離する。
// 使う側: scripts/lib/public-data.mjs（配信用テキスト）, scripts/prepare-public-data.mjs（ファイル生成）

// クライアントが全件に対して参照する項目（GalleryClient/CaseCard/CasePanel冒頭/caseGraphAdapter/
// awards.ts(getCaseAwardRefs・compareByAward*)/researchSources.isRadarCase）。
// summary は検索対象のため全文のまま残す（挙動不変）。
export const INDEX_FIELDS = [
  "id",
  "title",
  "summary",
  "client",
  "agency",
  "categories",
  "award",
  "awardEntries",
  "year",
  "regions",
  "link",
  "thumbnail",
  "sources",
  "tags",
];

const INDEX_SET = new Set(INDEX_FIELDS);

// 隔離フラグ類は配信しない（cases.json配信と同様に quarantined===true の事例自体を除外する）
const OMIT_FIELDS = new Set(["quarantined", "quarantineReason", "quarantineTs"]);

export function pickIndexEntry(c) {
  const out = {};
  for (const k of INDEX_FIELDS) {
    if (c[k] !== undefined) out[k] = c[k];
  }
  return out;
}

// インデックスに入らなかった項目を全部詳細側へ（長文7項目＋videoId・legacy項目など）
export function pickDetailEntry(c) {
  const out = { id: c.id };
  for (const [k, v] of Object.entries(c)) {
    if (k === "id" || INDEX_SET.has(k) || OMIT_FIELDS.has(k)) continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function activeCases(cases) {
  return cases.filter((c) => !c.quarantined);
}

export function buildCasesIndex(cases) {
  return activeCases(cases).map(pickIndexEntry);
}

// クライアント(src/lib/caseDetail.ts)と同じ規則。idは英数ハイフン想定だが念のためエンコードする
export function detailFileName(id) {
  return `${encodeURIComponent(id)}.json`;
}

// [{ fileName, text }] を返す。idが無い/重複する事例は最初の1件だけ採用し、skippedに理由を残す
export function buildCaseDetailFiles(cases) {
  const files = [];
  const skipped = [];
  const seen = new Set();
  for (const c of activeCases(cases)) {
    if (typeof c.id !== "string" || c.id === "") {
      skipped.push({ id: c.id, reason: "no-id" });
      continue;
    }
    if (seen.has(c.id)) {
      skipped.push({ id: c.id, reason: "duplicate-id" });
      continue;
    }
    seen.add(c.id);
    files.push({ fileName: detailFileName(c.id), text: JSON.stringify(pickDetailEntry(c)) });
  }
  return { files, skipped };
}
