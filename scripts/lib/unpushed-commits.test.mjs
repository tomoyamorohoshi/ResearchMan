// scripts/lib/unpushed-commits.mjs の単体テスト（node:test）。
// 実行: node --test scripts/lib/unpushed-commits.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  AUDIT_SCRIPTS,
  truncateOutput,
  findFirstAuditFailure,
  staleDaysSince,
  unpushedReasonKey,
  shouldNotifyUnpushed,
  readUnpushedStateSafe,
  writeUnpushedState,
  buildUnpushedAuditPassReport,
  buildUnpushedAuditFailReport,
  appendIncidentSafe,
} from "./unpushed-commits.mjs";

test("AUDIT_SCRIPTS: pre-pushの4監査と同じ順序", () => {
  assert.deepEqual(AUDIT_SCRIPTS, [
    "audit-cannes.mjs",
    "audit-thumbnails.mjs",
    "audit-tech.mjs",
    "check-idea-layouts-freshness.mjs",
  ]);
});

test("truncateOutput: maxLines以下ならそのまま", () => {
  assert.equal(truncateOutput("a\nb\nc", 20), "a\nb\nc");
});

test("truncateOutput: maxLines超は末尾N行のみ", () => {
  const text = Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n");
  const out = truncateOutput(text, 20);
  const lines = out.split("\n");
  assert.equal(lines.length, 20);
  assert.equal(lines[0], "line10");
  assert.equal(lines[19], "line29");
});

test("truncateOutput: 空/undefinedは空文字", () => {
  assert.equal(truncateOutput(undefined), "");
  assert.equal(truncateOutput(""), "");
});

test("findFirstAuditFailure: 全通過ならallPassed=true", () => {
  const results = [
    { script: "audit-cannes.mjs", status: 0, stdout: "", stderr: "" },
    { script: "audit-thumbnails.mjs", status: 0, stdout: "", stderr: "" },
  ];
  const r = findFirstAuditFailure(results);
  assert.equal(r.allPassed, true);
  assert.equal(r.failedScript, null);
  assert.equal(r.excerpt, "");
});

test("findFirstAuditFailure: 最初の非0を検知する", () => {
  const results = [
    { script: "audit-cannes.mjs", status: 0, stdout: "ok", stderr: "" },
    { script: "audit-thumbnails.mjs", status: 1, stdout: "out1", stderr: "err1" },
    { script: "audit-tech.mjs", status: 1, stdout: "out2", stderr: "err2" },
  ];
  const r = findFirstAuditFailure(results);
  assert.equal(r.allPassed, false);
  assert.equal(r.failedScript, "audit-thumbnails.mjs");
  assert.match(r.excerpt, /out1/);
  assert.match(r.excerpt, /err1/);
  assert.doesNotMatch(r.excerpt, /out2/);
});

test("findFirstAuditFailure: 空配列はallPassed=true", () => {
  assert.equal(findFirstAuditFailure([]).allPassed, true);
});

test("findFirstAuditFailure: タイムアウト（status=null, signal=SIGTERM）はtimeoutSuspected=true", () => {
  const results = [
    { script: "audit-cannes.mjs", status: null, signal: "SIGTERM", error: null, stdout: "", stderr: "" },
  ];
  const r = findFirstAuditFailure(results);
  assert.equal(r.allPassed, false);
  assert.equal(r.failedScript, "audit-cannes.mjs");
  assert.equal(r.timeoutSuspected, true);
});

test("findFirstAuditFailure: spawnSync自体が例外エラーを返した場合もtimeoutSuspected=true", () => {
  const results = [
    { script: "audit-cannes.mjs", status: null, signal: null, error: "ENOBUFS", stdout: "", stderr: "" },
  ];
  const r = findFirstAuditFailure(results);
  assert.equal(r.timeoutSuspected, true);
});

test("findFirstAuditFailure: 通常の非0終了（status=1）はtimeoutSuspected=false", () => {
  const results = [
    { script: "audit-cannes.mjs", status: 1, signal: null, error: null, stdout: "out", stderr: "err" },
  ];
  const r = findFirstAuditFailure(results);
  assert.equal(r.allPassed, false);
  assert.equal(r.timeoutSuspected, false);
});

