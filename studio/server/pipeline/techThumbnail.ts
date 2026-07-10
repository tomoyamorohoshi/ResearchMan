/**
 * Technology サムネイル取得（DESIGN.md §6 Research(Technology)）。
 * scripts/build-tech-from-research.mjs::saveThumb と同じ「キービジュアル優先」ロジックを
 * techExternalScripts.ts 経由で再利用する（scripts/側は無改変）。thumbnail.ts（Case Study用）
 * と同じ位置づけ。
 *
 * ネットワークI/Oのため自動テスト対象外（thumbnail.ts と同じ理由）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchKeyVisual, normalizeThumbnailBuffer } from "./techExternalScripts.js";
import type { TechLink } from "./techPure.js";

export interface TechThumbnailResult {
  thumbnail: string;
}

/** @param thumbDir public/thumbnails/tech の絶対パス */
export async function acquireTechThumbnail(
  thumbDir: string,
  id: string,
  links: TechLink[],
  thumbnailSource: string,
): Promise<TechThumbnailResult | null> {
  // tech-thumbs.mjs::fetchKeyVisual のJSDoc `@returns {Buffer|null}` は実装と食い違っている
  // （実際は {src, buf} | null を返す。build-tech-from-research.mjs も found.buf でアクセスしており
  // 実装側が正）。scripts/側は無改変のため、消費側であるここで実体の型に合わせてキャストする。
  const found = (await fetchKeyVisual(links, thumbnailSource)) as unknown as { src: string; buf: Buffer } | null;
  if (!found) return null;
  await mkdir(thumbDir, { recursive: true });
  const localPath = path.join(thumbDir, `${id}.jpg`);
  await writeFile(localPath, await normalizeThumbnailBuffer(found.buf));
  return { thumbnail: `/thumbnails/tech/${id}.jpg` };
}
