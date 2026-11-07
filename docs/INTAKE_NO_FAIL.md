# 投稿(intake)を原則失敗させない（2026-11-07 オーナー決定）

「全部追加したくて入れているので、失敗は基本なしで」。LINE/Web から投稿された展示（`opts.trustOrigin:true` の intake）は原則すべて登録する。
ただし嘘のデータは作らない（日付・会場・題名は実在の情報源にある値だけ。推測で埋めない）。
**自動発見(auto)・trustOrigin なしの挙動と監査は変えない。**

## 有効化
`processCandidates` の `opts.ownerIntake:true`（かつ `trustOrigin:true` の intake 候補だけ）。呼び出し側が明示的に渡す:
Studio の add-case（`addCase.ts` → `processExhibitionAdd`）、日次ジョブの intake / 保留処理（`auto-research-exhibition.mjs`）。
`ownerIntake` なしなら従来どおり（既存テストはそのまま通る）。

## 流れ（`scripts/lib/exhibition-build.mjs`）
1. 従来の照合: 公式ページ → TAB 救済（既存）
2. 失敗したら `deps.reinvestigate(cand, reason)` を **1回だけ**（Claude CLI sonnet・WebSearch/WebFetch。`exhibition-reinvestigate.mjs`）。
   返った公式URL・TAB・会期/会場/題名（日付は実在の YYYY-MM-DD のみ採用）で照合をやり直す
3. それでも通らなければ **`verifiedVia:"owner-intake"` で追加**
   - sources: 見つかった情報源（kind は listing/news。official は使わない）＋投稿URL（kind:"social"）
   - link: 公式URL > TAB > 記事/一覧 > 投稿の順で最良のもの
   - city 空 → 都道府県名、matchReason 空 → 「オーナーが投稿した展示。」（事実を作らない定型）
   - サムネ: link → 他ソース → 投稿の順で取得。全部失敗なら追加せず `thumbnail-unavailable`（既存の retry/unverified 経路）
   - 都道府県が特定できない場合のみ追加不可（unverified）
4. **終了済み**: reject せず `status:"ended"` で追加（公式照合が通ればそのまま公式扱い）
5. **会期未発表**（start/end が実在の YYYY-MM-DD で取れない・start>end）: 戻り値 `pending` に返し、追加しない

## 保留リスト（`scripts/lib/exhibition-pending.mjs`）
- `data/inbox/exhibition-pending.json`（exhibition-handoff.json と同じローカルキュー・コミットしない）
- 積む: Studio（`appendPending`）／日次 intake（`runIntake` の `pending`）。PATCH には既存語彙で `unverified`＋理由 `pending-dates:` を返す（API は変えない）
- 日次 Exhibition ジョブ（手順 2c、handoff の後・発見の前）が `processPending`: 1回最大5件を再調査 → 日付が出れば上記 2〜3 で追加。
  最終書き込み成功後だけ `commitPending` で更新（まだ未発表は `attempts+1` で残す、180日で打ち切り）

## 分類外の救済
- case-adder プロンプト: 1日イベント・ライブ・期間限定イベント・終了済み・会期未発表も `exhibition`（1日は start=end）。`neither` は内容が全く確認できない時だけ
- `addCasePure.rescueNeitherAsCase`: `neither` でも題名と年が取れていれば最も近いタブ（Case Study）として登録（link 無しなら投稿URL）。事実が無い応答は従来どおりエラー

## 監査（`scripts/audit-exhibition.mjs`）
`verifiedVia:"owner-intake"` の例外は **origin:"intake"・intakeUrl あり・sources に投稿URL(kind:"social"・intakeUrl と同一)がある**ときだけ official 無しを許す。
日付・status・サムネ・slug・重複・official がある場合の link 一致などは緩めない。

## 表示・返信
- カード/詳細に小さく「公式未確認」（`OwnerIntakeBadge`）。詳細の外部リンク文言は「掲載元ページを開く」
- LINE 成功文に `【確認: 公式|TAB|投稿者確認】`。保留時は「会期未発表のため保留しました。発表され次第自動で追加します」

## 追補（deep-reviewer 指摘対応）
- 再調査の値は、実際に取得した(200)ページで dateAppearsInText／venueAppearsInText／titleAppearsInText が通った項目だけ採用（日付は開始・終了の組が同じページで確認できたときだけ）。通らない項目は元の投稿由来の値のまま
- link・sources に使うのは取得して 200 だった URL だけ。投稿URLは必ず kind:"social" で入れ、同じURLの listing は捨てる。link は既存の全展示と重複させない（同じ投稿の2件目以降は固有URL、無ければ `link-collision` で unverified）
- 公式照合が通ったのにサムネだけ取れない場合は、記事・投稿URLでサムネだけ試し、駄目なら保留(`thumbnail-unavailable`)。owner-intake に格下げしない
- 確定の順序: 日次ジョブは intake の PATCH と保留リスト更新を `data/inbox/exhibition-finalize.json`（計画）に積むだけ。run-job が audit-exhibition 通過後に `auto-research-exhibition.mjs --finalize` で確定する。
  監査 FAIL の日は計画を確定せず、次回起動時に破棄 → 投稿は intake キュー/保留リストに残る。保留の書き込みに失敗した投稿は PATCH を `retry` にして intake キューに戻す
- 保留キーは intakeUrl + 最初の題名(`pendingTitle`)。attempts 14 回・180 日で保留から外し、`pending-expired` として unverified キュー（通知サマリー）に理由つきで返す
- 再調査の上限: 日次ジョブは計5回（`makeReinvestigator`）、Studio は1ジョブ3回。`BudgetExceededError` は握りつぶさずジョブごと止める
- city が空のときは都道府県名を入れる（監査の必須項目のため）。表示側は city が都道府県と同じなら出さない。matchReason の既定値は owner-intake の経路だけ

## 注意
- 投稿者確認の展示は dedupe・会期追従の根拠ページが無いので、後から公式URLつきで再投稿されると公式へ昇格する（TAB 確認済みと同じ扱い）
- `.claude/agents/case-adder.md` の判定文は未更新（権限でこの作業では編集不可）。同等の指示は `addCasePrompts.ts`（実行時プロンプト）に入れてある
