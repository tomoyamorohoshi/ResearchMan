# SPEC: Exhibition タブ

新規セッションで実装するための自己完結仕様。前提資料: `docs/EXHIBITION_RESEARCH.md`（調査・確定事項）、`data/exhibition-profile.json`（日次ジョブが読むプロファイル。好み・除外・採点・ソース・シード）。実装は Technology タブ（`src/app/technology/`, `src/lib/tech.ts`, `scripts/auto-research-tech.mjs`, `scripts/audit-tech.mjs`）を雛形にする。

**着手前に必ず**: `AGENTS.md` のとおり Next.js は 16.2.9 で既知の挙動と異なる。route handler / page の書き方は `node_modules/next/dist/docs/01-app/` を読んでから書く。既存の `src/app/technology/[slug]/page.tsx` と `src/app/api/favorites/route.ts` が現行バージョンで動く実例。

**ユーザー確定（2026-10-04・本文より優先）**:
- intake は POST にもパスフレーズ必須（`EXHIBITION_INTAKE_TOKEN`。Vercel env と `.env.local` に設定、UIで初回入力→localStorage保持）。未設定・不一致は 401。
- 通知は 70点以上を routine（23:45 ダイジェスト）、80点以上のみ critical（即時）。
- Machines of Loving Grace（真鍋大度×小山祐介, KARIMOKU RESEARCH CENTER, 10/17-25）は公式ページで裏取りできるまで掲載しない（unverified 扱い）。

## 1. 目的

1. TOP タブに「Exhibition」を追加し、日本全国の「開催中/開催前」の展覧会のうち、ユーザーの好み（メディアアート・光/空間インスタレーション・ジェネラティブ/オンチェーン・アーカイブ系デザイン等）に合うものだけを一覧する
2. 毎日自動で新着を収集し、通知基準を満たす新着は既存のLINE/メール通知で知らせる
3. X/Instagram で見つけた展示は、サイトの URL 投稿ボックスから渡せる。翌日の日次ジョブが取得・公式裏取りして追加する（投稿は強い嗜好シグナルでもある）

## 2. スコープ外

- 終了した展示の表示（データには残すが UI 非表示）
- X/Instagram のタイムライン自動巡回（URL 単発取得のみ）
- 有料 API・有料サービス（無料ソースのみ。Claude CLI は既存ジョブと同じサブスク認証、`ANTHROPIC_API_KEY` は渡さない）
- チケット購入・来館記録・地図表示・多言語化
- 既存タブ（cases/tech/ideas）の挙動変更（タブ追加と、後述の「触るファイル」に列挙した最小変更のみ）

## 3. データ

### 3.1 `data/exhibition.json`

```jsonc
{
  "version": 1,
  "statusAsOf": "2026-10-04",   // 全 status を計算した JST 日付。ジョブが毎回更新
  "items": [ /* Exhibition[] */ ]
}
```

`Exhibition`:

| field | 型 | 備考 |
|---|---|---|
| `id` / `slug` | string | 同一値。`^[a-z0-9]+(-[a-z0-9]+)*$`、100字以内（お気に入り/ごみ箱の `FAVORITE_ID_PATTERN` と `MAX_ID_LENGTH` に合わせる＝そのまま favorites に載る）。形式 `{startYear}-{venue英小文字}-{title英小文字}` を最大60字目安。日本語タイトルはローマ字/英題で。衝突時は `-2` |
| `title` | string | 公式表記 |
| `artists` | string[] | 空配列可（グループ展で作家不明なら空）。ただし1件は推奨 |
| `venue` | string | 会場名 |
| `venueType` | `museum\|alt_space\|corporate\|media_art_center\|gallery\|other` | profile.venueTypes に準拠 |
| `prefecture` | string | 「東京都」「岡山県」等（フィルタ用に正規化済み47値のみ） |
| `city` | string | 市区町村 |
| `startDate` / `endDate` | `YYYY-MM-DD` | 公式の日付（JST 暦日）。会期不明は掲載不可（unverified キューへ） |
| `status` | `upcoming\|ongoing\|ended` | `statusAsOf` 時点の日付から計算（§3.2）。手書き禁止 |
| `admission` | string | `無料` / `一般800円` / `UNKNOWN` |
| `tags` | string[] | `data/exhibition-tag-vocabulary.json`（新規。下記）内のみ |
| `score` | number 0-100 | profile.scoring に従う |
| `matchReason` | string | 1〜2文。なぜ好みに合うか。事実と推測を混ぜない |
| `sources` | `{name,url,kind}[]` | `kind: official\|listing\|social\|news`。**official が1件以上必須**（裏取り済みの証拠） |
| `link` | string | 公式の展覧会ページ（`sources` の official のどれか） |
| `thumbnail` | string | `/thumbnails/exhibition/{id}.jpg`。実体必須 |
| `addedAt` | string | ISO8601。初回追加日時。以後不変 |
| `origin` | `auto\|intake` | intake はユーザー投稿起点 |
| `intakeUrl` | string? | origin=intake のみ。投稿された元 URL |
| `highlight` | boolean | score>=80 |
| `quarantined` | boolean? | tech と同様の隔離フラグ（watchdog 用。任意） |

