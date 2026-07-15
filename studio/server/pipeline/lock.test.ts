import assert from "node:assert/strict";
import { mkdirSync, rmSync, utimesSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireLockWithWait, isLockStale, releaseLock, resolveLock, tryAcquireLock, STALE_MS } from "./lock.js";

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

// ── resolveLock（adversarial-reviewer指摘#2: 「両方」でCase→Tech間にlockの
//    解放→再取得ギャップがあり、その間にデイリージョブがlockを奪える問題の再発防止） ──
test("resolveLock: externalLockが渡されたら再取得せずownsLock=falseで返す", () => {
  let acquireCalls = 0;
  const external = { release: () => {} };
  const result = resolveLock(external, () => {
    acquireCalls++;
    return { release: () => {} };
  });
  assert.equal(result.lock, external);
  assert.equal(result.ownsLock, false);
  assert.equal(acquireCalls, 0, "externalLockがあるときはacquire関数を呼んではいけない");
});

test("resolveLock: externalLock未指定ならacquireを呼びownsLock=trueで返す", () => {
  let acquireCalls = 0;
  const acquired = { release: () => {} };
  const result = resolveLock(undefined, () => {
    acquireCalls++;
    return acquired;
  });
  assert.equal(result.lock, acquired);
  assert.equal(result.ownsLock, true);
  assert.equal(acquireCalls, 1);
});

test("resolveLock: externalLock未指定でacquireがnullを返したらlock=null・ownsLock=true", () => {
  const result = resolveLock(undefined, () => null);
  assert.equal(result.lock, null);
  assert.equal(result.ownsLock, true);
});

// ── acquireLockWithWait（P5: 低優先ジョブは即時失敗ではなくポーリング待機する） ──

test("acquireLockWithWait: 空いていれば即座に取得できる（待機ゼロ回）", async () => {
  const p = tmpLockPath();
  try {
    let sleepCalls = 0;
    const handle = await acquireLockWithWait(p, { sleepImpl: async () => { sleepCalls++; } });
    assert.ok(handle);
    assert.equal(sleepCalls, 0);
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("acquireLockWithWait: 取得済みでも解放されればポーリングで取得できる", async () => {
  const p = tmpLockPath();
  mkdirSync(p);
  let sleepCalls = 0;
  const promise = acquireLockWithWait(p, {
    maxWaitMs: 100_000,
    sleepImpl: async () => {
      sleepCalls++;
      if (sleepCalls === 2) rmSync(p, { recursive: true, force: true });
    },
  });
  const handle = await promise;
  try {
    assert.ok(handle);
    assert.equal(sleepCalls, 2);
  } finally {
    if (handle) handle.release();
    rmSync(p, { recursive: true, force: true });
  }
});

test("acquireLockWithWait: maxWaitMsを超えたらnullを返す（取得できないまま）", async () => {
  const p = tmpLockPath();
  mkdirSync(p);
  try {
    let now = 0;
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      const handle = await acquireLockWithWait(p, {
        maxWaitMs: 50,
        intervalMs: 10,
        sleepImpl: async () => {
          now += 20;
        },
      });
      assert.equal(handle, null);
    } finally {
      Date.now = originalNow;
    }
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});
