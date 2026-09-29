// 巨大データJSON（cases / ideas / idea-layouts）のVercel Blob配信まわりの共通ロジック。
// デプロイ同梱(public/data)だと日次デプロイのたびにDeployment Storageが増える（idea-layouts
// 65MB×毎日）ため、Blobに固定パスで上書きし、クライアントはBlob→/data/の順にfetchする。
// このファイルは純関数のみ（サーバ/クライアント/Nodeスクリプトから共用。Blob SDKはimportしない）。

export const PUBLIC_DATA_FILES = ["cases.json", "ideas.json", "idea-layouts.json"] as const;
export type PublicDataFile = (typeof PUBLIC_DATA_FILES)[number];

const BLOB_PREFIX = "public-data/";

export function blobPathnameFor(name: string): string {
  return `${BLOB_PREFIX}${name}`;
}

// 署名付きアップロードを発行してよいpathnameを許可リストで限定する（トークン漏洩時の被害を
// 3ファイルの上書きに閉じ込める。favorites等の他Blobは触らせない）
export function isAllowedBlobPathname(pathname: string): boolean {
  return (PUBLIC_DATA_FILES as readonly string[]).some((f) => blobPathnameFor(f) === pathname);
}

export function isAuthorizedBearer(header: string | null | undefined, token: string | undefined): boolean {
  if (!token) return false;
  return (header ?? "") === `Bearer ${token}`;
}

// publicなBlobのURLは https://<storeIdの本体小文字>.public.blob.vercel-storage.com/<pathname>
// 未設定（ローカル開発等）は空文字＝ローカル /data/ のみを使う
export function blobBaseUrlFromStoreId(storeId: string | undefined): string {
  const id = (storeId ?? "").trim().replace(/^store_/i, "").toLowerCase();
  return id ? `https://${id}.public.blob.vercel-storage.com` : "";
}

export function dataUrlCandidates(name: string, blobBase: string): string[] {
  const local = `/data/${name}`;
  return blobBase ? [`${blobBase}/${blobPathnameFor(name)}`, local] : [local];
}

export async function fetchDataJson<T>(
  name: string,
  blobBase: string,
  fetchFn: (url: string) => Promise<Response> = (u) => fetch(u),
): Promise<T> {
  let lastErr: unknown = null;
  for (const url of dataUrlCandidates(name, blobBase)) {
    try {
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Failed to load ${name}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}
