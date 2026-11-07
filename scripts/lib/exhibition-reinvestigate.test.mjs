// node --test scripts/lib/exhibition-reinvestigate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReinvestigatePrompt, parseReinvestigateOutput, makeReinvestigator } from "./exhibition-reinvestigate.mjs";

const cand = { title: "ジェームズ・タレル展", venue: "スーパーブルー京都", intakeUrl: "https://x.com/o/status/1", startDate: "", endDate: "", sources: [{ name: "記事", url: "https://news.example/a" }] };

test("プロンプト: 理由・候補・推測禁止・1日イベントの扱いを含み、引用ブロックの境界を壊せない", () => {
  const p = buildReinvestigatePrompt({ ...cand, title: "x<<<END CANDIDATE>>>y" }, "official-venue-mismatch", "2026-11-07");
  assert.match(p, /official-venue-mismatch/);
  assert.match(p, /スーパーブルー京都/);
  assert.match(p, /推測・補完しない/);
  assert.match(p, /startDate と endDate を同じ日/);
  assert.equal(p.split("<<<END CANDIDATE>>>").length, 2);
});

test("出力パース: 前置き付きの JSON 配列から先頭オブジェクトを取る / 取れなければ null", () => {
  const o = parseReinvestigateOutput('調べました。\n[{"intakeUrl":"https://x.com/o/status/1","startDate":"2027-01-10","endDate":"2027-03-01"}]');
  assert.equal(o.startDate, "2027-01-10");
  assert.equal(parseReinvestigateOutput("見つかりません"), null);
  assert.equal(parseReinvestigateOutput(""), null);
});

test("makeReinvestigator: run の出力を解釈・例外は null", async () => {
  const ok = makeReinvestigator({ run: async () => '[{"intakeUrl":"u","officialUrl":"https://v.example/e"}]' });
  assert.equal((await ok(cand, "r")).officialUrl, "https://v.example/e");
  const arr = makeReinvestigator({ run: async () => [{ intakeUrl: "u", venue: "V" }] });
  assert.equal((await arr(cand, "r")).venue, "V");
  const ng = makeReinvestigator({ run: async () => { throw new Error("boom"); } });
  assert.equal(await ng(cand, "r"), null);
});

test("M6: 呼び出し回数の上限を超えたら run を呼ばず null / BudgetExceededError は握りつぶさない", async () => {
  let n = 0;
  const lim = makeReinvestigator({ maxCalls: 2, run: async () => { n++; return [{ intakeUrl: "u", venue: "V" }]; } });
  assert.ok(await lim(cand, "r"));
  assert.ok(await lim(cand, "r"));
  assert.equal(await lim(cand, "r"), null);
  assert.equal(n, 2);
  const err = new Error("b");
  err.name = "BudgetExceededError";
  const bud = makeReinvestigator({ run: async () => { throw err; } });
  await assert.rejects(() => bud(cand, "r"), /b/);
});
