# RADAR_V2_DESIGN.md — 日次事例収集（Radar）v2 設計書

- 起票日: 2026-09-14
- 読者: プロジェクトオーナー（クリエイティブ職）／実装担当（Sonnetサブエージェント）
- 前提資料: `docs/RADAR_TASTE_AUDIT_2026-09-12.md`（精度監査。以下「監査」と呼ぶ）
- 位置づけ: 本書は`~/.claude/DESIGN.md`プロファイルAに準拠。個別機能のコード変更は本書を実装計画として`implementer`（Sonnet）に渡す

---

## 1. 概要・目的

現在の日次事例収集（Radar）は、お気に入り率1.6%（385件中6件）と、人力選定リストの12.4%の約1/8しか当たらない（監査§1・§3-1）。原因は「学習が効いていない」ことではなく、**「これはアイデアと呼べる仕事か」を判定する関門がそもそも存在しない**設計にある（監査§1-3）。発売・開催・発表・買収・コンテストの告知でも、リンクが生きていてサムネイルが取れれば採用されてしまう。

v2は、次の3点を直す。

1. **関門の新設**: 「一文で言えるアイデア」だけでなく、演出・表現・クラフトの完成度、技術・手法の新規性も採用基準に加えた3基準（A/B/C）で、告知のみの記事を機械的に弾く。
2. **情報源の再構築**: 勘で選んだ情報源リストを、ベイクオフ（同一基準での測定）で選び直す。X（Twitter）も、事例収集用に新たに整備する（現状は技術トレンド収集専用で、Cases向けには一切使われていない。監査§4）。
3. **ノルマの撤廃**: 「5〜7件」「国内最低4件」という数量目標をやめ、基準を満たすものだけを拾う。0件の日があってよい。

これにより、Radarの目的を「毎日何かを埋める仕組み」から「基準を満たした日だけ拾う仕組み」に転換する。

---

## 2. スコープ

### 含む
- 事例収集（Cases）向けの関門の新設（発見段階・記事化段階の2回判定）
- 情報源のレジストリ化（`data/sources.json`）とベイクオフによる選定
- X（Twitter）の事例収集への活用（オーナーのフォロー中アカウント＋お気に入り68件の制作会社・作者アカウントを起点に監視対象を構築）
- 発見プロンプトの改訂（固定ジャンルリスト→監査で言語化した4類型、ノルマ撤廃）
- 測定の追加（情報源別・関門基準別のお気に入り率）と監視（`checkXCasesHealth`）

### 含まない（意図的に対象外）
- Technology収集（`auto-research-tech.mjs`）・IdeaSeeds生成（`generate-idea-seeds.mjs`）のロジック変更（Xクエリの技術向け利用=`fetch-x-radar.mjs`はそのまま存続。twscrapeバイナリ解決のバグ修正のみ両者に効く共通化を行う＝§4参照）
- LINEでのフィードバック機能（監査§7 P4）。Phase 4として設計だけ触れ、実装は本v2の必須範囲に含めない
- Studio UI経由の手動リサーチ（既に非推奨。`docs/line-studio-ui-deprecated`の方針どおり）
- X公式APIの導入（従量課金NGのため検討しない。ADR参照）

---

## 3. アーキテクチャ・データフロー

### 3-1. 現状（監査時点）

```
auto-research-cc.mjs
  ├─ Phase A 発見: buildDiscoveryPrompt（固定ジャンルリスト・"5〜7件"・国内最低4件）
  ├─ 重複/リンク死活/サムネイル検証（機械的。アイデアの中身は見ていない）
  └─ Phase B 記事化: buildArticlePrompt → そのままcases.jsonへ追記

fetch-x-radar.mjs（tech専用。Windowsでtwscrape未検出のため全日停止中）
```

### 3-2. v2

