/**
 * idea(テーマ駆動アイディエーション) 実パイプラインの純粋関数群（ネットワーク/git/Agent SDKに
 * 触れない部分）。DESIGN.md §6 idea・§10 P3。caseResearch.ts / pure.ts と同じ関心の分離
 * （純粋ロジックはここに集約し単体テストする。実行時オーケストレーションは ideaResearch.ts）。
 */
import { normTitle } from "../../../scripts/lib/norm-title.mjs";
import { computeItemWeight, weightedSample } from "../../../scripts/lib/weighted-sample.mjs";
import { clampCount } from "../jobs.js";
import type { IdeaAngle } from "./ideaAngles.js";
import { extractJsonArray } from "./pure.js";

// ── リクエスト検証 ──────────────────────────────────────────────

export type IdeaSource = "全事例から" | "お気に入り中心";

export interface ValidatedIdeaRequest {
  theme: string;
  constraint: string;
  source: IdeaSource;
  count: number;
  /** trueの場合、機械検証・咀嚼・採点/改稿までを実行し、cases.json相当（ideas.json）への
   * 書き込み・commit/push・LINE通知を一切行わずjob.ideaPreviewに記録して終了する
   * （addCase.ts/awardResearch.tsのdryRunと同じ、E2E検証用パターン）。 */
  dryRun: boolean;
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
  const dryRun = request.dryRun === true;
  return { ok: true, value: { theme, constraint, source, count, dryRun } };
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

/** お気に入り体現事例1件につき重み+3（既存: 「お気に入り中心」時のみ有効）。 */
const FAVORITE_EXEMPLAR_WEIGHT = 3;
// いいね1件につき重み+2（要件: 全モードで有効）。お気に入り事例の重み(+3/件)より弱いシグナル
// として控えめに加点する（いいねは「アイデア」単位、お気に入りは「事例」単位で意味が異なるため）。
const IDEA_LIKE_WEIGHT = 2;
// ゴミ箱1件ごとに重みを半減させる減衰率。
const IDEA_TRASH_DECAY_BASE = 0.5;
// 何度ゴミ箱に入れられても重みが0近くまで潰れて二度と選ばれなくなる（多様性喪失）のを防ぐため、
// 減衰倍率の下限を0.2倍に固定する。
const IDEA_TRASH_MIN_MULTIPLIER = 0.2;

/** 切り口(pattern=label)ごとの いいね/ゴミ箱 件数。 */
export interface IdeaSignalCounts {
  likes: number;
  trash: number;
}

/**
 * 既存アイデア（ideas.json）から、切り口(pattern)ごとの いいね/ゴミ箱 件数を集計する。
 * pattern が allowedLabels（A系統の切り口ライブラリのlabel集合）に一致しないエントリ
 * （B系統の種のpattern名等）は無視する。id/pattern欠落・いいね/ゴミ箱いずれでもない
 * アイデアも同様に無視する（結果Mapに載せない＝selectAngles側で「該当なし」と同じ扱いになる）。
 */
export function tallyIdeaSignalsByAngle(
  existingIdeas: Array<{ id?: string; pattern?: string }>,
  ideaLikeIds: ReadonlySet<string>,
  ideaTrashIds: ReadonlySet<string>,
  allowedLabels: ReadonlySet<string>,
): Map<string, IdeaSignalCounts> {
  const result = new Map<string, IdeaSignalCounts>();
  for (const idea of existingIdeas) {
    const pattern = idea.pattern;
    const id = idea.id;
    if (!pattern || !id || !allowedLabels.has(pattern)) continue;
    const liked = ideaLikeIds.has(id);
    const trashed = ideaTrashIds.has(id);
    if (!liked && !trashed) continue;
    const current = result.get(pattern) ?? { likes: 0, trash: 0 };
    if (liked) current.likes += 1;
    if (trashed) current.trash += 1;
    result.set(pattern, current);
  }
  return result;
}

/**
 * 切り口ごとの選定重みを計算する（純関数。selectAnglesの重み部分のみを切り出し、
 * 決定的な値として単体テストできるようにする）。
 * 基準重みはfavoriteCaseIds指定時のみ「1+お気に入り体現事例数×3」、それ以外は1
 * （既存のDESIGN.md §6ロジックを維持）。ここに、ideaSignalsにある切り口については
 * 「+いいね数×IDEA_LIKE_WEIGHT」を加算した後、「×IDEA_TRASH_DECAY_BASE^ゴミ箱数
 * （下限IDEA_TRASH_MIN_MULTIPLIER）」を乗じる。ideaSignalsに該当エントリが無い切り口は
 * 基準重みのまま変化しない（縮退時・未取得時は従来と完全に同一の重みになる）。
 */
export function computeAngleWeights(
  angles: IdeaAngle[],
  favoriteCaseIds: Set<string> | null,
  ideaSignals: Map<string, IdeaSignalCounts>,
): number[] {
  return angles.map((a) => {
    let weight = favoriteCaseIds
      ? 1 + a.exemplarCaseIds.filter((id) => favoriteCaseIds.has(id)).length * FAVORITE_EXEMPLAR_WEIGHT
      : 1;
    const signal = ideaSignals.get(a.label);
    if (signal) {
      weight += signal.likes * IDEA_LIKE_WEIGHT;
      weight *= Math.max(IDEA_TRASH_MIN_MULTIPLIER, IDEA_TRASH_DECAY_BASE ** signal.trash);
    }
    return weight;
  });
}

/**
 * ライブラリからcount個の切り口を選ぶ。お気に入り事例と重なるexemplarCaseIdsが多い切り口ほど
 * 選ばれやすくする（DESIGN.md §6: 「お気に入りで重み付け」）。favoriteCaseIdsがnull
 * （お気に入り未接続・全事例から）の場合は基準重み1（一様）。これに加え、ideaSignals
 * （アイデアの いいね/ゴミ箱 評価による切り口別の重み補正。computeAngleWeights参照）を
 * 全モード共通で適用する。ideaSignalsを省略・空Mapで渡した場合は従来と完全に同一の重みになる
 * （アイデア評価が未接続/取得失敗のときのフォールバック。呼び出し側ideaResearch.ts参照）。
 * count が語彙数を超える場合は不足分を先頭から繰り返して埋める（語彙は15〜25想定・countは最大10
 * のため通常は発生しない防御的分岐）。
 */
export function selectAngles(
  angles: IdeaAngle[],
  count: number,
  favoriteCaseIds: Set<string> | null,
  ideaSignals: Map<string, IdeaSignalCounts> = new Map(),
): IdeaAngle[] {
  if (angles.length === 0) return [];
  const weights = computeAngleWeights(angles, favoriteCaseIds, ideaSignals);
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
  /** なぜこの要素の組み合わせが効くのかの1行言語化（要件3）。欠落は生成を捨てる理由に
   * せず、warning扱いで空文字を保存する（呼び出し側 ideaResearch.ts 参照）。 */
  rationale?: unknown;
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
  /** 要素の組み合わせがなぜ効くのかの1行言語化（欠落時は空文字。要件3・4参照）。 */
  rationale: string;
  /** 批評フェーズ（ヤング⑤相当）の3軸スコア。採点呼び出し失敗時・この案の結果が
   * 欠落した場合は暫定値としてゼロのまま残る（ideaResearch.ts::runCritiqueCall参照）。 */
  scores: {
    discovery: number;
    surprise: number;
    conviction: number;
  };
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

// ── 咀嚼（ヤング『アイデアのつくり方』②相当。部分アイデアの書き出し） ──────────

/** 切り口1つ分の咀嚼結果（要素分解＋有望な組み合わせ候補）。 */
export interface ChewedAngle {
  angle: string;
  elements: string[];
  partials: string[];
}

/**
 * buildIdeaChewPrompt の出力テキストをパースする。JSONとして解釈できない場合は null を返し、
 * 呼び出し側（ideaResearch.ts）が空配列へフォールバックして咀嚼をスキップし直接生成へ進む
 * （咀嚼はenhancerであり必須ゲートにしない。タスク指示参照）。
 * angleが欠落した要素・elements/partials内の非文字列は個別に除外する（部分的な不正では
 * 全体を捨てない。他のparse*Result関数と同じ寛容さ）。
 */
export function parseChewResult(text: string): ChewedAngle[] | null {
  const arr = extractJsonArray(text);
  if (!arr) return null;
  const result: ChewedAngle[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const angle = typeof rec.angle === "string" ? rec.angle.trim() : "";
    if (!angle) continue;
    const elements = Array.isArray(rec.elements)
      ? rec.elements.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
    const partials = Array.isArray(rec.partials)
      ? rec.partials.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
    result.push({ angle, elements, partials });
  }
  return result;
}

// ── 批評（ヤング⑤相当。質の批評→育成） ──────────────────────────────

/** 機械検証を通過した1案の3軸採点。noteは改稿時の指摘（改稿しない場合は使わない）。 */
export interface IdeaCritique {
  id: string;
  discovery: number;
  surprise: number;
  conviction: number;
  note?: string;
}

// 15点満点（discovery/surprise/conviction 各1〜5）中、この値未満は改稿対象にする閾値。
// 「1軸だけ平凡(3)でも残り2軸が良ければ(4,4)通す」(3+4+4=11)を合格ラインの目安にし、
// 3軸とも平凡(3+3+3=9)や1軸だけ良くて残りが並(4+3+3=10)は改稿に回すよう11に設定する。
export const IDEA_CRITIQUE_REVISE_THRESHOLD = 11;

// 改稿してもこの値未満なら見込みなしとして破棄する。REVISE_THRESHOLDより確実に低くし、
// 「3軸平均3(9点)をわずかに下回る」8点を破棄ラインにする（改稿1回で平均3にすら
// 届かない案は諦める。閾値間に猶予を設け、改稿1回で伸びた案は拾えるようにする）。
export const IDEA_CRITIQUE_DISCARD_THRESHOLD = 8;

/** 3軸の合計点（15点満点）。 */
export function sumCritiqueScore(c: { discovery: number; surprise: number; conviction: number }): number {
  return c.discovery + c.surprise + c.conviction;
}

/** 1〜5の整数にクランプする。数値化できなければnull（呼び出し元がその要素を捨てる）。 */
function clampCritiqueScore(n: unknown): number | null {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.min(5, Math.max(1, Math.round(v)));
}

/**
 * buildIdeaCritiquePrompt の出力テキストをパースする。JSONとして解釈できない場合は null
 * （呼び出し側が「無採点のまま元の案を通す」フォールバックに使う）。
 * id・discovery・surprise・conviction のいずれかが欠落/数値化不能な要素は個別に除外する。
 */
export function parseCritiqueResult(text: string): IdeaCritique[] | null {
  const arr = extractJsonArray(text);
  if (!arr) return null;
  const result: IdeaCritique[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    if (!id) continue;
    const discovery = clampCritiqueScore(rec.discovery);
    const surprise = clampCritiqueScore(rec.surprise);
    const conviction = clampCritiqueScore(rec.conviction);
    if (discovery === null || surprise === null || conviction === null) continue;
    const note = typeof rec.note === "string" ? rec.note.trim() : "";
    result.push({ id, discovery, surprise, conviction, ...(note ? { note } : {}) });
  }
  return result;
}

// ── 改稿（批評で改稿対象となった案の書き直し） ────────────────────────────

/** buildIdeaRevisePromptの出力1件。pattern（切り口）は変更禁止のため含まない
 * （呼び出し側 ideaResearch.ts が元のpatternをそのまま維持する）。 */
export interface ReviseCandidate {
  id: string;
  title: string;
  seed: string;
  rationale: string;
  refs: unknown[];
}

/**
 * buildIdeaRevisePrompt の出力テキストをパースする。JSONとして解釈できない場合は null
 * （呼び出し側が「改稿できなかった＝破棄」のフォールバックに使う）。
 * id・title・seedのいずれかが欠落した要素は個別に除外する。rationale/refsは省略可
 * （省略時は空文字/空配列で補う）。refsの中身自体はここでは検証しない（resolveIdeaRefで
 * 既存の許可id集合チェックを再利用するため、ideaResearch.ts側の責務とする）。
 */
export function parseReviseResult(text: string): ReviseCandidate[] | null {
  const arr = extractJsonArray(text);
  if (!arr) return null;
  const result: ReviseCandidate[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    const seed = typeof rec.seed === "string" ? rec.seed.trim() : "";
    if (!id || !title || !seed) continue;
    const rationale = typeof rec.rationale === "string" ? rec.rationale.trim() : "";
    const refs = Array.isArray(rec.refs) ? rec.refs : [];
    result.push({ id, title, seed, rationale, refs });
  }
  return result;
}
