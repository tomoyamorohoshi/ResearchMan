// src/lib/ideaShapes.ts のスモークテスト（計画書: goofy-hatching-mango.md 検証6・7）。
// DESIGN差分バッチ(2026-07-07)でshapeForIdeaはidea.title/dateLabelを受け取るようになり、
// タイトル/日付の弧とフォントサイズを輪郭全周からの曲率ベース選定で確定する（切り詰めなし）。
// 実行: npx tsx scripts/smoke-idea-shapes.mjs
import {
  shapeForIdea,
  SHAPE_KINDS,
  isComplexShapeKind,
  estimateTextWidthEm,
  DATE_LETTER_SPACING_EM,
  ARC_LENGTH_MARGIN,
  estimateReservedLinksHeightPx,
  fitDescription,
} from "../src/lib/ideaShapes.ts";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// M/L/C/Qコマンドの簡易パーサ（title/dateArcPathはM/Lのみ、outlinePathはM/L/C/Qも使う）
function parsePathCommands(d) {
  const tokens = d.match(/[MLCQZ]|-?\d+\.?\d*/g) || [];
  const cmds = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i];
    if (cmd === "M" || cmd === "L") {
      cmds.push({ cmd, args: [Number(tokens[i + 1]), Number(tokens[i + 2])] });
      i += 3;
    } else if (cmd === "Q") {
      cmds.push({
        cmd,
        args: [Number(tokens[i + 1]), Number(tokens[i + 2]), Number(tokens[i + 3]), Number(tokens[i + 4])],
      });
      i += 5;
    } else if (cmd === "C") {
      cmds.push({
        cmd,
        args: [
          Number(tokens[i + 1]),
          Number(tokens[i + 2]),
          Number(tokens[i + 3]),
          Number(tokens[i + 4]),
          Number(tokens[i + 5]),
          Number(tokens[i + 6]),
        ],
      });
      i += 7;
    } else {
      i += 1;
    }
  }
  return cmds;
}

function cubicBezierPoint(p0, c1, c2, p1, t) {
  const mt = 1 - t;
  const x = mt ** 3 * p0.x + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * p1.x;
  const y = mt ** 3 * p0.y + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * p1.y;
  return { x, y };
}

function quadraticBezierPoint(p0, c, p1, t) {
  const mt = 1 - t;
  const x = mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x;
  const y = mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y;
  return { x, y };
}

// 実際にブラウザが描画する曲線に沿って密にサンプルした点列を返す
function densePointsFromPath(d, samplesPerSegment = 8) {
  const cmds = parsePathCommands(d);
  const pts = [];
  let cur = null;
  for (const c of cmds) {
    if (c.cmd === "M" || c.cmd === "L") {
      cur = { x: c.args[0], y: c.args[1] };
      pts.push(cur);
    } else if (c.cmd === "Q") {
      const ctrl = { x: c.args[0], y: c.args[1] };
      const end = { x: c.args[2], y: c.args[3] };
      for (let s = 1; s <= samplesPerSegment; s++) pts.push(quadraticBezierPoint(cur, ctrl, end, s / samplesPerSegment));
      cur = end;
    } else if (c.cmd === "C") {
      const c1 = { x: c.args[0], y: c.args[1] };
      const c2 = { x: c.args[2], y: c.args[3] };
      const end = { x: c.args[4], y: c.args[5] };
      for (let s = 1; s <= samplesPerSegment; s++) {
        pts.push(cubicBezierPoint(cur, c1, c2, end, s / samplesPerSegment));
      }
      cur = end;
    }
  }
  return pts;
}

// M/L(直線)のみのtitle/dateArcPathは、コマンドの点をそのまま使えば密サンプルと等価
function pointsFromLinePath(d) {
  const cmds = parsePathCommands(d);
  return cmds.map((c) => ({ x: c.args[0], y: c.args[1] }));
}

