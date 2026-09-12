# 日次自動収集（Radar）精度監査レポート

- 監査日: 2026-09-12
- 対象: 日次自動収集パイプライン（`Radar` = `scripts/auto-research-cc.mjs` 経由でDBに追加される事例）
- 読者: プロジェクトオーナー（技術用語は都度かみ砕く）
- 数字の出典: すべて本レポート末尾に記載のファイル名を明記（丸め表記あり）

---

## 1. 結論（3行）

1. **Radar発の事例のお気に入り率は 1.6%（385件中6件）。人力で選んだ「Cannes 2026」リストの12.4%（290件中36件）の約1/8しかない。**（出典: `taste-stats.txt` sources集計）
2. **ゴミ箱に入れられた39件は、例外なく全件がRadar発。** Cannes・User（手動追加）・Floating（既存ストック）発の事例はゴミ箱ゼロ件。（出典: `trash-full.json` 全39件のsources確認、`taste-stats.txt`）
3. **原因は「学習が効いていない」ことではない。** Radarの入口（発見プロンプト）には「見つけた事実」を採否する基準（リンクが生きているか・サムネイルが取れるか・記事化できたか）しかなく、**「これはアイデアと呼べる仕事か」を判定する関門がそもそも存在しない**。ニュース性があれば通り、告知記事でも通る設計になっている。

以下、この3行の根拠と、直すための具体案を順に示す。

---

## 2. オーナーが求めている事例の像

お気に入り68件（case種別）を全件読んだ。ジャンル（広告／アート／プロダクト）で選ばれているのではなく、**「仕組み・素材・データ・物理的制約を、一文で言えるアイデアに変換できているか」という構造**で選ばれている。大きく4つの型に分かれる。

### (a) 制約・既存物の「読み替え」一手

すでにそこにあるもの（月の軌道、電線、Wi-Fiの電波名）を、別の意味に読み替えるだけで成立する一手。

| 事例 | 何が一文で言えるか |
|---|---|
| Steph Curry Shoots the Moon | スーパームーンとの天体アライメントを計算し、ビルボードが「月を撃つ」瞬間を作った超低予算OOH |
| WiFi Invasion | Wi-Fi名をそのまま広告看板に変えた「目に見えない屋外広告」 |
| Searching for Birds on Wires | 電線に止まる鳥の位置を楽譜に変換し、電力インフラを交響曲にした音楽広告 |

（出典: `favorites-full.json` summary欄）

### (b) 音・データ・気象に反応する生成的ブランドID（最大クラスタ、約12〜14件）

68件中もっとも数が多い型。ロゴやタイポグラフィそのものが、音・演奏データ・運用データ・気象などの入力に応じてリアルタイムに形を変える「動くブランドID」。Wolff Olins（AOL / Oi / Patreon）、Collins×Dinamo（サンフランシスコ交響楽団）、JKR（Centersquare）、Neue（ノルウェー音楽アカデミー／Visit Nordkyn）、NB Studio（Philharmonie Luxembourg）、Polar（OSESP）など。

| 事例 | 何が一文で言えるか |
|---|---|
| San Francisco Symphony Dynamic Typography | 音や動きに反応して形を変えるバリアブルフォントを核にしたブランド刷新 |
| Centersquare | リアルタイムの運用データをロゴのパターンへ変換するツールで刷新したブランド |
| Philharmonie Luxembourg Identity | 演奏中の音楽の波形にリアルタイムで反応して振動・屈折するロゴ |

### (c) 素材そのものが主張するアート／プロダクト

技法や見た目の前に、素材そのものが事実を語っている仕事。

| 事例 | 何が一文で言えるか |
|---|---|
| T-REX LEATHER | ティラノサウルスの化石コラーゲン配列情報から培養した「恐竜レザー」のバッグ |
| Antibiotic Resistance Quilt | 実在するMRSA等の耐性菌を布地に培養・染色し薬剤耐性の脅威を可視化したキルト |
| 水跡 - traces of energy - | 旧水力発電所に梱包フィルムを張り巡らせ、かつて流れた水の記憶を立体化したインスタレーション |

### (d) AIが「話題」でなく「表現・発見の手段」として効いている仕事

AIを使ったこと自体がニュースなのではなく、AIがないと成立しなかった仕事。

| 事例 | 何が一文で言えるか |
|---|---|
| An Impossible Life | 撮影不可能な海亀の「失われた数十年」を生成AIで再構築した科学監修つき保全ドキュメンタリー |
| MAGNIF-EYE | 家族写真をAIが解析し子どもの近視の初期サインを発見する「カメラロールが視力検査になる」ツール |
| Decoy Font | 人間には正しく読めるがAI（OCR）には誤読させられるフォント |

