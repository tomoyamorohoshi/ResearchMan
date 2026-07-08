/**
 * 日曜deep監査（scripts/watchdog.mjs runDeepAudit）の隔離候補選定ロジック。
 * 純粋関数のみを切り出し、fixtureで単体テストできるようにしてある
 * （watchdog.mjs自体はmain()をトップレベル即実行するため直接importしてはいけない。
 * OPERATIONS.md §4「main()をトップレベルで即実行するスクリプトをimportしない」参照）。
 */

// 同一entryが複数の理由（例: thumbnail欠損 かつ audit-tech FAIL）で重複して候補配列に
// 入りうるため、dataset+idでユニーク化する。重複時は理由を" / "で結合して残す。
// 敵対的レビューで検出: 重複除去しないと5件上限・件数報告が実際のユニーク件数からズレる。
export function dedupeCandidates(candidates) {
  const map = new Map();
  for (const c of candidates || []) {
    const key = `${c.dataset}:${c.id}`;
    const existing = map.get(key);
    if (existing) {
      existing.reason = `${existing.reason} / ${c.reason}`;
    } else {
      map.set(key, { ...c });
    }
  }
  return [...map.values()];
}

// audit-tech.mjsのFAIL行（`✗ <SOMETHING>: <id>`形式）からtech idを抽出する。
// `✗ ORPHANED THUMBNAIL FILE: public/thumbnails/tech/xxx.jpg`のような「idを名乗らない」
// 行にもマッチしてしまい、実在しないid（例:"public"）を候補にしてしまう事故があったため、
// 抽出したidがknownIds（実際のtech.jsonのid集合）に存在する場合のみ採用する。
export function extractKnownTechIdsFromAuditFailLines(lines, knownIds) {
  const known = new Set(knownIds || []);
  const ids = [];
  for (const line of lines || []) {
    const m = line.match(/^✗ [A-Z_ ]+: ([a-z0-9-]+)/i);
    if (m && known.has(m[1])) ids.push(m[1]);
  }
  return ids;
}
