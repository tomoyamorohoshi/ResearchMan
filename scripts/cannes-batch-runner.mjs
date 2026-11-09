/**
 * Cannes 受賞作品の事例化を無人で連続実行するランナー。
 *
 * 使い方: node scripts/cannes-batch-runner.mjs <year> [--batch-size 35] [--parallel 7] [--max-batches N] [--dry-run]
 *
 * 1バッチ = batch-size 件を5件ずつのグループに分け、グループごとに独立した `claude -p`（sonnet）で
 * drafts を作らせる（WebSearch 上限がプロセスごとになる）→ 回収・検証・作業メモ除去 → 結合 →
 * `cannes-ingest.mjs <year> --drafts <merged>`（git ロック・監査・commit は ingest 側）。
 * ingest が exit≠0 なら以降のバッチを止めて exit 1。
 * state: data/cannes/work/<year>-runner-state.json（git 非追跡）。ログ: ~/.researchman/logs/cannes-runner.log
 * 子 claude は WebSearch,WebFetch のみ（Bash/Read/Glob/Grep/Write/Edit 禁止）。works・手本・語彙はプロンプト本文に埋め込み、
 * 結果は stdout の JSON オブジェクト（マーカー "cannesDrafts"）で回収する。
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { resolveClaudeBin, buildClaudeArgs, extractFirstParsableJson } from "./lib/claude-cli.mjs";
import { findDuplicate } from "./cannes-ingest.mjs";
import { makeMatcher } from "./cannes-reconcile.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MAX_ATTEMPTS = 2;
const GROUP_SIZE = 5;
const TIMEOUT_MS = 15 * 60 * 1000;
/** og:image が汎用ロゴしか返さないため、サムネ候補から除外するドメイン */
export const BLOCKED_THUMB_DOMAINS = ["vml.com", "dandad.org", "grey.com"];
const REQ_STR = ["summary", "overview", "background", "execution", "evaluationImpact", "link"];
const REQ_ARR = ["regions", "tags"];

export const emptyState = () => ({ attempts: {}, skipped: [], done: [], batchSeq: 0 });

function normState(s) {
  const e = emptyState();
  return { ...e, ...(s || {}), attempts: { ...(s?.attempts || {}) }, skipped: [...(s?.skipped || [])], done: [...(s?.done || [])], excludedReasons: { ...(s?.excludedReasons || {}) } };
}

/** ingest と同じ重複判定（同年 cannes awardEntries を持つ事例と title 正規化一致 or 正規化 id 一致） */
export function isAlreadyIngested(work, cases, year) {
  const { flat } = makeMatcher(year);
  return !!findDuplicate(cases, year, work, flat);
}

/** 対象選定: skip/done/試行上限・既存事例（ingest の findDuplicate と同規則）を除き、先頭 entry の部門の残件数が少ない順（同数は初出順、部門内は元順） */
export function selectTargets(works, state, { existingCases = [], year } = {}) {
  const st = normState(state);
  const skip = new Set(st.skipped), done = new Set(st.done);
  const cand = works.filter((w) => {
    if (skip.has(w.key) || done.has(w.key)) return false;
    if ((st.attempts[w.key] || 0) >= MAX_ATTEMPTS) return false;
    if (year && existingCases.length && isAlreadyIngested(w, existingCases, year)) return false;
    return true;
  });
  const cat = (w) => w.entries?.[0]?.category ?? "";
  const count = new Map(), order = new Map();
  for (const w of cand) {
    count.set(cat(w), (count.get(cat(w)) || 0) + 1);
    if (!order.has(cat(w))) order.set(cat(w), order.size);
  }
  return cand
    .map((w, i) => ({ w, i }))
    .sort((a, b) => count.get(cat(a.w)) - count.get(cat(b.w)) || order.get(cat(a.w)) - order.get(cat(b.w)) || a.i - b.i)
    .map((x) => x.w);
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** 本文の作業メモ文（「成果数値は…記載しない」等）を除去 */
export function stripWorkNotes(text) {
  return String(text).replace(/[^。]*(成果数値|数値)[^。]*(記載しない|書かない|載せない|不採用)[^。]*。/g, "").replace(/[^。]*のため本文には載せない[^。]*。?/g, "");
}

function stripDeep(v) {
  if (typeof v === "string") return stripWorkNotes(v).trim();
  if (Array.isArray(v)) return v.map(stripDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripDeep(x)]));
  return v;
}