### 反対像：ゴミ箱39件は例外なく「告知」

ゴミ箱に入った39件は、上記4類型のどれにも当てはまらない。すべてが**発売・開催・発表・買収・コンテストの告知**である。

- ゲーム新作の発売/リリース告知（Serious Sam: Shatterverse、MARY完全版、TCG Card Shop Simulator、Chilla's Art新作、Kingdom Hearts IV発売決定 等）
- 個展・展覧会の開催告知（猪熊弦一郎個展、浅間国際フォトフェスティバル、ゼミ展2026、リシンク展、JAGDAデザイン会議 等）
- 企業の発表・買収告知（OpenAIによるNextSlide買収、KitBashによるArtStation/Sketchfab買収、Made by Google発表、Virtual Desktop対応発表）
- コンテスト告知（Adathon、MAD STARS 2026）

（出典: `trash-full.json` 全39件、`radar-weekly-stats.txt` 末尾リスト）

**重要な仮説修正**: 当初「ジャンル（ゲーム/VTuber/XR除外）の問題」と見えるが、実際はジャンルではなく**「一文でアイデアを言えるか」の欠如**が本質。ゲームでも「Console Archives 闘機伝承」のようにアイデアが薄い告知はゴミ箱行きだが、ゲーム関連でも仕組みが立っていれば（お気に入りの中にゲーム的要素を含む事例は無いが）通る余地はある設計にすべき、という含意になる。

---

## 3. 数字

### 3-1. sources別（DB全体に対する偏り）

| sources | お気に入り数（倍率） | ゴミ箱数（倍率） | DB全体件数 |
|---|---|---|---|
| Radar（日次自動収集） | 6（0.3倍） | 39（3.1倍） | 385 |
| Cannes 2026（人力選定リスト） | 36（2.1倍） | 0（0.0倍） | 290 |
| User（手動追加） | 24（11.2倍） | 0（0.0倍） | 37 |
| Floating（既存ストック） | 2（2.7倍） | 0（0.0倍） | 13 |

打率換算: Radar 6/385=**1.6%**、Cannes 36/290=**12.4%**、User 24/37=**64.9%**。（出典: `taste-stats.txt`）

### 3-2. 地域別

**DB全体（全sources混在）**

| 地域 | お気に入り（倍率） | ゴミ箱（倍率） | DB全体件数 |
|---|---|---|---|
| 欧州 | 24（1.7倍） | 1（0.1倍） | 239 |
| 北米 | 17（1.2倍） | 12（1.5倍） | 245 |
| 国内 | 7（0.3倍） | 18（1.5倍） | 371 |
| グローバル | 6（0.5倍） | 6（0.9倍） | 209 |

（出典: `taste-stats.txt`）

**Radar発のみ（直近10週・377件、より精度が高い指標）**

| 地域 | Radar追加数 | お気に入り | ゴミ箱 | ゴミ箱率 |
|---|---|---|---|---|
| 国内 | 155 | 1 | 18 | **12%** |
| 北米 | 76 | 1 | 12 | **16%** |
| グローバル | 48 | 1 | 5 | 10% |
| 欧州 | 52 | 2 | 1 | 2% |
| アジア | 20 | 0 | 2 | 10% |
| オセアニア | 18 | 1 | 1 | 6% |

（出典: `radar-weekly-stats.txt`）

**読み方**: `data/research-tuning.json` の国内ラウンドには「最低4件は国内」というノルマがあるが、国内はRadar内で最大の投入量（155件）にもかかわらずゴミ箱率12%・お気に入りは1件のみ。ノルマが的外れな地域に量を割いている可能性が高い。

### 3-3. カテゴリ・タグ別（効く/効かない）

| カテゴリ | お気に入り（倍率） | ゴミ箱（倍率） |
|---|---|---|
| Data | 5（9.6倍） | 0 |
| Design | 12（3.9倍） | 0 |
| Outdoor | 11（3.5倍） | 0 |
| Innovation | 5（3.1倍） | 0 |
| Craft | 8（2.5倍） | 0 |
| Brand Experience | 10（2.4倍） | 0 |
| カルチャーインサイト | 2（0.2倍） | 7（1.3倍） |
| コンテンツ革新 | 19（1.0倍） | 18（1.6倍） |

（出典: `taste-stats.txt`）

