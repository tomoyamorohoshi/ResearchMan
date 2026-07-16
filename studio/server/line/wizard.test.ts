import assert from "node:assert/strict";
import test from "node:test";
import type { LinePending } from "./pending.js";
import { pendingFromStructured, renderFinalConfirm, stepWizard, type WizardStepOutcome } from "./wizard.js";

const NOW = new Date("2026-07-12T00:00:00.000Z");
const USER = "U123";

function expectReply(outcome: WizardStepOutcome): { pending: LinePending | null; reply: string } {
  assert.equal(outcome.kind, "reply");
  if (outcome.kind !== "reply") throw new Error("unreachable");
  return outcome;
}

// ── idle ──────────────────────────────────────────────────────────

test("idle: 番号選択でメニューを飛ばしaway_themeへ（リッチメニュー導線）", () => {
  const outcome = stepWizard(null, "1", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_theme");
  assert.equal(r.pending?.kind, "Case Study");
  assert.match(r.reply, /テーマ/);
});

test("idle: メニュー語（事例調査等）でも同様にaway_themeへ", () => {
  const outcome = stepWizard(null, "アイデア出し", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_theme");
  assert.equal(r.pending?.kind, "idea");
});

test("idle: bare「アイデア」はメニュー選択として扱われる（ショートカットのempty-theme解釈より優先）", () => {
  const outcome = stepWizard(null, "アイデア", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_theme");
  assert.equal(r.pending?.kind, "idea");
});

test("idle: キーワード+テーマはショートカット（needsStructure）", () => {
  const outcome = stepWizard(null, "調べて 生成AI広告", NOW, USER);
  assert.equal(outcome.kind, "needsStructure");
  if (outcome.kind === "needsStructure") {
    assert.equal(outcome.requestKind, "Case Study");
    assert.equal(outcome.freeText, "生成AI広告");
  }
});

test("idle: 技術調べてはショートカットとして判定される（両方調べてはAWARDS追加により廃止済み）", () => {
  const b = stepWizard(null, "技術調べて 空間ディスプレイ", NOW, USER);
  assert.equal(b.kind, "needsStructure");
  if (b.kind === "needsStructure") assert.equal(b.requestKind, "Technology");

  // 「両方調べて」はもうショートカットとして反応しない（classify.ts::KEYWORD_RULESから削除済み）。
  // 「調べて」にも一致しないため、menu状態へのフォールバックになる。
  const a = stepWizard(null, "両方調べて AR広告", NOW, USER);
  const r = expectReply(a);
  assert.equal(r.pending?.state, "menu");
});

// ── idle/menu: AWARDS（要件A.1〜A.3） ─────────────────────────────

test("idle: 番号「3」でawait_award_nameへ（メニュー3番はAWARDSに置換済み）", () => {
  const outcome = stepWizard(null, "3", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_award_name");
  assert.equal(r.pending?.kind, "awards");
  assert.match(r.reply, /アワード名/);
});

test("idle: キーワード「アワード」でも質問1(await_award_name)から開始する", () => {
  const outcome = stepWizard(null, "アワード", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_award_name");
  assert.equal(r.pending?.kind, "awards");
});

test("idle: それ以外の任意テキストはmenu状態へ", () => {
  const outcome = stepWizard(null, "こんにちは", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "menu");
  assert.match(r.reply, /何をしますか/);
});

// ── idle: 事例追加（LINEでURLを送ると事例が追加される機能） ──────────────

test("idle: 既存キーワードに一致しないURL入りテキストはaddCase outcomeになる", () => {
  const outcome = stepWizard(null, "https://example.com/article/123", NOW, USER);
  assert.equal(outcome.kind, "addCase");
  if (outcome.kind === "addCase") {
    assert.equal(outcome.url, "https://example.com/article/123");
    assert.equal(outcome.context, "");
  }
});

test("idle: URL+補足テキストはcontextとしてaddCase outcomeに渡される", () => {
  const outcome = stepWizard(null, "これ見て https://example.com/article/123 音楽視点で", NOW, USER);
  assert.equal(outcome.kind, "addCase");
  if (outcome.kind === "addCase") {
    assert.equal(outcome.url, "https://example.com/article/123");
    assert.equal(outcome.context, "これ見て 音楽視点で");
  }
});

test("idle: 「調べて」等の既存キーワードはURLを含んでいてもaddCaseでなくneedsStructureになる（既存キーワード優先）", () => {
  const outcome = stepWizard(null, "調べて https://example.com/ref を参考に", NOW, USER);
  assert.equal(outcome.kind, "needsStructure");
  if (outcome.kind === "needsStructure") {
    assert.equal(outcome.requestKind, "Case Study");
    assert.equal(outcome.freeText, "https://example.com/ref を参考に");
  }
});

// ── menu ──────────────────────────────────────────────────────────

const menuPending: LinePending = { userId: USER, state: "menu", expiresAt: "2026-07-12T00:30:00.000Z" };

test("menu: 番号でkind確定しaway_themeへ", () => {
  const outcome = stepWizard(menuPending, "1", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_theme");
  assert.equal(r.pending?.kind, "Case Study");
});

test("menu: 番号「3」はAWARDSとしてawait_award_nameへ", () => {
  const outcome = stepWizard(menuPending, "3", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_award_name");
  assert.equal(r.pending?.kind, "awards");
  assert.match(r.reply, /アワード名/);
});

test("menu: 認識できない入力はmenuを再掲する", () => {
  const outcome = stepWizard(menuPending, "なんでもいい", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "menu");
  assert.match(r.reply, /何をしますか/);
});

// ── await_theme / confirm_theme ──────────────────────────────────

const awaitThemePending: LinePending = { userId: USER, state: "await_theme", kind: "Case Study", expiresAt: "x" };

test("await_theme: 入力全文がテーマになりconfirm_themeへ", () => {
  const outcome = stepWizard(awaitThemePending, "生成AI広告", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "confirm_theme");
  assert.equal(r.pending?.theme, "生成AI広告");
  assert.match(r.reply, /テーマ: 生成AI広告 でよいですか\? \(y\/n\)/);
});

test("await_theme: 空白のみはテーマとして受理せず再質問", () => {
  const outcome = stepWizard(awaitThemePending, "   ", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_theme");
});

const confirmThemeResearch: LinePending = { userId: USER, state: "confirm_theme", kind: "Case Study", theme: "生成AI広告", expiresAt: "x" };
const confirmThemeIdea: LinePending = { userId: USER, state: "confirm_theme", kind: "idea", theme: "音楽フェス", expiresAt: "x" };

test("confirm_theme: research + y → await_viewpoint", () => {
  const outcome = stepWizard(confirmThemeResearch, "y", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_viewpoint");
});

test("confirm_theme: idea + y → await_refs（観点ステップを飛ばす）", () => {
  const outcome = stepWizard(confirmThemeIdea, "y", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_refs");
  assert.match(r.reply, /縛り・文脈/);
});

test("confirm_theme: n → await_themeに戻る", () => {
  const outcome = stepWizard(confirmThemeResearch, "n", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_theme");
});

test("confirm_theme: y/nどちらでもない入力は再確認を繰り返す", () => {
  const outcome = stepWizard(confirmThemeResearch, "たぶん", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "confirm_theme");
  assert.match(r.reply, /テーマ: 生成AI広告/);
});

// ── await_viewpoint / confirm_viewpoint ──────────────────────────

const awaitViewpointPending: LinePending = { userId: USER, state: "await_viewpoint", kind: "Case Study", theme: "t", expiresAt: "x" };

test("await_viewpoint: 「なし」は確認を挟まず次の質問（await_refs）へ直行", () => {
  // 空値の「（指定なし）でよいですか? (y/n)」は「n=無い」と誤読され質問ループに
  // 陥る実害があったため、スキップ時は確認しない（2026-07-12 実使用フィードバック）
  const outcome = stepWizard(awaitViewpointPending, "なし", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_refs");
  assert.equal(r.pending?.viewpoint, "");
  assert.match(r.reply, /参考にしたい事例やURL/);
});

test("await_viewpoint: 入力テキストが観点になる", () => {
  const outcome = stepWizard(awaitViewpointPending, "海外事例中心", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.viewpoint, "海外事例中心");
});

const confirmViewpointPending: LinePending = {
  userId: USER,
  state: "confirm_viewpoint",
  kind: "Case Study",
  theme: "t",
  viewpoint: "海外中心",
  expiresAt: "x",
};

test("confirm_viewpoint: y → await_refs", () => {
  const outcome = stepWizard(confirmViewpointPending, "はい", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_refs");
  assert.match(r.reply, /参考にしたい事例やURL/);
});

test("confirm_viewpoint: n → await_viewpointに戻る", () => {
  const outcome = stepWizard(confirmViewpointPending, "n", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_viewpoint");
});

// ── await_refs / confirm_refs ────────────────────────────────────

const awaitRefsResearch: LinePending = { userId: USER, state: "await_refs", kind: "Case Study", theme: "t", viewpoint: "", expiresAt: "x" };
const awaitRefsIdea: LinePending = { userId: USER, state: "await_refs", kind: "idea", theme: "t", expiresAt: "x" };

test("await_refs(research): 本文からURLを複数抽出する", () => {
  const outcome = stepWizard(awaitRefsResearch, "参考: https://a.example.com/x とhttps://b.example.com/y です", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.refs, "https://a.example.com/x https://b.example.com/y");
});

test("await_refs(research): URLが無ければ本文をそのまま参考情報にする", () => {
  const outcome = stepWizard(awaitRefsResearch, "去年のカンヌ受賞作っぽい感じ", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.refs, "去年のカンヌ受賞作っぽい感じ");
});

test("await_refs: 「なし」は確認を挟まず全体確認（final_confirm）へ直行", () => {
  const outcome = stepWizard(awaitRefsResearch, "なし", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "final_confirm");
  assert.equal(r.pending?.refs, "");
  assert.match(r.reply, /件数/);
});

test("await_refs(idea): URL抽出せず本文をそのまま縛り・文脈にする", () => {
  const outcome = stepWizard(awaitRefsIdea, "予算少なめ・https://example.com/refも見て", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.refs, "予算少なめ・https://example.com/refも見て");
});

const confirmRefsResearch: LinePending = {
  userId: USER,
  state: "confirm_refs",
  kind: "Case Study",
  theme: "生成AI広告",
  viewpoint: "海外中心",
  refs: "",
  expiresAt: "x",
};

test("confirm_refs: y → final_confirmへ遷移し、件数は既定値5件で表示される", () => {
  const outcome = stepWizard(confirmRefsResearch, "y", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "final_confirm");
  assert.match(r.reply, /件数: 5件/);
  assert.match(r.reply, /この内容で実行しますか\? \(y\/n\)/);
});

test("confirm_refs: n → await_refsに戻る", () => {
  const outcome = stepWizard(confirmRefsResearch, "n", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_refs");
});

// ── final_confirm ─────────────────────────────────────────────────

const finalConfirmResearch: LinePending = {
  userId: USER,
  state: "final_confirm",
  kind: "Case Study",
  theme: "生成AI広告",
  viewpoint: "海外中心",
  refs: "",
  expiresAt: "x",
};
const finalConfirmIdea: LinePending = {
  userId: USER,
  state: "final_confirm",
  kind: "idea",
  theme: "音楽フェス",
  refs: "予算少なめ",
  expiresAt: "x",
};

test("final_confirm: y → execute（research）。件数は既定値が入る", () => {
  const outcome = stepWizard(finalConfirmResearch, "y", NOW, USER);
  assert.equal(outcome.kind, "execute");
  if (outcome.kind === "execute") {
    assert.equal(outcome.tab, "research");
    assert.deepEqual(outcome.request, { kind: "Case Study", theme: "生成AI広告", viewpoint: "海外中心", refUrl: "", count: 5 });
  }
});

test("final_confirm: y → execute（idea）", () => {
  const outcome = stepWizard(finalConfirmIdea, "OK", NOW, USER);
  assert.equal(outcome.kind, "execute");
  if (outcome.kind === "execute") {
    assert.equal(outcome.tab, "idea");
    assert.deepEqual(outcome.request, { theme: "音楽フェス", constraint: "予算少なめ", source: "全事例から", count: 6, dryRun: false });
  }
});

test("final_confirm: n → select_edit_field（researchは4項目・ideaは3項目提示）", () => {
  const rOutcome = stepWizard(finalConfirmResearch, "n", NOW, USER);
  const r = expectReply(rOutcome);
  assert.equal(r.pending?.state, "select_edit_field");
  assert.match(r.reply, /テーマ\/観点\/参考\/件数/);

  const iOutcome = stepWizard(finalConfirmIdea, "ちがう", NOW, USER);
  const i = expectReply(iOutcome);
  assert.equal(i.pending?.state, "select_edit_field");
  assert.match(i.reply, /テーマ\/縛り\/件数/);
});

test("final_confirm: 「件数 3」インライン編集はfinal_confirmに留まり件数を更新する（一発形式pendingにも効く）", () => {
  const outcome = stepWizard(finalConfirmResearch, "件数 3", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "final_confirm");
  assert.equal(r.pending?.count, 3);
  assert.match(r.reply, /件数: 3件/);
});

test("final_confirm: 「テーマ 新しいテーマ」インライン編集はテーマを更新する", () => {
  const outcome = stepWizard(finalConfirmResearch, "テーマ 別のテーマ", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.theme, "別のテーマ");
  assert.match(r.reply, /テーマ: 別のテーマ/);
});

test("final_confirm: 「観点 新観点」「参考 https://x」インライン編集も反映される", () => {
  const vp = stepWizard(finalConfirmResearch, "観点 新観点", NOW, USER);
  const vpR = expectReply(vp);
  assert.equal(vpR.pending?.viewpoint, "新観点");

  const refs = stepWizard(finalConfirmResearch, "参考 https://example.com/ref", NOW, USER);
  const refsR = expectReply(refs);
  assert.equal(refsR.pending?.refs, "https://example.com/ref");
});

test("final_confirm: y/n・編集コマンドいずれでもない入力は同じ内容を再掲する", () => {
  const outcome = stepWizard(finalConfirmResearch, "うーん", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "final_confirm");
  assert.match(r.reply, /テーマ: 生成AI広告/);
});

// ── select_edit_field / await_count_edit ─────────────────────────

const selectEditResearch: LinePending = {
  userId: USER,
  state: "select_edit_field",
  kind: "Case Study",
  theme: "t",
  viewpoint: "v",
  refs: "r",
  expiresAt: "x",
};
const selectEditIdea: LinePending = { userId: USER, state: "select_edit_field", kind: "idea", theme: "t", refs: "r", expiresAt: "x" };

test("select_edit_field: 「テーマ」→await_theme", () => {
  const outcome = stepWizard(selectEditResearch, "テーマ", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_theme");
});

test("select_edit_field: 「観点」→await_viewpoint（research）", () => {
  const outcome = stepWizard(selectEditResearch, "観点", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_viewpoint");
});

test("select_edit_field: ideaで「観点」は無効項目として再掲する", () => {
  const outcome = stepWizard(selectEditIdea, "観点", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "select_edit_field");
});

test("select_edit_field: 「参考」「縛り」→await_refs", () => {
  const a = expectReply(stepWizard(selectEditResearch, "参考", NOW, USER));
  assert.equal(a.pending?.state, "await_refs");
  const b = expectReply(stepWizard(selectEditIdea, "縛り", NOW, USER));
  assert.equal(b.pending?.state, "await_refs");
});

test("select_edit_field: 「件数」→await_count_edit", () => {
  const outcome = stepWizard(selectEditResearch, "件数", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_count_edit");
});

test("select_edit_field: 認識できない入力は再掲する", () => {
  const outcome = stepWizard(selectEditResearch, "知らない項目", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "select_edit_field");
});

test("select_edit_field: キャンセル語自体はここでは通常のフィールド名判定として扱われず再掲される（キャンセルの実処理はwebhook.ts側の事前判定）", () => {
  const outcome = stepWizard(selectEditResearch, "キャンセル", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "select_edit_field");
});

const awaitCountEditPending: LinePending = {
  userId: USER,
  state: "await_count_edit",
  kind: "Case Study",
  theme: "t",
  viewpoint: "",
  refs: "",
  expiresAt: "x",
};

test("await_count_edit: 数字入力でfinal_confirmへ戻り件数が反映される", () => {
  const outcome = stepWizard(awaitCountEditPending, "3", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "final_confirm");
  assert.equal(r.pending?.count, 3);
  assert.match(r.reply, /件数: 3件/);
});

test("await_count_edit: 全角数字・「3件」形式も受理する", () => {
  const a = expectReply(stepWizard(awaitCountEditPending, "３", NOW, USER));
  assert.equal(a.pending?.count, 3);
  const b = expectReply(stepWizard(awaitCountEditPending, "3件", NOW, USER));
  assert.equal(b.pending?.count, 3);
});

test("await_count_edit: 数字でなければ再入力を促し状態は変わらない", () => {
  const outcome = stepWizard(awaitCountEditPending, "たくさん", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_count_edit");
});

// ── await_award_name / await_award_categories（AWARDS。final_confirmを挟まない） ──

const awaitAwardNamePending: LinePending = { userId: USER, state: "await_award_name", kind: "awards", expiresAt: "x" };

test("await_award_name: 入力全文がawardNameRawになりawait_award_categoriesへ", () => {
  const outcome = stepWizard(awaitAwardNamePending, "D&AD 2026", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_award_categories");
  assert.equal(r.pending?.awardNameRaw, "D&AD 2026");
  assert.match(r.reply, /部門/);
});

test("await_award_name: 空白のみは受理せず再質問", () => {
  const outcome = stepWizard(awaitAwardNamePending, "   ", NOW, USER);
  const r = expectReply(outcome);
  assert.equal(r.pending?.state, "await_award_name");
});

const awaitAwardCategoriesPending: LinePending = {
  userId: USER,
  state: "await_award_categories",
  kind: "awards",
  awardNameRaw: "D&AD 2026",
  expiresAt: "x",
};

test("await_award_categories: 回答するとneedsAwardStructure（final_confirmを挟まず即構造化へ）", () => {
  const outcome = stepWizard(awaitAwardCategoriesPending, "全部門(ブロンズ以上)", NOW, USER);
  assert.equal(outcome.kind, "needsAwardStructure");
  if (outcome.kind === "needsAwardStructure") {
    assert.equal(outcome.q1, "D&AD 2026");
    assert.equal(outcome.q2, "全部門(ブロンズ以上)");
  }
});

// ── pendingFromStructured / renderFinalConfirm（ショートカット経路の合流点） ──

test("pendingFromStructured + renderFinalConfirm: research構造化結果をfinal_confirm表示に変換できる", () => {
  const p = pendingFromStructured(
    USER,
    "research",
    { kind: "Technology", theme: "空間ディスプレイ", viewpoint: "", refUrl: "", count: 3 },
    NOW,
  );
  assert.equal(p.state, "final_confirm");
  assert.equal(p.kind, "Technology");
  assert.match(renderFinalConfirm(p), /件数: 3件/);
});

test("pendingFromStructured + renderFinalConfirm: idea構造化結果をfinal_confirm表示に変換できる", () => {
  const p = pendingFromStructured(USER, "idea", { theme: "音楽フェス", constraint: "予算少なめ", source: "全事例から", count: 6, dryRun: false }, NOW);
  assert.equal(p.state, "final_confirm");
  assert.equal(p.kind, "idea");
  assert.equal(p.refs, "予算少なめ");
  assert.match(renderFinalConfirm(p), /縛り・文脈: 予算少なめ/);
});

// ── 状態が期限切れ扱い・カバレッジ外のような入力を渡しても例外を投げない防御確認 ──

test("stepWizard: 全状態を通しても例外を投げない（フォールスルー安全性）", () => {
  const states: LinePending["state"][] = [
    "menu",
    "await_theme",
    "confirm_theme",
    "await_viewpoint",
    "confirm_viewpoint",
    "await_refs",
    "confirm_refs",
    "final_confirm",
    "select_edit_field",
    "await_count_edit",
    "await_award_name",
    "await_award_categories",
  ];
  for (const state of states) {
    const p: LinePending = { userId: USER, state, kind: "Case Study", theme: "t", viewpoint: "", refs: "", expiresAt: "x" };
    assert.doesNotThrow(() => stepWizard(p, "", NOW, USER));
  }
});