タグ語彙 `data/exhibition-tag-vocabulary.json`（新規）: `{ "Tag": ["media_art","generative","onchain","installation","light","kinetic","glass","sculpture","video_art","design_archive","graphic_design","architecture","ai_media_art","retrospective","sound"] }`。拡張は語彙ファイルのみで行う。

### 3.2 status の決定規則（唯一の定義）

`computeStatus(startDate, endDate, todayJst)`（純関数、`src/lib/exhibition.ts` と `scripts/lib/exhibition-status.mjs` に同一ロジック。テストで両者の一致を担保。ESM を共有できるなら1つに）:

- `today < startDate` → upcoming／`startDate <= today <= endDate` → ongoing／`today > endDate` → ended（endDate の当日は ongoing）

- **UI は保存値を信用せず、表示時に今日(JST)で再計算**して ended を非表示にする（日次ジョブ間でも自己修復し、ISR/静的ビルドの古い status で終了展を出さない。クライアント側でも再計算する）
- 保存値 `status` は `statusAsOf` 基準。監査は `statusAsOf` 基準で保存値を検証する（§7。時計に依存しない＝日付が変わっただけで pre-push が落ちない）
- 残り日数 `daysLeft = endDate - today`（ongoing）、`startsIn = startDate - today`（upcoming）

## 4. UI

- `TopTabs.tsx`: `active` に `"exhibition"` を追加、タブ `{ href: "/exhibition", label: "Exhibition" }` を Technology の次に追加。**ヘッダの TopTabs を使う全ページの型が変わる**ため `tsc` で全呼び出し側を確認
- `/exhibition`（`src/app/exhibition/page.tsx` + `src/components/ExhibitionGalleryClient.tsx`、tech の `TechGalleryClient` を雛形）
  - 並び: status（ongoing → upcoming）→ 同 status 内は ongoing は `endDate` 昇順（終わりが近い順）、upcoming は `startDate` 昇順。`highlight` は同順位内で先頭
  - バッジ: ongoing は「残りN日」（N<=7 は強調、当日は「本日まで」）、upcoming は「N日後に開始」
  - フィルタ: 都道府県（データに登場するものだけ）、タグ、status（ongoing/upcoming/すべて）。URL クエリに反映（既存の GalleryClient の方式に合わせる）
  - お気に入り/ごみ箱: `useFavorites` / `useTrash` をそのまま再利用（id は slug）。ごみ箱は非表示化。サーバ同期 API の変更は不要
  - 0件のとき空状態の文言、`ViewModeProvider`/`ViewModeToggle` は tech と同様に使うか、不要なら外す（グラフ表示は対象外）
  - **投稿ボックス（intake）**: 一覧上部に URL 入力 + 送信ボタン。送信後は「受け付けました。明日の更新で反映されます」。エラー文言は 400/429/503 を区別
- `/exhibition/[slug]`: tech の詳細ページと同構成（tech が詳細ページを持つため踏襲）。公式リンク、会期・会場・入場料、matchReason、sources 一覧。終了済み slug も 200 で開けるが ended 表示（`generateStaticParams` には全 items を含める。ただし一覧には出さない）
- アクセシビリティ: フォーム label・`aria-live` の結果通知・バッジはテキスト併記（色だけに依存しない）・サムネ alt=title

## 5. 日次ジョブ

### 5.1 新規 `scripts/auto-research-exhibition.mjs`

`auto-research-tech.mjs` を雛形に。`--dry-run` 対応、`MODEL = "sonnet"`、`resolveClaudeBin/runClaudeJsonArray`（`scripts/lib/claude-cli.mjs`）、`normLink`、`jstDateString`、`localDayIndex` を再利用。流れ:

