import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  selectTargets, filterThumbUrls, chunk, stripWorkNotes, validateDrafts, updateState, emptyState, buildPrompt, runBatch, parseArgs, makeClaudeGroupRunner, buildVocab, extractDrafts,
} from "./cannes-batch-runner.mjs";

const W = (key, cat = "Film", brand = "B", title = key) => ({ key, title, brand, agency: "A", country: "JP", entries: [{ category: cat, level: "Gold" }] });
const inCases = (key, cat = "Film", brand = "B") => ({ id: `${brand.toLowerCase()}-${key}`, title: key, awardEntries: [{ org: "cannes", year: 2025, category: cat }] });
const out = (keys, extra = {}) => "memo {x}\n```json\n" + JSON.stringify({ cannesDrafts: keys.map((key) => ({ key, draft: goodDraft() })), excluded: [], ...extra }) + "\n```\n";
const goodDraft = () => ({ summary: "s", overview: "o", background: "b", execution: "e", evaluationImpact: "i", link: "https://x", regions: ["国内"], tags: ["t"] });

test("selectTargets: skip・done・2回失敗を除き、先頭entryの部門が少ない順（部門内は元順）", () => {
  const works = [W("a", "Film"), W("b", "Film"), W("c", "Audio"), W("d", "Film"), W("e", "Direct"), W("f", "Audio"), W("g", "Direct")];
  const state = { ...emptyState(), skipped: ["g"], done: ["a"], attempts: { f: 2, b: 1 } };
  const r = selectTargets(works, state);
  // 残り: b(Film) c(Audio) d(Film) e(Direct)。件数 Audio1 Direct1 Film2 → 同数は初出順
  assert.deepEqual(r.map((w) => w.key), ["c", "e", "b", "d"]);
});

test("selectTargets: 既存 id と衝突する作品は除外", () => {
  const works = [W("a", "Film", "Acme", "Big Idea"), W("b")];
  const r = selectTargets(works, emptyState(), { existingCases: [{ id: "acme-big-idea-2025", title: "t", awardEntries: [{ org: "cannes", year: 2025 }] }], year: 2025 });
  assert.deepEqual(r.map((w) => w.key), ["b"]);
});

test("chunk: 5件ずつ・端数あり", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5, 6, 7], 5), [[1, 2, 3, 4, 5], [6, 7]]);
  assert.deepEqual(chunk([], 5), []);
});

test("stripWorkNotes: 作業メモ文だけを除去", () => {
  const t = "施策は話題を呼んだ。成果数値は独立した報道で確認できなかったため記載しない。次の文。";
  assert.equal(stripWorkNotes(t), "施策は話題を呼んだ。次の文。");
  assert.equal(stripWorkNotes("数値はXの報道では不採用。残る文。"), "残る文。");
  assert.equal(stripWorkNotes("売上は2倍になった。"), "売上は2倍になった。");
});

test("validateDrafts: works に無い key・必須欠落を捨て、メモを除去、重複 key は最初のみ", () => {
  const bad = goodDraft(); delete bad.link;
  const memo = { ...goodDraft(), evaluationImpact: "受賞した。成果数値は確認できなかったため記載しない。" };
  const raw = [
    { key: "a", draft: goodDraft() },
    { key: "zzz", draft: goodDraft() },
    { key: "b", draft: bad },
    { key: "c", draft: memo, thumbnailCandidates: ["u"] },
    { key: "a", draft: goodDraft() },
    null,
    { key: "d", draft: { ...goodDraft(), tags: [] } },
  ];
  const { valid, dropped } = validateDrafts(raw, new Set(["a", "b", "c", "d"]));
  assert.deepEqual(valid.map((v) => v.key), ["a", "c"]);
  assert.equal(valid[1].draft.evaluationImpact, "受賞した。");
  assert.deepEqual(dropped.map((d) => d.key).filter(Boolean).sort(), ["a", "b", "d", "zzz"]);
  assert.equal(validateDrafts("nope", new Set(["a"])).valid.length, 0);
});

test("updateState: 失敗 key は attempts+1、2回で skipped、成功 key は done", () => {
  let s = emptyState();
  s = updateState(s, { attemptedKeys: ["a", "b"], okKeys: ["a"] });
  assert.deepEqual(s.attempts, { b: 1 });
  assert.deepEqual(s.done, ["a"]);
  s = updateState(s, { attemptedKeys: ["b"], okKeys: [] });
  assert.deepEqual(s.skipped, ["b"]);
  assert.equal(emptyState().done.length, 0); // 元は破壊されない
});

