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
