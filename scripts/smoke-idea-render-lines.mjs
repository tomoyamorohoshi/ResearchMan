// /ideas ポスターのブラウザ描画検証（goofy-hatching-mango.md 実装バッチ・行重なり/グリフ欠け
// 調査バッチ）。DOM文字列一致(smoke-idea-shapes.mjs)では検出できない「実際に描画された行が
// 視覚的に重なる/欠けるか」を、Playwrightで実ブラウザに描画させ Range#getClientRects() /
// getBoundingClientRect() で全50カード×3ティア分アサートする。
//
// 重要な前提（実測で確認済み）: 各カードのラッパーdivには
// CSS `transform: rotate(var(--rotate))`（-3〜3deg、hashジッタ）が付与されている
// (IdeasPoster.tsx)。getBoundingClientRect()/getClientRects() はrotate適用後の
// 軸並行バウンディングボックス(AABB)を返すため、幅に対して高さが薄い要素（段落の1行など）
// はわずかな回転でもAABB高さが sin(θ)×width 分だけ水増しされ、実際には重なっていない
// 隣接行同士が「重なっているように」誤測定される（ideaShapes.ts 1494-1526行目のコメントで
// カード全体のbbox測定について既に文書化されている既知の罠と同種）。この誤測定を避けるため、
// 測定直前に対象カードラッパーの--rotateを0degへ上書きし、reflowを強制してから計測する。
//
// 実行: npx tsx scripts/smoke-idea-render-lines.mjs
// 環境変数 IDEAS_SMOKE_URL でURLを上書き可能（既定: http://localhost:3111/ideas）。
import { chromium } from "playwright";
import { FIXED_BODY_FONT_PX } from "../src/lib/ideaCollageLayout.ts";
import { FO_BLEED_PHYSICAL_PX } from "../src/lib/ideaShapes.ts";
import ideasData from "../data/ideas.json" with { type: "json" };

const URL = process.env.IDEAS_SMOKE_URL || "http://localhost:3111/ideas";
const NAV_TIMEOUT_MS = 420000; // /ideasの初回SSRは実測2.2〜2.3分かかる(全50件×3ティア×最大9種のsolveFixedSizeShape計算)
// 隣接行の重なり許容誤差(px)。ブラウザのサブピクセル丸め・アンチエイリアシング分の余裕
const LINE_OVERLAP_EPS = 0.05;
// foreignObject境界からのはみ出し許容誤差(px)。同上
const BOUND_EPS = 0.3;
// 固定サイズ全数一致チェックの許容誤差(px)。要求仕様どおり±0.1px
const FONT_SIZE_EPS = 0.1;
// グリフ欠け対策(左端インククリアランス)検査: emボックス左端がforeignObject左端から
// FO_BLEED_PHYSICAL_PXの何割以上離れていればインクの逃げ場として十分とみなすか。
// 実測の丸め誤差込みで90%を採用（要求仕様どおり）
const BLEED_CLEARANCE_MIN_RATIO = 0.9;
const BLEED_CLEARANCE_MIN_PX = FO_BLEED_PHYSICAL_PX * BLEED_CLEARANCE_MIN_RATIO;
// 上記クリアランス判定自体の許容誤差(px)。サブピクセル丸め分の余裕（他の*_EPSと同オーダー）
const BLEED_CLEARANCE_EPS = 0.05;

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const ideaByTitle = new Map(ideasData.map((idea) => [idea.title, idea]));

// 3ティアのTailwindブレークポイント(sm=640px, lg=1024px)に対応する代表ビューポート幅。
// mobile/compact/wideそれぞれの範囲内に収まり、かつcompact=640・wide=1024は境界値
// チェック(TIER_BOUNDARY_WIDTHS)と共用することでページ再読み込み回数を減らす
const TIER_VIEWPORTS = { mobile: 390, compact: 640, wide: 1024 };
// ティア境界の二重表示チェック用ビューポート幅(639/640/1023/1024)。640/1024は
// TIER_VIEWPORTSと共有するため追加のページ再読み込みは639・1023の2回のみで済む
const TIER_BOUNDARY_WIDTHS = [639, 640, 1023, 1024];