test("buildPrompt: YEAR 置換・works/手本/語彙を本文に埋め込み、マーカー指示を付ける", () => {
  const p = buildPrompt("Y={{YEAR}}", { year: 2025, works: [W("kk")], examples: [{ id: "ex1" }], vocab: { tags: ["タグA"], regions: ["国内"] } });
  assert.match(p, /Y=2025/);
  for (const m of [/"key": "kk"/, /"id": "ex1"/, /タグA/, /国内/, /cannesDrafts/]) assert.match(p, m);
});

test("buildVocab: tags は出現回数順で上限・regions 全件", () => {
  const v = buildVocab([{ tags: ["a", "b"], regions: ["国内"] }, { tags: ["b", "c"], regions: ["南米"] }], 2);
  assert.deepEqual(v.tags, ["b", "a"]);
  assert.deepEqual([...v.regions].sort(), ["南米", "国内"].sort());
});

test("extractDrafts: 前置き・フェンス付きでも回収、excluded も返す。無ければ null", () => {
  const r = extractDrafts(out(["a"], { excluded: [{ key: "z", reason: "r" }] }));
  assert.equal(r.drafts[0].key, "a");
  assert.deepEqual(r.excluded, [{ key: "z", reason: "r" }]);
  assert.equal(extractDrafts("JSON なし {a}"), null);
  assert.equal(extractDrafts('{"other": []}'), null);
});

test("runBatch: スタブ claude で回収→結合→ingest 呼び出し、state 更新", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cbr-"));
  const works = ["a", "b", "c", "d", "e", "f"].map((k) => W(k));
  let ingestArg = null;
  const res = await runBatch({
    year: 2025, works, state: emptyState(), batchNo: 1, batchSize: 6, parallel: 2, workRoot: tmp, brief: "{{YEAR}}{{SP}}",
    runGroup: async ({ prompt, groupNo, cwd }) => {
      const all = ["a", "b", "c", "d", "e", "f"];
      const ks = all.filter((k) => prompt.includes(`"key": "${k}"`));
      // 各グループの最後の key は返さない
      return out(ks.slice(0, -1));
    },
    runIngest: (mergedFile) => { ingestArg = JSON.parse(fs.readFileSync(mergedFile, "utf8")); return { status: 0 }; },
    readCases: () => ["a", "b", "d", "e"].map((k) => inCases(k)),
    log: () => {},
    groupSize: 3,
  });
  assert.equal(res.exitCode, 0);
  assert.equal(ingestArg.length, 4);
  assert.deepEqual(res.state.done.sort(), ["a", "b", "d", "e"]);
  assert.deepEqual(res.state.attempts, { c: 1, f: 1 });
});

test("runBatch: ingest 失敗は exitCode≠0 で state を更新しない", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cbr-"));
  const res = await runBatch({
    year: 2025, works: [W("a")], state: emptyState(), batchNo: 1, batchSize: 1, parallel: 1, workRoot: tmp, brief: "x",
    runGroup: async () => out(["a"]),
    runIngest: () => ({ status: 1 }),
    log: () => {},
  });
  assert.notEqual(res.exitCode, 0);
  assert.deepEqual(res.state.done, []);
});

test("runBatch: claude が例外/タイムアウトでも他グループは続行し失敗分は attempts+1", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cbr-"));
  const res = await runBatch({
    year: 2025, works: ["a", "b"].map((k) => W(k)), state: emptyState(), batchNo: 1, batchSize: 2, parallel: 2, workRoot: tmp, brief: "x", groupSize: 1,
    runGroup: async ({ prompt }) => {
      const k = prompt.includes('"key": "a"') ? "a" : "b";
      if (k === "a") throw new Error("timeout");
      return out([k]);
    },
    runIngest: () => ({ status: 0 }),
    readCases: () => [inCases("b")],
    log: () => {},
  });
  assert.equal(res.exitCode, 0);
  assert.deepEqual(res.state.done, ["b"]);
  assert.deepEqual(res.state.attempts, {}); // プロセス失敗は attempts を進めない
});

test("filterThumbUrls / validateDrafts: vml.com・dandad.org（サブドメイン含む）の画像・ページ URL を除外", () => {
  assert.deepEqual(filterThumbUrls(["https://www.dandad.org/images/social.jpg", "https://www.vml.com/work/x", "https://i.ytimg.com/vi/a/hqdefault.jpg", "notaurl"]), ["https://i.ytimg.com/vi/a/hqdefault.jpg"]);
  const { valid } = validateDrafts([{ key: "a", draft: goodDraft(), thumbnailCandidates: ["https://www.dandad.org/images/social.jpg", "https://x.com/a.jpg"], pageUrls: ["https://vml.com/work/a"] }], new Set(["a"]));
  assert.deepEqual(valid[0].thumbnailCandidates, ["https://x.com/a.jpg"]);
  assert.deepEqual(valid[0].pageUrls, []);
});