```
data/sources.json（レジストリ。web/x_account/x_list/x_query）
        │ tier・enabled・hitDensity
        ▼
auto-research-cc.mjs
  ├─ Phase A 発見: buildDiscoveryPrompt（4類型＋基準A/B/C・件数は"該当あれば"・sources.json由来の情報源）
  │     └─ 発見出力に自己判定（verdict/criterion/score/reason）を同梱 ← 関門1回目（軽量）
  ├─ [新] fetch-x-cases.mjs 呼び出し（非致命的。素材として当日ツイートを発見プロンプトに挿入）
  ├─ 重複/リンク死活/サムネイル検証（変更なし）
  ├─ Phase B 記事化: buildArticlePrompt（WebSearch事実確認込み）
  │     └─ 記事化出力に自己判定を同梱 ← 関門2回目（事実確認済み・最終判定）
  ├─ 関門1・2のいずれかでreject → rejection-log.mjsに"no-creative-merit"等で記録、cases.jsonには追加しない
  └─ 採用 → cases.json追記（0件の日があってよい）

fetch-x-cases.mjs（新規。cases専用のX収集。twscrapeのlist_timeline/user_tweets/searchを使用）
        │
        ▼
$TEMP/researchman-x-cases-YYYY-MM-DD.json（text/media/links/author/metrics）

scripts/lib/twscrape-bin.mjs（新規・共通化）
  └─ fetch-x-radar.mjs（既存tech向け）・fetch-x-cases.mjs（新規cases向け）の両方から参照
     Windowsでは ~/.local/bin/twscrape.exe を見るよう修正（現状は.exeを見ないため常にnot found）

bakeoff-sources.mjs（新規・一回きり・DB非破壊）
  └─ data/sources.json候補ごとに直近N件を採点 → docs/SOURCE_BAKEOFF_<date>.md

watchdog.mjs
  └─ [新] checkXCasesHealth: fetch-x-cases.mjsのerrorsが2日連続ならLINE通知

tuneup-stats.mjs
  └─ [新] 情報源(source id)別・関門基準(A/B/C/none)別のお気に入り率を週次レポートに追加
```

### 3-3. Xの監視対象を作る経路（Phase 0〜1）

```
twscrape (following) ─┐
  オーナー自身のXフォロー中  ├→ クリエイティブ系を抽出（Sonnetがbio等で判定）
  アカウント                │
                          ├→ data/sources.json に kind: x_account として追加（enabled: false）
お気に入り68件の制作会社・  │        │
作者名 → WebSearchで        │        ▼
Xアカウントを特定 ─────────┘   bakeoff-sources.mjs で採点
                                    │
                                    ▼
                          オーナーが最終選定 → enabled: true
```

---

## 4. 変更対象（具体）

### 4-1. 新規ファイル

| ファイル | 役割 |
|---|---|
| `data/sources.json` | 情報源レジストリ。スキーマは4-2参照 |
| `scripts/fetch-x-cases.mjs` | Cases向けXコレクタ（tech向け`fetch-x-radar.mjs`とは別ファイル。理由はADR参照） |
| `scripts/lib/case-gate.mjs` | 関門の判定ロジック（プロンプト断片の組み立て・出力パース・却下理由の分類） |
| `scripts/lib/twscrape-bin.mjs` | twscrapeバイナリ解決の共通化（`.exe`対応含む） |
| `scripts/bakeoff-sources.mjs` | 情報源ベイクオフ（一回きり・DB書き込みなし） |
| `scripts/build-x-watchlist.mjs` | オーナーのフォロー中アカウント抽出＋お気に入り68件からの制作会社・作者アカウント抽出補助（`data/sources.json`への追加候補を出力するだけで、有効化はしない） |
| `docs/SOURCE_BAKEOFF_<date>.md` | ベイクオフ結果レポート（bakeoff-sources.mjsの出力） |
| `~/.researchman-x.json` | オーナーのXハンドル・監視対象設定（リポジトリ外。`~/.researchman-favsync.json`と同じ置き場所の流儀） |

### 4-2. `data/sources.json` スキーマ

```json
[
  {
    "id": "itsnicethat",
    "kind": "web",
    "locator": "https://www.itsnicethat.com/latest",
    "lang": "en",
    "region": "欧州",
    "tier": 1,
    "hitDensity": 0.60,
    "enabled": true,
    "note": "2026-09-12監査: DB5件中fav3=60%"
  },
  {
    "id": "x_watchlist_creative_agencies",
    "kind": "x_list",
    "locator": "1234567890123456789",
    "lang": "mixed",
    "region": "グローバル",
    "tier": 1,
    "hitDensity": null,
    "enabled": false,
    "note": "Phase 0で作成予定のXリストID（ベイクオフ未実施）"
  }
]
```

- `kind`: `"web" | "x_account" | "x_list" | "x_query"`
- `locator`: web=URL、x_account=`@handle`、x_list=list ID、x_query=検索クエリ文字列
- `tier`: 1〜3（1が最優先。`roundFoci`が情報源文字列を組み立てる際の優先順位に使う）
- `hitDensity`: ベイクオフ・運用実績から更新する当たり率（0〜1、未計測は`null`）
- `enabled`: falseの情報源は発見プロンプトに含めない（ベイクオフ待ち・除外決定済みの両方がここに入る）
- **tuneupの変更範囲はこのファイルの`tier`と`enabled`のみ**（4-4のガードレール参照）。`id`/`kind`/`locator`の追加・削除・変更はオーナー判断（Sonnetが提案しても機械的に拒否する）

### 4-3. `data/research-tuning.json` の変更

