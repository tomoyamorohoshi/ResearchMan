// システム系通知（LINEに送らないもの）の受け皿。2026-10-20仕様変更:
// LINEは「事例のシェア」と「ユーザー自身の依頼への返信」だけに使い、エラー・点検・自動修復などの
// システム系は logs/system-alerts.jsonl に1行1件で追記する（{at, source, level, title, body}）。
// 加えて人が読める logs/system-alerts-latest.md（直近7日・新しい順・上限100件）を毎回再生成する。
// logs/ は .gitignore 済み（incidents.json 等と同じ扱い＝コミットしない運用ログ置き場）。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const ALERTS_JSONL = "system-alerts.jsonl";
export const ALERTS_LATEST_MD = "system-alerts-latest.md";
export const LATEST_DAYS = 7;
export const MAX_LATEST = 100;
const LEVELS = ["info", "warn", "error"];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_LOGS_DIR = path.join(__dirname, "..", "..", "logs"); // scripts/lib -> repo root/logs

export function readSystemAlerts(logsDir = DEFAULT_LOGS_DIR) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(logsDir, ALERTS_JSONL), "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // 壊れた行は読み飛ばす
    }
  }
  return out;
}

const LEVEL_MARK = { error: "[ERROR]", warn: "[WARN]", info: "[INFO]" };

export function renderLatestMd(alerts, now = new Date()) {
  const since = now.getTime() - LATEST_DAYS * 86400000;
  const recent = alerts
    .filter((a) => {
      const ms = Date.parse(a.at);
      return Number.isFinite(ms) && ms >= since;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, MAX_LATEST);
  const lines = [
    "# ResearchMan システム通知（LINE非送信）",
    "",
    `直近${LATEST_DAYS}日・新しい順・最大${MAX_LATEST}件。生成: ${now.toISOString()}`,
    "",
  ];
  if (recent.length === 0) {
    lines.push("該当期間のシステム通知はありません。");
    return `${lines.join("\n")}\n`;
  }
  for (const a of recent) {
    lines.push(`## ${LEVEL_MARK[a.level] || LEVEL_MARK.info} ${a.title}`);
    lines.push("");
    lines.push(`- 日時: ${a.at}`);
    lines.push(`- 発生元: ${a.source}`);
    if (a.body) {
      lines.push("");
      lines.push("```");
      lines.push(String(a.body));
      lines.push("```");
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * @param {{source:string, level?:string, title:string, body?:string}} alert
 * @param {{logsDir?:string, now?:Date}} opts
 */
export function appendSystemAlert(alert, { logsDir = DEFAULT_LOGS_DIR, now = new Date() } = {}) {
  const entry = {
    at: alert.at || now.toISOString(),
    source: String(alert.source || "unknown"),
    level: LEVELS.includes(alert.level) ? alert.level : "info",
    title: String(alert.title || ""),
    body: String(alert.body ?? ""),
  };
  fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(path.join(logsDir, ALERTS_JSONL), `${JSON.stringify(entry)}\n`);
  const md = renderLatestMd(readSystemAlerts(logsDir), now);
  const mdPath = path.join(logsDir, ALERTS_LATEST_MD);
  const tmp = `${mdPath}.tmp`;
  fs.writeFileSync(tmp, md);
  fs.renameSync(tmp, mdPath);
  return entry;
}
