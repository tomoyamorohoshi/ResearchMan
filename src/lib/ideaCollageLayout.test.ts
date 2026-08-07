// /ideas モバイルUI改善(2026-07-27)のユニットテスト。
// タスク2(フォントサイズ下限)・タスク3(mobileティアの行詰め=2列可)を検証する。
// タスク1(タッチ端末でのボタン常時表示)はCSSクラスのみの変更のためユニットテスト対象外
// (目視・スモークで確認)。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignShapeKinds,
  computeCollageLayout,
  FIXED_BODY_FONT_PX,
  FIXED_TITLE_FONT_PX,
  TIER_REF_WIDTH_PX,
  type CollageCardInput,
  type IdeaContentInput,
} from "./ideaCollageLayout";
import { solveFixedSizeShape } from "./ideaShapes";

// 短いタイトル・refなしの合成アイデア群(実運用の「短めの企画」を模す。2列並びが成立
// しやすい小さめカードが大半を占める想定データセット)
function buildContentInputs(n: number): IdeaContentInput[] {
  const inputs: IdeaContentInput[] = [];
  for (let i = 0; i < n; i++) {
    inputs.push({
      id: `mobile-pack-test-${i}`,
      title: `企画${i}号`,
      dateLabel: "2026.07.27",
      seed: `seed-${i}`,
      refs: [],
    });
  }
  return inputs;
}

function buildCardsForTier(
  inputs: readonly IdeaContentInput[],
  tier: "mobile" | "compact" | "wide",
): CollageCardInput[] {
  const assignments = assignShapeKinds(inputs);
  return inputs.map((idea) => {
    const assignment = assignments.get(idea.id);
    const { shape, scale } = solveFixedSizeShape(
      idea.id,
      idea.title,
      idea.dateLabel,
      { seed: idea.seed, refs: idea.refs },
      FIXED_TITLE_FONT_PX[tier],
      FIXED_BODY_FONT_PX[tier],
      assignment && { forceKind: assignment.kind, generous: assignment.generous },
    );
    return { id: idea.id, shape, scale };
  });
}

// 行=同一topPxを持つカード群としてグルーピングする(computeGridTierLayoutは同一行の
// カード全てに同じfinalTopYを割り当てるため、topPxの完全一致で行を復元できる)
function groupRowsByTopPx(placements: readonly { topPx: number }[]): number[] {
  const rows = new Map<number, number>();
  for (const p of placements) {
    rows.set(p.topPx, (rows.get(p.topPx) ?? 0) + 1);
  }
  return [...rows.values()];
}

test("フォントサイズ下限: mobileのtitleは13px以上・bodyは9.5px以上", () => {
  assert.ok(
    FIXED_TITLE_FONT_PX.mobile >= 13,
    `FIXED_TITLE_FONT_PX.mobileが13px以上 (実測=${FIXED_TITLE_FONT_PX.mobile})`,
  );
  assert.ok(
    FIXED_BODY_FONT_PX.mobile >= 9.5,
    `FIXED_BODY_FONT_PX.mobileが9.5px以上 (実測=${FIXED_BODY_FONT_PX.mobile})`,
  );
});

test("mobile: 短い内容のカード群では行詰めの結果、2枚以上並びの行が過半になる", () => {
  const inputs = buildContentInputs(40);
  const cards = buildCardsForTier(inputs, "mobile");
  const layout = computeCollageLayout(cards, "mobile");

  const rowSizes = groupRowsByTopPx(layout.placements);
  const twoPlusRows = rowSizes.filter((n) => n >= 2).length;
  const ratio = twoPlusRows / rowSizes.length;
  assert.ok(
    ratio > 0.5,
    `2枚以上並びの行が過半であること (実測=${(ratio * 100).toFixed(1)}%, 行数=${rowSizes.length}, カード数=${cards.length})`,
  );
});

test("mobile: 行幅予算(TIER_REF_WIDTH_PX.mobile)を超えるカードがない", () => {
  const inputs = buildContentInputs(40);
  const cards = buildCardsForTier(inputs, "mobile");
  const layout = computeCollageLayout(cards, "mobile");
  const budget = TIER_REF_WIDTH_PX.mobile;
  for (const p of layout.placements) {
    assert.ok(p.leftPx + p.widthPx <= budget + 1, `カード${p.id}が行幅予算(${budget}px)を超えていない`);
  }
});

test("mobile: 決定論性(同じ入力なら2回計算しても同一レイアウト)", () => {
  const inputs = buildContentInputs(10);
  const cards = buildCardsForTier(inputs, "mobile");
  const layout1 = computeCollageLayout(cards, "mobile");
  const layout2 = computeCollageLayout(cards, "mobile");
  assert.equal(JSON.stringify(layout1), JSON.stringify(layout2));
});

test("mobile: 極端に長いタイトルの大型カードが混在しても、非重なり(行幅予算内)を維持する", () => {
  const inputs = buildContentInputs(20);
  inputs.push({
    id: "mobile-pack-test-long",
    title: "とても長いタイトルがここに延々と続いてしまうケースを想定した検証用の文字列三十字",
    dateLabel: "2026.07.27",
    seed: "seed-long",
    refs: [],
  });
  const cards = buildCardsForTier(inputs, "mobile");
  const layout = computeCollageLayout(cards, "mobile");
  assert.equal(layout.placements.length, cards.length);
  const budget = TIER_REF_WIDTH_PX.mobile;
  for (const p of layout.placements) {
    assert.ok(p.leftPx + p.widthPx <= budget + 1, `カード${p.id}が行幅予算(${budget}px)を超えていない`);
  }
});
