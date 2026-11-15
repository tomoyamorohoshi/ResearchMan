import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INDEX_FIELDS,
  pickIndexEntry,
  pickDetailEntry,
  buildCasesIndex,
  buildCaseDetailFiles,
  detailFileName,
} from "./case-index.mjs";
import { buildPublicDataText, computePublicDataHashes, filesNeedingUpload, sourceFileFor } from "./public-data.mjs";

const full = {
  id: "a-1",
  title: "T",
  summary: "S long",
  client: "C",
  agency: "A",
  categories: ["Film"],
  award: "Grand Prix",
  awardEntries: [{ org: "cannes", year: 2020, category: "Film", level: "GP" }],
  year: "2020",
  regions: ["JP"],
  link: "https://x",
  thumbnail: "/t.jpg",
  sources: ["Cannes 2020"],
  tags: ["Tech/AI"],
  videoId: "v1",
  overview: "O",
  background: "B",
  execution: "E",
  evaluationImpact: "EI",
  relatedWorks: [{ title: "r", description: "d", url: "u" }],
  mechanism: "M",
  impact: "I",
  evaluation: "EV",
};

test("pickIndexEntry: 一覧で使う項目だけ残し、summary全文は保持、長文は落とす", () => {
  const e = pickIndexEntry(full);
  assert.deepEqual(Object.keys(e).sort(), [...INDEX_FIELDS].sort());
  assert.equal(e.summary, "S long");
  for (const k of ["overview", "background", "execution", "evaluationImpact", "relatedWorks", "mechanism"]) {
    assert.equal(k in e, false);
  }
});

test("pickIndexEntry: 元に無い任意項目は出力しない（undefinedを入れない）", () => {
  const e = pickIndexEntry({ id: "x", title: "t" });
  assert.deepEqual(e, { id: "x", title: "t" });
});

test("pickDetailEntry: インデックス外の項目とidだけ。隔離フラグは含めない", () => {
  const d = pickDetailEntry({ ...full, quarantineReason: "r" });
  assert.equal(d.id, "a-1");
  assert.equal(d.overview, "O");
  assert.equal(d.videoId, "v1");
  assert.equal("summary" in d, false);
  assert.equal("quarantineReason" in d, false);
});

test("index+detail をマージすると元の事例に戻る（情報が失われない）", () => {
  assert.deepEqual({ ...pickIndexEntry(full), ...pickDetailEntry(full) }, full);
});

test("buildCasesIndex: quarantined===true を除外", () => {
  const idx = buildCasesIndex([full, { ...full, id: "q", quarantined: true }]);
  assert.deepEqual(idx.map((c) => c.id), ["a-1"]);
});

test("buildCaseDetailFiles: 1事例1ファイル、隔離/ID無し/重複は除外してskippedに記録", () => {
  const { files, skipped } = buildCaseDetailFiles([
    full,
    { ...full, id: "q", quarantined: true },
    { ...full, id: "a-1", title: "dup" },
    { title: "noid" },
  ]);
  assert.deepEqual(files.map((f) => f.fileName), ["a-1.json"]);
  assert.equal(JSON.parse(files[0].text).overview, "O");
  assert.deepEqual(skipped.map((s) => s.reason), ["duplicate-id", "no-id"]);
});

test("detailFileName: 特殊文字はエンコードしてパス区切りを含まない", () => {
  assert.equal(detailFileName("a b/c"), "a%20b%2Fc.json");
});

test("配信: cases-index.json は cases.json 由来のテキストで、ハッシュ・アップロード判定に乗る", () => {
  const raw = JSON.stringify([full, { ...full, id: "q", quarantined: true }]);
  assert.equal(sourceFileFor("cases-index.json"), "cases.json");
  assert.equal(sourceFileFor("ideas.json"), "ideas.json");
  const idx = JSON.parse(buildPublicDataText("cases-index.json", raw));
  assert.deepEqual(idx.map((c) => c.id), ["a-1"]);
  const files = { "cases.json": raw, "ideas.json": "[1]", "idea-layouts.json": "{}" };
  const hashes = computePublicDataHashes("d", (f) => files[f.slice(2)]);
  assert.ok(hashes["cases-index.json"] && hashes["cases-index.json"] !== hashes["cases.json"]);
  assert.deepEqual(filesNeedingUpload(hashes, { ...hashes, "cases-index.json": undefined }), ["cases-index.json"]);
});
