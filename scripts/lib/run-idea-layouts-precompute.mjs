// data/ideas.json 書込後に必ず呼ぶ共用ヘルパー（generate-idea-seeds.mjs / backfill-idea-seeds.mjs
// 共用。DESIGN: goofy-hatching-mango.md 2026-07-08改訂・事前計算方式）。
//
// npx tsx で scripts/precompute-idea-layouts.mjs を実行し、data/ideas.json の最新内容から
// 3ティア分のシェイプ・レイアウトを再計算してdata/idea-layouts.jsonへ書き出す。
// 失敗してもthrowせずfalseを返す（ideas.jsonへの追記・LINE配信という本務は既に完了しているため、
// precomputeの失敗だけで日次パイプライン全体を落とさない）。ただし失敗を放置すると次回のpushが
// pre-pushフック(scripts/check-idea-layouts-freshness.mjs)の鮮度検査で必ずブロックされるため、
// 呼び出し側は戻り値をログに残すこと。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRECOMPUTE_SCRIPT_PATH = path.join(__dirname, "../precompute-idea-layouts.mjs");
const TSX_CLI_PATH = path.join(__dirname, "../../node_modules/tsx/dist/cli.mjs");

export function runIdeaLayoutsPrecompute() {
  console.log("🧮 idea-layouts.json を再計算中 (tsx経由でprecompute-idea-layouts.mjsを実行)...");

  // Windowsタスクスケジューラ環境はPATHが最小構成(system32等のみ)で、npx.cmdの場所が
  // 通っておらず spawnSync("npx", ...) が ENOENT で必ず失敗する。process.execPath（現在の
  // node実行ファイルの絶対パス）+ リポジトリローカルのtsx CLIを直接spawnすればPATH解決に
  // 依存しないため、この経路を優先する。tsxが未インストールの場合のみ従来のnpxにフォールバックする。
  const useLocalTsx = fs.existsSync(TSX_CLI_PATH);
  const isWindows = process.platform === "win32";
  const [command, args, spawnOpts] = useLocalTsx
    ? [process.execPath, [TSX_CLI_PATH, PRECOMPUTE_SCRIPT_PATH], {}]
    : [isWindows ? "npx.cmd" : "npx", ["tsx", PRECOMPUTE_SCRIPT_PATH], { shell: isWindows }];

  const result = spawnSync(command, args, {
    encoding: "utf-8",
    stdio: "inherit",
    env: process.env, // IDEAS_JSON_PATH/IDEA_LAYOUTS_JSON_PATHのテスト用サンドボックス環境変数を継承
    ...spawnOpts,
  });
  if (result.error || result.status !== 0) {
    console.error(
      `⚠ idea-layouts.json の再計算に失敗しました(status=${result.status ?? "-"}, error=${result.error?.message ?? "-"})。` +
        "次回のpushはpre-pushフックの鮮度検査でブロックされます。手動で" +
        " `npx tsx scripts/precompute-idea-layouts.mjs` を実行してください。",
    );
    return false;
  }
  return true;
}