function draftProblem(d) {
  if (!d || typeof d !== "object") return "draft がオブジェクトでない";
  for (const k of REQ_STR) if (typeof d[k] !== "string" || !d[k].trim()) return `draft.${k} が空`;
  for (const k of REQ_ARR) if (!Array.isArray(d[k]) || d[k].length === 0) return `draft.${k} が空`;
  return null;
}

/** サムネ候補 URL から除外ドメイン（サブドメイン含む）を落とす */
export function filterThumbUrls(urls, blocked = BLOCKED_THUMB_DOMAINS) {
  if (!Array.isArray(urls)) return [];
  return urls.filter((u) => {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return !blocked.some((d) => h === d || h.endsWith("." + d));
    } catch { return false; }
  });
}

/** drafts 検証: works に無い key・必須欠落・重複 key を捨て、本文から作業メモを除去 */
export function validateDrafts(raw, workKeys) {
  const valid = [], dropped = [], seen = new Set();
  if (!Array.isArray(raw)) return { valid, dropped: [{ key: undefined, reason: "drafts が配列でない" }] };
  for (const item of raw) {
    const key = item?.key;
    if (typeof key !== "string") { dropped.push({ key: undefined, reason: "key なし" }); continue; }
    if (!workKeys.has(key)) { dropped.push({ key, reason: "works に無い key" }); continue; }
    if (seen.has(key)) { dropped.push({ key, reason: "重複 key" }); continue; }
    const draft = stripDeep(item.draft);
    const prob = draftProblem(draft);
    if (prob) { dropped.push({ key, reason: prob }); continue; }
    seen.add(key);
    valid.push({ ...item, draft, thumbnailCandidates: filterThumbUrls(item.thumbnailCandidates), pageUrls: filterThumbUrls(item.pageUrls) });
  }
  return { valid, dropped };
}

/** state 更新（非破壊）: 成功 key は done、失敗 key は attempts+1（上限で skipped） */
export function updateState(state, { attemptedKeys, okKeys, excludedKeys = [], excludedReasons = {} }) {
  const s = normState(state);
  const ok = new Set(okKeys);
  const excl = new Set(excludedKeys);
  for (const k of excl) {
    if (!s.skipped.includes(k)) s.skipped.push(k);
    if (excludedReasons[k] != null) s.excludedReasons[k] = String(excludedReasons[k]);
  }
  for (const k of attemptedKeys) {
    if (excl.has(k)) continue;
    if (ok.has(k)) { if (!s.done.includes(k)) s.done.push(k); continue; }
    s.attempts[k] = (s.attempts[k] || 0) + 1;
    if (s.attempts[k] >= MAX_ATTEMPTS && !s.skipped.includes(k)) s.skipped.push(k);
  }
  return s;
}

export const DRAFTS_MARKER = "cannesDrafts";

/** cases から tags（出現回数上位 maxTags）と regions（全件）の語彙を集計 */
export function buildVocab(cases, maxTags = 300) {
  const tc = new Map(), rc = new Map();
  for (const c of cases || []) {
    for (const t of c?.tags || []) tc.set(t, (tc.get(t) || 0) + 1);
    for (const r of c?.regions || []) rc.set(r, (rc.get(r) || 0) + 1);
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n).map((x) => x[0]);
  return { tags: top(tc, maxTags), regions: top(rc, Infinity) };
}

export function buildPrompt(brief, { year, works, examples, vocab }) {
  const body = brief.replaceAll("{{YEAR}}", String(year));
  return `${body}

## 今回の担当作品（works。この key だけを扱う）
\`\`\`json
${JSON.stringify(works, null, 2)}
\`\`\`

## 手本（既存の本番エントリ。文体・長さ・tags の付け方をこれに揃える）
\`\`\`json
${JSON.stringify(examples ?? [], null, 2)}
\`\`\`

## tags の語彙（この中から選ぶ。新語は作らない）
${JSON.stringify(vocab?.tags ?? [])}

## regions の語彙（この中から選ぶ）
${JSON.stringify(vocab?.regions ?? [])}

## 最終出力の形式（厳守）
調査が終わったら、返答の最後に次の形の JSON オブジェクトを1つだけ、\`\`\`json フェンスで出力する（キー "${DRAFTS_MARKER}" が必須。これ以外の { } を最後のブロックの後に出さない）。
{"${DRAFTS_MARKER}": [{"key": "<works の key>", "draft": {...}, "thumbnailCandidates": [...], "pageUrls": [...]}], "excluded": [{"key": "<works の key>", "reason": "<理由と出典URL>"}]}
`;
}

