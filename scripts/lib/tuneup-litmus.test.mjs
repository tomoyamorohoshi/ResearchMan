// tuneup-litmus.mjs のテスト（node:test）。v3 §5: 判定の具体例（リトマス）の自動入れ替え。
// 実行: node --test scripts/lib/tuneup-litmus.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { planLitmusSwap, buildLitmusCandidates, LITMUS_SWAP_MAX, LITMUS_SIDE_MAX, ORIGIN_KEEP_RANK, HISTORY_MAX } from "./tuneup-litmus.mjs";
import { validateCaseGate } from "./case-gate-criteria.mjs";

const NOW = new Date("2026-10-27T03:00:00Z");
const ent = (n, origin = "seed", addedAt = "2026-10-01", o = {}) => ({
  title: `例${origin}${n}`,
  url: `https://ex.com/${origin}/${n}`,
  why: `理由${n}`,
  origin,
  addedAt,
  ...o,
});
const gateOf = (accept, reject = []) => ({
  version: 1,
  updatedAt: "2026-10-01",
  criteria: ["A", "B", "C", "D"].map((id) => ({ id, text: `基準${id}` })),
  rejectTypical: "典型",
  tasteTypes: [{ id: "a", label: "l", text: "t" }],
  litmus: { accept, reject },
});
const cand = (n, o = {}) => ({ title: `候補${n}`, url: `https://new.com/${n}`, why: `候補理由${n}`, ...o });

test("定数: 各最大8件・1回3件", () => {
  assert.equal(LITMUS_SIDE_MAX, 8);
  assert.equal(LITMUS_SWAP_MAX, 3);
  assert.ok(ORIGIN_KEEP_RANK.tuneup < ORIGIN_KEEP_RANK.seed);
  assert.ok(ORIGIN_KEEP_RANK.tuneup < ORIGIN_KEEP_RANK.award);
});

test("空きがあれば追加のみ（置換しない）・origin=tuneup・addedAt=now・updatedAt更新", () => {
  const g = gateOf([ent(1), ent(2)], [ent(3)]);
  const r = planLitmusSwap(g, { favCandidates: [cand(1)], trashCandidates: [cand(2)], now: NOW });
  assert.equal(r.changed, true);
  assert.equal(r.gate.litmus.accept.length, 3);
  assert.equal(r.gate.litmus.reject.length, 2);
  assert.deepEqual(r.changes.map((c) => [c.side, c.action]), [["accept", "add"], ["reject", "add"]]);
  const added = r.gate.litmus.accept.at(-1);
  assert.equal(added.origin, "tuneup");
  assert.equal(added.addedAt, "2026-10-27");
  assert.equal(added.title, "候補1");
  assert.equal(r.gate.updatedAt, "2026-10-27");
  assert.deepEqual(validateCaseGate(r.gate), []);
});

test("入力 gate を破壊しない", () => {
  const g = gateOf([ent(1)], []);
  const snap = JSON.stringify(g);
  planLitmusSwap(g, { favCandidates: [cand(1)], trashCandidates: [], now: NOW });
  assert.equal(JSON.stringify(g), snap);
});

test("1回の入れ替えは追加・置換の合計3件まで。採用/不採用を交互に採る", () => {
  const g = gateOf([ent(1)], [ent(2)]);
  const r = planLitmusSwap(g, {
    favCandidates: [cand(1), cand(2), cand(3), cand(4)],
    trashCandidates: [cand(5), cand(6)],
    now: NOW,
  });
  assert.equal(r.changes.length, 3);
  assert.deepEqual(r.changes.map((c) => c.side), ["accept", "reject", "accept"]);
});

test("満杯(8件)なら置換。外す順: tuneup由来の古い順 → media等 → award → seed/owner-fav", () => {
  const accept = [
    ent(1, "seed", "2026-09-01"),
    ent(2, "award", "2026-09-01"),
    ent(3, "owner-fav", "2026-09-01"),
    ent(4, "media", "2026-09-05"),
    ent(5, "tuneup", "2026-09-20"),
    ent(6, "tuneup", "2026-09-10"),
    ent(7, "media", "2026-09-06"),
    ent(8, "award", "2026-09-02"),
  ];
  const r = planLitmusSwap(gateOf(accept), { favCandidates: [cand(1), cand(2), cand(3)], trashCandidates: [], now: NOW });
  assert.deepEqual(
    r.changes.map((c) => c.removed.title),
    ["例tuneup6", "例tuneup5", "例media4"] // tuneup古い順(09-10→09-20)の次に media(2件あるので1件は外せる)
  );
  assert.ok(r.changes.every((c) => c.action === "replace"));
  assert.equal(r.gate.litmus.accept.length, 8);
  assert.deepEqual(validateCaseGate(r.gate), []);
});

