"use client";

// TOPページ3Dノードグラフ本体。3d-force-graph(ESM, window依存)を使うため、
// 呼び出し元(GalleryClient)で必ず next/dynamic + ssr:false 経由でロードすること。
import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraph3DInstance } from "3d-force-graph";
import * as THREE from "three";
import type { Case } from "@/lib/cases";
import { buildGraphData, linkDistance, linkStrength, swayOffset, type GraphNode } from "@/lib/graph";
import { createNodeObject, setNodeHover, updateLabelFacing, SPRITE_W } from "@/lib/graphSprites";
import { createClusterLabels, type ClusterLabelHandle } from "@/lib/clusterLabels";
import CasePanel from "./CasePanel";

// 3d-force-graph(three-forcegraph)がnodeThreeObjectの戻り値に自動で束縛するプロパティ
type NodeWithSprite = GraphNode & { __threeObj?: THREE.Group };

// クリックしたノードへのカメラ急旋回: ノード方向の延長線上、この距離だけ手前に着地する
const CAMERA_FOCUS_DISTANCE = 90;
const CAMERA_FOCUS_TRANSITION_MS = 800;
// パネルclose時、クリック前のカメラ位置へ戻すトランジション時間
const CAMERA_RESTORE_TRANSITION_MS = 700;

// アンビエントカメラドリフト: OrbitControls標準のautoRotateを使う（既定2.0の約1/6＝
// 約170秒/周の超低速。回転中心はcontrols.target＝通常は原点、ノードクリック後は選択ノード、
// スペース接近後はそのクラスタ重心と自然に追従する）
const AMBIENT_ROTATE_SPEED = 0.35;
// ON遷移のonReadyが期限内に来なかった場合のフェイルセーフ: 初回onEngineStopからこの時間後、
// まだ開始していなければ自動でドリフトを開始する
const AMBIENT_FAILSAFE_MS = 4000;

// スペースキーでランダムなタグクラスタへカメラ接近する機能の定数
const SPACE_FLY_TRANSITION_MS = 1200;
const SPACE_FLY_COOLDOWN_MS = 1300; // 連打によるtween競合を防ぐ
// 接近後のカメラ距離: クラスタの世界幅に比例させ、下限・上限でclampする
const SPACE_FLY_DISTANCE_FACTOR = 2.5;
const SPACE_FLY_DISTANCE_MIN = 140;
const SPACE_FLY_DISTANCE_MAX = 320;

// graph.controls()（OrbitControls）から使うプロパティのみを型付けするキャスト先。
// three-render-objectsの型定義がOrbitControlsを公開していないための既存パターン
type OrbitControlsLike = { target: THREE.Vector3; autoRotate: boolean; autoRotateSpeed: number };

// 初回マウント時のみ: 最初のgraphData()投入前にこの値へ設定し、warmupを同期実行させて
// 最初の描画フレームからレイアウトを確定させる（=onEngineStopが即発火）。
// 2回目以降（フィルタ変更）は従来どおりの収束アニメーションに戻す
const INITIAL_WARMUP_TICKS = 280;
const INITIAL_WARMUP_TICKS_REDUCED = 200;
const RELOAD_WARMUP_TICKS = 40;
const RELOAD_WARMUP_TICKS_REDUCED = 200;
const RELOAD_COOLDOWN_TICKS = 240;

// クリック前のカメラ状態のスナップショット。targetはOrbitControlsの
// 真の回転中心（graph.controls().target）をcloneして保存する。
// 注意: graph.cameraPosition()（getter）のlookAtは「カメラ前方1000の点」であり
// 真のcontrols.targetではない（three-render-objects.mjs getLookAt参照）。
// デフォルトのカメラ距離がちょうど1000のため未ズーム時は偶然一致するが、
// ズーム後は復帰した回転中心が視線方向へ(1000-実距離)ずれてしまう。
// そのためlookAtではなくcontrols.targetを直接保存・復帰する
type CameraSnapshot = { x: number; y: number; z: number; target: THREE.Vector3 };

// 事例id → ビューポート座標系でのノード中心とスクリーン上の見かけ幅(px)。存在しなければnull
export type GraphTransitionApi = {
  screenCoords: (id: string) => { x: number; y: number; width: number } | null;
  // アンビエントカメラドリフトを開始する（冪等）。ON遷移の着地完了後に呼ぶ想定
  beginAmbient: () => void;
};

