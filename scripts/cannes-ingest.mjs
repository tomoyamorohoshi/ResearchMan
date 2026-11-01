/**
 * Cannes 受賞作品の cases.json 取り込み（合成）スクリプト。
 * 上流（Web 収集・本文執筆＝case-writer）が作った drafts を受け取り、cases.json へ安全に追記・監査・commit する。
 *
 * 使い方: node scripts/cannes-ingest.mjs <year> --drafts <file.json> [--dry-run]
 *   push はしない（毎時ジョブと pre-push 監査に任せる）。
 *
 * drafts.json の形（配列。1要素 = 1作品）:
 *   {
 *     "key": "onesecondads|budweiser",      // data/cannes/work/<year>-plan.json の new[].key
 *     "draft": { ... },                       // case-writer の cases.json エントリ断片。
 *                                             //   必須: summary overview background execution evaluationImpact link（文字列）,
 *                                             //         regions tags（非空配列）
 *                                             //   任意: title client agency videoId（無ければ plan の title/brand/agency、videoId は ""）
 *                                             //   無視: id（plan の brand/title から作り直す）, award, awardEntries, categories, sources, year, thumbnail
 *     "thumbnailCandidates": ["https://..."], // 画像 URL（saveThumbnail を順に試す。空可）
 *     "pageUrls": ["https://..."]             // ページ URL（全候補が失敗したら saveThumbnailFromPage を順に試す。空可）
 *   }
 * 処理: 作品ごとに検証→id 正規化（"ブランド-作品名" スラッグ、衝突は -<year>）→サムネ保存。失敗作品はスキップして続行。
 * その後 gitロック(label "cannes-ingest")を取り、cases.json 再読込→追記(tmp→rename)→3監査→全通過で
 * パス指定 git add/commit。監査/commit 失敗時は cases.json とサムネを元に戻し exit 1。ロック不可なら何も書かず exit 1。
 * --dry-run: 何も書かず、正規化後 id・awardEntries・スキップ理由を表示。
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { formatCannesAward } from "./lib/cannes-categories.mjs";
import { makeMatcher } from "./cannes-reconcile.mjs";
import { tryAcquire, releaseOwnedLock, DEFAULT_LOCK_PATH } from "./lib/git-lock.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

export function slugifyId(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "ブランド名-作品名"。作品名が既にブランド名で始まるなら重ねない。 */
export function makeCaseId(brand, title) {
  const b = slugifyId(brand);
  const t = slugifyId(title);
  if (!b) return t;
  if (!t) return b;
  return t === b || t.startsWith(`${b}-`) ? t : `${b}-${t}`;
}

const REQ_STR = ["summary", "overview", "background", "execution", "evaluationImpact", "link"];
const REQ_ARR = ["regions", "tags"];

function validateDraft(d) {
  if (!d || typeof d !== "object") return "draft がオブジェクトでない";
  for (const k of REQ_STR) if (typeof d[k] !== "string" || !d[k].trim()) return `draft.${k} が空`;
  for (const k of REQ_ARR) if (!Array.isArray(d[k]) || d[k].length === 0) return `draft.${k} が空`;
  return null;
}