`cc.roundFoci[].sources`（自由文字列）を`sourceRefs`（`data/sources.json`のid配列）に置き換える。

```json
{
  "cc": {
    "roundFoci": [
      {
        "label": "海外の広告・クリエイティブキャンペーン + AI×クリエイティブ",
        "sourceRefs": ["lbbonline", "contagious", "itsnicethat", "bpando", "x_watchlist_creative_agencies"],
        "diversity": "..."
      }
    ]
  }
}
```

`auto-research-cc.mjs`側で`sourceRefs`を`data/sources.json`から解決し、`enabled: true`のものだけ`tier`順に整形して発見プロンプトの「## 情報源」節に挿入するヘルパー（例: `resolveSourcesText(sourceRefs, sourcesRegistry)`）を追加する。

`diversity`欄から「最低4件は日本国内の事例」を削除する（監査§3-2: 国内は投入量最大なのに打率最低。ノルマ自体を撤廃する方針と矛盾するため）。

### 4-4. `scripts/auto-research-cc.mjs` の変更

- `buildDiscoveryPrompt`
  - 「## 利用者の関心」の固定リスト（AI×クリエイティブ／音楽×テック／…／XR／ゲーム／…／VTuber・SNS発カルチャー）を削除し、監査§2の4類型（読み替え一手／生成的ブランドID／素材が主張するアート・プロダクト／AIが表現手段になっている仕事）＋基準A/B/Cの説明に差し替える
  - 「5〜7件」→「基準A/B/Cのいずれかを満たすものだけ。無理に埋めなくてよい。該当がなければ空配列でよい」
  - 出力JSONの各候補に`gateVerdict`（`accept`/`reject`）・`gateCriterion`（`A`/`B`/`C`/`none`）・`gateReason`（一言）を追加させる（関門1回目。モデル自身に発見と同時に自己判定させる。追加のCLI呼び出しはコストと待ち時間が増えるため行わない＝ADR参照）
  - `fetch-x-cases.mjs`の当日出力ファイルがあれば「## 素材（X）」として発見プロンプトに引用データとして挿入する（`fetch-x-radar.mjs`がtech向けにやっている「素材C」パターンを踏襲。ツイート内の指示文は無視するよう明記する＝プロンプトインジェクション対策）
- 発見ループ内: `gateVerdict === "reject"`の候補は、リンク検証・サムネイル検証に進む前にスキップし、`logRejection({ pipeline: "cc", reason: "no-creative-merit", detail: gateCriterion + ":" + gateReason })`を記録する
- `buildArticlePrompt`
  - 記事化はWebSearchで事実確認をするため、関門2回目（最終判定）をここに同梱する。出力JSONに`gateVerdict`/`gateCriterion`/`gateScore`(1〜5)/`gateReason`/`announcementType`（告知のみと判定した場合の種別: 発売/開催/発表/買収/コンテスト/other）を追加する
  - `gateVerdict === "reject"`ならcases.jsonに追加せず、`logRejection`に`"no-creative-merit"`＋`announcementType`を記録し、保存済みサムネイルを削除する（既存の却下時クリーンアップ処理を再利用）
- `TARGET_NEW`（現行5）・`MAX_ADD`（現行10）は**上限（これ以上は増やさない）としてはそのまま維持**する。ノルマ撤廃は発見プロンプトの文言変更で行うのであって、ループ機構自体（重複が多ければ複数ラウンド試す）は変えない。0件終了時の分岐（`追加対象がありませんでした`）は既存のまま使う

### 4-5. `scripts/fetch-x-cases.mjs`（新規）

- 呼び出し元: `auto-research-cc.mjs`のmain()冒頭付近（`fetch-x-radar.mjs`が`auto-research-tech.mjs`から呼ばれるのと同じ非致命的パターン）
- 取得方法（3系統。`data/sources.json`の`kind`で分岐）:
  1. `x_list` → `twscrape list_timeline <list_id>`
  2. `x_account`（tier上位のアカウント） → `twscrape user_tweets <username>`
  3. `x_query`（日英少数クエリ。技術向け`x-radar-queries.json`とは別ファイル`data/x-case-queries.json`を新設） → `twscrape search`
- フィルタ: 直近48h・RT除外・メディア添付orリンクあり・アカウントごとの相対エンゲージメント閾値（フォロワー数の差が大きいアカウント間で単純ないいね数比較をしないため、「そのアカウントの直近ツイート群の中央値に対する倍率」で判定する）
- 重複排除: tweet id基準（`fetch-x-radar.mjs`と同じ流儀）
- 出力: `$TEMP/researchman-x-cases-YYYY-MM-DD.json`（JST日付）に`{date, fetchedAt, sources, items: [{text, media, links, author, metrics}], errors}`
- 異常時方針は`fetch-x-radar.mjs`を完全踏襲: **あらゆる異常でexit 0**。twscrape不在・DB不在・レート制限等はすべて`errors`配列に記録し、収集パイプライン本体を止めない

