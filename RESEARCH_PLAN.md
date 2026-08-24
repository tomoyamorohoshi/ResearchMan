# RESEARCH_PLAN.md — ResearchMan 収集方針

> 初版: 2026-07-08（実装計画 researchman-ops-routine.md バッチ2b、Sonnet 5 セッションが現行の
> 収集方針を要約して作成）。以後は `scripts/biweekly-tuneup.mjs`（ファイル名は後方互換で維持しているが
> 実体は週次実行・毎週月曜08:30）がお気に入り分析の結果に基づいて自動更新する。人手で編集しても構わないが、
> 次回チューンアップで上書きされる前提で扱うこと。

## 現在の関心仮説（2026-08-24更新）

お気に入り事例59件（全1051件中）の分布を全体分布と比較した結果、以下の偏りが明確に出た。

- **強く好まれるタグ**（お気に入り率が全体平均を大きく上回る）: Theme/Sustainability（21%）、
  Form/Stunt（15%）、Tech/Data（13%）、Tech/Audio（11%）、Theme/Retail（10%）、Tech/3D・
  Form/Website・Form/Print・Theme/Food（8%台）。データ/音声を素材にした表現、サステナビリティ/
  ソーシャルグッド訴求のスタント・OOH形式への支持が強い。
- **弱いタグ**（お気に入り率が低い、かつごみ箱率が高い＝明確な低関心シグナル）: Tech/Game
  （ごみ箱30件中16件を占める最大カテゴリ）、Theme/Entertainment（ごみ箱17件）、Form/Event
  （ごみ箱13件）、Tech/XR（ごみ箱8件）、Form/App（ごみ箱11件）。いずれもRadar由来のゲーム新作・
  VRイベント告知・展示会告知に集中しており、この種のニュース速報は関心が低いと判断できる。
- **ユーザー追加事例（33件、強い意図シグナル）は、データ/音声駆動のジェネラティブ・レスポンシブな
  ブランドID/タイポグラフィに強く集中**（San Francisco Symphony・Norwegian Academy of Music・
  Oi Responsive Logo・Whitney Museum・MIT Media Lab・Visit Nordkyn・Centersquare・Cytora・
  Forest Carbon・Philharmonie Luxembourg等）。現行3ラウンドの探索角度はこの系統を明示的にカバー
  していなかったため、ラウンド1・2のdiversity方針に反映した。
- Technology側のお気に入りは138件中4件のみで、ドメイン別の傾向を判断するには少なすぎる
  （HCI/MediaArt・Motion/Body・CreatorTools・AI/Agents・Spatial/3Dに1〜2件ずつ分散、GenVideo・
  Audio/Musicは0件だが母数46件・21件に対しサンプル数が不足）。tech.lanesとX Radarクエリは
  無理に変えず現状維持とする。

## Case Study（auto-research-cc.mjs）の探索角度 — 現行3ラウンド

`data/research-tuning.json` の `cc.roundFoci` に対応。

1. **海外の広告・クリエイティブキャンペーン + AI×クリエイティブ**（最重要）:
   lbbonline.com / contagious.com / adweek.com / campaignbrief.com / musebycl.io /
   adsoftheworld.com / itsnicethat.com / creativereview.co.uk / 広告賞の直近発表。
   広告賞ネタは全体の半分以下、生成AI活用事例を最低1件。**データ/音声駆動の生成的ブランドID・
   タイポグラフィ、サステナビリティ/ソーシャルグッド訴求のスタント・OOHを優先的に拾う（2026-08-24追加）**
2. **テック・プロダクト・XR・ゲーム・音楽×テクノロジー**（広告キャンペーン以外中心）:
   theverge.com / techcrunch.com / wired.com / creativeapplications.net / awwwards.com /
   pentagram.com / dezeen.com / designboom.com / moguravr.com / roadtovr.com / uploadvr.com /
   automaton-media.com / cdm.link / pitchfork.com / SXSW・Ars Electronica・CES。
   広告キャンペーンは最大2件。**ゲーム/XR/VR関連は最大1件に縮小（2026-08-24：ごみ箱率が全タグ中
   トップ2のため。特にゲーム新作リリース・VRイベント告知は避ける）**。新ツール/プロダクト/ライブ演出/
   映像手法/インスタレーション/データ・音声駆動のブランドID・タイポグラフィ/Web・インタラクティブ
   デザインを優先
