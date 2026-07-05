"use client";

// TOPページ3Dノードグラフ本体。3d-force-graph(ESM, window依存)を使うため、
// 呼び出し元(GalleryClient)で必ず next/dynamic + ssr:false 経由でロードすること。
import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraph3DInstance } from "3d-force-graph";
import type * as THREE from "three";
import type { Case } from "@/lib/cases";
import { buildGraphData, linkDistance, linkStrength, type GraphNode } from "@/lib/graph";
import { createCardSprite, setSpriteHover } from "@/lib/graphSprites";
import CaseModal from "./CaseModal";

// 3d-force-graph(three-forcegraph)がnodeThreeObjectの戻り値に自動で束縛するプロパティ
type NodeWithSprite = GraphNode & { __threeObj?: THREE.Sprite };

type Props = { cases: Case[] };

export default function Graph3DView({ cases }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph3DInstance | null>(null);
  const [selected, setSelected] = useState<Case | null>(null);

  const unsupported = useMemo(() => {
    if (typeof document === "undefined") return false;
    const canvas = document.createElement("canvas");
    return !(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  }, []);

  // 初期化（マウント時に一度だけ）
  useEffect(() => {
    if (unsupported || !containerRef.current) return;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const graph = new ForceGraph3D(containerRef.current, { controlType: "orbit" });
    graph
      .backgroundColor("#eeece7")
      .showNavInfo(false)
      .nodeLabel(() => "") // デフォルトHTMLツールチップ抑止（カードスプライトが常時表示するため）
      .linkColor(() => "#111111")
      .linkOpacity(0.12)
      .warmupTicks(reduceMotion ? 200 : 40)
      // ノードドラッグは無効化（タグ類似度レイアウトを手動で崩させない）。
      // 副次効果として、three.js DragControlsがドラッグ閾値未満の素早いクリックで
      // dragstartを経ずにdragendだけ発火し、未設定の内部位置参照を読んでクラッシュする
      // 既知の挙動（3d-force-graph 1.80.0）も回避できる
      .enableNodeDrag(false)
      // 呼び出しごとに必ず新規のSpriteを生成する（graphSprites.ts参照）。
      // 3d-force-graphはノードがデータから消えるたびにこの戻り値を自動disposeするため、
      // 同一インスタンスをキャッシュして使い回すと再出現時に二重disposeでクラッシュする
      .nodeThreeObject((n) => createCardSprite((n as unknown as GraphNode).c))
      .onNodeClick((n) => {
        setSelected((n as unknown as GraphNode).c);
      })
      .onNodeHover((n, prev) => {
        if (containerRef.current) containerRef.current.style.cursor = n ? "pointer" : "";
        const prevSprite = (prev as NodeWithSprite | null)?.__threeObj;
        if (prevSprite) setSpriteHover(prevSprite, false);
        const sprite = (n as NodeWithSprite | null)?.__threeObj;
        if (sprite) setSpriteHover(sprite, true);
      });
    if (reduceMotion) graph.cooldownTicks(0);
    graph.d3Force("charge")?.strength(-120);
    graphRef.current = graph;

    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current) return;
      graph.width(containerRef.current.clientWidth).height(containerRef.current.clientHeight);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      graph._destructor(); // 内部でノードごとのSprite/Material/Textureも解放される
      graphRef.current = null;
    };
  }, [unsupported]);

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
    graph.graphData(buildGraphData(cases));
    const link = graph.d3Force("link");
    link?.distance(linkDistance).strength(linkStrength);
    // idsKeyだけに反応させる意図的な依存配列（casesは絞込のたびに新規配列になるため）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  if (unsupported) {
    return (
      <div className="text-center py-32 text-[10px] tracking-[0.3em] uppercase text-gray-400 px-8">
        お使いの環境ではWebGLが利用できないため3D表示を利用できません。右上のトグルでグリッド表示に戻してください。
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-[calc(100vh-180px)] min-h-[480px]">
      {cases.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] tracking-[0.3em] uppercase text-gray-400 pointer-events-none">
          No results found
        </div>
      )}
      <CaseModal c={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
