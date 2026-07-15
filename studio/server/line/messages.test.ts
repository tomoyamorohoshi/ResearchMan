import assert from "node:assert/strict";
import test from "node:test";
import type { Job } from "../jobs.js";
import {
  buildAddCaseAcceptedText,
  buildAddCaseDuplicateAsCaseText,
  buildAddCaseDuplicateText,
  buildAddCaseFailedText,
  buildAddCaseSuccessText,
  buildAddTechFailedText,
  buildAwardAcceptedText,
  buildAwardCategoriesQuestionText,
  buildAwardNameQuestionText,
  buildAwardResumeAcceptedText,
  buildAwardResumeNotFoundText,
  buildEditFieldPromptText,
  buildFinalConfirmText,
  buildJobKindLabel,
  buildMenuText,
  buildProgressStatusText,
  buildRefsConfirmText,
  buildRefsQuestionText,
  buildUnconfiguredAllowedUserText,
} from "./messages.js";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    tab: "research",
    request: {},
    status: "running",
    resultCards: [],
    commit: null,
    deployedUrl: null,
    cost: null,
    at: "2026-07-14T00:00:00.000Z",
    ...overrides,
  };
}

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

test("buildMenuText: 4択と番号案内・キャンセル案内を含む（3番はAWARDS）", () => {
  const text = buildMenuText();
  assert.match(text, /事例調査/);
  assert.match(text, /技術調査/);
  assert.match(text, /AWARDS/);
  assert.doesNotMatch(text, /事例\+技術/);
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

test("buildAddCaseSuccessText: noteを渡すと末尾に注記行が追加される（要件2: 一次ソース未発見での縮退登録の明示）", () => {
  const text = buildAddCaseSuccessText(
    "tech",
    "面白い技術",
    "https://research-man.vercel.app/technology/example-2026",
    "※一次ソース未発見のため投稿リンクで登録",
  );
  assert.match(text, /※一次ソース未発見のため投稿リンクで登録/);
});

test("buildAddCaseSuccessText: noteを省略すれば注記行は付かない", () => {
  const text = buildAddCaseSuccessText("case", "面白い事例", "https://research-man.vercel.app/cases/example-2026");
  assert.doesNotMatch(text, /※/);
});

test("buildAddCaseFailedText: 失敗理由を含む", () => {
  const text = buildAddCaseFailedText("既に登録済み: 面白い事例");
  assert.match(text, /既に登録済み: 面白い事例/);
});

// ── buildAddTechFailedText（要件3: tech判定後の失敗は「技術の追加に失敗しました」） ────────
// 実測: Xポストがtechと判定された後、一次ソース欠如で失敗した際に「事例の追加に失敗しました」と
// 表示されユーザーが混乱していた。kind確定後は専用の文言を使う。

test("buildAddTechFailedText: 「技術の追加に失敗しました」+理由", () => {
  const text = buildAddTechFailedText("技術情報の検証に失敗しました: 有効なdomainがありません");
  assert.match(text, /^技術の追加に失敗しました: /);
  assert.match(text, /有効なdomainがありません/);
  assert.doesNotMatch(text, /事例の追加に失敗しました/);
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

// ── AWARDS ──────────────────────────────────────────────────────

test("buildAwardNameQuestionText/buildAwardCategoriesQuestionText: Q1/Q2の例示を含む", () => {
  assert.match(buildAwardNameQuestionText(), /アワード名/);
  assert.match(buildAwardCategoriesQuestionText(), /部門/);
});

test("buildAwardAcceptedText: 受付文言", () => {
  assert.match(buildAwardAcceptedText(), /受け付けました/);
});

test("buildAwardResumeNotFoundText/buildAwardResumeAcceptedText: 再開系の案内文", () => {
  assert.match(buildAwardResumeNotFoundText(), /再開できるAWARDS/);
  assert.match(buildAwardResumeAcceptedText(), /再開/);
});

// ── 進捗照会（LINE「進捗」「状況」。要件A） ─────────────────────────────

test("buildJobKindLabel: research(kind別)/add-case/awards/ideaの日本語ラベル", () => {
  assert.equal(buildJobKindLabel(makeJob({ tab: "research", request: { kind: "Case Study" } })), "事例調査");
  assert.equal(buildJobKindLabel(makeJob({ tab: "research", request: { kind: "Technology" } })), "技術調査");
  assert.equal(buildJobKindLabel(makeJob({ tab: "add-case", request: {} })), "事例・技術追加");
  assert.equal(buildJobKindLabel(makeJob({ tab: "awards", request: {} })), "AWARDS");
  assert.equal(buildJobKindLabel(makeJob({ tab: "idea", request: {} })), "アイデア出し");
});

test("buildProgressStatusText: 実行中1件（種別・フェーズ・経過時間を含む）", () => {
  const now = new Date("2026-07-14T00:12:00.000Z");
  const job = makeJob({
    tab: "research",
    request: { kind: "Case Study" },
    status: "running",
    progress: "収集を開始しています…",
    at: "2026-07-14T00:00:00.000Z",
  });
  const text = buildProgressStatusText([job], null, now);
  assert.match(text, /事例調査/);
  assert.match(text, /収集を開始しています…/);
  assert.match(text, /12分経過/);
  assert.doesNotMatch(text, /実行中のジョブはありません/);
});

test("buildProgressStatusText: progressPercentがあれば「◯%」を含む", () => {
  const now = new Date("2026-07-14T00:23:00.000Z");
  const job = makeJob({
    tab: "awards",
    request: {},
    status: "running",
    progress: "参照リスト構築中（1/3）",
    progressPercent: 42.3,
    at: "2026-07-14T00:00:00.000Z",
  });
  const text = buildProgressStatusText([job], null, now);
  assert.match(text, /AWARDS/);
  assert.match(text, /42%/);
  assert.match(text, /23分経過/);
});

test("buildProgressStatusText: paused理由（priority-job/budget/restart）をそれぞれ案内する", () => {
  const now = new Date("2026-07-14T00:10:00.000Z");
  const base = { tab: "awards" as const, request: {}, status: "paused" as const, progress: "P2実行中", at: "2026-07-14T00:00:00.000Z" };
  assert.match(buildProgressStatusText([makeJob({ ...base, pausedReason: "priority-job" })], null, now), /優先ジョブ待ち/);
  assert.match(buildProgressStatusText([makeJob({ ...base, pausedReason: "budget" })], null, now), /予算上限.*再開/);
  assert.match(buildProgressStatusText([makeJob({ ...base, pausedReason: "restart" })], null, now), /再起動復帰待ち/);
});

test("buildProgressStatusText: 実行中/一時停止中が複数あればそれぞれの情報を含む", () => {
  const now = new Date("2026-07-14T00:10:00.000Z");
  const techJob = makeJob({ tab: "research", request: { kind: "Technology" }, progress: "技術収集中", at: "2026-07-14T00:00:00.000Z" });
  const ideaJob = makeJob({ tab: "idea", request: {}, progress: "切り口選定中", at: "2026-07-14T00:05:00.000Z" });
  const text = buildProgressStatusText([techJob, ideaJob], null, now);
  assert.match(text, /技術調査/);
  assert.match(text, /技術収集中/);
  assert.match(text, /アイデア出し/);
  assert.match(text, /切り口選定中/);
});

test("buildProgressStatusText: 実行中0件・直近の完了ジョブがあれば「実行中のジョブはありません」+その情報", () => {
  const now = new Date("2026-07-14T00:35:00.000Z");
  const done = makeJob({ tab: "add-case", request: {}, status: "done", at: "2026-07-14T00:00:00.000Z" });
  const text = buildProgressStatusText([], done, now);
  assert.match(text, /実行中のジョブはありません/);
  assert.match(text, /事例・技術追加/);
  assert.match(text, /done/);
  assert.match(text, /35分前/);
});

test("buildProgressStatusText: 実行中0件・直近の完了ジョブが無ければジョブなしのみ", () => {
  const text = buildProgressStatusText([], null, new Date("2026-07-14T00:00:00.000Z"));
  assert.equal(text, "実行中のジョブはありません");
});
