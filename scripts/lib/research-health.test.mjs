// scripts/lib/research-health.mjs のテスト（node:test）。
// 実行: node --test scripts/lib/research-health.test.mjs
// 一時ディレクトリにフィクスチャ（git repo・ログ・JSON）を作り、本日(2026-10-20)の実例1〜4が
// それぞれ検知されること、正常データでは findings が空であることを確認する。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runResearchHealthReview, parseRuns, dayAdd } from "./research-health.mjs";

const NOW = new Date("2026-10-20T03:00:00Z"); // 2026-10-20 12:00 JST
const TODAY = "2026-10-20";
const day = (n) => dayAdd(TODAY, -n); // n日前(JST暦日)
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const logDate = (dayKey, hhmm = "10:05:00") => {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dow = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow} ${MONTHS[m - 1]} ${String(d).padStart(2, " ")} ${hhmm} JST ${y}`;
};

function git(root, args, env = {}) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}
function commitAt(root, dayKey, msg = "c") {
  const iso = `${dayKey}T03:00:00+09:00`;
  git(root, ["add", "-A"]);
  git(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", msg], {
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  });
}
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v));
};

/**
 * 正常なフィクスチャを作る。opts で個別に壊す。
 *  ccAddsPerDay(n): n日前のcases追加数 / techAddsPerDay(n) / exAddsPerDay(n) / exFlip: boolean
 *  candidatesPerRun(n, kind) / unverified / rejections / tuneup('ok'|'fail') / sourcesEnabled / misclass
 */
function buildFixture(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rh-root-"));
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-log-"));
  git(root, ["init", "-q"]);
  const ccAdds = opts.ccAddsPerDay ?? (() => 2);
  const techAdds = opts.techAddsPerDay ?? (() => 1);
  const exAdds = opts.exAddsPerDay ?? ((n) => (n % 3 === 0 ? 1 : 0));
  const cases = [];
  const tech = [];
  const exItems = [];
  let seq = 0;
  // 古い→新しい順に36日分コミットを積む
  for (let n = 36; n >= 0; n--) {
    for (let i = 0; i < ccAdds(n); i++) cases.push({ id: `c${seq++}`, title: `事例${seq}`, overview: "ふつうの概要" });
    for (let i = 0; i < techAdds(n); i++) tech.push({ id: `t${seq++}`, title: `技術${seq}` });
    for (let i = 0; i < exAdds(n); i++)
      exItems.push({ id: `e${seq++}`, title: `展示${seq}`, venue: "会場A", startDate: "2026-11-01", endDate: "2026-12-01", addedAt: `${day(n)}T01:30:00.000Z` });
    if (opts.misclass && n === 2) cases.push({ id: "mis1", title: "森万里子展 燦燦", overview: "2026年10月1日〜2026年12月20日 会場にて開催" });
    if (opts.exFlip && n <= 10 && n >= 6) {
      // 同一id「flip」の開始日が毎日変わる
      const f = exItems.find((x) => x.id === "flip");
      if (f) f.startDate = `2026-11-${String(10 - n + 1).padStart(2, "0")}`;
      else exItems.push({ id: "flip", title: "ICC", venue: "ICC", startDate: "2026-11-01", endDate: "2026-12-01", addedAt: `${day(n)}T01:30:00.000Z` });
    }
    writeJson(path.join(root, "data/cases.json"), cases);
    writeJson(path.join(root, "data/tech.json"), tech);
    writeJson(path.join(root, "data/exhibition.json"), { version: 1, items: exItems });
    commitAt(root, day(n));
  }
  const sources = opts.sourcesEnabled === 0 ? [{ id: "a", enabled: false }, { id: "b", enabled: false }] : [{ id: "a", enabled: true }, { id: "b", enabled: false }];
  writeJson(path.join(root, "data/sources.json"), sources);
  writeJson(path.join(root, "data/research-tuning.json"), { v: 1 });
  commitAt(root, day(0), "tuning");

  // 発見ログ
  const cand = opts.candidatesPerRun ?? (() => 3);
  const mk = (file, startMarker, tail) => {
    let s = "";
    for (let n = 34; n >= 0; n--) {
      s += `===== ${startMarker} start: ${logDate(day(n))} =====\n候補: ${cand(n)}件\n${tail}\n`;
    }
    fs.writeFileSync(path.join(logDir, file), s);
  };
  mk("researchman-auto.log", "Run", "Completed");
  mk("researchman-tech.log", "Tech run", "Tech completed");
  mk("researchman-exhibition.log", "Exhibition run", "Exhibition completed");
  // チューンアップ
  const tuneDay = opts.tuneup === "fail" ? day(50) : day(2);
  let tl = `===== Tuneup start: ${logDate(tuneDay, "23:40:00")} =====\n✅ 完了（commit/push/通知は run-job.mjs 側で実行）\n`;
  if (opts.tuneup === "fail") for (const n of [14, 7, 1]) tl += `===== Tuneup start: ${logDate(day(n), "23:40:00")} =====\n分析パス1失敗: Claude CLI エラー: spawnSync claude.exe ENAMETOOLONG\nチューンアップエラー終了: x\n`;
  fs.writeFileSync(path.join(logDir, "researchman-tuneup.log"), tl);

  // 却下・unverified
  fs.mkdirSync(path.join(root, "logs"), { recursive: true });
  if (opts.rejections) fs.writeFileSync(path.join(root, "logs/rejections-2026-10.jsonl"), opts.rejections.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeJson(path.join(root, "data/inbox/exhibition-unverified.json"), { version: 1, items: opts.unverified ?? [] });
  return { root, logDir };
}

const codes = (r) => r.findings.map((f) => `${f.pipeline}:${f.code}`);

test("正常データでは findings が出ない", async () => {
  const { root, logDir } = buildFixture();
  const r = await runResearchHealthReview({ root, now: NOW, logDir, dryRun: true });
  assert.deepEqual(r.findings, [], JSON.stringify(r.findings, null, 1));
  assert.match(r.markdown, /異常なし/);
});

test("実例1: Exhibition 11日間追加0件 + 同一展示が毎日 official-venue-mismatch で unverified に積まれる", async () => {
  const unverified = [];
  for (let n = 11; n >= 1; n--) unverified.push({ title: "森万里子：燦燦", venue: "森美術館", reason: "official-venue-mismatch: 森美術館", at: `${day(n)}T01:30:00.000Z` });
  const { root, logDir } = buildFixture({ exAddsPerDay: (n) => (n >= 12 && n % 2 === 0 ? 1 : 0), unverified });
  const r = await runResearchHealthReview({ root, now: NOW, logDir, dryRun: true });
  const c = codes(r);
  assert.ok(c.includes("exhibition:adds-stalled"), c.join());
  assert.equal(r.findings.find((f) => f.code === "adds-stalled" && f.pipeline === "exhibition").severity, "high");
  assert.ok(c.includes("exhibition:same-title-streak"), c.join());
  assert.ok(c.includes("exhibition:reason-dominance"), c.join());
  assert.match(r.markdown, /森万里子/);
});

test("実例2: Case Study の追加が週14件→週2件に激減 + 発見の候補が0件連発", async () => {
  const { root, logDir } = buildFixture({
    ccAddsPerDay: (n) => (n >= 7 ? 2 : n === 3 ? 2 : 0),
    candidatesPerRun: (n) => (n >= 7 ? 3 : 0),
    sourcesEnabled: 0,
  });
  const r = await runResearchHealthReview({ root, now: NOW, logDir, dryRun: true });
  const c = codes(r);
  assert.ok(c.includes("cc:pace-drop"), c.join());
  assert.ok(c.includes("cc:discovery-drop"), c.join());
  assert.ok(c.includes("config:sources-all-disabled"), c.join());
  assert.equal(r.findings.find((f) => f.code === "sources-all-disabled").severity, "high");
});

test("実例3: 既存展示の startDate が毎日別の値に書き換わる(フリップフロップ)", async () => {
  const { root, logDir } = buildFixture({ exFlip: true });
  const r = await runResearchHealthReview({ root, now: NOW, logDir, dryRun: true });
  const f = r.findings.find((x) => x.code === "flip-flop");
  assert.ok(f, codes(r).join());
  assert.equal(f.severity, "med");
  assert.match(JSON.stringify(f.evidence), /flip/);
});

test("実例4: 週次チューンアップが連続失敗し最終成功が10日超前", async () => {
  const { root, logDir } = buildFixture({ tuneup: "fail" });
  const r = await runResearchHealthReview({ root, now: NOW, logDir, dryRun: true });
  const f = r.findings.find((x) => x.code === "tuneup-stale");
  assert.ok(f, codes(r).join());
  assert.equal(f.severity, "high");
  assert.match(f.detail, /ENAMETOOLONG|連続/);
});

test("実例5: 展覧会告知がCase Studyに入る(low) / add-case の『どれでもない』エラー率(low)", async () => {
  const { root, logDir } = buildFixture({ misclass: true });
  const jobs = path.join(root, "studio/workdir/jobs");
  fs.mkdirSync(jobs, { recursive: true });
  for (let i = 0; i < 6; i++)
    writeJson(path.join(jobs, `j${i}.json`), { id: `j${i}`, tab: "add-case", status: "error", at: `${day(2)}T01:00:00.000Z`, error: "指定されたURLから事例/技術情報を確認できませんでした" });
  const r = await runResearchHealthReview({ root, now: NOW, logDir, dryRun: true });
  const c = codes(r);
  assert.ok(c.includes("cc:exhibition-like-case"), c.join());
  assert.ok(c.includes("studio:neither-error-rate"), c.join());
  assert.ok(r.findings.filter((f) => ["exhibition-like-case", "neither-error-rate"].includes(f.code)).every((f) => f.severity === "low"));
});

test("dryRun=false で markdown と system-alerts.jsonl(high/medのみ・形式 {at,source,level,title,body})を書く。LLM失敗でも機械出力は残る", async () => {
  const { root, logDir } = buildFixture({ tuneup: "fail", misclass: true });
  const r = await runResearchHealthReview({
    root, now: NOW, logDir, llm: true,
    runLlm: () => { throw new Error("boom"); },
  });
  assert.ok(fs.existsSync(path.join(root, "logs/research-health-latest.md")));
  const lines = fs.readFileSync(path.join(root, "logs/system-alerts.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(lines.length >= 1);
  for (const l of lines) {
    assert.equal(l.source, "research-health");
    assert.ok(["high", "med"].includes(l.level));
    assert.deepEqual(Object.keys(l).sort(), ["at", "body", "level", "source", "title"]);
  }
  assert.ok(!lines.some((l) => l.level === "low"));
  assert.match(r.markdown, /AIレビュー/);
  assert.match(r.markdown, /失敗/);
  // 再実行で同日・同題の重複追記をしない
  const before = fs.readFileSync(path.join(root, "logs/system-alerts.jsonl"), "utf8");
  await runResearchHealthReview({ root, now: NOW, logDir });
  assert.equal(fs.readFileSync(path.join(root, "logs/system-alerts.jsonl"), "utf8"), before);
});

test("llm=true で runLlm の findings が『AIレビュー』節に載る", async () => {
  const { root, logDir } = buildFixture();
  let seenPrompt = "";
  const r = await runResearchHealthReview({
    root, now: NOW, logDir, llm: true, dryRun: true,
    runLlm: (prompt) => { seenPrompt = prompt; return { findings: [{ severity: "med", title: "基準の形骸化", detail: "d", evidence: "e" }] }; },
  });
  assert.match(r.markdown, /AIレビュー[\s\S]*基準の形骸化/);
  assert.ok(seenPrompt.length <= 20000 + 4000);
});

test("parseRuns: 開始マーカーで区切り、候補行を合算する", () => {
  const text = `===== Run start: ${logDate("2026-10-19")} =====\n候補: 0件\n候補: 2件\n候補3件を機械検証へ\n===== Run start: ${logDate("2026-10-20")} =====\nfoo\n`;
  const runs = parseRuns(text);
  assert.equal(runs.length, 2);
  assert.deepEqual([runs[0].day, runs[0].candidates], ["2026-10-19", 2]);
  assert.equal(runs[1].candidates, null);
});
