@AGENTS.md

## モデル運用ルール（トークン最適化）

思想: **準備（収集・整形・検査）は下位モデルで済ませ、型がない×失敗コスト大×全体を見る判断だけを上位モデルに残す。**

### メインセッションのモデル（自動分担・/model 手動切替は不要。2026-07-06確定）

- 本プロジェクトのメインは **Fable 5 [1m] 固定**（`.claude/settings.json` の `"model"` で自動適用。計画・レビュー・デバッグ・最終判断を担う）
- ユーザー既定は **Sonnet 5**（プロジェクト外の雑務セッションを上位課金にしないため。Project > User の公式上書き機構を利用）
- **実装・修正などの実作業は規模を問わずすべて `implementer`（Sonnet 5 固定・`~/.claude/agents/`）等のSonnetサブエージェントに委任**する。Fable（メイン）は計画・レビュー・確認・指揮のみを行い、コードやスクリプトを直接書かない（ユーザー指示 2026-07-13。旧「小さな修正はメインで直接行ってよい」ルールは廃止）
- 例外は「調査のための読み取り」と「CLAUDE.md等の運用ルール文書の更新」のみ
- effort は既定 high。難問（再現困難バグ・重要判断）だけ `/effort xhigh` に一時昇格し、終わったら戻す
- 旧ルール（既定Opus 4.8・Fable切替4条件の提案・「Opusに戻してOK」）は廃止。切替の提案・宣言は不要

### 委任の既定（量産・検査をメインでやらない）

- モデル指定は `.claude/agents/` の各定義に一元化。スキル・依頼文でモデルを都度指定しない
- 事例収集= `case-collector` / リンク・oEmbed検証= `link-checker` / 受賞照合= `award-verifier` / レポート執筆= `report-writer` / デッキ変換= `deck-builder` / cases.jsonエントリ執筆= `case-writer` / データ整合検査= `schema-checker`（事例追加・データ編集後は必ず）
- 実装後の日常レビュー= `adversarial-reviewer`、重要リリース前のみ `deep-reviewer`（Fable。日常で使わない）
- コード探索は Explore（Haiku固定に上書き済み）。要約・考察つき調査だけ general-purpose に Sonnet 指定
- 事例リサーチの一括実行は Workflow `case-research-sweep`

### 固定化の基準（単発業務はエージェント化しない）

- 初出の業務は、上記の思想（準備=下位・判断=上位）に沿ってその場のモデル指定で1回やる
- **同種の依頼が2回来たら**、`.claude/agents/` に定義を固定してこの一覧に追記する

## push滞留の扱い（2026-07-31〜08-07 の8日間push全ブロック事故の再発防止）

- 日次ジョブは **commit までは成功し push だけ失敗しうる**。この状態でもサイトは200を返し古い内容を配信し続けるため、外形監視では検知できない（実績: 11コミットが8日間滞留し本番未更新）
- 「リサーチが途中で失敗した」「サイトが更新されない」と言われたら、まず `git rev-list --count origin/main..main` で滞留を確認する
- 滞留があれば pre-push の4監査をローカル実行して原因監査を特定する（read-only・pushは不要）:
  `node scripts/audit-cannes.mjs` / `node scripts/audit-thumbnails.mjs` / `node scripts/audit-tech.mjs` / `node scripts/check-idea-layouts-freshness.mjs`
- **監査を緩める方向で直さない**（プレースホルダ・不整合の混入検知が本務）。原因データの方を正す
- 検知は `scripts/watchdog.mjs` の `checkUnpushedCommits` が自動化済み（滞留日数・失敗監査名・失敗文言つきで通知、同一理由は1日1回に抑制）
- 手動 push 前は必ずジョブのgitロック（`$TEMP/researchman-git.lock`）と実行中ジョブの有無を確認する

## データ生成物の「効かない変更」に注意

- `/ideas` は実行時計算ではなく `data/idea-layouts.json` の事前計算結果を描画する。`src/lib/ideaCollageLayout.ts` を変えても**再生成しなければ本番に一切反映されない**
- 鮮度検査のハッシュは `data/ideas.json` の内容と `IDEA_LAYOUTS_ALGO_VERSION` のみを見る。**レイアウトロジックの変更は検知されない**ため、ロジックを変えたら `scripts/lib/idea-layouts-hash.mjs` の `IDEA_LAYOUTS_ALGO_VERSION` を必ず上げる（上げないと古いレイアウトのまま検査が通り続ける）
- 再生成（`npx tsx scripts/precompute-idea-layouts.mjs`）は実測20分超。ALGO_VERSION更新→再生成→鮮度検査exit 0 までを1コミットで完結させる（中途半端な状態をコミットすると全pushがブロックされる）

## ブランチ運用（2026-07-19 誤ブランチcommit事故の再発防止）

- この作業ツリーは日次ジョブ（run-job.mjs）が直接 commit/push する**運用インフラ**。checkout状態がそのままジョブの出力先になる
- **セッション終了時・長時間の待機前は必ず main に戻す**。ブランチでの開発作業は git worktree で隔離する
- 防御: scripts/windows/run-job.mjs 冒頭の main ブランチ検査（main以外では収集を実行せず即失敗）