// ノード中心のビューポート座標とスクリーン上の見かけ幅を算出する。
// graph2ScreenCoordsはcanvas左上基準のピクセル座標を返すため、containerの
// getBoundingClientRect()offsetを加算してビューポート座標に変換する。
// 見かけ幅はカメラのright vectorを使い、中心と(中心+right*半幅)の距離×2で求める
// （スプライトはworld幅16=SPRITE_W。半幅8）
function computeScreenCoords(
  graph: ForceGraph3DInstance,
  containerEl: HTMLElement | null,
  nodes: GraphNode[],
  id: string,
): { x: number; y: number; width: number } | null {
  if (!containerEl) return null;
  const node = nodes.find((n) => n.id === id);
  if (!node || node.x === undefined || node.y === undefined || node.z === undefined) return null;
  const { x, y, z } = node;
  const rect = containerEl.getBoundingClientRect();
  const center = graph.graph2ScreenCoords(x, y, z);
  const camera = graph.camera();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const halfWidth = SPRITE_W / 2;
  const edge = graph.graph2ScreenCoords(x + right.x * halfWidth, y + right.y * halfWidth, z + right.z * halfWidth);
  const width = Math.hypot(edge.x - center.x, edge.y - center.y) * 2;
  return { x: rect.left + center.x, y: rect.top + center.y, width };
}

type Props = {
  cases: Case[];
  // マウント直後のレイアウト確定時に一度だけ呼ばれる。遷移演出との連携用
  onReady?: (api: GraphTransitionApi) => void;
};

