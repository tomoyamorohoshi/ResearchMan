"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Case } from "@/lib/cases";
import CaseCard from "./CaseCard";
import { useFavorites } from "@/hooks/useFavorites";
import { compareByAward } from "@/lib/awardLevel";
import { compareByAwardForCollection, type OrgKey } from "@/lib/awards";
import { tabSources, getSourceKind } from "@/lib/researchSources";
import { TAG_AXES, tagAxis, tagLabel } from "@/lib/tags";
import { useViewMode } from "./ViewModeContext";
import {
  captureImageRects,
  shrinkVisibleCards,
  collapseTextSectionsInstant,
  expandVisibleCards,
  type PlaneCardRect,
} from "@/lib/viewTransition";
import { warmThumbnailCache, prioritizeAndWaitThumbnails } from "@/lib/graphSprites";
import type { GraphTransitionApi } from "./Graph3DView";

// 3d-force-graph/threeはwindow依存のためssr:false必須。トグルON時にのみチャンク取得される
const Graph3DView = dynamic(() => import("./Graph3DView"), {
  ssr: false,
  loading: () => (
    <div className="text-center py-32 text-[10px] tracking-[0.3em] uppercase text-gray-400">
      Loading 3D view…
    </div>
  ),
});

// onReady+ポージングがこの時間内に来なかった場合、諦めて即時スワップする
// （plan 2-5フォールバック。ワンカットは崩れるが機能は生きる）
const ON_READY_TIMEOUT_MS = 1500;
// ON押下時、ビューポート内カードの優先ロードを待つ上限（間に合わない分はプレースホルダで進む）
const THUMB_WAIT_MS = 600;
// マウント後、サムネイル事前ウォームを開始するまでのアイドル待ち（requestIdleCallback無い環境向け）
const WARM_IDLE_FALLBACK_MS = 2000;
// Graph3DView.tsxの `h-[calc(100vh-180px)]` と合わせる値。ON方向のhold中、canvasをfixedで
// 固定するtopの下限として使う。スクロールしてスティッキーヘッダーが「スタック」状態
// （タイトル分の高さを含まない、この値より小さい高さ）の時にそのままtopへ使うと、
// canvasの高さ(100vh-180px)がビューポート下端まで届かず、下端帯の可視カードがスワップで
// 覆われずグリッドアンマウント時に消えてしまう（レビューで指摘・実機確認）。
// topをこの値未満にしないことで、canvas下端が必ずビューポート下端以上に届くようにする
const GRAPH3D_HEIGHT_OFFSET_PX = 180;

type Props = {
  cases: Case[];
  categories: string[];
  years: string[];
  regions: string[];
  sources?: string[];
  tags?: string[];
  defaultSort?: SortOrder;
  // 指定時、award系ソート・バッジは「その部門でのレベル」を使う（部門ページ用）
  awardContext?: { org: OrgKey; year: string; category: string };
};

type SortOrder = "added" | "year" | "award";

// "toGraph"/"toGrid" はトランジション中の一時状態。この間はグリッドとGraph3DViewが
// 同時にマウントされる（「グリッド平面モーフ」方式。計画書Part2参照）。
// mode(ViewModeContext)は「目標状態」のまま変えず、phaseだけがこの間接的な状態を持つ
type DisplayPhase = "grid" | "toGraph" | "graph" | "toGrid";