test("今回追加した候補を同じ回で外さない（新しい tuneup 由来が最優先で外れる罠の回避）", () => {
  const accept = Array.from({ length: 8 }, (_, i) => ent(i, "tuneup", `2026-09-${String(i + 1).padStart(2, "0")}`));
  const r = planLitmusSwap(gateOf(accept), { favCandidates: [cand(1), cand(2), cand(3)], trashCandidates: [], now: NOW });
  const titles = r.gate.litmus.accept.map((e) => e.title);
  for (const c of ["候補1", "候補2", "候補3"]) assert.ok(titles.includes(c), c);
  assert.deepEqual(r.changes.map((c) => c.removed.title), ["例tuneup0", "例tuneup1", "例tuneup2"]);
});

test("origin 全滅回避: 唯一の media は、同 origin が残らないので外さず seed を外す", () => {
  const accept = [ent(0, "media", "2026-09-01"), ...Array.from({ length: 7 }, (_, i) => ent(i + 1, "seed", `2026-09-0${i + 1}`))];
  const r = planLitmusSwap(gateOf(accept), { favCandidates: [cand(1)], trashCandidates: [], now: NOW });
  assert.equal(r.changes[0].removed.origin, "seed");
  assert.equal(r.changes[0].removed.title, "例seed1"); // seed内は古い順
  assert.ok(r.gate.litmus.accept.some((e) => e.origin === "media"));
  assert.ok(r.gate.litmus.accept.some((e) => e.origin === "seed"));
});

test("origin 全滅回避: 唯一の tuneup は新規(tuneup)が引き継ぐので外してよい", () => {
  const accept = [ent(0, "tuneup", "2026-09-01"), ...Array.from({ length: 7 }, (_, i) => ent(i + 1, "seed"))];
  const r = planLitmusSwap(gateOf(accept), { favCandidates: [cand(1)], trashCandidates: [], now: NOW });
  assert.equal(r.changes[0].removed.origin, "tuneup");
});

test("外せるものが無ければ(全origin唯一) 置換せずスキップ", () => {
  const origins = ["seed", "award", "owner-fav", "media", "a1", "a2", "a3", "a4"];
  const accept = origins.map((o, i) => ent(i, o));
  const r = planLitmusSwap(gateOf(accept), { favCandidates: [cand(1)], trashCandidates: [], now: NOW });
  assert.equal(r.changed, false);
  assert.equal(r.gate.litmus.accept.length, 8);
});

test("重複: 既存の URL(正規化)・タイトル(正規化)・反対側との重複・候補同士の重複は入れない", () => {
  const g = gateOf([ent(1, "seed", "2026-10-01", { url: "https://dup.com/a/", title: "既存タイトル" })], [ent(2, "seed", "2026-10-01", { url: "https://other.com/x", title: "反対側 タイトル" })]);
  const r = planLitmusSwap(g, {
    favCandidates: [
      cand(1, { url: "https://DUP.com/a#frag" }), // URL重複
      cand(2, { title: "既存 タイトル", url: "https://n.com/2" }), // タイトル重複(空白差)
      cand(3, { url: "https://other.com/x" }), // 反対側(reject)と同URL
      cand(4, { url: "https://n.com/4" }),
      cand(5, { title: "候補4", url: "https://n.com/5" }), // 候補同士タイトル重複
    ],
    trashCandidates: [],
    now: NOW,
  });
  assert.deepEqual(r.gate.litmus.accept.map((e) => e.title), ["既存タイトル", "候補4"]);
  assert.equal(r.changes.length, 1);
});

test("why/title が空の候補は採らない。URL無しの候補は許容(urlは任意)", () => {
  const r = planLitmusSwap(gateOf([ent(1)]), {
    favCandidates: [{ title: "", why: "x" }, { title: "t", why: "" }, { title: "URLなし", why: "理由" }],
    trashCandidates: [],
    now: NOW,
  });
  assert.equal(r.changes.length, 1);
  assert.equal(r.gate.litmus.accept.at(-1).url, undefined);
  assert.deepEqual(validateCaseGate(r.gate), []);
});

test("候補0件・同一なら changed=false で gate は元と同一内容(updatedAtも変えない)", () => {
  const g = gateOf([ent(1)]);
  const r = planLitmusSwap(g, { favCandidates: [], trashCandidates: [], now: NOW });
  assert.equal(r.changed, false);
  assert.equal(r.gate.updatedAt, "2026-10-01");
});