| タグ | お気に入り（倍率） | ゴミ箱（倍率） |
|---|---|---|
| Theme/Sustainability | 14（4.0倍） | 1（0.5倍） |
| Tech/Data | 13（2.6倍） | 0（0.0倍） |
| Form/Print | 14（1.8倍） | 1（0.2倍） |
| Theme/Art | 19（1.4倍） | 4（0.5倍） |
| Tech/XR | 1（0.4倍） | 8（**5.4倍**） |
| Tech/Game | 1（0.2倍） | 16（**5.4倍**） |
| Form/App | 2（0.4倍） | 12（**4.5倍**） |
| Theme/Entertainment | 4（0.3倍） | 19（2.7倍） |
| Form/Event | 7（0.7倍） | 18（3.0倍） |

（出典: `taste-stats.txt`）

Tech/Game・Tech/XR・Form/Appは倍率5倍前後でゴミ箱に集中。逆にTheme/Sustainability・Tech/Data・Form/Printは4倍前後でお気に入りに集中しており、方向はかなりはっきりしている。

### 3-4. 受賞有無・出典ドメイン

award有: fav 39/654（6.0%）、award無: fav 29/521（5.6%）、trashは全てaward無（39/521=7.5%）。award有無自体は選別の強い決め手にはなっていない（出典: `taste-stats.txt`）。

出典ドメイン別打率（Radarに関係あるもののみ抜粋。詳細は§5）:

| ドメイン | fav | trash | DB全体件数 | 打率目安 |
|---|---|---|---|---|
| itsnicethat.com | 3 | 0 | 5 | 60% |
| dezeen.com | 2 | 0 | 6 | 33% |
| bpando.org | 2 | 0 | 4 | 50% |
| lovethework.com | 13 | 0 | 112 | 12% |
| lbbonline.com | 3 | 1 | 56 | 5% |
| advertimes.com | 1 | 3 | 20 | 5%（trashが3倍多い） |
| automaton-media.com | 0 | 6 | 34 | 0% |
| prtimes.jp | 0 | 5 | 76 | 0% |
| moguravr.com | 0 | 4 | 27 | 0% |
| roadtovr.com | 0 | 2 | 7 | 0% |
| uploadvr.com | 0 | 2 | 4 | 0% |
| bijutsutecho.com | 0 | 2 | 13 | 0% |

（出典: `taste-stats.txt`）

### 3-5. 時期の分布（要注意ポイント）

- お気に入りの時期分布: `{"2026-09":28,"2026-07":24,"2026-08":10,"1970-01":10}`（1970-01は日付未記録の古い登録データ）
- ゴミ箱の時期分布: `{"2026-08":28,"2026-09":8,"2026-07":3}`

（出典: `taste-stats.txt`）

**注意（推測）**: `radar-weekly-stats.txt`の日別内訳を見ると、ゴミ箱の記録は2026-08-09〜08-29に集中しており、9月に入ってからの新規Radar追加（9/2〜9/11、1日4〜7件ペース）はゴミ箱記録がほぼゼロで推移している。これは**「9月に入って精度が上がった」ではなく、「9月分がまだ選別・整理されていない」だけの可能性が高い**。ゴミ箱は自動では発生せず、オーナーが手動で入れる操作なので、整理のタイミングが偏ればこの分布も偏る。今回の1.6%という打率も、未整理分がすべて「trashでもfavでもない=無評価」として母数に残っているため、実態より良く見えている可能性がある（悪い方向にしか誤差が寄らない＝1.6%は上限に近い数字と考えるのが安全）。

---

## 4. 収集の仕組みの全体像

オーナーが普段見ているのはLINE通知とサイトの新着だけだが、実際には6つの経路がある。

| 経路 | 頻度 | 情報源 | 件数目標 | 却下条件 | Xの関与 |
|---|---|---|---|---|---|
| 日次 autoresearch（cases / Radar） | 毎日 | `data/research-tuning.json` の `cc.roundFoci` 3ラウンド（海外広告賞系／テック・XR・ゲーム系／国内＋アート系） | 各ラウンド5〜7件（`scripts/auto-research-cc.mjs` 265行目付近） | リンク切れ・サムネイル未検証・記事生成失敗のみ（`logs/rejections-2026-09.jsonl`） | なし |
| 日次 autoresearch（tech） | 毎日 | `data/research-tuning.json` の `tech.lanes` 4レーン（Spatial/3D、GenVideo/CreatorTools、HCI/MediaArt、Motion/Agents） | 未計測（favはtech全体で4件のみ） | 同上＋`no-primary-source`等 | **あり（補助素材）。ただし現在完全停止中**（後述） |
| 日次 idea seeds生成 | 毎日 | 外部収集ではなく内部生成。`cases.json`/`tech.json`の蓄積からサンプリング（`data/idea-tuning.json`: `caseSample:14, techSample:16, seedCount:10`） | 1回10件 | `scripts/lib/tuneup-guardrails.mjs`のガードレールのみ（生成自体の採否基準はプロンプト依存、本監査では未検証） | なし |
| 週次 tuneup | 週1回・月曜23:40 | `research-tuning.json`/`x-radar-queries.json`/`idea-tuning.json`自身の改訂案をClaude CLIが生成 | 変更量に上限あり（§6） | スキーマ＋変更量ガードレール（`tuneup-guardrails.mjs`） | 対象に含むが動かない（§5） |
| LINE add-case | ユーザーが都度指定 | ユーザー指定URL1件 | 1件 | 一次情報で受賞・事実確認ができなければ空欄のまま登録（明確な却下ログなし） | なし |
| Studio手動リサーチ | 現在は非推奨（裏側で存続のみ） | 手動 | - | - | なし |

