// Exhibition intake キューの Blob I/O。favoritesStore.ts の readBlobData/writeBlobData と
// 同じ流儀（access:"private", addRandomSuffix:false, allowOverwrite:true）。
// サーバ専用（route.ts からのみ import する）。favoritesStore.ts の isBlobConfigured を共用する。
//
// 同時書き込みは楽観ロック（etag + ifMatch）で守る。Vercel Blob の get() は書き込み直後に
// 古い内容を返す（キャッシュ回避不可）ため、read-modify-write は etag 付きで書き、
// precondition 失敗（他者が先に更新）なら再読込してやり直す。上限超は StoreConflictError（route は 503 busy）。
import { get, put, BlobError, BlobPreconditionFailedError, BlobUnknownError } from "@vercel/blob";
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
  const r = await realClient.read();
  return r ? parseIntakeBlobText(r.text) : emptyIntakeData();
}

// 同時更新が続いてリトライ上限を超えたとき。データは書かれていない（呼び出し側は 503 busy を返す）
export class StoreConflictError extends Error {
  constructor() {
    super("store_conflict");
    this.name = "StoreConflictError";
  }
}

// Blob I/O の差し替え口（テストで古い etag/内容・競合を再現する）
export interface IntakeBlobClient {
  // blob が無ければ null
  read(): Promise<{ etag: string; text: string } | null>;
  // ifMatch=null は「新規作成」（既存があれば失敗）、文字列は「その etag と一致するときだけ上書き」
  write(text: string, ifMatch: string | null): Promise<void>;
}

const realClient: IntakeBlobClient = {
  async read() {
    const result = await get(INTAKE_BLOB_PATHNAME, { access: "private" });
    if (!result || result.statusCode !== 200) return null;
    return { etag: result.blob.etag, text: await new Response(result.stream).text() };
  },
  async write(text, ifMatch) {
    await put(INTAKE_BLOB_PATHNAME, text, {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
      // 既存更新: ifMatch（SDK が allowOverwrite を自動で有効化）。新規作成: 既存があれば失敗させる
      ...(ifMatch !== null ? { ifMatch } : { allowOverwrite: false }),
    });
  },
};

// 競合（他者が先に更新・作成した）か。作成時の「既に存在」は SDK 型定義に専用エラーが無く
// BlobUnknownError 等で返りうるため、作成モードに限りそれらも競合扱い（再読込で解消／非解消なら上限超で 503）。
function isConflictError(err: unknown, creating: boolean): boolean {
  if (err instanceof BlobPreconditionFailedError) return true;
  if (!creating) return false;
  return err instanceof BlobUnknownError || (err instanceof BlobError && /already exists/i.test(err.message));
}

export const RETRY_DELAYS_MS = [300, 800, 1500, 2500];
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// read → fn → write を etag 付きで行う。fn は再実行されうるので副作用を持たせない。
// fn が data:null を返したら書き込まない（result だけ返す）。
export async function updateIntake<T>(
  fn: (current: IntakeData) => { data: IntakeData | null; result: T },
  opts: { client?: IntakeBlobClient; sleep?: (ms: number) => Promise<void>; delays?: number[] } = {},
): Promise<T> {
  const client = opts.client ?? realClient;
  const sleep = opts.sleep ?? defaultSleep;
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    const snap = await client.read();
    const { data, result } = fn(snap ? parseIntakeBlobText(snap.text) : emptyIntakeData());
    if (data === null) return result;
    try {
      await client.write(JSON.stringify(data), snap ? snap.etag : null);
      return result;
    } catch (err) {
      if (!isConflictError(err, snap === null)) throw err;
      if (attempt >= delays.length) throw new StoreConflictError();
      await sleep(delays[attempt]);
    }
  }
}
