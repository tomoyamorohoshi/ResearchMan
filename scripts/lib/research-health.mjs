/**
 * リサーチの「仕組み」の健全性レビュー（決定的・LLM不使用の機械チェック＋任意の週次AIレビュー）。
 *
 * watchdog は「止まっていないか」を見る。ここは「動いているのに仕組みが壊れていないか」を見る。
 * 2026-10-20 時点の実例（この点検で検知できるべきもの）:
 *   1. Exhibition が11日間 追加0件（公式ページ照合のバグで同じ展示が毎日 unverified に積まれ続けた）
 *   2. Case Study の追加が週35〜40件→週2〜4件に激減（sources.json 全件 enabled:false、発見の候補0件が連発）
 *   3. 既存展示の startDate が毎日別の値に書き換わる（会期更新のフリップフロップ）
 *   4. 週次チューンアップが7週連続失敗（ENAMETOOLONG）、設定が長期間更新されない
 *   5. 展覧会告知が Case Study に、ゲームアートが「どれでもない」に誤分類
 *
 * watchdog.mjs からは `await runResearchHealthReview({ root, now, logDir })` の1行で呼べる。
 * 全チェックは例外を投げない（失敗したチェックは findings に 'check-error' を出して続行）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// ───────── しきい値（根拠つき） ─────────
/** 「直近」の窓（日）。週次リズムのジョブが多いので1週間 */
export const RECENT_DAYS = 7;
/** 比較基準の窓（日）。直前28日＝4週平均に直すと曜日・単発の揺れを均せる */
export const BASELINE_DAYS = 28;
/** 追加ペース: 直近7日が基準週平均のこの割合未満なら med（ユーザー指定の50%） */
export const PACE_DROP_RATIO = 0.5;
/** 基準の週平均がこれ未満のパイプラインは比較しない（0→1件等の小数ノイズ防止） */
export const PACE_MIN_BASELINE_WEEKLY = 2;
/** 連続0件日がこの日数以上なら high。cc/tech は日次で毎日1件以上出る運用、exhibition は週数件なので長め */
export const ZERO_STREAK_HIGH = { cc: 4, tech: 4, exhibition: 5 };
/** 発見の候補総数: 直近7日が基準週平均のこの割合未満なら med */
export const DISCOVERY_DROP_RATIO = 0.5;
export const DISCOVERY_MIN_BASELINE_WEEKLY = 3;
/** 却下の偏り: 同一reasonがこの割合超なら照合バグの兆候（ユーザー指定60%） */
export const REASON_DOMINANCE_RATIO = 0.6;
/** 偏り判定の最小件数（2〜3件の偏りは偶然） */
export const REASON_DOMINANCE_MIN_N = 5;
/** 基準期間でも同reasonが常態的に支配的（>60%・n>=10）なら正常運用（例: cc の no-creative-merit）として除外 */
export const REASON_BASELINE_MIN_N = 10;
/** 同一タイトルがこの日数以上連続で unverified/reject されたら med */
export const SAME_TITLE_STREAK_DAYS = 3;
/** フリップフロップ: 履歴を見るコミット範囲（日）と、変更回数のしきい値 */
export const FLIP_WINDOW_DAYS = 14;
export const FLIP_MIN_CHANGES = 2;
/** チューンアップの最終成功がこの日数超前なら high（週次なので1回失敗=7日、2回連続=14日 → 10日超で1回目の失敗を見逃さず2回目で確実に発報） */
export const TUNEUP_STALE_DAYS = 10;
/** 振り分け異常の観測窓（日）と add-case エラー中「どれでもない」系の割合・最小件数 */
export const MISCLASS_WINDOW_DAYS = 14;
export const NEITHER_RATE = 0.3;
export const NEITHER_MIN_JOBS = 5;
/** AIレビューに渡す材料の合計上限（文字）。ユーザー指定2万字 */
export const LLM_INPUT_MAX_CHARS = 20000;

const SEV_ORDER = { high: 0, med: 1, low: 2 };
const SEV_LABEL = { high: "高", med: "中", low: "低" };
const PIPELINES = ["cc", "tech", "exhibition"];
const LOG_FILES = { cc: "researchman-auto.log", tech: "researchman-tech.log", exhibition: "researchman-exhibition.log" };