### 4-6. `scripts/lib/twscrape-bin.mjs`（新規・共通化）

- `fetch-x-radar.mjs`内の`resolveTwscrapeBin()`をこのファイルに切り出し、`fetch-x-cases.mjs`と共有する
- **バグ修正**: 現行は`~/.local/bin/twscrape`のみを見て`.exe`を見ないため、Windows機では`which`も直接パスも両方失敗し、常に`"twscrape not found"`になる（監査§4で確認済みの全日停止の直接原因の一つ）。`process.platform === "win32"`なら`twscrape.exe`も試す
- `fetch-x-radar.mjs`側は関数importに差し替えるだけ（ロジック変更なし）

### 4-7. `scripts/lib/case-gate.mjs`（新規）

関門の判定は4-4のとおりモデル出力への同梱で行うため、このファイルの役割は「判定ロジックの実行」ではなく次の共通処理:
- プロンプトに挿入する基準A/B/C・4類型の説明文を1箇所で管理する定数（`buildDiscoveryPrompt`と`buildArticlePrompt`の両方から参照し、文言の二重管理を避ける）
- モデル出力の`gateVerdict`/`gateCriterion`/`gateScore`/`gateReason`/`announcementType`のバリデーション（型・許容値チェック。不正な値は`reject`扱いにフォールバック＝安全側に倒す）
- `bakeoff-sources.mjs`からも同じ基準文言を再利用する（ベイクオフと本番収集で判定基準がズレないようにするため。まさにこのファイルを共有する理由）

### 4-8. `scripts/bakeoff-sources.mjs`（新規）

- 入力: `data/sources.json`の全候補（`enabled`問わず）
- 処理: 候補ごとに直近N件（web=WebSearchまたはサイト新着一覧、x_account/x_list=`user_tweets`/`list_timeline`）を取得し、`case-gate.mjs`の基準文言を使ってClaude CLIに一括採点させる
- 出力: `docs/SOURCE_BAKEOFF_<date>.md`に「情報源 | 件数 | accept率 | 基準A/B/C内訳 | 代表例3件」の表
- 実行回数の上限: 1候補につきClaude CLI呼び出し1回（候補内のN件をまとめて1プロンプトで採点。サブスク内に収める。§6リスク参照）
- DB（cases.json）への書き込みは一切行わない（安全に何度でも再実行できる）

#### 4-8-1. ベイクオフにかける初期候補（母集団。ここから測って選ぶ。`enabled: false` で登録）

監査§3-4・§5・§7の実績と、オーナーのお気に入り4類型（読み替え／生成的ブランドID／素材／AIが手段）に照らして選んだ母集団。**ここに載ること＝採用ではない**。ベイクオフの accept 率で選定する。

| 区分 | 候補 | 根拠・狙い |
|---|---|---|
| 海外・実績あり | itsnicethat.com / bpando.org / dezeen.com / brand-innovators.com / lbbonline.com / creativereview.co.uk / contagious.com / adsoftheworld.com / campaignbrief.com（＋ .co.nz / asia） / creapills.com / lovethework.com（賞シーズン限定） | 監査§3-4・§5-1でお気に入り実績あり |
| 海外・ブランドID／タイポ | the Brand Identity（the-brandidentity.com） / Brand New（underconsideration.com/brandnew） / Fonts In Use / Typeroom / Dinamo・Collins・Wolff Olins・JKR・Pentagram の公式ニュース | 最大クラスタ「生成的ブランドID」の主要な発表先 |
| 海外・広告賞／クリエイティブ報道 | D&AD（dandad.org） / The One Show / Clios / AdAge Creativity / Muse by Clio / Campaign（campaignlive） / Famous Campaigns / Ads of Brands / Little Black Book | 受賞・受賞候補の一次〜準一次ソース |
| 海外・アート／素材／インスタレーション | designboom.com / Creative Boom / CreativeApplications.net / Colossal（thisiscolossal.com） / Ars Electronica / STIR world / Wallpaper* | 素材・空間・メディアアート型の発表先 |
| 国内 | 宣伝会議（advertimes は打率低のため要測定） / ブレーン（brain） / AXIS / JAGDA / TCC / ACC / ADC / グッドデザイン賞 / Dentsu Lab Tokyo / PARTY / Whatever / Rhizomatiks / tha ltd. / Konel / BASSDRUM / CBCNET | 国内は「賞・制作会社の一次発表」に寄せる。prtimes・natalie・bijutsutecho・gigazine・moguravr・automaton は監査で打率0のため候補から外す（ベイクオフで再検証したい場合のみ `enabled: false` で残す） |
| X（Phase 0後） | オーナーのフォロー中アカウントから抽出したクリエイティブ系 / お気に入り68件の制作会社・作者アカウント / 上記メディアの公式アカウント | `build-x-watchlist.mjs` の出力を候補に追加 |