test("staleDaysSince: 経過日数を整数で返す", () => {
  const now = new Date("2026-08-07T00:00:00+09:00").getTime();
  assert.equal(staleDaysSince("2026-08-01T00:00:00+09:00", now), 6);
});

test("staleDaysSince: 不正な日付はnull（例外を投げない）", () => {
  assert.equal(staleDaysSince("not-a-date", Date.now()), null);
  assert.equal(staleDaysSince(null, Date.now()), null);
});

test("unpushedReasonKey: 監査失敗はaudit-fail:<script>", () => {
  assert.equal(
    unpushedReasonKey({ allPassed: false, failedScript: "audit-tech.mjs", pushOk: undefined }),
    "audit-fail:audit-tech.mjs"
  );
});

test("unpushedReasonKey: 監査通過+push成功はpush-ok", () => {
  assert.equal(unpushedReasonKey({ allPassed: true, failedScript: null, pushOk: true }), "push-ok");
});

test("unpushedReasonKey: 監査通過+push失敗はpush-fail", () => {
  assert.equal(unpushedReasonKey({ allPassed: true, failedScript: null, pushOk: false }), "push-fail");
});

test("shouldNotifyUnpushed: 前回通知記録が無ければtrue", () => {
  assert.equal(shouldNotifyUnpushed({}, "audit-fail:audit-tech.mjs", "2026-08-07"), true);
  assert.equal(shouldNotifyUnpushed(null, "audit-fail:audit-tech.mjs", "2026-08-07"), true);
});

test("shouldNotifyUnpushed: 理由が変われば同日でもtrue", () => {
  const prev = { lastReason: "audit-fail:audit-cannes.mjs", lastNotifiedYmd: "2026-08-07" };
  assert.equal(shouldNotifyUnpushed(prev, "audit-fail:audit-tech.mjs", "2026-08-07"), true);
});

test("shouldNotifyUnpushed: 日付が変われば同一理由でもtrue", () => {
  const prev = { lastReason: "audit-fail:audit-tech.mjs", lastNotifiedYmd: "2026-08-06" };
  assert.equal(shouldNotifyUnpushed(prev, "audit-fail:audit-tech.mjs", "2026-08-07"), true);
});

test("shouldNotifyUnpushed: 同一理由・同日はfalse（重複抑制）", () => {
  const prev = { lastReason: "audit-fail:audit-tech.mjs", lastNotifiedYmd: "2026-08-07" };
  assert.equal(shouldNotifyUnpushed(prev, "audit-fail:audit-tech.mjs", "2026-08-07"), false);
});

test("shouldNotifyUnpushed: reasonKeyがpush-okなら同一理由・同日でも常にtrue（抑制対象外）", () => {
  const prev = { lastReason: "push-ok", lastNotifiedYmd: "2026-08-07" };
  assert.equal(shouldNotifyUnpushed(prev, "push-ok", "2026-08-07"), true);
});

test("shouldNotifyUnpushed: push-fail/audit-failは引き続き同一理由・同日で抑制される", () => {
  const prev = { lastReason: "push-fail", lastNotifiedYmd: "2026-08-07" };
  assert.equal(shouldNotifyUnpushed(prev, "push-fail", "2026-08-07"), false);
});

test("readUnpushedStateSafe: ファイルが無ければ空オブジェクト（例外を投げない）", () => {
  const missingPath = path.join(os.tmpdir(), `researchman-unpushed-state-missing-${Date.now()}.json`);
  assert.deepEqual(readUnpushedStateSafe(missingPath), {});
});