function sortedCategories(entries) {
  return [...new Set(entries.map((e) => e.category))].sort();
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function findDuplicate(cases, year, work, flat) {
  const f = flat(work.title);
  return cases.find((c) => {
    const has = Array.isArray(c.awardEntries) && c.awardEntries.some((e) => e.org === "cannes" && Number(e.year) === Number(year));
    return has && f && flat(c.title) === f;
  });
}

function pickId(cases, usedIds, base, year) {
  for (const id of [base, `${base}-${year}`]) if (id && !usedIds.has(id) && !cases.some((c) => c.id === id)) return id;
  return null;
}

function buildEntry({ year, id, draft, work, thumbnail }) {
  const entries = work.entries;
  return {
    year: String(year),
    relatedWorks: [],
    sources: [`Cannes ${year}`],
    id,
    title: draft.title || work.title,
    summary: draft.summary,
    client: draft.client || work.brand,
    agency: draft.agency || work.agency,
    categories: sortedCategories(entries),
    award: entries.map((e) => formatCannesAward(e)).join(" / "),
    awardEntries: entries,
    regions: draft.regions,
    link: draft.link,
    videoId: draft.videoId ?? "",
    overview: draft.overview,
    background: draft.background,
    execution: draft.execution,
    evaluationImpact: draft.evaluationImpact,
    tags: draft.tags,
    thumbnail,
  };
}

/** 既定の監査実行。1つでも失敗したら ok:false */
export async function defaultRunAudits(root, year) {
  const jobs = [
    ["audit-integrity", ["scripts/audit-integrity.mjs"]],
    ["audit-cannes", ["scripts/audit-cannes.mjs", "--year", String(year)]],
    ["audit-thumbnails", ["scripts/audit-thumbnails.mjs"]],
  ];
  const failed = [];
  for (const [name, args] of jobs) {
    const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
    if (r.status !== 0) {
      failed.push(name);
      console.error(`[cannes-ingest] ${name} FAIL\n${String(r.stdout || "").slice(-1500)}${String(r.stderr || "").slice(-500)}`);
    }
  }
  return { ok: failed.length === 0, failed };
}

/** 既定の git: パス指定 add/commit。失敗時は stage を戻して throw。 */
export async function defaultGitCommit(root, paths, message) {
  const run = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const add = run(["add", "--", ...paths]);
  if (add.status !== 0) throw new Error(`git add 失敗: ${add.stderr}`);
  const c = run(["commit", "-m", message, "--", ...paths]);
  if (c.status !== 0) {
    run(["reset", "-q", "HEAD", "--", ...paths]);
    throw new Error(`git commit 失敗: ${c.stderr || c.stdout}`);
  }
}

export async function ingest(opts) {
  const {
    year, drafts, dryRun = false, root = ROOT,
    casesPath = path.join(root, "data/cases.json"),
    planPath = path.join(root, `data/cannes/work/${year}-plan.json`),
    thumbDir = path.join(root, "public/thumbnails"),
    lockPath = DEFAULT_LOCK_PATH,
    log = console.log,
  } = opts;
  let { saveThumb, saveFromPage } = opts;
  const runAudits = opts.runAudits ?? ((r, y) => defaultRunAudits(r, y));
  const gitCommit = opts.gitCommit ?? ((p, m) => defaultGitCommit(root, p, m));
  const result = { exitCode: 0, added: [], skipped: [], entries: [] };

  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const planByKey = new Map((plan.new || []).map((w) => [w.key, w]));
  const { flat } = makeMatcher(year);
  const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));
  const working = [...cases];
  const usedIds = new Set();
  const newThumbs = []; // 今回新規に作ったサムネファイル（ロールバック用）
  const skip = (key, reason) => { result.skipped.push({ key, reason }); log(`SKIP ${key}: ${reason}`); };
  const cleanThumbs = () => { for (const f of newThumbs) { try { fs.unlinkSync(f); } catch {} } newThumbs.length = 0; };

  if (!dryRun && (!saveThumb || !saveFromPage)) {
    const m = await import("./save-thumbnail.mjs");
    saveThumb ??= m.saveThumbnail;
    saveFromPage ??= m.saveThumbnailFromPage;
  }

  const prepared = [];
  for (const item of drafts) {
    const key = item?.key;
    const work = planByKey.get(key);
    if (!work) { skip(key, "plan.new に key が無い"); continue; }
    const bad = validateDraft(item.draft);
    if (bad) { skip(key, bad); continue; }
    if (findDuplicate(working, year, work, flat)) { skip(key, "既に cases.json に取り込み済み"); continue; }
    const base = makeCaseId(work.brand, work.title);
    const id = pickId(working, usedIds, base, year);
    if (!id) { skip(key, `id 衝突（${base} / ${base}-${year}）`); continue; }
    usedIds.add(id);

    let thumbnail = `/thumbnails/${id}.jpg`;
    if (!dryRun) {
      const file = path.join(thumbDir, `${id}.jpg`);
      const existed = fs.existsSync(file);
      let saved = null;
      for (const u of item.thumbnailCandidates || []) { saved = await saveThumb(id, u).catch(() => null); if (saved) break; }
      if (!saved) for (const u of item.pageUrls || []) { saved = await saveFromPage(id, u).catch(() => null); if (saved) break; }
      if (!saved) { skip(key, "サムネ取得全滅"); continue; }
      if (!existed && fs.existsSync(file)) newThumbs.push(file);
      thumbnail = saved;
    }
    const entry = buildEntry({ year, id, draft: item.draft, work, thumbnail });
    prepared.push({ key, entry, thumbFile: path.join(thumbDir, `${id}.jpg`) });
    working.push(entry);
    result.added.push(id);
    log(`${dryRun ? "DRY " : ""}ADD ${key} -> ${id}\n  award: ${entry.award}\n  awardEntries: ${JSON.stringify(entry.awardEntries)}`);
  }

  if (dryRun || prepared.length === 0) return result;

  if (!tryAcquire(lockPath, "cannes-ingest")) {
    log("gitロックが取れない（日次ジョブ等が保持中）。何も書かずに終了");
    cleanThumbs();
    return { ...result, added: [], exitCode: 1 };
  }
  const originalText = fs.readFileSync(casesPath, "utf8");
  let written = false;
  try {
    const fresh = JSON.parse(originalText);
    const finalEntries = [];
    for (const p of prepared) {
      const work = planByKey.get(p.key);
      const idTaken = fresh.some((c) => c.id === p.entry.id) || finalEntries.some((e) => e.id === p.entry.id);
      if (idTaken || findDuplicate([...fresh, ...finalEntries], year, work, flat)) {
        skip(p.key, "ロック取得後の再読込で id 衝突/重複");
        result.added = result.added.filter((i) => i !== p.entry.id);
        if (newThumbs.includes(p.thumbFile)) { try { fs.unlinkSync(p.thumbFile); } catch {} }
        continue;
      }
      finalEntries.push(p.entry);
    }
    if (finalEntries.length === 0) return result;
    writeAtomic(casesPath, JSON.stringify([...fresh, ...finalEntries], null, 2) + "\n");
    written = true;
    result.entries = finalEntries;

    const audit = await runAudits(root, year);
    if (!audit.ok) throw new Error(`監査失敗: ${audit.failed.join(", ")}`);

    const rel = (p) => path.relative(root, p).split(path.sep).join("/");
    const paths = [rel(casesPath), ...finalEntries.map((e) => rel(path.join(thumbDir, `${e.id}.jpg`)))];
    await gitCommit(paths, `Cannes ${year}: ${finalEntries.length}件を取り込み (cannes-ingest)\n\n${finalEntries.map((e) => `- ${e.id}`).join("\n")}`);
    log(`OK: ${finalEntries.length}件を commit（push はしない）`);
    return result;
  } catch (e) {
    log(`ERROR: ${e.message} — cases.json とサムネを元に戻す`);
    if (written) writeAtomic(casesPath, originalText);
    cleanThumbs();
    return { ...result, added: [], entries: [], exitCode: 1 };
  } finally {
    releaseOwnedLock(lockPath);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const year = args[0];
  const di = args.indexOf("--drafts");
  const draftsFile = di >= 0 ? args[di + 1] : null;
  if (!/^\d{4}$/.test(year || "") || !draftsFile) {
    console.error("usage: node scripts/cannes-ingest.mjs <year> --drafts <file.json> [--dry-run]");
    process.exit(2);
  }
  const drafts = JSON.parse(fs.readFileSync(draftsFile, "utf8"));
  if (!Array.isArray(drafts)) { console.error("drafts は配列であること"); process.exit(2); }
  const r = await ingest({ year: Number(year), drafts, dryRun: args.includes("--dry-run") });
  console.log(`[cannes-ingest ${year}] added=${r.added.length} skipped=${r.skipped.length} exit=${r.exitCode}`);
  process.exit(r.exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
