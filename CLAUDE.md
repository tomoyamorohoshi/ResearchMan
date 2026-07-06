@AGENTS.md

## モデル運用ルール（トークン最適化）

思想: **準備（収集・整形・検査）は下位モデルで済ませ、型がない×失敗コスト大×全体を見る判断だけを上位モデルに残す。**

### メインセッションのモデル（自動分担・/model 手動切替は不要。2026-07-06改定）

- メインは **Fable 5 固定**（計画・レビュー・デバッグ・最終判断。ユーザー settings.json の `"model": "fable"` で自動適用）
- **3ステップ以上の実装自走は `implementer`（Sonnet 5 固定・`~/.claude/agents/`）に委任**し、Fable のターンは判断と指揮に限定する
- 小さな修正（1〜2ファイル・数十行）はメインで直接行ってよい
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
