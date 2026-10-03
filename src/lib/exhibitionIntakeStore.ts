// Exhibition intake キューの Blob I/O。favoritesStore.ts の readBlobData/writeBlobData と
// 同じ流儀（access:"private", addRandomSuffix:false, allowOverwrite:true）。
// サーバ専用（route.ts からのみ import する）。favoritesStore.ts の isBlobConfigured を共用する。
//
// 同時書き込みは last-write-wins で、read-modify-write 間のロスト更新を許容する
// （未処理上限50件・個人利用のため。取りこぼしても投稿者が再投稿でき、PATCH も冪等）。
import { get, put } from "@vercel/blob";
import { emptyIntakeData, isValidIntakeData, type IntakeData } from "@/lib/exhibitionIntake";

const INTAKE_BLOB_PATHNAME = "exhibition-intake/intake.json";

// Blob が壊れている/形が不正なとき。空扱いで上書きすると tombstone 履歴が消えるため例外にする。
export class StoreCorruptError extends Error {
  constructor() {
    super("store_corrupt");
    this.name = "StoreCorruptError";
  }
}

export function parseIntakeBlobText(text: string): IntakeData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StoreCorruptError();
  }
  if (!isValidIntakeData(parsed)) throw new StoreCorruptError();
  return { version: 1, items: parsed.items };
}

// Blob にファイルが無い（初回）ときだけ空として扱う
export async function readIntakeBlob(): Promise<IntakeData> {
  const result = await get(INTAKE_BLOB_PATHNAME, { access: "private" });
  if (!result) return emptyIntakeData();
  return parseIntakeBlobText(await new Response(result.stream).text());
}

export async function writeIntakeBlob(data: IntakeData): Promise<void> {
  await put(INTAKE_BLOB_PATHNAME, JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}
