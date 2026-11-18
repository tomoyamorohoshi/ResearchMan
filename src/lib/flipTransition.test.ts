import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FLIP_NAME,
  resolveVariant,
  persistVariant,
  caseIdFromPath,
  detectDirection,
  decideMode,
  isPlainLeftClick,
  assignName,
  clearName,
  type StorageLike,
} from "./flipTransition";

function mem(init: Record<string, string> = {}): StorageLike {
  const m = { ...init };
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => {
      m[k] = v;
    },
  };
}

test("resolveVariant: クエリ > 保存値 > 既定a。不正値は無視", () => {
  assert.equal(resolveVariant("?flip=b", null), "b");
  assert.equal(resolveVariant("?flip=a", "b"), "a");
  assert.equal(resolveVariant("", "b"), "b");
  assert.equal(resolveVariant("", null), "a");
  assert.equal(resolveVariant("?flip=zzz", "b"), "b");
  assert.equal(resolveVariant("?flip=zzz", "q"), "a");
  assert.equal(resolveVariant("?x=1&flip=B", null), "a"); // 大文字は不正扱い
});

test("persistVariant: クエリが有効な時だけ保存。storageが例外でも落ちない", () => {
  const s = mem();
  persistVariant("?flip=b", s);
  assert.equal(s.getItem("rm-flip-variant"), "b");
  persistVariant("?flip=zzz", s);
  assert.equal(s.getItem("rm-flip-variant"), "b");
  const bad: StorageLike = {
    getItem: () => {
      throw new Error("x");
    },
    setItem: () => {
      throw new Error("x");
    },
  };
  assert.doesNotThrow(() => persistVariant("?flip=a", bad));
  assert.equal(resolveVariant("", null, bad), "a");
});

test("caseIdFromPath: /cases/<id> のみ。末尾スラッシュ・エンコード対応", () => {
  assert.equal(caseIdFromPath("/cases/abc-1"), "abc-1");
  assert.equal(caseIdFromPath("/cases/abc-1/"), "abc-1");
  assert.equal(caseIdFromPath("/cases/a%20b"), "a b");
  assert.equal(caseIdFromPath("/"), null);
  assert.equal(caseIdFromPath("/cases"), null);
  assert.equal(caseIdFromPath("/cases/a/b"), null);
  assert.equal(caseIdFromPath("/awards/cannes"), null);
});

test("detectDirection: 一覧→詳細=forward、詳細→一覧=back、他はnull", () => {
  assert.deepEqual(detectDirection("/", "/cases/x"), { dir: "forward", id: "x" });
  assert.deepEqual(detectDirection("/cases/x", "/"), { dir: "back", id: "x" });
  assert.equal(detectDirection("/cases/x", "/cases/y"), null);
  assert.equal(detectDirection("/", "/awards/cannes"), null);
  assert.equal(detectDirection("/awards/cannes", "/"), null);
  assert.equal(detectDirection(null, "/"), null);
});

test("decideMode: 非対応/reduced-motion=none、目標あり=flip、無し=fade", () => {
  assert.equal(decideMode({ supported: false, reducedMotion: false, targetFound: true }), "none");
  assert.equal(decideMode({ supported: true, reducedMotion: true, targetFound: true }), "none");
  assert.equal(decideMode({ supported: true, reducedMotion: false, targetFound: true }), "flip");
  assert.equal(decideMode({ supported: true, reducedMotion: false, targetFound: false }), "fade");
});

test("isPlainLeftClick: 修飾キー・中クリック・target付き・preventDefault済みは対象外", () => {
  const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  assert.equal(isPlainLeftClick(base), true);
  assert.equal(isPlainLeftClick({ ...base, button: 1 }), false);
  assert.equal(isPlainLeftClick({ ...base, metaKey: true }), false);
  assert.equal(isPlainLeftClick({ ...base, ctrlKey: true }), false);
  assert.equal(isPlainLeftClick({ ...base, shiftKey: true }), false);
  assert.equal(isPlainLeftClick({ ...base, altKey: true }), false);
  assert.equal(isPlainLeftClick({ ...base, defaultPrevented: true }), false);
});

test("assignName/clearName: 付与した要素だけ名前を持ち、clearで外れる", () => {
  const mk = () => ({ style: { viewTransitionName: "" } }) as unknown as HTMLElement;
  const a = mk();
  const b = mk();
  assignName(a);
  assert.equal(a.style.viewTransitionName, FLIP_NAME);
  assert.equal(b.style.viewTransitionName, "");
  clearName(a);
  assert.equal(a.style.viewTransitionName, "");
  assert.doesNotThrow(() => clearName(null));
  assert.doesNotThrow(() => assignName(null));
});
