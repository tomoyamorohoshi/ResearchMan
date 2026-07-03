# Technology タブ — キュレーション仕様 v1.1

> 2026-07-03 ユーザー合意 + 実ブックマーク24件の分析から体系化。
> 目的: **ユーザーが Case Study のようなアイデアを生むための、ヒントと技術のリサーチ**。
> 運用全般は OPERATIONS.md、実装設計は着手時に DESIGN.md を作成。

## 0. キュレーションの北極星

実ブックマーク24件の分析から導出した、このタブが集めるべきものの定義:

> **「映像・空間・身体表現の制作パイプラインを変える技術」を、デモが見える形で。**

- 全24件に共通: **デモ映像・実例で「何がすごいか」が10秒でわかる**
- 論文そのものではなく「これで何が作れるようになるか」への関心
- 研究(コード付き)・現場ツール(UE/Blender/ComfyUI/DaVinci)・作ってみた検証が等価に混在
- 日英両方。企業研究(Meta/NVIDIA/Google)も個人開発者も等価

## 1. 採用クライテリア

### 型（3分類・カードにバッジ表示）

| 型 | 定義 | コード公開 | 実例(ブクマより) |
|---|---|---|---|
| **Research** | AI/HCI/CG/先端メディアの研究 | **GitHub等で技術の核の公開が必須**。論文のみは不採用 | ArtiFixer(NVIDIA)、One4D、Multi-View Foundation Models、LeviFab |
| **Prototype** | SNS発の実験作・検証・作ってみた | 不要。**動くデモが映像で確認できる**こと | UE5.8 Mocap×AIレンダリング検証、Claude×Splice MCPビートメイク、Seedanceワークフロー |
| **Tool** | クリエイターが実際に使えるツール | 原則OSS。**有償でも制作現場を変えるものは可**(実測データ等の独自性があるもの) | AURORA Film Lab(DaVinci)、CEB SAM 3D(Blender)、LTX Video Edit Lora |

※ v1.0からの変更: Toolの「OSS必須」を緩和。ブクマ実態(AURORA Film Lab=有償)に合わせ、
「クリエイターがすぐ使える+技術的独自性」を優先。商用利用可否バッジで補完する。

### Domain タグ（実ブックマークの分布から確定・7種）

| Domain | 対象 | ブクマ内シェア |
|---|---|---|
| `Spatial/3D` | 3D/4D再構成・Gaussian Splatting・NeRF・World Model・VPS・パノラマ生成 | ★★★★★ 最多 |
| `Motion/Body` | モーションキャプチャ・キャラクターアニメーション・骨格推定 | ★★★★ |
| `GenVideo` | 生成AI映像・動画編集AI・モーション制御 | ★★★ |
| `CreatorTools` | DCCツール拡張(UE/Blender/ComfyUI/DaVinci)・グレーディング・VFX | ★★★ |
| `AI/Agents` | 基盤モデル・オープンモデル・MCP/エージェント活用 | ★★ |
| `HCI/MediaArt` | インタラクション研究・メディアアート・ディスプレイ・触覚 | ★★ |
| `Audio/Music` | AI音楽制作・音響技術 | ★ |

Type(Research/Prototype/Tool) × Domain の2軸ハッシュタグ。語彙は `data/tech-tag-vocabulary.json` で管理。

### 品質バー（全型共通）
1. 一次ソース（元ポスト / リポジトリ / プロジェクトページ）に到達できる
2. 内容が伝わるサムネイルが取得できる
3. **デモ・実例が視覚的に確認できる**（「何ができるか」が見えないものは除外）
4. 技術的な新規性または craft（既存APIの薄いラッパー・単なるチュートリアルは除外）
5. **アイデアの種になるか**: 「この技術で広告・体験は何が作れるか」を1行で言えること
   （記事化時に必ずこの観点を「技術のポイント」へ含める）

### 除外
- 商用キャンペーン・広告事例（→ Case Study側）
- コードも実物デモもない製品発表・コンセプト映像
- 論文のみでコード未公開の研究
- 単なるモデルのバージョンアップ告知（新しい能力のデモがあれば可）
- **Case Studyとの重複**（ID・正規化タイトル・リンクドメインの3重チェックで機械排除）

## 2. 検索対象メディアリスト

### Tier 1 — 日次自動探索の主要ソース（機械アクセス可能）

| ソース | 対象Domain | 方法 |
|---|---|---|
| Hugging Face Daily Papers | Spatial/3D, GenVideo, AI | 公開ページ。コード/デモ付きを優先 |
| GitHub Trending (Python/C++/Jupyter) | 全Domain | 公開ページ。AI/graphics系リポジトリ |
| RadianceFields.com | Spatial/3D | GS/NeRF専門メディア |
| arXiv (cs.CV / cs.GR / cs.HC) + コード有無 | Research全般 | 新着からコード公開済みのみ |
| Seamless(shiropen.com) | HCI/MediaArt, AI | 日本語の先端研究紹介。日本の研究室情報源 |
| 80 Level | CreatorTools, Spatial/3D | UE/Blender/VFXの現場ツール |
| Google DeepMind / Meta AI / NVIDIA Research ブログ | AI, Spatial/3D | 企業研究のリリース |
| ComfyUI Blog / Blender新着アドオン | CreatorTools, GenVideo | ワークフロー系 |

### Tier 2 — X ウォッチリスト（ブクマ24件の投稿者から体系化）

