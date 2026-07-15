import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAddCaseAcceptedText,
  buildAddCaseDuplicateAsCaseText,
  buildAddCaseDuplicateText,
  buildAddCaseFailedText,
  buildAddCaseSuccessText,
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

// ── 事例追加（LINEでURLを送ると事例が追加される機能） ────────────────────

test("buildAddCaseAcceptedText: 受け付け・完了時通知の案内を含む", () => {
  assert.match(buildAddCaseAcceptedText(), /受け付け/);
});

test("buildAddCaseSuccessText: kind='case'は「Case として追加しました」+タイトル+URL", () => {
  const text = buildAddCaseSuccessText("case", "面白い事例", "https://research-man.vercel.app/cases/example-2026");
  assert.match(text, /Case として追加しました: 面白い事例/);
  assert.match(text, /https:\/\/research-man\.vercel\.app\/cases\/example-2026/);
  assert.doesNotMatch(text, /Technology/);
});

test("buildAddCaseSuccessText: kind='tech'は「Technology として追加しました」+タイトル+URL+タブ案内", () => {
  const text = buildAddCaseSuccessText("tech", "面白い技術", "https://research-man.vercel.app/technology/example-2026");
  assert.match(text, /Technology として追加しました: 面白い技術/);
  assert.match(text, /https:\/\/research-man\.vercel\.app\/technology\/example-2026/);
  assert.match(text, /Technologyタブ/);
});

test("buildAddCaseFailedText: 失敗理由を含む", () => {
  const text = buildAddCaseFailedText("既に登録済み: 面白い事例");
  assert.match(text, /既に登録済み: 面白い事例/);
});

test("buildAddCaseDuplicateText: 「事例の追加に失敗しました」でラップせず、タイトルをそのまま含む", () => {
  const text = buildAddCaseDuplicateText("面白い事例");
  assert.doesNotMatch(text, /事例の追加に失敗しました/);
  assert.match(text, /既に登録済み: 面白い事例/);
});

test("buildAddCaseDuplicateAsCaseText: 修正2 — Case Studyとして既に登録済みであることを明示する", () => {
  const text = buildAddCaseDuplicateAsCaseText("面白い事例");
  assert.doesNotMatch(text, /事例の追加に失敗しました/);
  assert.match(text, /既に登録済み（Case Studyとして）: 面白い事例/);
});
