# ResearchMan 運用引き継ぎ資料

> 対象読者: 今後このプロジェクトを運用・保守する人間および AI エージェント（Sonnet / Opus セッション）。
> 2026-07-03 時点の構成。変更したらこのファイルも更新すること。

## 1. システム概要

広告・クリエイティブ事例のギャラリーサイト。Next.js（App Router / SSG）+ Vercel。
データは `data/cases.json` の単一 JSON（DB なし）。サムネイルは `public/thumbnails/` にローカル永続保存（外部 CDN 非依存）。

- 本番: https://research-man.vercel.app （GitHub `main` への push で自動デプロイ）
- 事例ソース: award（受賞作）/ order（発注実績）/ radar（自動収集）。`sources` フィールドで区別
- タグ体系: `data/tag-vocabulary.json`（Tech / Form / Theme の3軸。自動収集はこの語彙外のタグを捨てる）

### Technology タブ（2026-07-03新設）

Case Study と並ぶ第2のTOP（`/technology`）。AI/HCI/CG/先端メディア技術の研究・プロトタイプ・ツールを収集。
- 仕様の単一ソース: **`TECHNOLOGY_SPEC.md`**（クライテリア・メディアリスト・運用フロー）
- データ: `data/tech.json` + `data/tech-tag-vocabulary.json`（Domain 7種 × Type 3種）。cases.json と完全分離
- サムネイル: `public/thumbnails/tech/`（既存のサムネイル監査の対象外）
- 取り込み: ユーザーのXブックマーク（`data/inbox/x-bookmarks-*.txt`）→ 調査 →
  `scripts/build-tech-from-research.mjs`（一次ソース死活・Case Study重複・サムネ下限を機械検証）
- **日次自動収集（Step 1）: 2026-07-03稼働開始**。launchd `com.researchman.techresearch`
  （**毎朝10時**・10〜23時の毎正時にキャッチアップ判定、状態: `.last-tech-research-run.txt`、
  ログ: `~/Library/Logs/researchman-tech.log`）
  - 流れ: `auto-research-tech.mjs`（Tier1ソースを4レーン日替わり巡回・日次3件上限）
    → `build-tech-from-research.mjs`（機械検証）→ commit/push → `verify-deploy.mjs`
    → `verify-tech-pages.mjs`（新規 /technology/{id} が200になるまでポーリング）→ LINE通知
  - Case Study側と同時発火してもgit競合しないよう `/tmp/researchman-git.lock` で排他
  - 通知サマリー: `/tmp/researchman-tech-last-add.json`（0件でも上書き=stale防止）

### お気に入りサーバ同期（2026-07-08新設・実装計画バッチ1）

Case Study / Technology の★お気に入りを Vercel Blob（private）に同期し、PC/スマホ間で共有する。
将来の隔週チューンアップ（お気に入り分析→リサーチ計画ブラッシュアップ、バッチ2予定）が
参照するデータ基盤としても使う。

- API: `src/app/api/favorites/route.ts`
  - `POST /api/favorites`（認証なし・破壊不能なマージのみ。全消去APIは無い）: body
    `{ items: { [id]: { fav: boolean, ts: number } } }` を検証（id形式=cases.json/tech.jsonの
    実例パターン`^[a-z0-9]+(-[a-z0-9]+)*$`・件数上限2000・型）後、サーバ側の既存itemsと
    per-id LWW（Last-Write-Wins。tsが新しい方を採用）でマージしてBlobへ書き戻し、
    マージ結果の全量を返す
  - `GET /api/favorites`（`Authorization: Bearer <FAVORITES_SYNC_TOKEN>` 必須。分析ジョブ専用）:
    フルitemsを返す
  - **Blob未設定（`BLOB_READ_WRITE_TOKEN`欠落）時は常に503**。クライアント
    (`src/hooks/useFavorites.ts`)はこれを黙ってlocalStorageのみで動作継続するシグナルとして扱う
    （env未設定でもサイトは現状と同一挙動で壊れない）
  - 検証（400）は Blob設定確認（503）より**先に**行う設計。これによりBLOB_READ_WRITE_TOKEN
    未設定のローカル環境でも検証ロジック（400系）をcurlで確認できる