// ───────── 日付ユーティリティ（JST暦日の文字列 YYYY-MM-DD で扱う） ─────────
export function jstDay(d) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
export function dayAdd(dayKey, n) {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function dayDiff(a, b) {
  const t = (k) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(a) - t(b)) / 86400000);
}
const isoToDay = (iso) => {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : jstDay(t);
};

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fallback; }
}
function readText(p) {
  try { return fs.readFileSync(p, "utf-8"); } catch { return ""; }
}
const itemsOf = (v) => (Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : []);

function gitOut(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf-8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
}
/** since（JST暦日）以降にfileを触ったコミットと、その直前の状態を古い順に返す: [{day, items}] 先頭は直前状態(day=null) */
function gitSnapshots(root, file, sinceDay) {
  const out = gitOut(root, ["log", `--since=${sinceDay}T00:00:00+09:00`, "--format=%H%x09%cI", "--reverse", "--", file]).trim();
  if (!out) return [];
  const commits = out.split("\n").map((l) => { const [h, iso] = l.split("\t"); return { h, day: isoToDay(iso) }; });
  const snaps = [];
  let parent = [];
  try { parent = itemsOf(JSON.parse(gitOut(root, ["show", `${commits[0].h}^:${file}`]))); } catch { parent = []; }
  snaps.push({ day: null, items: parent });
  for (const c of commits) {
    let items = null;
    try { items = itemsOf(JSON.parse(gitOut(root, ["show", `${c.h}:${file}`]))); } catch { items = null; }
    if (items) snaps.push({ day: c.day, items });
  }
  return snaps;
}

/** gitの追加履歴: Map<day, [{id,title,overview}]>（直前状態に無かったidを、その日のコミットの追加とみなす） */
function addsFromGit(root, file, sinceDay) {
  const snaps = gitSnapshots(root, file, sinceDay);
  const byDay = new Map();
  if (snaps.length < 2) return byDay;
  let seen = new Set(snaps[0].items.map((x) => x.id));
  for (const s of snaps.slice(1)) {
    for (const it of s.items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      if (!byDay.has(s.day)) byDay.set(s.day, []);
      byDay.get(s.day).push({ id: it.id, title: it.title ?? "", overview: it.overview ?? "" });
    }
  }
  return byDay;
}

const cnt = (v) => (Array.isArray(v) ? v.length : typeof v === "number" ? v : 0);

// ───────── チェック1: 追加ペース ─────────
function checkPace({ pipeline, label, byDay, today }) {
  const findings = [];
  const rFrom = dayAdd(today, -(RECENT_DAYS - 1));
  const bFrom = dayAdd(today, -(RECENT_DAYS - 1 + BASELINE_DAYS));
  const bTo = dayAdd(rFrom, -1);
  let recent = 0, base = 0;
  for (let d = bFrom; d <= today; d = dayAdd(d, 1)) {
    const c = cnt(byDay.get(d));
    if (d >= rFrom) recent += c; else if (d <= bTo) base += c;
  }
  const baseWeekly = base / (BASELINE_DAYS / RECENT_DAYS);
  if (baseWeekly >= PACE_MIN_BASELINE_WEEKLY && recent < baseWeekly * PACE_DROP_RATIO) {
    findings.push({
      severity: "med", pipeline, code: "pace-drop",
      title: `${label}の追加ペースが激減（直近7日 ${recent}件 / 直前28日の週平均 ${baseWeekly.toFixed(1)}件）`,
      detail: `直近${RECENT_DAYS}日の追加が基準週平均の${PACE_DROP_RATIO * 100}%未満です。発見の空振り・情報源の無効化・検証段階の誤却下を疑ってください。`,
      evidence: { recent7d: recent, baselineWeeklyAvg: Number(baseWeekly.toFixed(2)), baselineWindow: `${bFrom}〜${bTo}`, ratio: Number((recent / baseWeekly).toFixed(2)) },
    });
  }
  // 連続0件日（今日は実行前かもしれないので昨日から遡る。今日に追加があれば0）
  let streak = 0;
  if (cnt(byDay.get(today)) === 0) {
    for (let d = dayAdd(today, -1); d >= bFrom && cnt(byDay.get(d)) === 0; d = dayAdd(d, -1)) streak++;
  }
  const limit = ZERO_STREAK_HIGH[pipeline];
  if (base > 0 && streak >= limit) {
    findings.push({
      severity: "high", pipeline, code: "adds-stalled",
      title: `${label}の追加が${streak}日連続0件`,
      detail: `連続0件日が${limit}日以上です（毎日ジョブは動いていても、検証・照合段階で全落ちしている可能性があります）。`,
      evidence: { zeroDaysUntilYesterday: streak, threshold: limit, baselineAdds28d: base },
    });
  }
  return findings;
}