### 4-9. `scripts/watchdog.mjs` の変更

- `LOG_JOBS`に`{ jobKey: "x-cases", label: "X Cases収集", logPath: ... }`相当を追加するか、`fetch-x-cases.mjs`の出力ファイル（`$TEMP/researchman-x-cases-*.json`）の`errors`配列を直接見る軽量チェックとして`checkXCasesHealth(report)`を新設する（後者を推奨。`fetch-x-radar.mjs`は現状専用の監視関数を持たず監査で発見が遅れた反省を踏まえる）
- ロジック: 直近2日分のファイルを読み、両日とも`errors.length > 0`ならLINE通知（Cookie失効・凍結の早期検知。監査§5-2で「専用通知は作っていない」と明記されていた欠落を埋める）

### 4-10. `scripts/lib/tuneup-stats.mjs` の変更

- `computeFavoriteStats`等に加えて、`computeSourceGateStats({ favIds, trashedIds, cases })`を新設
  - `cases[].sources`だけでなく、記事化時に記録した`gateCriterion`（cases.jsonの各エントリにフィールドとして保存する。4-11参照）を軸に、情報源別・基準別のお気に入り率を集計する

### 4-11. `data/cases.json` のフィールド追加

- 各エントリに`gateCriterion`（`"A"|"B"|"C"`。Radar発以外は空文字）と`sourceId`（`data/sources.json`のid。取得元が特定できない場合は空文字）を追加する。既存データへの後方互換のため、両フィールドが無いエントリは集計上「不明」として扱う（マイグレーション不要、機械検証は`schema-checker`の追加チェック項目とする）
- 2026-09-14確認: `scripts/audit-*.mjs`・`scripts/check-*.mjs` にフィールドのallowlist検査は無く、`src/lib/cases.ts` の `Case` 型もJSON import に対する余剰フィールドを拒否しないため、追加フィールドは既存の監査・ビルドを壊さない（実装時に `npm run build` と pre-push 監査4本で再確認すること）

### 4-12. `scripts/lib/tuneup-guardrails.mjs` の変更

- `validateSourcesRegistry(candidate)`と`checkSourcesChange(oldSources, newSources)`を新設
  - 許可する差分: 既存id各件の`tier`・`enabled`の変更のみ
  - 拒否: idの追加・削除、`kind`/`locator`/`lang`/`region`の変更（これらはオーナー判断。4-2の方針どおり機械的に弾く）
  - 変更量上限: 1回の実行で`tier`変更5件・`enabled`変更5件まで（既存の`laneChangesMax: 2`より広めに取るのは、ベイクオフ直後にまとめて有効化するケースを想定するため。ただし新規追加は含まないので暴走のリスクは低い）

### 4-13. `OPERATIONS.md` の変更

- 520〜549行目のX Radar節に「Cases向けは`fetch-x-cases.mjs`として分離している」旨の相互参照を追記
- twscrapeバイナリ解決が共通化されたことを明記（`scripts/lib/twscrape-bin.mjs`）
- Phase 0のCookie登録手順（本書§8と同一）をOPERATIONS.mdにも複製する（運用ドキュメントの一次窓口はOPERATIONS.mdであるため）

---

## 5. 設計判断と理由（ADR-lite）

### ADR-1: X公式APIではなくtwscrapeを使い続ける
- **採用**: twscrape（Cookie認証・ローカルSQLite・無料）
- **理由**: X公式APIの検索エンドポイントは有料枠でないと実用的な検索ができない。本プロジェクトは「有料API・従量課金サービスは既定で採用しない」方針（ユーザーCLAUDE.md §4）。twscrapeは既にtech収集で実績があり、追加コストなしで拡張できる
- **却下した代替**: Nitter（インスタンスの生存率が低く運用の当てにならない）、RSS（Xは公式RSSを廃止済み）、WebSearchでx.com検索（クロール制限で網羅性が低く、監査対象の「フォロー中アカウント」のような個人的な情報は検索エンジンに乗らない）

