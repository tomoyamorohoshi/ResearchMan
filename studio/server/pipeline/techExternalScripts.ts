/**
 * ルート scripts/*.mjs（デイリーTechパイプラインと共有のサムネイル取得/URL死活ロジック）の
 * re-export。externalScripts.ts（Case Study用）と同じ位置づけ。scripts/ 側は無改変
 * （CLAUDE.md安全制約）。
 */
export { isUrlAlive } from "../../../scripts/verify-video.mjs";
export { fetchKeyVisual } from "../../../scripts/tech-thumbs.mjs";
export { normalizeAndEnforceMinBytes } from "../../../scripts/lib/thumbnail-constraints.mjs";
