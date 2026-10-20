// cc ジョブ → Exhibition ジョブの引き継ぎ（data/inbox/exhibition-handoff.json）のテスト。実 Claude・実ネットワークは使わない。
// 実行: node --test scripts/lib/exhibition-handoff.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { toHandoffItem, appendHandoff, consumeHandoff, commitHandoff, HANDOFF_REL, MAX_ATTEMPTS } from "./exhibition-handoff.mjs";

const TODAY = "2026-10-20";

function cand(over = {}) {
  return {
    title: "Timber / Timbre（Anthropic『Machines of Loving Grace』展）",
    client: "Anthropic",
    year: "2026",
    link: "https://news.example/article/1",
    note: "木と音のインスタレーション",
    gateReason: "空間体験の発明",
    contentKind: "exhibition",
    exhibition: {
      venue: "KARIMOKU RESEARCH CENTER", venueType: "corporate", prefecture: "東京都", city: "港区",
      startDate: "2026-10-17", endDate: "2026-10-25", admission: "無料", officialUrl: "https://karimoku.example/mol",
      artists: ["A"], tags: ["light"], score: 70,
    },
    ...over,
  };
}
const ex = (o) => ({ ...cand().exhibition, ...o });

test("toHandoffItem: 開催中の展覧会告知は Exhibition 候補形式に変換（元記事URL付き）", () => {
  const it = toHandoffItem(cand(), TODAY);
  assert.equal(it.venue, "KARIMOKU RESEARCH CENTER");
  assert.equal(it.startDate, "2026-10-17");
  assert.equal(it.officialUrl, "https://karimoku.example/mol");
  assert.equal(it.sourceUrl, "https://news.example/article/1");
  assert.equal(it.score, 70);
  assert.deepEqual(it.sources, [{ name: "元記事", url: "https://news.example/article/1", kind: "news" }]);
  assert.ok(it.matchReason);
});

test("toHandoffItem: 開催前でも可 / 終了日が今日はOK / 「県」省略の都道府県は正規化", () => {
  assert.ok(toHandoffItem(cand({ exhibition: ex({ startDate: "2026-11-01", endDate: "2026-11-10" }) }), TODAY));
  assert.ok(toHandoffItem(cand({ exhibition: ex({ endDate: TODAY }) }), TODAY));
  assert.equal(toHandoffItem(cand({ exhibition: ex({ prefecture: "東京" }) }), TODAY).prefecture, "東京都");
});

test("toHandoffItem: 終了済み・会場/会期欠落・contentKind が exhibition でないものは null（通常の cases 判定に回す）", () => {
  assert.equal(toHandoffItem(cand({ exhibition: ex({ endDate: "2026-10-19" }) }), TODAY), null);
  assert.equal(toHandoffItem(cand({ exhibition: ex({ venue: "" }) }), TODAY), null);
  assert.equal(toHandoffItem(cand({ exhibition: ex({ startDate: "" }) }), TODAY), null);
  assert.equal(toHandoffItem(cand({ exhibition: ex({ startDate: "2026-10-30", endDate: "2026-10-25" }) }), TODAY), null);
  assert.equal(toHandoffItem(cand({ contentKind: "case" }), TODAY), null);
  assert.equal(toHandoffItem(cand({ contentKind: undefined }), TODAY), null);
  assert.equal(toHandoffItem(cand({ exhibition: undefined }), TODAY), null);
});

test("toHandoffItem: 海外・都道府県不明は null（cases 判定に戻す）", () => {
  assert.equal(toHandoffItem(cand({ exhibition: ex({ prefecture: "Paris" }) }), TODAY), null);
  assert.equal(toHandoffItem(cand({ exhibition: ex({ prefecture: "" }) }), TODAY), null);
  assert.equal(toHandoffItem(cand({ exhibition: ex({ prefecture: "フランス" }) }), TODAY), null);
});

test("toHandoffItem: score 欠落・不正は null（cases 判定に戻す）", () => {
  assert.equal(toHandoffItem(cand({ exhibition: ex({ score: "abc" }) }), TODAY), null);
  assert.equal(toHandoffItem(cand({ exhibition: ex({ score: undefined }) }), TODAY), null);
  assert.equal(toHandoffItem(cand({ exhibition: ex({ score: "" }) }), TODAY), null);
  assert.equal(toHandoffItem(cand({ exhibition: ex({ score: "75" }) }), TODAY).score, 75);
});

