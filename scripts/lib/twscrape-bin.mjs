/**
 * twscrape バイナリ解決の共通化（fetch-x-radar.mjs / 将来の fetch-x-cases.mjs が共用）。
 *
 * バグ修正（2026-09-14 実走で `spawnSync /c/Users/tomoy/.local/bin/twscrape ENOENT` を確認）:
 * 旧実装は `which` と `~/.local/bin/twscrape`（拡張子なし）しか見ず、Windowsでは常に
 * "twscrape not found" になっていた。win32 では `where` と `twscrape.exe` を試す。
 * ※ fetch-x-radar.mjs への組み込みは Phase 3（本ファイルは共通モジュール新設のみ）。
 */
import { execFileSync } from "child_process";
import os from "os";
import path from "path";

/** ~/.local/bin 配下の既知パス候補 */
export function twscrapeCandidatePaths(platform = process.platform, home = os.homedir()) {
  const base = path.join(home, ".local", "bin");
  return platform === "win32" ? [path.join(base, "twscrape.exe")] : [path.join(base, "twscrape")];
}

/**
 * twscrape 実行バイナリを解決する。見つからなければ null。
 * @param {object} [opts] テスト用の注入口 { platform, homedir, exec }
 */
export function resolveTwscrapeBin({
  platform = process.platform,
  homedir = os.homedir(),
  exec = (cmd, args) => execFileSync(cmd, args, { encoding: "utf-8" }),
} = {}) {
  const isWin = platform === "win32";
  try {
    const out = exec(isWin ? "where" : "which", ["twscrape"]).trim();
    const hits = out.split(/\r?\n/).filter(Boolean);
    // Windowsのnpm/pipシム(.cmd等)は spawn(shell:false) で失敗するため .exe のみ採用
    const hit = isWin ? hits.find((h) => h.toLowerCase().endsWith(".exe")) : hits[0];
    if (hit) return hit;
  } catch {
    // 既知パス探索へ
  }
  for (const p of twscrapeCandidatePaths(platform, homedir)) {
    try {
      exec(p, ["version"]);
      return p;
    } catch {}
  }
  return null;
}
