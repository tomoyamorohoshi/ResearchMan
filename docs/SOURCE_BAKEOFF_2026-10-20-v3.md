# 情報源ベイクオフ結果 2026-10-20-v3

- 生成: `scripts/bakeoff-sources.mjs`（設計書 docs/RADAR_V2_DESIGN.md §4-8）。kind=web のみ。1候補1回のClaude CLI呼び出しで、一覧ページの直近最大10件を取得し、関門A/B/C/D基準（`scripts/lib/case-gate-criteria.mjs`）で採点。
- 採点済み 36 候補（取得成功 36 / 取得失敗 0）。cases.json・sources.json は変更していない（read-only）。
- **読み方**: accept率 = 関門A/B/C/Dのいずれかを満たした件数 ÷ 取得件数。1候補あたり最大10件の**小標本**なので、±20pt程度の揺れは誤差。tier案は目安（件数5件以上で accept率50%↑=tier1、30%↑=tier2、それ未満=見送り）。最終判断（`enabled`/`tier`）はオーナー。
- 採点はモデルが一覧のタイトル・要約から行うため、告知記事の見抜きは得意だがクラフト(B)の過大評価に注意。代表例は必ず目視で確認すること。
- **既知のバイアス**: 採点は一覧のタイトル・要約のみ（本文は開かない）。ブランドID系（リブランド紹介）・受賞/審査系の媒体は「要点が本文にある」ため過小評価されやすい。逆に制作会社の作品一覧は「企画そのもの」が題名になるため accept 寄りに出る。0%は「事例が無い」ではなく「一覧の要約からは判定不能」を含む。0%の媒体を除外する前に代表的な記事を目視すること。

## 結果（accept率の高い順）

