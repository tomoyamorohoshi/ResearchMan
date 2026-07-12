/**
 * LINE連携設定（~/.researchman-line.json）の読み込み。
 *
 * scripts/notify-line.mjs と同じファイルを共有する（channelAccessToken は既存キー）。
 * このタスクで追加想定のキー:
 *   - channelSecret: Messaging API チャネルの Channel secret（署名検証用）
 *   - allowedUserId: webhookを受理する唯一のLINE userId（送信者制限）
 *
 * ファイルの更新はユーザーが行う想定のため、ここでは読み取りのみ（書き込み関数は用意しない）。
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface LineConfig {
  channelAccessToken?: string;
  channelSecret?: string;
  allowedUserId?: string;
}

export const LINE_CONFIG_PATH = path.join(os.homedir(), ".researchman-line.json");

/** 生JSON文字列 → LineConfig（純粋・テスト用に fs アクセスと分離）。壊れたJSON/非オブジェクトは null。 */
export function parseLineConfig(raw: string): LineConfig | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as LineConfig;
  } catch {
    return null;
  }
}

/** ~/.researchman-line.json を読む。存在しない/壊れている場合は null（呼び出し側は503/スキップで対応）。 */
export function loadLineConfig(): LineConfig | null {
  if (!existsSync(LINE_CONFIG_PATH)) return null;
  try {
    return parseLineConfig(readFileSync(LINE_CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}
