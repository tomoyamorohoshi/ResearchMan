/**
 * サーバAPI へのfetchラッパー。
 */
import type { Job, Tab } from "./types";

/**
 * サーバが 400/500 で返す `{ error: string }` を読み、UIで表示できるメッセージにする。
 * 本文の解析に失敗した場合はステータスコードのみのフォールバックにする。
 */
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

export async function createJob(
  tab: Tab,
  request: Record<string, unknown>,
): Promise<Job> {
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tab, request }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `POST /api/jobs failed: ${res.status}`));
  }
  return res.json();
}

export async function listJobs(): Promise<Job[]> {
  const res = await fetch("/api/jobs");
  if (!res.ok) {
    throw new Error(`GET /api/jobs failed: ${res.status}`);
  }
  return res.json();
}

export async function getJob(id: string): Promise<Job> {
  const res = await fetch(`/api/jobs/${id}`);
  if (!res.ok) {
    throw new Error(`GET /api/jobs/${id} failed: ${res.status}`);
  }
  return res.json();
}

/**
 * ジョブ進捗をSSE（Server-Sent Events）で購読する（DESIGN.md §10 P4）。
 * サーバは接続直後に現在のジョブ状態を1件送り、以後 status="running" の間は更新の
 * たびにイベントを送る。ジョブがrunningでなくなった時点でサーバ・クライアント双方が
 * 接続を閉じる（index.ts::createApp参照）。
 *
 * 接続エラー時（プロキシ経由の切断・サーバ再起動等）は onError を呼ぶだけで自動再接続は
 * しない。呼び出し側（ResearchPanel/IdeaPanel）が既存のポーリングへフォールバックする
 * 判断はUI側に委ねる（5c8251eのリトライ耐性を持つポーリングを "SSEの正常なフォールバック
 * 手段" として残すため）。
 */
export function subscribeJobStream(
  id: string,
  onUpdate: (job: Job) => void,
  onError: (err: unknown) => void,
): () => void {
  const es = new EventSource(`/api/jobs/${id}/stream`);
  es.onmessage = (event) => {
    try {
      const job = JSON.parse(event.data) as Job;
      onUpdate(job);
      if (job.status !== "running") {
        // ジョブ確定後はサーバ側もストリームを閉じるが、クライアント側からも明示的に
        // 閉じておく（EventSourceは既定でサーバ切断時に自動再接続を試みるため、それを防ぐ）。
        es.close();
      }
    } catch (err) {
      onError(err);
    }
  };
  es.onerror = (event) => {
    if (es.readyState === EventSource.CLOSED) return; // 上記の正常終了close済みなら無視
    es.close();
    onError(event);
  };
  return () => es.close();
}
