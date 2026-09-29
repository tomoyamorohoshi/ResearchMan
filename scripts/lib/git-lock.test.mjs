// scripts/lib/git-lock.mjs の単体テスト（node:test）。
// 実行: node --test scripts/lib/git-lock.test.mjs
// 実ロック（os.tmpdir()/researchman-git.lock）には触れず、使い捨てパスで検証する。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import {
  STALE_MS,
  OWNER_FILE,
  isPidAlive,
  inspectLock,
  tryAcquire,
  isHeld,
  removeLockDir,
} from "./git-lock.mjs";

function tmpLock() {
  return path.join(os.tmpdir(), `researchman-gitlock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}
function cleanup(p) {
  fs.rmSync(p, { recursive: true, force: true });
}
// 確実に存在しないPIDを作る: 子プロセスを走らせて終了させ、そのPIDを使う
function deadPid() {
  const r = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf-8" });
  return Number(r.stdout);
}
function ageDir(p, ms) {
  const t = new Date(Date.now() - ms);
  fs.utimesSync(p, t, t);
}
function writeOwnerRaw(p, obj) {
  fs.writeFileSync(path.join(p, OWNER_FILE), typeof obj === "string" ? obj : JSON.stringify(obj));
}

test("isPidAlive: 自プロセスは生存・終了済みPIDは死亡・不正値は生存扱い(保守的)", () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(deadPid()), false);
  assert.equal(isPidAlive(NaN), true);
});

test("tryAcquire: 空きなら取得でき owner.json に pid/startedAt/label が入る", () => {
  const p = tmpLock();
  try {
    assert.equal(tryAcquire(p, "daily:test"), true);
    const owner = JSON.parse(fs.readFileSync(path.join(p, OWNER_FILE), "utf-8"));
    assert.equal(owner.pid, process.pid);
    assert.equal(owner.label, "daily:test");
    assert.ok(!Number.isNaN(Date.parse(owner.startedAt)));
  } finally {
    cleanup(p);
  }
});

test("tryAcquire: 生存PIDが保持中なら取得できない(待つ)", () => {
  const p = tmpLock();
  try {
    fs.mkdirSync(p);
    writeOwnerRaw(p, { pid: process.pid, startedAt: new Date().toISOString(), label: "x" });
    assert.equal(tryAcquire(p, "daily:other"), false);
    assert.equal(isHeld(p), true);
  } finally {
    cleanup(p);
  }
});

test("tryAcquire: 死亡PIDのロックは90分を待たず即時奪取し、ログを出す", () => {
  const p = tmpLock();
  const logs = [];
  try {
    const pid = deadPid();
    fs.mkdirSync(p);
    writeOwnerRaw(p, { pid, startedAt: new Date().toISOString(), label: "daily:auto" });
    assert.equal(isHeld(p), false); // 空き扱い
    assert.equal(tryAcquire(p, "studio:case", { log: (m) => logs.push(m) }), true);
    const owner = JSON.parse(fs.readFileSync(path.join(p, OWNER_FILE), "utf-8"));
    assert.equal(owner.pid, process.pid);
    assert.equal(owner.label, "studio:case");
    assert.ok(logs.some((m) => m.includes(`死亡ロック奪取: pid=${pid} label=daily:auto`)), logs.join("|"));
  } finally {
    cleanup(p);
  }
});

test("旧形式(owner.jsonなし): 新しければ保持中・90分超ならstaleとして奪取(非空でなくても動く)", () => {
  const p = tmpLock();
  try {
    fs.mkdirSync(p);
    assert.equal(tryAcquire(p, "a"), false);
    assert.equal(isHeld(p), true);
    ageDir(p, STALE_MS + 60_000);
    assert.equal(isHeld(p), false);
    assert.equal(tryAcquire(p, "a"), true);
  } finally {
    cleanup(p);
  }
});

test("owner.jsonが壊れている/pid不正(書き込み途中): mtimeフォールバック", () => {
  for (const raw of ["{\"pid\":12", "", "null", JSON.stringify({ pid: "abc" }), JSON.stringify({ pid: -5 })]) {
    const p = tmpLock();
    try {
      fs.mkdirSync(p);
      writeOwnerRaw(p, raw);
      assert.equal(inspectLock(p).state, "held", `新しい壊れowner: ${raw}`);
      assert.equal(tryAcquire(p, "a"), false);
      ageDir(p, STALE_MS + 60_000);
      assert.equal(inspectLock(p).state, "stale", `古い壊れowner: ${raw}`);
      assert.equal(tryAcquire(p, "a"), true, `古い壊れownerは奪取: ${raw}`);
    } finally {
      cleanup(p);
    }
  }
});

test("非空ロックディレクトリ(owner.json入り)でも stale なら奪取できる(素のrmdirだと失敗するケース)", () => {
  const p = tmpLock();
  try {
    fs.mkdirSync(p);
    writeOwnerRaw(p, { pid: process.pid, startedAt: new Date().toISOString(), label: "x" });
    ageDir(p, STALE_MS + 60_000); // 生存PIDでも90分超はPID再利用対策でstale扱い
    assert.equal(tryAcquire(p, "y"), true);
  } finally {
    cleanup(p);
  }
});

test("removeLockDir: owner.jsonを消してからrmdirする。存在しなくても例外を投げない", () => {
  const p = tmpLock();
  try {
    assert.equal(tryAcquire(p, "a"), true);
    removeLockDir(p);
    assert.equal(fs.existsSync(p), false);
    removeLockDir(p); // 二重解放OK
  } finally {
    cleanup(p);
  }
});

test("inspectLock: ロック無しはfree", () => {
  assert.equal(inspectLock(tmpLock()).state, "free");
  assert.equal(isHeld(tmpLock()), false);
});