/** stdout から drafts と excluded を回収する（マーカー付き JSON オブジェクト）。見つからなければ null */
export function extractDrafts(output) {
  const { value } = extractFirstParsableJson(String(output || ""), { marker: `"${DRAFTS_MARKER}"`, openCh: "{", closeCh: "}" });
  if (!value || !Array.isArray(value[DRAFTS_MARKER])) return null;
  return { drafts: value[DRAFTS_MARKER], excluded: Array.isArray(value.excluded) ? value.excluded : [] };
}

/** 実 claude を非同期に起動する（runClaude は spawnSync で並列にできないため。引数・環境は buildClaudeArgs / runClaude と同じ方針）。resolve は stdout 全文、reject の Error には回収済み stdout を e.stdout で付ける。
 *  タイムアウト時は自分が spawn した子の PID だけをツリーごと止める（win32: taskkill /PID <pid> /T /F）。reject は子の close 後。 */
export function makeClaudeGroupRunner({ claudeBin = resolveClaudeBin(), timeout = TIMEOUT_MS, args = buildClaudeArgs({ model: "sonnet", allowedTools: "WebSearch,WebFetch", extraDisallowedTools: "Bash,Read,Glob,Grep" }) } = {}) {
  return ({ prompt, cwd }) =>
    new Promise((resolve, reject) => {
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
      const child = spawn(claudeBin, args, { stdio: ["pipe", "pipe", "pipe"], env, windowsHide: true, cwd });
      let out = "", err = "", timedOut = false;
      const fail = (msg) => Object.assign(new Error(msg), { stdout: out });
      const timer = setTimeout(() => {
        timedOut = true;
        if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
        else child.kill();
      }, timeout);
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
      child.on("error", (e) => { clearTimeout(timer); reject(Object.assign(e, { stdout: out })); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) reject(fail(`タイムアウト ${timeout / 1000}s`));
        else code === 0 ? resolve(out) : reject(fail(`claude 終了コード ${code}: ${(err + out.slice(-300)).slice(-300)}`));
      });
      child.stdin.on("error", () => {});
      child.stdin.end(prompt);
    });
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/**
 * 1バッチを実行する。runGroup({prompt, worksFile, draftsFile, groupNo}) と runIngest(mergedFile)→{status} は注入可能。
 * 戻り値: { exitCode, state, stats }。ingest 失敗時は state を更新しない（同じ作品を次回やり直せる）。
 */