// ───────── チェック2: 発見の空振り（実行ログ） ─────────
const START_LINE = /^===== .*start/;
const RUN_DATE = /\b[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+[\d:]+\s+[A-Z]{2,5}\s+(\d{4})/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function lineDay(line) {
  const m = RUN_DATE.exec(line);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1]);
  if (mo < 0) return null;
  return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
}
/** ログをrun単位に分け、{day, candidates(行の合算 / 候補行が無ければnull), text} を返す */
export function parseRuns(text) {
  const runs = [];
  let cur = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (START_LINE.test(line)) {
      cur = { day: lineDay(line), candidates: null, text: "" };
      runs.push(cur);
      continue;
    }
    if (!cur) continue;
    cur.text += line + "\n";
    const m = /^候補: (\d+)件/.exec(line);
    if (m) cur.candidates = (cur.candidates ?? 0) + Number(m[1]);
  }
  return runs;
}
function checkDiscovery({ pipeline, label, runs, today }) {
  const rFrom = dayAdd(today, -(RECENT_DAYS - 1));
  const bFrom = dayAdd(today, -(RECENT_DAYS - 1 + BASELINE_DAYS));
  let recent = 0, base = 0, recentRuns = 0, recentZeroRuns = 0;
  for (const r of runs) {
    if (!r.day || r.day < bFrom || r.day > today) continue;
    const c = r.candidates ?? 0;
    if (r.day >= rFrom) {
      recent += c; recentRuns++;
      if (r.candidates === 0) recentZeroRuns++;
    } else base += c;
  }
  const baseWeekly = base / (BASELINE_DAYS / RECENT_DAYS);
  if (baseWeekly >= DISCOVERY_MIN_BASELINE_WEEKLY && recent < baseWeekly * DISCOVERY_DROP_RATIO) {
    return [{
      severity: "med", pipeline, code: "discovery-drop",
      title: `${label}の発見候補が激減（直近7日 ${recent}件 / 直前28日の週平均 ${baseWeekly.toFixed(1)}件）`,
      detail: `発見フェーズの候補総数が基準の${DISCOVERY_DROP_RATIO * 100}%未満です。情報源（data/sources.json）の無効化や検索基準の過剰な厳格化を疑ってください。直近7日に「候補: 0件」だった実行は ${recentZeroRuns}/${recentRuns} 回。`,
      evidence: { recent7dCandidates: recent, baselineWeeklyAvg: Number(baseWeekly.toFixed(2)), zeroCandidateRuns7d: `${recentZeroRuns}/${recentRuns}`, log: LOG_FILES[pipeline] },
    }];
  }
  return [];
}