**Xの位置づけについての重要な事実**: `data/x-radar-queries.json` のクエリ6本（ComfyUI workflow / gaussian splatting demo / SIGGRAPH github / TouchDesigner インスタレーション / AI music tool open source / メディアアート 展示 技術）は**すべてTech Radar（技術トレンド）向け**であり、事例（cases）収集にXは一切使われていない。かつ、`scripts/fetch-x-radar.mjs`は`twscrape`（X検索に使うツール）に依存しているが、このWindows機には未インストールで、2026-09-04以降ほぼ毎日 `"twscrape not found"` でitemsが空のまま出力されている（例: `researchman-x-radar-2026-09-12.json`）。**「Xを見てきている」という前提はcasesについてはそもそも成立せず、techについても現状は完全に停止している。**

---

## 5. 情報源とXクエリの監査

### 5-1. `roundFoci`の情報源を打率で3分類

| 分類 | ドメイン/情報源 | 根拠 |
|---|---|---|
| **打率あり（活かせている）** | itsnicethat.com（round1に既存、DB5件中fav3=60%） | `taste-stats.txt`。うち1件はRadar発（Runblock Brand Identity）、実績あり |
| | lbbonline.com（round1に既存、DB56件中fav3・trash1） | `taste-stats.txt` |
| **打率なし・ゴミ箱源（見直し対象）** | automaton-media.com（round2に既存、DB34件中fav0・trash6） | `taste-stats.txt` |
| | moguravr.com（round2に既存、DB27件中fav0・trash4） | 同上 |
| | roadtovr.com / uploadvr.com（round2に既存、各fav0・trash2） | 同上 |
| | prtimes.jp（round3に既存、DB76件中fav0・trash5） | 同上 |
| | bijutsutecho.com（round3に既存、DB13件中fav0・trash2） | 同上 |
| | advertimes.com（round3に既存、fav1・trash3） | 同上 |
| **未使用だがお気に入り実績あり（追加候補）** | bpando.org（roundFociに無し、DB4件中fav2=50%、User発） | `taste-stats.txt` + `favorites-full.json` |
| | dezeen.com（round2に既存だが薄い記載、DB6件中fav2=33%、いずれもUser発でRadar発の実績はまだ無い） | 同上 |

**`cc.roundFoci` round2 の情報源に明記されている4ドメイン（automaton-media.com、moguravr.com、roadtovr.com、uploadvr.com）だけで、trash 39件中14件（約36%）を占める。** この4ドメインは`research-tuning.json`の`cc.roundFoci`round2に明記されている実在の情報源であり、「ゲーム/XRニュースサイトを情報源に指定していること自体」がゴミ箱の最大の発生源になっている。

**補足（推測を含む訂正）**: `brand-innovators.com`（fav8件・4.5倍）と`lovethework.com`（fav13件・2.0倍）は打率が高いが、これは日次Radarの成果ではなく、**Cannes 2026の一括インポート時にこれらのサイトから受賞結果テーブルをまとめて取り込んだ実績**（`favorites-full.json`でこれらのfavは全て`sources:"Cannes 2026"`）。年に一度の受賞シーズン以外は同じペースで新着記事が出るサイトではないため、「roundFociに追加すれば毎日効く」情報源としては扱えない。次のP1提案では区別して記載する。

### 5-2. Xクエリの現状

`data/x-radar-queries.json`の6クエリは全てTech（技術トレンド）向けで、Case（クリエイティブ事例）向けのクエリは1本も存在しない。加えて`scripts/fetch-x-radar.mjs`が依存する`twscrape`が本機に未インストールのため、2026-09-04〜09-12の全日で`errors:["twscrape not found"]`、`items:[]`（`researchman-x-radar-2026-09-*.json`各ファイルで確認）。**Xは「Tech Radarの補助素材」としてすら現在は機能していない。**