1. **status 更新**（Claude 不要・最初に実行）: 既存全件を `computeStatus` で更新し `statusAsOf` を今日にする。ended になったものは `status: ended` に変更するのみ（削除しない。履歴・dedupe 用）。サムネは ended でも残す
2. **intake 処理**（§6.3）: 未処理の投稿を取得 → 候補化
3. **発見**: `data/exhibition-profile.json` をプロンプトに埋め込み（likes/watch/exclusions/scoring/sources）。ソースは tier 順に、1回の呼び出しが重くならないよう日替わりローテーション（`localDayIndex() % N`）: core は毎日、secondary/supplementary は日替わり3〜4件ずつ。discoveryQueries（`{月}`/`{都道府県}` は実行日で展開）を WebSearch に投入。最大 `MAX_ROUNDS=2`。1日の追加上限は NEORT++/オンチェーン/ジェネラティブ以外で `MAX_ADD=5`（NEORT++系は上限なし）
4. **候補の機械検証**（新規 `scripts/build-exhibition-from-research.mjs` に分離、tech の `build-tech-from-research.mjs` と同型）:
   - 公式ページを WebFetch/HTTP で再取得し 200 と、日付・会場が候補 JSON と一致することを確認（Claude の主張を鵜呑みにしない。一致しなければ `data/inbox/exhibition-unverified.json` へ）
   - 日付検証: `endDate >= today`（既に終了は追加しない）、`startDate <= endDate`
   - 除外ルール: hard 除外に該当（絵画/IP/物販/ショールーム/AI生成画像）は reject（理由を rejection ログへ。tech 同様 `scripts/lib/rejection-log.mjs` があれば利用）
   - `score >= threshold.add(60)`、NEORT++/オンチェーン/ジェネラティブは score を 60 に引き上げて必ず追加
   - dedupe: `normLink(link)` 一致、または正規化 `(title, venue, startDate)` 一致（`scripts/lib/norm-title.mjs` 再利用）。TAB/美術手帖/artscape 由来の同一展を弾く。既存エントリと一致した場合は新規追加せず、日付・会場の変更のみ差分更新（会期延長/変更の追従）
   - サムネ: og:image → `public/thumbnails/exhibition/{id}.jpg`（`scripts/save-thumbnail.mjs` / `normalize-thumbnail.mjs` / `thumbnail-constraints.mjs` を再利用。`MIN_THUMB_BYTES` 以上。取得不可なら追加しない）
   - id/slug 生成と衝突回避
5. **書き込みと通知サマリー**: `data/exhibition.json` を更新（tmp→rename の原子的書き込み）。`os.tmpdir()/researchman-exhibition-last-add.json` に `{count, cases:[{id,title,year}]}` を**0件でも必ず上書き**（stale 再通知防止。tech と同形式にして `notify-line.mjs` を無改修で使う）。`notify-line.mjs` の `year` 欄は開始日を入れる

CLI の失敗（タイムアウト・JSON 抽出失敗）はステップ1の status 更新結果を捨てずに、発見だけスキップして成功終了する（status 更新は毎日必ず反映したい）。ただし Claude CLI が完全に動かない場合は非0終了で既存のエラー通知経路に乗せる（tech と同じ）。

### 5.2 ジョブ登録（既存ジョブと同じ流儀）

