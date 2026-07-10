/**
 * ルート scripts/*.mjs（デイリーパイプラインと共有のサムネイル取得/動画検証ロジック）の
 * re-export。scripts/ 側は無改変（CLAUDE.md安全制約）。tsconfig の allowJs により
 * 型は素の関数シグネチャから緩く推論される（.mjs 側にJSDoc型注釈は無いため引数/戻り値は
 * 実質 any 寄りになるが、呼び出し側 thumbnail.ts で戻り値を明示的に検査して使う）。
 */
export {
  saveThumbnail,
  saveThumbnailFromPage,
} from "../../../scripts/save-thumbnail.mjs";
export {
  fetchYouTubeInfo,
  videoMatchesCase,
} from "../../../scripts/verify-video.mjs";
