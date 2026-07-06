"use client";

// /ideas 専用のスクロール駆動3Dカードデッキ（DESIGN: goofy-hatching-mango.md）。
// ページの素のスクロールが進捗になる「sticky+perspective」ステージ。奥のカードは
// 台形に連なって覗き、スクロールで最前面カードが手前・下へ倒れながら画面外へ捲れ、
// スタック全体が1段前進する。
//
// 実装方針（既存3D実装＝Graph3DView.tsxのrAF流儀に揃える）:
// スクロールはrAFで1本化したハンドラがstyleへ直接書き込む（Reactのstate経由にしない）。
// 各カードのJSX styleは常に「p=0固定」で計算した値を返す定数関数のため、Reactは
// 再レンダーのたびに同じ値と比較して「変化なし」と判定しdiffを書き戻さない
// （＝rAFの直接書き込みを上書きしない）。windowRangeのstate更新（カードの
// マウント/アンマウント）はこの性質に依存しないため安全に共存する。
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import IdeaCard from "@/components/IdeaCard";
import { dateLabelOf, type Idea } from "@/lib/ideas";

// ── 振り付け定数（目視調整可。plan Bの初期値） ──────────────────────
// 1枚分のスクロール量（viewportHの比率）。trackHeightとscroll進捗計算の両方で使う
const SCROLL_PER_CARD_VH = 55;
// デッキ内(d>=0)のy: -pow(d, exponent) * step px（奥ほど間隔が詰まる）
const DECK_Y_EXPONENT = 0.85;
const DECK_Y_STEP_PX = 46;
// デッキ内のz: -d * step px（奥へ）
const DECK_Z_STEP_PX = 90;
// デッキ内のrotateX: min(base + d*step, max) deg（奥ほど台形に）
const DECK_ROTATE_BASE_DEG = 8;
const DECK_ROTATE_STEP_DEG = 3;
const DECK_ROTATE_MAX_DEG = 34;
// 不透明度: d<=FLAT_UNTIL は1、FLAT_UNTIL〜FADE_ENDで1→0
const DECK_OPACITY_FLAT_UNTIL = 6;
const DECK_OPACITY_FADE_END = 9;
// 捲れ中(-1<=d<0, t=-d)の変化量
const PEEL_DROP_VH_RATIO = 0.95; // y += smoothstep(t) * viewportH * ratio
const PEEL_Z_LIFT_PX = 200; // z += t * px
const PEEL_ROTATE_STEP_DEG = 30; // rotateX = base - t * step
// 描画ウィンドウ: d < AHEAD かつ d >= -BEHIND のカードだけレンダリング（他は非表示）
const RENDER_WINDOW_AHEAD = 10;
const RENDER_WINDOW_BEHIND = 2;
// リンクは|d| < この値のカードだけ有効（誤クリック防止）
const ACTIVE_POINTER_THRESHOLD = 0.5;
// スクロールヒントを消す進捗のしきい値（最初の捲りで消える）
const HINT_DISMISS_P = 0.02;
// カードの絶対サイズ
const CARD_WIDTH_CSS = "min(620px, 92vw)";
const CARD_HEIGHT_CSS = "clamp(360px, 52vh, 460px)";

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

type CardFrame = {
  y: number;
  z: number;
  rotateX: number;
  opacity: number;
};