- `scripts/windows/run-job.mjs`: `JOB_TABLE` に `exhibitionresearch: { shortName: "exhibition" }` を追加し、`runExhibitionresearch()` を `runTechresearch()`（232行付近）の複製として追加。差分: state ファイル `.last-exhibition-research-run.txt`、実行スクリプト `auto-research-exhibition.mjs`、`--summary` は `researchman-exhibition-last-add.json`、`--route exhibition --label Exhibition`、`git add data/exhibition.json public/thumbnails/exhibition/`、コミットメッセージ `Exhibition radar: YYYY-MM-DD`、反映確認は `verify-deploy.mjs --skip-pages` + 新規 `verify-exhibition-pages.mjs`（`verify-tech-pages.mjs` の複製、`/exhibition/{id}` を最大360秒ポーリング）。`switch` に case 追加。git 排他ロック（`acquireLock`）は必須（他ジョブと直列化）。**main ブランチ検査（冒頭）は変更しない**
- `scripts/notify-line.mjs`: `ROUTE_LABEL_FALLBACK` に `exhibition: "Exhibition radar"`。リンク組み立てが route で分岐している箇所（`--route technology` を参照している箇所）に `exhibition` → `/exhibition/{id}` を追加（実装時に grep で確認）。通知 priority: `score >= notify(70)` の新着を含む回は既定 `routine`（23:45 のダイジェストに集約。LINE 無料枠対策）、`highlight`(80以上)の新着がある回のみ `critical`。要望次第で変更可
- `launchd/com.researchman.exhibitionresearch.plist`: `com.researchman.techresearch.plist` の複製（10〜23時の毎正時、`run-if-due.mjs --state .last-exhibition-research-run.txt --daily-at 10`、同じ排他ロック、ログ `researchman-exhibition.log`、`git add data/exhibition.json public/thumbnails/exhibition/`）。Mac 運用の互換維持のため作る
- `scripts/windows/register-tasks.ps1`: `$JobSchedules` に `exhibitionresearch`（techresearch と同じ毎日10〜23時毎正時。**10:00 に既存3ジョブと同時発火しロック待ちが増えるため、10:30 起点・毎正時30分に1本ずらす**。ロック待ち上限30分の制約を `register-tasks.ps1` 内コメントのロック計算に追記し、4ジョブ合計の最悪待ち時間が上限に収まることを確認）。ヘッダコメントの「5ジョブ」記述を更新。`unregister-tasks.ps1` も対応
- **既存 Case Study ジョブへの副作用（重要）**: `run-job.mjs` の autoresearch、`autoresearch.plist`、`watchdog.mjs` の `PIPELINE_CONFIG.cc.addPaths`/ほか `git add public/thumbnails ":(exclude)public/thumbnails/tech"` している箇所は、`public/thumbnails/exhibition` も `:(exclude)` に追加する。追加しないと cases ジョブが exhibition のサムネをコミットに巻き込み、データ（exhibition.json）と別コミットになり pre-push 監査が不整合を検出して push 全滞留する危険がある（`grep -rn "exclude)public/thumbnails/tech"` で全箇所を洗い出す）

### 5.3 pre-push / ブランチ

作業ツリー運用ルール（CLAUDE.md）に従い、実装は worktree で行い、完了時に main へ戻す。`scripts/hooks/pre-push` の原本変更後は `cp scripts/hooks/pre-push .git/hooks/pre-push` を忘れない。

## 6. Intake（URL 投稿）

### 6.1 API `src/app/api/exhibition-intake/route.ts`

保護の現状（調査済み）: `POST /api/favorites` と `/api/trash` は **無認証**（検証のみ・全件拒否方式・ts 上限・MAX_ITEMS）、**GET のみ** `Authorization: Bearer ${FAVORITES_SYNC_TOKEN}`。順序は 検証(400) → Blob設定(503) → 書き込み。これを踏襲する。サイトは公開のため以下を追加:

- `POST`（無認証・UI から使う）: body `{ url: string }`
  - 検証（400）: JSON、`url` は 300字以内、`new URL()` で parse、`https:` のみ、ホスト allowlist: `x.com`, `twitter.com`, `www.x.com`, `mobile.twitter.com`, `instagram.com`, `www.instagram.com`。パスは X: `/{user}/status/{digits}`、IG: `/(p|reel)/{id}`。クエリ・フラグメントは除去して正規化保存。userinfo 付き・ポート指定・punycode 混入は拒否
  - **サーバはその URL を一切 fetch しない**（SSRF 防止。取得はローカルの日次ジョブのみ）
  - レート制限/上限（429）: キューの未処理件数上限 50（超えたら 429）、同一 URL は冪等（重複は 200 で「受付済み」）、1日の受付総数上限 30。IP 単位の制限は Vercel のサーバレスでは状態を持てないため、Vercel Firewall の rate limit ルール（`/api/exhibition-intake` への POST を IP あたり 10回/分）をダッシュボードで設定する手順を OPERATIONS.md ではなくこの SPEC の検証手順に書く（コード外の作業なので完了報告で明示）。honeypot の隠しフィールド `website` が非空なら 200 を返して保存しない
  - Blob 未設定 → 503（localStorage フォールバックは不要。UI は「現在受付できません」を表示）