test("runBatch: 全グループがプロセス失敗なら exit 1・state 不変・ingest なし", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cbr-"));
  const logs = []; let ingested = false;
  const st = emptyState();
  const res = await runBatch({
    year: 2025, works: ["a", "b"].map((k) => W(k)), state: st, batchNo: 1, batchSize: 2, parallel: 2, workRoot: tmp, brief: "x", groupSize: 1,
    runGroup: async () => { throw new Error("usage limit"); },
    runIngest: () => { ingested = true; return { status: 0 }; },
    readCases: () => [], log: (m) => logs.push(m),
  });
  assert.equal(res.exitCode, 1);
  assert.equal(ingested, false);
  assert.deepEqual(res.state.attempts, {});
  assert.ok(logs.some((l) => /プロセス失敗/.test(l)));
});

test("runBatch: ingest 後 cases に入らなかった key は done にせず attempts+1", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cbr-"));
  const res = await runBatch({
    year: 2025, works: ["a", "b"].map((k) => W(k)), state: emptyState(), batchNo: 1, batchSize: 2, parallel: 1, workRoot: tmp, brief: "x", groupSize: 2,
    runGroup: async () => out(["a", "b"]),
    runIngest: () => ({ status: 0 }),
    readCases: () => [inCases("a")],
    log: () => {},
  });
  assert.deepEqual(res.state.done, ["a"]);
  assert.deepEqual(res.state.attempts, { b: 1 });
});

test("runBatch: 子 claude の cwd はバッチ作業フォルダ、cases.json 変化は警告", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cbr-"));
  let cwd = null; const logs = []; let n = 0;
  await runBatch({
    year: 2025, works: [W("a")], state: emptyState(), batchNo: 3, batchSize: 1, parallel: 1, workRoot: tmp, brief: "x",
    runGroup: async ({ cwd: c }) => { cwd = c; return out(["a"]); },
    runIngest: () => ({ status: 0 }), readCases: () => [inCases("a")],
    gitStatusCases: () => (n++ === 0 ? "" : " M data/cases.json"),
    log: (m) => logs.push(m),
  });
  assert.equal(cwd, path.join(tmp, "2025", "3"));
  assert.ok(logs.some((l) => /警告.*cases\.json/.test(l)));
});

test("selectTargets: ingest の findDuplicate と同じ規則（title 一致・別 id でも除外）", () => {
  const works = [W("a", "Film", "Acme", "Big Idea"), W("b", "Film", "Zed", "Other"), W("c")];
  const cases = [
    { id: "unrelated-slug", title: "Big  Idea!", awardEntries: [{ org: "cannes", year: 2025 }] },
    { id: "zed-other", title: "x", awardEntries: [{ org: "cannes", year: 2024 }] }, // 別年は対象外
  ];
  const r = selectTargets(works, emptyState(), { existingCases: cases, year: 2025 });
  assert.deepEqual(r.map((w) => w.key), ["b", "c"]);
});

test("parseArgs: 年は位置引数の先頭のみ（--batch-size 2025 と衝突しない）", () => {
  assert.equal(parseArgs(["--batch-size", "2025", "2024"]).year, "2024");
  assert.equal(parseArgs(["--batch-size", "2025"]).year, undefined);
  assert.equal(parseArgs(["2025", "--dry-run"]).year, "2025");
});

test("makeClaudeGroupRunner: タイムアウトで自分の子をツリーごと止め、close 後に reject", async () => {
  const run = makeClaudeGroupRunner({ claudeBin: process.execPath, args: ["-e", "setTimeout(()=>{},60000)"], timeout: 400 });
  const t = Date.now();
  await assert.rejects(run({ prompt: "x", cwd: os.tmpdir() }), /タイムアウト/);
  assert.ok(Date.now() - t < 10000);
});

test("runBatch: stdout を g<N>.out.txt に保存。タイムアウト時も e.stdout の部分出力から回収（プロセス失敗扱いにしない）", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cbr-"));
  const res = await runBatch({
    year: 2025, works: ["a", "b"].map((k) => W(k)), state: emptyState(), batchNo: 1, batchSize: 2, parallel: 2, workRoot: tmp, brief: "x", groupSize: 1,
    runGroup: async ({ prompt }) => {
      if (prompt.includes('"key": "a"')) return out(["a"]);
      throw Object.assign(new Error("タイムアウト"), { stdout: out(["b"]) });
    },
    runIngest: () => ({ status: 0 }), readCases: () => [inCases("a"), inCases("b")], log: () => {},
  });
  assert.deepEqual(res.state.done.sort(), ["a", "b"]);
  const f = path.join(tmp, "2025", "1", "g1.out.txt");
  assert.match(fs.readFileSync(f, "utf8"), /cannesDrafts/);
});