const readH = (root) => JSON.parse(fs.readFileSync(path.join(root, HANDOFF_REL), "utf-8"));
const mkRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "handoff-"));

test("appendHandoff: 追記・重複排除", async () => {
  const root = mkRoot();
  const it = toHandoffItem(cand(), TODAY);
  await appendHandoff(root, [it]);
  await appendHandoff(root, [it, { ...it, title: "別", officialUrl: "https://x.example/2" }]);
  const j = readH(root);
  assert.equal(j.version, 1);
  assert.equal(j.items.length, 2);
});

test("appendHandoff: 既存ファイルが壊れていたら上書きせず throw", async () => {
  const root = mkRoot();
  fs.mkdirSync(path.join(root, "data/inbox"), { recursive: true });
  fs.writeFileSync(path.join(root, HANDOFF_REL), "{broken");
  await assert.rejects(() => appendHandoff(root, [toHandoffItem(cand(), TODAY)]));
  assert.equal(fs.readFileSync(path.join(root, HANDOFF_REL), "utf-8"), "{broken");
});

const okBody = "<html><body>KARIMOKU RESEARCH CENTER Timber / Timbre 2026年10月17日 〜 2026年10月25日 (2026-10-17 2026-10-25)</body></html>";
const deps = {
  fetchHtml: async () => ({ status: 200, body: okBody }),
  saveThumb: async (id) => `/thumbnails/exhibition/${id}.jpg`,
  now: () => "2026-10-20T00:00:00.000Z",
};
const baseData = () => ({ version: 1, statusAsOf: TODAY, items: [] });
const opts = { addThreshold: 60, highlightThreshold: 80, dryRun: false, reservedIds: new Set() };
const item = (title, over = {}) => toHandoffItem(cand({ title, exhibition: ex(over) }), TODAY);

function writeHandoff(root, items) {
  fs.mkdirSync(path.join(root, "data/inbox"), { recursive: true });
  fs.writeFileSync(path.join(root, HANDOFF_REL), JSON.stringify({ version: 1, items }));
}

test("consumeHandoff 自体は handoff を書き換えない（除去は commitHandoff で）", async () => {
  const root = mkRoot();
  writeHandoff(root, [item("Timber / Timbre")]);
  const before = fs.readFileSync(path.join(root, HANDOFF_REL), "utf-8");
  const out = await consumeHandoff({ root, data: baseData(), today: TODAY, deps, opts });
  assert.equal(out.added.length, 1);
  assert.equal(out.added[0].origin, "auto");
  assert.equal(fs.readFileSync(path.join(root, HANDOFF_REL), "utf-8"), before);
});

test("commitHandoff: 処理済み（added）は除去される", async () => {
  const root = mkRoot();
  writeHandoff(root, [item("Timber / Timbre")]);
  const out = await consumeHandoff({ root, data: baseData(), today: TODAY, deps, opts });
  await commitHandoff(root, out.plan);
  assert.deepEqual(readH(root).items, []);
});

test("巻き戻し（cliFatal/audit FAIL）想定: commit しなければ翌日再処理でき、既に追加済みなら dedupe で冪等", async () => {
  const root = mkRoot();
  writeHandoff(root, [item("Timber / Timbre")]);
  const day1 = await consumeHandoff({ root, data: baseData(), today: TODAY, deps, opts });
  assert.equal(day1.added.length, 1);
  // exhibition.json が巻き戻されなかった場合: 再処理は重複として skip
  const again = await consumeHandoff({ root, data: day1.data, today: TODAY, deps, opts });
  assert.equal(again.added.length, 0);
  assert.equal(again.skipped.length, 1);
  // 巻き戻された場合: 再度追加できる（handoff が残っているため失われない）
  const reverted = await consumeHandoff({ root, data: baseData(), today: TODAY, deps, opts });
  assert.equal(reverted.added.length, 1);
});