---

## 6. なぜ週次チューンアップで直らないか

`scripts/biweekly-tuneup.mjs`は週1回（月曜23:40）、お気に入り/ゴミ箱の分布をもとに`research-tuning.json`等の改訂案をClaude CLIに作らせるが、その改訂は`scripts/lib/tuneup-guardrails.mjs`のガードレールで機械的に制限されている。

- レーン（`tech.lanes`＋`cc.roundFoci`合計）の差し替え: **1回の実行で最大2件まで**
- Xクエリの差し替え: **最大3件まで**
- サンプリング重みの変更: **最大10項目まで**
- レーン数は3〜6、クエリ数は1〜6の範囲内でなければ却下

つまり、週次チューンアップができるのは「`diversity`欄の注釈文を書き換える」「情報源リストを数件入れ替える」といった**微調整**だけである。実際、現在の`round2`の`diversity`欄には「ごみ箱率が全タグ中トップ2＝関心が低いシグナル」という注釈がすでに追加されており、チューンアップが機能していないわけではない。

しかし、以下の2点はチューンアップの対象外（プロンプト内にハードコードされた固定文言）であり、**何回チューンアップを回しても変わらない**。

1. `scripts/auto-research-cc.mjs`内の固定リスト「利用者の関心」（AI×クリエイティブ／音楽×テック／展示・インスタレーション／**XR**／**ゲーム**／ロボット・デバイス／すぐれたWeb・アプリ／映像表現／OOH・ブランド体験／ファッション・スポーツ・食×テック／**VTuber・SNS発カルチャー**）。ゴミ箱行き上位のXR・ゲーム・VTuberがそのまま残っている。
2. ノルマ「5〜7件」（見つからなくても件数を埋めようとする構造）と、国内ラウンドの「最低4件は国内」という下限。§3-2で見た通り、国内は投入量最大なのに打率最低。

これらは`buildDiscoveryPrompt`関数内に直接埋め込まれたテキストであり、`research-tuning.json`経由の外部化がされていない（ガードレールの検証対象は`research-tuning.json`/`x-radar-queries.json`/`idea-tuning.json`の3ファイルのみ）。

---

## 7. 改善提案（実装はしていません。優先順・工数目安・副作用を併記）

以下はすべて**提案**であり、ファクトと明確に区別する。

### P0: アイデアの関門を新設（最優先・工数: 中）

発見（discovery）または記事化（article生成）のいずれかの段階で、「この事例のアイデアを一文で言えるか」「告知タイプ（発売/開催/発表/買収/コンテスト）ではないか」を必須の自己判定項目としてプロンプトに追加し、言えない場合は却下する。却下理由ログに新設の`no-creative-idea`を追加し、既存の`rejections-2026-09.jsonl`同様に記録して効果測定できるようにする。

- 工数目安: プロンプト文言の追加＋却下理由の1種追加で、半日〜1日
- 副作用: 発見ラウンドの通過件数が減り、「5〜7件」ノルマが未達になる日が増える（P2の「ノルマ撤廃」とセットで行うのが望ましい）

### P1: 情報源の総入れ替え（優先度高・工数: 中）

`cc.roundFoci`を、お気に入り実績のあるドメイン中心に再構成する。

- **追加候補（海外）**: itsnicethat.com（既存だが強化）、bpando.org、creativereview.co.uk（既存だが強化）、contagious.com（既存）、adsoftheworld.com（既存）、campaignbrief.com（既存）、lovethework.com（※日常巡回向けではなく賞発表シーズンの臨時ソースとして別枠管理を推奨。§5-1の補足参照）
- **追加候補（国内）**: 宣伝会議、ブレーン、AXIS、JAGDA/TCC/ACCなどの受賞発表、PARTY・Dentsu Lab・Whateverなどの制作会社サイト
- **除外候補**: prtimes.jp（trash5・fav0）、automaton-media.com（trash6・fav0）、moguravr.com（trash4・fav0）、roadtovr.com・uploadvr.com（各trash2・fav0）、bijutsutecho.com（trash2・fav0）、natalie.mu（trash1件確認済み、fav実績なし）、gigazine.net（実績データなし・未検証）

工数目安: `research-tuning.json`の書き換えのみなのでファイル編集は数時間だが、新規ドメインの実効性は数週間の運用で検証が必要。
副作用: 除外ドメインが実は「たまたま良い事例も拾えていた」場合の機会損失（本監査ではゼロ件のため可能性は低いが、母数がまだ少ないドメインもある＝断定しすぎない）。

### P2: 「利用者の関心」リストとノルマの書き換え（優先度高・工数: 小）

