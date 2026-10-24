/**
 * add-case の contentKind:"exhibition" 分岐のデータ処理（data/exhibition.json への追加判定）。
 *
 * 追加ロジックは自作せず scripts/lib/exhibition-build.mjs::processCandidates（日次ジョブ・
 * intake と同じ公式ページ機械照合・dedupe・hard除外・サムネ取得）をそのまま使う。
 * 候補は origin:"intake"（ユーザー投稿扱い＝intakeBonus・日次上限外。addCasePure.ts::
 * parseExhibitionCandidates が強制付与）。ネットワーク/サムネ保存は deps 注入でテスト可能にする。
 *
 * ファイル書き込み・git・LINE通知はここでは行わない（addCase.ts側。他分岐と同じ責務分担）。
 */
import path from "node:path";
import { processCandidates } from "../../../scripts/lib/exhibition-build.mjs";
import { parseExhibitionCandidates } from "./addCasePure.js";

export interface ExhibitionItem {
  id: string;
  title: string;
  venue: string;
  startDate: string;
  endDate: string;
  link: string;
  thumbnail: string;
  origin?: string;
  intakeUrl?: string;
  [key: string]: unknown;
}

export interface ExhibitionData {
  version: number;
  statusAsOf: string;
  items: ExhibitionItem[];
  [key: string]: unknown;
}

export interface ExhibitionDeps {
  fetchHtml: (url: string) => Promise<{ status: number; body: string } | null>;
  saveThumb: (id: string, cand: Record<string, unknown>) => Promise<string | null>;
  now: () => string;
}

export interface ExhibitionBuildOpts {
  addThreshold: number;
  highlightThreshold: number;
  dryRun?: boolean;
  reservedIds?: Set<string>;
}

export type ExhibitionOutcome = "added" | "updated" | "duplicate" | "unverified" | "rejected";

export interface UnverifiedEntry {
  title: string;
  venue: string;
  link: string;
  reason: string;
  intakeUrl?: string;
  at: string;
  [key: string]: unknown;
}

export interface UserPick {
  title: string;
  venue: string;
  tags: string[];
  why: string;
  addedAt: string;
}

export interface ProcessExhibitionResult {
  outcome: ExhibitionOutcome;
  /** 更新後のdata（added/updated以外は入力のまま。statusAsOf等の再計算は反映される）。 */
  data: ExhibitionData;
  added: ExhibitionItem[];
  updated: Array<{ id: string; title: string; patch: Record<string, unknown> }>;
  unverified: UnverifiedEntry[];
  rejected: Array<{ title: string; reason: string }>;
  /** outcomeがunverified/rejected/duplicateのときの平易な理由（LINE通知用）。 */
  reasonJa: string;
  /** duplicateのとき、既存側のタイトル。 */
  duplicateTitle?: string;
  /** 素点<閾値で追加された投稿（likes.userPicks の記録対象。反映は呼び出し側）。 */
  userPicks: UserPick[];
  /** 追加分のサムネのROOT相対パス（"public/thumbnails/exhibition/<id>.jpg"。dryRunでは実体なし）。 */
  thumbnailRelPaths: string[];
}