export default function GalleryClient({ cases, categories, years, regions, sources = [], tags = [], defaultSort = "added", awardContext }: Props) {
  const [filters, setFilters] = useState({ category: "", year: "", region: "", source: "", tag: "" });
  const [tab, setTab] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOrder>(defaultSort);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const { favorites, toggle, mounted } = useFavorites();
  const { mode, setBusy, enabled } = useViewMode();
  const [phase, setPhase] = useState<DisplayPhase>(mode === "graph" ? "graph" : "grid");
  const gridRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
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

  // filtered/sorted: ON方向のeffectがrect採取・優先ロード対象の算出に使うため、
  // effectより前（宣言前アクセス回避）に計算しておく
  const filtered = cases.filter((c) => {
    if (tab && !(c.sources ?? []).includes(tab)) return false;
    if (showFavoritesOnly && !favorites.has(c.id)) return false;
    if (filters.category && !c.categories.includes(filters.category)) return false;
    if (filters.year && c.year !== filters.year) return false;
    if (filters.region && !c.regions.includes(filters.region)) return false;
    if (filters.source && !(c.sources ?? []).includes(filters.source)) return false;
    if (filters.tag && !(c.tags ?? []).includes(filters.tag)) return false;
    if (query) {
      const q = query.toLowerCase();
      return (
        c.title.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        c.client.toLowerCase().includes(q) ||
        c.agency.toLowerCase().includes(q) ||
        (c.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const sorted =
    sort === "year"
      ? [...filtered].sort((a, b) => parseInt(b.year) - parseInt(a.year))
      : sort === "award"
        ? [...filtered].sort(
            awardContext
              ? (a, b) => compareByAwardForCollection(a, b, awardContext.org, awardContext.year, awardContext.category)
              : compareByAward,
          )
        : filtered;

  // enabled時のみ: マウント後のアイドル時間に全件サムネイルを事前ウォームする
  // （ON押下時の画素一致スワップの前提。/awards・/technology等Provider不在ページでは
  // enabled=falseのため発火しない＝無駄な帯域を使わない）
  useEffect(() => {
    if (!enabled || warmStartedRef.current) return;
    warmStartedRef.current = true;
    const ric = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback : null;
    const cancel = ric
      ? ric(() => warmThumbnailCache(cases))
      : setTimeout(() => warmThumbnailCache(cases), WARM_IDLE_FALLBACK_MS);
    return () => {
      if (ric && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(cancel as number);
      else clearTimeout(cancel as ReturnType<typeof setTimeout>);
    };
    // casesは絞込のたびに新規配列になるが、事前ウォームは初回のみ行えばよい（全件対象なので
    // フィルタは無関係）。warmStartedRefで一度きり保証しているためdepsは意図的にenabledのみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // mode（ON/OFFの目標状態）の変化を検知し、ワンカット遷移を開始する。
  // /awards・/technology等（ViewModeProvider不在＝modeが常にgrid固定）ではmodeが
  // 変化しないためこのeffectは初回以降一切作動せず、グリッドの挙動に影響しない。
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
          const rects = captureImageRects(gridEl);
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
              .map((el) => el.getAttribute("data-case-id"))
              .filter((id): id is string => !!id),
          );
          const priorityCases = sorted.filter((c) => visibleIds.has(c.id));
          const thumbWait = prioritizeAndWaitThumbnails(priorityCases, THUMB_WAIT_MS);

          // Graph3DViewを、現在の見えている領域（スティッキーヘッダーの直下〜）にfixedで
          // 固定してマウントする（canvasはhidden。実際のstyle適用は下のuseLayoutEffectが
          // 担う。グリッドは共存＝同時マウント）。
          // 注意: gridEl自体のrect.topは深くスクロールしているとビューポート外の大きな負値に
          // なるため使えない（平面ポーズの座標原点がずれ、画面外のカードが中央に来てしまう
          // バグを実機Playwrightで検出）。ヘッダーの下端（スティッキーなのでスクロール位置に
          // 関わらず常に「現在見えている内容の開始位置」を表す）を使うことで、スクロール位置が
          // 0でなくても、スワップ前後でスプライトの画面位置が動かないようにする。
          // GRAPH3D_HEIGHT_OFFSET_PX未満にはしない（下限）: スクロールでヘッダーが
          // タイトル抜きの「スタック」高さまで縮んでいる場合、そのままだとcanvasの高さ
          // (100vh-180px)がビューポート下端まで届かず、下端帯の可視カードがスワップで
          // 覆われずグリッドアンマウント時に消えてしまう（レビューで指摘・実機確認）
          pendingCanvasTopRef.current = Math.max(
            headerRef.current?.getBoundingClientRect().bottom ?? 0,
            GRAPH3D_HEIGHT_OFFSET_PX,
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
          const rects = captureImageRects(gridEl);

          // 4. モーフ: スプライトを現在位置→平面ポーズ、カメラを現在→正準ポーズへ同時トゥイーン
          await new Promise<void>((resolve) => api.morphToPlanePose(rects, resolve));
          if (cancelled) return;

          // 5. スワップ（1フレーム）: canvasをvisibility:hiddenに→同一コミットでGraph3DViewアンマウント
          wrapEl.style.visibility = "hidden";
          setPhase("grid");
          graphApiRef.current = null;

          // 6. 可視カードのDOM「展開」マイクロモーション（~180ms）
          if (!cancelled) await expandVisibleCards(gridEl);
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
  // phaseをdepsにすることで「grid→toGraphへ遷移した時」だけ発火し、GalleryClientの
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

  // タブ（リサーチオーダー／Radar）— データに1件以上あるものだけ件数付きで表示
  const tabs = tabSources
    .map((s) => ({
      ...s,
      count: cases.filter((c) => (c.sources ?? []).includes(s.tag)).length,
    }))
    .filter((s) => s.count > 0);

  // 「#」ハッシュタグフィルターはアワード系ソースのみ（タブと役割を分ける）
  const awardSources = sources.filter((s) => getSourceKind(s) === "award");

  const favoriteCount = mounted ? favorites.size : 0;
  const activeFilterCount = [filters.category, filters.year, filters.region, filters.source, filters.tag].filter(Boolean).length;

  const showGrid = phase === "grid" || phase === "toGraph" || phase === "toGrid";
  const showGraph = phase === "toGraph" || phase === "graph" || phase === "toGrid";

  return (
    <>
      {/* ── コントロールバー ── */}
      <div ref={headerRef} className="border-b border-gray-300 bg-[#eeece7] sticky top-0 z-10">
        {/* リサーチオーダー別タブ */}
        {tabs.length > 0 && (
          <div className="border-b border-gray-200">
            <div
              className="max-w-[1600px] mx-auto px-4 flex items-stretch gap-1 overflow-x-auto"
              role="tablist"
              aria-label="リサーチオーダー"
            >
              <TabButton label="All" active={tab === ""} onClick={() => setTab("")} />
              {tabs.map((t) => (
                <TabButton
                  key={t.tag}
                  label={t.label}
                  count={t.count}
                  radar={t.kind === "radar"}
                  active={tab === t.tag}
                  onClick={() => setTab(tab === t.tag ? "" : t.tag)}
                />
              ))}
            </div>
          </div>
        )}
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          {/* 検索 */}
          <input
            type="text"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 min-w-36 max-w-xs bg-transparent border-b border-gray-400 pb-0.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-900 tracking-wide"
          />

          {/* フィルタートグル */}
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`text-[10px] tracking-[0.2em] uppercase font-bold transition-colors ${
              showFilters || activeFilterCount > 0 ? "text-gray-900" : "text-gray-400 hover:text-gray-900"
            }`}
          >
            Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>

          <span className="text-gray-300">|</span>

          {/* ソート */}
          {(["added", "year", "award"] as SortOrder[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`text-[10px] tracking-[0.2em] uppercase font-bold transition-colors ${
                sort === s ? "text-gray-900" : "text-gray-400 hover:text-gray-900"
              }`}
            >
              {s === "added" ? "New" : s === "year" ? "Year" : "Award"}
            </button>
          ))}

          <span className="text-gray-300">|</span>

          {/* お気に入り */}
          <button
            onClick={() => setShowFavoritesOnly((v) => !v)}
            className={`flex items-center gap-1 text-[10px] tracking-[0.2em] uppercase font-bold transition-colors ${
              showFavoritesOnly ? "text-yellow-500" : "text-gray-400 hover:text-gray-900"
            }`}
          >
            <svg viewBox="0 0 24 24" fill={showFavoritesOnly ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2.5} className="w-3 h-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
            Saved{favoriteCount > 0 ? ` ${favoriteCount}` : ""}
          </button>

          <span className="ml-auto text-[10px] text-gray-400 tabular-nums tracking-wider">
            {sorted.length} items
          </span>
        </div>

        {/* 展開フィルターパネル */}
        {showFilters && (
          <div className="border-t border-gray-200 max-w-[1600px] mx-auto px-4 py-3 flex flex-wrap gap-x-8 gap-y-2">
            <FilterGroup label="Category" options={categories} value={filters.category}
              onSelect={(v) => setFilters((p) => ({ ...p, category: p.category === v ? "" : v }))} />
            <FilterGroup label="Year" options={years} value={filters.year}
              onSelect={(v) => setFilters((p) => ({ ...p, year: p.year === v ? "" : v }))} />
            <FilterGroup label="Region" options={regions} value={filters.region}
              onSelect={(v) => setFilters((p) => ({ ...p, region: p.region === v ? "" : v }))} />
            {awardSources.length > 0 && (
              <FilterGroup label="Source" options={awardSources} value={filters.source} prefix="#"
                onSelect={(v) => setFilters((p) => ({ ...p, source: p.source === v ? "" : v }))} />
            )}
            {/* ハッシュタグ（Tech/Form/Theme の3軸。表示は #キーワードのみ、値はフルパス） */}
            {TAG_AXES.map((axis) => {
              const axisTags = tags.filter((t) => tagAxis(t) === axis);
              if (axisTags.length === 0) return null;
              return (
                <FilterGroup key={axis} label={axis} options={axisTags} value={filters.tag}
                  prefix="#" format={tagLabel} limit={16}
                  onSelect={(v) => setFilters((p) => ({ ...p, tag: p.tag === v ? "" : v }))} />
              );
            })}
            {activeFilterCount > 0 && (
              <button
                onClick={() => setFilters({ category: "", year: "", region: "", source: "", tag: "" })}
                className="text-[10px] tracking-widest uppercase text-gray-400 hover:text-gray-900 self-center"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {showGrid && (
        <>
          {/* ── グリッド ── */}
          <div className="max-w-[1600px] mx-auto">
            <div ref={gridRef} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-px bg-gray-300">
              {sorted.map((c) => (
                <CaseCard
                  key={c.id}
                  c={c}
                  isFavorite={mounted && favorites.has(c.id)}
                  onToggleFavorite={toggle}
                  awardContext={awardContext}
                />
              ))}
            </div>
          </div>

          {sorted.length === 0 && (
            <div className="text-center py-32 text-[10px] tracking-[0.3em] uppercase text-gray-400">
              {showFavoritesOnly ? "No saved items yet" : "No results found"}
            </div>
          )}
        </>
      )}
      {showGraph && (
        <div ref={graphWrapRef}>
          <Graph3DView cases={sorted} onReady={handleGraphReady} />
        </div>
      )}
    </>
  );
}

function TabButton({
  label, count, active, radar = false, onClick,
}: {
  label: string; count?: number; active: boolean; radar?: boolean; onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative shrink-0 px-3 py-2.5 text-[10px] tracking-[0.15em] uppercase font-bold transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
        active
          ? "text-gray-900 border-gray-900"
          : "text-gray-400 border-transparent hover:text-gray-700"
      }`}
    >
      {radar && <span className="w-1 h-1 rounded-full bg-[#b08d2d]" aria-hidden="true" />}
      {label}
      {typeof count === "number" && (
        <span className="text-[9px] text-gray-400 tabular-nums font-normal">{count}</span>
      )}
    </button>
  );
}

function FilterGroup({
  label, options, value, onSelect, prefix = "", format, limit = 12,
}: {
  label: string; options: string[]; value: string; onSelect: (v: string) => void;
  prefix?: string; format?: (v: string) => string; limit?: number;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[9px] tracking-[0.25em] uppercase text-gray-400 font-bold w-14 shrink-0">{label}</span>
      {options.slice(0, limit).map((opt) => (
        <button
          key={opt}
          onClick={() => onSelect(opt)}
          className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border transition-colors ${
            value === opt
              ? "border-gray-900 text-gray-900 font-bold"
              : "border-gray-300 text-gray-400 hover:border-gray-600 hover:text-gray-700"
          }`}
        >
          {prefix}{format ? format(opt) : opt}
        </button>
      ))}
    </div>
  );
}
