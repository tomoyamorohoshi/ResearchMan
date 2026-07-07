// お気に入りサーバ同期（バッチ1）の純粋ロジック。
// サーバ(src/app/api/favorites/route.ts)とクライアント(src/hooks/useFavorites.ts)の
// 両方から参照するため、Node専用API(fs等)やDOM専用APIに依存させない。
//
// データモデル: { version: 1, items: { [id]: { fav: boolean, ts: number } } }
// - 解除(fav:false)も ts 付きで残す tombstone 方式。デバイス間でLWW(Last-Write-Wins)マージする
// - id は data/cases.json / data/tech.json の実例（toId()由来のスラグ、
//   最大60字/42字・英小文字数字とハイフンのみ）に合わせる。Ideasタブは★非対応のため対象外

// cases.json/tech.json 実例の最大長(60字)に対し十分な余裕を持たせた上限。
// 将来idが多少伸びても拒否しない一方、無制限の長文字列は弾く
export const MAX_ID_LENGTH = 100;

// 1リクエストで送れる items の件数上限（暴走・誤送信からの防御。個人サイトの
// お気に入り総数としても十分な余裕がある）
export const MAX_ITEMS = 2000;

// cases.json/tech.jsonのid実例（toId()由来）は英小文字・数字・ハイフン区切りのみ
export const FAVORITE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type FavoriteEntry = { fav: boolean; ts: number };
export type FavoritesItems = Record<string, FavoriteEntry>;
export type FavoritesData = { version: 1; items: FavoritesItems };

export function emptyFavoritesData(): FavoritesData {
  return { version: 1, items: {} };
}

export type ValidationResult =
  | { ok: true; items: FavoritesItems }
  | { ok: false; error: string };

// POSTボディの検証。壊れた/悪意あるリクエストが破壊不能マージの前提を崩さないよう、
// 一つでも不正な項目があればリクエスト全体を拒否する（部分適用しない）。
export function validateIncomingItems(body: unknown): ValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const items = (body as Record<string, unknown>).items;
  if (!items || typeof items !== "object" || Array.isArray(items)) {
    return { ok: false, error: "items must be an object" };
  }

  const entries = Object.entries(items as Record<string, unknown>);
  if (entries.length > MAX_ITEMS) {
    return { ok: false, error: `too many items (max ${MAX_ITEMS})` };
  }

  const result: FavoritesItems = {};
  for (const [id, value] of entries) {
    if (
      id.length === 0 ||
      id.length > MAX_ID_LENGTH ||
      !FAVORITE_ID_PATTERN.test(id)
    ) {
      return { ok: false, error: `invalid id: ${id}` };
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: `invalid entry for id: ${id}` };
    }
    const fav = (value as Record<string, unknown>).fav;
    const ts = (value as Record<string, unknown>).ts;
    if (typeof fav !== "boolean") {
      return { ok: false, error: `invalid fav for id: ${id}` };
    }
    if (typeof ts !== "number" || !Number.isFinite(ts) || ts < 0) {
      return { ok: false, error: `invalid ts for id: ${id}` };
    }
    result[id] = { fav, ts };
  }
  return { ok: true, items: result };
}

// per-id LWW(Last-Write-Wins)マージ。tsが新しい方を採用する。
// ts同値の場合はincoming側を優先（衝突は極めて稀だが、優先順位を固定することで
// マージ結果を決定的にする）。current/incomingいずれも破壊しない純粋関数。
export function mergeFavoritesItems(
  current: FavoritesItems,
  incoming: FavoritesItems
): FavoritesItems {
  const merged: FavoritesItems = { ...current };
  for (const [id, incomingEntry] of Object.entries(incoming)) {
    const currentEntry = merged[id];
    if (!currentEntry || incomingEntry.ts >= currentEntry.ts) {
      merged[id] = incomingEntry;
    }
  }
  return merged;
}
