// 一覧カード用の縮小サムネ（public/thumbnails-sm/<name>.webp）のパス規則。
// 元画像 /thumbnails/<name>.jpg（直下のみ）から規則で引く。cases.json の thumbnail 値は変えない。
// 生成側は scripts/lib/thumb-sm.mjs（smFileName）で同じ規則を使う。

const SM_DIR = "/thumbnails-sm/";

/** 縮小版のパス。縮小版を定義できない（サブディレクトリ・外部URL・jpg以外）ときは null。 */
export function smThumbnailPath(thumbnail: string | undefined | null): string | null {
  if (!thumbnail) return null;
  const m = /^\/thumbnails\/([^/]+)\.jpe?g$/i.exec(thumbnail);
  return m ? `${SM_DIR}${m[1]}.webp` : null;
}

/** 一覧で使う src。縮小版が無い/読み込み失敗(smFailed)のときは元画像。 */
export function pickThumbnailSrc(thumbnail: string, smFailed: boolean): string {
  if (smFailed) return thumbnail;
  return smThumbnailPath(thumbnail) ?? thumbnail;
}