// ───────── チェック3: 検証段階の偏り ─────────
function loadEvents(root, today) {
  const from = dayAdd(today, -(RECENT_DAYS - 1 + BASELINE_DAYS));
  const events = [];
  const months = new Set();
  for (let d = from; d <= today; d = dayAdd(d, 7)) months.add(d.slice(0, 7));
  months.add(today.slice(0, 7));
  for (const m of months) {
    for (const line of readText(path.join(root, "logs", `rejections-${m}.jsonl`)).split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        const day = isoToDay(r.date);
        if (day) events.push({ day, pipeline: r.pipeline || "cc", title: String(r.title || ""), reason: String(r.reason || "unknown"), source: "rejection" });
      } catch { /* 壊れた行は無視 */ }
    }
  }
  const unv = itemsOf(readJson(path.join(root, "data/inbox/exhibition-unverified.json"), {}));
  for (const u of unv) {
    const day = isoToDay(u.at);
    if (day) events.push({ day, pipeline: "exhibition", title: String(u.title || ""), reason: String(u.reason || "unknown"), source: "unverified" });
  }
  return events.filter((e) => e.day >= from && e.day <= today);
}
const reasonKey = (r) => String(r).split(/[:：]/)[0].trim() || "unknown";
const normTitle = (t) => t.toLowerCase().replace(/[\s　]+/g, "");

function checkVerification({ events, today }) {
  const findings = [];
  const rFrom = dayAdd(today, -(RECENT_DAYS - 1));
  for (const pipeline of new Set(events.map((e) => e.pipeline))) {
    const mine = events.filter((e) => e.pipeline === pipeline);
    const recent = mine.filter((e) => e.day >= rFrom);
    const base = mine.filter((e) => e.day < rFrom);
    // 3a. 同一reasonの支配
    if (recent.length >= REASON_DOMINANCE_MIN_N) {
      const tally = (arr) => arr.reduce((m, e) => m.set(reasonKey(e.reason), (m.get(reasonKey(e.reason)) || 0) + 1), new Map());
      const [topReason, topN] = [...tally(recent)].sort((a, b) => b[1] - a[1])[0];
      const share = topN / recent.length;
      const baseShare = base.length >= REASON_BASELINE_MIN_N ? (tally(base).get(topReason) || 0) / base.length : null;
      const normal = baseShare !== null && baseShare > REASON_DOMINANCE_RATIO;
      if (share > REASON_DOMINANCE_RATIO && !normal) {
        findings.push({
          severity: "med", pipeline, code: "reason-dominance",
          title: `${pipeline}の却下/未検証の${Math.round(share * 100)}%が同一理由「${topReason}」`,
          detail: `直近7日の却下・未検証${recent.length}件中${topN}件が同じ理由です（照合ロジックのバグの兆候。基準期間ではこの偏りは常態ではありませんでした）。`,
          evidence: { reason: topReason, recent7d: `${topN}/${recent.length}`, baselineShare: baseShare === null ? "n/a" : Number(baseShare.toFixed(2)), files: "logs/rejections-*.jsonl, data/inbox/exhibition-unverified.json" },
        });
      }
    }
    // 3b. 同一タイトルの連続日
    const byTitle = new Map();
    for (const e of mine) {
      const k = normTitle(e.title);
      if (!k) continue;
      if (!byTitle.has(k)) byTitle.set(k, { title: e.title, days: new Set() });
      byTitle.get(k).days.add(e.day);
    }
    const streaks = [];
    for (const { title, days } of byTitle.values()) {
      const sorted = [...days].sort();
      let best = 1, run = 1, end = sorted[0];
      for (let i = 1; i < sorted.length; i++) {
        run = dayDiff(sorted[i], sorted[i - 1]) === 1 ? run + 1 : 1;
        if (run > best) { best = run; end = sorted[i]; }
        else if (run === best) end = sorted[i];
      }
      if (best >= SAME_TITLE_STREAK_DAYS && end >= rFrom) streaks.push({ title, days: best });
    }
    if (streaks.length) {
      streaks.sort((a, b) => b.days - a.days);
      findings.push({
        severity: "med", pipeline, code: "same-title-streak",
        title: `${pipeline}で同じタイトルが${streaks[0].days}日以上連続して却下/未検証（${streaks.length}件）`,
        detail: `毎日同じ候補が見つかっては落ちています。照合の不具合か、既知の落選候補を除外できていません: ${streaks.slice(0, 5).map((s) => `「${s.title}」${s.days}日`).join(" / ")}`,
        evidence: { titles: streaks.slice(0, 5), files: "logs/rejections-*.jsonl, data/inbox/exhibition-unverified.json" },
      });
    }
  }
  return findings;
}

