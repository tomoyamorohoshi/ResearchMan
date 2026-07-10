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
