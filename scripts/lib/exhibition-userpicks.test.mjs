// scripts/lib/exhibition-userpicks.mjs の単体テスト。実行: node --test scripts/lib/exhibition-userpicks.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyUserPicks, userPicksPromptBlock, USER_PICKS_MAX } from "./exhibition-userpicks.mjs";
import { profileForPrompt, buildDiscoveryPrompt, buildIntakePrompt } from "./exhibition-prompts.mjs";

const pick = (n, over = {}) => ({ title: `展${n}`, venue: `会場${n}`, tags: ["installation"], why: `理由${n}`, addedAt: `2026-10-${String(n).padStart(2, "0")}T00:00:00.000Z`, ...over });
const base = () => ({ likes: { themes: [] }, watch: { artists: [], venues: [] }, scoring: { threshold: { add: 60 } } });

test("applyUserPicks: 追加（likes.userPicks 新設）・入力は変更しない", () => {
  const p = base();
  const n = applyUserPicks(p, [pick(1)]);
  assert.equal(n.likes.userPicks.length, 1);
  assert.equal(p.likes.userPicks, undefined);
});

test(`applyUserPicks: 最大${USER_PICKS_MAX}件・古いものから押し出し`, () => {
  let p = base();
  for (let i = 1; i <= 12; i++) p = applyUserPicks(p, [pick(i)]);
  assert.equal(p.likes.userPicks.length, USER_PICKS_MAX);
  assert.equal(p.likes.userPicks[0].title, "展3");
  assert.equal(p.likes.userPicks.at(-1).title, "展12");
});

test("applyUserPicks: 同題・同会場は重複追加しない / 空配列は同一内容", () => {
  const p = applyUserPicks(base(), [pick(1)]);
  assert.equal(applyUserPicks(p, [pick(1, { why: "別" })]).likes.userPicks.length, 1);
  assert.deepEqual(applyUserPicks(p, []), p);
});

test("applyUserPicks: why は改行を潰して200字に切る", () => {
  const n = applyUserPicks(base(), [pick(1, { why: "a\nb\r\n" + "x".repeat(300) })]);
  assert.ok(!/[\r\n]/.test(n.likes.userPicks[0].why));
  assert.equal(n.likes.userPicks[0].why.length, 200);
});

test("applyUserPicks: 不正な要素（title/why 欠落）は捨てる", () => {
  const n = applyUserPicks(base(), [{ title: "", venue: "v", why: "w" }, null, pick(2)]);
  assert.equal(n.likes.userPicks.length, 1);
});

test("profileForPrompt は userPicks を含めない / discovery プロンプトだけが例として渡す", () => {
  const p = applyUserPicks({ ...base(), scope: "s", exclusions: {}, scoring: { threshold: { add: 60 }, components: [] } }, [pick(1, { why: "UNIQUE-WHY" })]);
  assert.ok(!profileForPrompt(p).includes("UNIQUE-WHY"));
  const d = buildDiscoveryPrompt({ profile: p, today: "2026-10-24", sourceList: [], queries: [], existingTitles: [], seenThisRun: [] });
  assert.ok(d.includes("UNIQUE-WHY") && d.includes("user_pick_similarity") && d.includes("最大 +10") && d.includes("userPickBoost") && d.includes("含めない"));
  const i = buildIntakePrompt([{ url: "https://x.com/a/status/1", text: "t" }], p, "2026-10-24");
  assert.ok(!i.includes("UNIQUE-WHY") && i.includes("pickWhy"));
  assert.equal(userPicksPromptBlock(base()), "");
});
