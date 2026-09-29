# 情報源ベイクオフ結果 2026-09-30

- 生成: `scripts/bakeoff-sources.mjs`（設計書 docs/RADAR_V2_DESIGN.md §4-8）。kind=web のみ。1候補1回のClaude CLI呼び出しで、一覧ページの直近最大10件を取得し、関門A/B/C基準（`scripts/lib/case-gate-criteria.mjs`）で採点。
- 採点済み 55 候補（取得成功 52 / 取得失敗 3）。cases.json・sources.json は変更していない（read-only）。
- **読み方**: accept率 = 関門A/B/Cのいずれかを満たした件数 ÷ 取得件数。1候補あたり最大10件の**小標本**なので、±20pt程度の揺れは誤差。tier案は目安（件数5件以上で accept率50%↑=tier1、30%↑=tier2、それ未満=見送り）。最終判断（`enabled`/`tier`）はオーナー。
- 採点はモデルが一覧のタイトル・要約から行うため、告知記事の見抜きは得意だがクラフト(B)の過大評価に注意。代表例は必ず目視で確認すること。
- **既知のバイアス**: 採点は一覧のタイトル・要約のみ（本文は開かない）。ブランドID系（リブランド紹介）・受賞/審査系の媒体は「要点が本文にある」ため過小評価されやすい。逆に制作会社の作品一覧は「企画そのもの」が題名になるため accept 寄りに出る。0%は「事例が無い」ではなく「一覧の要約からは判定不能」を含む。0%の媒体を除外する前に代表的な記事を目視すること。

## 結果（accept率の高い順）

