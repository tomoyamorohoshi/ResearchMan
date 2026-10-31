# Cannes Lions 10年分（2016–2025＋2026仕上げ）設計

2026-10-31 合意。オーナー回答: 1C（Grand Prix〜Bronze 全部）/ 2B（全受賞作を事例ページ化）/ 3B（Colab は一覧取得だけ、文章は Claude）/ 4A（10年分を同じ形・同じ監査で揃える。既存事例は残して突き合わせ）/ 5（2026 の未照合16部門・Bronze 欠落も仕上げる）。
2026-10-31 改訂: 取得元を lovethework.com → AI クローラを拒否していないサイトの Web 収集に変更（lovethework の robots.txt が ClaudeBot 等を名指しで Disallow。アクセスしない）。
2026-11-01 改訂: §3〜§8 を取り込み設計に書き換え（収集は完了済み）。

## 1. 目的
`/awards/cannes` を 2016〜2026 の11年分、公式件数と一致する受賞一覧に揃える。2026 は現状 433件・31部門中16部門未照合・Film/Film Craft/Outdoor の Bronze 欠落（OPERATIONS.md:666-694）。

## 2. スコープ
- 含む: 各年の Grand Prix / Gold / Silver / Bronze（Titanium・Glass・Grand Prix for Good・SDG 等の特別賞を含む）、全受賞作の事例ページ（サムネ・説明文）、年ごとの参照リスト、監査の多年度化。
- 含まない: Shortlist（受賞ではない）、2015 以前、Cannes 以外のアワード、表示デザインの変更、subcategory（§5-3）。

## 3. 構成とデータの流れ
```
[収集済み] data/cannes/web/<year>-web.json（2016〜2019・2021〜2025。2020 は中止＝2021 に合算）
   winners[]: {category, level, title, brand, agency, country, sources[]} / officialCounts: 部門→公式件数
        ↓ ①突き合わせ（決定的・LLM不使用）scripts/cannes-reconcile.mjs <year>
   既存 cases.json と照合 → 一致した事例に awardEntries を付与 / 未一致の既存記載を報告
   → data/cannes/work/<year>-plan.json（新規に作る作品の一覧＝事例化の入力）
        ↓ ②事例化（Claude サブスク・case-writer）部門単位のバッチ
   新規事例を作成（award 文字列＋awardEntries・サムネは acquireThumbnail）
        ↓
scripts/audit-cannes.mjs（多年度化）→ pre-push → Vercel
```

## 4. 変更対象
- 新規
  - `data/cannes/years.json`: 年ごとの状態 `reference`（一覧のみ）/ `writing`（事例化中）/ `complete`（監査 FAIL 対象）。初期値は 2016〜2025=`reference`、2026=現状維持（§5-6）。
  - `scripts/cannes-reconcile.mjs`＋test: §5-2 の照合・計画ファイル生成。
  - `scripts/lib/cannes-categories.mjs`＋test: 部門名の正規化表（§5-4）。audit・reconcile・awards.ts の判定で共有。
- 変更
  - `scripts/audit-cannes.mjs`: 年ループ化。参照リスト＝2016〜2025 は `data/cannes/web/<year>-web.json`、2026 は従来の `data/cannes2026-winners-v2.json`。`awardHasCategory` の switch を正規化表に置換。
  - `src/lib/awards.ts`: 事例に `awardEntries` があれば Cannes のコレクションはそこから作り、award 文字列の解析は使わない（無い事例は従来どおり）。
  - `docs/AWARD_RESEARCH_SOP.md`・`OPERATIONS.md` の Cannes 節。
- 削除: `data/cannes/expected-categories.json`（lovethework 取得器の網羅確認用。今後は web JSON の officialCounts が担う）、`data/cannes/2025-winners.json`（lovethework 由来。git 履歴には残る）。`scripts/colab/scrape_lovethework.py`・`scripts/fetch-cannes-winners.mjs` は使わないが履歴として残す。

## 5. 設計判断
1. **事例に構造化フィールド `awardEntries` を足す**: `[{org:"cannes", year:2023, category:"Outdoor", level:"Grand Prix"}]`。理由: 既存の award 文字列は自由記述（日本語・注記・「Finalist」・年が後ろ等。2016〜2025 の Cannes 記載104区間を実測）で、文字列のまま10年分を同じ監査に通すと誤判定が残る。award 文字列は表示と注記のために残し、書き換えない（4A＝既存は残す）。
2. **突き合わせは監査と同じ照合器を使う**（`audit-award.mjs` の title 完全一致／brand 一致＋Jaccard≥0.3）。対象は全 cases（年をまたいで1つの事例が複数年受賞するため）。
   - 一致: その事例に awardEntries を追記。award 文字列に当該年の Cannes 記載が無ければ正規形（§5-5）を末尾に追記。
   - 既存の Cannes 2016〜2025 記載で参照リストに無いもの: 報告のみ（キャンペーン総称名・Shortlist・年違い・2020 表記）。年ごとの ALIAS（`data/cannes/aliases.json`）で解消し、事例の award 文字列は自動では直さない。
