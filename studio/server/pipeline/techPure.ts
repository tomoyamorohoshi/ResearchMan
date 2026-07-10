/**
 * Research(Technology) 実パイプラインの純粋関数群（ネットワーク/git/Agent SDKに触れない部分）。
 * pure.ts（Case Study）と同じ関心の分離。id生成・重複除外・語彙/書式検証・エントリ組み立てを
 * ここに集約する（DESIGN.md §6 Research(Technology)・TECHNOLOGY_SPEC.md準拠。
 * scripts/build-tech-from-research.mjs の toId/normTitle/検証ロジックをTS移植）。
 *
 * normTitle について: build-tech-from-research.mjs::normTitle は `[^a-z0-9]` のみを残す
 * （日本語を全て除去する）ため、日本語のみのタイトル同士は常に空文字へ正規化され
 * 誤って衝突判定されるおそれがある。Tech の技術名はほぼ英語表記のため元スクリプトでは
 * 顕在化しないが、Studio側の新規実装では pure.ts の normalizeTitleKey（NFKD・かな漢字対応）
 * を再利用し、この潜在バグを踏襲しない（元スクリプト自体は無改変のため挙動差は生じない）。
 */
import { normalizeTitleKey } from "./pure.js";

// ── id生成（build-tech-from-research.mjs::toId と同一アルゴリズム） ────────
export function toTechId(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[:：].*$/, "")
    .replace(/[^a-z0-9぀-ヿ一-龯]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ── 書式検証 ────────────────────────────────────────────────────
export function isValidDateFormat(date: unknown): date is string {
  return typeof date === "string" && /^\d{4}-\d{2}$/.test(date);
}

// build-tech-from-research.mjs::isProxyUrl と同一（ホスト名の完全一致で判定。
// 部分一致だと reddit.com 等の正規ドメインを誤ってrejectする事故があったための仕様）。
export function isProxyUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "t.co" || h === "r.jina.ai";
  } catch {
    return false;
  }
}

export interface TechLink {
  kind: string;
  url: string;
}

export function findPrimaryLink(links: TechLink[]): TechLink | undefined {
  return links.find((l) => ["github", "project", "product"].includes(l.kind));
}

// ── 語彙フィルタ ────────────────────────────────────────────────
export interface TechVocab {
  Domain: string[];
  Type: string[];
}

export function filterValidDomains(domains: unknown, vocab: TechVocab): string[] {
  if (!Array.isArray(domains)) return [];
  const valid = new Set(vocab.Domain);
  return Array.from(new Set(domains.filter((d): d is string => typeof d === "string" && valid.has(d))));
}

// ── 既存tech.jsonインデックス（重複除外用） ──────────────────────
export interface ExistingTechIndex {
  ids: Set<string>;
  titleKeys: Set<string>;
}

export function buildExistingTechIndex(tech: Array<{ id: string; title: string }>): ExistingTechIndex {
  return {
    ids: new Set(tech.map((t) => t.id)),
    titleKeys: new Set(tech.map((t) => normalizeTitleKey(t.title))),
  };
}

// ── 候補の検証・組み立て ────────────────────────────────────────
export interface TechLicense {
  spdx: string | null;
  commercial: string;
  note?: string;
}

export interface RelatedWork {
  title: string;
  description: string;
  url: string;
}

export interface RawTechCandidate {
  techName?: unknown;
  org?: unknown;
  type?: unknown;
  domains?: unknown;
  date?: unknown;
  links?: unknown;
  license?: unknown;
  summaryJa?: unknown;
  pointJa?: unknown;
  detailJa?: unknown;
  relatedWorks?: unknown;
  thumbnailSource?: unknown;
  verdict?: unknown;
}

export interface ValidatedTechCandidate {
  id: string;
  title: string;
  org: string;
  type: string;
  domains: string[];
  date: string;
  year: string;
  summary: string;
  point: string;
  detail?: string;
  license: TechLicense;
  links: TechLink[];
  thumbnailSource: string;
  relatedWorks: RelatedWork[];
}

export interface TechRejection {
  id: string;
  reason: string;
}

