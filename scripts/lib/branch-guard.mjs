/**
 * scripts/lib/branch-guard.mjs
 *
 * 自動収集ジョブ（scripts/windows/run-job.mjs）が main ブランチ以外の
 * 作業ツリーで実行されるのを防ぐガード。
 *
 * 背景: 2026-07-19、作業ツリーが別ブランチ（mcp-oauth-spike）のまま放置され、
 * 日次収集が main 以外にコミットされる事故が実際に起きた。ジョブ冒頭で検査し
 * 即座に失敗させる（事故時の状態を単純にするため。処理を進めてから中断はしない）。
 *
 * git実行そのものはrun-job.mjs側の resolveGitBin() の結果を使って呼び出し元が行い、
 * ここにはgit実行を含まない純関数だけを置く（node:testで単体テストできるようにするため）。
 */

/** `git rev-parse --abbrev-ref HEAD` の生出力からブランチ名を取り出す（前後の空白・改行を除去）。 */
export function parseCurrentBranch(gitOutput) {
  return (gitOutput || "").trim();
}

/** ブランチ名が main かどうか。 */
export function isMainBranch(branchName) {
  return branchName === "main";
}