3. **日本国内の事例 + 展示・アート・Webインタラクティブ**:
   gigazine.net / itmedia.co.jp / advertimes.com / campaign-jp.com / prtimes.jp /
   markezine.jp / 音楽ナタリー / 美術手帖 / Xでバイラル中の国内クリエイティブ。
   最低4件は日本国内の事例

## Technology（auto-research-tech.mjs）の日替わりレーン — 現行4レーン（変更なし）

`data/research-tuning.json` の `tech.lanes` に対応。お気に入り母数4件で有意な傾向を判断できないため
2026-08-24チューンアップでは変更していない。

1. **Spatial/3D**: radiancefields.com / Hugging Face Daily Papers / arXiv cs.CV・cs.GR
   (コード公開済み) / NVIDIA・Meta AIのプロジェクトページ / GitHub Trendingの3D系
2. **GenVideo・CreatorTools**: ComfyUI公式ブログ・comfy.org/workflows / Hugging Faceの
   動画系モデル・LoRA / 80.lv / GitHub Trending / Blender Extensions・UE Fab
3. **HCI/MediaArt・Audio/Music・日本語圏**: shiropen.com(Seamless) / 落合研・暦本研・筧研
   など日本のHCI研究室 / SIGGRAPH・CHI・UIST / AI音楽ツール / 日本の個人開発者のGitHub
4. **Motion/Body・AI/Agents・企業研究ラボ**: Meta AI・Google DeepMind・NVIDIA Research・
   Microsoft Researchの新着 / Hugging Faceのモーション系 / GitHub Trendingのエージェント系

## X Radar（data/x-radar-queries.json）— 現行6クエリ（変更なし）

`ComfyUI workflow` / `gaussian splatting demo` / `SIGGRAPH github` /
`TouchDesigner インスタレーション` / `AI music tool open source` / `メディアアート 展示 技術`

## 強化する源・弱める源（2026-08-24、根拠つき）

**強化**: データ/音声駆動のジェネラティブ・レスポンシブブランドID（dezeen.com・pentagram.com・
designboom.com経由が中心）、サステナビリティ/ソーシャルグッド訴求のスタント・OOH形式
（お気に入り率21%・15%、Cannes 2026経由のお気に入りが32件と最多）。

**弱める**: automaton-media.com・moguravr.com・roadtovr.com・uploadvr.com発のゲーム新作/VR
イベント告知（ごみ箱30件中24件がゲーム・XR・イベント関連に集中、お気に入りはほぼゼロ）。
Radar経由のお気に入りは59件中4件のみで、Cannes（32件）・ユーザー追加（21件）に比べ著しく低い。

## 追記: アイデア評価シグナル・切り口語彙の自動リフレッシュ（2026-07-16）

分析パス2「アイデア構造見直し」の入力に、`GET /api/idea-likes`（いいね＝強化シグナル）・
`GET /api/idea-trash`（ゴミ箱＝弱化シグナル）を追加した。詳細はOPERATIONS.md参照。

## 変更履歴

- 2026-07-08: 初版作成（バッチ2b実装時。まだチューンアップ未実行のため現状の要約のみ）
- 2026-07-16: アイデア評価シグナル（idea-likes/idea-trash）・切り口語彙自動リフレッシュを追加
- 2026-08-24: お気に入り59件・ごみ箱30件・ユーザー追加33件の分析に基づき、cc.roundFociの
  ラウンド1・2のdiversity方針を更新（データ/音声駆動ブランドID・サステナビリティ系スタントを優先、
  ゲーム/XR上限を2→1件に縮小）。tech.lanes・X Radarクエリはお気に入り母数4件で判断材料不足のため
  現状維持
