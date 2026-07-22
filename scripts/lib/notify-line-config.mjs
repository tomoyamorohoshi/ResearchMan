// ~/.researchman-line.json の読込ロジック（notify-line.mjs から切り出し）。
// 挙動不変: 読込失敗・不備時は静かに null を返す（呼び出し側が通知スキップと判断する）。
import fs from "fs";
import os from "os";
import path from "path";

export const CONFIG_PATH = path.join(os.homedir(), ".researchman-line.json");

export function loadLineConfig(log = () => {}, configPath = CONFIG_PATH) {
  if (!fs.existsSync(configPath)) {
    log(`設定ファイルなし（${configPath}）→ 通知スキップ`);
    return null;
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!cfg.channelAccessToken) {
      log("設定に channelAccessToken が不足 → 通知スキップ");
      return null;
    }
    return cfg;
  } catch (e) {
    log(`設定読込失敗（${e.message}）→ 通知スキップ`);
    return null;
  }
}
