// Exhibition intake キューの Blob I/O。サーバ専用（route.ts からのみ import する）。
//
// 設計: 共有ファイルの read-modify-write は行わない。Vercel Blob の get()/ifMatch は書き込み直後に
// 古い内容を返し続けるため、楽観ロックでもロスト更新が起きた（本番実測）。代わりに
//   - 受付 1件 = 1オブジェクト（exhibition-intake/items/{intakeKey}.json）。POST は allowOverwrite:false の新規作成のみ
//   - 処理結果は同じオブジェクトの上書き（書き手は日次ジョブの PATCH だけなので競合しない）
// とし、並列 POST は別オブジェクトなので互いを消さない。同一 URL の並列は「作成が1つだけ成功」で決着する。
// 旧 exhibition-intake/intake.json は読み取り専用で GET/PATCH にだけ合流させる（書き換えない）。
import { get, head, list, put, del, BlobNotFoundError } from "@vercel/blob";
import {
  intakeKey,
  applyResults,
  isValidIntakeData,
  validateIntakeUrl,
  MAX_PENDING,
  MAX_DAILY,
  TOMBSTONE_DAYS,
  type AddResult,
  type IntakeData,
  type IntakeItem,
  type IntakeResult,
} from "@/lib/exhibitionIntake";
import { todayJst } from "../../scripts/lib/exhibition-status.mjs";

const ITEMS_PREFIX = "exhibition-intake/items/";
const LEGACY_PATHNAME = "exhibition-intake/intake.json";
const DAY_MS = 86400000;
// 「未処理が溜まっている」概算に使う窓。list の uploadedAt だけで数える（処理済みを含みうる安全側の概算）
const PENDING_WINDOW_DAYS = 3;
const READ_CONCURRENCY = 8;

// Blob が壊れている/形が不正なとき（旧ファイルの検査に使う）。
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

// Blob I/O の差し替え口（テストではメモリ上のフェイクを注入する）
export interface IntakeBlobApi {
  list(prefix: string): Promise<{ pathname: string; uploadedAt: Date }[]>;
  // 不在（または stale で見えない）なら null
  get(pathname: string): Promise<string | null>;
  // 既に存在すれば "exists"（上書きしない）
  create(pathname: string, text: string): Promise<"created" | "exists">;
  overwrite(pathname: string, text: string): Promise<void>;
  del(pathnames: string[]): Promise<void>;
}

const putOpts = { access: "private", addRandomSuffix: false, contentType: "application/json" } as const;