test("commitHandoff: 恒久 reject(below-threshold) は除去、daily-cap は持ち越し（attempts+1）", async () => {
  const root = mkRoot();
  writeHandoff(root, [item("低スコア", { score: 10, officialUrl: "https://a.example/1" }), item("Timber / Timbre", { officialUrl: "https://a.example/3" })]);
  const out = await consumeHandoff({ root, data: baseData(), today: TODAY, deps, opts: { ...opts, maxAdd: 0 } });
  await commitHandoff(root, out.plan);
  const left = readH(root).items;
  assert.deepEqual(left.map((x) => x.title), ["Timber / Timbre"]);
  assert.equal(left[0].attempts, 1);
});

test("commitHandoff: 照合不一致 unverified は除去、sourceUrl が unverified に残る", async () => {
  const root = mkRoot();
  writeHandoff(root, [item("不一致")]);
  const d = { ...deps, fetchHtml: async () => ({ status: 200, body: "<html>関係ない</html>" }) };
  const out = await consumeHandoff({ root, data: baseData(), today: TODAY, deps: d, opts });
  assert.equal(out.unverified.length, 1);
  assert.equal(out.unverified[0].sourceUrl, "https://news.example/article/1");
  await commitHandoff(root, out.plan);
  assert.deepEqual(readH(root).items, []);
});

test("commitHandoff: 一時失敗（fetch エラー/5xx）は持ち越し、MAX_ATTEMPTS 回で除去", async () => {
  for (const f of [async () => { throw new Error("ECONNRESET"); }, async () => null, async () => ({ status: 503, body: "" })]) {
    const root = mkRoot();
    writeHandoff(root, [item("Timber / Timbre")]);
    const d = { ...deps, fetchHtml: f };
    for (let n = 1; n < MAX_ATTEMPTS; n++) {
      const out = await consumeHandoff({ root, data: baseData(), today: TODAY, deps: d, opts });
      await commitHandoff(root, out.plan);
      assert.equal(readH(root).items.length, 1);
      assert.equal(readH(root).items[0].attempts, n);
    }
    const last = await consumeHandoff({ root, data: baseData(), today: TODAY, deps: d, opts });
    await commitHandoff(root, last.plan);
    assert.deepEqual(readH(root).items, []);
  }
});

test("commitHandoff: 404 などの恒久的な公式ページ失敗は除去", async () => {
  const root = mkRoot();
  writeHandoff(root, [item("Timber / Timbre")]);
  const d = { ...deps, fetchHtml: async () => ({ status: 404, body: "" }) };
  const out = await consumeHandoff({ root, data: baseData(), today: TODAY, deps: d, opts });
  await commitHandoff(root, out.plan);
  assert.deepEqual(readH(root).items, []);
});

test("commitHandoff: 処理中に追記された分は消さない（再読込して処理済み分だけ除去）", async () => {
  const root = mkRoot();
  writeHandoff(root, [item("Timber / Timbre")]);
  const out = await consumeHandoff({ root, data: baseData(), today: TODAY, deps, opts });
  await appendHandoff(root, [item("後から追記", { officialUrl: "https://late.example/1" })]);
  await commitHandoff(root, out.plan);
  assert.deepEqual(readH(root).items.map((x) => x.title), ["後から追記"]);
});

test("consumeHandoff / commitHandoff: dry-run 相当（commit しない）ではファイル不変、ファイル無し・壊れていても警告して続行", async () => {
  const root = mkRoot();
  const a = await consumeHandoff({ root, data: baseData(), today: TODAY, deps, opts });
  assert.equal(a.added.length, 0);
  assert.equal(a.warning, undefined);
  fs.mkdirSync(path.join(root, "data/inbox"), { recursive: true });
  fs.writeFileSync(path.join(root, HANDOFF_REL), "{broken");
  const b = await consumeHandoff({ root, data: baseData(), today: TODAY, deps, opts });
  assert.equal(b.added.length, 0);
  assert.ok(b.warning);
  await commitHandoff(root, b.plan); // 計画なし＝何もしない
  assert.equal(fs.readFileSync(path.join(root, HANDOFF_REL), "utf-8"), "{broken");
});
