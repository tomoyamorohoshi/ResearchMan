/**
 * 「切り口の源=お気に入り中心」用のお気に入り取得。scripts/biweekly-tuneup.mjs と同じ
 * ~/.researchman-favsync.json（{endpoint, token}）を読み、同じ GET /api/favorites を叩く
 * （biweekly-tuneup.mjs自体は無改変。httpGetJsonはexportされていないためTSに移植する）。
 *
 * 設定ファイルが無い/不完全、または取得に失敗した場合は例外を投げる。呼び出し側
 * （ideaResearch.ts）はこれを「お気に入り未接続」として捕捉し、全事例フォールバック+
 * job.warningを付ける（DESIGN.md §6・タスク指示: 偽装せず未接続を明示する）。
 *
 * ネットワークを伴うため fetchFavoriteCaseIds 自体は自動テスト対象外
 * （[[node-http-destroy-bug]]のsettleパターンを踏襲。設定ファイル欠落時の分岐のみテストする）。
 *
 * 同じ設定ファイル・同じ流儀で、アイデア評価（いいね/ゴミ箱）による切り口の重み付け用に
 * fetchIdeaLikeIds/fetchIdeaTrashIdsも提供する（GET /api/idea-likes・/api/idea-trash。
 * 下部参照）。こちらも未設定/取得失敗時は例外を投げ、呼び出し側が黙ってスキップする。
 */
import { readFile } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { favoriteIds } from "../../../scripts/lib/tuneup-stats.mjs";

export interface FavSyncConfig {
  endpoint: string;
  token: string;
}

const FAVSYNC_CONFIG_PATH = path.join(os.homedir(), ".researchman-favsync.json");

/** 設定ファイルを読む。無い/不完全なら null（呼び出し側はフォールバックする）。 */
export async function loadFavSyncConfig(configPath: string = FAVSYNC_CONFIG_PATH): Promise<FavSyncConfig | null> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch {
    return null;
  }
  try {
    const cfg = JSON.parse(raw) as Partial<FavSyncConfig>;
    if (!cfg.endpoint || !cfg.token) return null;
    return { endpoint: cfg.endpoint, token: cfg.token };
  } catch {
    return null;
  }
}

interface FavoritesResponse {
  items?: Record<string, { fav?: boolean; ts?: number }>;
}

function httpGetJson(url: string, token: string): Promise<{ ok: true; body: FavoritesResponse } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: { ok: true; body: FavoritesResponse } | { ok: false; error: string }): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    try {
      const req = https.get(url, { headers: { Authorization: `Bearer ${token}`, "User-Agent": "researchman-studio" } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          settle({ ok: false, error: `HTTP ${res.statusCode}` });
          return;
        }
        const chunks: Buffer[] = [];
        const finish = (): void => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as FavoritesResponse;
            settle({ ok: true, body });
          } catch (e) {
            settle({ ok: false, error: `JSON解析エラー: ${e instanceof Error ? e.message : String(e)}` });
          }
        };
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", finish);
      });
      req.on("error", (e) => settle({ ok: false, error: e.message }));
      req.setTimeout(15_000, () => {
        settle({ ok: false, error: "timeout" });
        req.destroy();
      });
    } catch (e) {
      settle({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

/** お気に入りid一覧を取得する。設定なし/失敗時は例外を投げる。 */
export async function fetchFavoriteIds(config: FavSyncConfig): Promise<Set<string>> {
  const res = await httpGetJson(config.endpoint, config.token);
  if (!res.ok) throw new Error(`お気に入り取得に失敗しました: ${res.error}`);
  return new Set(favoriteIds(res.body.items));
}

// ── アイデア評価（いいね/ゴミ箱）取得: 切り口の重み付け用シグナル ─────────────
//
// GET /api/idea-likes・/api/idea-trash は既存 GET /api/favorites と同じ流儀
// （Bearer FAVORITES_SYNC_TOKEN、レスポンス {version:1, items:{[id]:{fav,ts}}}、
// fav:true=いいね中/ゴミ箱在中）。エンドポイントは favsyncConfig.endpoint（/api/favorites の
// URL）から機械的に導出する（scripts/lib/tuneup-stats.mjs の deriveTrashEndpoint と同じ考え方。
// scripts/ は本タスクで改変禁止のため、ロジックをここに複製する）。

export type IdeaSignalKind = "idea-likes" | "idea-trash";

/**
 * favoritesのendpointから /api/idea-likes・/api/idea-trash のendpointを機械的に導出する
 * （末尾が /api/favorites[/] の形にマッチする場合のみ /api/{kind}[/] へ置換）。
 * 非標準URL（末尾が/api/favoritesでない）で置換が不発だった場合、そのURLをそのまま返すと
 * favoritesのレスポンスを別種のシグナルとして誤集計する危険があるため、導出不可を示す
 * nullを返す（呼び出し側はこれを「取得不能」として黙ってスキップする）。
 */
export function deriveIdeaSignalEndpoint(favoritesEndpoint: string, kind: IdeaSignalKind): string | null {
  const derived = favoritesEndpoint.replace(/\/api\/favorites(\/)?$/, `/api/${kind}$1`);
  return derived === favoritesEndpoint ? null : derived;
}

/**
 * いいね/ゴミ箱のid集合を取得する。endpoint導出不能・HTTP取得失敗のいずれも例外を投げる
 * （呼び出し側 ideaResearch.ts がこれを捕捉し、要件どおり「空として黙ってスキップ」する）。
 */
async function fetchIdeaSignalIds(config: FavSyncConfig, kind: IdeaSignalKind): Promise<Set<string>> {
  const endpoint = deriveIdeaSignalEndpoint(config.endpoint, kind);
  if (!endpoint) throw new Error(`${kind}のendpointを導出できませんでした（favoritesのendpointが非標準URLです）`);
  const res = await httpGetJson(endpoint, config.token);
  if (!res.ok) throw new Error(`${kind}取得に失敗しました: ${res.error}`);
  return new Set(favoriteIds(res.body.items));
}

/** いいね中のアイデアid一覧を取得する。導出不能・取得失敗時は例外を投げる。 */
export async function fetchIdeaLikeIds(config: FavSyncConfig): Promise<Set<string>> {
  return fetchIdeaSignalIds(config, "idea-likes");
}

/** ゴミ箱入りのアイデアid一覧を取得する。導出不能・取得失敗時は例外を投げる。 */
export async function fetchIdeaTrashIds(config: FavSyncConfig): Promise<Set<string>> {
  return fetchIdeaSignalIds(config, "idea-trash");
}