### ADR-2: TechとCasesのX収集を別ファイルに分離する
- **採用**: `fetch-x-radar.mjs`（tech既存）と`fetch-x-cases.mjs`（cases新規）を分ける
- **理由**: 情報源の質（技術トレンドのGitHub/論文系アカウント vs クリエイティブ制作会社アカウント）・取得方法（search中心 vs list_timeline/user_tweets中心）・エンゲージメント基準が別物で、1ファイルに統合すると条件分岐が増えて事故率が上がる。監査でも「Xの位置づけ」がtechとcasesで完全に混同されていたことが問題の一因だった（監査§4）
- **代替案（1ファイルに統合しquery種別で分岐）**: 却下。呼び出し元（`auto-research-tech.mjs`と`auto-research-cc.mjs`）が別スクリプトである現状の構造に合わせた方が、既存の非致命的呼び出しパターンをそのまま踏襲できる

### ADR-3: 関門を独立したCLI呼び出しにせず、発見/記事化の出力に同梱する
- **採用**: `buildDiscoveryPrompt`と`buildArticlePrompt`の出力JSONに`gateVerdict`等を追加フィールドとして持たせる
- **理由**: 独立呼び出しにすると1候補あたりCLI呼び出しが2回増え、既に「1プロンプト過積載によるタイムアウトを防ぐ」ために2段階構成にしている設計思想（`auto-research-cc.mjs`冒頭コメント）に反する。発見段階では候補のnote程度の情報しかないため軽量判定、記事化段階ではWebSearchで集めた事実に基づく判定という自然な役割分担になる
- **トレードオフ**: モデルの自己申告に依存するため、意図的な楽観判定（何でもAccept）のリスクがある。§6でモニタリングにより緩和する

### ADR-4: なぜ情報源をレジストリ化するか
- **採用**: `data/sources.json`に一元化し、`roundFoci`は自由文字列ではなくidの配列で参照する
- **理由**: 現行の`roundFoci[].sources`は自由文の情報源名の羅列で、打率の記録・ベイクオフでの再利用・tuneupでの機械的な差し替えのいずれもできない構造だった（監査§5-1・§6で「レーン差替えは最大2件まで」というガードレールはあるが、対象は文字列全体で個別ドメインの有効/無効を切り替えられない）。レジストリ化により、ベイクオフ結果を`tier`/`hitDensity`として構造化データに落とし、tuneupが安全に`tier`/`enabled`だけを動かせるようになる

### ADR-5: なぜ0件を正式に許容するか
- **採用**: 発見プロンプトから数量目標を削除し、`TARGET_NEW`/`MAX_ADD`は上限としてのみ残す
- **理由**: 監査の核心的な指摘（「基準に届かないのに数を埋めようとする構造がゴミ箱行きを量産している」）に対する直接的な処方箋。国内ラウンドの「最低4件」は投入量最大・打率最低という最悪の組み合わせだった（監査§3-2）
- **トレードオフ**: 収集件数が不安定になる。LINE通知文面・IdeaSeeds生成のサンプリング元（`data/idea-tuning.json`の`caseSample`）が「毎日一定数増える」前提を持っていないか、実装時に確認する（§6リスク）

### ADR-6: なぜベイクオフを先に行うか（P1をP0より先に一部実行）
- **採用**: Web側の情報源ベイクオフは、X整備（Phase 0のCookie設定というオーナー作業待ち）を待たずに先に実行できる設計にする
- **理由**: `bakeoff-sources.mjs`のWeb系（`kind: "web"`）候補はWebSearchのみで完結し、オーナー作業に依存しない。オーナーの手待ち時間を作らないために独立させる

---

## 6. トレードオフ・リスク・未解決

| リスク | 内容 | 対策 |
|---|---|---|
| 捨て垢の凍結・レート制限 | Cookie認証は永続的な保証がない。凍結されると事例収集用Xデータが即0件になる | `checkXCasesHealth`で2日連続エラーをLINE通知。Phase 0の再ログイン手順をOPERATIONS.mdに常設 |
| 関門の偽陰性（良いものを誤って却下） | モデルの自己申告ベースのため、基準の解釈がブレる・保守的すぎる判定になる可能性 | 月1回、`rejection-log`の`no-creative-merit`をサンプル抜き取りし、オーナーが目視で「これは拾うべきだった」がないか確認する運用を追加する（自動化はしない。判断が要るため） |
| ベイクオフのClaude呼び出し回数 | `bakeoff-sources.mjs`は候補数×1呼び出し。候補が50件を超えると1回のバッチ実行が長時間化する | サブスク内で完結させるため回数上限（例: 1回の実行で最大30候補）を設け、超過分は次回実行に回す設計にする |
| Cookie失効の無通知期間 | 監査時点では「専用通知は作っていない」状態が続いていた | `checkXCasesHealth`新設で解消（4-9） |
| 収集件数の不安定化 | 0件許容によりcases.jsonの増加ペースが日によって大きく変わる | IdeaSeeds生成（`caseSample`のサンプリング元）・LINE通知文面が「毎日◯件追加」前提でないか、実装時にコードを確認する（本設計の対象外だが影響範囲として明記） |
| レジストリの陳腐化 | `hitDensity`を更新し忘れると古い数字のまま`tier`判断が固定化する | tuneup週次レポートに情報源別お気に入り率を出す（4-10）ことで、放置されたら数字自体で気づける設計にする |
| gate情報の後方互換 | 既存cases.jsonエントリに`gateCriterion`/`sourceId`が無い | 空文字を「不明」として扱う設計にし、マイグレーションスクリプトは作らない（過去データの遡及判定はしない） |

