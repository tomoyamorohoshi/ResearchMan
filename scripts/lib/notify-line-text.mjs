// notify-line.mjs のエラー通知本文のうち、呼び出し元コンテキスト（日次ジョブ/Studio単発
// ジョブ）で出し分ける部分だけを切り出した純関数。
//
// 背景: job 66218d63のStudioジョブ（LINEでの単発リクエスト）失敗時、notify-line.mjsの
// エラー通知は常に「本日分はスキップし、明日10時に再実行します。」という日次ジョブ
// （scripts/windows/run-job.mjs経由の毎朝の自動実行）専用の文言を送っていた。Studioジョブは
// 「明日」の自動再実行が無い単発リクエストのため、この案内は事実と異なっていた。

/**
 * @param {"daily"|"studio"|undefined} context 呼び出し元コンテキスト（未指定は既定の"daily"）。
 * @param {string} platform process.platform相当（テスト用に注入可能）。
 * @returns {string[]} エラー通知本文に続けて出力する行（見出し行・空行の後に続く部分）。
 */
export function buildErrorBodyLines(context, platform = process.platform) {
  if (context === "studio") {
    return ["LINEから同じ依頼を再送すると再実行できます"];
  }
  return [
    "本日分はスキップし、明日10時に再実行します。",
    `ログ: ${platform === "darwin" ? "~/Library/Logs/researchman-*.log" : "~/.researchman/logs/researchman-*.log"}`,
  ];
}
