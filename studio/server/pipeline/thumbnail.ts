/**
 * サムネイル取得（DESIGN.md §6: サムネ取得 → normalize-thumbnail）。
 * デイリーパイプライン（auto-research-cc.mjs::acquireVerifiedThumbnail）のStep1
 * （YouTube ID → oEmbed照合）・Step2（記事og:image）を再利用する。Step3
 * （Claude CLIでのYouTube再検索）はStudioでは省略（既にcase-collectorがWebSearch経由で
 * youtubeIdを見つけている前提のため、追加のCLI呼び出しコストを避ける）。
 * ダミー画像へのフォールバックはしない（誤サムネの根絶。取得できなければ候補ごと却下）。
 *
 * ネットワークI/Oのため自動テスト対象外（save-thumbnail.mjs/verify-video.mjs自体も無テスト）。
 */
import {
  fetchYouTubeInfo,
  saveThumbnail,
  saveThumbnailFromPage,
  videoMatchesCase,
  resetThumbnailDuplicateGuardForTest,
} from "./externalScripts.js";

/**
 * サムネイル重複ガード（scripts/lib/thumbnail-constraints.mjs）をジョブ開始時点の
 * data/cases.json を正として作り直す（2026-08-07 サムネイル重複ロールバック障害の再発防止）。
 * Studioサーバーは1プロセス内で複数ジョブを順次処理する長時間稼働プロセスのため、
 * ガードをジョブをまたいで使い回すと前ジョブの状態が残ってしまう。各ジョブのサムネイル
 * 取得ループの開始前に必ず1回呼ぶこと。
 */
export function resetThumbnailDuplicateGuardForJob(): void {
  resetThumbnailDuplicateGuardForTest();
}

export interface ThumbnailCandidate {
  title: string;
  client?: string;
  link: string;
  youtubeId?: string;
}

export interface ThumbnailResult {
  thumbnail: string;
  videoId: string;
}

export async function acquireThumbnail(
  id: string,
  candidate: ThumbnailCandidate,
): Promise<ThumbnailResult | null> {
  if (candidate.youtubeId) {
    const info = await fetchYouTubeInfo(candidate.youtubeId);
    if (info && videoMatchesCase(info, candidate.title, candidate.client || "")) {
      const local =
        (await saveThumbnail(id, `https://i.ytimg.com/vi/${candidate.youtubeId}/maxresdefault.jpg`)) ||
        (await saveThumbnail(id, `https://i.ytimg.com/vi/${candidate.youtubeId}/hqdefault.jpg`));
      if (local) return { thumbnail: local, videoId: candidate.youtubeId };
    }
  }
  if (candidate.link) {
    const local = await saveThumbnailFromPage(id, candidate.link);
    if (local) return { thumbnail: local, videoId: "" };
  }
  return null;
}