- `GET`（Bearer `FAVORITES_SYNC_TOKEN`、トークン未設定503・不一致401、既存と同順序）: 未処理キューを返す。**認証済みで日次ジョブだけが使う**
- `PATCH`（同 Bearer 認証）: `{ results: [{ url, status: "added"|"rejected"|"unverified", exhibitionId?, reason? }] }` でキュー項目を処理済みに更新（処理済みは tombstone として30日保持し、同一 URL 再投稿を `already_processed` で弾く）
- ストレージ: `src/lib/favoritesStore.ts` の `readBlobData/writeBlobData` と同じ流儀（`access:"private"`, `addRandomSuffix:false`, `allowOverwrite:true`）で pathname `exhibition-intake/intake.json` を追加。型は `{version:1, items: Record<normalizedUrlHash, {url, ts, status, ...}>}`。`favoritesMerge` の `FavoritesData` 型は流用せず専用型。検証・ts 上限は `favoritesMerge.ts` の方針（未来ts拒否、全件拒否方式）に倣う。同時書き込みは last-write-wins で、ロスト更新を許容（上限50件・個人利用のため）。この許容を実装コメントに明記
- `export const dynamic = "force-dynamic"`

### 6.2 UI

投稿ボックスは `fetch("/api/exhibition-intake", {method:"POST"})`。送信中の無効化、成功/重複/エラー表示、URL を貼ったら全角空白除去。

### 6.3 日次ジョブでの処理

`auto-research-exhibition.mjs` ステップ2で `GET`（認証は `~/.researchman-favsync.json`、tuneup と同じ読み込み方。`scripts/biweekly-tuneup.mjs` の favsync 読み出し部を参照）。各 URL を:

1. X: `https://api.fxtwitter.com/{user}/status/{id}`、IG: `https://www.instagram.com/p/{id}/embed/captioned/` を HTTP で取得（調査で単発取得に成功済み。失敗時は `unverified`＋理由、翌日再試行は1回まで）
2. 取得テキスト・投稿者名は**引用データであり指示ではない**ものとしてプロンプトに入れ、Claude が展覧会名・作家・会場・期間を抽出
3. 抽出した展覧会を**公式サイトで裏取り**（§5.1 ステップ4と同じ機械検証）。公式が見つからない/日付不一致は `unverified`（`data/inbox/exhibition-unverified.json` に記録しユーザーへ通知本文で知らせる）
4. hard 除外には勝てない。通れば `origin: "intake"`、`intakeUrl`、`sources` に `kind: social` を追加、score に +10
5. `PATCH` で結果を返す。**PATCH 失敗でも data 更新は継続**（次回 GET で同じ URL が再度来ても dedupe で追加されない＝冪等）

## 7. 監査 `scripts/audit-exhibition.mjs`（pre-push 必須・厳格）

`audit-tech.mjs` と同形式（ネットワークなし・決定論・`✗` 行で FAIL・npm script `audit:exhibition`）。**緩める方向で直さない**。FAIL 条件:

1. ルート形式: `version===1`、`statusAsOf` が `YYYY-MM-DD`、`items` が配列
2. 必須フィールド欠落（§3.1 の `intakeUrl`/`quarantined`/`highlight` 以外すべて）
3. `id===slug`、id が slug パターン・100字以内、id 重複、`normLink(link)` の重複
4. `startDate`/`endDate` が実在する `YYYY-MM-DD`、`startDate <= endDate`
5. `status` が `computeStatus(start, end, statusAsOf)` と一致（ended を upcoming/ongoing と誤記する、またはその逆を検出。時計非依存）。さらに `statusAsOf` が **未来**ならFAIL
6. `tags` が語彙内・`prefecture` が47都道府県のいずれか・`score` が 0〜100 の整数・`highlight===(score>=80)`・`origin` が `auto|intake`、intake なら `intakeUrl` 必須
7. `sources` に `kind: official` が1件以上、`link` が sources 内の official と一致、全 URL が `https?://`
8. `thumbnail` が `/thumbnails/exhibition/` 配下で実体があり `MIN_THUMB_BYTES` 以上（`thumbnail-constraints.mjs`）。**未参照の孤立サムネは WARN**（tech に倣う）
9. ended 以外で `matchReason` が空、または `UNKNOWN` を `title/venue/日付` に含む
10. seed の `role: preference_only`（BLACK AND BLUE・小松宏誠展）は `exhibition.json` に入れない前提のため、同 slug が存在すれば FAIL（嗜好専用の混入防止）

WARN（FAILにしない）: `statusAsOf` が今日から2日以上古い（日次ジョブ停止の兆候。watchdog が拾う）、`admission` が UNKNOWN。

- `scripts/hooks/pre-push` に tech 監査の次に追加: `node scripts/audit-exhibition.mjs || { echo "[pre-push] Exhibition監査失敗: ... push を中止しました。"; exit 1; }`。`.git/hooks/pre-push` へコピー
- CLAUDE.md の push滞留の節の「4監査」リストへ `audit-exhibition.mjs` を追記（運用ルール文書の更新のみ）

