// 巨大データJSON（cases / ideas / idea-layouts）のVercel Blob配信まわりの共通ロジック。
// デプロイ同梱(public/data)だと日次デプロイのたびにDeployment Storageが増える（idea-layouts
// 65MB×毎日）ため、Blobに固定パスで上書きし、クライアントは /api/public-data(Blobプロキシ)→/data/ の順にfetchする。
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

// ストアはprivate専用（Blob URLをブラウザから直接fetchできない）ため、同一オリジンのプロキシAPI
// /api/public-data/<name>（CDNキャッシュ付き）経由で配信する。BLOB_STORE_IDがあるビルドでのみ有効。
// 未設定（ローカル開発等）はローカル /data/ のみを使う
export function isBlobDataEnabled(storeId: string | undefined): boolean {
  return Boolean((storeId ?? "").trim());
}

export function dataUrlCandidates(name: string, useBlob: boolean): string[] {
  const local = `/data/${name}`;
  return useBlob ? [`/api/public-data/${name}`, local] : [local];
}

export async function fetchDataJson<T>(
  name: string,
  useBlob: boolean,
  fetchFn: (url: string) => Promise<Response> = (u) => fetch(u),
): Promise<T> {
  let lastErr: unknown = null;
  for (const url of dataUrlCandidates(name, useBlob)) {
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
