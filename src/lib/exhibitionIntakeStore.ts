// Exhibition intake キューの Blob I/O。サーバ専用（route.ts からのみ import する）。
//
// 設計: 共有ファイルの read-modify-write は行わない。Vercel Blob の get()/ifMatch は書き込み直後に
// 古い内容を返し続けるため、楽観ロックでもロスト更新が起きた（本番実測）。代わりに
//   - 未処理: exhibition-intake/pending/{intakeKey}.json（POST が allowOverwrite:false で新規作成）
//   - 処理済み: exhibition-intake/done/{intakeKey}.json（PATCH が作成/上書きし、その後 pending を del）
// とする。キーは日付を含まない intakeKey 固定なので、重複判定は pending/done の head だけで済む。
// 並列 POST は別オブジェクトなので互いを消さず、同一 URL の並列は「作成が1つだけ成功」で決着する。
// 旧 exhibition-intake/intake.json は読まない（旧キューの残りは再投稿で入れ直す）。
import { head, list, put, del, get, BlobNotFoundError } from "@vercel/blob";
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

const PENDING_PREFIX = "exhibition-intake/pending/";
const DONE_PREFIX = "exhibition-intake/done/";
const DAY_MS = 86400000;
const READ_CONCURRENCY = 8;
const BLOB_TIMEOUT_MS = 8000;

// Blob が壊れている/形が不正なとき（parse 検査用に export を維持）。
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
  exists(pathname: string): Promise<boolean>;
  // 既に存在すれば "exists"（上書きしない）。書き込み失敗は throw
  create(pathname: string, text: string): Promise<"created" | "exists">;
  overwrite(pathname: string, text: string): Promise<void>;
  del(pathnames: string[]): Promise<void>;
}

const signal = () => AbortSignal.timeout(BLOB_TIMEOUT_MS);
const putOpts = () => ({ access: "private", addRandomSuffix: false, contentType: "application/json", abortSignal: signal() }) as const;

const realApi: IntakeBlobApi = {
  async list(prefix) {
    const out: { pathname: string; uploadedAt: Date }[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000, abortSignal: signal() });
      for (const b of page.blobs) out.push({ pathname: b.pathname, uploadedAt: new Date(b.uploadedAt) });
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
  async get(pathname) {
    try {
      const r = await get(pathname, { access: "private", abortSignal: signal() });
      if (!r || r.statusCode !== 200) return null;
      return await new Response(r.stream).text();
    } catch (err) {
      if (err instanceof BlobNotFoundError) return null;
      throw err;
    }
  },
  async exists(pathname) {
    try {
      await head(pathname, { abortSignal: signal() });
      return true;
    } catch (err) {
      if (err instanceof BlobNotFoundError) return false;
      throw err;
    }
  },
  async create(pathname, text) {
    // 「既に存在」は SDK に専用エラーが無く unknown_error として内部で多段リトライされうるため、head で先に判定する
    if (await realApi.exists(pathname)) return "exists";
    await put(pathname, text, { ...putOpts(), allowOverwrite: false });
    return "created";
  },
  async overwrite(pathname, text) {
    await put(pathname, text, { ...putOpts(), allowOverwrite: true });
  },
  async del(pathnames) {
    if (pathnames.length) await del(pathnames, { abortSignal: signal() });
  },
};

const keyOf = (url: string) => intakeKey(url);
const pendingPath = (key: string) => `${PENDING_PREFIX}${key}.json`;
const donePath = (key: string) => `${DONE_PREFIX}${key}.json`;

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

// 本文の ts が JST 当日の受付数。uploadedAt >= 当日0時(JST) の項目だけ get する（受付 ts <= uploadedAt なので
// 当日受付は必ずこの集合に入る。処理が今日で受付が昨日の done は本文 ts で除外）。get できない項目は安全側で数える。
async function countReceivedToday(
  entries: { pathname: string; uploadedAt: Date }[],
  now: number,
  api: IntakeBlobApi,
): Promise<number> {
  const day = todayJst(new Date(now));
  const dayStart = Date.parse(`${day}T00:00:00+09:00`);
  const candidates = entries.filter((e) => e.uploadedAt.getTime() >= dayStart);
  const counted = await mapLimited(candidates, async (e) => {
    const it = parseItem(await api.get(e.pathname));
    return !it || todayJst(new Date(it.ts)) === day;
  });
  return counted.filter(Boolean).length;
}

