"use client";

// 3Dモード(ON/OFF)ワンカット遷移オーケストレーション（ドメイン非依存の共有フック）。
// GalleryClient/TechGalleryClient双方から使う。phase機構(grid/toGraph/graph/toGrid)・
// 収縮/展開・rect採取・平面ポーズ連携・warm・busyガードをここに集約する
// （計画書「遷移オーケストレーションの共有化」参照）。
//
// グリッドJSX自体（カード配列のレンダリング）は各Client側に残す。このフックが返す
// showGrid/showGraphで表示条件を、graphWrapRef/handleGraphReadyでGraph3DViewとの
// 連携を、呼び出し元へ委譲する（children/renderProp方式で構造を動かさない）。
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { GraphDomainAdapter } from "@/lib/graphDomain";
import { toNodeSpec } from "@/lib/graphDomain";
import { warmThumbnailCache, prioritizeAndWaitThumbnails } from "@/lib/graphSprites";
import {
  captureImageRects,
  shrinkVisibleCards,
  collapseTextSectionsInstant,
  expandVisibleCards,
  type PlaneCardRect,
} from "@/lib/viewTransition";
import { useViewMode } from "@/components/ViewModeContext";
import type { GraphTransitionApi } from "@/components/Graph3DView";

// onReady+ポージングがこの時間内に来なかった場合、諦めて即時スワップする
// （plan 2-5フォールバック。ワンカットは崩れるが機能は生きる）
const ON_READY_TIMEOUT_MS = 1500;
// ON押下時、ビューポート内カードの優先ロードを待つ上限（間に合わない分はプレースホルダで進む）
const THUMB_WAIT_MS = 600;
// マウント後、サムネイル事前ウォームを開始するまでのアイドル待ち（requestIdleCallback無い環境向け）
const WARM_IDLE_FALLBACK_MS = 2000;
// Graph3DView.tsxの `h-[calc(100vh-180px)]` と合わせる既定値。ON方向のhold中、canvasをfixedで
// 固定するtopの下限として使う（詳細はGalleryClientの既存コメント参照。呼び出し側のヘッダー
// 構成が変わる場合のみheaderOffsetPxで上書きする）
const DEFAULT_HEADER_OFFSET_PX = 180;

// "toGraph"/"toGrid" はトランジション中の一時状態。この間はグリッドとGraph3DViewが
// 同時にマウントされる（「グリッド平面モーフ」方式）。mode(ViewModeContext)は
// 「目標状態」のまま変えず、phaseだけがこの間接的な状態を持つ
export type DisplayPhase = "grid" | "toGraph" | "graph" | "toGrid";

type Options<T> = {
  // 全件（事前ウォーム対象。フィルタの影響を受けない）
  items: T[];
  // 現在の絞込・並び替え結果（グリッド/グラフの描画対象。フィルタのたびに新規配列になる）
  sorted: T[];
  adapter: GraphDomainAdapter<T>;
  gridRef: RefObject<HTMLDivElement | null>;
  headerRef: RefObject<HTMLDivElement | null>;
  headerOffsetPx?: number;
};

