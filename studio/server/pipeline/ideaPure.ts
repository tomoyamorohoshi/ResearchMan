/**
 * idea(テーマ駆動アイディエーション) 実パイプラインの純粋関数群（ネットワーク/git/Agent SDKに
 * 触れない部分）。DESIGN.md §6 idea・§10 P3。caseResearch.ts / pure.ts と同じ関心の分離
 * （純粋ロジックはここに集約し単体テストする。実行時オーケストレーションは ideaResearch.ts）。
 */
import { normTitle } from "../../../scripts/lib/norm-title.mjs";
import { computeItemWeight, weightedSample } from "../../../scripts/lib/weighted-sample.mjs";
import { clampCount } from "../jobs.js";
import type { IdeaAngle } from "./ideaAngles.js";

// ── リクエスト検証 ──────────────────────────────────────────────

export type IdeaSource = "全事例から" | "お気に入り中心";

export interface ValidatedIdeaRequest {
  theme: string;
  constraint: string;
  source: IdeaSource;
  count: number;
}

export type IdeaValidationResult =
  | { ok: true; value: ValidatedIdeaRequest }
  | { ok: false; error: string };

const IDEA_COUNT_MIN = 1;
const IDEA_COUNT_MAX = 10;
const IDEA_COUNT_DEFAULT = 6;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function validateIdeaRequest(request: Record<string, unknown>): IdeaValidationResult {
  const theme = str(request.theme);
  if (!theme) {
    return { ok: false, error: "お題を入力してください" };
  }
  const constraint = str(request.constraint);
  const source: IdeaSource = str(request.source) === "お気に入り中心" ? "お気に入り中心" : "全事例から";
  const count = clampCount(request.count, IDEA_COUNT_MIN, IDEA_COUNT_MAX, IDEA_COUNT_DEFAULT);
  return { ok: true, value: { theme, constraint, source, count } };
}

// ── 素材レコード（cases.json / tech.json の必要フィールドのみ） ─────────

export interface CaseRecord {
  id: string;
  title: string;
  client?: string;
  year?: string | number;
  link?: string;
  summary?: string;
  tags?: string[];
}

export interface TechRecord {
  id: string;
  title: string;
  type?: string;
  domains?: string[];
  summary?: string;
  point?: string;
}

/** 素材1件をプロンプト用の1行に整形する（case-collector等の既存プロンプトと同じ粒度）。 */
export function formatCaseLine(c: CaseRecord): string {
  return `- [${c.id}] ${c.title}（${c.client || "?"}）: ${(c.summary || "").slice(0, 90)}`;
}

export function formatTechLine(t: TechRecord): string {
  return `- [${t.id}] ${t.title}［${t.type || "?"}/${(t.domains || []).join(",")}］: ${(t.summary || "").slice(0, 100)}`;
}

// ── Tech候補のキーワードスコアリング（cases側は scripts/search-cases.mjs を再利用するため
//    ここではtechのみ実装。tech.jsonは48件程度と小さく全件スコアリングで十分） ──────────