// ───────── チェック4: フリップフロップ ─────────
function checkFlipFlop({ root, today }) {
  const since = dayAdd(today, -FLIP_WINDOW_DAYS);
  const snaps = gitSnapshots(root, "data/exhibition.json", since);
  if (snaps.length < 2) return [];
  const FIELDS = ["startDate", "endDate", "venue"];
  const changes = new Map(); // id -> [{day, field, from, to}]
  let prev = new Map(snaps[0].items.map((x) => [x.id, x]));
  for (const s of snaps.slice(1)) {
    const cur = new Map(s.items.map((x) => [x.id, x]));
    for (const [id, it] of cur) {
      const p = prev.get(id);
      if (!p) continue;
      for (const f of FIELDS) {
        if ((p[f] ?? null) !== (it[f] ?? null)) {
          if (!changes.has(id)) changes.set(id, []);
          changes.get(id).push({ day: s.day, field: f, from: p[f] ?? null, to: it[f] ?? null });
        }
      }
    }
    prev = cur;
  }
  const flips = [...changes].filter(([, c]) => c.length >= FLIP_MIN_CHANGES);
  if (!flips.length) return [];
  return [{
    severity: "med", pipeline: "exhibition", code: "flip-flop",
    title: `既存展示の会期・会場が直近${FLIP_WINDOW_DAYS}日で繰り返し書き換わっている（${flips.length}件）`,
    detail: `同一idの startDate/endDate/venue が${FLIP_MIN_CHANGES}回以上変わっています（会期更新ロジックのフリップフロップの兆候）: ${flips.slice(0, 3).map(([id, c]) => `${id}(${c.length}回)`).join(", ")}`,
    evidence: { file: "data/exhibition.json (git log)", items: flips.slice(0, 5).map(([id, c]) => ({ id, changes: c.slice(0, 6) })) },
  }];
}

// ───────── チェック5: 設定の鮮度 ─────────
function checkConfig({ root, logDir, today }) {
  const findings = [];
  const tuneText = readText(path.join(logDir, "researchman-tuneup.log"));
  const runs = parseRuns(tuneText);
  let lastSuccess = null;
  let source = "";
  if (runs.length) {
    for (const r of runs) if (r.day && /✅ 完了/.test(r.text) && !/チューンアップエラー終了/.test(r.text)) if (!lastSuccess || r.day > lastSuccess) lastSuccess = r.day;
    source = "~/.researchman/logs/researchman-tuneup.log";
  } else {
    try {
      const iso = gitOut(root, ["log", "-1", "--format=%cI", "--", "data/research-tuning.json"]).trim();
      if (iso) { lastSuccess = isoToDay(iso); source = "git log data/research-tuning.json"; }
    } catch { /* gitなし */ }
  }
  if (lastSuccess) {
    const age = dayDiff(today, lastSuccess);
    if (age > TUNEUP_STALE_DAYS) {
      const recentFails = runs.filter((r) => r.day && r.day > lastSuccess && /チューンアップエラー終了/.test(r.text));
      const lastErr = (recentFails.at(-1)?.text.split("\n").find((l) => /失敗|エラー/.test(l) && !/終了/.test(l)) || "").slice(0, 160);
      findings.push({
        severity: "high", pipeline: "config", code: "tuneup-stale",
        title: `週次チューンアップの最終成功が${age}日前（${lastSuccess}）`,
        detail: `${TUNEUP_STALE_DAYS}日超成功していません。${recentFails.length ? `その後の失敗${recentFails.length}回が連続しています（直近の失敗: ${lastErr || "理由不明"}）。` : ""}設定（探索角度・基準）が陳腐化します。`,
        evidence: { lastSuccess, ageDays: age, consecutiveFailures: recentFails.length, source },
      });
    }
  } else if (runs.length) {
    findings.push({
      severity: "high", pipeline: "config", code: "tuneup-stale",
      title: "週次チューンアップの成功記録が1度もない",
      detail: `ログに${runs.length}回の実行がありますが成功マーカー（✅ 完了）がありません。`,
      evidence: { runs: runs.length, source },
    });
  }
  // sources.json
  const srcRaw = readJson(path.join(root, "data/sources.json"), null);
  const srcs = Array.isArray(srcRaw) ? srcRaw : Array.isArray(srcRaw?.sources) ? srcRaw.sources : null;
  if (srcs && srcs.filter((s) => s.enabled).length === 0) {
    findings.push({
      severity: "high", pipeline: "config", code: "sources-all-disabled",
      title: `data/sources.json の有効な情報源が0件（全${srcs.length}件が enabled:false）`,
      detail: "情報源レジストリが全件無効のため、発見フェーズが候補を出せません（Case Study の激減原因になる）。",
      evidence: { file: "data/sources.json", enabled: 0, total: srcs.length },
    });
  }
  return findings;
}