export function useGraphViewTransition<T>({
  items,
  sorted,
  adapter,
  gridRef,
  headerRef,
  headerOffsetPx = DEFAULT_HEADER_OFFSET_PX,
}: Options<T>) {
  const { mode, setBusy, enabled } = useViewMode();
  const [phase, setPhase] = useState<DisplayPhase>(mode === "graph" ? "graph" : "grid");
  const graphWrapRef = useRef<HTMLDivElement | null>(null);
  const scrollYRef = useRef(0);
  const prevModeRef = useRef(mode);
  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  // Graph3DView.onReadyで受け取ったAPI（平面ポーズ/モーフの操作に使う）
  const graphApiRef = useRef<GraphTransitionApi | null>(null);
  // ON方向の遷移中のみ、onReady到着を待つコールバックを保持する
  const onReadyWaiterRef = useRef<(() => void) | null>(null);
  // ON方向: shrink後に採取したrect。handleGraphReadyがenterPlanePoseへ渡す
  // （nullの間はポーズしない＝reduced-motion/gridEl不在フォールバック用のゲート）
  const rectsRef = useRef<Map<string, PlaneCardRect> | null>(null);
  // ON方向: Graph3DViewを最初にfixedで置く際のtop位置（px）。グリッドがまだ
  // マウントされていない時点(setPhase直前)で読めないgraphWrapRef.currentの代わりに
  // 値だけ先に控えておき、下のuseLayoutEffectで適用する
  const pendingCanvasTopRef = useRef<number | null>(null);
  // 全件サムネイル事前ウォームを一度だけ開始したか（enabled時のみ）
  const warmStartedRef = useRef(false);
  // ON_READY_TIMEOUT_MSでフォールバック（即時スワップ）に入った後か。trueの間は
  // 後から遅れて届いたonReadyでenterPlanePoseを呼ばない（呼ぶと、フォールバックで
  // 既に可視化されたcanvas＝デフォルト状態の上に、後からポーズが不意打ちでスナップして
  // 二重に見た目が変わる既知の罠。実機Playwright検証で発見）
  const posingAbandonedRef = useRef(false);

  const handleGraphReady = (api: GraphTransitionApi) => {
    graphApiRef.current = api;
    if (rectsRef.current && !posingAbandonedRef.current) {
      api.enterPlanePose(rectsRef.current);
    }
    rectsRef.current = null;
    onReadyWaiterRef.current?.();
    onReadyWaiterRef.current = null;
  };

  // enabled時のみ: マウント後のアイドル時間に全件サムネイルを事前ウォームする
  // （ON押下時の画素一致スワップの前提。/awards等Provider不在ページではenabled=falseのため
  // 発火しない＝無駄な帯域を使わない）
  useEffect(() => {
    if (!enabled || warmStartedRef.current) return;
    warmStartedRef.current = true;
    const specs = items.map((item) => toNodeSpec(adapter, item));
    const ric = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback : null;
    const cancel = ric
      ? ric(() => warmThumbnailCache(specs))
      : setTimeout(() => warmThumbnailCache(specs), WARM_IDLE_FALLBACK_MS);
    return () => {
      if (ric && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(cancel as number);
      else clearTimeout(cancel as ReturnType<typeof setTimeout>);
    };
    // itemsは絞込のたびに新規配列になるが、事前ウォームは初回のみ行えばよい（全件対象なので
    // フィルタは無関係）。warmStartedRefで一度きり保証しているためdepsは意図的にenabledのみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // mode（ON/OFFの目標状態）の変化を検知し、ワンカット遷移を開始する。
  // Provider不在ページ（modeが常にgrid固定）ではmodeが変化しないためこのeffectは
  // 初回以降一切作動せず、グリッドの挙動に影響しない。
  //
  // ON方向（グリッド→3D）は、この時点でまだ実グリッドがマウントされている
  // （phaseはまだ"grid"）ため、ここで直接gridRef.currentを読んで完結できる。
  // OFF方向（3D→グリッド）はcanvasのfixed化とphase="toGrid"にするところまでで、
  // 実際の測定・モーフ・スワップ・展開は下の別effect（phase依存）に委ねる。
  // 理由: setPhase後すぐではグリッドDOM（gridRef）のコミットが保証されないため
  // （useEffect(..., [phase])はReactのコミット後にしか走らないため確実。既存の
  // gridRef null問題の既知バグと同じ理由でこの2段構成を維持する）。
  useEffect(() => {
    if (mode === prevModeRef.current) return;
    prevModeRef.current = mode;

    if (mode === "graph") {
      let cancelled = false;
      async function run() {
        setBusy(true);
        posingAbandonedRef.current = false;
        try {
          const gridEl = gridRef.current;
          if (reduceMotion || !gridEl) {
            // reduced-motion/保険: ポーズ・モーフなしの即時スワップ（従来相当）
            rectsRef.current = null;
            setPhase("graph");
            return;
          }
          scrollYRef.current = window.scrollY;

          // 1. 可視カードを収縮（~180ms。実DOMを直接モーフ。テキスト部が畳まれ画像だけになる）
          await shrinkVisibleCards(gridEl);
          if (cancelled) return;

          // rect採取は収縮完了後（行の高さが確定してから）。画面外カードも含む全件
          const rects = captureImageRects(gridEl, adapter.cardIdAttr);
          rectsRef.current = rects;

          // ビューポート内カードを優先ロードし、最大THUMB_WAIT_MSだけ待つ（裏で進行）
          const vh = window.innerHeight;
          const visibleIds = new Set(
            Array.from(gridEl.children)
              .filter((el): el is HTMLElement => el instanceof HTMLElement)
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return r.bottom > 0 && r.top < vh;
              })
              .map((el) => el.getAttribute(adapter.cardIdAttr))
              .filter((id): id is string => !!id),
          );
          const priorityItems = sorted.filter((item) => visibleIds.has(adapter.id(item)));
          const thumbWait = prioritizeAndWaitThumbnails(
            priorityItems.map((item) => toNodeSpec(adapter, item)),
            THUMB_WAIT_MS,
          );

          // Graph3DViewを、現在の見えている領域（スティッキーヘッダーの直下〜）にfixedで
          // 固定してマウントする（canvasはhidden。実際のstyle適用は下のuseLayoutEffectが
          // 担う。グリッドは共存＝同時マウント）。
          // 注意: gridEl自体のrect.topは深くスクロールしているとビューポート外の大きな負値に
          // なるため使えない（平面ポーズの座標原点がずれ、画面外のカードが中央に来てしまう
          // バグを実機Playwrightで検出）。ヘッダーの下端（スティッキーなのでスクロール位置に
          // 関わらず常に「現在見えている内容の開始位置」を表す）を使うことで、スクロール位置が
          // 0でなくても、スワップ前後でスプライトの画面位置が動かないようにする。
          // headerOffsetPx未満にはしない（下限）: スクロールでヘッダーが
          // タイトル抜きの「スタック」高さまで縮んでいる場合、そのままだとcanvasの高さ
          // (100vh-180px)がビューポート下端まで届かず、下端帯の可視カードがスワップで
          // 覆われずグリッドアンマウント時に消えてしまう（レビューで指摘・実機確認）
          pendingCanvasTopRef.current = Math.max(
            headerRef.current?.getBoundingClientRect().bottom ?? 0,
            headerOffsetPx,
          );
          setPhase("toGraph");

          const posed = await new Promise<boolean>((resolve) => {
            onReadyWaiterRef.current = () => resolve(true);
            setTimeout(() => resolve(false), ON_READY_TIMEOUT_MS);
          });
          onReadyWaiterRef.current = null;
          if (cancelled) return;

          if (!posed) {
            // onReady/ポージングがタイムアウト: 諦めて即時スワップ（plan 2-5フォールバック）。
            // fixed位置はまだ解除しない（visibilityだけ反映し、position解除は下の
            // useLayoutEffectに委ねる。Reactのグリッドアンマウントは非同期のため、
            // ここでpositionまで先に解除すると「グリッドが消える前にcanvasが平置きで
            // 割り込む」瞬間が生じてしまう既知の罠）。posingAbandonedRefを立てて、
            // この後遅れて届くonReadyがenterPlanePoseで不意打ちスナップしないようにする
            posingAbandonedRef.current = true;
            if (graphWrapRef.current) graphWrapRef.current.style.visibility = "visible";
            setPhase("graph");
            return;
          }

          await thumbWait;
          if (cancelled) return;

          // 5. スワップ（1フレーム）: canvasを可視化する（fixed位置はまだ解除しない。
          // 下のuseLayoutEffectがグリッドアンマウント後に解除する）→同一タスクでグリッドを
          // アンマウント（setPhase）。position解除をここで一緒に行うと、Reactの再レンダーが
          // 非同期のため一瞬グリッドとcanvasが同時に（重ならず縦積みで）見えてしまうため分離する
          window.scrollTo({ top: 0, behavior: "instant" });
          if (graphWrapRef.current) {
            graphWrapRef.current.style.visibility = "visible";
          }
          setPhase("graph");

          // 6. モーフ: 平面ポーズ→力学レイアウト（完了までbusyを保持する）
          await new Promise<void>((resolve) => {
            const api = graphApiRef.current;
            if (api) api.morphToLayout(resolve);
            else resolve();
          });
        } finally {
          if (!cancelled) setBusy(false);
        }
      }
      run();
      return () => {
        cancelled = true;
      };
    }

    // OFF方向（3D→グリッド）: canvasを現在位置にfixed化して固定し、phaseを"toGrid"にする
    // ところまでをここで行う。実際の測定・モーフ・スワップ・展開は下の別effectに委ねる
    let cancelled = false;
    async function startToGrid() {
      setBusy(true);
      try {
        if (reduceMotion) {
          // canvasを即座に隠してからグリッドを共存マウントする。隠さないと、
          // グリッドが通常フローでマウントされる際canvas(まだ通常フロー・可視)と
          // 縦に並んで一瞬二重表示される（レビューで指摘・実機確認）
          if (graphWrapRef.current) graphWrapRef.current.style.visibility = "hidden";
          graphApiRef.current = null; // reduced-motionはAPI経由のモーフを使わない
          setPhase("toGrid");
          return;
        }
        const wrapEl = graphWrapRef.current;
        if (!wrapEl || !graphApiRef.current) {
          setPhase("toGrid"); // 保険: 後続のphase-effectがフォールバックする
          return;
        }
        const canvasRect = wrapEl.getBoundingClientRect();
        Object.assign(wrapEl.style, {
          position: "fixed",
          top: `${canvasRect.top}px`,
          left: "0",
          right: "0",
        } satisfies Partial<CSSStyleDeclaration>);
        setPhase("toGrid");
      } catch {
        if (!cancelled) setPhase("toGrid"); // 失敗時もグリッドへは必ず戻す
      }
    }
    startToGrid();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // phaseが"toGrid"になった＝実グリッドDOM（gridRef）がコミット済みの状態でのみ発火。
  // ここで初めてスクロール復元・rect採取・モーフ・スワップ・展開を安全に実行できる
  useEffect(() => {
    if (phase !== "toGrid") return;
    let cancelled = false;
    async function run() {
      // 途中で例外が出てもphase/busyを取り残さない（グリッド復帰とトグル操作性を保証）
      try {
        window.scrollTo({ top: scrollYRef.current, behavior: "instant" });
        const gridEl = gridRef.current;
        const api = graphApiRef.current;
        const wrapEl = graphWrapRef.current;
        if (!reduceMotion && gridEl && api && wrapEl) {
          // 3. グリッドの実rectを測定する前に、可視カードのテキスト部を即座に畳んでおく
          // （canvasがまだ手前を覆っているため見えない。平面ポーズの画素一致に必要）
          collapseTextSectionsInstant(gridEl);
          const rects = captureImageRects(gridEl, adapter.cardIdAttr);

          // 4. モーフ: スプライトを現在位置→平面ポーズ、カメラを現在→正準ポーズへ同時トゥイーン
          await new Promise<void>((resolve) => api.morphToPlanePose(rects, resolve));
          if (cancelled) return;

          // 5. スワップ: canvasをvisibility:hiddenに（グリッドは既に真下に同じ絵で存在）
          wrapEl.style.visibility = "hidden";

          // 6. 可視カードのDOM「展開」マイクロモーション（~180ms）。
          // Graph3DViewのアンマウント（setPhase("grid")）は展開の後、このeffectの
          // 最後の同期文として行う。setPhase("grid")はこのeffect自身の依存(phase)を
          // 書き換える＝直後にawaitを挟むとReactがcleanupを実行してcancelled=trueになり、
          // finallyのsetBusy(false)が二度と走らずトグルが永久disabledになる
          // （実機Playwrightで発見した実バグ。awaitをsetPhaseより前に済ませることで
          // finallyまで同期で到達させる。canvasは展開の間hiddenのまま残るだけで無害）
          await expandVisibleCards(gridEl);
          if (cancelled) return;
          graphApiRef.current = null;
          setPhase("grid");
        } else {
          setPhase("grid");
          graphApiRef.current = null;
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Graph3DViewラッパの初期位置・可視性を、マウント直後（ペイント前）に設定する。
  // phaseをdepsにすることで「grid→toGraphへ遷移した時」だけ発火し、呼び出し元の
  // 無関係な再レンダー（sort/filter操作等）のたびに再実行されない
  // （インラインのref callbackで同じことをすると、コミットのたびにReactが
  // detach/attachし直すため毎回styleがリセットされてしまう既知の罠。既存のopacity実装と同じ理由）
  useLayoutEffect(() => {
    if (phase !== "toGraph" || !graphWrapRef.current) return;
    const top = pendingCanvasTopRef.current ?? 0;
    Object.assign(graphWrapRef.current.style, {
      position: "fixed",
      top: `${top}px`,
      left: "0",
      right: "0",
      visibility: "hidden",
    } satisfies Partial<CSSStyleDeclaration>);
  }, [phase]);

  // ON方向のfixed固定解除: phaseが安定した"graph"になった＝グリッドが実際にアンマウント
  // された後（Reactのコミット後）にだけfixed positioningを解除して通常フローへ戻す。
  // スワップ時点（"graph"へのsetPhase呼び出し）でこれを一緒にやると、Reactの再レンダーが
  // 非同期のため「グリッドがまだ残っているのにcanvasが通常フローで縦に並んで見える」
  // 瞬間が生じてしまう（実機Playwright検証で発見。同一コミット扱いできないための対策）
  useLayoutEffect(() => {
    if (phase !== "graph" || !graphWrapRef.current) return;
    const el = graphWrapRef.current;
    if (el.style.position !== "fixed") return; // 既に通常フロー（初回マウント等）なら何もしない
    const fixedTop = parseFloat(el.style.top || "0");
    Object.assign(el.style, {
      position: "",
      top: "",
      left: "",
      right: "",
      visibility: "visible",
    } satisfies Partial<CSSStyleDeclaration>);
    // グリッドを深くスクロールした状態でONした場合、fixed中はスティッキーヘッダーが
    // 「スタック」した高さ基準で固定していたが、通常フローに戻る頃にはscrollTo(0)で
    // ページ上部のタイトル等が再表示されヘッダーの実効オフセットが変わっている
    // ことがある。その差分をrelativeのtopオフセットで吸収し、モーフ中に
    // canvas全体が縦にジャンプするのを防ぐ（実機Playwright検証で発見）
    const naturalTop = el.getBoundingClientRect().top;
    const delta = fixedTop - naturalTop;
    if (Math.abs(delta) > 0.5) {
      el.style.position = "relative";
      el.style.top = `${delta}px`;
    }
  }, [phase]);

  const showGrid = phase === "grid" || phase === "toGraph" || phase === "toGrid";
  const showGraph = phase === "toGraph" || phase === "graph" || phase === "toGrid";

  return { phase, showGrid, showGraph, graphWrapRef, handleGraphReady };
}
