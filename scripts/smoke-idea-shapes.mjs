// src/lib/ideaShapes.ts のスモークテスト（計画書: goofy-hatching-mango.md 検証7）。
// 純粋なNode実行で完結させたいが、ideaShapes.tsはNext.js/tsc標準のmoduleResolution:"bundler"に
// 合わせて拡張子なしimport（./graph）を使っており、plain nodeのESMローダーは拡張子なし解決を
// サポートしないため直接は動かせない（tsc --noEmitでは正しく解決される。二重に確認済み）。
// そのため軽量トランスパイラtsx経由で実行する（package.jsonへの依存追加はしていない。npx tsxはこの
// 検証時のみのアドホック実行）:
//   npx tsx scripts/smoke-idea-shapes.mjs
import { shapeForIdea, SHAPE_KINDS } from "../src/lib/ideaShapes.ts";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// d文字列から (x,y) 座標を全部抜き出す（M/C/Q/L/Zのみを使うため、数値を2個ずつ組にすればよい）
function pointsFromPath(d) {
  const nums = (d.match(/-?\d+\.?\d*/g) || []).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

// M/L/C/Qコマンドの簡易パーサ（title/dateArcPathはM/L/Cのみ、outlinePathはM/L/Q/Zも使う）
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

// 実際にブラウザが描画する曲線に沿って密にサンプルした点列を返す（M/L/C/Qのtitle/dateArcPath・
// outlinePath用）。C/Qセグメントは制御点そのものではなく曲線上の実点をDe Casteljau評価で
// 複数取り、接線角チェックの誤検出（制御点はしばしば曲線の外側に張り出すため、それ自体を
// 辺として使うと過大な角度に見える）を防ぐ
function densePointsFromPath(d, samplesPerSegment = 8) {
  const cmds = parsePathCommands(d);
  const pts = [];
  let cur = null;
  for (const c of cmds) {
    if (c.cmd === "M") {
      cur = { x: c.args[0], y: c.args[1] };
      pts.push(cur);
    } else if (c.cmd === "L") {
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

const testIds = [];
for (let i = 0; i < 300; i++) testIds.push(`smoke-test-idea-${i}`);
// 実データのidも混ぜる（実運用形式のid文字列でも壊れないことを見る）
try {
  const { default: ideasData } = await import("../data/ideas.json", { with: { type: "json" } });
  for (const idea of ideasData) testIds.push(idea.id);
} catch {
  console.warn("data/ideas.json の読み込みをスキップ（本題のシェイプ検証には影響なし）");
}

const kindsSeen = new Set();

// タイトル弧・日付弧の「浅い弧」制約チェック（Fable視覚検分 + adversarialレビュー統合指摘A）。
// 接線角は隣接サンプル点の直線近似で近似する(textPath自体はCatmull-Romで滑らかだが、
// サンプル間隔で見た大まかな向きの逸脱を検出するには十分)
const TANGENT_LIMIT_DEG = 25;

function checkArcShallow(points, label) {
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    assert(dx > 0, `${label}: x座標が単調増加 (区間${i - 1}->${i}, dx=${dx.toFixed(3)})`);
    const angleDeg = (Math.abs(Math.atan2(dy, dx)) * 180) / Math.PI;
    assert(
      angleDeg <= TANGENT_LIMIT_DEG + 1e-6,
      `${label}: 接線角が±${TANGENT_LIMIT_DEG}度以内 (区間${i - 1}->${i}, 実測${angleDeg.toFixed(1)}度)`,
    );
  }
}

for (const id of testIds) {
  const shape1 = shapeForIdea(id);
  const shape2 = shapeForIdea(id);

  // 決定論性: 同じidなら常に同じ結果（Math.random不使用の確認）
  assert(JSON.stringify(shape1) === JSON.stringify(shape2), `${id}: 決定論性(2回呼び出しで一致)`);

  kindsSeen.add(shape1.kind);

  // 閉パスの健全性
  assert(shape1.outlinePath.trimEnd().endsWith("Z"), `${id}: outlinePathが閉じている(Z終端)`);
  assert(!/NaN|Infinity/.test(shape1.outlinePath), `${id}: outlinePathにNaN/Infinityがない`);
  assert(!/NaN|Infinity/.test(shape1.dateArcPath), `${id}: dateArcPathにNaN/Infinityがない`);
  assert(!/NaN|Infinity/.test(shape1.titleArcPath), `${id}: titleArcPathにNaN/Infinityがない`);
  assert(shape1.dateArcPath.startsWith("M"), `${id}: dateArcPathがMで始まる`);
  assert(shape1.titleArcPath.startsWith("M"), `${id}: titleArcPathがMで始まる`);
  assert(Number.isFinite(shape1.titleArcLength) && shape1.titleArcLength > 0, `${id}: titleArcLengthが正の有限値`);
  assert(Number.isFinite(shape1.dateArcLength) && shape1.dateArcLength > 0, `${id}: dateArcLengthが正の有限値`);
  // 弧が短すぎると、最小フォント+省略記号まで切り詰めても実質「…」だけになり読めない
  // （archive-40のblobでtitleArcLength=viewBoxWの6.4%まで狭まり、切り詰め結果が"…"単独になる
  // バグを実際に検出。センター探索でより長い候補を優先するよう修正済み）。
  // CJK1文字+省略記号が最小フォントで収まる理論下限は約7.1%(= (1.0+0.6)em*0.038 / 0.86)。
  // 340件のスモークテストでの実測ワーストケースは8.4%(title)/8.6%(date、tallOval/blobの縦長シェイプで
  // 発生)のため、8%を割ったら回帰とみなす（本番のMIN_USABLE_ARC_RATIO=0.2は探索の目標値であり、
  // 形状によっては幾何的制約でそこまで届かないことがある。0%文字＝バグ、を検出するための実測ベースの下限）
  const MIN_USABLE_ARC_RATIO = 0.08;
  assert(
    shape1.titleArcLength >= shape1.viewBoxW * MIN_USABLE_ARC_RATIO,
    `${id}: titleArcLengthが最低限読める長さ以上 (kind=${shape1.kind}, 実測比率=${(shape1.titleArcLength / shape1.viewBoxW).toFixed(3)})`,
  );
  assert(
    shape1.dateArcLength >= shape1.viewBoxW * MIN_USABLE_ARC_RATIO,
    `${id}: dateArcLengthが最低限読める長さ以上 (kind=${shape1.kind}, 実測比率=${(shape1.dateArcLength / shape1.viewBoxW).toFixed(3)})`,
  );

  // 輪郭の点群バウンディングボックスに対し、safeAreaが内側に収まっているか（大まかな包含チェック）
  const outlinePts = pointsFromPath(shape1.outlinePath);
  const minX = Math.min(...outlinePts.map((p) => p.x));
  const maxX = Math.max(...outlinePts.map((p) => p.x));
  const minY = Math.min(...outlinePts.map((p) => p.y));
  const maxY = Math.max(...outlinePts.map((p) => p.y));
  const sa = shape1.safeArea;
  assert(sa.x >= minX - 1 && sa.x + sa.w <= maxX + 1, `${id}: safeAreaのx方向が輪郭bbox内 (kind=${shape1.kind})`);
  assert(sa.y >= minY - 1 && sa.y + sa.h <= maxY + 1, `${id}: safeAreaのy方向が輪郭bbox内 (kind=${shape1.kind})`);
  assert(sa.w >= shape1.viewBoxW * 0.35, `${id}: safeArea幅が下限以上 (kind=${shape1.kind})`);
  assert(sa.h >= shape1.viewBoxH * 0.15, `${id}: safeArea高さが下限以上 (kind=${shape1.kind})`);

  // A: タイトル弧・日付弧が「浅い弧」(接線角±25度以内・単調左→右)であること
  // (実際に描画される曲線上を密サンプルして検証。制御点そのままだと過大評価になるため専用パーサを使う)
  const titlePts = densePointsFromPath(shape1.titleArcPath);
  const datePts = densePointsFromPath(shape1.dateArcPath);
  checkArcShallow(titlePts, `${id}: titleArcPath (kind=${shape1.kind})`);
  checkArcShallow(datePts, `${id}: dateArcPath (kind=${shape1.kind})`);

  // A3: タイトル弧とsafeAreaの垂直分離（safeAreaの下端がタイトル弧の最寄り点より上にあること = 重なりゼロ）
  const titleNearY = Math.min(...titlePts.map((p) => p.y));
  assert(
    sa.y + sa.h <= titleNearY + 1e-6,
    `${id}: safeArea下端がtitleArcと重ならない (kind=${shape1.kind}, safeAreaBottom=${(sa.y + sa.h).toFixed(2)}, titleNearY=${titleNearY.toFixed(2)})`,
  );
  // 日付弧とsafeAreaの垂直分離も同様に確認（上辺側。要求はタイトル側のみ明示だが対称に確認しておく）
  const dateNearY = Math.max(...datePts.map((p) => p.y));
  assert(
    sa.y >= dateNearY - 1e-6,
    `${id}: safeArea上端がdateArcと重ならない (kind=${shape1.kind}, safeAreaTop=${sa.y.toFixed(2)}, dateNearY=${dateNearY.toFixed(2)})`,
  );

  // タイトル弧・日付弧が輪郭(outlinePath)の内側に収まっていること（chord探索(Cartesian水平帯)
  // 追加時に実際に踏んだバグの回帰防止: polygonシェイプでpointAt由来の幅測定が実際の
  // outlinePath(直線+角丸)より広く出て、タイトル文字が輪郭の外へはみ出す事例をFable視覚検分で
  // 実測。判定はoutlinePath自体を密サンプルした多角形との点内判定で行う。多少の近似誤差を
  // 見込んでtoleranceを設ける
  const outlineDense = densePointsFromPath(shape1.outlinePath, 10);
  const CONTAINMENT_TOLERANCE = 1.2; // outlinePathの密サンプル近似誤差の許容幅(viewBox単位)
  function assertInsideOutline(pts, label) {
    for (const p of pts) {
      if (pointInPolygon(p, outlineDense)) continue;
      // 多角形近似の許容誤差ぶん内側へ押し込んでも外なら本当に外側とみなす
      const shrunk = { x: p.x + (p.x > sa.x + sa.w / 2 ? -CONTAINMENT_TOLERANCE : CONTAINMENT_TOLERANCE), y: p.y };
      assert(pointInPolygon(shrunk, outlineDense), `${label}: 点(${p.x.toFixed(2)},${p.y.toFixed(2)})が輪郭の外`);
    }
  }
  assertInsideOutline(titlePts, `${id}: titleArcPathが輪郭内 (kind=${shape1.kind})`);
  assertInsideOutline(datePts, `${id}: dateArcPathが輪郭内 (kind=${shape1.kind})`);

  // viewBox・aspectの整合性
  assert(shape1.viewBoxW > 0 && shape1.viewBoxH > 0, `${id}: viewBoxが正の値`);
  assert(Math.abs(shape1.aspect - shape1.viewBoxW / shape1.viewBoxH) < 1e-9, `${id}: aspectがviewBoxW/Hと一致`);
}

// 6種すべてが出現しているか（十分な数のidを流したので網羅されるはず）
for (const kind of SHAPE_KINDS) {
  assert(kindsSeen.has(kind), `シェイプ種"${kind}"が一度も出現していない`);
}
assert(kindsSeen.size >= 6, `6種以上のシェイプが出現 (実際: ${kindsSeen.size}種)`);

console.log(`smoke-idea-shapes: ${testIds.length}件のid × 検証完了。出現シェイプ種: ${[...kindsSeen].join(", ")}`);
if (failures > 0) {
  console.error(`\n${failures}件の検証失敗`);
  process.exit(1);
} else {
  console.log("全検証PASS");
}