// ───────── チェック6: 振り分けの異常（low） ─────────
const DATE_RANGE = /(\d{4}[年/.\-]\s?\d{1,2}[月/.\-]\s?\d{1,2}日?|\d{1,2}月\d{1,2}日)\s*[〜~～–—\-]\s*(\d{4}[年/.\-])?\s?(\d{1,2}[月/.\-])?\s?\d{1,2}日?/;
const NEITHER_REASON = /どれでもない|事例\/技術情報を確認できません|事例情報を確認できません|事例・技術のどちらでも/;
function checkMisclassification({ root, today, ccByDay }) {
  const findings = [];
  const from = dayAdd(today, -MISCLASS_WINDOW_DAYS);
  const suspicious = [];
  for (const [d, arr] of ccByDay) {
    if (d < from || !Array.isArray(arr)) continue;
    for (const it of arr) if (/展/.test(it.title) && DATE_RANGE.test(it.overview || "")) suspicious.push({ id: it.id, title: it.title, day: d });
  }
  if (suspicious.length) {
    findings.push({
      severity: "low", pipeline: "cc", code: "exhibition-like-case",
      title: `Case Study に展覧会らしきエントリが${suspicious.length}件（直近${MISCLASS_WINDOW_DAYS}日の追加）`,
      detail: `タイトルに「展」を含み、概要に会期らしき日付範囲があります。Exhibition に振り分けるべき誤分類の可能性: ${suspicious.slice(0, 5).map((s) => `「${s.title}」`).join(" ")}`,
      evidence: { file: "data/cases.json", items: suspicious.slice(0, 8) },
    });
  }
  // studio add-case ジョブ
  const dir = path.join(root, "studio/workdir/jobs");
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { /* 無し */ }
  let total = 0, neither = 0;
  for (const f of files) {
    const j = readJson(path.join(dir, f), null);
    if (!j || j.tab !== "add-case") continue;
    const d = isoToDay(j.at);
    if (!d || d < from || d > today) continue;
    total++;
    if (j.status === "error" && NEITHER_REASON.test(String(j.error || ""))) neither++;
  }
  if (total >= NEITHER_MIN_JOBS && neither / total > NEITHER_RATE) {
    findings.push({
      severity: "low", pipeline: "studio", code: "neither-error-rate",
      title: `add-case ジョブの${Math.round((neither / total) * 100)}%が「どれでもない」系エラー（${neither}/${total}件）`,
      detail: "振り分け（case/tech/neither）の判定基準が厳しすぎる／ジャンル（ゲームアート等）を取りこぼしている可能性があります。",
      evidence: { dir: "studio/workdir/jobs", windowDays: MISCLASS_WINDOW_DAYS, neither, total },
    });
  }
  return findings;
}

