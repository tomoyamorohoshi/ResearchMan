# ResearchMan Studio — ローカル・リサーチ/アイデア共創アプリ 設計書

作成: 2026-07-09 / 更新: 2026-07-10（簡素化・自動反映・参照URL・切り口駆動ideaで合意）/ 状態: **設計確定・実装は新セッション**
UIモックアップ（合意済みv3）: https://claude.ai/code/artifact/8c4223c6-2b7c-46ab-a5ba-4009cf47d4d0
（2タブ・入力→Researching→RM風カード。Research=参照URL欄あり／idea=切り口ラベル付きシェイプ。
実装時はこのURLをWebFetchして正確なHTML/CSSを取得すること）

## 0. 一行要約
Mac常駐のローカルアプリ。**2タブ（Research / idea）× 3画面（入力 → Researching → 結果カード）**。
入力してOKすると裏で Claude（Agent SDK）がパイプラインを回し、**デイリーのリサーチと同じく
完全自動で Web の RM に反映**、結果を**RM本体と同じ見た目のカード**で表示する。各カードは
本番RMの詳細ページへのリンク。承認ステップは無し（品質は機械ガードレール＋事後LINE通知で担保）。

## 1. 目的
- デイリー自動収集とは別に、**テーマ指定の追加リサーチ**と**オンデマンドのアイデア生成**を、
  非エンジニアのユーザーが見やすいUIから自走で回せるようにする。
- 反映モデルは**既存デイリーと同一**（[[ops-routine-biweekly-watchdog]] / launchd 3ジョブと同じ
  「収集→監査→commit/push→verify-deploy→LINE通知」）。運用の一貫性を最優先。
- 「内部的にはClaudeが動くが、ユーザーにはUIしか見えない」を実現（[[adhoc-research-to-rm-flow]]）。

## 2. スコープ（MVP）/ 非スコープ
### MVP
- **Research タブ**: 種別（Case Study / Technology / 両方）＋テーマ＋**参照URL(任意・1〜3本)**＋観点
  ＋件数 を入力 → 実行 → Researching画面 → **RMのCase/Techカード**で結果表示（自動反映済み）。
  カードは `/cases/<id>` / `/technology/<id>` へのリンク。
  ※参照URL＝「これ系」の具体例。テーマ＋観点＋参照例が揃うほど収集精度が上がる（新聞広告10件で実証）。
- **idea タブ（テーマ駆動・事例の切り口を踏襲）**: テーマ(お題)＋縛り・文脈(任意)＋**切り口の源
  （全事例から / お気に入り中心）**＋件数 → 実行 → Researching → **RMの有機シェイプ（/ideas）カード**で
  結果表示（自動反映済み）。各カードは「切り口ラベル＋CASE＋TECH」を持ち `/ideas` へリンク。
  「Case Studyで学んだ発想の型（切り口）をテーマに適用してアイデアをくれる」がコア（§6参照）。
- 入力項目は各4〜5つ目安（増減可）。
- ジョブ履歴（過去の依頼と結果カードを後から開ける最小限の一覧）。

### 非スコープ（MVPでは作らない）
- **承認ボード・チェックボックス選別**（不採用。デイリー同様に完全自動）
- クラウド化・スマホ対応（まずローカル）／ライブチャットUI／マルチユーザー・認証／スケジューリング

## 3. 画面仕様（合意済みモックアップ準拠）
```
┌ [Research] [idea] ────────────────┐   3画面の状態遷移（タブごと独立）:
│  ① 入力フォーム                    │     form ──(実行)──▶ loading ──▶ results
│    ・種別/起点 セグメント           │       ▲                              │
│    ・テーマ / 観点 / 件数           │       └──────(新しい依頼)────────────┘
│    ・[ 実行 ]                       │
│  ② Researching…（進捗インジケータ） │   results のカード = RM本体と同じ見た目:
│  ③ 結果カード（RM風・リンク）       │     Research → 矩形Case/Techカード → /cases・/technology
└────────────────────────────────────┘     idea     → 有機シェイプカード      → /ideas
```
- 結果ヘッダに「✓ RM に自動反映」＋依頼サマリ＋「新しい依頼」。
- カードは実データ・実URL。クリックで本番RM詳細ページを開く（自動反映済みのため実在する）。

## 4. アーキテクチャ
```
[ブラウザ UI(localhost)] ──HTTP/SSE──▶ [Studio ローカルサーバ (Node/TS)]
                                          ├─ Claude Agent SDK
                                          │    └ 既存サブエージェント
                                          │      (case-collector / link-checker /
                                          │       award-verifier / case-writer)
                                          ├─ 既存スクリプト
                                          │    (search-cases / auto-research-* /
                                          │     build-tech-from-research /
                                          │     generate-idea-seeds / normalize-thumbnail /
                                          │     audit-* / precompute-idea-layouts /
                                          │     verify-deploy / notify-line)
                                          ├─ ジョブ履歴 (JSON/workdir)
                                          └─ git (lock共有・pre-push監査)  ── push ──▶ GitHub → Vercel
```
- エンジン = **Claude Agent SDK（TypeScript）**。今日手作業で回した収集/検証/反映を関数化して呼ぶ。
- Studioは `studio/` に隔離し、**RMのNext.jsビルド／Vercelデプロイには含めない**。