export async function runBatch({ year, works, state, batchNo, batchSize = 35, parallel = 7, groupSize = GROUP_SIZE, workRoot, brief, runGroup, runIngest, readCases = () => [], gitStatusCases = () => "", log = () => {} }) {
  const dir = path.join(workRoot, String(year), String(batchNo));
  fs.mkdirSync(dir, { recursive: true });
  const exFile = path.join(ROOT, "docs", "cannes", "DRAFT_EXAMPLES.json");
  const examples = fs.existsSync(exFile) ? readJson(exFile, []) : [];
  const vocab = buildVocab(readCases());
  const target = works.slice(0, batchSize);
  const groups = chunk(target, groupSize);
  const started = Date.now();
  log(`バッチ${batchNo} 開始: ${target.length}件 / ${groups.length}グループ / parallel=${parallel}`);

  const statusBefore = gitStatusCases();
  const results = await pool(groups, parallel, async (g, i) => {
    const outFile = path.join(dir, `g${i + 1}.out.txt`);
    const prompt = buildPrompt(brief, { year, works: g, examples, vocab });
    let error = null, procError = null, out = "";
    try { out = (await runGroup({ prompt, groupNo: i + 1, cwd: dir })) ?? ""; } catch (e) { error = procError = e.message; out = e.stdout ?? ""; }
    try { fs.writeFileSync(outFile, String(out)); } catch { /* デバッグ用 */ }
    let valid = [], dropped = [];
    const excluded = {};
    const got = extractDrafts(out);
    if (got) {
      ({ valid, dropped } = validateDrafts(got.drafts, new Set(g.map((w) => w.key))));
      const mine = new Set(g.map((w) => w.key)), validKeys = new Set(valid.map((v) => v.key));
      for (const x of got.excluded) {
        const k = x?.key;
        if (typeof k === "string" && k && mine.has(k) && !validKeys.has(k)) excluded[k] = String(x.reason ?? "");
      }
      if (got.excluded.length) log(`  グループ${i + 1} 除外申告: ${got.excluded.map((x) => `${x?.key}:${x?.reason}`).join("; ")}`);
    } else error = error || "stdout に drafts JSON なし";
    const procFailed = !!procError && !got;
    log(`  グループ${i + 1}: 担当${g.length} 採用${valid.length} 除外${dropped.length}${procFailed ? " [プロセス失敗]" : ""}${error ? ` エラー=${error}` : ""}${dropped.length ? ` (${dropped.map((d) => `${d.key}:${d.reason}`).join("; ")})` : ""}`);
    return { g, valid, procFailed, excluded };
  });
  const statusAfter = gitStatusCases();
  if (statusAfter !== statusBefore) log(`  警告: 子 claude 実行中に data/cases.json が変化した (${JSON.stringify(statusAfter)})`);


  const merged = results.flatMap((r) => r.valid);
  const okGroups = results.filter((r) => !r.procFailed);
  // プロセス失敗（drafts なし）のグループは attempts を進めない
  const attemptedKeys = okGroups.flatMap((r) => r.g.map((w) => w.key));
  const excludedReasons = Object.assign({}, ...okGroups.map((r) => r.excluded));
  const excludedKeys = Object.keys(excludedReasons);
  if (excludedKeys.length) log(`  除外申告 ${excludedKeys.length}件 → skipped`);
  let exitCode = 0, newState = state;
  if (!okGroups.length) {
    log("  全グループが claude プロセス失敗（使用量上限・ログアウト等の疑い）のため停止");
    exitCode = 1;
  } else if (merged.length) {
    const mergedFile = path.join(dir, "merged-drafts.json");
    fs.writeFileSync(mergedFile, JSON.stringify(merged, null, 2));
    const r = await runIngest(mergedFile);
    log(`  ingest: exit=${r.status}`);
    if (r.status !== 0) exitCode = 1;
    else {
      // 実際に cases.json に入った key だけ done（ingest と同じ重複判定）
      const cases = readCases();
      const byKey = new Map(target.map((w) => [w.key, w]));
      const okKeys = merged.map((m) => m.key).filter((k) => isAlreadyIngested(byKey.get(k), cases, year));
      log(`  cases.json 反映確認: ${okKeys.length}/${merged.length}`);
      newState = updateState(state, { attemptedKeys, okKeys, excludedKeys, excludedReasons });
    }
  } else {
    log("  採用0件のため ingest なし");
    newState = updateState(state, { attemptedKeys, okKeys: [], excludedKeys, excludedReasons });
  }
  log(`バッチ${batchNo} 終了: 採用${merged.length}/${target.length} 所要${Math.round((Date.now() - started) / 1000)}s exit=${exitCode}`);
  return { exitCode, state: newState, stats: { attempted: target.length, adopted: merged.length, procFailed: results.length - okGroups.length } };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

export function parseArgs(argv) {
  const o = { year: undefined, batchSize: 35, parallel: 7, maxBatches: Infinity, dryRun: argv.includes("--dry-run") };
  const valued = new Set(["--batch-size", "--parallel", "--max-batches"]);
  for (let i = 0; i < argv.length; i++) {
    if (valued.has(argv[i])) { i++; continue; }
    if (argv[i].startsWith("--")) continue;
    if (/^\d{4}$/.test(argv[i])) o.year = argv[i]; // 位置引数の先頭だけ
    break;
  }
  const num = (f) => { const i = argv.indexOf(f); return i >= 0 ? Number(argv[i + 1]) : undefined; };
  o.batchSize = num("--batch-size") ?? o.batchSize;
  o.parallel = num("--parallel") ?? o.parallel;
  o.maxBatches = num("--max-batches") ?? o.maxBatches;
  return o;
}

const caseList = (c) => (Array.isArray(c) ? c : c?.cases || []);

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.year || !(o.batchSize > 0) || !(o.parallel > 0) || !(o.maxBatches > 0)) {
    console.error("usage: node scripts/cannes-batch-runner.mjs <year> [--batch-size 35] [--parallel 7] [--max-batches N] [--dry-run]");
    process.exit(2);
  }
  const year = Number(o.year);
  const planFile = path.join(ROOT, "data", "cannes", "work", `${year}-plan.json`);
  const stateFile = path.join(ROOT, "data", "cannes", "work", `${year}-runner-state.json`);
  const casesFile = path.join(ROOT, "data", "cases.json");
  const logFile = path.join(os.homedir(), ".researchman", "logs", "cannes-runner.log");
  const plan = readJson(planFile, null);
  if (!plan || !Array.isArray(plan.new)) { console.error(`plan が読めない: ${planFile}`); process.exit(2); }
  const loadCases = () => caseList(readJson(casesFile, []));
  let existingCases = loadCases();

  const log = (m) => {
    const line = `${new Date().toISOString()} [${year}] ${m}`;
    console.log(line);
    if (!o.dryRun) { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.appendFileSync(logFile, line + "\n"); }
  };

  let state = normState(readJson(stateFile, null));

  if (o.dryRun) {
    const sel = selectTargets(plan.new, state, { existingCases, year });
    const noCases = selectTargets(plan.new, state, { year }).length;
    console.log(`[dry-run ${year}] plan.new=${plan.new.length} 対象=${sel.length} (skip=${state.skipped.length} done=${state.done.length} 取り込み済みで除外=${noCases - sel.length} ※attempts上限は skip に含む)`);
    const batch = sel.slice(0, o.batchSize);
    chunk(batch, GROUP_SIZE).forEach((g, i) => console.log(`  グループ${i + 1}: ${g.map((w) => `${w.key}[${w.entries?.[0]?.category}]`).join(", ")}`));
    console.log(`  バッチ数見込み=${Math.ceil(sel.length / o.batchSize)}`);
    if (batch.length) {
      const briefD = fs.readFileSync(path.join(ROOT, "docs", "cannes", "DRAFT_BRIEF.md"), "utf8");
      const exD = readJson(path.join(ROOT, "docs", "cannes", "DRAFT_EXAMPLES.json"), []);
      const pr = buildPrompt(briefD, { year, works: chunk(batch, GROUP_SIZE)[0], examples: exD, vocab: buildVocab(existingCases) });
      console.log(`  プロンプト長(グループ1・stdin渡し)=${pr.length}文字`);
    }
    return;
  }

  const brief = fs.readFileSync(path.join(ROOT, "docs", "cannes", "DRAFT_BRIEF.md"), "utf8");
  const head = () => spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const runGroup = makeClaudeGroupRunner();
  const runIngest = (mergedFile) => spawnSync(process.execPath, [path.join(__dirname, "cannes-ingest.mjs"), String(year), "--drafts", mergedFile], { cwd: ROOT, stdio: "inherit" });
  const gitStatusCases = () => spawnSync("git", ["status", "--porcelain", "data/cases.json"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  let code = 0;
  for (let n = 0; n < o.maxBatches; n++) {
    const works = selectTargets(plan.new, state, { existingCases, year });
    if (!works.length) { log("対象が尽きた"); break; }
    state.batchSeq = (state.batchSeq || 0) + 1;
    const before = head();
    const r = await runBatch({ year, works, state, batchNo: state.batchSeq, batchSize: o.batchSize, parallel: o.parallel, workRoot: path.join(os.homedir(), ".researchman", "cannes-runner"), brief, runGroup, runIngest, readCases: loadCases, gitStatusCases, log });
    state = r.state;
    state.batchSeq = Math.max(state.batchSeq || 0, 0);
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    const after = head();
    if (after !== before) {
      const l = spawnSync("git", ["log", "--oneline", `${before}..${after}`], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
      log(`  追加 commit: ${l.replace(/\n/g, " / ")}`);
    }
    existingCases = loadCases();
    if (r.exitCode !== 0) { log("ingest 失敗またはプロセス全失敗のため停止"); code = 1; break; }
  }
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
