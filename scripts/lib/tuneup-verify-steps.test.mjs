// 週次見直しの検証ステップの組み立て（cc 段だけ短縮モードの env で呼ぶ）の単体テスト。
// 実行: node --test scripts/lib/tuneup-verify-steps.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVerifySteps } from "./tuneup-verify-steps.mjs";
import { CC_VERIFY_ENV_KEY } from "./case-lenses.mjs";

test("buildVerifySteps: cc 段だけ短縮モード env、他は呼び出しを変えない", async () => {
  const calls = [];
  const base = { PATH: "x" };
  const steps = buildVerifySteps((npmScript, opts) => {
    calls.push({ npmScript, opts });
    return Promise.resolve({ ok: true });
  }, base);
  assert.equal(steps.length, 4);
  for (const s of steps) await s();
  assert.deepEqual(calls.map((c) => c.npmScript), ["ideas:dry", "auto-research:tech:dry", "auto-research:cc:dry", "auto-research:exhibition:dry"]);
  assert.equal(calls[2].opts.env[CC_VERIFY_ENV_KEY], "1");
  assert.equal(calls[2].opts.env.PATH, "x");
  for (const i of [0, 1, 3]) assert.equal(calls[i].opts, undefined);
  assert.equal(base[CC_VERIFY_ENV_KEY], undefined);
});
