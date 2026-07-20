// scripts/lib/studio-keeper-core.mjs の純関数部分の単体テスト（node:test）。
// 実行: node --test scripts/lib/studio-keeper-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseListeningPids,
  appendIncident,
  shouldRotate,
  toJstIsoString,
  retryCheckAlive,
  buildIncidentsFileContent,
  writeJsonAtomicSync,
} from "./studio-keeper-core.mjs";

const NETSTAT_SAMPLE = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:5178           0.0.0.0:0              LISTENING       105884
  TCP    [::]:5178              [::]:0                 LISTENING       105884
  TCP    127.0.0.1:51780        127.0.0.1:54321        ESTABLISHED     22222
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       9999
  UDP    0.0.0.0:5353           *:*                                    4444
`;

test("parseListeningPids: port 5178をLISTENしているPIDを重複なく返す（IPv4/IPv6の重複は1件）", () => {
  assert.deepEqual(parseListeningPids(NETSTAT_SAMPLE, 5178), ["105884"]);
});

test("parseListeningPids: 5178と51780を混同しない（前方一致ではなく厳密一致）", () => {
  assert.equal(parseListeningPids(NETSTAT_SAMPLE, 51780).includes("105884"), false);
  // 51780はESTABLISHEDでLISTENINGではないため対象外
  assert.deepEqual(parseListeningPids(NETSTAT_SAMPLE, 51780), []);
});

test("parseListeningPids: 該当ポートがLISTENINGで無ければ空配列", () => {
  assert.deepEqual(parseListeningPids(NETSTAT_SAMPLE, 8080), []);
});

test("parseListeningPids: 空文字列・undefinedは空配列（例外を投げない）", () => {
  assert.deepEqual(parseListeningPids("", 5178), []);
  assert.deepEqual(parseListeningPids(undefined, 5178), []);
});

test("appendIncident: 既存配列にインシデントを追記した新しい配列を返す", () => {
  const existing = [{ at: "2026-07-01T00:00:00+09:00", kind: "studio-down", recovered: true, detail: "a" }];
  const incident = { at: "2026-07-21T03:00:00+09:00", kind: "studio-down", recovered: true, detail: "b" };
  const result = appendIncident(existing, incident);
  assert.equal(result.length, 2);
  assert.deepEqual(result[1], incident);
  // 元配列を破壊しない
  assert.equal(existing.length, 1);
});

test("appendIncident: 既存がundefined/nullなら新規配列として扱う", () => {
  const incident = { at: "2026-07-21T03:00:00+09:00", kind: "studio-down", recovered: false, detail: "x" };
  assert.deepEqual(appendIncident(undefined, incident), [incident]);
  assert.deepEqual(appendIncident(null, incident), [incident]);
});

test("shouldRotate: サイズが上限超なら true", () => {
  assert.equal(shouldRotate(11 * 1024 * 1024, 10 * 1024 * 1024), true);
});

test("shouldRotate: サイズが上限以下なら false（境界は超過のみtrue）", () => {
  assert.equal(shouldRotate(10 * 1024 * 1024, 10 * 1024 * 1024), false);
  assert.equal(shouldRotate(1024, 10 * 1024 * 1024), false);
});

test("toJstIsoString: UTCエポックからJST(+09:00)表記のISO文字列を組み立てる", () => {
  // 2026-07-20T18:00:00Z = 2026-07-21T03:00:00+09:00
  const d = new Date(Date.UTC(2026, 6, 20, 18, 0, 0));
  assert.equal(toJstIsoString(d), "2026-07-21T03:00:00+09:00");
});

test("toJstIsoString: 秒未満は切り捨てる（ミリ秒を含めない）", () => {
  const d = new Date(Date.UTC(2026, 6, 20, 18, 0, 0, 500));
  assert.equal(toJstIsoString(d), "2026-07-21T03:00:00+09:00");
});

test("retryCheckAlive: 1回目成功なら即true、checkAliveは1回だけ・sleepは呼ばれない", async () => {
  let checkAliveCalls = 0;
  const checkAlive = async () => {
    checkAliveCalls += 1;
    return true;
  };
  const sleepCalls = [];
  const sleep = async (ms) => {
    sleepCalls.push(ms);
  };
  const result = await retryCheckAlive(checkAlive, sleep, 3, 10000);
  assert.equal(result, true);
  assert.equal(checkAliveCalls, 1);
  assert.deepEqual(sleepCalls, []);
});

test("retryCheckAlive: 1,2回目失敗・3回目成功ならtrue、checkAliveは3回呼ばれる", async () => {
  let checkAliveCalls = 0;
  const checkAlive = async () => {
    checkAliveCalls += 1;
    return checkAliveCalls === 3;
  };
  const sleepCalls = [];
  const sleep = async (ms) => {
    sleepCalls.push(ms);
  };
  const result = await retryCheckAlive(checkAlive, sleep, 3, 10000);
  assert.equal(result, true);
  assert.equal(checkAliveCalls, 3);
  // 1,2回目失敗の直後にだけsleepする（3回目成功後はsleepしない）
  assert.deepEqual(sleepCalls, [10000, 10000]);
});

test("retryCheckAlive: 3回とも失敗ならfalse、checkAliveは3回呼ばれる", async () => {
  let checkAliveCalls = 0;
  const checkAlive = async () => {
    checkAliveCalls += 1;
    return false;
  };
  const sleepCalls = [];
  const sleep = async (ms) => {
    sleepCalls.push(ms);
  };
  const result = await retryCheckAlive(checkAlive, sleep, 3, 10000);
  assert.equal(result, false);
  assert.equal(checkAliveCalls, 3);
  // 最後（3回目）の試行の後はsleepしない
  assert.deepEqual(sleepCalls, [10000, 10000]);
});

test("buildIncidentsFileContent: incidents配列をJSON文字列＋改行に組み立てる純関数", () => {
  const incidents = [
    { at: "2026-07-21T03:00:00+09:00", kind: "studio-down", recovered: true, detail: "x" },
  ];
  const content = buildIncidentsFileContent(incidents);
  assert.equal(content, `${JSON.stringify(incidents, null, 2)}\n`);
});

test("writeJsonAtomicSync: 書き込み後に正しい内容がJSON.parseで読める", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-keeper-core-test-"));
  try {
    const filePath = path.join(dir, "incidents.json");
    const incidents = appendIncident(
      [],
      { at: "2026-07-21T03:00:00+09:00", kind: "studio-down", recovered: true, detail: "x" },
    );
    writeJsonAtomicSync(filePath, buildIncidentsFileContent(incidents));
    const read = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    assert.deepEqual(read, incidents);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeJsonAtomicSync: rename方式のため一時ファイルが最終的に残らない", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-keeper-core-test-"));
  try {
    const filePath = path.join(dir, "incidents.json");
    writeJsonAtomicSync(filePath, "[]\n");
    const entries = fs.readdirSync(dir);
    assert.deepEqual(entries, ["incidents.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
