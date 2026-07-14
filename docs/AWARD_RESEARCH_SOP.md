# アワードリサーチ SOP（受賞事実の確定手順）

背景: カンヌ2026リサーチで受賞事実の誤り13件（レベル誤り・欠落）が発生した。原因は
トレード記事（伝聞・要約）だけで受賞事実（アワード名・部門・レベル）を確定していたこと。
詳細は `OPERATIONS.md`「アワードデータの鉄則」節を参照。本ドキュメントは、この教訓を
カンヌ以外のアワード（D&AD・One Show・文化庁メディア芸術祭 等）にも適用できる形で
手順化したもの。**将来のセッションはこのドキュメントだけを読めば実行できる**ことを狙う。

## ユーザーの指示テンプレ・曖昧な依頼への確認

想定される指示の例:

> 「D&AD 2026 をリサーチしてDBに追加して。部門: 全部門 / レベル: Wood Pencil以上」

指示に部門範囲・レベル下限が明記されていない曖昧な依頼を受けた場合、着手前に必ず
以下の2点をユーザーに確認する（推測で進めない）:

1. **部門範囲** — 全部門か、特定部門のみか
2. **レベル下限** — 例: Grand Prix以上／Gold以上／Shortlist含む否か

この2点が確定するまでフェーズ1以降には進まない。

## フェーズ1: 公式ソース確定

対象アワードの公式受賞者一覧のURL・構造を特定する。

- カンヌ Lions → `lovethework.com`（部門ごとのwinners/shortlistsページ）
- D&AD → D&AD公式サイトのAwards Winnersアーカイブ
- One Show → One Club公式サイトのWinners Gallery
- 文化庁メディア芸術祭 → 文化庁メディア芸術祭公式サイトの受賞作品一覧
- その他のアワードも同様に、まず公式サイトの受賞者一覧ページを探す

**公式ソースが見つからない場合は推測で進めず、ユーザーに報告して進め方を合意する。**
トレード記事（Campaign/LBB/adobo等）は発見のきっかけとして使ってよいが、
**トレード記事のみで受賞事実（アワード名・部門・レベル）を確定することは禁止**。

## フェーズ2: 参照リスト先行構築（cases.jsonにはまだ触れない）

`.claude/agents/award-verifier` を部門並列で使い、公式ソースを部門ごとに照合して
`data/<award><year>-winners.json` を構築する。**この段階ではcases.jsonに一切触れない。**
部門ごとに `sourceUrl` を必ず残す（後から検証しやすくするため）。

参照リストのJSONスキーマ（`data/cannes2026-winners-v2.json` の実物構造をそのまま踏襲する）:

```json
{
  "_note": "リストの生成経緯・検証範囲・既知の制約を書く自由記述",
  "generatedFrom": "生成方法（例: 5 award-verifier agents (parallel, official site)）",
  "generatedAt": "YYYY-MM-DD",
  "sourceNote": "取得できなかった区分・既知の制約があれば記す",
  "verifiedCategories": ["公式ソースで照合済みの部門名（フェーズ3で--verified-categories未指定時のフォールバックに使われる）"],
  "winners": [
    {
      "category": "部門名",
      "subcategory": "小分類（無ければ空文字）",
      "level": "Grand Prix | Gold | Silver | Bronze 等",
      "title": "作品タイトル",
      "brand": "ブランド名",
      "agency": "制作会社（無ければ空文字）",
      "sourceUrl": "確認した公式URL"
    }
  ]
}
```

## フェーズ3: 監査スクリプト先行作成

執筆に入る前に、`scripts/audit-award.mjs`（汎用監査エンジン）で監査が通る状態を
作っておく。実際のCLI引数:

```
node scripts/audit-award.mjs --ref <参照リストのパス> --award-prefix "<アワード名+年>" \
  [--cases <cases.jsonのパス。既定 data/cases.json>] \
  [--verified-categories 部門A,部門B,...] \
  [--strict] \
  [--out <レポートJSON出力先>]
```

または `npm run audit:award -- <上記の引数>` でも同じ。`--award-prefix` は cases.json側の
`award` 文字列フィルタと、余分部門セグメント検出時の対象年フィルタの両方に使われるので、
参照リストのタイトルと同じ表記（例: `"D&AD 2026"`）を渡す。

`--verified-categories` を省略した場合は、参照リストJSON側の `verifiedCategories`
フィールド（フェーズ2のスキーマ参照）がそのままフォールバックとして使われる。
毎回CLIで指定する代わりに、参照リスト構築時点で `verifiedCategories` を書いておけば
以後の監査実行で自動的に効く。

新アワードを常時（pre-push時に）監査したい場合は、`scripts/audit-cannes.mjs` と同様の
**薄いラッパー**（例: `scripts/audit-dad.mjs`）をもう1本作り、そのアワード固有の知識
（部門名の表記ゆれを判定する `awardHasCategory`・レベル語彙を抽出する `extractLevel`・
公式照合済み部門の集合など）をラッパー側に実装した上で `scripts/hooks/pre-push` に
追記する、という選択肢がある（`audit-award.mjs` 本体は変更しない）。

**執筆（フェーズ4）に入るのは、参照リストに対して監査スクリプトが実行できる状態を
作ってからにする。** cases.jsonがまだ空でも、参照リストとして期待通りにmissing検出が
できることを確認しておけば、フェーズ4で書いた分から順次監査できる。

## フェーズ4: 事例執筆

`case-collector` / `case-writer` で量産する。

- **award欄は参照リストからの転記のみ**とする。記事（トレード記事等）は本文素材
  （overview/background/execution等）専用に使い、レベル・部門の根拠にしない
- リンク・動画・サムネイルの検証は `link-checker` と既存スクリプト
  （`scripts/check-links.mjs` 等）で行う
- cases.json追加後は **`schema-checker`（`.claude/agents/schema-checker.md`）を必ず実行**し、
  スキーマ・タグ語彙・重複・sources値・サムネイル存在を確認する

## フェーズ5: 監査ゲート → 公開

- コミット前に監査（`node scripts/audit-award.mjs ...` または該当ラッパーの
  `node scripts/audit-cannes.mjs` 等）を実行し、**FAIL 0件を確認してからコミットする**
- 完了報告には**「公式照合済み部門／未照合部門」の内訳を必ず明記する**
  （例: 「D&AD 2026: Film・Digital Design の2部門は公式サイトで照合済み。
  残り部門は参照リスト構築時点で未照合」）

## 関連エージェントの役割（詳細は各 `.claude/agents/*.md` 参照）

| エージェント | 役割 |
|---|---|
| `award-verifier` | 受賞事実（アワード・レベル・部門）の一次情報照合。3値（確認済み/未検証/誤り）で返す |
| `case-collector` | 事例リサーチの収集フェーズ。候補事例リスト（URL付き・未検証マーク付き）を返す |
| `case-writer` | cases.json追加用エントリの量産執筆。書き込みはせず提案のみ |
| `link-checker` | URL死活確認とYouTube oEmbedタイトル照合の機械検証 |
| `schema-checker` | cases.json変更後のスキーマ・語彙・重複・サムネイル整合検査 |
| `deck-builder` | リサーチレポートを自己完結HTMLデッキに変換 |
| `report-writer` | 検証済み事例材料からのリサーチレポート・企画仕込みシート執筆 |

## 関連ファイル

- `scripts/audit-award.mjs` — アワード非依存の汎用監査エンジン（本体ロジック）
- `scripts/audit-cannes.mjs` — カンヌ専用の薄いラッパー（実装例として参照）
- `OPERATIONS.md`「アワードデータの鉄則」節 — 本SOPの背景となった教訓の記録
