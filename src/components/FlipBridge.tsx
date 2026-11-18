"use client";

// カード⇄詳細の裏返し遷移の結線。レイアウトに1つだけ置く。
// 待機中は何も走らない（クリック/popstateのリスナーのみ。rAF・タイマー常駐なし）。
// 描画はすべて CSS（globals.css の ::view-transition-*）＝コンポジタ任せ。

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  assignName,
  caseIdFromPath,
  clearName,
  decideMode,
  detectDirection,
  isPlainLeftClick,
  persistVariant,
  readStoredVariant,
  resolveVariant,
  type Direction,
} from "@/lib/flipTransition";

const SCROLL_KEY = "rm-flip-scroll";
const NAV_TIMEOUT = 2000; // ルート確定待ちの上限（超えたら諦めて通常描画）
const TARGET_TIMEOUT = 1200; // 戻り先カード出現待ちの上限（超えたらフェード）

let router: ReturnType<typeof useRouter> | null = null;
let currentPath: string | null = null;
let prevPath: string | null = null;
let active = false;
let pathWaiter: (() => void) | null = null;

const supported = () => typeof document !== "undefined" && typeof document.startViewTransition === "function";
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const hero = () => document.querySelector<HTMLElement>("[data-flip-hero]");
const cardOf = (id: string) => document.querySelector<HTMLElement>(`[data-case-id="${CSS.escape(id)}"]`);

function waitPath(): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, NAV_TIMEOUT);
    function done() {
      clearTimeout(t);
      pathWaiter = null;
      resolve();
    }
    pathWaiter = done;
  });
}

function waitFor<T>(find: () => T | null, ms: number): Promise<T | null> {
  const first = find();
  if (first) return Promise.resolve(first);
  return new Promise((resolve) => {
    const mo = new MutationObserver(() => {
      const el = find();
      if (el) finish(el);
    });
    const t = setTimeout(() => finish(null), ms);
    function finish(v: T | null) {
      mo.disconnect();
      clearTimeout(t);
      resolve(v);
    }
    mo.observe(document.body, { childList: true, subtree: true });
  });
}

// 戻り先カード探し: 一覧(非同期ロード)が描画されるまで待ち、描画後は目標が無ければ即諦める（60件窓の外等）
async function findBackCard(id: string): Promise<HTMLElement | null> {
  const any = await waitFor(() => document.querySelector<HTMLElement>("[data-case-id]"), TARGET_TIMEOUT);
  return any ? waitFor(() => cardOf(id), 150) : null;
}

function saveScroll(id: string) {
  try {
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ id, y: window.scrollY }));
  } catch {}
}
function savedScroll(id: string): number | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? "null");
    return v && v.id === id && typeof v.y === "number" ? v.y : null;
  } catch {
    return null;
  }
}

/** navigate: 遷移を起こす処理（router.push等。popstate起点なら何もしない） */
function run(dir: Direction, id: string, navigate: () => void) {
  const html = document.documentElement;
  active = true;
  const named: (HTMLElement | null)[] = [];
  const cleanup = () => {
    named.forEach(clearName);
    delete html.dataset.flipDir;
    delete html.dataset.flipV;
    active = false;
  };
  try {
    const search = window.location.search;
    persistVariant(search, localStorage);
    html.dataset.flipV = resolveVariant(search, readStoredVariant(localStorage));
  } catch {
    html.dataset.flipV = "a";
  }
  html.dataset.flipDir = "fade";
  // 旧側: forwardは押されたカード、backは詳細のヒーローだけに名前を付ける
  const oldEl = dir === "forward" ? cardOf(id) : hero();
  const startsFlip = !!oldEl;
  if (startsFlip) {
    assignName(oldEl);
    named.push(oldEl);
  }
  if (dir === "forward") saveScroll(id);

  const t = document.startViewTransition(async () => {
    const nav = waitPath();
    navigate();
    await nav;
    // 新側: forwardは詳細ヒーロー、backは戻り先カード（無ければフェードに落とす）
    const target =
      dir === "forward"
        ? await waitFor(hero, 300)
        : await findBackCard(id);
    if (dir === "back" && target) {
      const y = savedScroll(id);
      if (y !== null) window.scrollTo({ top: y, behavior: "instant" });
      const r = target.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) target.scrollIntoView({ block: "center", behavior: "instant" });
    }
    const mode = decideMode({ supported: true, reducedMotion: false, targetFound: startsFlip && !!target });
    if (mode === "flip" && target) {
      assignName(target);
      named.push(target);
      html.dataset.flipDir = dir;
    }
  });
  t.ready.catch(() => {});
  t.updateCallbackDone.catch(cleanup);
  t.finished.then(cleanup, cleanup);
}

function onClick(e: MouseEvent) {
  if (active || !router || !isPlainLeftClick(e) || !supported() || reduced()) return;
  const a = (e.target as Element | null)?.closest?.("a");
  if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
  const card = a.closest<HTMLElement>("[data-case-id]");
  const r = router;
  if (card && /^\/cases\/[^/]+\/?$/.test(a.getAttribute("href") ?? "")) {
    const id = card.dataset.caseId!;
    e.preventDefault(); // captureで先取り＝Next Link側は defaultPrevented で何もしない
    run("forward", id, () => r.push(`/cases/${encodeURIComponent(id)}`));
  } else if (a.hasAttribute("data-flip-back")) {
    const id = caseIdFromPath(window.location.pathname);
    if (!id) return;
    e.preventDefault();
    // 一覧から来ていれば履歴を戻す（スクロール復元）。popstate側が遷移を起こす
    if (prevPath === "/") history.back();
    else run("back", id, () => r.push("/"));
  }
}

let replaying = false;

// 戻る/進むボタン。Next側のpopstateが先に描画してしまうと「旧画面」を撮れないため、
// captureで先取りして一旦止め、旧画面のスナップショット後(更新コールバック内)にNextへ再送する。
function onPopState(e: PopStateEvent) {
  if (replaying || active || !supported() || reduced()) return;
  const d = detectDirection(currentPath, window.location.pathname);
  if (!d) return;
  e.stopImmediatePropagation();
  const state = e.state;
  run(d.dir, d.id, () => {
    replaying = true;
    try {
      window.dispatchEvent(new PopStateEvent("popstate", { state }));
    } finally {
      replaying = false;
    }
  });
}
export default function FlipBridge() {
  const pathname = usePathname();
  const r = useRouter();

  useEffect(() => {
    router = r;
  }, [r]);

  useEffect(() => {
    if (currentPath !== pathname) {
      prevPath = currentPath;
      currentPath = pathname;
    }
    pathWaiter?.();
  }, [pathname]);

  useEffect(() => {
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState, true);
    };
  }, []);

  return null;
}