| 情報源 | 現tier | 件数 | accept率 | 基準内訳 | tier案 | 代表例（最大3件） |
|---|---|---|---|---|---|---|
| creapills | 1 | 10 | 70% (7/10) | A7 / B0 / C0 | tier1推奨 | [Pizza Hut transforme sa boîte en marchepied pour aider les p](https://creapills.com/boite-pizza-hut-concert-platform-20260929) (A: ピザ箱を踏み台に読み替え、子供の視界を確保)<br>[En Suède, ce sauna public prend la forme d'un cristal de lit](https://creapills.com/lithium-crystal-sauna-suede-20260929) (A: 巨大リチウム結晶を公共サウナに読み替え)<br>[Ce fabricant de tuiles détourne les codes de la tech pour pr](https://creapills.com/tuiles-beton-infinite-bmi-monier-smartphone-tech-20260928) (A: 瓦をスマホ広告文法で見せる一文の企画) |
| konel | 3 | 10 | 60% (6/10) | A5 / B0 / C1 | tier1推奨 | [Pulse Pack](https://www.konel.co.jp/works/pulsepack/) (A: 心拍に同期して反応するバッグ。一文で言える)<br>[ZZZN SLEEP APPAREL SYSTEM](https://www.konel.co.jp/works/zzzn_sleep_apparel_system/) (A: 眠りを持ち運べる服という一文の核がある)<br>[AI中原昌也「声帯で小説を描く！」](https://www.konel.co.jp/works/ai_nakahara_masaya/) (A: 身体機能を失った作家とAIの対話で新作小説を作る) |
| designboom | 2 | 10 | 50% (5/10) | A4 / B1 / C0 | tier1推奨 | [MSCHF Bends and Twists LEXUS Cars Into Surreal Full-Scale Sc](https://www.designboom.com/design/mschf-bends-twists-lexus-cars-surreal-sculptures-new-york-motomorphosis/) (A: 実車を曲げ捻り彫刻に読み替える一文の企画)<br>[Each Season, Vienna State Opera Turns Its Safety Curtain Int](https://www.designboom.com/art/safety-curtain-series-contemporary-art-center-stage-vienna-state-opera/) (A: 防火幕を毎季の展示面に読み替える)<br>[Illya Goldman Gubin Embraces Cardboard Boxes, Shaping Them I](https://www.designboom.com/design/bottega-veneta-cardboard-boxes-sculptural-stools-summer-2027-show-illya-goldman-gubin/) (A: 段ボール箱という廃素材を彫刻的な椅子にする) |
| creativeboom | 2 | 10 | 50% (5/10) | A4 / B1 / C0 | tier1推奨 | [Listen to Jordic: The unlikely heart warning men need to hea](https://www.creativeboom.com/news/listen-to-jordic-the-unlikely-voice-of-a-heart-health-warning-for-men/) (A: 意外な声で男性に心臓の警告を届ける広告の着想)<br>[Why a laundry brand made four T-shirts you're not supposed t](https://www.creativeboom.com/news/why-a-laundry-brand-made-t-shirts-youre-not-supposed-to-wash/) (A: 洗濯ブランドが洗えないTシャツを作る逆転の発想)<br>[Faith In Nature turns a '90s rave anthem into 'Bees R Good' ](https://www.creativeboom.com/news/faith-in-nature-turns-a-90s-rave-anthem-into-bees-r-good-for-its-first-ever-tv-ad/) (A: 90年代レイヴ曲をミツバチ賛歌に読み替えたTV広告) |
| creativeapplications | 2 | 10 | 50% (5/10) | A5 / B0 / C0 | tier1推奨 | [Drone – Tethered to its power cable, a batteryless drone swi](https://www.creativeapplications.net/member/drone-tethered-to-its-power-cable-a-batteryless-drone-swings-in-the-space/) (A: 電池を外し有線給電にしたドローンの映像を周囲画面へ配信)<br>[Mars Terrain Playback – Exploring non-extractive futures and](https://www.creativeapplications.net/project/mars-terrain-playback-exploring-non-extractive-futures-and-intimacy-with-unknown-worlds/) (A: 探査機の火星走行を小型電動車で再現する一文企画)<br>[Tessera – A file network with no infrastructure](https://www.creativeapplications.net/member/tessera-a-file-network-with-no-infrastructure/) (A: ロケット型ペンダントにmicroSDを入れ持ち歩くファイル網) |
| dentsulabtokyo | 3 | 10 | 50% (5/10) | A3 / B0 / C2 | tier1推奨 | [Snow Power Lab](https://dentsulab.tokyo/works/snow-power-lab/) (A: 雪のエネルギーを表現メディアに読み替える)<br>[FANTOUCHIE: Generative Haptic AI](https://dentsulab.tokyo/works/fantouchie/) (C: 言葉を触覚に変換する生成AIという技術新規性)<br>[Let's Call PaBaMa](https://dentsulab.tokyo/works/lets-call-pabama/) (A: 名前を呼ぶだけで口話トレーニングになる遊び) |
| contagious | 1 | 8 | 50% (4/8) | A4 / B0 / C0 | tier1推奨 | [Channel 4, Together Against Hate](https://www.contagious.com/en/article/news-and-viewschannel-4-together-against-hate-95f726f8020c4d5580890ea06d58b165) (A: CM枠をまるごと俳優への中傷読み上げに転用と一文で言える)<br>[Toyota turns everyday New Zealand streets into its biggest a](https://www.contagious.com/en/article/news-and-viewscampaign-of-the-week-toyota-turns-everyday-new-zealand-streets-into-its-biggest-ad-77586705c55345f4b24ff162f9893aec) (A: 日常の街路そのものを広告媒体に読み替える)<br>[Runway turns AI filmmaking into a game of HORSE](https://www.contagious.com/en/article/news-and-views/rules-of-horse-for-dummies-9976c0fd0bf7473d91e975965a5be588) (A: バスケのHORSEをAI映像生成の応酬に見立てた) |
| adsofbrands | 3 | 8 | 38% (3/8) | A3 / B0 / C0 | tier2推奨 | [R.S.I. - Road Safety Institute: IV Drinks, 3](https://www.adsofbrands.net/en/ads/r-s-i-road-safety-institute-iv-drinks-3/17557) (A: 酒を点滴に見立てる読み替え。連作3本)<br>[R.S.I. - Road Safety Institute: IV Drinks, 2](https://www.adsofbrands.net/en/ads/r-s-i-road-safety-institute-iv-drinks-2/17556) (A: 同キャンペーン。酒=点滴の読み替え)<br>[R.S.I. - Road Safety Institute: IV Drinks, 1](https://www.adsofbrands.net/en/ads/r-s-i-road-safety-institute-iv-drinks-1/17555) (A: 同キャンペーン。酒=点滴の読み替え) |
| muse-by-clio | 2 | 10 | 30% (3/10) | A2 / B1 / C0 | tier2推奨 | [Patreon and Tabletop Gamers Roll Big—Very Big—With Ginormous](https://musebyclios.com/gaming/patreon-and-tabletop-gamers-roll-big-very-big-with-giant-d20-die/) (B: 高さ1.8mの巨大D20を実物制作。クラフト性あり)<br>[Painting a New Picture of Rescue Dogs for Those Considering ](https://musebyclios.com/advertising/painting-a-new-picture-of-rescue-dogs-for-those-considering-pet-adoption/) (A: 保護犬を画風で描き替え里親募集に読み替える)<br>[This Auto Museum in Brussels Sent Its Classic Cars Into the ](https://musebyclios.com/eurovisions/this-auto-museum-sent-its-classic-cars-into-the-streets-as-taxis/) (A: 博物館の展示車を街のタクシーに読み替える) |
| colossal | 2 | 10 | 30% (3/10) | A2 / B1 / C0 | tier2推奨 | [Niklas Roy Constructs a Functional Pendulum Clock Made Entir](https://www.thisiscolossal.com/2026/09/niklas-roy-glashutte-trash-clock-mechanical-sculpture/) (A: ゴミを素材に実働する振り子時計を作る、一文で言える企画)<br>[A Giant Gold Coil by Plastique Fantastique Created a Loopy P](https://www.thisiscolossal.com/2026/09/auroboros-plastique-fantastique-high-line-inflatable-sculpture/) (B: 巨大な金色の膨張式ループ彫刻。公共空間での造形が固有)<br>[On Concrete Remnants of London's Aylesbury Estate, Harriet M](https://www.thisiscolossal.com/2026/09/harriet-mena-hill-aylesbury-estate-paintings/) (A: 解体された団地のコンクリ片を画布に地域を記録) |
| adsoftheworld | 1 | 10 | 20% (2/10) | A2 / B0 / C0 | 見送り | [Villains! - Blocking Scammers - Telstra](https://www.adsoftheworld.com/campaigns/villains-blocking-scammers) (A: 詐欺師を悪役に見立てブロックを訴求と一文で言える)<br>[Make Menopause less Hellish - Apoteket](https://www.adsoftheworld.com/campaigns/make-menopause-less-hellish) (A: 更年期を地獄に例え体験を可視化する読み替え) |
| campaignbrief | 1 | 10 | 20% (2/10) | A2 / B0 / C0 | 見送り | [KFC 'boybands' its new chicken tenders to make them even ten](https://campaignbrief.com/kfc-boybands-its-new-chicken-tenders-to-make-them-even-tenderer-in-new-campaign-via-special/) (A: 「テンダーをボーイバンド化」と一文で言える企画)<br>[Support Act urges Aussies to 'Keep Aussie Music On Rotation'](https://campaignbrief.com/support-act-urges-aussies-to-keep-aussie-music-on-rotation-for-ausmusic-t-shirt-day-in-new-campaign-via-bring/) (A: 「コインランドリーで音楽を回す」に読み替えた企画) |
| pentagram | 3 | 10 | 20% (2/10) | A1 / B1 / C0 | 見送り | ['In Defense of the Detour'](https://www.pentagram.com/work/in-defense-of-the-detour) (B: AI時代の「遠回り」をNYT向けビジュアルエッセイで表現)<br>[Cass Art King's Cross Store](https://www.pentagram.com/work/cass-art-king-s-cross-store) (A: 名画の素材・化学を店舗グラフィックに読み替える) |
| clios | 2 | 10 | 20% (2/10) | A2 / B0 / C0 | 見送り | [Fintech Firm Ramp Takes Its 'Bill Pay' Platform to Broadway—](https://musebyclios.com/music/fintech-firm-ramp-takes-its-bill-pay-platform-to-broadway-for-1-night-only/) (A: 請求書支払いをブロードウェイ1夜限りの舞台に読み替え)<br>[Let's Buy a Plushie That Makes Piercing Data-Center Sounds!](https://musebyclios.com/music/lets-buy-a-plushie-that-makes-piercing-data-center-sounds/) (A: データセンターの騒音をぬいぐるみの音に置換) |
| famouscampaigns | 3 | 10 | 20% (2/10) | A2 / B0 / C0 | 見送り | [Aldi unveils jacket that transforms into a shopping bag](https://www.famouscampaigns.com/2026/09/aldi-turns-a-jacket-into-the-shopping-bag/) (A: 上着を買い物袋に変える。一文で言える)<br>[IKEA turns FRAKTA into a portrait of everyday Italy](https://www.famouscampaigns.com/2026/09/ikea-turns-frakta-into-a-portrait-of-everyday-italy/) (A: FRAKTA袋を日常イタリアの肖像に読み替え) |
| cbcnet | 3 | 10 | 20% (2/10) | A2 / B0 / C0 | 見送り | [「ダウンロード」しかないオンライン書店「TRANS BOOKS DOWNLOADs」期間限定オープン](https://www.cbc-net.com/topic/2020/06/transbooks-downloads/) (A: 「ダウンロード商品だけの書店」と一文で言える)<br>[トクマルシューゴ「BRICOLAGE MUSIC」](https://www.cbc-net.com/log/?p=9067) (A: 参加者が音を持ち寄り曲を作る仕組み) |
| lovethework | 3 | 6 | 17% (1/6) | A1 / B0 / C0 | 見送り | [CHEAT CODES](https://www.lovethework.com/en/work/entries/cheat-codes-770565) (A: 家電をゲームの入力装置に読み替え家の改善を報酬化) |
| rhizomatiks | 3 | 7 | 14% (1/7) | A0 / B0 / C1 | 見送り | [WORLD FENCING LEAGUE（LA）にて「Fencing Visualized」が実戦に導入](https://rhizomatiks.com/news/2026/04/17/world_fencing_league_fencing-visualized/) (C: フェンシングの試合を可視化する技術を実戦導入) |
| itsnicethat | 1 | 10 | 10% (1/10) | A1 / B0 / C0 | 見送り | [Nomka Enkhee's whimsical cartoons are made up of mundane obj](https://www.itsnicethat.com/articles/nomka-enkhee-art-illustration-discover-290926) (A: 日用品を筆記体の字形で読み替えたキャラクター) |
| dezeen | 1 | 10 | 10% (1/10) | A1 / B0 / C0 | 見送り | [City Girls lamps are designed to look like outfits casually ](https://www.dezeen.com/2026/09/29/city-girls-lamps-london/) (A: 古着や廃材で「雑に着せた服」を照明に読み替え) |
| campaignbrief-asia | 2 | 10 | 10% (1/10) | A1 / B0 / C0 | 見送り | [McCann India turns Piyush Mishra's 'Maine Pyar Kiya' regret ](https://campaignbriefasia.com/2026/09/29/mccann-india-turns-piyush-mishras-maine-pyar-kiya-regret-into-flipkarts-iphone-bbd-campaign/) (A: 俳優の後悔を セール訴求に読み替える一文企画) |
| the-brandidentity | 2 | 10 | 10% (1/10) | A1 / B0 / C0 | 見送り | [Six designers on your wrist. Introducing the FCKLCK Anti Cha](https://the-brandidentity.com/project/six-designers-seven-charms-one-bracelet-this-is-fcklcks-anti-charm) (A: 6人のデザイナーで1つのブレスレットを作る企画が一文で言える) |
| typeroom | 3 | 10 | 10% (1/10) | A1 / B0 / C0 | 見送り | [Blending Sound and Typography: The Art of Jonathan Mak](https://www.typeroom.eu/jonathan-mak-where-sound-meets-type) (A: 音と文字を融合し一文で言える表現の発想) |
| dinamo | 3 | 10 | 10% (1/10) | A1 / B0 / C0 | 見送り | [Artist Stefan Marx's Own Scribbles Turned Into a Living Hand](https://abcdinamo.com/news/stefan-marx-font-release) (A: アーティストの殴り書きを生きた手書きフォントに読み替え) |
| stirworld | 3 | 10 | 10% (1/10) | A1 / B0 / C0 | 見送り | [Multitude of Sins turns building waste into eerie funk at Ma](https://www.stirworld.com/see-features-multitude-of-sins-turns-building-waste-into-eerie-funk-at-material-lab) (A: 建築廃材を家具・作品に読み替える一文の企画) |
| bpando | 1 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| brand-innovators | 1 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| creativereview | 1 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| campaignbrief-nz | 2 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| brandnew | 2 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| fontsinuse | 3 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| collins | 3 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| wolffolins | 3 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| dandad | 2 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| oneshow | 2 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| campaignlive | 2 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| wallpaper | 3 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| advertimes | 3 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| brain | 3 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| axis | 3 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| jagda | 3 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| whatever | 3 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| bassdrum | 3 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| automaton | 3 | 10 | 0% (0/10) | A0 / B0 / C0 | 見送り | - |
| tcc | 3 | 9 | 0% (0/9) | A0 / B0 / C0 | 見送り | - |
| adage-creativity | 2 | 8 | 0% (0/8) | A0 / B0 / C0 | 見送り | - |
| ars-electronica | 3 | 8 | 0% (0/8) | A0 / B0 / C0 | 見送り | - |
| jkr | 3 | 7 | 0% (0/7) | A0 / B0 / C0 | 見送り | - |
| gooddesign | 3 | 7 | 0% (0/7) | A0 / B0 / C0 | 見送り | - |
| natalie | 3 | 6 | 0% (0/6) | A0 / B0 / C0 | 見送り | - |
| acc | 3 | 4 | 0% (0/4) | A0 / B0 / C0 | 保留(件数不足) | - |
| tha | 3 | 1（重複除去9） | 0% (0/1) | A0 / B0 / C0 | 保留(件数不足) | - |

## 取得失敗

| 情報源 | URL | 理由 |
|---|---|---|
| lbbonline | https://lbbonline.com/news | WebFetchが https://lbbonline.com/news と /news/channels/3 の両方で403。WebSearchでは最新記事の一覧を取得できず（検索結果は業界記事・Work of the Weekなど個別作品でない断片のみ）、採点可能な10件を特定できなかった。 |
| adc | https://www.tokyoadc.com/ | tokyoadc.com のトップには新着記事・作品の一覧がなく、あるのはナビと2026年度の募集案内だけでした。WebSearch で見つかったのも募集要項・WINNERS・EXHIBITION・ABOUT などの固定ページ（応募要項、過去年度の受賞者ページ）で、個別の新着記事・作品は取得できませんでした。2026年度のADC賞発表は11月上旬の予定で、現時点では公開されていません。このため採点対象がなく、bakeoffItems は空配列です。 |
| party | https://p-a-r-t-y.com/ | p-a-r-t-y.com は 1-2-3.in/party へ302リダイレクト(失効ドメイン転用)で、無関係サイトのため未取得。WebSearchでも新着一覧は取れず。正しい公式URL(例: prty.jp)の確認が必要 |

## 未実行（次回へ持ち越し）

なし

## 対象外

- X系候補（x_account / x_list / x_query）は Phase 0（捨て垢Cookie登録）未完了のため今回対象外。sources.json には登録のみ。
