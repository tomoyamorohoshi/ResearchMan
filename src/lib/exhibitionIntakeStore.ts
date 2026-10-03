// Exhibition intake キューの Blob I/O。favoritesStore.ts の readBlobData/writeBlobData と
// 同じ流儀（access:"private", addRandomSuffix:false, allowOverwrite:true）。
// サーバ専用（route.ts からのみ import する）。favoritesStore.ts の isBlobConfigured を共用する。
//
// 同時書き込みは last-write-wins で、read-modify-write 間のロスト更新を許容する
// （未処理上限50件・個人利用のため。取りこぼしても投稿者が再投稿でき、PATCH も冪等）。
import { get, put } from "@vercel/blob";
import { emptyIntakeData, isValidIntakeData, type IntakeData } from "@/lib/exhibitionIntake";

const INTAKE_BLOB_PATHNAME = "exhibition-intake/intake.json";

export async function readIntakeBlob(): Promise<IntakeData> {
  const result = await get(INTAKE_BLOB_PATHNAME, { access: "private" });
  if (!result) return emptyIntakeData();
  const text = await new Response(result.stream).text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 壊れた JSON は空として扱う（書き込みは常に JSON.stringify したものだけ）
    return emptyIntakeData();
  }
  if (!isValidIntakeData(parsed)) return emptyIntakeData();
  return { version: 1, items: parsed.items };
}

export async function writeIntakeBlob(data: IntakeData): Promise<void> {
  await put(INTAKE_BLOB_PATHNAME, JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}