export function scoreTechCandidates(tech: TechRecord[], keywords: string[], limit = 8): TechRecord[] {
  const norm = (v: unknown): string => (Array.isArray(v) ? v.join(" ") : String(v ?? "")).toLowerCase();
  const scored = tech
    .map((t) => {
      let score = 0;
      for (const kw of keywords) {
        const k = kw.toLowerCase().trim();
        if (!k) continue;
        if (norm(t.title).includes(k)) score += 5;
        if (norm(t.domains).includes(k)) score += 4;
        if (norm(t.summary).includes(k)) score += 3;
        if (norm(t.point).includes(k)) score += 1;
      }
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length > 0) return scored.slice(0, limit).map((x) => x.t);
  // キーワードが1件もヒットしない場合でも触発材料が0件にならないよう一様サンプリングにフォールバック
  return weightedSample(tech, Math.min(limit, tech.length));
}

// ── 切り口（angle）選定 ────────────────────────────────────────────

/**
 * ライブラリからcount個の切り口を選ぶ。お気に入り事例と重なるexemplarCaseIdsが多い切り口ほど
 * 選ばれやすくする（DESIGN.md §6: 「お気に入りで重み付け」）。favoriteCaseIdsがnull
 * （お気に入り未接続・全事例から）の場合は一様ランダム（従来のFisher-Yatesと同一経路）。
 * count が語彙数を超える場合は不足分を先頭から繰り返して埋める（語彙は15〜25想定・countは最大10
 * のため通常は発生しない防御的分岐）。
 */
export function selectAngles(
  angles: IdeaAngle[],
  count: number,
  favoriteCaseIds: Set<string> | null,
): IdeaAngle[] {
  if (angles.length === 0) return [];
  const weights = favoriteCaseIds
    ? angles.map((a) => {
        const hits = a.exemplarCaseIds.filter((id) => favoriteCaseIds.has(id)).length;
        return 1 + hits * 3;
      })
    : angles.map(() => 1);
  const picked = weightedSample(angles, Math.min(count, angles.length), weights);
  if (picked.length >= count) return picked.slice(0, count);
  const filled = [...picked];
  let i = 0;
  while (filled.length < count) {
    filled.push(angles[i % angles.length]);
    i++;
  }
  return filled;
}

// ── 生成結果の検証 ──────────────────────────────────────────────

export interface RawIdeaCandidate {
  title?: unknown;
  pattern?: unknown;
  seed?: unknown;
  refs?: unknown;
}

export interface ResolvedIdeaRef {
  type: "case" | "tech";
  id: string;
  title: string;
  desc: string;
}

export interface IdeaEntry {
  id: string;
  date: string;
  title: string;
  pattern: string;
  seed: string;
  refs: ResolvedIdeaRef[];
}

/** seed が「〜かも。」で終わっているか（DESIGN.md §6・要件の必須フォーマット）。 */
export function endsWithKamo(seed: string): boolean {
  return seed.trim().endsWith("かも。");
}

export function isAllowedPattern(pattern: unknown, allowedLabels: Set<string>): pattern is string {
  return typeof pattern === "string" && allowedLabels.has(pattern);
}

/**
 * 1件のrefを実データ（case/tech）に解決する。id は許可済みid集合（今回プロンプトで提示した
 * 候補のみ）に含まれる場合のみ解決を試みる（未提示のidを勝手に参照する＝ハルシネーション対策）。
 * 解決できないrefはnull（呼び出し側で捨てる）。
 */
export function resolveIdeaRef(
  ref: unknown,
  allowedIds: Set<string>,
  caseById: Map<string, CaseRecord>,
  techById: Map<string, TechRecord>,
): ResolvedIdeaRef | null {
  if (!ref || typeof ref !== "object") return null;
  const rec = ref as Record<string, unknown>;
  const type = rec.type === "tech" ? "tech" : rec.type === "case" ? "case" : null;
  const id = typeof rec.id === "string" ? rec.id : "";
  if (!type || !id || !allowedIds.has(id)) return null;
  const entry = type === "tech" ? techById.get(id) : caseById.get(id);
  if (!entry) return null;
  const desc = (typeof rec.desc === "string" ? rec.desc.trim() : "") || (entry.summary || "").slice(0, 70);
  return { type, id: entry.id, title: entry.title, desc };
}

/** 既存 ideas.json のエントリと title(正規化) または seed(完全一致) が重複していないか。 */
export function isDuplicateIdea(
  candidate: { title: string; seed: string },
  existingIdeas: Array<{ title?: string; seed?: string }>,
): boolean {
  const titleKey = normTitle(candidate.title);
  const seedKey = candidate.seed.trim();
  return existingIdeas.some(
    (e) => normTitle(e.title || "") === titleKey || (e.seed || "").trim() === seedKey,
  );
}

/**
 * data/ideas.json の採番: `studio-${date}-N`。デイリー（`${date}-N`）とはプレフィックスが
 * 異なるため名前空間が衝突しない（lock共有による直列化に加えた二重の安全策）。
 * N は「同日のstudio-プレフィックス最大連番+1」（欠番があっても既存idと衝突しない）。
 */
export function nextStudioIdeaSeq(existingIdeas: Array<{ id?: string; date?: string | null }>, dateStr: string): number {
  const prefix = `studio-${dateStr}-`;
  let seq = 0;
  for (const idea of existingIdeas) {
    if (idea.date !== dateStr) continue;
    const id = idea.id ?? "";
    if (!id.startsWith(prefix)) continue;
    const m = /-(\d+)$/.exec(id);
    if (m) seq = Math.max(seq, Number(m[1]));
  }
  return seq;
}

// ── commitメッセージ / LINE本文 ────────────────────────────────────

export function buildIdeaCommitMessage(theme: string, count: number): string {
  return `Studio idea: ${theme} ${count}案追加`;
}

export function buildIdeaLineText(params: {
  theme: string;
  entries: IdeaEntry[];
  verified: boolean;
  commitHash: string | null;
  site: string;
}): string {
  const { theme, entries, verified, commitHash, site } = params;
  const status = verified ? "本番反映OK" : "push済み（反映確認は時間切れ）";
  const lines = [`💡 Studio: お題「${theme}」 ${entries.length}案追加・${status}`, ""];
  const shown = new Set<string>();
  for (const e of entries) {
    lines.push(`・【${e.pattern}】${e.title}`);
    lines.push(e.seed);
    for (const ref of e.refs) {
      if (shown.has(ref.id)) continue;
      shown.add(ref.id);
      lines.push(`  ${ref.type === "case" ? "CASE" : "TECH"}: ${ref.title}`);
    }
    lines.push("");
  }
  lines.push(`${site}/ideas  (commit ${commitHash ? commitHash.slice(0, 8) : "unknown"})`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// ── 検証通過数の不足検知 ────────────────────────────────────────

/**
 * 検証を通過したアイデア数が依頼数に届かなかった場合の警告を組み立てる
 * （DESIGN §6・caseResearch.ts=P1と同じ「不足時はあるだけで進み、その旨を結果に明記」流儀。
 * adversarial-reviewer指摘: 従来はcount未達でも無警告でそのままコミットしていた）。
 * 既存の警告（お気に入り未接続など）があれば " / " で連結する。不足がなければ
 * 既存警告をそのまま返す（そもそも警告が無ければundefined）。
 */
export function appendCountShortfallWarning(
  actualCount: number,
  requestedCount: number,
  existingWarning: string | undefined,
): string | undefined {
  if (actualCount >= requestedCount) return existingWarning;
  const shortfall = `検証を通過したのは${actualCount}案でした（依頼${requestedCount}案）`;
  return existingWarning ? `${existingWarning} / ${shortfall}` : shortfall;
}
