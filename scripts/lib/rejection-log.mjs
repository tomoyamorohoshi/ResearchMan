/**
 * 却下候補ログ。収集パイプラインが「なぜその候補を採用しなかったか」を
 * logs/rejections-YYYY-MM.jsonl（gitignored・月次で自然ローテ）に追記する。
 * キュレーション精度の改善ループ（却下理由の分布を見て収集プロンプト/検証を調整する）の基盤。
 * dry-run では呼ばないこと（呼び出し側の責務）。
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, "../../logs");

export async function logRejection({ pipeline, title, reason, detail = "", link = "" }) {
  try {
    await fs.mkdir(LOGS_DIR, { recursive: true });
    const month = new Date().toISOString().slice(0, 7);
    const file = path.join(LOGS_DIR, `rejections-${month}.jsonl`);
    const entry = { date: new Date().toISOString(), pipeline, title, reason, detail, link };
    await fs.appendFile(file, JSON.stringify(entry) + "\n");
  } catch {
    // ログ書き込み失敗はパイプライン本体を止めない
  }
}