- 固定リストからゲーム・VTuber・XRを除外し、§2で言語化した4類型（読み替え一手／生成的ブランドID／素材が主張するアート・プロダクト／AIが表現手段になっている仕事）に書き換える
- ノルマ「5〜7件」→「該当なければ0件でよい」に変更
- 国内ラウンドの「最低4件は国内」を撤廃

工数目安: プロンプト文言の書き換えのみで数時間。
副作用: 収集件数が日によって大きく上下する（0件の日が出てくる）。DBの新着ペースが不安定になるため、LINE通知の文面や「毎日◯件追加」という前提を持つ他の仕組み（idea seedsのサンプリング元等）への影響を確認する必要がある。

### P3: Xの扱いを決める（優先度中・工数: 小〜大、両論併記）

- **案A（復活）**: 事例収集用のXクエリを新設し、`twscrape`をこのWindows機に導入して復活させる。Cookie設定などの認証まわりの保守コストが継続的に発生する。
- **案B（廃止）**: X経路は設定から削除する。現状すでに事実上停止しており、削除しても実害はない。保守対象が1つ減る。

推奨は明記しない（両論併記）。

### P4: 測る仕組みを作る（優先度中・工数: 小〜中）

- 週次tuneupのレポートに「ドメイン別・ラウンド別のお気に入り率」を追加し、P1・P2の変更が効いているかを継続的に追えるようにする
- §3-5で指摘した「整理されないとシグナルが増えない」問題への軽い対策案: LINEで前日追加分のタイトル一覧を送り、「残す/捨てる」で即答できるようにする（現状は溜まってからまとめて選別するため、直近の傾向が数字に反映されるまでに時間がかかる）

---

## 8. 付録

### 8-1. お気に入り68件一覧（case種別、日付順）

