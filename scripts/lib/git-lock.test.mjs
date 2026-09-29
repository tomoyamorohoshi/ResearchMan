// scripts/lib/git-lock.mjs の単体テスト（node:test）。
// 実行: node --test scripts/lib/git-lock.test.mjs
// 実ロック（os.tmpdir()/researchman-git.lock）には触れず、使い捨てパスで検証する。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import {
  STALE_MS,
  OWNER_FILE,
  isPidAlive,
  inspectLock,
  tryAcquire,
  isHeld,
  removeLockDir,
  cleanupStaleLock,
  releaseOwnedLock,
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

test("cleanupStaleLock: owner.json入りの古いロック/死亡PIDロックを掃除し、保持中・無しは触らない", () => {
  const p = tmpLock();
  try {
    assert.equal(cleanupStaleLock(p), null); // 無し
    fs.mkdirSync(p);
    writeOwnerRaw(p, { pid: process.pid, startedAt: new Date().toISOString(), label: "x" });
    assert.equal(cleanupStaleLock(p), null); // 保持中
    assert.ok(fs.existsSync(p));
    ageDir(p, STALE_MS + 60_000);
    assert.equal(cleanupStaleLock(p).state, "stale"); // 非空でも掃除
    assert.equal(fs.existsSync(p), false);
    fs.mkdirSync(p);
    writeOwnerRaw(p, { pid: deadPid(), startedAt: new Date().toISOString(), label: "x" });
    assert.equal(cleanupStaleLock(p).state, "dead");
    assert.equal(fs.existsSync(p), false);
  } finally {
    cleanup(p);
  }
});

// ── 同時奪取レース: 死亡/staleロックを複数プロセスが同時に奪いに来ても勝者は常に1 ──
const LIB_URL = pathToFileURL(fileURLToPath(new URL("./git-lock.mjs", import.meta.url))).href;
if (process.argv[2] === "race-child") {
  const { tryAcquire: acq, releaseOwnedLock: rel } = await import(LIB_URL);
  const [, , , lockPath, goFile, holdFile] = process.argv;
  fs.writeFileSync(`${goFile}.ready.${process.pid}`, "");
  while (!fs.existsSync(goFile)) {} // スピン待ちで同時スタートさせる
  const ok = acq(lockPath, `race:${process.pid}`);
  process.stdout.write(ok ? "WIN" : "LOSE");
  fs.writeFileSync(`${goFile}.done.${process.pid}`, "");
  if (ok) {
    // 勝者は保持し続ける（解放して次の奪取を許すと「勝者2人」に見えるため、全員の終了を待つ）
    while (!fs.existsSync(holdFile)) {}
    rel(lockPath);
  }
  process.exit(0);
}

const KIDS = 4;
async function raceOnce(setup) {
  const p = tmpLock();
  const go = `${p}.go`;
  const hold = `${p}.hold`;
  fs.mkdirSync(p);
  setup(p);
  const kids = Array.from({ length: KIDS }, () => 0).map(
    () =>
      new Promise((resolve) => {
        const c = spawn(process.execPath, [fileURLToPath(import.meta.url), "race-child", p, go, hold]);
        let out = "";
        c.stdout.on("data", (d) => (out += d));
        c.on("close", () => resolve(out));
      }),
  );
  // 高負荷でも子の起動遅延で結果が変わらないよう、全員の準備完了→一斉開始→全員の試行完了、の順で同期する
  const count = (kind) => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(`${path.basename(go)}.${kind}.`)).length;
  const waitFor = async (kind) => {
    for (let i = 0; i < 600 && count(kind) < KIDS; i++) await new Promise((r) => setTimeout(r, 50));
  };
  await waitFor("ready");
  fs.writeFileSync(go, "");
  await waitFor("done");
  fs.writeFileSync(hold, "");
  const outs = await Promise.all(kids);
  cleanup(p);
  for (const n of fs.readdirSync(os.tmpdir())) if (n.startsWith(path.basename(go))) fs.rmSync(path.join(os.tmpdir(), n), { force: true });
  fs.rmSync(hold, { force: true });
  return outs.filter((o) => o === "WIN").length;
}

test("同時奪取レース(死亡PID): 勝者は常に1プロセス", async () => {
  const dead = deadPid();
  for (let i = 0; i < 8; i++) {
    const wins = await raceOnce((p) => writeOwnerRaw(p, { pid: dead, startedAt: "x", label: "d" }));
    assert.equal(wins, 1, `iteration ${i}`);
  }
});

test("同時奪取レース(owner無しstale): 勝者は常に1プロセス", async () => {
  for (let i = 0; i < 8; i++) {
    const wins = await raceOnce((p) => ageDir(p, STALE_MS + 60_000));
    assert.equal(wins, 1, `iteration ${i}`);
  }
});

// ── 解放時のowner照合 ──
test("releaseOwnedLock: 自分が取得したロックは解放できる", () => {
  const p = tmpLock();
  try {
    assert.equal(tryAcquire(p, "a"), true);
    releaseOwnedLock(p);
    assert.equal(fs.existsSync(p), false);
  } finally {
    cleanup(p);
  }
});

test("releaseOwnedLock: 奪取されて他者のロックになっていたら何もしない(旧保持者のfinallyが新保持者を壊さない)", () => {
  const p = tmpLock();
  try {
    assert.equal(tryAcquire(p, "a"), true);
    // 90分超で奪取された状況を再現: 他プロセスのownerに置換
    writeOwnerRaw(p, { pid: process.pid + 100000, startedAt: "other", label: "new-holder" });
    releaseOwnedLock(p);
    assert.equal(fs.existsSync(p), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(p, OWNER_FILE), "utf-8")).label, "new-holder");
  } finally {
    cleanup(p);
  }
});

test("releaseOwnedLock: 同一PIDでもstartedAtが違う(取得し直された)ロックは壊さない", () => {
  const p = tmpLock();
  try {
    assert.equal(tryAcquire(p, "a"), true);
    writeOwnerRaw(p, { pid: process.pid, startedAt: "someone-else-later", label: "b" });
    releaseOwnedLock(p);
    assert.equal(fs.existsSync(p), true);
  } finally {
    cleanup(p);
  }
});

test("releaseOwnedLock: 取得していないロック/owner無しの旧形式ロックには触れない・存在しなくても例外なし", () => {
  const p = tmpLock();
  try {
    assert.doesNotThrow(() => releaseOwnedLock(p));
    fs.mkdirSync(p);
    releaseOwnedLock(p);
    assert.equal(fs.existsSync(p), true);
  } finally {
    cleanup(p);
  }
});

test("奪取後に掃除人ミューテックス(.reap)を残さない", () => {
  const p = tmpLock();
  try {
    fs.mkdirSync(p);
    writeOwnerRaw(p, { pid: deadPid(), startedAt: "x", label: "d" });
    assert.equal(tryAcquire(p, "a"), true);
    const leftovers = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(`${path.basename(p)}.reap`));
    assert.deepEqual(leftovers, []);
  } finally {
    cleanup(p);
  }
});
