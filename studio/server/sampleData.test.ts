/**
 * mapRealIdeasToResultCards の単体テスト。data/ideas.json の実スキーマ変化を
 * 検知するため、実ファイルを読んでフィールドの存在も確認する（jobs.test.tsと同様、
 * 副作用のない読み取り専用チェック）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { mapRealIdeasToResultCards, sampleData, type RealIdea } from "./sampleData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IDEAS_JSON_PATH = path.join(__dirname, "..", "..", "data", "ideas.json");

test("mapRealIdeasToResultCards: pattern無しのアーカイブ分は除外される", () => {
  const raw: RealIdea[] = [
    { id: "a", date: "2026-07-01", title: "T1", pattern: "見立て", seed: "S1", refs: [] },
    { id: "b", date: null, title: "T2", pattern: null, seed: "S2", refs: [] },
  ];
  const cards = mapRealIdeasToResultCards(raw);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, "a");
});

test("mapRealIdeasToResultCards: title/angle/seed/refsが正しくマップされる", () => {
  const raw: RealIdea[] = [
    {
      id: "a",
      date: "2026-07-01",
      title: "タイトル",
      pattern: "文脈×技術",
      seed: "種のテキスト",
      refs: [
        { type: "case", id: "c1", title: "Case Title", desc: "..." },
        { type: "tech", id: "t1", title: "Tech Title", desc: "..." },
      ],
    },
  ];
  const [card] = mapRealIdeasToResultCards(raw);
  assert.equal(card.kind, "idea");
  assert.equal(card.title, "タイトル");
  assert.equal(card.angle, "文脈×技術");
  assert.equal(card.seed, "種のテキスト");
  assert.deepEqual(card.refs, [
    { type: "case", label: "Case Title" },
    { type: "tech", label: "Tech Title" },
  ]);
});

test("mapRealIdeasToResultCards: 日付降順（新しい種が先頭）", () => {
  const raw: RealIdea[] = [
    { id: "old", date: "2026-01-01", title: "T", pattern: "P", seed: "S", refs: [] },
    { id: "new", date: "2026-07-01", title: "T", pattern: "P", seed: "S", refs: [] },
  ];
  const cards = mapRealIdeasToResultCards(raw);
  assert.deepEqual(cards.map((c) => c.id), ["new", "old"]);
});

test("mapRealIdeasToResultCards: refsが空配列の実エントリも例外を投げない", () => {
  const raw: RealIdea[] = [{ id: "a", date: "2026-01-01", title: "T", pattern: "P", seed: "S", refs: [] }];
  const [card] = mapRealIdeasToResultCards(raw);
  assert.deepEqual(card.refs, []);
});

test("sampleData.idea: 実データ読み込み後も全件にangle(切り口)がある（eyebrow維持の前提）", () => {
  assert.ok(sampleData.idea.length > 0, "idea一覧が空にならないこと");
  for (const card of sampleData.idea) {
    assert.ok(card.angle, `id=${card.id} に切り口(angle)が無い`);
    assert.ok(card.title, `id=${card.id} にtitleが無い`);
    assert.ok(card.seed, `id=${card.id} にseedが無い`);
  }
});

test("data/ideas.json: 実ファイルのスキーマ前提（pattern付きエントリが実在する）", () => {
  const raw = JSON.parse(readFileSync(IDEAS_JSON_PATH, "utf-8")) as RealIdea[];
  assert.ok(raw.some((i) => i.pattern), "pattern付きの実エントリが1件も無い（スキーマ変化の可能性）");
});
