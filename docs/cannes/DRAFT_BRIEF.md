# Cannes Lions {{YEAR}} 受賞作品 → cases.json 下書き 作成指示

あなたは Cannes Lions {{YEAR}} 受賞作品を、クリエイティブ事例DB（cases.json）のエントリ下書きにする担当です。担当分（依頼文で指定された works ファイル）だけを扱います。SP = `{{SP}}`（ランナーの作業フォルダ。examples.json はその中にある）

## 入力
- 担当作品: 依頼文の works ファイル（各要素の key・title・brand・agency・country・entries＝受賞部門とレベル）
- 手本（既存の本番エントリ2件）: `SP/examples.json`。文体・長さ・日本語の書き方・tags の付け方をこれに揃える。
- tags の語彙は既存 `C:/Users/tomoy/Projects/ClaudeApps/ResearchMan/data/cases.json` で使われている tag から選ぶ（node で集計してよい。新語は作らない）。regions も既存値から選ぶ（日本の作品は「国内」、南米は「南米」）。

## やること（作品ごとに）
1. Web 検索・WebFetch で作品の中身（何をしたか・背景・実施方法・成果）を一次情報寄りの出典（ブランド/代理店の公式、業界メディア記事、YouTube の公式動画）で確認する。
2. 下書きを書く。必須: summary overview background execution evaluationImpact link（文字列）、regions tags（非空配列）。任意: videoId（YouTube の ID が確認できた時だけ）。link は作品を説明する最良の公開ページ URL。
3. サムネイル候補: 作品画像の直リンク URL（thumbnailCandidates。YouTube なら `https://i.ytimg.com/vi/<id>/maxresdefault.jpg` と hqdefault）と、og:image を持っていそうなページ URL（pageUrls）を数件ずつ。**代理店ロゴ・受賞トロフィー写真・人物の顔写真だけの画像は候補にしない**（作品そのものが写る画像を優先）。

## 禁止・注意
- **lovethework.com（Cannes 公式アーカイブ）由来の文章・数値は使わない。検索結果の抜粋に出てきたものも使わない。**
- **成果数値は、独立した報道（代理店・ブランド・応募文・他の広告賞の応募情報以外）で確認できたものだけ書く。** 代理店の事例ページ・応募情報・その孫引きの数値は書かない（「代理店の主張では」と注記して書くのも不可）。確認できなければ evaluationImpact は受賞と定性的な反響だけにする。
- 本文に作業メモ（「成果数値は確認できなかったため記載しない」「〜は不採用」等）を書かない。書かないものは黙って省く。
- 確認できない事実を書かない。{{YEAR}} 年の応募作そのものの説明が見つからず関連施策で代用した場合は本文にその旨を明記する。
- 作品の中身が応募文以外で全く確認できない作品、受賞が取り消された作品は下書きを作らず、返答で「除外: key・理由（出典URL）」と報告する。
- 一時ファイルは /tmp を使わず、SP フォルダに自分の出力ファイル名と同じ接頭辞の固有名で置く。cases.json などプロジェクトのファイルは読むだけで書き換えない。git 操作もしない。

## 出力
依頼文で指定された drafts ファイルに JSON 配列で書く。1要素＝`{"key": "<works の key>", "draft": {...}, "thumbnailCandidates": [...], "pageUrls": [...]}`。書いたら `node -e` で JSON として読めることを確認する。

## 返答（短く）
作品ごとに1行: key・主な出典ドメイン・成果数値の有無・懸念点。除外した作品とその理由。