test("writeUnpushedState → readUnpushedStateSafe: 書き込んだ内容を読み戻せる", () => {
  const tmpPath = path.join(os.tmpdir(), `researchman-unpushed-state-${Date.now()}.json`);
  try {
    const ok = writeUnpushedState(tmpPath, { lastReason: "audit-fail:audit-tech.mjs", lastNotifiedYmd: "2026-08-07" });
    assert.equal(ok, true);
    assert.deepEqual(readUnpushedStateSafe(tmpPath), {
      lastReason: "audit-fail:audit-tech.mjs",
      lastNotifiedYmd: "2026-08-07",
    });
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
});

test("buildUnpushedAuditPassReport: push成功", () => {
  const text = buildUnpushedAuditPassReport({
    unpushedCount: 3,
    oldestCommitAt: "2026-07-31T10:00:00+09:00",
    pushResult: { ok: true },
  });
  assert.match(text, /3件/);
  assert.match(text, /push成功/);
});

test("buildUnpushedAuditPassReport: push失敗", () => {
  const text = buildUnpushedAuditPassReport({
    unpushedCount: 3,
    oldestCommitAt: "2026-07-31T10:00:00+09:00",
    pushResult: { ok: false, reason: "非fast-forward" },
  });
  assert.match(text, /🚨/);
  assert.match(text, /非fast-forward/);
});

test("buildUnpushedAuditFailReport: 失敗スクリプト名・抜粋・滞留日数・対処ヒントを含む", () => {
  const text = buildUnpushedAuditFailReport({
    unpushedCount: 11,
    oldestCommitAt: "2026-07-31T10:00:00+09:00",
    staleDays: 7,
    failedScript: "audit-tech.mjs",
    excerpt: "✗ some failure line",
  });
  assert.match(text, /11件/);
  assert.match(text, /7日/);
  assert.match(text, /audit-tech\.mjs/);
  assert.match(text, /✗ some failure line/);
  assert.match(text, /node scripts\/audit-tech\.mjs/);
});

test("buildUnpushedAuditFailReport: timeoutSuspected=trueならタイムアウトの可能性を示すヒントを含む", () => {
  const text = buildUnpushedAuditFailReport({
    unpushedCount: 11,
    oldestCommitAt: "2026-07-31T10:00:00+09:00",
    staleDays: 7,
    failedScript: "audit-tech.mjs",
    excerpt: "",
    timeoutSuspected: true,
  });
  assert.match(text, /タイムアウト/);
});

test("buildUnpushedAuditFailReport: timeoutSuspected未指定/falseならタイムアウト文言を含まない", () => {
  const text = buildUnpushedAuditFailReport({
    unpushedCount: 11,
    oldestCommitAt: "2026-07-31T10:00:00+09:00",
    staleDays: 7,
    failedScript: "audit-tech.mjs",
    excerpt: "",
  });
  assert.doesNotMatch(text, /タイムアウト/);
});

test("appendIncidentSafe: 既存配列にappendして書き込む", () => {
  const tmpPath = path.join(os.tmpdir(), `researchman-incidents-${Date.now()}.json`);
  try {
    fs.writeFileSync(tmpPath, JSON.stringify([{ at: "2026-01-01T00:00:00+09:00", kind: "studio-down", recovered: true, detail: "x" }]));
    const ok = appendIncidentSafe(tmpPath, { at: "2026-08-07T00:00:00+09:00", kind: "unpushed-commits", recovered: false, detail: "y" });
    assert.equal(ok, true);
    const arr = JSON.parse(fs.readFileSync(tmpPath, "utf-8"));
    assert.equal(arr.length, 2);
    assert.equal(arr[1].kind, "unpushed-commits");
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
});

test("appendIncidentSafe: ファイルが無ければ新規配列として作成する", () => {
  const missingPath = path.join(os.tmpdir(), `researchman-incidents-missing-${Date.now()}.json`);
  try {
    const ok = appendIncidentSafe(missingPath, { at: "2026-08-07T00:00:00+09:00", kind: "unpushed-commits", recovered: false, detail: "z" });
    assert.equal(ok, true);
    const arr = JSON.parse(fs.readFileSync(missingPath, "utf-8"));
    assert.equal(arr.length, 1);
  } finally {
    fs.rmSync(missingPath, { force: true });
  }
});
