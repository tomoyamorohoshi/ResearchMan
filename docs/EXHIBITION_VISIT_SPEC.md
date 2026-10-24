# SPEC: 「行きたい」ボタンと Visit タブ

2026-10-24 オーナー合意。新規セッションで実装するための自己完結仕様。§1 の決定事項は変えない。

## 1. 決定事項（オーナー回答）

| 項目 | 決定 |
|---|---|
| 新ボタン | Exhibition のカードと詳細ページに「行きたい」を追加（いいね・トラッシュとは独立した状態） |
| 新タブ | 名前は **Visit**（`/visit`）。TopTabs の Exhibition の右に置く |
| Visit に出す範囲 | **「行きたい」を押した展覧会だけ** |
| 会期の見せ方 | **地図＋名前入り横帯カレンダー**（確定）。今日を含む週から6週のカレンダーに、会期を展覧会名入りの連続した横帯で重ねる。展覧会は色でなく番号（01, 02…）で識別する。試作段階の「会期バー」案と、他のカレンダー表示案・切替クエリは削除済み |
| 追加機能 | **終了間近の強調**のみ（終了まで7日以内＝今日を含む） |
| 地図 | Leaflet ＋ OpenStreetMap タイル（無料。有料の地図API・ジオコーディングAPIは使わない） |
| 対象外 | 現在地表示・経路リンク・近い会場のまとめ・多言語化 |

## 2. 「行きたい」の状態管理

- いいね（`src/hooks/useFavorites.ts`）と同じ仕組みで作る: `src/hooks/createSyncedIdSet.ts` を使う `useWantToGo`。
  - localStorage キー `researchman-want-to-go`、API `/api/want-to-go`（`src/app/api/favorites` と同じ構成、`src/lib/syncRouteHandlers.ts` を再利用）、Blob の固定パス `want-to-go/want-to-go.json`（`src/lib/favoritesStore.ts` に追加）。
  - 競合時は `src/lib/favoritesMerge.ts` の per-id LWW と tombstone をそのまま使う（新しいマージ処理は書かない）。
- ボタンは `src/components/ExhibitionCard.tsx` と `src/app/exhibition/[slug]/page.tsx` に置く。アイコン＋`aria-label="行きたい"`／押下中は `aria-pressed="true"`。見た目はいいねボタンと揃える。
- トラッシュ済みの展覧会は Visit に出さない（「行きたい」の記録自体は消さない）。

## 3. 会場の座標

- `data/exhibition.json` のスキーマは変えない。会場名をキーにした **`data/venue-geo.json`** を新設し、表示時に `item.venue` で引く。
  ```json
  { "version": 1, "venues": { "森美術館": { "lat": 35.6604, "lng": 139.7292, "source": "nominatim", "query": "森美術館 港区 東京都", "checkedAt": "2026-10-24" } } }
  ```
  `source` は `nominatim` か `manual`（手で直した値。自動処理で上書きしない）。
- 座標の取得は **OpenStreetMap の Nominatim**（無料）を、データ生成側でだけ呼ぶ（ブラウザからは呼ばない）。
  - 利用規約を守る: 1秒1件まで、`User-Agent` に連絡先付きのアプリ名、結果は `venue-geo.json` にキャッシュして同じ会場を再問い合わせしない。
  - 問い合わせ文は `venue + city + prefecture`（採用候補が無ければ二段目として `venue` のみで再検索し、同じ prefecture 判定で採否を決める。どちらも1秒間隔）。**結果の住所に prefecture が含まれない場合は採用しない**（同名施設の誤一致防止）。取れなかった会場は `venue-geo.json` に載せず、`logs/system-alerts.jsonl` に1行記録する。
- 新スクリプト `scripts/geocode-venues.mjs`（`--dry-run` あり）。日次の Exhibition ジョブ（`scripts/auto-research-exhibition.mjs` の後）で、座標未登録の会場だけを処理する。
  - `scripts/windows/run-job.mjs` の Exhibition の `git add` 対象に `data/venue-geo.json` を追加する（漏らすと毎回未コミットで残る）。
- 初回は現行17件の会場を一括で取得し、実装者が全件を地図で目視確認する（明らかな誤りは `manual` で直す）。
- 座標の無い展覧会は、地図には出さず、カレンダーとリストには出し、「地図未登録」と表示する。

## 4. Visit タブ（`/visit`）

- `src/components/TopTabs.tsx` に `{ key: "visit", href: "/visit", label: "Visit" }` を追加。全ページの TopTabs の型も合わせる。
- データは `data/exhibition.json`（バンドル同梱の既存読み込み `src/lib/exhibition.ts`）＋ `data/venue-geo.json`。「行きたい」は端末の状態なので、一覧の絞り込みはクライアント側で行う。
- 共通の表示ルール:
  - 「今日」は JST。終了日を過ぎた展覧会は地図と会期表示から外し、下部の「終了した展覧会」に薄く並べる（折りたたみ）。
  - 終了まで7日以内は「あと N 日」（当日は「今日まで」）の赤いバッジを付け、リストの先頭に並べ、地図のピンも赤にする。
  - 開催前は「M/D から」のバッジ。
  - 0件のときは「Exhibition タブで『行きたい』を押すと、ここに地図と会期が出ます」と案内し、`/exhibition` へのリンクを出す。
  - 地図のピンとリストの項目は連動させる（ピンを押すと項目が強調されスクロール、項目を押すと地図がその会場へ移動してポップアップ）。ポップアップには展覧会名・会場・会期・詳細ページへのリンク。
  - 同じ会場に複数の展覧会があるときは、1本のピンにまとめ、ポップアップに全件を並べる。