- データモデル: `data/`配下ではなくBlob上の1ファイル（固定pathname `favorites/favorites.json`）。
  `{ version: 1, items: { [id]: { fav: boolean, ts: number } } }`。解除も`fav:false`と新しい`ts`を
  持つエントリとして残す（tombstone方式）。**自動的な古いエントリの削除・全消去APIは無い**
- クライアント側(`useFavorites.ts`): 旧形式(`string[]`)を`fav:true`・
  `ts:読み込み時刻`として自動マイグレーション。toggle時に楽観更新＋1.5秒デバウンスでPOSTし、
  レスポンス（サーバ側マージ済みの全量items）を再度LWWマージしてlocalStorageへ反映する
  （＝実質的な双方向同期）。**マウント時にGETはしない**（tokenをクライアントに置かないため）。
  オフライン・503・エラー時は例外を握りつぶしlocalStorageのみで継続する
- **既知の制約**: マウント時にGETしないため、ある端末で初めて開いた時点では他端末の
  お気に入りはまだ反映されない。何かひとつでもtoggleすると、そのPOSTレスポンスで
  全量マージ結果が反映され追いつく

**初回セットアップ（ユーザー作業・未実施の間はlocalStorageのみで動作）**:
1. [Vercelダッシュボード](https://vercel.com/dashboard) → 本プロジェクト → Storage →
   Create Database → **Blob** → 作成（例: `research-man-favorites`）→ プロジェクトへConnect
   （Connectすると `BLOB_READ_WRITE_TOKEN` が自動でenvに追加される）
2. Settings → Environment Variables → `FAVORITES_SYNC_TOKEN` を追加（値は任意のランダム文字列。
   例: `openssl rand -hex 32` で生成）。Production/Preview両方に設定推奨
3. 環境変数追加はデプロイ済みビルドに自動反映されないため、**再デプロイ**する
   （空コミットpushでも、Vercelダッシュボードの Redeploy でも可）
4. 動作確認:
   - サイトで★をトグル → ブラウザDevToolsのNetworkタブで `POST /api/favorites` が
     200を返す（503のままならenv未反映。再デプロイ漏れを疑う）
   - `curl -H "Authorization: Bearer <FAVORITES_SYNC_TOKEN>" https://research-man.vercel.app/api/favorites`
     でフルitemsのJSONが返ることを確認（401なら`FAVORITES_SYNC_TOKEN`不一致、503なら
     `FAVORITES_SYNC_TOKEN`または`BLOB_READ_WRITE_TOKEN`のいずれかが未設定）
- 検証スクリプト: `scripts/smoke-favorites-merge.mjs`（マージ/検証ロジックの単体検証・
  Blob不要）・`scripts/smoke-favorites-api.mjs`（`next dev`起動中に実行。400/503/401等の
  検証。実Blobでの200成功パスはローカルでは検証できないため上記4の手動確認に委ねる）・
  `scripts/smoke-favorites-ui.mjs`（Playwright。★トグル・Savedフィルタ・リロード永続・
  旧形式マイグレーション・サーバ応答マージのUI回帰。`PORT=3111`で`next dev`起動中に実行）

## 2. 自動収集パイプライン（無人運用の本体）

```
launchd (10〜23時の毎正時 + ログイン時)
  └─ run-if-due.mjs --daily-at 10 … 本日10時経過かつ本日分未実行なら exit 0（=1日1回）
       └─ auto-research-cc.mjs … Claude CLI で新事例を発見→検証→記事化（最大3ラウンド）
            └─ self-heal-thumbnails.mjs … 全サムネイルの健全性チェック・自動修復
                 └─ git commit & push    … data/cases.json と public/thumbnails/（tech除く）
                      └─ verify-deploy.mjs … 本番反映を最大360秒ポーリングで確認
                           └─ send-mail.mjs / notify-line.mjs … 結果種別つきで毎回通知
```

- plist: `launchd/com.researchman.autoresearch.plist`（リポジトリ版が原本。インストール先は `~/Library/LaunchAgents/`。**両方を常に一致させる**。反映は `launchctl unload` → `load`）
- **両パイプラインとも毎朝10時実行**（2026-07-03に72h/23h周期から変更）。カレンダー起動を
  10〜23時の毎正時に張り、`--daily-at`ゲートが1日1回を保証。10時にPCが落ちていても
  同日中の次の正時でキャッチアップ。収集エラー時は`--mark`で本日分を消化扱いにし連打を防ぐ
- 通知は全終端経路で送る: 成功/0件/反映未確認(unverified)/push失敗(pushfail)/収集エラー(error)
- 収集の内部モデルは **sonnet 固定**（`auto-research-cc.mjs` の `MODEL`。上位モデルは遅くてタイムアウトしやすい）
- 品質ゲート: リンク死活 → 検証済みサムネイル取得（oEmbed タイトル照合）→ 記事生成、の順に通過したものだけ採用。どこかで落ちたら孤立サムネイルも掃除して却下
- **収集ペースは現状維持**（`TARGET_NEW=5` / `MAX_ADD=10`。2026-07-04、RM総点検時にユーザー決定。
  変更しない）

### 状態ファイル・ログ

| パス | 役割 | 注意 |
|---|---|---|
| `.last-research-run.txt` / `.last-tech-research-run.txt` / `.last-idea-seeds-run.txt`（リポジトリ直下・gitignored） | 前回実行時刻。毎朝10時ゲートの判定材料 | 消すと次の正時に即実行される（手動トリガとして使える） |
| `/tmp/researchman-last-add.json` / `/tmp/researchman-tech-last-add.json` | 直近実行の追加事例サマリー。通知の本文ソース | 0件の回も必ず上書きされる（stale 再通知防止。2026-07-03 修正） |
| `/tmp/researchman-idea-seeds.txt` | 生成済みアイデアの種の本文。notify-lineが送信 | 毎回上書き。実行後すぐ配信されるため長期保持しない |
| `/tmp/researchman-tech-candidates-*.json` | tech日次収集の候補（検証前・検証で脱落した分の調査用） | 14日超で自動削除（2026-07-04追加）。os.tmpdir()ではなく`/tmp`直書き（macOSの`$TMPDIR`≠`/tmp`問題を回避） |
| `~/.researchman-idea-history.json`（ホーム直下・リポジトリ外） | 直近60個の種の履歴（重複回避用プロンプト材料） | バックアップ対象外で消えても実害は直近の重複回避が効かなくなるだけ（自然回復）。移設はしない |
| `~/Library/Logs/researchman-auto.log` / `-tech.log` / `-ideas.log` | パイプライン全ログ | 期限前スキップ（exit 3）はログを出さない仕様。**0バイトでも異常ではない**。5MB超で`.log.1`へ自動ローテ（2026-07-04追加） |
| `~/Library/Logs/researchman-auto-error.log` 等 | launchd の stderr | 通常は空 |

### 通知設定（ホーム直下・リポジトリに置かない）

| ファイル | 状態 (2026-07-03) | 形式 |
|---|---|---|
| `~/.researchman-line.json` | **設定済み** | `{ "channelAccessToken": "..." }` で broadcast。`"to": "Uxxx"` を足すと push |
| `~/.researchman-mail.json` | **未設定**（通知は静かにスキップされる） | `send-mail.mjs` 冒頭コメント参照 |

通知は「おまけ」設計: 設定不備・送信失敗でも本体（収集・反映）を巻き込まず常に exit 0。

**0件の日も通知する**（2026-07-03〜）: 両パイプラインとも「変更なし」の回はLINEで
「本日の新規追加なし（収集は正常実行）」を送る。無音=障害か0件か区別できない問題の解消。
サマリーが6時間より古い場合は0件として扱う（収集クラッシュ時に旧事例を再通知しない鮮度ガード）。

### アイデアの種（毎朝10時の第3ジョブ・2026-07-03新設）

launchd `com.researchman.ideaseeds` が毎朝10時、Case Study（企画性）× Technology（技術）の
掛け合わせで「アイデアの種」10個をLINE配信する。
- `scripts/generate-idea-seeds.mjs`: 事例14件+技術12件を毎日ランダムサンプリングし、
  Claude CLI（sonnet）が「技術×技術 / 文脈×技術 / 転用」の3パターン混合で生成
- **各種に参照事例・技術の平易な解説（高校生でもわかる1文）とRMページURLを付記**（2026-07-03）。
  参照idは cases.json/tech.json と機械照合し、実在しないidのURLは出さない（誤リンク防止）。
  同一refが複数の種に出たら2回目以降はURL行のみ（解説の重複回避）
- 重複回避: 直近60個の種を `~/.researchman-idea-history.json` に保持しプロンプトで回避
- 配信: `notify-line.mjs --text-file /tmp/researchman-idea-seeds.txt`（本文そのまま送信モード）。
  ref付きで本文が長くなるため、4,800字超は空行境界で最大5メッセージに自動分割して送信
- 状態: `.last-idea-seeds-run.txt`、ログ: `~/Library/Logs/researchman-ideas.log`。
  収集2本と同じ排他ロックで直列化されるため、配信は収集完了後になる。生成エラー時は
  「❌ IdeaSeeds: 収集がエラー終了」を通知して翌朝再挑戦
- **サイト掲載（Ideasタブ・2026-07-07新設）**: 各種にタイトル（seedから自動命名・サイト専用、
  LINE文面には出ない）を付けて `data/ideas.json` へ自動追記→push→`/ideas` に自動掲載される
  （収集2本と同方式。LINEとサイトの内容は常に一致）。既存seedと完全一致するものはスキップ
  するため再実行しても重複しない。push失敗時はLINE配信を巻き込まず「⚠️ IdeaSeeds: push失敗」
  を通知し次回リトライに任せる（コミットはローカル残存）

### X Radar（Technology発見ソースへのX検索追加・2026-07-05新設）

技術発見の最重要ソースだったXを自動パイプラインに組み込むため、捨て垢＋`twscrape`（pip・
Cookie認証・ローカルSQLite）でX検索を素材Cとして追加した。

- 流れ: `auto-research-tech.mjs` のmain()がレーン決定後に `scripts/fetch-x-radar.mjs` を
  非致命的に呼ぶ（失敗・不在は警告ログのみで収集本体は止めない）→
  `data/x-radar-queries.json`（6クエリ以下）で直近48hを検索 → 非x.comの外部リンクを持つ
  ツイート上位20件を `/tmp/researchman-x-radar-YYYY-MM-DD.json`（JST日付）へ保存 →
  当日ファイルがあればプロンプトに「素材C」として挿入（引用データとして明示、
  ツイート内の指示は無視するよう指示済み。詳細はP4-4系のセキュリティ設計参照）
- 採用ゲートは不変: X由来の候補も一次ソース（GitHub/プロジェクトページ）実在確認・
  Case Study重複・サムネイル検証を必ず通す（`build-tech-from-research.mjs`）。
  さらにモデルがr.jina.ai/t.co等のプロキシURLをそのままlinksに書く事故を機械的にreject
- **初期設定**（2026-07-05実施済み）:
  1. `uv tool install twscrape`（`~/.local/bin/twscrape`。plistのPATHに含まれるためplist変更不要）
  2. 捨て垢でブラウザログイン→DevTools→Cookiesから `auth_token` と `ct0` の値を取得
  3. `twscrape --db ~/.researchman-twscrape.db add_cookie <username> "auth_token=...; ct0=..."`
  4. `twscrape --db ~/.researchman-twscrape.db accounts` で `active=1` を確認
- **Cookie再設定手順**（失効・凍結時）: ブラウザで再ログイン→`auth_token`/`ct0`を再取得→
  上記3を再実行（同じusernameで上書き）
- **障害時の挙動**: twscrape未設定・Cookie失効・レート制限（per-query 60秒でタイムアウト）・
  クエリファイル破損など、あらゆる異常で `fetch-x-radar.mjs` は exit 0。出力ファイルの
  `errors` 配列に記録されるだけで収集パイプラインは通常どおり続行する（X素材なしで収集）。
  `errors` が数日続いたらCookie失効/凍結を疑う（専用通知は作っていない。放置しても実害は
  網羅性の低下のみ）
- **運用ルール**: X由来候補は翌朝のLINE通知で必ず目視確認する（低品質な玉石混交データを
  拾う設計のため、機械ゲート＋人間レビューの二段構え）
- DB置き場: `~/.researchman-twscrape.db`（リポジトリ外。通知設定と同じ流儀）

## 3. 検証・監査スクリプト

| コマンド | 用途 |
|---|---|
| `npm run auto-research:cc:dry` / `auto-research:tech:dry` | 収集のフルテスト。データ更新なし・スケジュール消費なし・サムネイル自動掃除 |
| `npm run ideas:dry` | アイデアの種のフルテスト。履歴・状態を消費しない |
| `npm run self-heal` | サムネイル健全性チェック＋修復（`--dry-run` 可） |
| `npm run audit:integrity` | 全事例の機械検証（サムネ/videoId/リンク/テキスト）。`--out report.json` 可 |
| `npm run verify:deploy` | HEAD が本番に反映されたか確認（最大360秒） |
| `cat logs/rejections-YYYY-MM.jsonl` | 却下候補ログ（2026-07-04新設・gitignored）。収集パイプラインが採用しなかった候補の理由を月次蓄積。`jq -s 'group_by(.reason)\|map({reason:.[0].reason,n:length})' logs/rejections-2026-07.jsonl` で理由別集計。link-dead/thumbnail-unavailableが急増したら収集元の劣化を疑う |
| `npm run audit:cannes` / `audit:cannes:strict` | Cannes網羅監査。`:strict`はレベル不一致・余分事例のWARNもexit 1にする |
| `npm run audit:tech` | Technology（tech.json）のフィールド/語彙/サムネイル整合検査 |
| `npm run thumbs:graph` | 事例・技術の追加やサムネ差し替え後に実行。TOPページ/Technologyページ3Dグラフ用の縮小サムネ（Case: `public/thumbnails-graph/`、Tech: `public/thumbnails-graph/tech/`、いずれも256px・q60）を差分生成する（冪等）。未生成でも3D表示はフル解像度サムネにフォールバックするが転送量が増える |

`npm run audit:cannes` / `audit:thumbnails` / `audit:tech` は**pre-push hook で自動実行**（既定モード）。
失敗すると push が中止される。hook原本は `scripts/hooks/pre-push`（git管理下）。実際に効くのは
`.git/hooks/pre-push`（git管理外）なので、hookを変更したら必ず
`cp scripts/hooks/pre-push .git/hooks/pre-push` で反映すること。

## 4. 過去に踏んだ重大バグと再発防止ルール

### settle パターン（http 処理の絶対ルール）

`req.destroy()` は req の `'error'`（ECONNRESET）を発火させる。データ受信中など**非同期の位置**で
destroy すると、error 側の `resolve(null)` が正常系より先に走り「生きているリンクを死と誤判定」
「60KB 超ページで og:image 全滅」という実バグを踏んだ（2026-07 に根絶済み）。

このリポジトリで http を Promise ラップするときの必須形:

```js
let settled = false;
const settle = (v) => { if (settled) return; settled = true; resolve(v); };
// 1. 打ち切るときは 必ず「先に settle、後で destroy」
// 2. res には end だけでなく close / error でも settle する
//    （close がないと異常切断で Promise が永久未解決 → プロセスがイベントループ枯渇で静死）
// 3. リダイレクトは 3xx 全体 (301/302/303/307/308) を追跡し、追跡前に res.resume() する
```

準拠済み: `save-thumbnail.mjs` / `verify-video.mjs` / `audit-integrity.mjs` / `verify-deploy.mjs` /
`notify-line.mjs` / `self-heal-thumbnails.mjs` / `ensure-thumbnails.mjs`。
**新しい http 処理を書くときは verify-video.mjs の `httpGet` を写経すること。**

### その他の教訓

- **dry-run がスケジュールを消費しない**こと（`saveLastRunDate` は `!DRY_RUN` ガード必須）
- 発見プロンプトには**全既存タイトル**を渡す（直近30件だけ渡すと既出の有名事例を再提案し全滅する）。
  600件超では「直近400＋ランダム200」にサンプリングして肥大化を防ぐ（`scripts/lib/existing-titles.mjs`。
  2026-07-04追加。ただし機械照合=existingIds/existingTitleKeysは常に全件で行い重複はここでは削らない）
- 「ytimg が 200」だけではサムネ検証にならない。**必ず oEmbed でタイトルを取り事例と照合**（`verify-video.mjs` を共用）
- macOS に `timeout` コマンドは無い（GNU coreutils）。シェルで使わない
- **`main()` をトップレベルで即実行するスクリプト（auto-research-cc.mjs等）を `import()` しない**こと。
  中の関数を単体テストしたくて `import("./auto-research-cc.mjs")` すると、そのままClaude CLI発見
  フェーズが本番同様に起動してしまう（`--dry-run` はargv判定なのでimportには効かない）。
  2026-07-04に実際に発生（幸いcases.json書き込み前に停止でき実害なし）。単体テストしたい関数は
  `scripts/lib/` に切り出し、そちらだけをimportする

### Jina Readerフォールバック（2026-07-05追加）

`verify-video.mjs` の `isUrlAlive` / `audit-integrity.mjs` のlink死活検査、および
`factcheck-tech.mjs` / `auto-research-tech.mjs` のプロンプトに、bot対策サイト
（olympics.com等）による誤検知・検証不能を減らすフォールバックを追加した。

- **発火条件**: 直接アクセスが**完全に到達不能**（`!res`）だった場合のみ。404/410/5xxは
  直接判定を信頼しJinaは使わない（Jinaはターゲットのエラーページも200+本文で返すため、
  誤って死んだリンクを生かさないようにするための制約）
- **判定式**: `https://r.jina.ai/<URL>` の応答が `status===200 && body>=300字 && "Warning: Target
  URL returned error 404/410/5xx" を含まない` こと（`jinaSaysAlive()`）。実測: DNS解決不能は
  Jinaが400を返す（誤救済しない）／404ページはJinaが200を返すがWarning行で検出可能
- **無料・無キー**: 20リクエスト/分制限。フォールバック専用（1日数回）なので実用上問題なし
- **多層防御**: モデルが `r.jina.ai`/`t.co` のURLをそのまま候補linksに書いてしまう事故に備え、
  `build-tech-from-research.mjs` が機械的にrejectする（プロンプト指示だけに頼らない）
- **入れていない箇所**: `httpGet`内部（oEmbed JSONがmarkdown化されて壊れる）、サムネイル取得系
  （`save-thumbnail.mjs`/`tech-thumbs.mjs`。Jinaは画像バイナリを返せない）、`auto-research-cc.mjs`
  （`allowedTools: "WebSearch"`のみでWebFetch権限が無く、指示を入れても実効性が無いため）

## 5. audit-integrity の結果の読み方（誤検知に注意）

2026-07-03 のフル実行: 455件中 問題23件（videoId-mismatch 19 / link-dead 2 / thumbnail-dup 1）。
ただし大半は誤検知気味なので、**修正前に必ず個別確認**すること:

- `videoId-mismatch`: タイトル表記揺れで正しい動画も flag される
  （例: 事例「#LIKEAGIRL」 vs 動画「Always #Like a Girl」→ 正しい対応）。機械判定は「疑い」であって確定ではない
- `link-dead`: 並列度8のプール実行だと同時アクセスでタイムアウトが揺れ、**実行ごとに件数が大きく変動する**
  （15件→2件を観測）。疑わしい URL は直列で `isUrlAlive` を再実行して確認する。
  `olympics.com` は bot ブロックで常に false になる既知の誤検知
- 精度を上げたい場合は並列度を下げる or リトライを足す（未対応の改善余地）

### sources欠落について（2026-07-04確認）

cases.json 454件中164件が `sources` なし。**これは仕様**（初期アーカイブのレガシーデータ）。
Cannes 2026分290件はsourcesすべて付与済みで欠落ゼロ（機械的な補完対象は無い）。
詳細は `src/lib/researchSources.ts` のコメント参照。

### アワードデータの鉄則（2026-07-05・Cannes 2026レベル誤り13件の教訓）

Digital Craft部門ページで公式と異なる受賞レベルが表示される問題を全部門調査したところ、
表示バグ（部門ページが全体最高賞を表示していた。C1で修正済み）に加え、cases.json自体の
レベル誤りが5件、参照リスト側の欠落が十数件見つかった。共通原因は**受賞レベルの根拠が
トレード記事（伝聞・要約）止まりで、公式の受賞者一覧まで遡っていなかった**こと。

- 受賞事実（アワード名・部門・レベル・年）は**公式の受賞者一覧または公式プレスリリースでのみ確定**する。
  トレード記事（Campaign/LBB/adobo等）は発見のきっかけとして使ってよいが、レベルの根拠にしない
- 1作品が同一部門で複数レベル受賞しうる前提で扱う（小分類違いのGold+Silver等は珍しくない）。
  参照リストを構築する際、category+titleで重複除去するとこの複数受賞が構造的に消える
  （旧v1の欠落の主因）。除去せず個別レベルを保持する
- 新アワードの一括収集時は「参照リスト構築→cases.json執筆→award-verifierで一次照合」の
  順を守り、参照リストには**部門ごとのsourceUrl**を必ず残す（後から検証しやすくするため）
- 部門ページのバッジ・ソートは`getAwardLevelForCollection`（`src/lib/awards.ts`）が
  「その部門でのレベル」を自動計算する。通常ギャラリー（トップページ）は従来どおり
  全体最高賞を表示する仕様（意図的な差異であり統一しない）
- `.claude/agents/award-verifier` が受賞事実の一次照合の標準フロー。新アワード一括収集時や
  既存データの疑義確認時はこのエージェントに委任する（WebSearch/WebFetchで
  lovethework等の公式DBを確認し、確認済み/未検証/誤りの3値で返す設計）

### cannes2026-winners-v2.json（参照リスト・2026-07-05刷新）の更新手順

`data/cannes2026-winners-v2.json` が現行の参照リスト（`audit-cannes.mjs`が参照）。
award-verifierエージェント5体がlovethework.com公式を並列照合して構築した15部門
（`VERIFIED_CATEGORIES`。Digital Craft, Creative B2B, Creative Business Transformation,
Design, Entertainment, Entertainment for Gaming/Sport, Film, Film Craft,
Grand Prix for Good, Industry Craft, Pharma, Outdoor, Health & Wellness, Audio & Radio）と、
残り16部門（旧v1由来・未検証のまま引き継ぎ、`sourceUrl`に「旧v1由来・未検証」と明記）の
混成データ。**公式照合済み15部門はレベル不一致がFAIL**（pre-pushをブロックする）。
未検証16部門はWARNのまま（`--strict`でのみFAIL）。

- 各winnerの`sourceUrl`が公式URL（`https://www.lovethework.com/...`）か
  「旧v1由来・未検証」かで、そのエントリーの検証状況が分かる
- Film・Film Craft・OutdoorはBronze区分がlovethework側のJS遅延レンダリング（無限スクロール）
  のため静的取得できず一部/全部欠落している（既知の制約。`余分な部門セグメント`WARNの
  大半はこれが原因）。完全なBronzeリストが必要な場合はブラウザ自動化（Playwright等）での
  再取得が必要（未対応）
- 公式照合で受賞確認済みだがcases.json未収録と判明した作品は`pendingNewCases`に分離
  保持している（次回の通常収集フローでの追加候補。監査対象外）
- 旧`cannes2026-winners.json`（v1）は当面残す。`scripts/build-cannes-reference.mjs`は
  過去の特定ワークフロー実行のトランスクリプトIDがハードコードされた「一度きり生成」
  スクリプトで再実行不可（v1の生成来歴の記録として残置）
- 未検証16部門を含む**完全な再照合**をする場合は、award-verifierエージェントを部門ごとに
  並列委任し（今回の5グループ分割と同じ要領）、結果をv2の`winners`にマージする
- **数件程度の追加・修正**は以下の手順:
  1. award-verifierエージェント（またはWebSearch/WebFetch）でlovethework公式を確認
  2. `data/cannes2026-winners-v2.json`の`winners`配列に直接エントリを追加/修正し、
     `sourceUrl`に確認したURLを記録
  3. `npm run audit:cannes`で整合確認（公式照合済み部門はFAILしないこと）

## 6. トラブルシューティング・ランブック

### 自動実行が走っていない
1. `launchctl list | grep researchman` … 登録確認（無ければ `launchctl load ~/Library/LaunchAgents/com.researchman.*.plist`）
2. `cat .last-research-run.txt`（Case Study）/ `.last-tech-research-run.txt`（Technology）… 前回実行時刻。
   **両方とも毎朝10時実行**（2026-07-03変更。10時にPCが落ちていても23時まで毎正時にキャッチアップ）
3. ログに何も出ないのは期限前スキップの正常動作（§2）
4. 即時実行したいとき: 状態ファイルを削除 → 次の正時に発火。またはログ付きで手動実行:
   plist 内のシェル部分をそのまま端末に貼る

### push が失敗した（ログに「pre-push監査で中止の可能性」）
- pre-push hook（Cannes 網羅監査 / サムネイル健全性監査）が FAIL している。コミットはローカルに残っている
- `git push` を手で叩いて FAIL 内容を読み、データを修正してから再 push（**監査を回避しない**）

### 通知が来ない
1. 2026-07-03以降、通知は全終端経路で送られる（無音は無い）。届く文面と`--result`値の対応:
   - 成功/0件: `ok`（既定）→「N件追加・本番反映OK」または「本日の新規追加なし」
   - `unverified`: push済みだが`verify-deploy`が時間切れ（反映は成功していることが多い）
   - `pushfail`: pre-push監査等でpush失敗（ローカルにコミット残存、要手動対応）
   - `error`: 収集スクリプト自体がエラー終了（`--mark`で本日分は消化済み、翌朝再実行）
   何も届かない場合はlaunchd自体が起動していない（下記「自動実行が走っていない」を確認）

### verify-deploy の限界（新ルート追加時の注意）
- 「landed」判定は **git の origin/main == HEAD 確認**であり、**Vercelビルド完了の確認ではない**。
  検査対象も home / サムネイル / cases.json の新規ページのみ。
- **新しいルート**（例: /technology）を追加した場合は、verify-deploy PASS後に
  `curl -s -o /dev/null -w "%{http_code}" https://research-man.vercel.app/<新ルート>` が
  200 になるまで別途確認すること（Vercelビルド中は旧デプロイが404を返す）
2. LINE: `node scripts/notify-line.mjs --dry-run` で本文確認 → 設定は `~/.researchman-line.json`
3. メール: `~/.researchman-mail.json` が未設定なら仕様どおりスキップ

### サムネイルが壊れた・欠けた
- `npm run self-heal` が診断から修復まで行う（oEmbed 照合済みの安全な取得）
- 5KB 未満はプレースホルダ疑いとして検出される

### cases.json を手で直すとき
- `id` は `toId(title, year, client)` 由来。**既存 id を変えるとサムネイルのファイル名と URL が両方壊れる**
- 直したら `node scripts/audit-integrity.mjs` → `npm run build` で検証してから push

## 7. 運用体制メモ

- 以後の運用・保守セッションは Sonnet / Opus を想定。この資料は 2026-07-03 の Fable 5 セッションで
  実運用経路のデバッグ（stale 通知バグ・dry-run スケジュール消費バグの修正）と併せて作成し、
  2026-07-04 の Sonnet 5 セッションで RM 全域の総点検・改善（キュレーション精度・カード正確性・
  毎朝10時ルーティンの堅牢化・Cannes 2026監査の強化・リポジトリ整理）を実施
- 2026-07-04 の主な変更: tech.json sources遡及修正・cases.json重複統合・videoMatchesCase判定強化＋
  確認済みフラグ（`data/verified-videos.json`）・audit-cannesのレベル/余分事例検出・audit-tech.mjs新設・
  staleロック奪取・ログローテ・未使用スクリプト19本のアーカイブ
- 大きな判断材料はセッションメモリ（`~/.claude/projects/.../memory/`）にもある。特に
  `radar-curation`（キュレーション方針）と `node-http-destroy-bug`（settle パターンの経緯）