// POST: 1件を受け付ける。上限は list からの概算で、list の反映遅れ（直前の投稿が数えられない）は許容する。
// 重複判定を上限より先に行う。put が失敗しても accepted は返さない（実在すれば duplicate、無ければ throw）。
export async function enqueueUrl(url: string, now: number, api: IntakeBlobApi = realApi): Promise<AddResult> {
  const key = keyOf(url);
  const path = pendingPath(key);
  if (await api.exists(path)) return "duplicate";
  if (await api.exists(donePath(key))) return "already_processed";

  const [pending, done] = await Promise.all([api.list(PENDING_PREFIX), api.list(DONE_PREFIX)]);
  if ((await countReceivedToday([...pending, ...done], now, api)) >= MAX_DAILY) return "limit_daily";
  if (pending.length >= MAX_PENDING) return "limit_pending";

  const item: IntakeItem = { url, ts: now, status: "pending", attempts: 0 };
  try {
    return (await api.create(path, JSON.stringify(item))) === "created" ? "accepted" : "duplicate";
  } catch (err) {
    if (await api.exists(path).catch(() => false)) return "duplicate";
    throw err;
  }
}

// GET: pending 項目を ts 昇順で返す。読み取りが stale で見えない項目は翌日のジョブで拾える。
export async function listPendingItems(api: IntakeBlobApi = realApi): Promise<{ url: string; ts: number; attempts: number }[]> {
  const entries = await api.list(PENDING_PREFIX);
  const items = (await mapLimited(entries, async (e) => parseItem(await api.get(e.pathname)))).filter(
    (i): i is IntakeItem => i !== null && i.status === "pending",
  );
  return items.sort((a, b) => a.ts - b.ts).map((i) => ({ url: i.url, ts: i.ts, attempts: i.attempts }));
}

// PATCH: retry は pending を上書き（attempts+1）。それ以外は done を作成/上書きしてから pending を del。
// 最後に30日超の done を掃除するが、掃除の失敗は PATCH の成否に影響させない。
export async function applyIntakeResults(
  results: IntakeResult[],
  now: number,
  api: IntakeBlobApi = realApi,
): Promise<number> {
  let updated = 0;
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const v = validateIntakeUrl(r.url);
    if (!v.ok) continue;
    const key = keyOf(v.url);
    const cur = parseItem(await api.get(pendingPath(key)));
    if (!cur || cur.status !== "pending") continue;
    const out = applyResults({ version: 1, items: { [key]: cur } }, [r], now);
    if (!out.updated) continue;
    const next = JSON.stringify(out.data.items[key]);
    if (r.status === "retry") {
      await api.overwrite(pendingPath(key), next);
    } else {
      await api.overwrite(donePath(key), next);
      await api.del([pendingPath(key)]);
    }
    updated++;
  }
  try {
    await sweepOldDone(now, api);
  } catch (err) {
    console.warn("[exhibitionIntakeStore] tombstone sweep failed", err);
  }
  return updated;
}

async function sweepOldDone(now: number, api: IntakeBlobApi): Promise<void> {
  const limit = now - TOMBSTONE_DAYS * DAY_MS;
  const old = (await api.list(DONE_PREFIX)).filter((e) => e.uploadedAt.getTime() < limit);
  const doomed: string[] = [];
  await mapLimited(old, async (e) => {
    const it = parseItem(await api.get(e.pathname));
    if (it && now - (it.processedAt ?? it.ts) > TOMBSTONE_DAYS * DAY_MS) doomed.push(e.pathname);
  });
  await api.del(doomed);
}