test("runBatch: JSON なし（プロセスは成功）は attempts+1、プロセス失敗＋出力なしは attempts 不変", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cbr-"));
  const res = await runBatch({
    year: 2025, works: ["a", "b"].map((k) => W(k)), state: emptyState(), batchNo: 1, batchSize: 2, parallel: 2, workRoot: tmp, brief: "x", groupSize: 1,
    runGroup: async ({ prompt }) => { if (prompt.includes('"key": "a"')) return "何も出さなかった"; throw new Error("usage limit"); },
    runIngest: () => ({ status: 0 }), readCases: () => [], log: () => {},
  });
  assert.deepEqual(res.state.attempts, { a: 1 });
});

test("makeClaudeGroupRunner: stdout 全文を resolve（2000字超でも切らない）", async () => {
  const run = makeClaudeGroupRunner({ claudeBin: process.execPath, args: ["-e", "process.stdout.write('x'.repeat(5000)+'END')"], timeout: 10000 });
  const r = await run({ prompt: "", cwd: os.tmpdir() });
  assert.equal(r.length, 5003);
  assert.ok(r.endsWith("END"));
});

test("updateState: 除外申告 key は attempts に関係なく即 skipped、理由を excludedReasons に残す（旧 state でも壊れない）", () => {
  const old = { attempts: {}, skipped: [], done: [], batchSeq: 1 }; // excludedReasons なし
  const s = updateState(old, { attemptedKeys: ["a", "x"], okKeys: ["a"], excludedKeys: ["x"], excludedReasons: { x: "出典が応募資料のみ" } });
  assert.deepEqual(s.skipped, ["x"]);
  assert.deepEqual(s.done, ["a"]);
  assert.equal(s.excludedReasons.x, "出典が応募資料のみ");
  assert.equal(s.attempts.x, undefined);
});

test("runBatch: 除外申告は即 skipped（担当外・空 key・採用済み key は無視）", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cbr-"));
  const res = await runBatch({
    year: 2025, works: [W("a"), W("b"), W("c")], state: emptyState(), batchNo: 1, batchSize: 3, parallel: 1, workRoot: tmp, brief: "x",
    runGroup: async () => out(["a"], { excluded: [{ key: "b", reason: "出典が応募資料のみ" }, { key: "zzz", reason: "担当外" }, { key: "", reason: "空" }, { key: "a", reason: "採用と矛盾" }] }),
    runIngest: () => ({ status: 0 }),
    readCases: () => [inCases("a")],
    log: () => {},
  });
  assert.deepEqual(res.state.skipped, ["b"]);
  assert.equal(res.state.excludedReasons.b, "出典が応募資料のみ");
  assert.equal(res.state.excludedReasons.zzz, undefined);
  assert.equal(res.state.excludedReasons.a, undefined);
  assert.equal(res.state.attempts.c, 1);
});

test("runBatch: 採用0件（ingest なし）でも除外申告を反映", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cbr-"));
  const res = await runBatch({
    year: 2025, works: [W("a")], state: emptyState(), batchNo: 1, batchSize: 1, parallel: 1, workRoot: tmp, brief: "x",
    runGroup: async () => out([], { excluded: [{ key: "a", reason: "r" }] }),
    runIngest: () => { throw new Error("no ingest"); },
    log: () => {},
  });
  assert.deepEqual(res.state.skipped, ["a"]);
});

test("runBatch: ingest 失敗時は除外申告も state に反映しない", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cbr-"));
  const res = await runBatch({
    year: 2025, works: [W("a"), W("b")], state: emptyState(), batchNo: 1, batchSize: 2, parallel: 1, workRoot: tmp, brief: "x",
    runGroup: async () => out(["a"], { excluded: [{ key: "b", reason: "r" }] }),
    runIngest: () => ({ status: 1 }),
    log: () => {},
  });
  assert.deepEqual(res.state.skipped, []);
});

test("filterThumbUrls: grey.com（サブドメイン含む）を除外", () => {
  assert.deepEqual(filterThumbUrls(["https://www.grey.com/og.jpg", "https://grey.com/a", "https://i.ytimg.com/vi/a/hq.jpg", "https://notgrey.com/x.jpg"]), ["https://i.ytimg.com/vi/a/hq.jpg", "https://notgrey.com/x.jpg"]);
});
