// Exhibition ジョブの commit 前監査ガード（push 滞留事故の再発防止）のテスト。
// 実行: node --test scripts/lib/exhibition-guard.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { guardAudit, EXHIBITION_REVERT_GIT_ARGS } from "./exhibition-guard.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf-8");

test("EXHIBITION_REVERT_GIT_ARGS: 追跡ファイルは checkout、新規サムネのみ clean（既存追跡サムネは消さない）", () => {
  assert.deepEqual(EXHIBITION_REVERT_GIT_ARGS, [
    ["checkout", "--", "data/exhibition.json"],
    ["clean", "-fd", "public/thumbnails/exhibition"],
  ]);
});

test("guardAudit: 監査 exit 0 なら revert しない", () => {
  const calls = [];
  const r = guardAudit({ audit: () => ({ status: 0 }), revert: () => calls.push("revert") });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(calls, []);
});

test("guardAudit: 監査 FAIL（非0・実行不能 null）なら revert して ok=false", () => {
  for (const status of [1, 2, null]) {
    const calls = [];
    const r = guardAudit({ audit: () => ({ status }), revert: () => calls.push("revert") });
    assert.equal(r.ok, false);
    assert.deepEqual(calls, ["revert"]);
  }
});

function exhibitionBlock(src) {
  const a = src.indexOf("async function runExhibitionresearch");
  const b = src.indexOf("async function runIdeaseeds");
  assert.ok(a > 0 && b > a);
  return src.slice(a, b);
}

test("run-job.mjs: runExhibitionresearch は git add の前に監査、FAIL/非0終了で revert してエラー通知", () => {
  const blk = exhibitionBlock(read("scripts/windows/run-job.mjs"));
  const iAudit = blk.indexOf('scripts/audit-exhibition.mjs');
  const iAdd = blk.indexOf('runGit(["add", "data/exhibition.json"');
  assert.ok(iAudit > 0, "監査呼び出しが無い");
  assert.ok(iAdd > iAudit, "git add の前に監査すること");
  assert.match(blk, /guardAudit\(/);
  assert.match(blk, /revertExhibitionChanges\(\)/);
  // 非0終了の経路でも revert（エラー通知の前）
  const iFail = blk.indexOf("exh.status !== 0");
  assert.ok(iFail > 0 && blk.indexOf("revertExhibitionChanges()", iFail) > iFail && blk.indexOf("revertExhibitionChanges()", iFail) < blk.indexOf("--result", iFail));
  // 監査 FAIL はエラー通知に回す
  assert.match(blk, /guardAudit\([\s\S]*notifyError\(\)/);
  assert.match(blk, /"--result", "error"/);
  // 0件の verify-deploy 時間切れは routine
  assert.match(blk, /decideDeployTimeoutPriority\(/);
});

test("launchd exhibition plist: git add の前に audit-exhibition、FAIL 時は checkout/clean で戻して commit しない", () => {
  const src = read("launchd/com.researchman.exhibitionresearch.plist");
  const iAudit = src.indexOf("node scripts/audit-exhibition.mjs");
  const iAdd = src.indexOf("git add data/exhibition.json");
  assert.ok(iAudit > 0 && iAdd > iAudit);
  assert.match(src, /git checkout -- data\/exhibition\.json/);
  assert.match(src, /git clean -fd public\/thumbnails\/exhibition/);
  // 収集エラー（非0終了）経路でも revert
  const iErr = src.indexOf("収集エラー終了");
  assert.ok(src.indexOf("git checkout -- data/exhibition.json", iErr) > iErr);
});

test("tuneup plist / run-job tuneup: data/exhibition-profile.json を git add する", () => {
  assert.match(read("launchd/com.researchman.tuneup.plist"), /git add [^;]*data\/exhibition-profile\.json/);
  assert.match(read("scripts/windows/run-job.mjs"), /"data\/exhibition-profile\.json"/);
});

test("scripts/windows/README.md: ジョブ一覧に exhibitionresearch 行がある", () => {
  assert.match(read("scripts/windows/README.md"), /\|\s*`exhibitionresearch`\s*\|[^\n]*exhibitionresearch\.plist/);
});