// d = i - p（p=現在の進捗）からカード1枚分の姿勢を計算する純関数。
// SSR/初期描画（p=0固定）と、rAFループ（実際のp）の両方から呼ばれる
function cardFrameOf(d: number, viewportH: number): CardFrame {
  if (d >= 0) {
    const y = -Math.pow(d, DECK_Y_EXPONENT) * DECK_Y_STEP_PX;
    const z = -d * DECK_Z_STEP_PX;
    const rotateX = Math.min(DECK_ROTATE_BASE_DEG + d * DECK_ROTATE_STEP_DEG, DECK_ROTATE_MAX_DEG);
    let opacity = 1;
    if (d > DECK_OPACITY_FLAT_UNTIL) {
      const span = DECK_OPACITY_FADE_END - DECK_OPACITY_FLAT_UNTIL;
      opacity = 1 - clamp((d - DECK_OPACITY_FLAT_UNTIL) / span, 0, 1);
    }
    return { y, z, rotateX, opacity };
  }
  // 捲れ中（-1<=d<0）。dが-1を超えて負に大きい場合（描画ウィンドウの背面バッファ）は
  // t=1（捲れ切った姿勢）にクランプする。不透明度はフェードで誤魔化さず常に1のまま
  const t = clamp(-d, 0, 1);
  const y = smoothstep(t) * viewportH * PEEL_DROP_VH_RATIO;
  const z = t * PEEL_Z_LIFT_PX;
  const rotateX = DECK_ROTATE_BASE_DEG - t * PEEL_ROTATE_STEP_DEG;
  return { y, z, rotateX, opacity: 1 };
}

function transformOf(frame: CardFrame): string {
  return `translate(-50%, -50%) translate3d(0, ${frame.y}px, ${frame.z}px) rotateX(${frame.rotateX}deg)`;
}

// 中央配置＋perspective越しに自然な奥行きが出るための静的な位置スタイル
// （transform/opacity/pointerEventsは含めない。それらは常に「p=0固定」計算値を別途
// 付与するか、マウント後はrAFが直接DOM書き込みする）
// reduced-motion検出はuseFavorites.tsのmountedと同じuseSyncExternalStoreイディオムを踏襲する
// （useEffect+setStateで直接切り替えると、サーバー(常にfalse)と実際の初回クライアント値が
// 食い違った場合にhydrationミスマッチを起こす。getServerSnapshotをfalse固定にすることで
// サーバー/初回クライアント描画を一致させ、mount後にReactが正しい値へ差し替える）
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function getReducedMotionSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
function getReducedMotionServerSnapshot(): boolean {
  return false; // SSR/初回描画は常にデッキ側で確定させる
}

const CARD_POSITION_STYLE: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: CARD_WIDTH_CSS,
  height: CARD_HEIGHT_CSS,
  transformOrigin: "bottom center",
  willChange: "transform",
};

