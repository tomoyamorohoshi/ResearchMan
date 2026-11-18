"use client";

// カード⇄詳細の裏返し遷移の結線。レイアウトに1つだけ置く。
// 待機中は何も走らない（クリック/popstateのリスナーのみ。rAF・タイマー常駐なし）。
// 描画はすべて CSS（globals.css の ::view-transition-*）＝コンポジタ任せ。

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  PopGate,
  assignName,
  caseIdFromPath,
  clearName,
  clipToViewport,
  releaseClip,
  decideMode,
  detectDirection,
  isPlainLeftClick,
  makeScrollRecord,
  parseScrollRecord,
  persistVariant,
  readStoredVariant,
  remaining,
  resolveVariant,
  type Direction,
} from "@/lib/flipTransition";

const SCROLL_KEY = "rm-flip-scroll";
// 更新コールバック中は描画が止まるので、待ちの合計をここで打ち切る（超えたら通常描画/フェード）
const ROUTE_BUDGET = 3000; // ルート確定の待ち上限（行き・戻り共通）
const POST_BUDGET = 300; // 確定後の対象要素待ち＋decodeの合計上限
const DECODE_CAP = 100; // 戻り先サムネのdecode待ち上限（POST_BUDGETの内数）
const prefetched = new Set<string>();

let router: ReturnType<typeof useRouter> | null = null;
let currentPath: string | null = null;
let prevPath: string | null = null;
let active = false;
let replaying = false;
let prevRestoration: ScrollRestoration | null = null;
let lastY = 0; // 表示中ページのスクロール位置（scrollイベントで更新。popstate時の復元済み値と区別するため）
let pathWaiter: (() => void) | null = null;
const gate = new PopGate<unknown>();

const supported = () => typeof document !== "undefined" && typeof document.startViewTransition === "function";
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const hero = () => document.querySelector<HTMLElement>("[data-flip-hero]");
// 変形対象は一覧のカード全体（画像・文章・ハッシュタグを含む [data-case-id] ルート）
const cardOf = (id: string) =>
  document.querySelector<HTMLElement>(`[data-case-id="${CSS.escape(id)}"]`) ?? null;

// ルート確定（pathname更新）を待つ。時間内に確定したら true
function waitPath(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => finish(false), ms);
    function finish(ok: boolean) {
      clearTimeout(t);
      pathWaiter = null;
      resolve(ok);
    }
    pathWaiter = () => finish(true);
  });
}