const realApi: IntakeBlobApi = {
  async list(prefix) {
    const out: { pathname: string; uploadedAt: Date }[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      for (const b of page.blobs) out.push({ pathname: b.pathname, uploadedAt: new Date(b.uploadedAt) });
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
  async get(pathname) {
    try {
      const r = await get(pathname, { access: "private" });
      if (!r || r.statusCode !== 200) return null;
      return await new Response(r.stream).text();
    } catch (err) {
      if (err instanceof BlobNotFoundError) return null;
      throw err;
    }
  },
  async create(pathname, text) {
    // 既存なら head で先に判定（「既に存在」は SDK に専用エラーが無く unknown_error として内部で多段リトライされうる）。
    if (await exists(pathname)) return "exists";
    try {
      await put(pathname, text, { ...putOpts, allowOverwrite: false });
      return "created";
    } catch (err) {
      // 型に依らず、失敗後に実在するなら「他者が先に作成した」。実在しなければ本当の失敗として投げる
      if (await exists(pathname).catch(() => false)) return "exists";
      throw err;
    }
  },
  async overwrite(pathname, text) {
    await put(pathname, text, { ...putOpts, allowOverwrite: true });
  },
  async del(pathnames) {
    if (pathnames.length) await del(pathnames);
  },
};

async function exists(pathname: string): Promise<boolean> {
  try {
    await head(pathname);
    return true;
  } catch (err) {
    if (err instanceof BlobNotFoundError) return false;
    throw err;
  }
}

const itemPath = (url: string) => `${ITEMS_PREFIX}${intakeKey(url)}.json`;

function parseItem(text: string | null): IntakeItem | null {
  if (text === null) return null;
  try {
    const o = JSON.parse(text) as Partial<IntakeItem>;
    if (o && typeof o.url === "string" && typeof o.ts === "number" && typeof o.status === "string") return o as IntakeItem;
  } catch {
    /* 壊れた item は無いものとして扱う */
  }
  return null;
}

async function mapLimited<T, R>(xs: T[], fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += READ_CONCURRENCY) {
    out.push(...(await Promise.all(xs.slice(i, i + READ_CONCURRENCY).map(fn))));
  }
  return out;
}

// 旧ファイル（読み取り専用）。読めない/壊れているときは空扱い（旧 pending は翌日以降の再投稿で拾える）
async function readLegacy(api: IntakeBlobApi): Promise<IntakeData> {
  const text = await api.get(LEGACY_PATHNAME);
  if (text === null) return { version: 1, items: {} };
  try {
    return parseIntakeBlobText(text);
  } catch {
    console.warn("[exhibitionIntakeStore] legacy intake.json is unreadable; ignored");
    return { version: 1, items: {} };
  }
}

// POST: 1件を受け付ける。上限は list の件数/uploadedAt からの概算で、list の反映遅れ（直前の投稿が
// 数えられない）は許容する。重複判定を上限より先に行う（従来の判定順を維持）。
export async function enqueueUrl(url: string, now: number, api: IntakeBlobApi = realApi): Promise<AddResult> {
  const path = itemPath(url);
  const classify = (it: IntakeItem | null): AddResult => (!it || it.status === "pending" ? "duplicate" : "already_processed");

  const found = await api.get(path);
  if (found !== null) return classify(parseItem(found));

  const entries = await api.list(ITEMS_PREFIX);
  const today = todayJst(new Date(now));
  if (entries.filter((e) => todayJst(e.uploadedAt) === today).length >= MAX_DAILY) return "limit_daily";
  const since = now - PENDING_WINDOW_DAYS * DAY_MS;
  if (entries.filter((e) => e.uploadedAt.getTime() >= since).length >= MAX_PENDING) return "limit_pending";

  const item: IntakeItem = { url, ts: now, status: "pending", attempts: 0 };
  const r = await api.create(path, JSON.stringify(item));
  if (r === "created") return "accepted";
  // 他リクエストが先に作成した。読めなければ（stale）duplicate 扱い＝冪等で、データは失われない
  return classify(parseItem(await api.get(path)));
}

// GET: pending 項目を ts 昇順で返す。読み取りが stale で見えない項目は翌日のジョブで拾える。
export async function listPendingItems(
  _now: number,
  api: IntakeBlobApi = realApi,
): Promise<{ url: string; ts: number; attempts: number }[]> {
  const entries = await api.list(ITEMS_PREFIX);
  const items = (await mapLimited(entries, async (e) => parseItem(await api.get(e.pathname)))).filter(
    (i): i is IntakeItem => i !== null,
  );
  const byKey = new Map<string, IntakeItem>();
  for (const i of items) byKey.set(intakeKey(i.url), i);
  // 旧ファイルの pending は、新形式に同じ URL が無いものだけ合流（新形式に処理済みがあれば除外）
  for (const [k, i] of Object.entries((await readLegacy(api)).items)) {
    if (i.status === "pending" && !byKey.has(k)) byKey.set(k, i);
  }
  return [...byKey.values()]
    .filter((i) => i.status === "pending")
    .sort((a, b) => a.ts - b.ts)
    .map((i) => ({ url: i.url, ts: i.ts, attempts: i.attempts }));
}

// PATCH: 結果を item に上書き。新形式に無い URL は旧ファイルの pending を元に新形式 item を作る（旧ファイルは触らない）。
// 最後に30日超の処理済み tombstone を del で掃除する。
export async function applyIntakeResults(
  results: IntakeResult[],
  now: number,
  api: IntakeBlobApi = realApi,
): Promise<number> {
  let legacy: IntakeData | null = null;
  let updated = 0;
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const v = validateIntakeUrl(r.url);
    if (!v.ok) continue;
    const key = intakeKey(v.url);
    const path = `${ITEMS_PREFIX}${key}.json`;
    let cur = parseItem(await api.get(path));
    if (!cur) {
      legacy ??= await readLegacy(api);
      const old = legacy.items[key];
      if (!old || old.status !== "pending") continue;
      cur = old;
    }
    const out = applyResults({ version: 1, items: { [key]: cur } }, [r], now);
    if (!out.updated) continue;
    await api.overwrite(path, JSON.stringify(out.data.items[key]));
    updated++;
  }
  await sweepOldItems(now, api);
  return updated;
}

async function sweepOldItems(now: number, api: IntakeBlobApi): Promise<void> {
  const limit = now - TOMBSTONE_DAYS * DAY_MS;
  const old = (await api.list(ITEMS_PREFIX)).filter((e) => e.uploadedAt.getTime() < limit);
  const doomed: string[] = [];
  await mapLimited(old, async (e) => {
    const it = parseItem(await api.get(e.pathname));
    if (it && it.status !== "pending" && now - (it.processedAt ?? it.ts) > TOMBSTONE_DAYS * DAY_MS) doomed.push(e.pathname);
  });
  await api.del(doomed);
}