### 未解決（意図的に本v2の範囲外）
- Phase 4（LINEフィードバック）の実装可否・UI設計
- お気に入り68件の制作会社・作者からXアカウントを特定する精度（WebSearchで見つからない場合の扱い。見つからなければ単にその事例は種にしない、という運用で妥協する）
- `x_query`（検索クエリ）を何本残すか（`data/x-case-queries.json`の中身自体はベイクオフ後にオーナーが決める）

---

## 7. 検証方針

### 7-1. 単体・ドライラン検証

| 対象 | コマンド | 期待結果 |
|---|---|---|
| `case-gate.mjs`のバリデーション | ユニットテスト（不正な`gateVerdict`値・`gateCriterion`値を渡す） | 不正値は`reject`にフォールバックすること |
| `twscrape-bin.mjs` | Windows機で`node -e "import('./scripts/lib/twscrape-bin.mjs').then(m=>console.log(m.resolveTwscrapeBin()))"` | `~/.local/bin/twscrape.exe`のパスが返ること（Phase 0でインストール済みが前提） |
| `fetch-x-cases.mjs` | `node scripts/fetch-x-cases.mjs --dry-run` | twscrape未設定時は`errors:["twscrape not found"]`で正常終了（exit 0）。設定済みなら`$TEMP/researchman-x-cases-<date>.json`に`items`が入ること |
| `auto-research-cc.mjs`（関門込み） | `npm run auto-research:cc:dry` | ログに却下件数が出力され、`logs/rejections-<month>.jsonl`に`no-creative-merit`理由の行が追加されること（cases.jsonは更新されないこと） |
| `bakeoff-sources.mjs` | `node scripts/bakeoff-sources.mjs --limit 5`（試験的に少数候補のみ） | `docs/SOURCE_BAKEOFF_<date>.md`が生成され、表の各行に件数・accept率・代表例が入ること |
| `tuneup-guardrails.mjs`の`checkSourcesChange` | ユニットテスト（idの追加・locator変更を含む候補を渡す） | `ok: false`で拒否されること。`tier`/`enabled`のみの変更は`ok: true` |
| `checkXCasesHealth` | `$TEMP`に2日分のエラー入りfixtureファイルを置いて`npm run watchdog` | LINE通知相当のreport行が出力されること（実際のLINE送信はモック/dry） |

### 7-2. 運用での打率計測（2週間）

1. Phase 1〜3を本番投入後、2週間分のRadar追加をため、`sources`と`gateCriterion`別のお気に入り率を`tuneup-stats.mjs`の新集計で確認する
2. 監査時点の基準値（Radar全体1.6%）に対し、有意な改善（目安: 5%以上）が見えるかを確認する。届かない場合は`data/sources.json`の`tier`/`enabled`を見直す（ベイクオフのやり直しも検討）

### 7-3. e2e手順（これが通れば機能が動いたと言える）

1. Phase 0完了（`~/.researchman-twscrape.db`にactive=1のアカウントが登録済み、`~/.researchman-x.json`にオーナーのハンドル設定済み）を前提とする
2. `node scripts/build-x-watchlist.mjs` を実行し、`data/sources.json`にx_account/x_list候補が`enabled: false`で追加されることを確認する
3. `node scripts/bakeoff-sources.mjs` を実行し、`docs/SOURCE_BAKEOFF_<date>.md`が生成され、少なくとも1件のweb候補行にaccept率が入っていることを確認する
4. ベイクオフ結果を見て、`data/sources.json`の上位候補を手動で`enabled: true`にする（この判断はオーナーが行う）
5. `npm run auto-research:cc:dry` を実行し、ログ上で以下がすべて確認できること:
   - 発見プロンプトに「基準A/B/C」の文言が含まれる（コンソール出力ではなくプロンプト生成関数の単体呼び出しで確認可）
   - 少なくとも1件が`gateVerdict: reject`でスキップされているか、全件acceptで通っているかのいずれかがログに出る（関門が実際に評価を行っている証拠）
   - cases.jsonは更新されない（dry-runのため）