// ───────── AIレビュー（週1・--llm） ─────────
const LLM_MARKER = '"findings"';
function tailChars(s, n) { return s.length > n ? s.slice(s.length - n) : s; }
export function buildLlmPrompt({ findings, logDir, root }) {
  const head = `あなたは自動リサーチ基盤（ResearchMan: Case Study/Technology/Exhibition を毎日自動収集）の運用監査役です。
下の「機械チェック結果」と「各ログの直近抜粋」だけを根拠に、リサーチの仕組みの異常（基準の形骸化・偏り・取りこぼし・誤分類・設定の陳腐化）を指摘してください。
機械チェックが既に挙げた項目の言い換えは不要。確実な根拠が無い推測は書かない。異常が無ければ findings は空配列。
出力は次のJSONオブジェクトのみ（前置き不要）:
{"findings":[{"severity":"high|med|low","title":"短い見出し","detail":"何がおかしいか・なぜか・どう直すか","evidence":"根拠（ファイル名と数値）"}]}

## 機械チェック結果
${JSON.stringify(findings.map(({ severity, pipeline, code, title, evidence }) => ({ severity, pipeline, code, title, evidence })), null, 1)}
`;
  const parts = [
    ["researchman-auto.log", tailChars(readText(path.join(logDir, "researchman-auto.log")), 4500)],
    ["researchman-tech.log", tailChars(readText(path.join(logDir, "researchman-tech.log")), 3500)],
    ["researchman-exhibition.log", tailChars(readText(path.join(logDir, "researchman-exhibition.log")), 3500)],
    ["researchman-tuneup.log", tailChars(readText(path.join(logDir, "researchman-tuneup.log")), 2500)],
    ["logs/rejections (latest month)", (() => {
      const dir = path.join(root, "logs");
      try {
        const f = fs.readdirSync(dir).filter((x) => /^rejections-.*\.jsonl$/.test(x)).sort().at(-1);
        return f ? tailChars(readText(path.join(dir, f)), 2500) : "";
      } catch { return ""; }
    })()],
  ];
  let body = "\n## 各ログの直近抜粋\n";
  for (const [name, txt] of parts) body += `\n### ${name}\n${txt}\n`;
  return (head + body).slice(0, LLM_INPUT_MAX_CHARS + 3000).slice(0, Math.max(head.length, LLM_INPUT_MAX_CHARS));
}
async function defaultRunLlm(prompt) {
  const { resolveClaudeBin, runClaudeJson } = await import("./claude-cli.mjs");
  return runClaudeJson(resolveClaudeBin(), prompt, {
    timeout: 5 * 60 * 1000, marker: LLM_MARKER, model: "sonnet", allowedTools: "",
    extraDisallowedTools: "Bash,WebSearch,WebFetch,Read,Grep,Glob,Task,TodoWrite",
  });
}
async function aiReview({ findings, logDir, root, runLlm }) {
  try {
    const prompt = buildLlmPrompt({ findings, logDir, root });
    const res = await runLlm(prompt);
    const arr = Array.isArray(res?.findings) ? res.findings : null;
    if (!arr) return { ok: false, error: "AIの応答からfindingsを取り出せませんでした", items: [] };
    return {
      ok: true,
      items: arr.slice(0, 20).map((f) => ({
        severity: SEV_ORDER[f?.severity] !== undefined ? f.severity : "low",
        title: String(f?.title || "").slice(0, 200), detail: String(f?.detail || "").slice(0, 1200),
        evidence: typeof f?.evidence === "string" ? f.evidence.slice(0, 600) : JSON.stringify(f?.evidence ?? "").slice(0, 600),
      })),
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 300), items: [] };
  }
}

// ───────── 出力 ─────────
const evStr = (e) => (typeof e === "string" ? e : JSON.stringify(e));
export function renderMarkdown({ findings, today, ai }) {
  const L = [`# リサーチ健全性レビュー ${today}`, ""];
  if (!findings.length) L.push("機械チェック: 異常なし（追加ペース・発見の空振り・検証の偏り・フリップフロップ・設定の鮮度・振り分け）。", "");
  else {
    L.push(`機械チェック: ${findings.length}件（高${findings.filter((f) => f.severity === "high").length} / 中${findings.filter((f) => f.severity === "med").length} / 低${findings.filter((f) => f.severity === "low").length}）`, "");
    for (const f of findings) {
      L.push(`## [${SEV_LABEL[f.severity]}] ${f.title}`, `- 区分: ${f.pipeline} / ${f.code}`, `- 内容: ${f.detail}`, `- 根拠: \`${evStr(f.evidence)}\``, "");
    }
  }
  if (ai) {
    L.push("## AIレビュー", "");
    if (!ai.ok) L.push(`AIレビューは失敗しました（機械チェックの結果は上記のとおり）: ${ai.error}`, "");
    else if (!ai.items.length) L.push("AIが追加で指摘した異常はありません。", "");
    else for (const f of ai.items) L.push(`### [${SEV_LABEL[f.severity]}] ${f.title}`, `- 内容: ${f.detail}`, `- 根拠: ${f.evidence}`, "");
  }
  return L.join("\n");
}

