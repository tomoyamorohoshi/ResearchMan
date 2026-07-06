/**
 * 参照解決・タイトル照合用の文字列正規化（日本語は残し、記号・空白のみ除去）。
 * generate-idea-seeds.mjs（id直引き失敗時のタイトルfallback）と
 * backfill-idea-seeds.mjs（seed文中のタイトル出現照合）が共用する
 * （挙動を変えずに1箇所へ集約。scripts/lib/claude-cli.mjs の集約と同じ方針）。
 */
export function normTitle(s) {
  return (s || "").toLowerCase().replace(/[\s　（）()【】\[\]、。・,.:：/|]/g, "");
}