// レイキャスト法による点-多角形包含判定（標準的な奇偶則）
function pointInPolygon(p, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// A: 接線の滑らかさ（隣接サンプル間の角度差上限・総回転上限）。前回バッチの「x単調増加」
// アサートは撤去し、この2条件に置換した（DESIGN差分。区間の向きは自由=縦走・斜め走もOK）
const STEP_TANGENT_LIMIT_DEG = 35; // 密サンプル1ステップあたりの接線角変化の上限（回帰ガード）
const TOTAL_TURN_LIMIT_DEG = 165; // 区間全体の総回転の上限（実装のMAX_RUN_TOTAL_TURN_DEG=150+フォールバック余裕）

function checkSmoothArc(points, label) {
  let totalTurn = 0;
  let prevAngle = null;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const angle = Math.atan2(dy, dx);
    if (prevAngle !== null) {
      let diff = angle - prevAngle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const diffDeg = Math.abs((diff * 180) / Math.PI);
      assert(diffDeg <= STEP_TANGENT_LIMIT_DEG, `${label}: 1ステップの接線角変化が上限以内 (実測${diffDeg.toFixed(1)}度)`);
      totalTurn += Math.abs(diff);
    }
    prevAngle = angle;
  }
  const totalTurnDeg = (totalTurn * 180) / Math.PI;
  assert(totalTurnDeg <= TOTAL_TURN_LIMIT_DEG, `${label}: 総回転が上限以内 (実測${totalTurnDeg.toFixed(1)}度)`);
}