6. `node scripts/fetch-x-cases.mjs` を本番実行し、`$TEMP/researchman-x-cases-<today>.json`が生成され、`errors`が空またはtwscrape起因の既知エラーのみであることを確認する
7. `npm run auto-research:cc`（本番）を1回実行し、cases.jsonに追加されたエントリ（0件でもよい）に`gateCriterion`と`sourceId`フィールドが入っていることを確認する
8. `npm run watchdog` を実行し、エラーなく完了する（`checkXCasesHealth`が例外を投げない）ことを確認する

上記8ステップが通れば、v2の主要コンポーネント（レジストリ・ベイクオフ・関門・X収集・監視）が実際に接続されて動いていると言える。

---

## 8. Phase 0でオーナーがやること

以下はオーナー本人の操作が必要な手順。**認証情報はチャットに貼らず、コマンドで直接登録すること。**

1. 捨て垢（以前使用していたもの）でXにブラウザログインする
2. ブラウザDevTools → Application/Storage → Cookies から `auth_token` と `ct0` の値を控える（チャットには貼らない）
3. ターミナルで直接登録する（Windows Git Bashの場合、twscrapeの実体は`~/.local/bin/twscrape.exe`）:
   ```
   twscrape --db ~/.researchman-twscrape.db add_cookie <username> "auth_token=...; ct0=..."
   ```
4. 登録確認:
   ```
   twscrape --db ~/.researchman-twscrape.db accounts
   ```
   出力の`active`列が`1`になっていることを確認する
5. `~/.researchman-x.json` を作成し、オーナー自身のXハンドルを設定する（実装担当がスキーマ例を用意する。`~/.researchman-favsync.json`と同じ「リポジトリ外・ローカル設定ファイル」の流儀）
6. （任意・Phase 1で使用）オーナーがXでフォローしている中から「クリエイティブ系だけをまとめたXリスト」を作成しておくと、`x_list`種別のソースとして直接使える（作らなくても`build-x-watchlist.mjs`が個別アカウントの列挙で代替する）

Cookie失効・アカウント凍結時は手順2〜4を同じユーザー名で再実行すればよい（上書き登録）。

---

## 変更ファイル一覧（実装担当への引き継ぎ）

### 新規
- `data/sources.json`
- `data/x-case-queries.json`
- `scripts/fetch-x-cases.mjs`
- `scripts/lib/case-gate.mjs`
- `scripts/lib/twscrape-bin.mjs`
- `scripts/bakeoff-sources.mjs`
- `scripts/build-x-watchlist.mjs`
- `~/.researchman-x.json`（リポジトリ外・オーナー環境のみ）
- `docs/SOURCE_BAKEOFF_<date>.md`（実行時に生成される成果物）

### 変更
- `scripts/auto-research-cc.mjs`（`buildDiscoveryPrompt`/`buildArticlePrompt`/関門統合/`fetch-x-cases.mjs`呼び出し）
- `scripts/fetch-x-radar.mjs`（`resolveTwscrapeBin`を`twscrape-bin.mjs`のimportに置換）
- `data/research-tuning.json`（`cc.roundFoci[].sources`→`sourceRefs`、国内ノルマ文言の削除）
- `scripts/lib/tuneup-guardrails.mjs`（`validateSourcesRegistry`/`checkSourcesChange`追加）
- `scripts/lib/tuneup-stats.mjs`（`computeSourceGateStats`追加）
- `scripts/watchdog.mjs`（`checkXCasesHealth`追加）
- `data/cases.json`（新規追加分から`gateCriterion`/`sourceId`フィールドを持つ。既存分は無変更）
- `OPERATIONS.md`（520〜549行目周辺にCases向けX収集の節を追記、Phase 0手順を複製）

### Phase構成（実装順）
1. **Phase 0**（オーナー作業）: 上記§8
2. **Phase 1**: `data/sources.json`初期化＋`bakeoff-sources.mjs`（Web側は即実行可）
   - ※ `scripts/lib/twscrape-bin.mjs`（`.exe`対応）は Phase 3 ではなく **Phase 1 で先に入れる**。Phase 0 の登録確認（`twscrape accounts`）と Phase 1 のXベイクオフがこの修正に依存するため（2026-09-14 実走で `spawnSync /c/Users/tomoy/.local/bin/twscrape ENOENT` を確認済み）
3. **Phase 2**: 関門（`case-gate.mjs`）＋プロンプト改訂＋ノルマ撤廃
4. **Phase 3**: `fetch-x-cases.mjs`＋`twscrape-bin.mjs`共通化＋`checkXCasesHealth`＋`computeSourceGateStats`
5. **Phase 4**（任意・本v2の必須範囲外）: LINEでの前日分フィードバック