## 5. 反映と品質（＝デイリーと同一・完全自動）
- **人の承認は無し**。デイリー3ジョブと同じ「機械ガードレール＋事後LINE通知」。
- 反映後は必ず `verify-deploy` で本番Ready確認 → `notify-line` で「N件追加・push済み・反映確認」を送信。
- **効かせるガードレールは対象で変える**:
  - Research(テーマ系): `link-checker`（URL死活）＋ `award-verifier`（受賞レベル/部門/年の一次ソース照合）
    ＋ `audit-thumbnails`/`audit-integrity`（Case）or `audit-tech`（Tech）＋ tsc/lint/build。
    ※デイリーCaseの `audit-cannes`（正解リスト網羅）はテーマ系には適用しない（対象が開いているため）。
  - idea: `precompute-idea-layouts` 実行＋`ideas.json`と`idea-layouts.json`の**ペアコミット**
    （pre-push鮮度検査に整合。片方欠けは拒否）。
- 失敗時は commit 前に停止・作業ツリーを戻し、LINEにエラー通知（デイリーの `--result error` と同流儀）。

## 6. 既存資産の再利用マップ
### Research（Case）: 今日のフローを関数化
`case-collector`×角度別並列 → `link-checker`＋`award-verifier` → `case-writer` → サムネ収集＋
`scripts/lib/normalize-thumbnail.mjs` → `researchSources.ts` に新オーダー1行追加（新タブ時）→
`audit-thumbnails`/`audit-integrity` → commit/push（pre-push監査）→ `verify-deploy` → `notify-line`
### Research（Technology）
`auto-research-tech.mjs` / `build-tech-from-research.mjs` の収集・整形・factcheck・サムネ正規化を
Studioから起動 → `audit-tech` → commit/push → verify → LINE
### idea（テーマ駆動・事例の切り口を踏襲）★設計変更 2026-07-10
デイリーの `generate-idea-seeds.mjs` は「Case×Tech の掛け合わせ」起点だが、Studioのideaは
**テーマ起点で、事例から抽出した"切り口（発想の型）"をテーマに適用**する:
1. **切り口ライブラリ** `data/idea-angles.json`（新設）: 全Case Studyから繰り返し現れる創造メカニズム
   ／切り口を蒸留した語彙（例: 見立て・媒体の物理特性・機能の転用・参加型・引き算/不在・
   データを素材化・制約を武器に…）。お気に入りで重み付け。**この語彙は隔週チューンアップ
   （[[ops-routine-biweekly-watchdog]]）が維持・更新**する（お気に入り分析の成果物として自然に接続）。
2. 実行時: テーマ＋縛りで関連Case/Techを `search-cases.mjs`＋tech から retrieve（具体の触発材料）→
   切り口ライブラリ（源=全事例 or お気に入り中心）をテーマに適用してアイデアを生成 →
   各案は「切り口＋echoしたCASE＋使えるTECH」を明示。
3. `ideas.json` 追記（切り口フィールドを追加）→ `precompute-idea-layouts.mjs` →
   `ideas.json`＋`idea-layouts.json` **ペアコミット** → verify → LINE。
- 生成中核（サンプリング重み・混合比・切り口ライブラリ）はデイリーIdeasと共有し、隔週ブラッシュアップが
  両方に効く（二重メンテを避ける）。

## 7. ジョブ履歴（最小）
`studio/workdir/jobs/<id>.json`: `{ id, tab:"research|idea", request, status, resultCards:[{id,url,title,...}], commit, deployedUrl, cost, at }`
UIは履歴一覧から過去の結果カードを再表示できるだけ（承認・編集はしない）。

## 8. 技術スタック（MVP）
- バックエンド: Node + TypeScript / `@anthropic-ai/claude-agent-sdk` / 軽量サーバ(Hono/Express)+SSE(進捗)
- フロント: Vite + React の小さなSPA（合意モックアップのHTML/CSSを出発点に移植）
- ストア: `studio/workdir/` のJSON（DB不要）
- 起動: `npm run studio`（ローカルサーバ→ブラウザ）。将来 Tauri/メニューバー化は任意
- 鍵: `ANTHROPIC_API_KEY` はローカル環境変数（またはClaude Code認証流用）。リポジトリに置かない
- コスト: ジョブ単位の予算上限（超過で停止・LINE通知）

## 9. ディレクトリ
```
studio/
  server/      … ローカルサーバ・Agent SDK起動・ジョブ実行
  web/         … Vite+React UI（2タブ×3画面）
  workdir/     … ジョブ履歴JSON（gitignore）
  README.md    … 起動手順・鍵設定
```
- ルート `.gitignore` に `studio/workdir/` を追加。`next.config`/Vercel の対象外であることを担保。

## 10. 実装フェーズ（新セッションで・各フェーズ検証付き）
- **P0 骨組み**: `studio/` 雛形・ローカルサーバ・2タブ×3画面UI（モックアップ移植）・ダミー結果で疎通
- **P1 Research(Case)実行**: Agent SDKで収集→検証→反映（自動）→RMカード表示→本番URL確認
- **P2 Research(Technology)**: tech系スクリプト起動→audit-tech→反映
- **P3 idea**: 生成→precompute→ペアコミット→反映→シェイプカード表示
- **P4 仕上げ**: Researching進捗のSSE・ジョブ履歴・コスト上限・エラー時LINE・失敗時ロールバック
- 各Pで: tsc/lint・実ジョブ1本の疎通・**本番反映の目視確認**・LINE通知の到達確認。

## 11. 未決（実装前に確認したい少数）
1. UIトーン: 合意モックアップ（温かい紙＋藍＋明朝見出し）で確定でよいか（現状これで進める前提）。
2. Technology結果カードの詳細リンクは `/technology/<id>`、idea結果は per-item詳細が無いため `/ideas`
   （ポスター）へ、で確定でよいか。
3. `studio/` はRMリポジトリ同居（Vercel対象外）で確定（推奨）。別リポジトリ希望なら要相談。

---
関連: [[adhoc-research-to-rm-flow]] / [[ops-routine-biweekly-watchdog]] / [[work-automation-assets]] / [[source-tags]]