function waitFor<T>(find: () => T | null, ms: number): Promise<T | null> {
  const first = find();
  if (first || ms <= 0) return Promise.resolve(first);
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

// 戻り先カード探し: 一覧(非同期ロード)が描画されるまで締切内で待ち、描画後は目標が無ければ即諦める（60件窓の外等）
async function findBackCard(id: string, deadline: number): Promise<HTMLElement | null> {
  const any = await waitFor(() => document.querySelector<HTMLElement>("[data-case-id]"), remaining(deadline, performance.now()));
  return any ? waitFor(() => cardOf(id), Math.min(150, remaining(deadline, performance.now()))) : null;
}

// lazyサムネが未ロードだと新スナップショットが空白になるため、短い上限でdecodeを待つ
async function decodeWithin(el: HTMLElement, ms: number): Promise<void> {
  const img = el.querySelector("img");
  if (!img || ms <= 0 || (img.complete && img.naturalWidth > 0)) return;
  img.loading = "eager";
  await Promise.race([img.decode().catch(() => {}), new Promise<void>((r) => setTimeout(r, ms))]);
}

// 戻りが中止された時、遅れて一覧が確定した後に保存位置へスクロールを戻す（Nextの先頭スクロールの後勝ちにするため数回当てる）
async function restoreScrollOnArrival(y: number | null) {
  if (y === null) return;
  const el = await waitFor(() => (window.location.pathname === "/" ? document.querySelector<HTMLElement>("[data-case-id]") : null), 15000);
  if (!el) return;
  for (const ms of [0, 60, 200, 500]) {
    setTimeout(() => {
      if (!active && window.location.pathname === "/") window.scrollTo({ top: y, behavior: "instant" });
    }, ms);
  }
}

function saveScroll(id: string) {
  try {
    const rec = makeScrollRecord(window.location.pathname, id, window.scrollY);
    if (rec) sessionStorage.setItem(SCROLL_KEY, rec);
  } catch {}
}
function savedScroll(id: string): number | null {
  try {
    return parseScrollRecord(sessionStorage.getItem(SCROLL_KEY), id);
  } catch {
    return null;
  }
}

/**
 * navigate: 遷移を起こす処理（router.push等）。
 * rescue: 更新コールバックが走らなかった/開始に失敗した場合の救済（保留したpopstateの再送）。冪等であること。
 */
function run(dir: Direction, id: string, navigate: () => void, rescue?: () => void) {
  const html = document.documentElement;
  active = true;
  const named: (HTMLElement | null)[] = [];
  const clipped: HTMLElement[] = [];
  let oldY = 0;
  const cleanup = () => {
    named.forEach(clearName);
    const hadClip = clipped.length > 0;
    clipped.forEach(releaseClip);
    // 詳細を固定表示にした分、ドキュメントが縮んでスクロールが0に戻る。中止時は元の位置へ戻す
    if (hadClip && dir === "back" && oldY > 0) window.scrollTo({ top: oldY, behavior: "instant" });
    delete html.dataset.flipDir;
    delete html.dataset.flipV;
    active = false;
    if (prevRestoration) {
      try {
        history.scrollRestoration = prevRestoration;
      } catch {}
      prevRestoration = null;
    }
    rescue?.();
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
  const oldCand = dir === "forward" ? cardOf(id) : hero();
  // 画面外の要素は撮っても見えない＝裏返さずフェードに落とす
  const oldRect = oldCand?.getBoundingClientRect();
  const oldEl = oldRect && oldRect.bottom > 0 && oldRect.top < window.innerHeight ? oldCand : null;
  const startsFlip = !!oldEl;
  if (startsFlip) {
    // 詳細ページ全体は縦長なので、今見えている範囲(ビューポート)だけに切り詰めてから名前を付ける
    if (dir === "back") {
      oldY = window.scrollY;
      clipToViewport(oldEl, oldY);
      clipped.push(oldEl);
    }
    assignName(oldEl);
    named.push(oldEl);
  }
  if (dir === "forward") saveScroll(id);

  let t: ViewTransition;
  try {
    t = document.startViewTransition(async () => {
      // 通常のNextと同じく、新ルートが確定するまで旧ページを見せ続ける。ChromeのコールバックTimeout(約4s)より手前で諦める
      const nav = waitPath(ROUTE_BUDGET);
      navigate();
      if (!(await nav)) {
        // 確定しなかった: 旧ページのスナップショットを二重に見せないよう遷移ごと中止（遷移自体は素のNextが続行する）
        if (dir === "back") restoreScrollOnArrival(savedScroll(id));
        throw new Error("flip: route not settled");
      }
      // ルート確定後の待ち（対象要素・decode）は短い予算で打ち切る
      const deadline = performance.now() + POST_BUDGET;
      // 新側: forwardは詳細ヒーロー、backは戻り先カード（無ければフェードに落とす）
      const target =
        dir === "forward"
          ? await waitFor(hero, remaining(deadline, performance.now()))
          : await findBackCard(id, deadline);
      if (target) {
        if (dir === "back") {
          const y = savedScroll(id);
          if (y !== null) window.scrollTo({ top: y, behavior: "instant" });
          const r = target.getBoundingClientRect();
          if (r.bottom < 0 || r.top > window.innerHeight) target.scrollIntoView({ block: "center", behavior: "instant" });
        }
        await decodeWithin(target, Math.min(DECODE_CAP, remaining(deadline, performance.now())));
      }
      const mode = decideMode({ supported: true, reducedMotion: false, targetFound: startsFlip && !!target });
      if (mode === "flip" && target) {
        if (dir === "forward") {
          clipToViewport(target, 0);
          clipped.push(target);
        }
        assignName(target);
        named.push(target);
        html.dataset.flipDir = dir;
      }
    });
  } catch {
    // 同期例外: 遷移だけは確実に行い、後始末する
    cleanup();
    navigate();
    return;
  }
  t.ready.catch(() => {});
  t.updateCallbackDone.catch(cleanup);
  t.finished.then(cleanup, cleanup);
}

// カードにホバー/タップした時点で詳細ルートを先読み（href毎に1回。コールド時のルート確定待ちを短くする）
function onPointerPrefetch(e: PointerEvent) {
  if (!router) return;
  const a = (e.target as Element | null)?.closest?.("a");
  const href = a?.getAttribute("href") ?? "";
  if (!a || !a.closest("[data-case-id]") || !/^\/cases\/[^/]+\/?$/.test(href) || prefetched.has(href)) return;
  prefetched.add(href);
  try {
    router.prefetch(href);
  } catch {}
}

function onClick(e: MouseEvent) {
  if (active || !router || !isPlainLeftClick(e)) return;
  const a = (e.target as Element | null)?.closest?.("a");
  if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
  const r = router;
  if (a.hasAttribute("data-flip-back")) {
    const id = caseIdFromPath(window.location.pathname);
    if (!id) return;
    // 一覧から来ていれば履歴を戻す（スクロール復元。モーション無効時も同じ挙動）
    if (prevPath === "/") {
      e.preventDefault();
      history.back();
      return;
    }
    if (!supported() || reduced()) return;
    e.preventDefault();
    run("back", id, () => r.push("/"));
    return;
  }
  if (!supported() || reduced()) return;
  const card = a.closest<HTMLElement>("[data-case-id]");
  if (card && /^\/cases\/[^/]+\/?$/.test(a.getAttribute("href") ?? "")) {
    const id = card.dataset.caseId!;
    e.preventDefault(); // captureで先取り＝Next Link側は defaultPrevented で何もしない
    run("forward", id, () => r.push(`/cases/${encodeURIComponent(id)}`));
  }
}

// 保留したpopstateをNextへ1回だけ再送（最新のstate。locationも最新なので食い違わない）
function replayPop() {
  if (!gate.isHeld) return;
  const state = gate.release();
  replaying = true;
  try {
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  } finally {
    replaying = false;
  }
}

// 戻る/進むボタン。Next側のpopstateが先に描画してしまうと「旧画面」を撮れないため、
// captureで先取りして一旦止め、旧画面のスナップショット後(更新コールバック内)にNextへ再送する。
// 待機中に来た後続のpopstateも止めて最新1件だけ再送する（再送後に来たものはNextへそのまま渡す）。
function onPopState(e: PopStateEvent) {
  if (replaying) return;
  if (gate.intercept(e.state)) {
    e.stopImmediatePropagation();
    return;
  }
  if (active || !supported() || reduced()) return;
  const d = detectDirection(currentPath, window.location.pathname);
  if (!d) return;
  e.stopImmediatePropagation();
  // ブラウザはpopstateの後に遷移先エントリのスクロールを復元し、旧スナップショットがずれる。
  // 遷移中だけ復元を止め、旧画面は自分のスクロール位置で撮る（一覧側の復元は更新コールバック内で行う）
  try {
    prevRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
  } catch {}
  // ブラウザの復元は次フレーム頭（rAFより前）に適用されるため、rAF内でも固定し直す（スナップショットはその後に撮られる）
  const pinY = lastY;
  const pin = () => {
    if (Math.abs(window.scrollY - pinY) > 1) window.scrollTo({ top: pinY, behavior: "instant" });
  };
  pin();
  requestAnimationFrame(pin);
  gate.hold(e.state);
  run(d.dir, d.id, replayPop, replayPop);
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
    const onScroll = () => {
      lastY = window.scrollY;
    };
    lastY = window.scrollY;
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerover", onPointerPrefetch, { capture: true, passive: true });
    document.addEventListener("pointerdown", onPointerPrefetch, { capture: true, passive: true });
    window.addEventListener("popstate", onPopState, true);
    return () => {
      document.removeEventListener("pointerover", onPointerPrefetch, true);
      document.removeEventListener("pointerdown", onPointerPrefetch, true);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState, true);
    };
  }, []);

  return null;
}
