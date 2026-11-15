// 事例ごとの詳細JSON（長文: overview/background/execution/...）の取得。
// public/data/cases/<id>.json は prebuild（scripts/prepare-public-data.mjs）が生成する静的アセット。
// ファイル名規則は scripts/lib/case-index.mjs の detailFileName と同一。
import type { Case } from "./cases";

export type CaseDetail = Partial<Case> & { id: string };

export function caseDetailUrl(id: string): string {
  return `/data/cases/${encodeURIComponent(id)}.json`;
}

export async function fetchCaseDetail(
  id: string,
  fetchFn: (url: string) => Promise<Response> = (u) => fetch(u),
): Promise<CaseDetail> {
  const res = await fetchFn(caseDetailUrl(id));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as CaseDetail;
}