## 8. watchdog / tuneup 統合

### watchdog（`scripts/watchdog.mjs`）
- `JOB_STATE_FILES`（335行付近）に `{ file: ".last-exhibition-research-run.txt", label: "Exhibition収集", launchdLabel: "com.researchman.exhibitionresearch", jobKey: "exhibition" }`
- `PIPELINE_CONFIG`（256行付近）に `exhibition` を追加（script/addPaths `["data/exhibition.json","public/thumbnails/exhibition"]`/commitMessage/verifyDeploy extraScripts `verify-exhibition-pages.mjs`/notify route）
- `LOG_JOBS`（466行付近）に `{ jobKey: "exhibition", label: "Exhibition収集", logPath: defaultLogPath("exhibition") }`
- サムネ実URL検査: Technology と同様に `${SITE}/exhibition` を `checkThumbnailsOnPage` に追加（自動修復なしのまま通知のみ）
- `checkUnpushedCommits` の失敗監査名抽出（`scripts/lib/unpushed-commits.mjs`）に `audit-exhibition.mjs` を認識させる（テスト `unpushed-commits.test.mjs` も更新）
- deep 監査（日曜）に audit-exhibition 実行を追加。隔離（quarantine）対象に `exhibition` dataset を追加するかは任意（リンク死活は ended 展が死ぬのが自然なため、**ended と quarantined 済みは死活検査から除外**）

### tuneup（`scripts/biweekly-tuneup.mjs`, `data/research-tuning.json`）
- 集計入力に exhibition を追加: お気に入り（`/api/favorites` の id が exhibition slug に該当するもの）、ごみ箱、**intake 投稿（強い正のシグナル。お気に入りの2倍重み）**。タグ・venueType・都道府県・score 帯の分布を算出
- 提案対象は `data/exhibition-profile.json` の `likes.themes[].weight`、`watch.artists/venues`（intake 成功の作家・会場を追加）、`scoring.threshold`（ごみ箱率が高ければ add を引き上げ）のみ。除外ルール（`exclusions.hard`）と `collectAll` はユーザー確定事項のため**自動変更禁止**（`scripts/lib/tuneup-guardrails.mjs` にガードを追加）
- dry-run 検証ステップに `auto-research:exhibition:dry` を追加（`verifySteps`、730行付近）。`package.json` に `auto-research:exhibition`/`:dry`、`audit:exhibition` を追加
- 追加は既存の tuneup 安全弁（ガードレール・差分上限）に従う

## 9. 初期データ（seed）

`data/exhibition-profile.json` の `seeds` から `role: listing` かつ `endDate >= 実装日` のものだけを投入する。2026-10-04 時点で6件: 自己破壊芸術展(〜10/18)、Machines of Loving Grace(10/17〜25、upcoming)、多田美波(〜12/6)、Ann Veronica Janssens(〜2027-01-11)、田中義久 ARCHIVE/ACHIEVE(〜10/21)、ナムジュン・パイク(〜11/23)。BLACK AND BLUE と小松宏誠展は入れない（`preference_only`）。実装日が会期終了を過ぎたものは入れない（status 再計算で判定）。

- seed は手書きせず、`scripts/seed-exhibition.mjs`（新規・1回限り、冪等）で: 公式 URL を取得→日付/会場を照合→サムネ取得→score 計算→JSON 書き出し。**Machines of Loving Grace は公式ページが未特定**。Anthropic/KARIMOKU の公式告知を探し、確認できなければ seed にせず unverified へ（X 単一ソースで掲載しない。`official` 1件以上の監査に通らない）。多田美波は MOT 公式の個別展覧会ページ URL を特定して `link` にする（トップ URL は不可）
- `data/inbox/japan-exhibition-2026-08-14.json`: 内容は cases 形式の「展覧会ニュース」（オノ・ヨーコ Cut Piece＠SHIBAURA HOUSE 9月開催、舘鼻則孝 リシンク展＠女子美アートミュージアム 等。2026-08-14発表）。**実装時点で終了済みのものが大半のはず**。各候補を §5.1 の機械検証パイプライン（`build-exhibition-from-research.mjs`）に通し、`endDate >= today` かつスコア基準を満たすものだけ追加。通らないものは捨てる（このファイルは手で書き換えない）

## 10. 触るファイル