// 実装詳細補足: IdeasPoster.tsxはServer Component。3ティア分のDOMは常に全部SSRされ、
// クライアント側はTailwindのレスポンシブdisplayクラス(CSSメディアクエリ)で表示切替する
// だけなので、ページの再読み込みなしにviewportをリサイズするだけで別ティアの表示状態を
// 検査できる（サーバー側の重い計算(solveFixedSizeShapeの二分探索等)を1回のロードで
// 使い回せる。既知の環境事情: 初回ロードは実測2.2〜2.3分かかるため、ページ読み込みは
// 全体で1回に抑える）
async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: TIER_VIEWPORTS.wide, height: 1400 } });
  console.log(`ページ読み込み開始: ${URL} (SSR計算コストのため数分かかる場合があります)`);
  await page.goto(URL, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
  console.log("ページ読み込み完了");

  // ── 検証1: ティア境界での二重表示・二重マウント確認 ──────────────────────────
  for (const width of TIER_BOUNDARY_WIDTHS) {
    await page.setViewportSize({ width, height: 1400 });
    const dup = await page.evaluate(() => {
      function isVisible(el) {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      const groups = Array.from(document.querySelectorAll('svg[role="group"]'));
      const visibleByLabel = new Map();
      for (const g of groups) {
        if (!isVisible(g)) continue;
        const label = g.getAttribute("aria-label") || "";
        visibleByLabel.set(label, (visibleByLabel.get(label) || 0) + 1);
      }
      const dupLabels = [...visibleByLabel.entries()].filter(([, count]) => count !== 1);
      return { totalVisibleLabels: visibleByLabel.size, dupLabels };
    });
    assert(dup.dupLabels.length === 0, `viewport幅${width}px: 同一カードが複数可視化されていない (重複=${JSON.stringify(dup.dupLabels)})`);
    assert(dup.totalVisibleLabels === ideasData.length, `viewport幅${width}px: 全${ideasData.length}件が可視 (実測=${dup.totalVisibleLabels})`);
    console.log(`  (情報) viewport幅${width}px: 可視カード数=${dup.totalVisibleLabels}, 重複=${dup.dupLabels.length}件`);
  }

  // ── 検証2: 各ティアで全50カードの行間隔・水平/下端はみ出し・固定サイズ実測一致 ──────
  for (const [tier, width] of Object.entries(TIER_VIEWPORTS)) {
    await page.setViewportSize({ width, height: 1400 });
    const report = await page.evaluate(
      ({ LINE_OVERLAP_EPS, BOUND_EPS, BLEED_CLEARANCE_MIN_PX, BLEED_CLEARANCE_EPS }) => {
        function isVisible(el) {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }
        function rangeLineRects(el) {
          if (!el) return [];
          const range = document.createRange();
          range.selectNodeContents(el);
          return Array.from(range.getClientRects());
        }

        const groups = Array.from(document.querySelectorAll('svg[role="group"]')).filter(isVisible);
        const entries = [];
        for (const g of groups) {
          const label = g.getAttribute("aria-label") || "";
          const wrapper = g.closest("div.group.absolute");
          const prevRotate = wrapper ? wrapper.style.getPropertyValue("--rotate") : "";
          // 既知の罠(ideaShapes.ts 1494-1526行目と同種): rotateしたままgetClientRects/
          // getBoundingClientRectを取るとAABBが水増しされ偽陽性の重なりを検出してしまう。
          // 測定前に0degへ上書きしreflowを強制する
          if (wrapper) {
            wrapper.style.setProperty("--rotate", "0deg");
            wrapper.style.transition = "none";
            void wrapper.offsetHeight;
          }

          const svgRect = g.getBoundingClientRect();
          const fo = g.querySelector("foreignObject");
          const foRect = fo ? fo.getBoundingClientRect() : null;
          const issues = [];

          function checkLines(el, tag) {
            const rects = rangeLineRects(el);
            for (let i = 0; i < rects.length; i++) {
              const r = rects[i];
              if (foRect) {
                if (r.left < foRect.left - BOUND_EPS) issues.push(`${tag}: line${i} 左端はみ出し(${(foRect.left - r.left).toFixed(2)}px)`);
                if (r.right > foRect.right + BOUND_EPS) issues.push(`${tag}: line${i} 右端はみ出し(${(r.right - foRect.right).toFixed(2)}px)`);
                // グリフ欠け対策検査: emボックス左端とforeignObject左端の間に、左サイド
                // ベアリングのインクはみ出しが逃げ切れるだけのクリアランス(ブリード余白の
                // 90%以上)があるか。実インクは直接測れないため、emボックス基準の間接検証とする
                const leftClearance = r.left - foRect.left;
                if (leftClearance < BLEED_CLEARANCE_MIN_PX - BLEED_CLEARANCE_EPS) {
                  issues.push(`${tag}: line${i} 左端クリアランス不足(${leftClearance.toFixed(2)}px, 目標${BLEED_CLEARANCE_MIN_PX.toFixed(2)}px以上)`);
                }
              }
              if (i > 0) {
                const gap = r.top - rects[i - 1].bottom;
                if (gap < -LINE_OVERLAP_EPS) issues.push(`${tag}: line${i - 1}-${i} 重なり(${gap.toFixed(2)}px)`);
              }
            }
            // 下端クリップ検査: 説明文<p>/参照リンクタイトルの最終行がforeignObject下端を
            // はみ出すと、親のoverflow-hidden(descWrapperStyle固定高・外側flexコンテナ)に
            // よってグリフが見えなくなる。水平はみ出し・行間重なりの検査だけでは検出できない
            // クラスの不具合のため、最終行のbottomをforRectのbottomと突き合わせる
            if (foRect && rects.length > 0) {
              const lastBottom = rects[rects.length - 1].bottom;
              if (lastBottom > foRect.bottom + BOUND_EPS) {
                issues.push(`${tag}: 最終行下端はみ出し(${(lastBottom - foRect.bottom).toFixed(2)}px)`);
              }
            }
            return rects.length;
          }

          const p = fo ? fo.querySelector("p") : null;
          const descLineCount = checkLines(p, "desc");

          const links = fo ? Array.from(fo.querySelectorAll("a")) : [];
          links.forEach((a, li) => {
            const spans = a.querySelectorAll("span");
            const labelSpan = spans[0];
            const titleSpan = spans[1];
            if (labelSpan && foRect) {
              const lr = labelSpan.getBoundingClientRect();
              if (lr.left < foRect.left - BOUND_EPS) issues.push(`link${li}ラベル: 左端はみ出し(${(foRect.left - lr.left).toFixed(2)}px)`);
              if (lr.right > foRect.right + BOUND_EPS) issues.push(`link${li}ラベル: 右端はみ出し(${(lr.right - foRect.right).toFixed(2)}px)`);
              const labelLeftClearance = lr.left - foRect.left;
              if (labelLeftClearance < BLEED_CLEARANCE_MIN_PX - BLEED_CLEARANCE_EPS) {
                issues.push(
                  `link${li}ラベル: 左端クリアランス不足(${labelLeftClearance.toFixed(2)}px, 目標${BLEED_CLEARANCE_MIN_PX.toFixed(2)}px以上)`,
                );
              }
            }
            checkLines(titleSpan, `link${li}タイトル`);
          });

          // フォント実測: <p>のcomputed font-size(=viewbox局所単位)×実際のDOM描画スケール
          // (svg要素の実描画幅/viewBox幅)で物理px値を逆算し、要求仕様のFIXED_BODY_FONT_PXと
          // 突き合わせる(analytic側=smoke-idea-shapes.mjsの数式一致チェックとは独立した、
          // 実ブラウザ描画の別ルートからのクロスチェック)
          const viewBoxAttr = (g.getAttribute("viewBox") || "0 0 1 1").split(/\s+/).map(Number);
          const viewBoxW = viewBoxAttr[2];
          const domScale = svgRect.width / viewBoxW;
          const pFontSizePx = p ? parseFloat(getComputedStyle(p).fontSize) : null;
          const physBodyPx = pFontSizePx !== null ? pFontSizePx * domScale : null;

          if (wrapper) wrapper.style.setProperty("--rotate", prevRotate);

          entries.push({
            label,
            issues,
            descLineCount,
            linkCount: links.length,
            svgWidthPx: svgRect.width,
            svgHeightPx: svgRect.height,
            viewBoxW,
            physBodyPx,
          });
        }
        return entries;
      },
      { LINE_OVERLAP_EPS, BOUND_EPS, BLEED_CLEARANCE_MIN_PX, BLEED_CLEARANCE_EPS },
    );

    assert(report.length === ideasData.length, `[${tier}] 可視カード数が全${ideasData.length}件と一致 (実測=${report.length})`);

    let issueCount = 0;
    let fontMismatch = 0;
    for (const entry of report) {
      if (entry.issues.length > 0) {
        issueCount += entry.issues.length;
        console.error(`FAIL: [${tier}] ${entry.label}: ${entry.issues.join(" / ")}`);
      }
      const idea = ideaByTitle.get(entry.label.replace(/（[^（]*）$/, ""));
      const bodyTarget = FIXED_BODY_FONT_PX[tier];
      if (entry.physBodyPx !== null && Math.abs(entry.physBodyPx - bodyTarget) > FONT_SIZE_EPS) {
        fontMismatch++;
        console.error(
          `FAIL: [${tier}] ${entry.label}: 本文フォント実測(DOM経由)がサイズBと不一致 (実測=${entry.physBodyPx.toFixed(3)}, 目標=${bodyTarget})${idea ? "" : "（idea未特定）"}`,
        );
      }
    }
    assert(issueCount === 0, `[${tier}] 行の重なり・水平/下端はみ出しが0件 (実測=${issueCount}件)`);
    assert(fontMismatch === 0, `[${tier}] DOM実測の本文フォントサイズが全カードでサイズBと一致 (不一致=${fontMismatch}件)`);
    console.log(
      `  (情報) [${tier}] 検査対象=${report.length}件, 行重なり/はみ出し=${issueCount}件, フォント不一致=${fontMismatch}件`,
    );
  }

  await page.close();
  await browser.close();
}

await main();

console.log(`smoke-idea-render-lines: 検証完了`);
if (failures > 0) {
  console.error(`\n${failures}件の検証失敗`);
  process.exit(1);
} else {
  console.log("全検証PASS");
}