- 地図＋カレンダー（今日を含む週（日曜始まり）から6週＝42マス。表示の切替クエリなし。今日の目印だけ試作中で `?today=a|b|c`、無指定・不正値は a）: PCは左に地図・右にカレンダー、スマホは上に地図・下にカレンダー。
  - 週ごとの行に、会期を展覧会名入りの横帯で重ねる（週をまたぐ会期は連続して見える）。帯の文字は11px。「‹ 前」「次 ›」ボタン（高さ40px以上）で6週単位に移動し、最初の範囲（今日の週）より前には戻れない（disabled＋aria-disabled）。見出しは期間（例 `10.25 — 12.05`、開始は今日）。日付を押すと、その日に開いている展覧会だけを地図に絞り込む。選択枠は帯より手前に出す。
  - 過去は不要: 今日より前のマス（最初の週の今日より左）は無地グレーで帯なし・押せない（日付数字だけ薄く残す）。帯は今日より前にはみ出さず、開始日が過去の展示は今日のマスから始まる（`rangeCalendar` が過去マスの ID を空にする）。
  - 月の切り替わり: 各月1日と範囲の最初のマス（今日）は「11/1」のように月付きで出す。
  - 今日の目印（試作3案、`?today=` で切替。オーナーが1案に絞る）: a=マス全体を黒地反転＋「今日」 / b=太い黒枠(3px)＋「TODAY」 / c=淡い黄色(#fff3b0)＋「今日」。いずれも帯より手前で、aria-label に「今日」を含む。
  - 識別は番号。カレンダー凡例・帯・一覧で同じ番号（一覧と同じ並び順）を使う。
  - トーンは ResearchMan に合わせ、白黒グレー＋赤のみ。帯は開催中=黒、終了間近=赤、開催前=白地に黒枠。
  - 帯は `aria-hidden`・クリック不可。展覧会名は番号付きの凡例リストで補い、日付セルのラベルに件数と最終日の有無を読み上げる。
- Leaflet は `next/dynamic`（`ssr: false`）で読み込み、`leaflet/dist/leaflet.css` を読み込む。ピンは画像を使わない `L.divIcon`（既定アイコンの画像パス問題を避ける）。タイルは `https://tile.openstreetmap.org/{z}/{x}/{y}.png` と帰属表示「© OpenStreetMap contributors」。
- 追加依存は `leaflet` と `@types/leaflet` のみ（`react-leaflet` を使う場合は React 19 対応版に限る）。

## 5. テスト（TDD。純関数を先に）

- `src/lib/visit.ts`（新規）の純関数:
  - 残り日数・終了間近の判定（JSTの境界、当日、終了済み、開催前）。
  - Visit 一覧の導出（「行きたい」だけ／トラッシュ除外／終了済みの分離／並び順＝終了間近→終了日の早い順）。
  - 週ごとの帯の分割と段（lane）の割り当て。
  - 今日起点6週のマス目（過去判定・月付き表示）・見出し・過去を切り詰めた帯・その日に開いている展覧会の抽出。
  - 会場の座標の引き当てと、同じ会場の束ね。
- `scripts/lib/venue-geo.mjs`（新規）: Nominatim 結果の採否（prefecture を含まないものは不採用）、`manual` を上書きしない、未登録会場の抽出、1秒間隔の待ち。ネットワークはテストで呼ばない（fetch を差し替える）。
- 同期: `useWantToGo` の API ルートが favorites と同じ認証・マージになっていることのテスト（既存の favorites テストに倣う）。
- 既存テスト（`npm run test:exhibition` ほか）を全て通す。

## 6. 検証（完了前に必ず）

- `npm run build` が通る。
- ローカルで `/visit` を開き、Playwright 等でスクリーンショットを撮る（localStorage に「行きたい」を3件以上入れた状態、終了間近を1件以上含める）。PC幅とスマホ幅（390px）、0件状態。プロジェクト配下 `docs/screenshots/visit/` に保存。
- 地図上のピン位置が実際の会場と合っているかを全件目視（`venue-geo.json` の値と OpenStreetMap 上の位置を突き合わせる）。
- Vercel に反映後、本番 URL の `/visit` を開いて同じ確認をする。

## 7. 変更するファイル（最小限）

- 新規: `src/app/visit/page.tsx`、`src/components/Visit*.tsx`、`src/lib/visit.ts`(+test)、`src/hooks/useWantToGo.ts`、`src/app/api/want-to-go/route.ts`、`data/venue-geo.json`、`scripts/geocode-venues.mjs`、`scripts/lib/venue-geo.mjs`(+test)
- 変更: `src/components/TopTabs.tsx`（と TopTabs を呼ぶ各ページの型）、`src/components/ExhibitionCard.tsx`、`src/components/ExhibitionGalleryClient.tsx`、`src/app/exhibition/[slug]/page.tsx`、`src/lib/favoritesStore.ts`、`scripts/windows/run-job.mjs`（git add 対象）、`package.json`、`SPEC.md` の「地図表示は対象外」の行に本仕様への参照を追記
- 変えない: いいね・トラッシュの挙動、`data/exhibition.json` のスキーマ、Case Study / Technology / Ideas。

## 8. 運用上の注意（このリポジトリ固有）

- 日次ジョブが同じ作業ツリーを使う。開発は git worktree、main への取り込みと push は `scripts/lib/git-lock.mjs` のロックを取ってから。
- pre-push 監査は緩めない。
- implementer の完了ごとに adversarial-reviewer。
- Next.js 16 は学習データと API が異なる（`AGENTS.md`）。`next/dynamic` 等を書く前に `node_modules/next/dist/docs/` の該当ガイドを読む。
