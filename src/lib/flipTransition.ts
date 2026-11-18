// カード⇔詳細ページの「裏返し」遷移（View Transitions API / CSSのみで描画）。
// このファイルは純粋ヘルパー。DOM/ルーター結線は components/FlipBridge.tsx。
// 名前(view-transition-name)は遷移中の1要素にだけ付け、終わったら外す（全カードには付けない）。

export const FLIP_NAME = "case-hero";
export type Variant = "a" | "b";
export type Direction = "forward" | "back";
export type Mode = "flip" | "fade" | "none";

export type StorageLike = {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
};

const VARIANT_KEY = "rm-flip-variant";

function validVariant(v: string | null | undefined): v is Variant {
  return v === "a" || v === "b";
}

function safeGet(s: StorageLike | null | undefined, k: string): string | null {
  try {
    return s ? s.getItem(k) : null;
  } catch {
    return null;
  }
}

/** ?flip=a|b（有効なら最優先）> localStorage > 既定a */
export function resolveVariant(search: string, stored: string | null, storage?: StorageLike | null): Variant {
  const q = new URLSearchParams(search).get("flip");
  if (validVariant(q)) return q;
  const s = stored ?? safeGet(storage, VARIANT_KEY);
  return validVariant(s) ? s : "a";
}

/** クエリが有効な時だけ保存（localStorage不可でも落ちない） */
export function persistVariant(search: string, storage: StorageLike | null | undefined): void {
  const q = new URLSearchParams(search).get("flip");
  if (!validVariant(q)) return;
  try {
    storage?.setItem(VARIANT_KEY, q);
  } catch {
    /* 保存できなくても遷移は動く */
  }
}

export function readStoredVariant(storage: StorageLike | null | undefined): string | null {
  return safeGet(storage, VARIANT_KEY);
}

export function caseIdFromPath(pathname: string): string | null {
  const m = /^\/cases\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** 一覧→詳細=forward / 詳細→一覧=back。それ以外はnull（通常遷移） */
export function detectDirection(from: string | null, to: string): { dir: Direction; id: string } | null {
  if (!from) return null;
  const toId = caseIdFromPath(to);
  if (from === "/" && toId) return { dir: "forward", id: toId };
  const fromId = caseIdFromPath(from);
  if (fromId && to === "/") return { dir: "back", id: fromId };
  return null;
}

export function decideMode(o: { supported: boolean; reducedMotion: boolean; targetFound: boolean }): Mode {
  if (!o.supported || o.reducedMotion) return "none";
  return o.targetFound ? "flip" : "fade";
}

export function isPlainLeftClick(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}

export function assignName(el: HTMLElement | null): void {
  if (el) el.style.viewTransitionName = FLIP_NAME;
}

export function clearName(el: HTMLElement | null): void {
  if (el) el.style.viewTransitionName = "";
}