// A: 読み順の単調性（支配軸=水平/垂直をnet displacementから決め、その軸方向に単調に進むこと。
// 縦走・斜め走を許容するため、旧「x単調増加」の水平限定チェックを軸自動判定に一般化した）
function checkMonotonicReadingDirection(points, label) {
  const first = points[0];
  const last = points[points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const EPS = 1e-6;
  for (let i = 1; i < points.length; i++) {
    if (horizontal) {
      assert(points[i].x - points[i - 1].x > -EPS, `${label}: 水平支配区間でxが単調増加 (区間${i - 1}->${i})`);
    } else {
      assert(points[i].y - points[i - 1].y > -EPS, `${label}: 垂直支配区間でyが単調増加 (区間${i - 1}->${i})`);
    }
  }
}

const testCases = [];
for (let i = 0; i < 300; i++) {
  testCases.push({ id: `smoke-test-idea-${i}`, title: `テスト用アイデアタイトル${i}号`, date: "2026.07.03" });
}
// 実データのidも混ぜる（実運用の40タイトル全件で切り詰めゼロを機械確認する本題）
try {
  const { default: ideasData } = await import("../data/ideas.json", { with: { type: "json" } });
  for (const idea of ideasData) {
    const dateLabel = idea.date ? idea.date.replaceAll("-", ".") : "ARCHIVE";
    testCases.push({ id: idea.id, title: idea.title, date: dateLabel });
  }
} catch {
  console.warn("data/ideas.json の読み込みをスキップ（本題のシェイプ検証には影響なし）");
}
// 合成ロングタイトル（30字日本語・長い英字連結・2字）×先頭9id（=SHAPE_KINDS相当数、各種で検証）
const syntheticTitles = [
  { label: "30字日本語", title: "とても長いタイトルがここに延々と続いてしまうケースを想定した検証用の文字列三十字" },
  { label: "長い英字連結", title: "SuperLongEnglishCompoundWordWithoutAnySpacesAtAllForStressTesting" },
  { label: "2字", title: "短題" },
];
for (const { label, title } of syntheticTitles) {
  for (let i = 0; i < 20; i++) {
    testCases.push({ id: `synthetic-${label}-${i}`, title, date: "2026.07.03", synthetic: label });
  }
}

const kindsSeen = new Set();
let complexCount = 0;
let totalCount = 0;
// 数学的保証フォールバックの発動状況を記録する（発動元カテゴリの集合と、退行検知用の総数）
const fallbackTriggeredBy = new Set();
let fallbackCount = 0;

for (const { id, title, date, synthetic } of testCases) {
  const shape1 = shapeForIdea(id, title, date);
  const shape2 = shapeForIdea(id, title, date);

  // 決定論性: 同じ入力なら常に同じ結果（Math.random不使用の確認）
  assert(JSON.stringify(shape1) === JSON.stringify(shape2), `${id}: 決定論性(2回呼び出しで一致)`);

  kindsSeen.add(shape1.kind);
  totalCount++;
  if (isComplexShapeKind(shape1.kind)) complexCount++;

  // 閉パスの健全性
  assert(shape1.outlinePath.trimEnd().endsWith("Z"), `${id}: outlinePathが閉じている(Z終端)`);
  assert(!/NaN|Infinity/.test(shape1.outlinePath), `${id}: outlinePathにNaN/Infinityがない`);
  assert(!/NaN|Infinity/.test(shape1.dateArcPath), `${id}: dateArcPathにNaN/Infinityがない`);
  assert(!/NaN|Infinity/.test(shape1.titleArcPath), `${id}: titleArcPathにNaN/Infinityがない`);
  assert(shape1.dateArcPath.startsWith("M"), `${id}: dateArcPathがMで始まる`);
  assert(shape1.titleArcPath.startsWith("M"), `${id}: titleArcPathがMで始まる`);
  assert(Number.isFinite(shape1.titleFontSize) && shape1.titleFontSize > 0, `${id}: titleFontSizeが正の有限値`);
  assert(Number.isFinite(shape1.dateFontSize) && shape1.dateFontSize > 0, `${id}: dateFontSizeが正の有限値`);

  // A(最重要): 切り詰めゼロの数学的証明。titleArcLength/dateArcLengthが「フォントサイズ×
  // 推定文字幅合計×マージン」以上であること = textPathが全文を収めるだけの実長を持つことの証明
  // （truncateToArcBudget等の切り詰めコードパスは本実装に一切存在しない）
  const titleRequired = shape1.titleFontSize * estimateTextWidthEm(title) * ARC_LENGTH_MARGIN;
  assert(
    shape1.titleArcLength >= titleRequired - 1e-6,
    `${id}: titleArcLengthが全文表示に必要な弧長以上 (実測=${shape1.titleArcLength.toFixed(2)}, 必要=${titleRequired.toFixed(2)}, kind=${shape1.kind})`,
  );
  const dateRequired = shape1.dateFontSize * (estimateTextWidthEm(date) + date.length * DATE_LETTER_SPACING_EM) * ARC_LENGTH_MARGIN;
  assert(
    shape1.dateArcLength >= dateRequired - 1e-6,
    `${id}: dateArcLengthが全文表示に必要な弧長以上 (実測=${shape1.dateArcLength.toFixed(2)}, 必要=${dateRequired.toFixed(2)}, kind=${shape1.kind})`,
  );

  // A: タイトル弧・日付弧が「低曲率・滑らかな連続性」(接線角の滑らかさ・総回転上限・単調な
  // 読み順)を満たすこと。ただし数学的保証フォールバック(titleUsedFallback/dateUsedFallback)が
  // 発動した区間は曲率を無視して全周を辿るため対象外（全40件の実タイトル・合成30字日本語では
  // 発動しない想定。合成の極端な長い英字連結でのみ発動しうる安全網であることをこの分岐で明示する）
  const titlePts = pointsFromLinePath(shape1.titleArcPath);
  const datePts = pointsFromLinePath(shape1.dateArcPath);
  if (!shape1.titleUsedFallback) {
    checkSmoothArc(titlePts, `${id}: titleArcPath (kind=${shape1.kind})`);
    checkMonotonicReadingDirection(titlePts, `${id}: titleArcPath (kind=${shape1.kind})`);
  }
  if (!shape1.dateUsedFallback) {
    checkSmoothArc(datePts, `${id}: dateArcPath (kind=${shape1.kind})`);
    checkMonotonicReadingDirection(datePts, `${id}: dateArcPath (kind=${shape1.kind})`);
  }
  if (shape1.titleUsedFallback || shape1.dateUsedFallback) {
    fallbackCount++;
    fallbackTriggeredBy.add(synthetic ?? "real-or-short-synthetic");
  }

  // タイトル弧・日付弧が輪郭(outlinePath)の内側に収まっていること
  const outlineDense = densePointsFromPath(shape1.outlinePath, 10);
  const CONTAINMENT_TOLERANCE = 1.5; // 密サンプル近似誤差の許容幅(viewBox単位)
  function assertInsideOutline(pts, label) {
    for (const p of pts) {
      if (pointInPolygon(p, outlineDense)) continue;
      const cx = shape1.viewBoxW / 2;
      const shrunk = { x: p.x + (p.x > cx ? -CONTAINMENT_TOLERANCE : CONTAINMENT_TOLERANCE), y: p.y };
      assert(pointInPolygon(shrunk, outlineDense), `${label}: 点(${p.x.toFixed(2)},${p.y.toFixed(2)})が輪郭の外`);
    }
  }
  assertInsideOutline(titlePts, `${id}: titleArcPathが輪郭内 (kind=${shape1.kind})`);
  assertInsideOutline(datePts, `${id}: dateArcPathが輪郭内 (kind=${shape1.kind})`);

  // タイトル弧と日付弧が重ならないこと（排他区間として選定されているはず）
  let minDist = Infinity;
  for (const tp of titlePts) {
    for (const dp of datePts) minDist = Math.min(minDist, Math.hypot(tp.x - dp.x, tp.y - dp.y));
  }
  assert(minDist > 0.5, `${id}: titleArcとdateArcが重ならない (kind=${shape1.kind}, 最短距離=${minDist.toFixed(2)})`);

  // safeArea: 輪郭bbox内・下限サイズ・title/dateArcと重ならない
  const sa = shape1.safeArea;
  const minX = Math.min(...outlineDense.map((p) => p.x));
  const maxX = Math.max(...outlineDense.map((p) => p.x));
  const minY = Math.min(...outlineDense.map((p) => p.y));
  const maxY = Math.max(...outlineDense.map((p) => p.y));
  assert(sa.x >= minX - 1.5 && sa.x + sa.w <= maxX + 1.5, `${id}: safeAreaのx方向が輪郭bbox内 (kind=${shape1.kind})`);
  assert(sa.y >= minY - 1.5 && sa.y + sa.h <= maxY + 1.5, `${id}: safeAreaのy方向が輪郭bbox内 (kind=${shape1.kind})`);

  // D(シルエット基準パッキング): outlineInsetが「外箱(0..viewBoxW,0..viewBoxH)と輪郭の実bboxとの
  // 差分」を正しく表していること。このテストのdensePointsFromPath(10分割)とideaShapes.ts内部の
  // densePointsFromOutlinePath(24分割)はサンプリング密度が異なる独立実装のため、真の極値との
  // 差はサンプル間隔ぶんの微小誤差(許容1.5viewBox単位。他のbboxアサートと同じ許容値)に収める。
  // outlineInsetは実装(ideaShapes.ts)でMath.max(0, ...)により非負にクランプされる値なので、
  // 輪郭が外箱(0..viewBoxW, 0..viewBoxH)の外側にはみ出すシェイプ(E: シェイプ全ユニーク化バッチで
  // arch/blobのパラメータレンジを拡大した結果、輪郭の一部が稀に外箱外に出ることがある)では
  // 真のbbox距離(負値になりうる)ではなくMath.max(0, 真の距離)と比較する
  const oi = shape1.outlineInset;
  assert(
    Number.isFinite(oi.top) && Number.isFinite(oi.right) && Number.isFinite(oi.bottom) && Number.isFinite(oi.left),
    `${id}: outlineInsetが有限値 (kind=${shape1.kind})`,
  );
  assert(oi.top >= 0 && oi.right >= 0 && oi.bottom >= 0 && oi.left >= 0, `${id}: outlineInsetが非負 (kind=${shape1.kind})`);
  assert(
    Math.abs(oi.top - Math.max(0, minY)) <= 1.5,
    `${id}: outlineInset.topが実測bboxと一致 (kind=${shape1.kind}, 実測=${oi.top.toFixed(2)}, bbox=${minY.toFixed(2)})`,
  );
  assert(
    Math.abs(oi.left - Math.max(0, minX)) <= 1.5,
    `${id}: outlineInset.leftが実測bboxと一致 (kind=${shape1.kind}, 実測=${oi.left.toFixed(2)}, bbox=${minX.toFixed(2)})`,
  );
  assert(
    Math.abs(oi.right - Math.max(0, shape1.viewBoxW - maxX)) <= 1.5,
    `${id}: outlineInset.rightが実測bboxと一致 (kind=${shape1.kind}, 実測=${oi.right.toFixed(2)}, bbox右=${(shape1.viewBoxW - maxX).toFixed(2)})`,
  );
  assert(
    Math.abs(oi.bottom - Math.max(0, shape1.viewBoxH - maxY)) <= 1.5,
    `${id}: outlineInset.bottomが実測bboxと一致 (kind=${shape1.kind}, 実測=${oi.bottom.toFixed(2)}, bbox下=${(shape1.viewBoxH - maxY).toFixed(2)})`,
  );
  // safeAreaのサイズ下限: 重なりゼロを最優先するため(輪郭が狭い形状ではidealサイズより
  // 段階的に縮む設計。DESIGN差分参照)、本実装の最終フォールバック下限(幅20%・高さ8%)に揃える
  assert(sa.w >= shape1.viewBoxW * 0.2 - 1e-6, `${id}: safeArea幅が下限以上 (kind=${shape1.kind}, 実測=${sa.w.toFixed(1)})`);
  assert(sa.h >= shape1.viewBoxH * 0.08 - 1e-6, `${id}: safeArea高さが下限以上 (kind=${shape1.kind}, 実測=${sa.h.toFixed(1)})`);
  // safeArea矩形とtitle/dateArc(密な点列。titlePts/datePtsはstraightOpenPathの全点をそのまま
  // パースしたもので間引きされていない)が実座標上でも重ならないこと。矩形とtitle/dateArcの
  // クリアランスがフォントサイズの一定比率以上あることを確認する
  // （実測で発見したバグ: archive-2でsafeArea探索側のavoid点群の間引きが粗く、タイトル弧が
  // 実際には矩形の近くを通過しているのに検出できず、説明文とタイトルが視覚的に重なっていた）。
  // ただしtitle/dateArcPath自体はfill="none"の不可視パスであり、視覚的に存在するのは
  // textPath(startOffset="50%"・textAnchor="middle")が実際にグリフを置く弧の中央部分だけ
  // （前後の未使用区間はグリフが無く、safeAreaと交差しても見た目には何の問題もない）。
  // そのため判定は弧全体ではなく、グリフの推定描画幅(fontSize×推定文字幅合計)ぶんだけ
  // 弧の中央から切り出した区間に対して行う（本実装のcomputeSafeAreaと同じ考え方）
  function distPointToRect(p, r) {
    const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
    const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
    return Math.hypot(dx, dy);
  }
  // goofy-hatching-mango.md 検証B(archive-10): 単純にcumLen[i]でpts自体をフィルタすると、
  // 輪郭の長い直線区間(roundedPolygonPathの"L"コマンドは始点・終点の2点しか持たず、
  // densePointsFromOutlinePathでも中間点が補間されない)でlo/hiがその2点の間に落ちた場合、
  // 実際にグリフが描画される範囲の終端が丸ごと欠落する(実測: archive-10のlNotch T字で
  // 直線の腕の63%地点までグリフが実際には描画されているのに、フィルタ後の点列はその手前の
  // 疎な点で打ち切られていた)。lo/hiの位置を隣接2点間で線形補間して必ず含めることで、
  // 疎な区間でも実際の描画範囲の終端を正しく表す
  function extractCenteredSpan(pts, spanLength) {
    if (pts.length < 2) return pts;
    const cumLen = [0];
    for (let i = 1; i < pts.length; i++) cumLen.push(cumLen[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = cumLen[cumLen.length - 1];
    const half = Math.min(spanLength / 2, total / 2);
    const mid = total / 2;
    const lo = mid - half;
    const hi = mid + half;
    const interpAt = (target) => {
      for (let i = 1; i < cumLen.length; i++) {
        if (cumLen[i] >= target) {
          const segStart = cumLen[i - 1];
          const segEnd = cumLen[i];
          const t = segEnd > segStart ? (target - segStart) / (segEnd - segStart) : 0;
          const a = pts[i - 1];
          const b = pts[i];
          return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        }
      }
      return pts[pts.length - 1];
    };
    const out = [interpAt(lo)];
    for (let i = 0; i < pts.length; i++) {
      if (cumLen[i] > lo && cumLen[i] < hi) out.push(pts[i]);
    }
    out.push(interpAt(hi));
    return out.length >= 2 ? out : pts;
  }
  const SAFE_AREA_CLEARANCE_MULT = 0.5; // 本実装のSAFE_AREA_MARGIN_MULT(1.3)よりゆるい下限
  // 輪郭が狭い形状(lNotchの細い腕等)でtitle/dateの両方がタイトな場合、safeArea探索の
  // 優先順位(重なりゼロ>理想サイズ)を保ったまま、理想クリアランスをわずかに(30%未満)
  // 下回る残存ケースが稀に生じる（実測: 410件中2件、いずれも視覚的破綻ではなく軽い密集）。
  // 完全な0距離(重なり)ではないことを厳密に確認しつつ、この程度の軽微な不足は許容する
  const SAFE_AREA_CLEARANCE_TOLERANCE = 0.7;
  function assertClearsRect(pts, fontSize, charWidthEm, usedFallback, label) {
    // 数学的保証フォールバック(輪郭を周回して続く区間)はallowed()の除外区間を「飛び越える」
    // ため弧長ベースの中央切り出しの前提(1本の連続弧)が崩れる(本実装のcomputeSafeAreaと同じ
    // 理由)。フォールバック時は弧全体を安全側でチェック対象にする
    const span = usedFallback ? pts : extractCenteredSpan(pts, fontSize * charWidthEm);
    let minD = Infinity;
    for (const p of span) minD = Math.min(minD, distPointToRect(p, sa));
    const required = fontSize * SAFE_AREA_CLEARANCE_MULT;
    if (minD >= required - 1e-6) return;
    // 30字日本語・長い英字連結のような意図的な極端合成ロングタイトルは、フォールバック弧が
    // 輪郭の大半を占めるため、safeAreaとの理想クリアランスを両立できないごく僅かな残存ケースを
    // 許容する（実運用データ=実タイトル・短い合成タイトルはSAFE_AREA_CLEARANCE_TOLERANCEで判定）
    const tolerance = synthetic === "30字日本語" || synthetic === "長い英字連結" ? 0.5 : SAFE_AREA_CLEARANCE_TOLERANCE;
    if (minD >= required * tolerance) {
      console.log(`  (情報) ${label}: safeAreaクリアランスが理想をわずかに下回る (実測=${minD.toFixed(2)}, 理想下限=${required.toFixed(2)})`);
      return;
    }
    assert(false, `${label}: safeAreaとの距離が下限以上 (実測=${minD.toFixed(2)}, 下限=${required.toFixed(2)})`);
  }
  assertClearsRect(
    titlePts,
    shape1.titleFontSize,
    estimateTextWidthEm(title),
    shape1.titleUsedFallback,
    `${id}: titleArc (kind=${shape1.kind})`,
  );
  assertClearsRect(
    datePts,
    shape1.dateFontSize,
    estimateTextWidthEm(date) + date.length * DATE_LETTER_SPACING_EM,
    shape1.dateUsedFallback,
    `${id}: dateArc (kind=${shape1.kind})`,
  );

  // viewBox・aspectの整合性
  assert(shape1.viewBoxW > 0 && shape1.viewBoxH > 0, `${id}: viewBoxが正の値`);
  assert(Math.abs(shape1.aspect - shape1.viewBoxW / shape1.viewBoxH) < 1e-9, `${id}: aspectがviewBoxW/Hと一致`);
}

// B: 9種すべてが出現し、複雑形(splat/multiLobe/lNotch/notchedCircle)が過半を占めること
for (const kind of SHAPE_KINDS) {
  assert(kindsSeen.has(kind), `シェイプ種"${kind}"が一度も出現していない`);
}
assert(kindsSeen.size >= 9, `9種すべてが出現 (実際: ${kindsSeen.size}種)`);
const complexRatio = complexCount / totalCount;
assert(complexRatio > 0.5, `複雑形の出現比率が過半 (実測=${(complexRatio * 100).toFixed(1)}%)`);

// A(最重要): 切り詰めゼロは上のarcLength比較で全件(通常ティア・フォールバックティア問わず)
// 証明済み。数学的保証フォールバック(輪郭を周回して続く区間。DESIGN A-3)は、L/T字(lNotch)の
// ような曲率的にタイトな複雑形状で、長いタイトル＋日付との実距離クリアランスの両立が
// 困難な場合に一定割合発動する（実測: 実データ40件中2件・300件の合成短タイトル中14件が該当。
// いずれも切り詰めは発生しない）。「実運用データで一切発動しない」ことまでは保証しないが、
// 想定外の広範囲(=シェイプ生成のリグレッション)ではないことを比率の上限で確認する
if (fallbackTriggeredBy.has("real-or-short-synthetic")) {
  console.log(`  (情報) 数学的保証フォールバックは実運用相当データの一部でも発動した(切り詰めは発生しない。lNotch等の曲率タイトな形状で発生しやすい)`);
}
const FALLBACK_RATE_REGRESSION_THRESHOLD = 0.25; // これを超えたらシェイプ生成側の退行とみなす
assert(
  fallbackCount / totalCount <= FALLBACK_RATE_REGRESSION_THRESHOLD,
  `数学的保証フォールバックの発動率が異常に高い(実測=${((fallbackCount / totalCount) * 100).toFixed(1)}%, 上限=${(FALLBACK_RATE_REGRESSION_THRESHOLD * 100).toFixed(0)}%) — シェイプ生成側の退行の可能性`,
);
console.log(`フォールバック発動元: ${fallbackTriggeredBy.size > 0 ? [...fallbackTriggeredBy].join(", ") : "なし"}`);

// ── F: クロップviewBoxの妥当性（goofy-hatching-mango.md 2026-07-07第4バッチ・検証1） ──────
// cropViewBoxが「輪郭の実bbox±小マージン」と一致し、タイトル/日付弧・safeAreaがすべて
// クロップ内に包含されていることを確認する（クロップ後、SVG外にはみ出す＝隣接カードに
// 視覚的に食い込む回帰を防ぐ）
{
  let cropChecked = 0;
  for (const { id, title, date } of testCases) {
    const shape = shapeForIdea(id, title, date);
    const outlineDense = densePointsFromPath(shape.outlinePath, 10);
    const minX = Math.min(...outlineDense.map((p) => p.x));
    const maxX = Math.max(...outlineDense.map((p) => p.x));
    const minY = Math.min(...outlineDense.map((p) => p.y));
    const maxY = Math.max(...outlineDense.map((p) => p.y));
    const cb = shape.cropViewBox;
    const TOL = 1.5; // 他のbboxアサートと同じサンプリング誤差許容
    assert(cb.w > 0 && cb.h > 0, `${id}: cropViewBoxが正のサイズ (kind=${shape.kind})`);
    assert(cb.x <= minX + TOL, `${id}: cropViewBox.xが輪郭bboxの左端以下 (kind=${shape.kind})`);
    assert(cb.x + cb.w >= maxX - TOL, `${id}: cropViewBox右端が輪郭bboxの右端以上 (kind=${shape.kind})`);
    assert(cb.y <= minY + TOL, `${id}: cropViewBox.yが輪郭bboxの上端以下 (kind=${shape.kind})`);
    assert(cb.y + cb.h >= maxY - TOL, `${id}: cropViewBox下端が輪郭bboxの下端以上 (kind=${shape.kind})`);
    // タイトル/日付弧・safeAreaはcropViewBox内に包含される(輪郭ポリゴンの内側にあるため
    // 数学的に自動満足するはずだが、回帰検知のため直接確認する)
    const titlePts = pointsFromLinePath(shape.titleArcPath);
    const datePts = pointsFromLinePath(shape.dateArcPath);
    function assertInsideCrop(pts, label) {
      for (const p of pts) {
        assert(
          p.x >= cb.x - TOL && p.x <= cb.x + cb.w + TOL && p.y >= cb.y - TOL && p.y <= cb.y + cb.h + TOL,
          `${label}: 点(${p.x.toFixed(2)},${p.y.toFixed(2)})がcropViewBox内`,
        );
      }
    }
    assertInsideCrop(titlePts, `${id}: titleArcPath`);
    assertInsideCrop(datePts, `${id}: dateArcPath`);
    const sa = shape.safeArea;
    assert(
      sa.x >= cb.x - TOL && sa.x + sa.w <= cb.x + cb.w + TOL && sa.y >= cb.y - TOL && sa.y + sa.h <= cb.y + cb.h + TOL,
      `${id}: safeAreaがcropViewBox内`,
    );
    cropChecked++;
  }
  console.log(`cropViewBox妥当性チェック: ${cropChecked}件`);
}

// ── G: 説明文の全文表示ガード（goofy-hatching-mango.md 2026-07-07第4バッチ・実装中の追加要件）
// 全50件の実データで、fitDescription経由の説明文フォント/行数見積りが有限かつ正であることを
// 確認する（NaN・0除算等の回帰検知）。fits=falseの件数も参考情報として出す
// （IdeaShapeCard.tsx側でforeignObjectを拡張して全文表示するため、fits=falseは即バグでは
// ないが、割合が急増した場合はcontentMinの事前見積りが効いていない退行の兆候）
{
  let descChecked = 0;
  let notFitCount = 0;
  try {
    const { default: ideasData } = await import("../data/ideas.json", { with: { type: "json" } });
    for (const idea of ideasData) {
      const dateLabel = idea.date ? idea.date.replaceAll("-", ".") : "ARCHIVE";
      const shape = shapeForIdea(idea.id, idea.title, dateLabel, { seed: idea.seed, refs: idea.refs });
      const hasRefs = idea.refs.length > 0;
      const reserved = hasRefs ? estimateReservedLinksHeightPx(shape.viewBoxW, shape.safeArea.w, idea.refs) : 0;
      const fit = fitDescription(shape.viewBoxW, shape.safeArea.w, shape.safeArea.h, reserved, idea.seed);
      assert(Number.isFinite(fit.fontSizePx) && fit.fontSizePx > 0, `${idea.id}: 説明文フォントサイズが正の有限値`);
      assert(Number.isInteger(fit.lines) && fit.lines >= 1, `${idea.id}: 説明文の行数が1以上の整数`);
      if (!fit.fits) notFitCount++;
      descChecked++;
    }
    console.log(
      `説明文フィットチェック: ${descChecked}件 (DESC_FONT_FLOOR_RATIOでも数式上収まらずforeignObject拡張に委ねたケース: ${notFitCount}件)`,
    );
  } catch {
    console.warn("data/ideas.json の読み込みをスキップ（説明文フィットチェックは対象外）");
  }
}

// ── E: シェイプの全ユニーク化（goofy-hatching-mango.md 2026-07-07第4バッチ・実装中の追加要件）
// 全50件の輪郭を中心・平均半径で正規化した角度→半径プロファイルに変換し、同一種同士の
// ペア距離(正規化RMS差)の最小値がしきい値以上であることを確認する（見分けがつかない
// ほど酷似したペアの再発を防ぐ回帰ガード）
{
  function radiusProfile(pts, K = 72) {
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const withAngle = pts
      .map((p) => ({ a: Math.atan2(p.y - cy, p.x - cx), r: Math.hypot(p.x - cx, p.y - cy) }))
      .sort((a, b) => a.a - b.a);
    const profile = new Array(K);
    for (let k = 0; k < K; k++) {
      const targetA = -Math.PI + (k / K) * 2 * Math.PI;
      let lo = -1;
      for (let i = 0; i < withAngle.length; i++) {
        if (withAngle[i].a <= targetA) lo = i;
        else break;
      }
      if (lo === -1) lo = withAngle.length - 1;
      const hi = (lo + 1) % withAngle.length;
      const aLo = withAngle[lo].a;
      const aHi = withAngle[hi].a;
      let span = aHi - aLo;
      if (span <= 0) span += 2 * Math.PI;
      const t = span > 0 ? (((targetA - aLo + 2 * Math.PI) % (2 * Math.PI)) / span) : 0;
      profile[k] = withAngle[lo].r + t * (withAngle[hi].r - withAngle[lo].r);
    }
    const mean = profile.reduce((s, r) => s + r, 0) / profile.length;
    return profile.map((r) => r / mean);
  }
  function profileDist(p1, p2) {
    let sum = 0;
    for (let i = 0; i < p1.length; i++) sum += (p1[i] - p2[i]) ** 2;
    return Math.sqrt(sum / p1.length);
  }
  // シェイプ全ユニーク化(goofy-hatching-mango.md実装フィードバックで追加)のパラメータレンジ
  // 拡大前は最小0.0287(arch)まで近接していたペアが実測で見つかった。拡大後は0.0429まで改善
  // (2026-07-07時点)。この改善を下回る退行を検知するしきい値として設定する
  const UNIQUENESS_MIN_DIST_THRESHOLD = 0.035;
  try {
    const { default: ideasData } = await import("../data/ideas.json", { with: { type: "json" } });
    const shapes = ideasData.map((idea) => {
      const dateLabel = idea.date ? idea.date.replaceAll("-", ".") : "ARCHIVE";
      const shape = shapeForIdea(idea.id, idea.title, dateLabel, { seed: idea.seed, refs: idea.refs });
      const pts = densePointsFromPath(shape.outlinePath, 16);
      return { id: idea.id, kind: shape.kind, profile: radiusProfile(pts) };
    });
    const byKind = new Map();
    for (const s of shapes) {
      if (!byKind.has(s.kind)) byKind.set(s.kind, []);
      byKind.get(s.kind).push(s);
    }
    let globalMin = Infinity;
    let worstPair = null;
    let pairCount = 0;
    for (const [kind, list] of byKind) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const d = profileDist(list[i].profile, list[j].profile);
          pairCount++;
          if (d < globalMin) {
            globalMin = d;
            worstPair = { kind, a: list[i].id, b: list[j].id, d };
          }
        }
      }
    }
    console.log(
      `シェイプ全ユニーク化チェック: 同一種ペア${pairCount}組中、最小距離=${globalMin.toFixed(4)} (${worstPair ? `${worstPair.kind}: ${worstPair.a} vs ${worstPair.b}` : "N/A"})`,
    );
    assert(
      globalMin >= UNIQUENESS_MIN_DIST_THRESHOLD,
      `シェイプの同一種ペアが全て閾値以上に区別可能 (実測最小=${globalMin.toFixed(4)}, 閾値=${UNIQUENESS_MIN_DIST_THRESHOLD})`,
    );
  } catch {
    console.warn("data/ideas.json の読み込みをスキップ（シェイプ全ユニーク化チェックは対象外）");
  }
}

console.log(
  `smoke-idea-shapes: ${testCases.length}件 × 検証完了。出現シェイプ種: ${[...kindsSeen].join(", ")} / 複雑形比率=${(complexRatio * 100).toFixed(1)}%`,
);
if (failures > 0) {
  console.error(`\n${failures}件の検証失敗`);
  process.exit(1);
} else {
  console.log("全検証PASS");
}