export default function IdeasDeck({ ideas }: { ideas: Idea[] }) {
  const N = ideas.length;
  const trackRef = useRef<HTMLDivElement>(null);
  // sticky ステージ（h-screen）の実高さ。進捗pの分母をwindow.innerHeightではなくDOM実寸
  // （trackとstageのoffsetHeight差分）から導出するために参照する（修正4：モバイルでツールバーの
  // 出し入れにより動的に変わるwindow.innerHeightと、trackHeightCssが解決するvhベースの高さの
  // 単位系がズレて終端手前でスクロール無反応になる不具合への対処）
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const counterRef = useRef<HTMLSpanElement>(null);
  const dateRef = useRef<HTMLSpanElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const viewportHRef = useRef(0);

  // reduced-motion: SSR/初回描画は常にfalse（デッキ）で確定させ、mount後に実値へ
  // 切り替える（サーバーと初回クライアント描画を一致させ、hydrationミスマッチを避ける）
  const reduceMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
  // 描画ウィンドウ。SSR/初回描画は全件（SEO・no-JS対応）。mount後にrAF側で絞り込む
  const [windowRange, setWindowRange] = useState<{ start: number; end: number }>(() => ({ start: 0, end: N }));
  // 直近に計算した進捗p・viewportH（windowRange変化時の再適用用。下のuseLayoutEffect参照）
  const latestPRef = useRef(0);

  // 現在マウント済みの各カードへ、進捗pに基づく姿勢を直接書き込む（Reactのstate経由にしない）
  const writeCardStyles = useCallback((p: number, viewportH: number) => {
    for (const [i, el] of cardRefs.current) {
      const d = i - p;
      const frame = cardFrameOf(d, viewportH);
      const active = Math.abs(d) < ACTIVE_POINTER_THRESHOLD;
      el.style.transform = transformOf(frame);
      el.style.opacity = String(frame.opacity);
      el.style.pointerEvents = active ? "auto" : "none";
      el.inert = !active;
      if (active) el.removeAttribute("aria-hidden");
      else el.setAttribute("aria-hidden", "true");
    }
  }, []);

  // trackの実レイアウトから進捗pを同期算出する（scrollイベント外の文脈からも呼べるよう分離）。
  // 分母perCardPxはtrack/stage双方のoffsetHeight差分から導出し、window.innerHeightには
  // 依存しない（修正4）。N<=1は1枚しかなくスクロール進捗自体が無意味なため0固定でガードする
  const measureP = useCallback((): number => {
    const track = trackRef.current;
    const stage = stageRef.current;
    if (!track || !stage || N <= 1) return 0;
    const perCardPx = (track.offsetHeight - stage.offsetHeight) / (N - 1);
    if (perCardPx <= 0) return 0;
    const rectTop = track.getBoundingClientRect().top;
    return clamp(-rectTop / perCardPx, 0, N - 1);
  }, [N]);

  // pを受け取り、カード姿勢・windowRange目標値・カウンター/日付/ヒントをまとめて反映する共通処理
  // （マウント直後のuseLayoutEffectと、scroll/resize後のapplyFrameの両方から同じロジックを使う）
  const applyFrameAt = useCallback(
    (p: number, viewportH: number) => {
      latestPRef.current = p;
      const maxP = Math.max(N - 1, 0);
      const desiredStart = clamp(Math.floor(p - RENDER_WINDOW_BEHIND), 0, N);
      const desiredEnd = clamp(Math.ceil(p + RENDER_WINDOW_AHEAD), 0, N);
      setWindowRange((prev) =>
        prev.start === desiredStart && prev.end === desiredEnd ? prev : { start: desiredStart, end: desiredEnd },
      );

      writeCardStyles(p, viewportH);

      const activeIndex = clamp(Math.round(p), 0, maxP);
      const activeIdea = ideas[activeIndex];
      if (counterRef.current) counterRef.current.textContent = `${pad2(activeIndex + 1)} / ${pad2(N)}`;
      if (dateRef.current && activeIdea) dateRef.current.textContent = dateLabelOf(activeIdea);
      if (hintRef.current) hintRef.current.style.opacity = p > HINT_DISMISS_P ? "0" : "1";
    },
    [N, ideas, writeCardStyles],
  );

  const applyFrame = useCallback(() => {
    if (!trackRef.current || N === 0) return;
    const viewportH = viewportHRef.current || window.innerHeight;
    applyFrameAt(measureP(), viewportH);
  }, [N, measureP, applyFrameAt]);

  // windowRangeが変わってカードが新規マウントされた直後、コミット後・ペイント前に
  // 実レイアウトから同期算出したpで即座に姿勢を書き直す（新規マウントカードは静的な「p=0」
  // 初期styleのままだと、次のscroll/resizeイベントが来るまで誤った姿勢のまま描画されてしまう
  // 罠への対処。例: 高速な単発ジャンプでデッキ終端に着地すると、次のイベントが来ずステージが
  // 空白のまま固まる不具合が実機検証で見つかった）。
  // 初回マウント時もこのeffectが走るため、trackRef.current頼みだったlatestPRef初期値0を
  // そのまま使っていた旧実装の「深いスクロール位置でリロードすると1フレーム1枚目が見える」
  // 不具合も、ここでmeasureP()により実際のpを算出することで解消する
  useLayoutEffect(() => {
    if (reduceMotion || N === 0) return;
    const viewportH = viewportHRef.current || (typeof window !== "undefined" ? window.innerHeight : 0);
    applyFrameAt(measureP(), viewportH);
  }, [windowRange, reduceMotion, N, measureP, applyFrameAt]);

  useEffect(() => {
    if (reduceMotion || N === 0) return;
    viewportHRef.current = window.innerHeight;
    let ticking = false;
    let rafId = 0;
    const scheduleApplyFrame = () => {
      if (ticking) return;
      ticking = true;
      rafId = requestAnimationFrame(() => {
        applyFrame();
        ticking = false;
      });
    };
    const onScroll = () => {
      scheduleApplyFrame();
    };
    const onResize = () => {
      // 実寸は同期的に即座に更新（呼び出し順序に依存させない）。反映（applyFrame呼び出し）自体は
      // resizeイベント連発を間引くためscrollと同じrAF経路に載せる
      viewportHRef.current = window.innerHeight;
      scheduleApplyFrame();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    applyFrame(); // 初回フレーム（scroll未発火でも実際の位置に同期させる）
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(rafId);
    };
  }, [reduceMotion, applyFrame, N]);

  const trackHeightCss = useMemo(() => `${Math.max(N - 1, 0) * SCROLL_PER_CARD_VH + 100}vh`, [N]);
  const initialCounter = `${pad2(1)} / ${pad2(N)}`;
  const initialDateLabel = ideas[0] ? dateLabelOf(ideas[0]) : "";

  if (reduceMotion || N === 0) {
    return <IdeasGridFallback ideas={ideas} />;
  }

  return (
    <div ref={trackRef} style={{ height: trackHeightCss }} className="relative">
      <div
        ref={stageRef}
        className="sticky top-0 h-screen overflow-hidden"
        style={{ perspective: 1200, perspectiveOrigin: "50% 28%", transformStyle: "preserve-3d" }}
      >
        {ideas.slice(windowRange.start, windowRange.end).map((idea, offset) => {
          const i = windowRange.start + offset;
          // p=0固定で計算した初期姿勢（SSR/初回描画用）。この値はi・ideasが変わらない限り
          // 再レンダーのたびに同一のためReactは書き戻さず、mount後のrAF直接書き込みを妨げない
          const initialFrame = cardFrameOf(i, 0);
          const initialActive = Math.abs(i) < ACTIVE_POINTER_THRESHOLD;
          return (
            <div
              key={idea.id}
              ref={(el) => {
                if (el) cardRefs.current.set(i, el);
                else cardRefs.current.delete(i);
              }}
              style={{
                ...CARD_POSITION_STYLE,
                zIndex: Math.max(1, 1000 - i),
                transform: transformOf(initialFrame),
                opacity: initialFrame.opacity,
                pointerEvents: initialActive ? "auto" : "none",
              }}
              aria-hidden={initialActive ? undefined : "true"}
            >
              <IdeaCard idea={idea} fill className="w-full" />
            </div>
          );
        })}

        <div className="absolute left-4 bottom-4 flex items-baseline gap-2 text-[10px] tracking-[0.25em] uppercase text-gray-400 tabular-nums pointer-events-none">
          <span ref={counterRef}>{initialCounter}</span>
          <span ref={dateRef}>{initialDateLabel}</span>
        </div>

        <div
          ref={hintRef}
          className="absolute inset-x-0 bottom-10 flex justify-center text-[10px] tracking-[0.25em] uppercase text-gray-400 pointer-events-none transition-opacity duration-500"
        >
          SCROLL ↓
        </div>
      </div>
    </div>
  );
}

// reduced-motion時のフォールバック。従来のグリッド表示（変更前のideas/page.tsx本体）をそのまま維持する
function IdeasGridFallback({ ideas }: { ideas: Idea[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-gray-300 max-w-[1600px] mx-auto">
      {ideas.map((idea) => (
        <IdeaCard key={idea.id} idea={idea} />
      ))}
    </div>
  );
}
