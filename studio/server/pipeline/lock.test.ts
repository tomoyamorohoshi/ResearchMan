import assert from "node:assert/strict";
import { mkdirSync, rmSync, utimesSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireLockWithWait, isLockHeld, isLockStale, releaseLock, resolveLock, tryAcquireLock, STALE_MS } from "./lock.js";

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

// ── isLockHeld（pipeline/jobQueue.ts のワーカーが使う読み取り専用peek） ─────────

test("isLockHeld: ロックが存在しなければfalse", () => {
  const p = tmpLockPath();
  assert.equal(isLockHeld(p), false);
});

test("isLockHeld: ロックが存在し新しければtrue", () => {
  const p = tmpLockPath();
  mkdirSync(p);
  try {
    assert.equal(isLockHeld(p), true);
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("isLockHeld: ロックが存在してもstale（閾値超過）ならfalse", () => {
  const p = tmpLockPath();
  mkdirSync(p);
  const staleTime = new Date(Date.now() - STALE_MS - 60_000);
  utimesSync(p, staleTime, staleTime);
  try {
    assert.equal(isLockHeld(p), false);
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("isLockHeld: mkdir/rmdirなどの副作用を一切起こさない（peek後も存在有無が変わらない）", () => {
  const p = tmpLockPath();
  // 存在しない状態でpeekしても作られない
  isLockHeld(p);
  assert.equal(existsSync(p), false);
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

// ── owner.json（PID死活）対応: 保持プロセスが強制死したロックを90分待たず救済する ──
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { inspectLock } from "../../../scripts/lib/git-lock.mjs";

function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf-8" });
  return Number(r.stdout);
}
function ownerJson(pid: number, label = "daily:auto"): string {
  return JSON.stringify({ pid, startedAt: new Date().toISOString(), label });
}
function age(p: string, ms: number): void {
  const t = new Date(Date.now() - ms);
  utimesSync(p, t, t);
}

test("tryAcquireLock: 取得時に owner.json(pid/startedAt/label)を書き、release で消えてディレクトリも消える", () => {
  const p = tmpLockPath();
  try {
    const handle = tryAcquireLock(p, "studio:test");
    assert.ok(handle);
    const owner = JSON.parse(readFileSync(path.join(p, "owner.json"), "utf-8"));
    assert.equal(owner.pid, process.pid);
    assert.equal(owner.label, "studio:test");
    handle.release();
    assert.equal(existsSync(p), false);
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("tryAcquireLock/isLockHeld: 死亡PIDのロックは90分待たず即時奪取・空き扱い", () => {
  const p = tmpLockPath();
  mkdirSync(p);
  writeFileSync(path.join(p, "owner.json"), ownerJson(deadPid()));
  try {
    assert.equal(isLockHeld(p), false);
    const handle = tryAcquireLock(p, "studio:case");
    assert.ok(handle);
    assert.equal(JSON.parse(readFileSync(path.join(p, "owner.json"), "utf-8")).pid, process.pid);
    handle.release();
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("tryAcquireLock/isLockHeld: 生存PIDのロックは待つ(取得不可・保持中)", () => {
  const p = tmpLockPath();
  mkdirSync(p);
  writeFileSync(path.join(p, "owner.json"), ownerJson(process.pid));
  try {
    assert.equal(isLockHeld(p), true);
    assert.equal(tryAcquireLock(p), null);
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("旧形式/壊れたowner.json(書き込み途中): mtime90分ルールにフォールバック", () => {
  for (const raw of [null, "{\"pid\":1", ""]) {
    const p = tmpLockPath();
    mkdirSync(p);
    if (raw !== null) writeFileSync(path.join(p, "owner.json"), raw);
    try {
      assert.equal(isLockHeld(p), true);
      assert.equal(tryAcquireLock(p), null);
      age(p, STALE_MS + 60_000);
      assert.equal(isLockHeld(p), false);
      const handle = tryAcquireLock(p);
      assert.ok(handle, `古い壊れownerは奪取: ${String(raw)}`);
      handle.release();
    } finally {
      rmSync(p, { recursive: true, force: true });
    }
  }
});

test("非空ロックディレクトリ(owner.json入り)のstaleも奪取・releaseできる", () => {
  const p = tmpLockPath();
  mkdirSync(p);
  writeFileSync(path.join(p, "owner.json"), ownerJson(process.pid));
  age(p, STALE_MS + 60_000);
  try {
    const handle = tryAcquireLock(p);
    assert.ok(handle);
    handle.release();
    assert.equal(existsSync(p), false);
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("lock.ts と scripts/lib/git-lock.mjs(run-job.mjs が使う実装)は同じ判定になる", () => {
  const cases: Array<{ name: string; setup: (p: string) => void; held: boolean }> = [
    { name: "死亡PID", setup: (p) => writeFileSync(path.join(p, "owner.json"), ownerJson(deadPid())), held: false },
    { name: "生存PID", setup: (p) => writeFileSync(path.join(p, "owner.json"), ownerJson(process.pid)), held: true },
    { name: "旧形式(新しい)", setup: () => {}, held: true },
    { name: "壊れowner(新しい)", setup: (p) => writeFileSync(path.join(p, "owner.json"), "{"), held: true },
    { name: "旧形式(古い)", setup: (p) => age(p, STALE_MS + 60_000), held: false },
  ];
  for (const c of cases) {
    const p = tmpLockPath();
    mkdirSync(p);
    c.setup(p);
    try {
      assert.equal(isLockHeld(p), c.held, c.name);
      assert.equal(inspectLock(p).state === "held", c.held, `${c.name}(mjs)`);
    } finally {
      rmSync(p, { recursive: true, force: true });
    }
  }
});
