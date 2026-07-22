// logs/notify-queue.jsonl（routine通知の積み残しキュー）を1本のダイジェスト本文へ
// まとめる純関数群。notify-digest.mjs から呼ばれる（node:testで単体テスト済み）。

/**
 * jsonlをパースする。空行は無視。壊れた行（JSON.parse失敗）はエラーを投げず読み飛ばす。
 * @param {string} rawText
 * @returns {Array<{at: string, label: string, text: string}>}
 */
export function parseQueueLines(rawText) {
  const entries = [];
  for (const line of rawText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // 壊れた行は静かにスキップ
    }
  }
  return entries;
}

// entry.at（ISO8601文字列）からローカルタイムの YYYY-MM-DD を取り出す
function localDateStr(atIso) {
  const d = new Date(atIso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// MM/DD 表記（持ち越し項目の日付明記用）
function monthDayStr(atIso) {
  const d = new Date(atIso);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}/${day}`;
}

/**
 * entries のうち at の日付部分（ローカルタイム）が todayISODateStr と一致するものだけ返す。
 * 注意: この関数は「本日件数の見出し表示用」に使うだけで、送信対象の絞り込みには使わない
 * （日付で絞ると前日以前の残留queue項目を握り潰して消してしまうバグになるため）。
 * @param {Array<{at, label, text}>} entries
 * @param {string} todayISODateStr "YYYY-MM-DD"
 */
export function filterToday(entries, todayISODateStr) {
  return entries.filter((e) => localDateStr(e.at) === todayISODateStr);
}

// text（複数行の可能性あり）の1行目を短い要約として取り出す
function firstLine(text) {
  const idx = text.indexOf("\n");
  return idx === -1 ? text : text.slice(0, idx);
}

/**
 * entries（queueファイルの全件。当日分に限らない想定）からダイジェスト本文を組み立てる。
 * 空配列なら空文字列を返す（呼び出し側で「送るものがない」と判定する材料にする）。
 * @param {Array<{at, label, text}>} entries
 * @param {string} todayISODateStr "YYYY-MM-DD"
 */
export function buildDigestText(entries, todayISODateStr) {
  if (entries.length === 0) return "";
  const todayCount = filterToday(entries, todayISODateStr).length;
  const lines = [`📋 本日のRM活動 (${todayCount}件)`, ""];
  for (const e of entries) {
    const isToday = localDateStr(e.at) === todayISODateStr;
    const prefix = isToday ? "" : `[${monthDayStr(e.at)}] `;
    lines.push(`・${prefix}${e.label}: ${firstLine(e.text)}`);
  }
  return lines.join("\n");
}