X はAPIなしでタイムライン自動取得が不可のため、**(a)ユーザーの手動ブクマ連携で拾う、
(b)日次リサーチのWebSearchでアカウント名を検索語に含める**、の2経路で活用する。

| クラスタ | アカウント |
|---|---|
| 研究キュレーター | `_akhaliq`(HF/論文), `RadianceFields`(GS/NeRF), `bilawalsidhu`(空間AI), `tokufxug`(3D/空間・日本語解説), `ai_hakase_`(AI新着・日本語), `HowToPrompt__` |
| 研究者本人 | `Or_Hirsch`(3D生成), `danxuhk`(CV), `Nik__V__`(3D/4D/World Model), `antoine_guedon`(3D再構成), `labDNG`(落合研・HCI) |
| テクニカルアーティスト/検証系 | `akasaki1211`(TA・mocap), `KakuDrop`(UE×AI検証), `carlosedubarret`(Blenderツール), `SD_Tutorial`, `Viggle_PINOC`(生成映像WF), `d_daniel_film`(カラー/映像ツール) |
| 実験系クリエイター | `DJTAKISHIT`(AI×音楽), `pablovelagomez1`(ロボティクス×クリエイティブ), `IlirAliu_`(AI/ロボティクス) |

新しいブクマ連携のたびに投稿者をこのリストに追記して育てる。

### Tier 3 — 定点観測（頻度低め・学会シーズンに厚く）

- 学会: SIGGRAPH / CVPR / ECCV / ICCV / UIST / CHI（採択作のプロジェクトページ+コード）
- 日本: 落合研(Digital Nature Group) / Rhizomatiks / WOW など研究型スタジオの発表

### 静的参照（更新されない・日次チェック対象外）

- デジクリラジオ Notion DB（**共有用の静的コピーで今後更新なし** — 2026-07-03ユーザー確認。
  Notion MCP: `collection://ab26481a-d452-82a9-978d-076e0f108758`、1,290件・2021〜2026-06）
  用途: 過去事例の参照と、ユーザーの興味領域のキャリブレーション材料。バックフィル候補の発掘にも使える

## 3. 情報ソースの取り込みフロー

| 経路 | 方法 | 頻度 |
|---|---|---|
| Xブックマーク | ユーザーが `data/inbox/x-bookmarks-*.txt` にURL列挙 or チャットで貼付 → oEmbed(publish.twitter.com)で本文取得 → 検証・記事化 | ユーザー任意 |
| Tier 1 自動探索 | 日次リサーチ(Claude CLI)がメディアリストを巡回 | 日次 |
| デジクリラジオ | 静的アーカイブ（更新なし）。バックフィル候補・嗜好参照のみ | 随時（日次対象外） |

## 4. カード構成

- **サムネイル = 技術のキービジュアル**（2026-07-03ユーザーフィードバック）:
  デモ画像・ティザーなど「どんな技術か読み取れる」画像を使う。GitHubのOGPカードや
  Hugging Faceソーシャルカード等のテキスト画像・ロゴは不可（自動取得の最終フォールバックのみ）。
  優先順: プロジェクトページog:image > READMEティザー画像 > 動画サムネ（`scripts/tech-thumbs.mjs`）。
  手動差し替えは `node scripts/set-tech-thumbnail.mjs <id> <imageUrl>`（ローカル保存・照合検証つき）
- **技術の概要**: 1〜2行
- **技術のポイント**: 大学生にもわかるライトな文章で「何がすごいか」+ **「何が作れそうか」のヒント**を1段落（350〜500字）
- **技術の詳細**（2026-07-03追加）: 仕組み・従来との違い・使うのに必要なもの（機材/費用/スキル）を、
  技術者でなくてもわかるように具体的に。2〜3段落（450〜700字）

**文体ルール（ユーザーフィードバック 2026-07-03）**: 端的に書きすぎない。
**文章量が増えてもわかりやすさを優先**する。専門用語には必ず言い換えか身近な例えを添える。
- **情報ソースリンク**: GitHub / 元ポスト / プロジェクトページ / 論文 を種別つきで並記
- **関連作品・研究**
- **商用利用可否バッジ**:
  `商用OK`(MIT/Apache等) / `条件付き`(GPL/CC-BY-NC等、条件注記) / `研究用途のみ` / `有償ツール` / `—`(Prototype等)
- **ハッシュタグ**: Domain × Type の2軸（§1）

## 5. データ・表示

- `data/tech.json` を cases.json と完全分離。`/technology` を別ルートで SSG
- タブUIはページ間リンク → **現行TOPのペイロード増なし**
- タグ語彙は `data/tech-tag-vocabulary.json` で管理し、語彙外タグは捨てる（Case Study方式踏襲）

## 6. 運用

- **Step 0（パイロット）**: ✅完了（2026-07-03）。ブクマ16件＋追加リサーチ24件=計40件を公開済み
- **Step 1（日次）**: ✅稼働中（2026-07-03〜）。launchd `com.researchman.techresearch` が
  毎時起動+23hゲートで1日1回、Tier 1ソースを4レーン日替わりで巡回（日次3件上限・厳選）。
  発見→機械検証→デプロイ→新規ページ200確認→LINE通知まで全自動。詳細は OPERATIONS.md §1

## 7. 未確定事項

- Tier 1 の巡回実装の詳細（実装時にDESIGN.mdで確定）
- 有償ツールの採用バー（Step 0 パイロットの結果を見てユーザーと調整）
