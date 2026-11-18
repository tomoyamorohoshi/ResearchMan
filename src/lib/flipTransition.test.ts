import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FLIP_NAME,
  caseIdFromPath,
  detectDirection,
  decideMode,
  isPlainLeftClick,
  assignName,
  clearName,
} from "./flipTransition";

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

import { PopGate, remaining, makeScrollRecord, parseScrollRecord } from "./flipTransition";

test("remaining: 残りmsは負にならない", () => {
  assert.equal(remaining(1000, 400), 600);
  assert.equal(remaining(1000, 1500), 0);
});

test("PopGate: 保留中の後続popstateは最新stateで上書きされ、releaseで1回だけ取り出せる", () => {
  const g = new PopGate<string>();
  assert.equal(g.intercept("x"), false); // 保留前は素通し
  g.hold("first");
  assert.equal(g.isHeld, true);
  assert.equal(g.intercept("second"), true);
  assert.equal(g.release(), "second");
  assert.equal(g.isHeld, false);
  assert.equal(g.intercept("third"), false); // 再送後は素通し
  assert.equal(g.release(), undefined);
});

test("scroll record: 一覧(/)でのみ保存、id・パス不一致は無視", () => {
  assert.equal(makeScrollRecord("/cases/a", "a", 100), null);
  assert.equal(makeScrollRecord("/", "a", NaN), null);
  const raw = makeScrollRecord("/", "a", 320)!;
  assert.equal(parseScrollRecord(raw, "a"), 320);
  assert.equal(parseScrollRecord(raw, "b"), null);
  assert.equal(parseScrollRecord(JSON.stringify({ id: "a", y: 5 }), "a"), null); // 旧形式(path無し)
  assert.equal(parseScrollRecord("garbage", "a"), null);
  assert.equal(parseScrollRecord(null, "a"), null);
});

test("clipToViewport/releaseClip: 固定表示+scrollTopで切り詰め、解除で元に戻る", async () => {
  const { clipToViewport, releaseClip } = await import("./flipTransition");
  const el = { style: { position: "", inset: "", overflow: "" }, scrollTop: 0 };
  clipToViewport(el, 320);
  assert.deepEqual(el.style, { position: "fixed", inset: "0", overflow: "hidden" });
  assert.equal(el.scrollTop, 320);
  releaseClip(el);
  assert.deepEqual(el.style, { position: "", inset: "", overflow: "" });
});