| 日付 | sources | タイトル | クライアント |
|---|---|---|---|
| 1970-01-01 | Cannes 2026 | DELIVERED BY TETRIS | La Poste |
| 1970-01-01 | Cannes 2026 | FIELD BARCODE（Mercado Livre） | Mercado Livre |
| 1970-01-01 | Cannes 2026 | Firecatchers | Sapeurs Pompiers de France |
| 1970-01-01 | Cannes 2026 | Let It Fly | Saudia Airlines |
| 1970-01-01 | Cannes 2026 | Reverse Media Schedules | Sea Cleaners & JCDecaux |
| 1970-01-01 | Cannes 2026 | Sleep Talk Reviews | IKEA |
| 1970-01-01 | Cannes 2026 | The HEINZ Dipper | Heinz |
| 1970-01-01 | Cannes 2026 | The KitKat Heist | KitKat (Nestlé) |
| 1970-01-01 | Cannes 2026 | The Password Heist | Leroy Merlin |
| 1970-01-01 | Cannes 2026 | Tocayos | Heineken |
| 2026-07-14 | Radar | BIG DEW INSTALLATION ~Ripple-Reply~ | DEW（VITRO合同会社）× TUTTI INDUSTRIES |
| 2026-07-21 | Floating | Project Loon | Google X（Alphabet） |
| 2026-07-21 | Floating | 雲プロジェクト | ダイキン工業 |
| 2026-07-22 | User | 水跡 - traces of energy - | 下山芸術の森発電所美術館 |
| 2026-07-25 | User | Antibiotic Resistance Quilt | Anna Dumitriu |
| 2026-07-25 | User | Aol. Brand Identity | AOL |
| 2026-07-25 | User | Centersquare Brand Identity | Centersquare |
| 2026-07-25 | User | EDP Brand Identity | EDP (Energias de Portugal) |
| 2026-07-25 | User | Evolving the Google Identity | Google |
| 2026-07-25 | User | Giant Triple Mushroom | Carsten Höller |
| 2026-07-25 | User | In the Eyes of the Animal | Abandon Normal Devices |
| 2026-07-25 | User | MullenLowe Global Rebrand | MullenLowe |
| 2026-07-25 | User | Oi Responsive Logo | Oi |
| 2026-07-25 | User | Orquestra Sinfônica (OSESP) identity | OSESP |
| 2026-07-25 | User | Patreon Reimagined | Patreon |
| 2026-07-25 | User | Philharmonie Luxembourg Identity | Philharmonie Luxembourg |
| 2026-07-25 | User | Reimagining Our Global Brand with Generative AI | Deloitte Digital |
| 2026-07-25 | User | San Francisco Symphony Dynamic Typography | San Francisco Symphony |
| 2026-07-25 | User | The Norwegian Academy of Music Brand Identity | Norwegian Academy of Music |
| 2026-07-25 | User | Visit Nordkyn: Where Nature Rules | Visit Nordkyn |
| 2026-07-25 | User | Whitney Museum Graphic Identity | Whitney Museum of American Art |
| 2026-08-07 | User | 765×961 IDOL ULTIMATE ONCE AND FOR ALL | アイドルマスター |
| 2026-08-07 | User | Changemakers | Genea |
| 2026-08-07 | User | Food Scraps | Mousoudi Pet Shop |
| 2026-08-12 | Radar | Runblock Brand Identity | Runblock |
| 2026-08-16 | Cannes 2026 | Lucky Fan Index | Wisła Kraków Football Club |
| 2026-08-18 | Radar | The Last House Billboard Stunt | Netflix |
| 2026-08-22 | Radar | Curious Matters | 三菱ケミカル |
| 2026-08-25 | User | ピュアー / 初音ミク MV | Saku（feat. 初音ミク） |
| 2026-08-28 | User | QT Home Bun Race | QuikTrip |
| 2026-09-08 | Cannes 2026 | Amazonia | Embratur |
| 2026-09-08 | Cannes 2026 | Amazônia Alive – Book | Vale SA |
| 2026-09-08 | Cannes 2026 | Dancebook Brasil | Bradesco |
| 2026-09-08 | Cannes 2026 | DuoBell | Škoda |
| 2026-09-08 | Cannes 2026 | Forests Without Names | Hyundai |
| 2026-09-08 | Cannes 2026 | Gig / Wedding / Bowling | McDonald's |
| 2026-09-08 | Cannes 2026 | Is that a Pinntorp? | IKEA AlSulaiman |
| 2026-09-08 | Cannes 2026 | KitKat Security Detail | KitKat |
| 2026-09-08 | Cannes 2026 | L'Ultimo Uomo Reale | The RealReal |
| 2026-09-08 | Cannes 2026 | MAGNIF-EYE | 1001 Optometry |
| 2026-09-08 | Cannes 2026 | Marseille C'est Nous | Puma × Olympique de Marseille |
| 2026-09-08 | Cannes 2026 | Moving Landscapes | BMW |
| 2026-09-08 | Cannes 2026 | Protest March of the Penguins | Penguins International |
| 2026-09-08 | Cannes 2026 | Resize The Price | Águila |
| 2026-09-08 | Cannes 2026 | Rooftop Revival | Heineken |
| 2026-09-08 | Cannes 2026 | Searching for Birds on Wires | Abradee |
| 2026-09-08 | Cannes 2026 | Steph Curry Shoots the Moon | Random House Publishing Group |
| 2026-09-08 | Cannes 2026 | T-REX LEATHER | Lab-Grown Leather Ltd |
| 2026-09-08 | Cannes 2026 | The Birdwatcher（Spoor） | Spoor |
| 2026-09-08 | Cannes 2026 | The Safe Pack | TuPharma 365 |
| 2026-09-08 | Cannes 2026 | Tiny Coffee Shops | De'Longhi |
| 2026-09-08 | Cannes 2026 | Vision Pulse: Sight Beyond Seeing | Hyundai |
| 2026-09-08 | Cannes 2026 | WiFi Invasion | WAOO |
| 2026-09-08 | Cannes 2026 | Your Way Out | Coinbase |
| 2026-09-08 | Cannes 2026 | Zip Code Exam | Equality Health Foundation |
| 2026-09-08 | Radar | AI for Growth（Dentsuマニフェストフィルム） | Dentsu |
| 2026-09-08 | Radar | An Impossible Life | Sea Turtle Foundation |
| 2026-09-08 | User | プレスマ | 那須ハイランドパーク |

（出典: `favorites-full.json`。tech種別4件は別項）

### 8-2. ゴミ箱39件一覧（日付順）