新規: `SPEC.md`（済）, `data/exhibition.json`, `data/exhibition-tag-vocabulary.json`, `src/lib/exhibition.ts`, `src/lib/exhibitionIntake.ts`（検証・URL正規化の純関数）, `src/lib/exhibitionIntakeStore.ts`（Blob I/O）, `src/app/exhibition/page.tsx`, `src/app/exhibition/[slug]/page.tsx`, `src/app/api/exhibition-intake/route.ts`, `src/components/ExhibitionGalleryClient.tsx`, `src/components/ExhibitionCard.tsx`, `src/components/ExhibitionIntakeBox.tsx`, `scripts/auto-research-exhibition.mjs`, `scripts/build-exhibition-from-research.mjs`, `scripts/seed-exhibition.mjs`, `scripts/audit-exhibition.mjs`, `scripts/verify-exhibition-pages.mjs`, `scripts/lib/exhibition-status.mjs`, `launchd/com.researchman.exhibitionresearch.plist`, `public/thumbnails/exhibition/`, 各テスト。

変更: `src/components/TopTabs.tsx`, `scripts/windows/run-job.mjs`, `scripts/windows/register-tasks.ps1`(+`unregister-tasks.ps1`), `scripts/notify-line.mjs`, `scripts/hooks/pre-push`(+`.git/hooks/pre-push`へコピー), `scripts/watchdog.mjs`, `scripts/lib/unpushed-commits.mjs`(+test), `scripts/biweekly-tuneup.mjs`, `scripts/lib/tuneup-guardrails.mjs`, `data/research-tuning.json`（必要なら）, `package.json`, `launchd/com.researchman.autoresearch.plist`と`run-job.mjs`の autoresearch・`watchdog.mjs` の cc addPaths（exhibition サムネ `:(exclude)` 追加）, `src/lib/favoritesStore.ts`（Blob pathname 追加のみ。または専用ストアに分離して無変更）, `.vercelignore`/`next.config.ts`（変更不要の見込みだが、`data/exhibition.json` は小さいため同梱で良い＝Blob 配信対象にしない）, `CLAUDE.md`（監査リスト追記のみ）。

## 11. テスト計画（TDD：先に失敗するテストを書きコミット→実装）

テストランナーは既存の流儀（`*.test.mjs` を `node --test`、`*.test.ts` は既存 `awards.test.ts` 等と同じ実行方法。`package.json` を確認）に合わせる。

純関数（失敗テスト先行）:
- `computeStatus`: 開始前日/開始日/終了日/終了翌日/年またぎ/JST 境界（UTC 15:00 前後）。`.ts` と `.mjs` の一致
- URL 検証・正規化: 許可 X/IG、`http:`、他ホスト、userinfo、ポート、`javascript:`、300字超、クエリ除去、`twitter.com`→正規化、IG `/p` `/reel`、`/user/status/abc`（数字でない）拒否
- dedupe: `normLink` 一致、title/venue/startDate 正規化一致、会期変更の差分更新、別展（同会場・別会期）は重複扱いしない
- 並び替え・「残りN日」算出
- slug 生成: パターン適合・衝突時 `-2`・日本語のみタイトルのフォールバック

API（`scripts/smoke-favorites-api.mjs` と同型の `smoke-exhibition-intake-api.mjs`）:
- POST: 不正 JSON 400／不許可ホスト 400／正常 200／重複 200（冪等）／上限超 429／honeypot 非保存／Blob 未設定 503（検証が 503 より先）
- GET/PATCH: トークン未設定 503・無認証 401・正認証 200、PATCH 後に処理済み化、再投稿が `already_processed`

監査（`audit-exhibition.mjs` にフィクスチャ駆動のテスト）:
- ended を ongoing と誤記／`statusAsOf` 未来／endDate<startDate／official 欠落／サムネ欠損・極小／id 重複／語彙外タグ／preference_only slug 混入／正常データで exit 0 を各1ケース（**FAIL ケースが FAIL すること**を確認し、監査を緩めない）

ジョブ:
- `auto-research-exhibition.mjs --dry-run` が data を変更しないこと、status 更新のみ実行（Claude 呼び出し無し）モードで ended 遷移と `statusAsOf` 更新を確認、サマリー JSON が 0 件でも上書きされること（stale 防止）
- intake: fxtwitter/IG の応答をモックし、公式裏取り失敗が `unverified`、PATCH 失敗でも冪等

UI: `scripts/smoke-favorites-ui.mjs` 流儀で、ended が一覧に出ない・並び順・バッジ・フィルタ・投稿ボックス（成功/エラー表示）。

## 12. E2E 検証手順（完了報告に証拠を添える）