export default function Graph3DView({ cases, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph3DInstance | null>(null);
  const [selected, setSelected] = useState<Case | null>(null);
  // ノードクリック直前のカメラ位置/注視点。パネルclose時にここへ復帰する。
  // 未保存時のみ書き込む（パネルを開いたまま別ノードをクリックしても、
  // 復帰先は最初のクリック前の位置を維持する）
  const preClickCameraRef = useRef<CameraSnapshot | null>(null);
  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  // 常に最新のonReadyを指す（mountエフェクトの再実行なしにコールバックを更新するため）
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  // このグラフインスタンスでonReadyを呼んだか（一度きり保証。グラフ再生成時にリセットする）
  const onReadyFiredRef = useRef(false);
  // このグラフインスタンスで一度でもgraphData()を投入したか
  // （初回は同期warmupで即収束、2回目以降=フィルタ変更は従来の収束アニメーションに戻す）
  const hasLoadedOnceRef = useRef(false);
  // レイアウト収束後の「ゆらゆら浮遊」制御。エンジン停止時にtrueになり、
  // 次のgraphData()呼び出し直前にfalseへ戻す（再レイアウト中は力学シミュレーション側が
  // 位置を握るため、揺れオフセットで上書きしない）
  const swayingRef = useRef(false);
  // 揺れ計算対象のノード配列。graph.graphData()の毎フレーム呼び出しを避けるため、
  // データ投入時に自前で保持する（3d-force-graphは渡した配列の要素を直接書き換えるので
  // 参照を保持しておけばx/y/z・__threeObjは常に最新）
  const currentNodesRef = useRef<GraphNode[]>([]);
  // クラスタ名（タグ名）ラベルのハンドル。graph.scene()はライブラリ管理外のため
  // このモジュール自身がテクスチャ/スプライトの生成・破棄を担う（clusterLabels.ts参照）
  const clusterLabelsRef = useRef<ClusterLabelHandle | null>(null);
  // アンビエントカメラドリフトを開始済みか（このグラフインスタンスで一度きり。冪等呼び出し用）
  const ambientStartedRef = useRef(false);
  // ドリフト開始フェイルセーフのタイマーID。unmountでclearする
  const ambientFailsafeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // スペースキー接近: 前回接近時刻(performance.now())。クールダウン判定に使う
  const lastFlyTimeRef = useRef(0);
  // スペースキー接近: 直前に接近したタグ。次回選択から除外し連続で同じクラスタに飛ばないようにする
  const lastFlownTagRef = useRef<string | null>(null);

  const unsupported = useMemo(() => {
    if (typeof document === "undefined") return false;
    const canvas = document.createElement("canvas");
    return !(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  }, []);

  // 初期化（マウント時に一度だけ）
  useEffect(() => {
    if (unsupported || !containerRef.current) return;

    // 新しいグラフインスタンス: 初回データ投入の同期warmupフローとonReadyの
    // 一度きり発火、アンビエントドリフトの開始状態をリセットする
    hasLoadedOnceRef.current = false;
    onReadyFiredRef.current = false;
    ambientStartedRef.current = false;

    const graph = new ForceGraph3D(containerRef.current, { controlType: "orbit" });

    // アンビエントカメラドリフトを開始する（冪等）。GalleryClientのON遷移完了後、または
    // 下のフェイルセーフから呼ばれる。reduced-motionでは開始済みマークだけ行い
    // autoRotateは有効化しない（ドリフト無効を維持する制約）
    const beginAmbient = () => {
      if (ambientStartedRef.current) return;
      ambientStartedRef.current = true;
      if (reduceMotion) return;
      const controls = graph.controls() as unknown as OrbitControlsLike;
      controls.autoRotate = true;
      controls.autoRotateSpeed = AMBIENT_ROTATE_SPEED;
    };

    graph
      .backgroundColor("#eeece7")
      .showNavInfo(false)
      .nodeLabel(() => "") // デフォルトHTMLツールチップ抑止（カードスプライトが常時表示するため）
      .linkColor(() => "#111111")
      .linkOpacity(0.12)
      // 初回のみ: warmupを同期実行させ、最初の描画フレームからレイアウトを確定させる
      // （idsKeyエフェクトが2回目以降はRELOAD_*値に上書きする）
      .warmupTicks(reduceMotion ? INITIAL_WARMUP_TICKS_REDUCED : INITIAL_WARMUP_TICKS)
      // ノードドラッグは無効化（タグ類似度レイアウトを手動で崩させない）。
      // 副次効果として、three.js DragControlsがドラッグ閾値未満の素早いクリックで
      // dragstartを経ずにdragendだけ発火し、未設定の内部位置参照を読んでクラッシュする
      // 既知の挙動（3d-force-graph 1.80.0）も回避できる
      .enableNodeDrag(false)
      // 呼び出しごとに必ず新規のGroupを生成する（graphSprites.ts参照）。
      // 3d-force-graphはノードがデータから消えるたびにこの戻り値を自動disposeするため、
      // 同一インスタンスをキャッシュして使い回すと再出現時に二重disposeでクラッシュする
      .nodeThreeObject((n) => createNodeObject((n as unknown as GraphNode).c))
      .onNodeClick((n) => {
        const node = n as unknown as GraphNode;
        setSelected(node.c); // パネルは即時表示（カメラ移動と同時に出す）
        // ホバー状態の後始末: クリック直後にカメラが急旋回してカーソルがノードから
        // 離れるため、pointerleaveがraycast経由で発火せず拡大+最前面(depthTest=false)の
        // まま残ってしまう。クリック時点で明示的に解除する
        const group = (node as NodeWithSprite).__threeObj;
        if (group) setNodeHover(group, false);
        if (containerRef.current) containerRef.current.style.cursor = "";
        if (!reduceMotion) {
          // クリック前のカメラ位置とOrbitControlsの真の回転中心を保存
          // （未保存時のみ。パネルを開いたまま別ノードをクリックした場合、
          // 復帰先は最初のクリック前の位置を維持する）
          if (!preClickCameraRef.current) {
            const { x: cx, y: cy, z: cz } = graph.cameraPosition();
            const controls = graph.controls() as unknown as { target: THREE.Vector3 };
            preClickCameraRef.current = { x: cx, y: cy, z: cz, target: controls.target.clone() };
          }
          const { x = 0, y = 0, z = 0 } = node;
          const dist = Math.hypot(x, y, z) || 1; // 原点付近ノードのゼロ除算ガード
          const ratio = 1 + CAMERA_FOCUS_DISTANCE / dist;
          graph.cameraPosition(
            { x: x * ratio, y: y * ratio, z: z * ratio },
            { x, y, z }, // クリック時点の座標を渡す（揺れで動く現在値ではなくスナップショット）
            CAMERA_FOCUS_TRANSITION_MS,
          );
        }
      })
      .onNodeHover((n, prev) => {
        if (containerRef.current) containerRef.current.style.cursor = n ? "pointer" : "";
        const prevGroup = (prev as NodeWithSprite | null)?.__threeObj;
        if (prevGroup) setNodeHover(prevGroup, false);
        const group = (n as NodeWithSprite | null)?.__threeObj;
        if (group) setNodeHover(group, true);
      })
      // 初回はcooldownTicks(0): 同期warmupだけでレイアウトを確定させ、以降のアニメ収束は行わない
      // （idsKeyエフェクトが2回目以降はRELOAD_COOLDOWN_TICKSに上書きする）
      .cooldownTicks(0)
      // エンジン停止＝レイアウト確定のタイミングで揺れを開始する
      .onEngineStop(() => {
        swayingRef.current = !reduceMotion;
        clusterLabelsRef.current?.update(currentNodesRef.current);
        if (!onReadyFiredRef.current) {
          onReadyFiredRef.current = true;
          // フェイルセーフ: GalleryClient側からbeginAmbientが呼ばれなかった場合に備え、
          // 初回onEngineStopからAMBIENT_FAILSAFE_MS後に自動開始する（beginAmbientは冪等）
          ambientFailsafeTimerRef.current = setTimeout(beginAmbient, AMBIENT_FAILSAFE_MS);
          onReadyRef.current?.({
            screenCoords: (id) => computeScreenCoords(graph, containerRef.current, currentNodesRef.current, id),
            beginAmbient,
          });
        }
      });
    graph.d3Force("charge")?.strength(-120);
    graphRef.current = graph;
    clusterLabelsRef.current = createClusterLabels(graph.scene());

    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current) return;
      graph.width(containerRef.current.clientWidth).height(containerRef.current.clientHeight);
    });
    resizeObserver.observe(containerRef.current);

    // ゆらゆら浮遊ループ。常時1本のrAFを回し、swayingRef中のみ各ノードの
    // Group位置をレイアウト確定位置+決定論的オフセットへ書き換える。
    // エンジン停止後はライブラリ側がposition更新を止めるため競合しない
    // （three-forcegraph: engineRunning=false の間 tickFrame は位置同期をスキップする）。
    // ラベルのカメラ追従（updateLabelFacing）はswayingフラグと無関係に毎フレーム行う。
    // world固定オフセットだと視点によってラベルが画像の裏に回りこんでしまうため、
    // カメラのright vectorを毎フレーム求めてラベルのローカル位置に反映する
    // （right vectorはフレームにつき1回だけ計算し、全ノードで使い回す）
    let swayFrameId: number;
    const swayTick = () => {
      const right = new THREE.Vector3().setFromMatrixColumn(graph.camera().matrixWorld, 0);
      const swaying = swayingRef.current;
      const t = swaying ? performance.now() / 1000 : 0;
      for (const node of currentNodesRef.current) {
        const group = (node as NodeWithSprite).__threeObj;
        if (!group) continue;
        if (swaying) {
          const { dx, dy, dz } = swayOffset(node.id, t);
          group.position.set((node.x ?? 0) + dx, (node.y ?? 0) + dy, (node.z ?? 0) + dz);
        }
        updateLabelFacing(group, right);
      }
      swayFrameId = requestAnimationFrame(swayTick);
    };
    swayFrameId = requestAnimationFrame(swayTick);

    // スペースキー: ランダムなタグクラスタへカメラ接近する。検索欄でのスペース入力を妨げず、
    // 連打によるtween競合を避けるクールダウンを設け、直前と同じクラスタは連続選択しない
    const handleSpaceKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const active = document.activeElement as HTMLElement | null;
      const tagName = active?.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || active?.isContentEditable) return;
      const now = performance.now();
      if (now - lastFlyTimeRef.current < SPACE_FLY_COOLDOWN_MS) return;
      e.preventDefault(); // ページスクロール・フォーカス中ボタンの再押下を防ぐ
      const clusters = clusterLabelsRef.current?.getClusters() ?? [];
      if (clusters.length === 0) return;
      lastFlyTimeRef.current = now;
      // 直前に接近したタグを除外してランダム選択（1件しかなければそれを使う）
      const candidates = clusters.length > 1 ? clusters.filter((c) => c.tag !== lastFlownTagRef.current) : clusters;
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      lastFlownTagRef.current = target.tag;

      const controls = graph.controls() as unknown as OrbitControlsLike;
      const { x: camX, y: camY, z: camZ } = graph.cameraPosition();
      const dir = new THREE.Vector3(camX - controls.target.x, camY - controls.target.y, camZ - controls.target.z);
      if (dir.lengthSq() === 0) dir.set(0, 0, 1); // 現在位置がtargetと一致する退避フォールバック
      dir.normalize();
      const dist = Math.min(
        Math.max(target.worldWidth * SPACE_FLY_DISTANCE_FACTOR, SPACE_FLY_DISTANCE_MIN),
        SPACE_FLY_DISTANCE_MAX,
      );
      const newPos = {
        x: target.center.x + dir.x * dist,
        y: target.center.y + dir.y * dist,
        z: target.center.z + dir.z * dist,
      };
      // controls.targetもクラスタ重心へ移るため、以後のアンビエントドリフトはそのクラスタの
      // 周りを周回するようになる（仕様として意図した挙動）
      graph.cameraPosition(newPos, target.center, reduceMotion ? 0 : SPACE_FLY_TRANSITION_MS);
    };
    window.addEventListener("keydown", handleSpaceKey);

    return () => {
      cancelAnimationFrame(swayFrameId);
      resizeObserver.disconnect();
      window.removeEventListener("keydown", handleSpaceKey);
      if (ambientFailsafeTimerRef.current) clearTimeout(ambientFailsafeTimerRef.current);
      graph._destructor(); // 内部でノードごとのGroup配下Sprite/Material/Textureも解放される
      clusterLabelsRef.current?.dispose();
      clusterLabelsRef.current = null;
      graphRef.current = null;
    };
    // reduceMotionはuseMemo([])で初回描画時に一度だけ確定する値（不変）
  }, [unsupported, reduceMotion]);

  // データ投入・再レイアウト（フィルタ変更で再構築。ソート順の変化だけでは再構築しない）
  //
  // 注意: graphData() 自体が内部の（debounceされた）digestサイクルで
  // d3ForceLayout.alpha(1) による再加熱とstate.layout再構築を行う。
  // ここで d3ReheatSimulation() を追加で呼ぶと、そのdigestが完了して
  // state.layoutが再構築されるより前に resetCountdown() が engineRunning=true
  // にしてしまい、次のtickFrameで state.layout.tick() が undefined 参照で
  // クラッシュする（3d-force-graph 1.80.0 / three-forcegraph の実装依存の競合）。
  // graphData() 呼び出しだけで再加熱は完結するため、明示呼び出しはしない。
  const idsKey = useMemo(() => cases.map((c) => c.id).sort().join("|"), [cases]);
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    swayingRef.current = false; // 再レイアウト中は力学シミュレーション側に位置を委ねる
    // 再収束が終わるまで前回位置のクラスタ名ラベルを隠す（onEngineStopのupdate()で再表示される）
    clusterLabelsRef.current?.update([]);
    if (hasLoadedOnceRef.current) {
      // 2回目以降（フィルタ変更）: 初回の同期warmup設定を、従来の収束アニメーションに戻す
      graph
        .warmupTicks(reduceMotion ? RELOAD_WARMUP_TICKS_REDUCED : RELOAD_WARMUP_TICKS)
        .cooldownTicks(reduceMotion ? 0 : RELOAD_COOLDOWN_TICKS);
    }
    const data = buildGraphData(cases);
    currentNodesRef.current = data.nodes;
    graph.graphData(data);
    const link = graph.d3Force("link");
    link?.distance(linkDistance).strength(linkStrength);
    hasLoadedOnceRef.current = true;
    // idsKeyだけに反応させる意図的な依存配列（casesは絞込のたびに新規配列になるため）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // パネルclose: クリック前に保存したカメラ位置/注視点があれば復帰する。
  // これが無いと、graph.cameraPosition()のsetLookAt()がOrbitControlsの
  // controls.targetを恒久変更するため、閉じた後もクリックしたノードの方向に
  // 回転中心が固定されたままになる（既知バグ・plan Context参照）
  const handlePanelClose = () => {
    const graph = graphRef.current;
    const saved = preClickCameraRef.current;
    if (graph && saved) {
      const { target, ...pos } = saved;
      // lookAtに真のcontrols.targetを渡す＝setLookAt経由で回転中心も厳密に復帰する
      graph.cameraPosition(pos, target, reduceMotion ? 0 : CAMERA_RESTORE_TRANSITION_MS);
    }
    preClickCameraRef.current = null;
    setSelected(null);
  };

  if (unsupported) {
    return (
      <div className="text-center py-32 text-[10px] tracking-[0.3em] uppercase text-gray-400 px-8">
        お使いの環境ではWebGLが利用できないため3D表示を利用できません。右上のトグルでグリッド表示に戻してください。
      </div>
    );
  }

  return (
    // relative必須: CasePanelのモバイル全面表示（absolute inset-0）のアンカー。
    // これが無いとcontaining blockがページ原点になり、パネルがヘッダーを覆いつつ
    // グラフ領域と縦ズレし、ページスクロールにも追従しない
    <div className="relative flex h-[calc(100vh-180px)] min-h-[480px]">
      <div ref={containerRef} className="relative flex-1 min-w-0 h-full">
        {cases.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] tracking-[0.3em] uppercase text-gray-400 pointer-events-none">
            No results found
          </div>
        )}
      </div>
      {selected && <CasePanel c={selected} onClose={handlePanelClose} />}
    </div>
  );
}
