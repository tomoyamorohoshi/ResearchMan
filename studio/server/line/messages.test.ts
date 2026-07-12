import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEditFieldPromptText,
  buildFinalConfirmText,
  buildMenuText,
  buildRefsConfirmText,
  buildRefsQuestionText,
  buildUnconfiguredAllowedUserText,
} from "./messages.js";

test("buildFinalConfirmText: research(Case Study) の内容とy/n・件数変更案内を含む", () => {
  const text = buildFinalConfirmText("research", {
    kind: "Case Study",
    theme: "生成AI広告",
    viewpoint: "海外中心",
    refUrl: "",
    count: 5,
  });
  assert.match(text, /【Case Study】/);
  assert.match(text, /テーマ: 生成AI広告/);
  assert.match(text, /観点: 海外中心/);
  assert.match(text, /参照URL: （指定なし）/);
  assert.match(text, /件数: 5件/);
  assert.match(text, /この内容で実行しますか\? \(y\/n\)/);
  assert.match(text, /件数を変えるには「件数 3」/);
});

test("buildFinalConfirmText: idea の内容を含む", () => {
  const text = buildFinalConfirmText("idea", {
    theme: "音楽フェス",
    constraint: "予算少なめ",
    source: "全事例から",
    count: 6,
  });
  assert.match(text, /【アイデア】/);
  assert.match(text, /お題: 音楽フェス/);
  assert.match(text, /縛り・文脈: 予算少なめ/);
  assert.match(text, /件数: 6件/);
});

test("buildMenuText: 4択と番号案内・キャンセル案内を含む", () => {
  const text = buildMenuText();
  assert.match(text, /事例調査/);
  assert.match(text, /技術調査/);
  assert.match(text, /事例\+技術/);
  assert.match(text, /アイデア出し/);
  assert.match(text, /キャンセル/);
});

test("buildRefsQuestionText/buildRefsConfirmText: ideaは縛り・文脈、researchは参照URLに読み替える", () => {
  assert.match(buildRefsQuestionText("idea"), /縛り・文脈/);
  assert.match(buildRefsQuestionText("Case Study"), /参考にしたい事例やURL/);
  assert.match(buildRefsConfirmText("idea", "予算少なめ"), /縛り・文脈: 予算少なめ/);
  assert.match(buildRefsConfirmText("Case Study", ""), /参照URL: （指定なし）/);
});

test("buildEditFieldPromptText: ideaには観点の選択肢が無い", () => {
  assert.match(buildEditFieldPromptText("Case Study"), /観点/);
  assert.doesNotMatch(buildEditFieldPromptText("idea"), /観点/);
});

test("buildUnconfiguredAllowedUserText: userIdを含む", () => {
  assert.match(buildUnconfiguredAllowedUserText("U12345"), /U12345/);
});
