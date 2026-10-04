// parseIntakeBlobText（Blob 本文 → IntakeData）のテスト。壊れた Blob は空扱いせず例外にする。
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntakeBlobText, StoreCorruptError } from "./exhibitionIntakeStore";

const good = { version: 1, items: { k: { url: "https://x.com/a/status/1", ts: 1, status: "pending", attempts: 0 } } };

test("正常な JSON はそのまま返す", () => {
  assert.deepEqual(parseIntakeBlobText(JSON.stringify(good)), good);
});

test("壊れた JSON は StoreCorruptError", () => {
  assert.throws(() => parseIntakeBlobText("{oops"), StoreCorruptError);
});

test("形が不正（version違い・items 無し・値が null・status 不正）は StoreCorruptError", () => {
  for (const bad of [
    { version: 2, items: {} },
    { version: 1 },
    { version: 1, items: { k: null } },
    { version: 1, items: { k: { url: "u", ts: 1, status: "weird", attempts: 0 } } },
    { version: 1, items: { k: { url: 1, ts: 1, status: "pending", attempts: 0 } } },
    [],
    null,
  ]) {
    assert.throws(() => parseIntakeBlobText(JSON.stringify(bad)), StoreCorruptError, JSON.stringify(bad));
  }
});

// ── updateIntake: 楽観ロック（etag / ifMatch）付き read-modify-write ──
import { BlobPreconditionFailedError } from "@vercel/blob";
import { updateIntake, StoreConflictError, type IntakeBlobClient } from "./exhibitionIntakeStore";
import type { IntakeData } from "./exhibitionIntake";

const mkItem = (n: number) => ({ url: `https://x.com/a/status/${n}`, ts: n, status: "pending" as const, attempts: 0 });
const withItem = (d: IntakeData, k: string, n: number): IntakeData => ({ version: 1, items: { ...d.items, [k]: mkItem(n) } });
const noSleep = async () => {};

// 実 Blob の挙動を模す: etag 一致で書き込み可、不一致は BlobPreconditionFailedError。
// 作成時（ifMatch=null）は既存があれば失敗。get は staleReads 回だけ古いスナップショットを返す。
function fakeBlob(initial: IntakeData | null, staleReads = 0) {
  let stored: { etag: string; text: string } | null = initial ? { etag: "e0", text: JSON.stringify(initial) } : null;
  let stale: { etag: string; text: string } | null = stored;
  let rev = 0;
  const writes: (string | null)[] = [];
  const client: IntakeBlobClient = {
    async read() {
      if (staleReads > 0) {
        staleReads--;
        return stale;
      }
      return stored;
    },
    async write(text, ifMatch) {
      writes.push(ifMatch);
      if (ifMatch === null ? stored !== null : stored?.etag !== ifMatch) throw new BlobPreconditionFailedError();
      stored = { etag: `e${++rev}`, text };
    },
  };
  return { client, writes, current: () => (stored ? (JSON.parse(stored.text) as IntakeData) : null) };
}

test("updateIntake: get が古い etag/内容を返す→precondition 失敗→再読込で最新を得て両方の更新が残る", async () => {
  const old: IntakeData = { version: 1, items: {} };
  const latest = withItem(old, "b", 2);
  let stored = { etag: "e1", text: JSON.stringify(latest) };
  let reads = 0;
  const client: IntakeBlobClient = {
    async read() {
      reads++;
      // 1回目だけ書き込み直前の古い状態（Blob のキャッシュ遅延）を返す
      return reads === 1 ? { etag: "e0", text: JSON.stringify(old) } : stored;
    },
    async write(text, ifMatch) {
      if (ifMatch !== stored.etag) throw new BlobPreconditionFailedError();
      stored = { etag: "e2", text };
    },
  };
  await updateIntake((d) => ({ data: withItem(d, "c", 3), result: 0 }), { client, sleep: noSleep });
  assert.deepEqual(Object.keys(JSON.parse(stored.text).items).sort(), ["b", "c"]);
  assert.equal(reads, 2);
});

test("updateIntake: 並行する2件の追加が両方残る（古い読みで衝突→リトライ）", async () => {
  const f = fakeBlob(null, 0);
  const slept: number[] = [];
  const sleep = async (ms: number) => {
    slept.push(ms);
  };
  // 2 つの更新が同じ初期状態（不在）を読む: 1つ目が先に作成、2つ目は作成競合→リトライ
  const origRead = f.client.read.bind(f.client);
  let first = true;
  f.client.read = async () => {
    const r = await origRead();
    if (first) {
      first = false;
      // 読み終えた直後に別リクエストが書き込む
      await updateIntake((d) => ({ data: withItem(d, "other", 9), result: 0 }), {
        client: { read: origRead, write: fakeWrite(f) },
        sleep,
      });
    }
    return r;
  };
  await updateIntake((d) => ({ data: withItem(d, "mine", 1), result: 0 }), { client: f.client, sleep });
  assert.deepEqual(Object.keys(f.current()!.items).sort(), ["mine", "other"]);
  assert.equal(slept.length, 1);
});
function fakeWrite(f: ReturnType<typeof fakeBlob>) {
  return f.client.write.bind(f.client);
}

test("updateIntake: blob 不在からの初回作成は ifMatch なし(null)、既存ありなら ifMatch=etag", async () => {
  const f = fakeBlob(null);
  await updateIntake((d) => ({ data: withItem(d, "a", 1), result: 0 }), { client: f.client, sleep: noSleep });
  await updateIntake((d) => ({ data: withItem(d, "b", 2), result: 0 }), { client: f.client, sleep: noSleep });
  assert.deepEqual(f.writes, [null, "e1"]);
});

test("updateIntake: 初回作成の競合（他者が先に作成）→再読込して両方残る", async () => {
  const f = fakeBlob(null);
  let raced = false;
  const base = f.client.read.bind(f.client);
  f.client.read = async () => {
    const r = await base();
    if (!raced) {
      raced = true;
      await f.client.write(JSON.stringify(withItem({ version: 1, items: {} }, "other", 9)), null);
    }
    return r;
  };
  await updateIntake((d) => ({ data: withItem(d, "mine", 1), result: 0 }), { client: f.client, sleep: noSleep });
  assert.deepEqual(Object.keys(f.current()!.items).sort(), ["mine", "other"]);
});

test("updateIntake: リトライ上限で StoreConflictError（backoff 4回・書き込みは黙って失われない）", async () => {
  const slept: number[] = [];
  const client: IntakeBlobClient = {
    async read() {
      return { etag: "e0", text: JSON.stringify({ version: 1, items: {} }) };
    },
    async write() {
      throw new BlobPreconditionFailedError();
    },
  };
  await assert.rejects(
    updateIntake((d) => ({ data: withItem(d, "a", 1), result: 0 }), { client, sleep: async (ms) => void slept.push(ms) }),
    StoreConflictError,
  );
  assert.deepEqual(slept, [300, 800, 1500, 2500]);
});

test("updateIntake: precondition 以外のエラーはそのまま投げる／fn が data:null なら書き込まない", async () => {
  const boom = new Error("boom");
  await assert.rejects(
    updateIntake((d) => ({ data: d, result: 0 }), {
      client: { read: async () => null, write: async () => { throw boom; } },
      sleep: noSleep,
    }),
    boom,
  );
  const f = fakeBlob(null);
  const r = await updateIntake(() => ({ data: null, result: "dup" }), { client: f.client, sleep: noSleep });
  assert.equal(r, "dup");
  assert.deepEqual(f.writes, []);
});
