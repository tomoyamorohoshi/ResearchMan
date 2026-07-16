/**
 * 自動お気に入り（要件2）: add-caseで反映成功したエントリを、本番サイトのお気に入り
 * サーバ同期API（POST /api/favorites。src/app/api/favorites/route.ts・
 * src/lib/syncRouteHandlers.ts参照。読み取り専用参照）へ自動的に登録する。
 *
 * POST /api/favoritesは無認証（GETと異なりBearerトークン不要）で、Blob未設定時は503を
 * 返しそれ以外の書き込み系エラーも含め非200はすべて失敗として扱う。ジョブ自体は
 * お気に入り登録の成否に関わらず成功のまま完了させる要件のため、実POST関数
 * （postFavorite）は例外を一切投げず、結果を"ok"|"skip"の2値に握りつぶす。
 *
 * ペイロード形式はsrc/lib/favoritesMerge.ts::FavoritesData/FavoriteEntryに合わせる
 * （{ items: { [id]: { fav: true, ts } } }）。
 *
 * ネットワークI/Oのため postFavorite 自体は自動テスト対象外（thumbnail.ts/xMedia.tsと
 * 同じ既存の慣習）。ペイロード組み立て・レスポンス判定は純粋関数として自動テストする。
 */
import https from "node:https";

export interface FavoritePayload {
  items: Record<string, { fav: true; ts: number }>;
}

/** POST /api/favorites 用のペイロードを組み立てる（純粋関数）。 */
export function buildFavoritePayload(id: string, ts: number): FavoritePayload {
  return { items: { [id]: { fav: true, ts } } };
}

export type FavoriteResult = "ok" | "skip";

/**
 * HTTPステータスから結果を判定する（純粋関数）。200のみ"ok"。503（Blob未設定）を含め
 * それ以外は全部"skip"（要件どおり「登録できなくてもジョブは成功のまま完了」の判定に使う）。
 */
export function classifyFavoriteResponse(status: number): FavoriteResult {
  return status === 200 ? "ok" : "skip";
}

/**
 * 指定idを本番サイトのお気に入りに自動登録する（要件2）。例外・非200/503いずれの場合も
 * "skip"として握りつぶし、console.log/console.warnで1行ログするだけで絶対に例外を投げない
 * （呼び出し側addCase.tsのジョブ成功パスを妨げないため）。
 */
export function postFavorite(site: string, id: string): Promise<FavoriteResult> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: FavoriteResult): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    try {
      const payload = JSON.stringify(buildFavoritePayload(id, Date.now()));
      const url = new URL("/api/favorites", site);
      const req = https.request(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            "User-Agent": "researchman-studio",
          },
        },
        (res) => {
          res.resume();
          const status = res.statusCode ?? 0;
          const result = classifyFavoriteResponse(status);
          if (result === "skip") {
            console.warn(`[studio][add-case] 自動お気に入り登録をスキップしました（HTTP ${status}）: ${id}`);
          } else {
            console.log(`[studio][add-case] 自動お気に入り登録に成功しました: ${id}`);
          }
          settle(result);
        },
      );
      req.on("error", (e) => {
        console.warn(`[studio][add-case] 自動お気に入り登録に失敗しました（握りつぶします）: ${id}`, e);
        settle("skip");
      });
      req.setTimeout(15_000, () => {
        console.warn(`[studio][add-case] 自動お気に入り登録がタイムアウトしました（握りつぶします）: ${id}`);
        settle("skip");
        req.destroy();
      });
      req.write(payload);
      req.end();
    } catch (e) {
      console.warn(`[studio][add-case] 自動お気に入り登録の呼び出しに失敗しました（握りつぶします）: ${id}`, e);
      settle("skip");
    }
  });
}
