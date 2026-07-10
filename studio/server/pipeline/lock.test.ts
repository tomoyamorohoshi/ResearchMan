import assert from "node:assert/strict";
import { mkdirSync, rmSync, utimesSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isLockStale, releaseLock, tryAcquireLock, STALE_MS } from "./lock.js";

function tmpLockPath(): string {
  return path.join(os.tmpdir(), `researchman-studio-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

test("isLockStale: 閾値以内はfalse", () => {
  const now = 1_000_000;
  assert.equal(isLockStale(now - 1000, now, STALE_MS), false);
});

test("isLockStale: 閾値超過はtrue", () => {
  const now = 1_000_000;
  assert.equal(isLockStale(now - STALE_MS - 1, now, STALE_MS), true);
});

test("tryAcquireLock: ロックが無ければ取得できる", () => {
  const p = tmpLockPath();
  try {
    const handle = tryAcquireLock(p);
    assert.ok(handle);
    assert.ok(existsSync(p));
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("tryAcquireLock: 既に取得済みなら即座にnull（待機しない）", () => {
  const p = tmpLockPath();
  mkdirSync(p);
  try {
    const handle = tryAcquireLock(p);
    assert.equal(handle, null);
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("tryAcquireLock: stale（閾値超過）なロックは奪取できる", () => {
  const p = tmpLockPath();
  mkdirSync(p);
  const staleTime = new Date(Date.now() - STALE_MS - 60_000);
  utimesSync(p, staleTime, staleTime);
  try {
    const handle = tryAcquireLock(p);
    assert.ok(handle);
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("releaseLock: 解放後は再取得できる", () => {
  const p = tmpLockPath();
  const handle = tryAcquireLock(p);
  assert.ok(handle);
  handle?.release();
  assert.equal(existsSync(p), false);
  const second = tryAcquireLock(p);
  assert.ok(second);
  releaseLock(p);
});

test("releaseLock: 存在しないパスを渡しても例外を投げない", () => {
  assert.doesNotThrow(() => releaseLock(tmpLockPath()));
});