| 情報源 | 現tier | 件数 | accept率 | 基準内訳 | tier案 | 代表例（最大3件） |
|---|---|---|---|---|---|---|
| ars-starts-prize | 2 | 1 | 100% (1/1) | A0 / B0 / C1 / D0 | 保留(件数不足) | [Cortical Echoes: An Interface for Living Computation (Amy Ka](https://www.amykarle.com/project/cortical_echoes) (C: 培養ニューロンの活動を音楽・音声・映像に変換する素材と手法の新規性) |
| materialdistrict | 2 | 10 | 30% (3/10) | A2 / B0 / C0 / D1（惜しい1） | tier2推奨 | [Recovered Trainer Foam Becomes Cushioning for Sofas and Loun](https://materialdistrict.com/article/recovered-trainer-foam-becomes-cushioning-for-sofas-and-lounge-chairs/) (A: 廃スニーカー発泡を家具クッションに読み替えと一文で言える)<br>[Wastewater Algae Explored as a Binder for Recycled Textile M](https://materialdistrict.com/article/wastewater-algae-explored-as-a-binder-for-recycled-textile-materials/) (D: 排水藻を再生繊維の結合材にする転用可能な手法)<br>[Flexible Slate Tiles Turn Stone Into Wearable Material](https://materialdistrict.com/article/flexible-slate-tiles-turn-stone-into-wearable-material/) (A: 硬い石を柔軟に加工し着用素材に読み替えと一文で言える) |
| nightingale | 2 | 10 | 20% (2/10) | A1 / B0 / C0 / D1（惜しい2） | 見送り | [Make the Invisible Tangible: Turning Time Gaps into Distance](https://nightingaledvs.com/make-the-invisible-tangible/) (A: 時間差を縮尺つきの物理距離に読み替える、一文で言える発想)<br>[The Plot Hole Only a Graph Could Find](https://nightingaledvs.com/the-plot-hole-only-a-graph-could-find/) (D: 物語をグラフ化し、読むだけでは見えない矛盾を見つける転用可能な手法) |
| core77 | 3 | 10 | 20% (2/10) | A0 / B0 / C2 / D0（惜しい2） | 見送り | [Combining 3D Printing with Weaving](https://www.core77.com/posts/145676/Combining-3D-Printing-with-Weaving) (C: FilaLoom：3Dプリントと織りを組み合わせる製作手法の新規性)<br>[ID Firm Layer Develops Corrugated Plywood: Strong, Lightweig](https://www.core77.com/posts/145637/ID-Firm-Layer-Develops-Corrugated-Plywood-Strong-Lightweight) (C: 合板を波形にして軽量高強度にする素材・製法の新規性) |
| reasonwhy-es | 3 | 10 | 20% (2/10) | A2 / B0 / C0 / D0（惜しい2） | 見送り | [Lovehoney propone pagar menos por una escapada romántica cua](https://www.reasonwhy.es/actualidad/lovehoney-propone-pagar-menos-por-una-escapada-romantica-cuanto-menos-utilice-movil) (A: スマホ利用が少ないほど旅行が安くなる、一文の企画)<br>[Los nudes se resignifican para prevenir el cáncer de mama en](https://www.reasonwhy.es/actualidad/campana-cancer-mama-send-nudes-agencia-yard) (A: ヌード送信文化を乳がん自己検診に読み替えた企画) |
| b9-pt | 3 | 10 | 20% (2/10) | A1 / B1 / C0 / D0（惜しい1） | 見送り | [Oura dispensa IA e constrói cidade em miniatura onde só exis](https://www.b9.com.br/oura-ring-cidade-miniatura-maos-sem-ia/) (B: AI不使用で手だけのミニチュア都市を制作、クラフトと一文の着想)<br>[Rivian chama Bill Murray e transforma seus carros em Ecto-1 ](https://www.b9.com.br/rivian-ghostbusters-bill-murray-ecto-r1-halloween/) (A: ソフトウェア更新で車をEcto-1に変える、一文で言える企画) |
| adlatina-es | 3 | 8 | 13% (1/8) | A1 / B0 / C0 / D0（惜しい2） | 見送り | [Preestreno: VML Chile y Ladysoft acompañan a las niñas en su](https://www.adlatina.com/publicidad/preestreno-vml-chile-y-ladysoft-acompaa-a-las-nias-en-su-crecimiento) (A: 有名な慣用句の一語を替えて主張を作る、一文で言える企画) |
| flowingdata | 3 | 10 | 10% (1/10) | A1 / B0 / C0 / D0（惜しい2） | 見送り | [People holding up the internet](https://flowingdata.com/2026/10/14/people-holding-up-the-internet/) (A: OSSの開発履歴で、ネットを支える無償の人の労力を可視化) |
| parametric-architecture | 2 | 10 | 10% (1/10) | A1 / B0 / C0 / D0（惜しい2） | 見送り | [4 Ordinary Materials Create Extraordinary Quiet at Tallinn's](https://parametric-architecture.com/resonance-pavilion-tallinn-design/) (A: ありふれた4素材で静けさを作る一文で言える発想) |
| topys | 3 | 10 | 10% (1/10) | A1 / B0 / C0 / D0（惜しい2） | 見送り | [请再来一次我们的海洋馆…而不是妖怪馆](https://www.topys.cn/article/34762) (A: 観客の「思い出」を広告にする、一文で言える企画) |
| experimenta-es | 3 | 10 | 10% (1/10) | A0 / B0 / C1 / D0（惜しい2） | 見送り | [El trofeo Möbius de Lucio Traficante](https://www.experimenta.es/noticias/industrial/el-trofeo-mobius-de-lucio-traficante/) (C: メビウスの帯の賞杯を砂の3Dプリントで制作。素材と手法に新規性) |
| canneslions | 2 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい1） | 見送り | - |
| oneclub-articles | 2 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい1） | 見送り | - |
| iib-awards | 2 | 10 | 0% (0/10) | A0 / B0 / C0 / D0 | 見送り | - |
| tdc | 2 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい1） | 見送り | - |
| ars-prix-winners | 2 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい3） | 見送り | - |
| starts-eu | 3 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい2） | 見送り | - |
| pudding | 2 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい5） | 見送り | - |
| archdaily | 2 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい2） | 見送り | - |
| eyeondesign | 3 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい3） | 見送り | - |
| digitaling | 2 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい1） | 見送り | - |
| socialbeta | 3 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい2） | 見送り | - |
| gooood | 3 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい2） | 見送り | - |
| brandbrief-kr | 3 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい1） | 見送り | - |
| artinsight-kr | 3 | 10 | 0% (0/10) | A0 / B0 / C0 / D0 | 見送り | - |
| yorokobu-es | 3 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい1） | 見送り | - |
| propmark-pt | 3 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい2） | 見送り | - |
| culture-pub-fr | 3 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい2） | 見送り | - |
| journal-du-design-fr | 3 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい2） | 見送り | - |
| etapes-fr | 3 | 10 | 0% (0/10) | A0 / B0 / C0 / D0 | 見送り | - |
| slanted-de | 3 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい2） | 見送り | - |
| horizont-de | 3 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい2） | 見送り | - |
| monopol-de | 3 | 10 | 0% (0/10) | A0 / B0 / C0 / D0（惜しい1） | 見送り | - |
| dvs | 3 | 9 | 0% (0/9) | A0 / B0 / C0 / D0（惜しい2） | 見送り | - |
| designtagebuch-de | 3 | 8 | 0% (0/8) | A0 / B0 / C0 / D0（惜しい1） | 見送り | - |
| designdb-kr | 3 | 5（重複除去1） | 0% (0/5) | A0 / B0 / C0 / D0 | 見送り | - |

## 取得失敗

なし

## 未実行（次回へ持ち越し）

未実行: itsnicethat, bpando, dezeen, brand-innovators, lbbonline, creativereview, contagious, adsoftheworld, campaignbrief, campaignbrief-nz, campaignbrief-asia, creapills, lovethework, the-brandidentity, brandnew, fontsinuse, typeroom, dinamo, collins, wolffolins, jkr, pentagram, dandad, oneshow, clios, adage-creativity, muse-by-clio, campaignlive, famouscampaigns, adsofbrands, designboom, creativeboom, creativeapplications, colossal, ars-electronica, stirworld, wallpaper, advertimes, brain, axis, jagda, tcc, acc, adc, gooddesign, dentsulabtokyo, party, whatever, rhizomatiks, tha, konel, bassdrum, cbcnet, natalie, automaton

## 対象外

- X系候補（x_account / x_list / x_query）は Phase 0（捨て垢Cookie登録）未完了のため今回対象外。sources.json には登録のみ。