1. `tsc --noEmit` / `npm run lint` / 上記テスト全通し / `npm run build` 成功
2. `node scripts/audit-exhibition.mjs` exit 0。**意図的に ended を upcoming に書き換えたコピーで FAIL することを確認**（元に戻す）
3. `npm run dev` → `/exhibition` を開き、スクリーンショットで確認: ① ended が出ない ② 並び順 ③「残りN日」 ④ 都道府県/タグ/status フィルタ ⑤ お気に入り/ごみ箱の動作 ⑥ 詳細ページ。TopTabs が全タブページで崩れていないこと。**参照: 既存 `/technology` との見た目の一貫性、`docs/EXHIBITION_RESEARCH.md` の seed 6件との突き合わせ（会期・会場）**
4. intake: dev で投稿 → Blob 未設定なら 503 表示を確認。本番相当ではテスト URL（調査で成功した `https://x.com/ayupys/status/2105985301751693583` と `https://www.instagram.com/p/Dd6XYiYk386/`）を投稿 → `auto-research-exhibition.mjs`（手動実行）が取得→公式裏取り→PATCH まで通る
5. 日次ジョブ手動実行（`run-job.mjs exhibitionresearch`。他ジョブのロック・実行有無を先に確認、**main ブランチ上のみ**）→ commit → pre-push 監査通過 → push → `verify-exhibition-pages.mjs` OK → LINE 通知（`--dry-run` で本文確認後に実送信1回）
6. Windows タスクスケジューラへ登録（`register-tasks.ps1`）→ 次回発火で `researchman-exhibition.log` に `Run start` が出る。watchdog が新ジョブを認識（`node scripts/watchdog.mjs` で exhibition が一覧に出る）
7. 滞留ゼロ確認: `git rev-list --count origin/main..main` が 0
8. Vercel Firewall の rate limit（intake POST）をダッシュボードで設定したことをユーザーへ依頼/報告

## 13. リスク

- **Next.js 16.2.9**: 既知の API と異なる可能性。route handler/`generateStaticParams`/params の Promise 化などは `node_modules/next/dist/docs/` で確認してから書く
- **push 全ブロック**（2026-07 事故の再発）: 新監査は厳格だが、(a) status は `statusAsOf` 基準で時計非依存にして日付変更で落ちないようにした、(b) cases ジョブの `git add public/thumbnails` が exhibition サムネを巻き込むとデータ不整合で落ちる→ `:(exclude)` 追加が必須、(c) pre-push 原本を変えたら `.git/hooks/pre-push` へコピー忘れ。実装完了時に必ず `git rev-list --count origin/main..main` を確認
- **ブランチ運用**: 日次ジョブは作業ツリーに直接 commit する。開発は worktree、セッション終了時 main に戻す
- **intake の悪用**: 無認証 POST は favorites と同方針だが、書き込み先はキューのみ・サーバは外部 fetch しない・件数上限・allowlist・honeypot・Firewall rate limit で多重防御。残るリスクは上限 50 件枠の占有（スパムで正規投稿が 429 になる）→ ユーザーは Firewall で IP 制限、必要なら `EXHIBITION_INTAKE_TOKEN` による簡易パスフレーズ（UI で入力しローカル保存）へ強化できる（初版は入れない）
- **Prompt injection**: X/IG 本文・ソースページは全て引用データとして渡し、出力は公式裏取りの機械検証を必ず通す。Claude の主張だけで追加しない
- **LLM の日付誤り**: 会期は最重要。公式ページ再取得の機械照合を必須にし、不一致は unverified。日付が取れない展示は掲載しない
- **ソース到達性**: `ggg`（dnpfcp.jp）は未検証、artscape `/exhibitions/` は環境により接続失敗、watarium は http のみ。ジョブ初回に死活確認し、失敗ソースはその日スキップして続行（全滅時のみエラー）
- **LINE 無料枠**（200通/月）: 通常は routine（ダイジェスト集約）、highlight のみ critical
- **ID と Favorites**: exhibition slug が cases/tech の id と衝突しないこと（監査で `cases.json`/`tech.json` の id との衝突も FAIL にする。お気に入りは id 名前空間共有のため）
- **データの陳腐化**: UI は表示時に status を再計算するため、静的生成された古いページでも ended は出ない。クライアント側再計算の `hydration mismatch` を避けるため、初期描画はサーバ側計算＋クライアントで再計算（`suppressHydrationWarning` ではなく `useEffect` 後に再フィルタ）