export interface TechEntry {
  id: string;
  title: string;
  org: string;
  type: string;
  domains: string[];
  date: string;
  year: string;
  summary: string;
  point: string;
  detail?: string;
  license: TechLicense;
  links: TechLink[];
  thumbnail: string;
  relatedWorks: RelatedWork[];
  sources: string[];
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * Agent応答の候補配列を検証・重複除外する（DESIGN.md §6・TECHNOLOGY_SPEC.md §1品質バー・
 * build-tech-from-research.mjs の候補ループを移植）。一次ソース死活・サムネイル取得は
 * 非同期でネットワークを伴うためここでは扱わない（呼び出し側 techResearch.ts が
 * accepted の各候補についてさらに検証する）。
 */
export function validateAndDedupeTechCandidates(
  raws: RawTechCandidate[],
  vocab: TechVocab,
  existingTech: ExistingTechIndex,
  existingCaseTitleKeys: Set<string>,
): { accepted: ValidatedTechCandidate[]; rejected: TechRejection[] } {
  const accepted: ValidatedTechCandidate[] = [];
  const rejected: TechRejection[] = [];
  const seenIds = new Set<string>();
  const seenTitleKeys = new Set<string>();

  for (const raw of raws) {
    const techName = isNonEmptyString(raw.techName) ? raw.techName.trim() : "";
    const id = toTechId(techName);
    const label = id || techName || "(不明)";

    if (raw.verdict !== "adopt" && raw.verdict !== "adopt-adjusted") {
      rejected.push({ id: label, reason: `verdictがadoptではありません: ${String(raw.verdict)}` });
      continue;
    }
    if (!techName || !id) {
      rejected.push({ id: label, reason: "techNameが不正です" });
      continue;
    }
    const titleKey = normalizeTitleKey(techName);

    if (existingTech.ids.has(id) || seenIds.has(id)) {
      rejected.push({ id: label, reason: "既存tech.jsonまたは今回内でidが重複" });
      continue;
    }
    if (existingTech.titleKeys.has(titleKey) || seenTitleKeys.has(titleKey)) {
      rejected.push({ id: label, reason: "既存tech.jsonまたは今回内でタイトルが重複" });
      continue;
    }
    if (existingCaseTitleKeys.has(titleKey)) {
      rejected.push({ id: label, reason: "Case Studyとタイトルが重複" });
      continue;
    }

    const type = typeof raw.type === "string" ? raw.type : "";
    if (!vocab.Type.includes(type)) {
      rejected.push({ id: label, reason: `不正type: ${type}` });
      continue;
    }

    const domains = filterValidDomains(raw.domains, vocab);
    if (domains.length === 0) {
      rejected.push({ id: label, reason: "有効なdomainがありません" });
      continue;
    }

    if (!isValidDateFormat(raw.date)) {
      rejected.push({ id: label, reason: `不正なdate形式: ${String(raw.date)}` });
      continue;
    }

    const org = isNonEmptyString(raw.org) ? raw.org.trim() : "";
    const summary = isNonEmptyString(raw.summaryJa) ? raw.summaryJa.trim() : "";
    const point = isNonEmptyString(raw.pointJa) ? raw.pointJa.trim() : "";
    if (!org || !summary || !point) {
      rejected.push({ id: label, reason: "org/summary/pointのいずれかが空です" });
      continue;
    }
    const detail = isNonEmptyString(raw.detailJa) ? raw.detailJa.trim() : undefined;

    const linksRaw = Array.isArray(raw.links) ? raw.links : [];
    const links: TechLink[] = linksRaw
      .filter((l): l is { kind: unknown; url: unknown } => !!l && typeof l === "object")
      .map((l) => ({ kind: String((l as { kind: unknown }).kind ?? ""), url: String((l as { url: unknown }).url ?? "") }))
      .filter((l) => l.kind && l.url);

    const proxyLink = links.find((l) => isProxyUrl(l.url));
    if (proxyLink) {
      rejected.push({ id: label, reason: `プロキシURLが混入: ${proxyLink.url}` });
      continue;
    }

    const primary = findPrimaryLink(links);
    if (!primary) {
      rejected.push({ id: label, reason: "一次ソース（github/project/product）がありません" });
      continue;
    }

    const licenseRaw = raw.license && typeof raw.license === "object" ? (raw.license as Record<string, unknown>) : {};
    const license: TechLicense = {
      spdx: typeof licenseRaw.spdx === "string" ? licenseRaw.spdx : null,
      commercial: typeof licenseRaw.commercial === "string" ? licenseRaw.commercial : "none",
      ...(isNonEmptyString(licenseRaw.note) ? { note: licenseRaw.note.trim() } : {}),
    };

    const relatedWorksRaw = Array.isArray(raw.relatedWorks) ? raw.relatedWorks : [];
    const relatedWorks: RelatedWork[] = relatedWorksRaw
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({
        title: typeof r.title === "string" ? r.title : "",
        description: typeof r.description === "string" ? r.description : "",
        url: typeof r.url === "string" ? r.url : "",
      }));

    const thumbnailSource = isNonEmptyString(raw.thumbnailSource) ? raw.thumbnailSource.trim() : primary.url;

    seenIds.add(id);
    seenTitleKeys.add(titleKey);
    accepted.push({
      id,
      title: techName,
      org,
      type,
      domains,
      date: raw.date as string,
      year: (raw.date as string).slice(0, 4),
      summary,
      point,
      ...(detail ? { detail } : {}),
      license,
      links,
      thumbnailSource,
      relatedWorks,
    });
  }

  return { accepted, rejected };
}

/** tech.json への書き込みエントリを組み立てる（サムネイル取得後に呼ぶ）。 */
export function buildTechEntry(candidate: ValidatedTechCandidate, thumbnail: string, sourceLabel: string): TechEntry {
  return {
    id: candidate.id,
    title: candidate.title,
    org: candidate.org,
    type: candidate.type,
    domains: candidate.domains,
    date: candidate.date,
    year: candidate.year,
    summary: candidate.summary,
    point: candidate.point,
    ...(candidate.detail ? { detail: candidate.detail } : {}),
    license: candidate.license,
    links: candidate.links,
    thumbnail,
    relatedWorks: candidate.relatedWorks,
    sources: [sourceLabel],
  };
}

// ── commitメッセージ ────────────────────────────────────────────
export function buildTechCommitMessage(theme: string, count: number): string {
  return `Studio research: ${theme} ${count}件追加 (Technology)`;
}