3. **subcategory は足さない**: web JSON に無く、取るには部門別 PDF の再解析が要る。同じ作品が同部門・同レベルで複数行あるもの（サブ部門違い）は1つの awardEntry に畳む。事例ページの単位は「年×作品（title＋brand の正規化キー）」。実測の作品数: 2016=763・2017=822・2018=683・2019=537・2021=524・2022=453・2023=499・2024=464・2025=469（計5,214。一部は既存事例と一致して新規にならない）。
4. **部門名はその年の公式名のまま**（Cyber / Mobile / Radio → Radio & Audio → Audio & Radio、Social & Influencer → Social & Creator、Creative eCommerce → Creative Commerce 等）。年をまたいだ名寄せはしない。照合用の正規化表で区別が要るのは: Film と Film Craft、Design と Product Design、Entertainment と Entertainment Lions for Music/Sport/Gaming、Grand Prix for Good と Lions Health Grand Prix for Good（2018 は両方ある）、Creative Commerce と Creative eCommerce。
5. **新規事例の award 文字列は正規形**: `Cannes Lions <year> <公式部門名> Lions <Level>`（部門名が "Lions" を含む・"Glass: The Lion for Change"・"Titanium" 等は二重にしない）。複数受賞は " / " 区切り。`/awards/cannes` の既存 2026 コレクションの slug は変えない（変更前後で slug 一覧が同じことをテストで確認）。
6. **pre-push を止めない**: `years.json` が `complete` でない年は WARN のみ。事例化が終わり `audit:cannes:strict` が通った年だけ `complete` にする（2026-07-31〜08-07 の push 8日滞留の再発防止）。2026 は現状の FAIL 条件（照合済み15部門のレベル不一致）を維持。
7. **事例化は1年ずつ・1セッション1年**、2025 → 2016 の順、最後に 2026。キャンペーンの個別展開（同 brand＋agency で title 違い）は事例化時に case-writer へ「同じキャンペーンなら1事例にまとめ、他の行は ALIAS に記録」と指示する（機械では判定しない）。

## 6. 2026 の仕上げ
- 2025 と同じ取得元（reasonwhy.es の部門別 PDF）で `data/cannes/web/2026-web.json` を作り、v2（434件）と部門ごとに差分を出す。未照合16部門と Bronze 欠落を web 版で確定し、v2 は履歴として残す。
- 確定後に 2026 の参照リストを web 版へ切り替え、照合済み部門を全31部門に広げる。

## 7. リスク・未決
- **Claude の使用量**: 新規事例は最大約5,200件で過去最大。2025 の最小部門で使用量と所要時間を実測し、年あたりの見込みを報告してから続ける。週の上限に当たる場合は日数を延ばす（従量課金は使わない）。
- 取得元の規約: 主催者の Delegate Terms clause 34（書面同意なしの AI 入力・DB 化を禁止）は参加者向け規約。受賞一覧の出典は reasonwhy.es・bizcommunity 等の公開記事（robots 許可を確認済み）。事例の文章は各作品の公開情報から書き、受賞一覧を丸ごと転載しない。
- データの残課題（手動確認）: 2022 SDG の17件欠け、2016 の件数（独立確認4部門のみ）、2025 Titanium 1件・Creative Data 件数不明・Luxury 部門が 2025 に無い（2024・2026 にはある）、2017 Cyber GP の brand 混入、2018 Music Silver の重複疑い。
- cases.json と Blob 配信サイズの増加（+5,000件前後で現在の約4倍）。/awards と / の表示速度を各年の完了時に確認。

## 8. 検証
- 突き合わせ: `node scripts/cannes-reconcile.mjs <year> --dry-run` の報告（一致・未一致・新規件数）が web JSON の作品数と合計一致。
- 監査: `npm run audit:cannes`（全年 WARN 以下）、その年の `npm run audit:cannes:strict`。
- 既存テスト: `npm run test:exhibition`、`node --test scripts/lib/*.test.mjs scripts/*.test.mjs`、サムネ監査。
- e2e: その年を `complete` にして push → `https://research-man.vercel.app/awards/cannes` でその年の各部門ページが開き、部門ごとの作品数が web JSON の作品数（§5-3 の単位）と一致する。