function appendAlerts({ root, findings, now, today }) {
  const file = path.join(root, "logs/system-alerts.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = new Set();
  for (const line of readText(file).split(/\r?\n/)) {
    try {
      const o = JSON.parse(line);
      if (o.source === "research-health" && isoToDay(o.at) === today) existing.add(o.title);
    } catch { /* skip */ }
  }
  const lines = findings
    .filter((f) => (f.severity === "high" || f.severity === "med") && !existing.has(f.title))
    .map((f) => JSON.stringify({ at: now.toISOString(), source: "research-health", level: f.severity, title: f.title, body: `${f.detail}\n根拠: ${evStr(f.evidence)}` }));
  if (lines.length) fs.appendFileSync(file, lines.join("\n") + "\n");
  return lines.length;
}

/**
 * @param {{root:string, now?:Date, logDir?:string, llm?:boolean, runLlm?:(prompt:string)=>any, dryRun?:boolean}} o
 * @returns {Promise<{findings:Array, markdown:string, written:{alerts:number, markdown:string|null}}>}
 */
export async function runResearchHealthReview({ root, now = new Date(), logDir = path.join(os.homedir(), ".researchman", "logs"), llm = false, runLlm = defaultRunLlm, dryRun = false } = {}) {
  const today = jstDay(now);
  const findings = [];
  const guard = (name, fn) => {
    try { findings.push(...fn()); } catch (e) {
      findings.push({ severity: "low", pipeline: "research-health", code: "check-error", title: `点検「${name}」自体が失敗`, detail: String(e?.message || e).slice(0, 300), evidence: { check: name } });
    }
  };

  const since = dayAdd(today, -(RECENT_DAYS - 1 + BASELINE_DAYS) - 1);
  const adds = { cc: new Map(), tech: new Map(), exhibition: new Map() };
  guard("追加履歴(cases)", () => { adds.cc = addsFromGit(root, "data/cases.json", since); return []; });
  guard("追加履歴(tech)", () => { adds.tech = addsFromGit(root, "data/tech.json", since); return []; });
  guard("追加履歴(exhibition)", () => {
    for (const it of itemsOf(readJson(path.join(root, "data/exhibition.json"), {}))) {
      const d = isoToDay(it.addedAt);
      if (d) adds.exhibition.set(d, (adds.exhibition.get(d) || 0) + 1);
    }
    return [];
  });
  const labels = { cc: "Case Study", tech: "Technology", exhibition: "Exhibition" };
  for (const p of PIPELINES) guard(`追加ペース(${p})`, () => checkPace({ pipeline: p, label: labels[p], byDay: adds[p], today }));
  for (const p of PIPELINES) guard(`発見の空振り(${p})`, () => checkDiscovery({ pipeline: p, label: labels[p], runs: parseRuns(readText(path.join(logDir, LOG_FILES[p]))), today }));
  guard("検証段階の偏り", () => checkVerification({ events: loadEvents(root, today), today }));
  guard("フリップフロップ", () => checkFlipFlop({ root, today }));
  guard("設定の鮮度", () => checkConfig({ root, logDir, today }));
  guard("振り分けの異常", () => checkMisclassification({ root, today, ccByDay: adds.cc }));

  findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const ai = llm ? await aiReview({ findings, logDir, root, runLlm }) : null;
  const markdown = renderMarkdown({ findings, today, ai });
  const written = { alerts: 0, markdown: null };
  if (!dryRun) {
    const mdPath = path.join(root, "logs/research-health-latest.md");
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, markdown);
    written.markdown = mdPath;
    written.alerts = appendAlerts({ root, findings, now, today });
  }
  return { findings, markdown, written };
}
