# RESEARCH_PLAN.md — ResearchMan 収集方針

> 初版: 2026-07-08（実装計画 researchman-ops-routine.md バッチ2b、Sonnet 5 セッションが現行の
> 収集方針を要約して作成）。以後は `scripts/biweekly-tuneup.mjs`（ファイル名は後方互換で維持しているが
> 実体は週次実行・毎週月曜08:30。2026-07-14に隔週/毎月1・15日から変更）が
> お気に入り分析の結果に基づいて自動更新する。人手で編集しても構わないが、次回チューンアップで
> 上書きされる前提で扱うこと。

## 現在の関心仮説

初版時点ではお気に入りサーバ同期（バッチ1）が稼働したばかりで蓄積が無いため、関心仮説は
「デジクリラジオの興味プロファイル」（既存の `auto-research-cc.mjs` 冒頭コメント参照）を
そのまま引き継ぐ。次回チューンアップ以降、お気に入り分布（Case Studyのtags / Technologyの
domains）が全体分布よりどこに偏っているかを見て、ここを更新する。

- Case Study: 広告賞に限らず「デジタル×クリエイティブ」全域を広く収集する（厳選しない）
- Technology: Spatial/3D・GenVideo/CreatorTools・HCI/MediaArt/Audio/Music（日本語圏厚め）・
  Motion/Body/AI-Agents の4レーンを均等ローテーション

## Case Study（auto-research-cc.mjs）の探索角度 — 現行3ラウンド

`data/research-tuning.json` の `cc.roundFoci` に対応（外部化前のハードコードと完全一致）。

1. **海外の広告・クリエイティブキャンペーン + AI×クリエイティブ**（最重要）:
   lbbonline.com / contagious.com / adweek.com / campaignbrief.com / musebycl.io /
   adsoftheworld.com / itsnicethat.com / creativereview.co.uk / 広告賞の直近発表。
   広告賞ネタは全体の半分以下、生成AI活用事例を最低1件含める
2. **テック・プロダクト・XR・ゲーム・音楽×テクノロジー**（広告キャンペーン以外中心）:
   theverge.com / techcrunch.com / wired.com / creativeapplications.net / moguravr.com /
   roadtovr.com / uploadvr.com / automaton-media.com / cdm.link / pitchfork.com /
   dezeen.com / designboom.com / SXSW・Ars Electronica・CES。広告キャンペーンは最大2件
3. **日本国内の事例 + 展示・アート・Webインタラクティブ**:
   gigazine.net / itmedia.co.jp / advertimes.com / campaign-jp.com / prtimes.jp /
   markezine.jp / 音楽ナタリー / 美術手帖 / Xでバイラル中の国内クリエイティブ。
   最低4件は日本国内の事例

## Technology（auto-research-tech.mjs）の日替わりレーン — 現行4レーン

`data/research-tuning.json` の `tech.lanes` に対応。

1. **Spatial/3D**: radiancefields.com / Hugging Face Daily Papers / arXiv cs.CV・cs.GR
   (コード公開済み) / NVIDIA・Meta AIのプロジェクトページ / GitHub Trendingの3D系
2. **GenVideo・CreatorTools**: ComfyUI公式ブログ・comfy.org/workflows / Hugging Faceの
   動画系モデル・LoRA / 80.lv / GitHub Trending / Blender Extensions・UE Fab
3. **HCI/MediaArt・Audio/Music・日本語圏**: shiropen.com(Seamless) / 落合研・暦本研・筧研
   など日本のHCI研究室 / SIGGRAPH・CHI・UIST / AI音楽ツール / 日本の個人開発者のGitHub
4. **Motion/Body・AI/Agents・企業研究ラボ**: Meta AI・Google DeepMind・NVIDIA Research・
   Microsoft Researchの新着 / Hugging Faceのモーション系 / GitHub Trendingのエージェント系

## X Radar（data/x-radar-queries.json）— 現行6クエリ

`ComfyUI workflow` / `gaussian splatting demo` / `SIGGRAPH github` /
`TouchDesigner インスタレーション` / `AI music tool open source` / `メディアアート 展示 技術`

## 強化する源・弱める源

初版時点では判断材料なし（お気に入り蓄積を待つ）。次回チューンアップが、
お気に入り事例・技術のtags/domains分布が全体分布よりどこに偏っているかを根拠に、
このセクションを具体的な源の名前つきで更新する。

## 変更履歴

- 2026-07-08: 初版作成（バッチ2b実装時。まだチューンアップ未実行のため現状の要約のみ）