/** processCandidatesの機械的な理由コードを、LINEで読める平易な日本語にする。 */
export function describeExhibitionReason(reason: string): string {
  const r = reason || "";
  if (r.startsWith("official-url-missing")) return "公式ページ（会場・主催者の個別ページ）が見つかりませんでした";
  if (r.startsWith("official-url-")) return "公式ページとして使えるURLが見つかりませんでした";
  if (r.startsWith("会期不明")) return "会期（開始日・終了日）が確認できませんでした";
  if (r.includes("official-date-mismatch")) return "公式ページで会期が確認できませんでした";
  if (r.includes("official-venue-mismatch")) return "公式ページで会場が確認できませんでした";
  if (r.includes("official-title-mismatch")) return "公式ページで展覧会名が確認できませんでした";
  if (r.includes("official-fetch") || r.includes("official-status")) return "公式ページを取得できませんでした";
  if (r.startsWith("required-field-missing")) return "開催市区町村または選定理由を確認できませんでした";
  if (r === "already-ended") return "すでに終了した展示のため追加しませんでした";
  if (r === "start-after-end") return "会期の開始日と終了日が不正でした";
  if (r === "hard-exclusion") return "Exhibitionの対象外カテゴリ（絵画・物販中心・ショールーム型・AI画像のみ等）の展示です";
  if (r === "invalid-prefecture") return "開催都道府県を確認できませんでした";
  if (r === "below-threshold") return "好みのスコアが基準に届きませんでした";
  if (r === "thumbnail-unavailable") return "サムネイル画像を確保できませんでした";
  if (r === "invalid-candidate") return "展覧会名または会場を確認できませんでした";
  if (r === "daily-cap") return "本日の追加上限に達しました";
  return r ? `追加処理中にエラーが起きました（コード: ${r}）` : "不明な理由で追加できませんでした";
}

/**
 * case-adderの応答（contentKind:"exhibition"）から候補を作り、processCandidatesで検証・追加した結果を返す。
 */
export async function processExhibitionAdd(p: {
  obj: Record<string, unknown>;
  url: string;
  data: ExhibitionData;
  today: string;
  deps: ExhibitionDeps;
  opts: ExhibitionBuildOpts;
}): Promise<ProcessExhibitionResult> {
  const { obj, url, data, today, deps, opts } = p;
  const base: ProcessExhibitionResult = {
    outcome: "rejected",
    data,
    added: [],
    updated: [],
    unverified: [],
    rejected: [],
    reasonJa: "",
    userPicks: [],
    thumbnailRelPaths: [],
  };
  const candidates = parseExhibitionCandidates(obj, url);
  if (candidates.length === 0) {
    return { ...base, reasonJa: "指定されたURLから展覧会（会場・会期）を特定できませんでした" };
  }

  // 終了済み（endDate < today）は公式URLの有無に関わらず先に reject する。processCandidates は
  // 公式URL欠落を already-ended より先に unverified 化するため、未検証キューに積まれるのを防ぐ。
  const isEnded = (c: Record<string, unknown>): boolean =>
    typeof c.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.endDate) && c.endDate < today;
  const endedRejected = candidates
    .filter(isEnded)
    .map((c) => ({ title: String(c.title ?? ""), reason: "already-ended" }));
  const live = candidates.filter((c) => !isEnded(c));
  if (live.length === 0) {
    return { ...base, rejected: endedRejected, reasonJa: describeExhibitionReason("already-ended") };
  }

  const out = await processCandidates({ data, candidates: live, today, deps, opts });
  const added = out.added as ExhibitionItem[];
  const updated = out.updated as ProcessExhibitionResult["updated"];
  const unverified = out.unverified as UnverifiedEntry[];
  const rejected = [...endedRejected, ...(out.rejected as Array<{ title: string; reason: string }>)];
  const common = { ...base, data: out.data as ExhibitionData, added, updated, unverified, rejected, userPicks: out.userPicks as UserPick[] };

  if (added.length > 0 || updated.length > 0) {
    return {
      ...common,
      outcome: added.length > 0 ? "added" : "updated",
      thumbnailRelPaths: added.map((a) => path.join("public", a.thumbnail)),
    };
  }
  if ((out.skipped as unknown[]).length > 0) {
    const existingId = (out.skipped as Array<{ existingId: string }>)[0].existingId;
    const existing = data.items.find((i) => i.id === existingId);
    return { ...common, outcome: "duplicate", duplicateTitle: existing?.title ?? "", reasonJa: "既に登録済みです" };
  }
  if (unverified.length > 0) {
    return { ...common, outcome: "unverified", reasonJa: describeExhibitionReason(unverified[0].reason) };
  }
  return { ...common, outcome: "rejected", reasonJa: describeExhibitionReason(rejected[0]?.reason ?? "") };
}