| 日付 | 地域 | タイトル | クライアント |
|---|---|---|---|
| 2026-07-27 | 国内 | JAGDAデザイン会議2026「Graphic Design Now」 | 日本グラフィックデザイン協会 |
| 2026-07-27 | 国内 | VketReal 2026 Summer | HIKKY |
| 2026-07-27 | 国内 | REK TOKYO 2026 | REK |
| 2026-08-12 | 国内 | 美術部カノジョ -Girlfailure Art Club- | ARTODRIA |
| 2026-08-12 | 国内 | 近江八幡・安土サウンドトリップ | アインズ株式会社 |
| 2026-08-12 | グローバル | Virtual Desktop USB有線ストリーミング対応 | Virtual Desktop |
| 2026-08-12 | 国内 | ウラロジゲームカンパニー 渋谷屋外広告展開 | ウラロジゲームカンパニー |
| 2026-08-12 | 国内 | Chilla's Art「Snowed Under」 | Chilla's Art |
| 2026-08-12 | グローバル | ゼルダの伝説 非公式VR MOD | 有志VR MOD開発コミュニティ |
| 2026-08-12 | 北米 | KitBash、ArtStation/Sketchfab買収 | KitBash (KitBash3D) |
| 2026-08-18 | 北米 | Serious Sam: Shatterverse | Croteam / Behaviour Interactive |
| 2026-08-18 | 北米 | OpenAI、NextSlideを買収 | OpenAI / NextSlide |
| 2026-08-18 | 国内 | Console Archives 闘機伝承 Angel Eyes | （アーケードアーカイブス系レーベル） |
| 2026-08-18 | 国内 | 浅間国際フォトフェスティバル2026 | 株式会社The Chain Museum |
| 2026-08-18 | 北米 | Made by Google 2026 | Google |
| 2026-08-18 | 北米 | VR Games Showcase (August 2026) | VR Games Showcase / Flat2VR Studios |
| 2026-08-18 | 国内 | てとて、ONE Health 芸術祭2026 | NPO法人 手と手の森 |
| 2026-08-18 | 国内 | ゼミ展2026 | 東京ミッドタウン・デザインハブ |
| 2026-08-18 | 国内 | 「リシンク –舘鼻則孝と手しごと– 展」 | 舘鼻則孝 |
| 2026-08-18 | 国内 | MARY完全版 | 夜路地（個人開発者） |
| 2026-08-18 | 北米 | Out of Office! | besszong.（George Greer） |
| 2026-08-18 | グローバル | Gunman Contracts Stand Alone | 未公表デベロッパー |
| 2026-08-18 | 国内 | The Knights of Fiona オープンベータ | CharacterBank |
| 2026-08-18 | 北米 | Kingdom Hearts アニメシリーズ | Disney / Square Enix |
| 2026-08-18 | 北米 | Battle Beyond The Wall | Globiss Interactive |
| 2026-08-18 | グローバル | TCG Card Shop Simulator | OPNeon Games |
| 2026-08-18 | 国内 | 原神 コミックマーケット108出展 | COGNOSPHERE |
| 2026-08-18 | 国内 | 「戦争と平和」紙面×書店展開 | 朝日新聞社 |
| 2026-08-18 | 欧州 | FEED IT | Games On A Chair |
| 2026-08-18 | グローバル | キングダム ハーツIV発売決定 | Square Enix |
| 2026-08-25 | 北米 | Homesickness and Loss in Sound | Layan Srour |
| 2026-09-01 | 北米 | The Saga of Rex（初トレーラー公開） | Michel Gagné |
| 2026-09-01 | 国内 | 「ヴィヴァーチェ」ミュージックビデオ | ポルノグラフィティ |
| 2026-09-01 | アジア | The Real Finds The One | Tinder Thailand |
| 2026-09-01 | 北米 | Adathon — AI Ad Creation Contest | Higgsfield AI |
| 2026-09-01 | アジア | MAD STARS 2026 | MAD STARS |
| 2026-09-01 | オセアニア | This Is Warehouse Country | The Warehouse |
| 2026-09-01 | 北米 | 猪熊弦一郎個展開催発表 | ジャパン・ソサエティー |
| 2026-09-01 | 国内 | AI博覧会 Summer 2026 | 株式会社アイスマイリー |

（出典: `trash-full.json`全39件。全件sources="Radar"）

---

## 出典ファイル一覧

- `taste-stats.txt`（お気に入り68件/ゴミ箱39件のDB全体に対する偏り集計）
- `radar-weekly-stats.txt`（Radar直近10週・377件の週別・地域別打率）
- `favorites-full.json` / `trash-full.json`（お気に入り・ゴミ箱の全件記録）
- `radar-added.json`（直近10週の自動追加377件とfav/trashフラグ）
- `scripts/auto-research-cc.mjs`（発見プロンプト260〜330行目付近）
- `data/research-tuning.json`（`cc.roundFoci`3ラウンド、`tech.lanes`4レーン）
- `data/x-radar-queries.json`（Xクエリ6本）
- `data/idea-tuning.json`（idea seeds生成パラメータ）
- `scripts/fetch-x-radar.mjs`、`researchman-x-radar-2026-09-*.json`（`$TEMP`配下、twscrape未導入で全日停止確認）
- `scripts/biweekly-tuneup.mjs`、`scripts/lib/tuneup-guardrails.mjs`（週次チューンアップの変更量上限）
- `logs/rejections-2026-09.jsonl`（却下理由の実例11件）