// ── 履歴（毎週の入れ替わり続けの防止） ──
test("履歴: 追加・外したもの・見送ったものを記録する", () => {
  const accept = Array.from({ length: 8 }, (_, i) => ent(i, "seed", `2026-09-0${i + 1}`));
  const r = planLitmusSwap(gateOf(accept), { favCandidates: [cand(1)], trashCandidates: [], now: NOW, history: [] });
  const outcomes = r.history.map((h) => h.outcome).sort();
  assert.deepEqual(outcomes, ["added", "removed"]);
  assert.ok(r.history.every((h) => h.at === "2026-10-27"));
  // 外せず見送った候補は skipped
  const origins = ["seed", "award", "owner-fav", "media", "a1", "a2", "a3", "a4"].map((o, i) => ent(i, o));
  const s = planLitmusSwap(gateOf(origins), { favCandidates: [cand(9)], trashCandidates: [], now: NOW, history: [] });
  assert.equal(s.changed, false);
  assert.deepEqual(s.history.map((h) => h.outcome), ["skipped"]);
});

test("履歴にある候補（過去に追加・外した・見送った）は再採用しない", () => {
  const g = gateOf([ent(1)]);
  const history = [
    { title: "候補1", url: "https://new.com/1", outcome: "removed", at: "2026-10-01" },
    { title: "別名", url: "https://new.com/2", outcome: "skipped", at: "2026-10-01" },
    { title: "候補3", url: "https://other.com/x", outcome: "added", at: "2026-10-01" },
  ];
  const r = planLitmusSwap(g, { favCandidates: [cand(1), cand(2), cand(3), cand(4)], trashCandidates: [], now: NOW, history });
  assert.deepEqual(r.gate.litmus.accept.map((e) => e.title), ["例seed1", "候補4"]);
});

test("収束: 同じ入力で繰り返しても2週目以降は置換が起きない（外した例も戻らない）", () => {
  let gate = gateOf(Array.from({ length: 8 }, (_, i) => ent(i, "seed", `2026-09-0${i + 1}`)));
  let history = [];
  const cands = [cand(1), cand(2)];
  const trash = [cand(7)];
  const changedPerWeek = [];
  for (let w = 0; w < 4; w++) {
    const r = planLitmusSwap(gate, { favCandidates: cands, trashCandidates: trash, now: NOW, history });
    changedPerWeek.push(r.changes.length);
    gate = r.gate;
    history = r.history;
  }
  assert.deepEqual(changedPerWeek, [3, 0, 0, 0]);
  // 外された seed が、入力候補に含まれていても戻らない（外した例も入力として与える）
  const removed = history.filter((h) => h.outcome === "removed");
  assert.equal(removed.length, 2);
  const back = planLitmusSwap(gate, { favCandidates: removed.map((h) => ({ title: h.title, url: h.url, why: "w" })), trashCandidates: [], now: NOW, history });
  assert.equal(back.changed, false);
});

test("履歴は上限 HISTORY_MAX 件で古い順に切る", () => {
  const history = Array.from({ length: HISTORY_MAX }, (_, i) => ({ title: `old${i}`, url: `https://h.com/${i}`, outcome: "added", at: "2026-01-01" }));
  const r = planLitmusSwap(gateOf([ent(1)]), { favCandidates: [cand(1)], trashCandidates: [], now: NOW, history });
  assert.equal(r.history.length, HISTORY_MAX);
  assert.equal(r.history.at(-1).title, "候補1");
  assert.equal(r.history[0].title, "old1");
});

// ── why は AI が書く（記事要約を流用しない） ──
test("buildLitmusCandidates: AI の why が無い・側が違う候補は採らない。新しい順。why は切り詰める", () => {
  const list = [
    { id: "1", title: "Alpha", link: "https://a/1", summary: "記事の要約A" },
    { id: "2", title: "Beta", link: "https://a/2", summary: "記事の要約B" },
    { id: "3", title: "Gamma", link: "https://a/3", summary: "記事の要約C" },
  ];
  const whys = [
    { title: "alpha", side: "accept", why: "A基準: 読み替え一手で一文に言える。" },
    { title: "Gamma", side: "reject", why: "側が違う" },
    { title: "Beta", side: "accept", why: "x".repeat(500) },
  ];
  const r = buildLitmusCandidates(list, whys, "accept");
  assert.deepEqual(r.map((c) => c.title), ["Beta", "Alpha"]);
  assert.ok(r[0].why.length <= 141);
  assert.equal(r[1].why, "A基準: 読み替え一手で一文に言える。");
  assert.ok(r.every((c) => !c.why.includes("要約")));
  assert.deepEqual(buildLitmusCandidates(list, undefined, "accept"), []);
  assert.deepEqual(buildLitmusCandidates(list, [{ title: "Alpha", side: "accept", why: "  " }], "accept"), []);
});

test("max/cap を引数で変えられる（上限8は既定）", () => {
  const g = gateOf([ent(1)]);
  const r = planLitmusSwap(g, { favCandidates: [cand(1), cand(2), cand(3)], trashCandidates: [], now: NOW, max: 1 });
  assert.equal(r.changes.length, 1);
});
