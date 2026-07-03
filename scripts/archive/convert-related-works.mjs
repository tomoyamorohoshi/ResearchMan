/**
 * relatedWorks を {title, description, url}[] 形式に変換するスクリプト
 *
 * 使い方: node scripts/convert-related-works.mjs
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");

// 各事例のrelatedWorksを構造化データに変換する
const RELATED_WORKS_DATA = {
  "waves-of-will": [
    {
      title: "Not Impossible: Project Daniel (2014)",
      description: "スーダンの少年に3Dプリント義手を提供した事例。テクノロジーを人間の尊厳回復に使うという思想的系譜を共有する。",
      url: "https://www.notimpossiblelabs.com/project-daniel",
    },
    {
      title: "Mi.Mu Gloves (Peter Gabriel支援)",
      description: "身体運動データを音楽表現に変換するウェアラブルグローブ。身体とデジタル表現の架け橋という手法が近い。",
      url: "https://www.mimugloves.com/",
    },
    {
      title: "Stelarc「Third Hand」シリーズ",
      description: "意志と動作の分離・再結合という問いを共有する身体拡張のパフォーマンスアート。ブレインマシンインターフェースの先駆的芸術実践。",
      url: "https://stelarc.org/?catID=20265",
    },
  ],
  "radio-time-machine": [
    {
      title: "Alive Inside (2014年ドキュメンタリー映画)",
      description: "ヘッドフォンで個人化された音楽を聴かせることで認知症患者が生き生きとよみがえる様子を記録した先駆的ドキュメンタリー。",
      url: "https://www.aliveinside.us/",
    },
    {
      title: "Christian Marclay「The Clock」(2010年ビデオアート)",
      description: "24時間リアルタイムで映画の時間シーンを繋いだインスタレーション。時間と記憶の再現という手法的共鳴がある。",
      url: "https://en.wikipedia.org/wiki/The_Clock_(2010_film)",
    },
    {
      title: "Spotify「Wrapped」",
      description: "パーソナルな記憶の自動キュレーションという思想を共有する。消費データを感情的な自己表現に変換するサービス設計。",
      url: "https://www.spotify.com/wrapped/",
    },
  ],
  "trex-leather": [
    {
      title: "Stella McCartney × Bolt Threads「Mylo」",
      description: "キノコ由来レザー。畜産依存からの脱却という同じ問題意識に立つが、流通実用化路線をとる対照的アプローチ。",
      url: "https://boltthreads.com/technology/mylo/",
    },
    {
      title: "Neri Oxman「Silk Pavilion」(MITメディアラボ)",
      description: "生物のプロセスを素材生成に活用したインスタレーション。バイオファブリケーションの美的・思想的先駆。",
      url: "https://oxman.com/projects/silk-pavilion",
    },
    {
      title: "ジュラシック・パーク (1993年映画)",
      description: "絶滅種のDNA復元という科学的想像力の文化的原点。T-REX Leatherの社会的文脈の土台をなす。",
      url: "https://www.imdb.com/title/tt0107290/",
    },
  ],
  "supernova-rise-3-adaptive": [
    {
      title: "OXO「Good Grips」キッチンツール",
      description: "障害者のニーズから生まれたデザインが全ユーザーにとっての最適解になるというユニバーサルデザインの商業的成功の原点。",
      url: "https://www.oxo.com/",
    },
    {
      title: "Nike「FlyEase」シリーズ",
      description: "片手で着脱可能なシューズ。アダプティブスポーツウェアの市場を先行開拓した直接的先行事例。",
      url: "https://www.nike.com/flyease",
    },
    {
      title: "映画「最強のふたり」(2011年)",
      description: "障害を持つ人物が「特別扱いではなく対等な存在」として描かれる社会的意義を体現した作品。",
      url: "https://www.imdb.com/title/tt1659337/",
    },
  ],
  "dark-mode-ads": [
    {
      title: "Patagonia「Don't Buy This Jacket」(2011年)",
      description: "自社製品の購買を抑制する広告を打つことで消費主義への問いを体現。「広告行為そのものがメッセージを担う」という同じ構造を持つ。",
      url: "https://www.patagonia.com/stories/dont-buy-this-jacket/story-18615.html",
    },
    {
      title: "Edward Burtynsky「Manufactured Landscapes」",
      description: "工業文明の美的側面から環境破壊を可視化した写真・映画作品。広告と芸術の境界を越えた環境問題提起の先駆。",
      url: "https://edwardburtynsky.com/projects/photographs/manufactured-landscapes",
    },
    {
      title: "Greenpeace「Unfriend Coal」Facebookキャンペーン",
      description: "デジタルプラットフォームの仕組みを環境活動に転用した手法的共鳴がある先駆的デジタルアクティビズム。",
      url: "https://www.greenpeace.org/",
    },
  ],
  "faroe-islands-space-program": [
    {
      title: "Olafur Eliasson「The Weather Project」(テートモダン、2003年)",
      description: "自然現象をアートインスタレーションとして再構成した作品。自然エネルギーの美的提示という点で共鳴する。",
      url: "https://olafureliasson.net/artwork/the-weather-project-2003/",
    },
    {
      title: "GEの「Ecomagination」キャンペーン(2005〜)",
      description: "産業系企業がクリーンテクノロジーをブランドナラティブの核に据えた先駆的事例。技術力のPR化という問題意識を共有する。",
      url: "https://www.ge.com/news/reports/ecomagination",
    },
    {
      title: "映画「インターステラー」(2014年)",
      description: "科学的事実（潮汐力・相対性理論）を感情的な物語に昇華した作品。「科学の詩的再解釈」という表現手法が近い。",
      url: "https://www.imdb.com/title/tt0816692/",
    },
  ],
  "magnif-eye": [
    {
      title: "1001 Optometry「The Hidden Eye Test」(Cannes 2025 Gold)",
      description: "本作の前身。日常的なデジタル体験に視力検査を埋め込む同じ設計思想を持つVML Sydney制作の先行作品。",
      url: "https://www.youtube.com/watch?v=e1py_XZAMkk",
    },
    {
      title: "Zipline（ルワンダの無人機医療物資輸送）",
      description: "医療インフラの空白を技術で埋めるアプローチ。ヘルステックが「届かない場所に届ける」という問題意識を共有する。",
      url: "https://www.flyzipline.com/",
    },
    {
      title: "Google「Screening Novel」プロジェクト",
      description: "フィクション作品に糖尿病性網膜症スクリーニングを組み込んだ事例。日常行動の医療転用という手法が共鳴する。",
      url: "https://health.google/intl/en_us/",
    },
  ],
  "sos-pos": [
    {
      title: "M-Pesa（ケニアのモバイル決済）",
      description: "携帯電話インフラを金融サービスに転用した事例。インフラの目的外使用による社会課題解決の最も成功したモデルの一つ。",
      url: "https://www.safaricom.co.ke/personal/m-pesa",
    },
    {
      title: "グラミン銀行（ムハマド・ユヌス）",
      description: "既存の金融インフラから排除された人々のために制度設計を転換した先駆的事例。「既存の仕組みを別の目的に使う」思想的系譜を持つ。",
      url: "https://grameenbank.org/",
    },
    {
      title: "Safecast（福島原発事故後の市民放射線測定ネットワーク）",
      description: "既存デバイスを市民安全インフラに転用した事例として手法的に近い。日常インフラのSOS転用という発想の系譜にある。",
      url: "https://safecast.org/",
    },
  ],
  "always-like-a-girl": [
    {
      title: "Jean Kilbourne「Killing Us Softly」(1979〜)",
      description: "広告が女性の自己イメージに与える影響を分析したドキュメンタリーシリーズ。本作の社会的問題意識の知的系譜をなす。",
      url: "https://www.jeankilbourne.com/",
    },
    {
      title: "映画「Miss Representation」(2011年)",
      description: "メディアにおける女性表現の歪みを告発したドキュメンタリー。問題意識が直結する同時代の先行作品。",
      url: "https://therepresentationproject.org/film/miss-representation/",
    },
    {
      title: "Dove「Real Beauty Sketches」(2013年)",
      description: "同時代の女性自己認識をテーマにした広告として双璧をなす事例。Cannes 2013 Titanium & Film Grand Prix受賞。",
      url: "https://www.youtube.com/watch?v=CSWanX7UTVk",
    },
  ],
  "dove-real-beauty-sketches": [
    {
      title: "Always「#LikeAGirl」(2014年)",
      description: "同時期に女性自己認識の社会的歪みを正面から扱った広告として双璧をなす。Cannes 2015 Film Grand Prix受賞。",
      url: "https://www.youtube.com/watch?v=dxrPeFKtUwQ",
    },
    {
      title: "Cindy Sherman「Untitled Film Stills」(1977〜1980年)",
      description: "女性が社会的役割を演じることの構造を可視化した先駆的アート作品として思想的系譜を持つ。",
      url: "https://en.wikipedia.org/wiki/Untitled_Film_Stills",
    },
    {
      title: "Dove「Evolution」(2006年)",
      description: "Real Beautyシリーズの原点。業界の「作られた美」を暴くことで逆説的に信頼を獲得したバイラル動画。",
      url: "https://www.youtube.com/watch?v=iYhCn0jf46U",
    },
  ],
  "channel4-paris-paralympics": [
    {
      title: "Channel 4「Meet the Superhumans」(2012年)",
      description: "同系列の先行キャンペーン。パラリンピアンを「超人」として描く強烈な映像表現を確立した元祖。",
      url: "https://www.youtube.com/watch?v=OjlKIjPrwRc",
    },
    {
      title: "Stella Young「I'm not your inspiration, thank you very much」TED (2014年)",
      description: "「感動ポルノ」という概念を提唱した先駆的スピーチ。本作の思想的背景をなす。",
      url: "https://www.ted.com/talks/stella_young_i_m_not_your_inspiration_thank_you_very_much",
    },
    {
      title: "映画「最強のふたり」(2011年)",
      description: "障害を持つ人物を「同情の対象」ではなく「対等な主体」として描いた商業映画。表現の転換という問題意識が共鳴する。",
      url: "https://www.imdb.com/title/tt1659337/",
    },
  ],
  "spotify-sounds-right": [
    {
      title: "(PRODUCT)RED (Bono/Bobby Shriver, 2006〜)",
      description: "消費行動をHIV/AIDS支援に直結させたモデルの先駆。「買うことが支援になる」仕組みの思想的系譜を共有する。",
      url: "https://www.red.org/",
    },
    {
      title: "Olafur Eliasson「Ice Watch」(2018年パリ協定関連)",
      description: "グリーンランドの氷塊を都市に展示することで気候変動を感覚的に提示したインスタレーション。自然を「体験の媒体」に転換する手法が近い。",
      url: "https://olafureliasson.net/artwork/ice-watch/",
    },
    {
      title: "Brian Eno「Ambient 1: Music for Airports」(1978年)",
      description: "自然音と環境音楽の境界を曖昧にした先駆的作品。Sounds Rightの「自然音をアーティストとして扱う」素材観と共鳴する。",
      url: "https://en.wikipedia.org/wiki/Ambient_1:_Music_for_Airports",
    },
  ],
  "axa-three-words": [
    {
      title: "Refuge「Ask for Angela」キャンペーン",
      description: "飲食店スタッフを介したサイレントSOSの仕組みを普及させた制度変革型コミュニケーションの先駆け。",
      url: "https://www.nasuwt.org.uk/advice/health-and-wellbeing/ask-for-angela.html",
    },
    {
      title: "UN Women「He for She」キャンペーン",
      description: "企業・機関による制度的コミットメントを訴えたアクティビズム。「行動こそがメッセージ」という本作と同じ方法論をとる。",
      url: "https://www.heforshe.org/",
    },
    {
      title: "Richard Thaler・Cass Sunstein「Nudge」(2008年)",
      description: "制度設計によって人々の行動を変えるナッジ理論の主著。AXA Three Wordsの約款改定アプローチの思想的基盤。",
      url: "https://en.wikipedia.org/wiki/Nudge_(book)",
    },
  ],
  "loreal-final-copy": [
    {
      title: "映画「Hidden Figures」(2016年)",
      description: "NASAで活躍したにもかかわらず歴史から消されてきた黒人女性数学者たちの実話。不可視化されてきた功績の回復という同じ問題意識。",
      url: "https://www.imdb.com/title/tt4846340/",
    },
    {
      title: "The One Club「Where Are All The Black People?」プロジェクト",
      description: "広告業界内の人種的不均衡を記録・告発した制度的取り組み。業界内の多様性問題への構造的アプローチ。",
      url: "https://www.oneclub.org/",
    },
    {
      title: "Kara Walker のシルエット作品群",
      description: "歴史的に消去されてきた黒人女性の存在をシルエット作品で再可視化するアーティスト。本作と手法は異なるが主題が重なる。",
      url: "https://en.wikipedia.org/wiki/Kara_Walker",
    },
  ],
  "doordash-all-the-ads": [
    {
      title: "Burger King「Whopper Detour」(2018年)",
      description: "マクドナルド店舗の近くにいるユーザーに1セントバーガーを提供し、競合の存在を自社のプロモーションに転用した類似の逆転発想。",
      url: "https://www.youtube.com/watch?v=PdkFONGHe3g",
    },
    {
      title: "Improv Everywhere「No Pants Subway Ride」",
      description: "参加者の行為そのものがメディアになる参加型メカニズムを先駆けた。DoorDashの「参加型スーパーボウル」の構造と共鳴。",
      url: "https://improveverywhere.com/missions/the-no-pants-subway-ride/",
    },
    {
      title: "Oprah Winfrey「You Get a Car!」(2004年)",
      description: "全視聴者に車をプレゼントした「スポンサードギフト×話題爆発」の文化的原点。DoorDash All The Adsの先行パターン。",
      url: "https://www.youtube.com/watch?v=lmDHCMZBhBg",
    },
  ],
  "wavio-see-sound": [
    {
      title: "Christine Sun Kim の音響インスタレーション群",
      description: "聴覚障害者の音世界の体験を健聴者に伝えるアート作品群。See Soundと逆方向のコミュニケーションを行う。",
      url: "https://christinesunkim.com/",
    },
    {
      title: "Google「Project Euphonia」",
      description: "障害のある人の音声をAIが学習し認識精度を上げる取り組み。機械学習を包括的アクセシビリティに活用する同じアプローチをとる。",
      url: "https://sites.research.google/euphonia/about/",
    },
    {
      title: "Hugh Herr「バイオニック義足」(MITメディアラボ)",
      description: "障害を技術で補うのではなく人間能力の拡張として再定義した点でWavioと問題意識が重なる。",
      url: "https://www.media.mit.edu/groups/biomechatronics/overview/",
    },
  ],
  "jcdecaux-marina-prieto": [
    {
      title: "Dove「Real Beauty」キャンペーン(2004〜)",
      description: "美の多様性を広告で体現することで業界の基準を書き換えた先駆的事例。Marina Prietoが挑む同じ「美のステレオタイプ」問題。",
      url: "https://www.dove.com/",
    },
    {
      title: "Cindy Sherman のセルフポートレートシリーズ",
      description: "女性の自己表現とメディア的役割を問い直す文脈でMarinaのキャスティングと問題意識を共有する。",
      url: "https://en.wikipedia.org/wiki/Cindy_Sherman",
    },
    {
      title: "Banksy のパブリックアート作品群",
      description: "無許可で都市空間に作品を掲出し公共の目を集めるパブリックアートの手法。都市空間の「視線」を民主化する問いとして本作と通底する。",
      url: "https://www.banksy.co.uk/",
    },
  ],
  "dp-world-move-to-minus15": [
    {
      title: "Ellen MacArthur Foundation「サーキュラーエコノミー」構想",
      description: "産業構造の基準そのものを書き換えることで気候問題に対処しようとする点で本作と同じアプローチをとる。",
      url: "https://ellenmacarthurfoundation.org/",
    },
    {
      title: "Patagonia「Don't Buy This Jacket」(2011年)",
      description: "サプライチェーン全体の環境負荷に目を向けさせた制度変革型コミュニケーションの先駆。",
      url: "https://www.patagonia.com/stories/dont-buy-this-jacket/story-18615.html",
    },
    {
      title: "William McDonough「Cradle to Cradle」設計原則",
      description: "既存産業基準の根本的な再設計を提唱する思想。-15℃標準化と同じ「産業の基準値そのものを変える」アプローチ。",
      url: "https://en.wikipedia.org/wiki/Cradle_to_Cradle:_Remaking_the_Way_We_Make_Things",
    },
  ],
  "xbox-everyday-tactician": [
    {
      title: "映画「Moneyball」(2011年)",
      description: "データ分析とゲーム的思考がリアルなスポーツ競技を変えるという同じ命題を描いており、本作の社会的文脈と重なる。",
      url: "https://www.imdb.com/title/tt1210166/",
    },
    {
      title: "Jane McGonigal「Gaming can make a better world」TED (2010年)",
      description: "ゲームの社会的有用性を理論化した議論の出発点として位置づけられるTEDトーク。",
      url: "https://www.ted.com/talks/jane_mcgonigal_gaming_can_make_a_better_world",
    },
    {
      title: "米軍「America's Army」プログラム",
      description: "ゲームをリクルートメント・スキル評価ツールとして活用した先駆的事例。ゲームと実際の職業能力を接続した原型。",
      url: "https://en.wikipedia.org/wiki/America%27s_Army",
    },
  ],
  "sydney-opera-house-play-it-safe": [
    {
      title: "Apple「Think Different」キャンペーン(1997年)",
      description: "非順応者・挑戦者を讃えることでブランドの価値観を定義した先駆事例。Play It Safeの「安全な選択を拒む」精神と共鳴。",
      url: "https://www.youtube.com/watch?v=cFEarBzelBs",
    },
    {
      title: "映画「Jiro Dreams of Sushi」(2011年)",
      description: "職人の孤高な追求を通じて「安全な選択を拒否する精神」を描いており、本作と通底するテーマを持つ。",
      url: "https://www.imdb.com/title/tt1772925/",
    },
    {
      title: "Christo & Jeanne-Claude のランドアート",
      description: "「不可能と言われた構造的プロジェクトを実現する」意志の体現として比較できる大型インスタレーション作品群。",
      url: "https://christojeanneclaude.net/",
    },
  ],
  "orange-dear-future-messi": [
    {
      title: "Nike「Dream Crazy」(2018年)",
      description: "社会的偏見に抗うアスリートを主役に据え、スポーツの価値基準を問い直した先駆事例。",
      url: "https://www.youtube.com/watch?v=WW2yKSt2C_A",
    },
    {
      title: "Hito Steyerl「How Not to Be Seen」(2013年)",
      description: "ディープフェイク・映像操作が現実認識に及ぼす影響を批評的に扱う映像作家の作品。本作の技術選択と対話関係にある。",
      url: "https://www.moma.org/collection/works/181570",
    },
    {
      title: "映画「She Said」(2022年)",
      description: "声を上げることを阻まれてきた女性の証言を可視化することで社会構造の不平等を告発する点で本作と問題意識を共有する。",
      url: "https://www.imdb.com/title/tt14807308/",
    },
  ],
  "tuvalu-first-digital-nation": [
    {
      title: "Olafur Eliasson「Ice Watch」(国連本部前, 2019年)",
      description: "溶けゆく氷河をリアルタイムで可視化した環境アクティビズムの代表例。気候変動の物理的現実を都市に持ち込む手法。",
      url: "https://olafureliasson.net/artwork/ice-watch/",
    },
    {
      title: "Nonny de la Pena 没入型ジャーナリズム作品群",
      description: "消えゆく場所・記憶のデジタル保存という本作の手法と重なる探求。VRで「そこにいる体験」を提供するジャーナリズムの新形態。",
      url: "https://www.nonnydelapena.com/",
    },
    {
      title: "映画「Seaspiracy」(2021年)",
      description: "海洋環境問題を告発するドキュメンタリー。気候変動への緊急性を世界的に高め、本作と同じ問題系に位置する。",
      url: "https://www.seaspiracy.org/",
    },
  ],
  "knock-knock-police": [
    {
      title: "Refuge「Ask for Angela」キャンペーン",
      description: "飲食店スタッフを介したサイレントSOSの仕組みであり、「声を出せない人のための通報設計」という同じ問題意識を持つ先駆事例。",
      url: "https://www.nasuwt.org.uk/advice/health-and-wellbeing/ask-for-angela.html",
    },
    {
      title: "Apple「iOS緊急SOS機能」",
      description: "ボタン長押しで自動通報。本作と近い技術アプローチで、デバイスメーカー側からの類似解決策として比較対象となる。",
      url: "https://support.apple.com/en-us/111790",
    },
    {
      title: "映画「Room」(2015年)",
      description: "密室に閉じ込められた被害者の脱出劇を描き、本作のターゲットが直面する状況を体験させる作品。",
      url: "https://www.imdb.com/title/tt3170832/",
    },
  ],
  "ea-sports-kiyan-prince": [
    {
      title: "映画「Coco」(2017年, Pixar)",
      description: "死者の記憶をデジタルで保存し続けることで魂の存在を維持するという物語構造。「デジタル空間での存在継続」と深く共鳴する。",
      url: "https://www.imdb.com/title/tt2380307/",
    },
    {
      title: "Refik Anadol「Machine Hallucination」",
      description: "生前のデータから故人の「記憶」を視覚化するAIアートプロジェクト。本作と同じ技術的・倫理的問いを持つ。",
      url: "https://refikanadol.com/",
    },
    {
      title: "ホロコースト記念館「Polin」証言アーカイブAI",
      description: "故人の映像に基づく対話AIで「亡くなった人物をデジタルで生き続けさせる」倫理と技術の最前線事例。本作と対照的に論じられる。",
      url: "https://polin.pl/en",
    },
  ],
  "nike-you-cant-stop-us": [
    {
      title: "映画「HUMAN」(2015年 / ヤン・アルテュス=ベルトラン監督)",
      description: "世界中の人々のインタビューと空撮映像を編集したドキュメンタリー映画。国境・文化を超えた「人間の普遍性」を映像の連鎖で表現する手法が共鳴する。",
      url: "https://www.human-themovie.org/",
    },
    {
      title: "Apple「1984」(1984年 / リドリー・スコット監督)",
      description: "歴史的スーパーボウルCMとして、映像が「時代への宣言」になりうることを示した先駆的作品。",
      url: "https://www.youtube.com/watch?v=VtvjbmoDx-I",
    },
    {
      title: "Dove「Evolution」(2006年)",
      description: "編集という行為自体がメッセージを持つ広告映像の原型として参照される。",
      url: "https://www.youtube.com/watch?v=iYhCn0jf46U",
    },
  ],
  "burger-king-moldy-whopper": [
    {
      title: "Dove「Evolution」(2006年)",
      description: "製品の「作られた美」を暴くことで逆説的に信頼を獲得する構造が共通する。",
      url: "https://www.youtube.com/watch?v=iYhCn0jf46U",
    },
    {
      title: "Patagonia「Don't Buy This Jacket」(2011年)",
      description: "消費者への正直さをコアにした「アンチ広告」の代表作。ブランド自身が自社製品の購入を思いとどまらせる。",
      url: "https://www.patagonia.com/stories/dont-buy-this-jacket/story-18615.html",
    },
    {
      title: "Banksy《Love Is in the Bin》(2018年)",
      description: "競売直後に自動裁断された絵画作品。「商業的価値への反抗」がメッセージ自体になる構造はMoldy Whopperと共鳴する。",
      url: "https://www.sothebys.com/en/articles/girl-with-balloon-becomes-love-is-in-the-bin",
    },
  ],
  "bodyform-womb-stories": [
    {
      title: "Frida Kahlo「The Broken Column」(1944年)",
      description: "女性の身体的苦痛を美術作品として正面から描いた先駆け。身体の痛みと美の共存という視点がWomb Storiesと通底する。",
      url: "https://en.wikipedia.org/wiki/The_Broken_Column",
    },
    {
      title: "Maya Deren「Meshes of the Afternoon」(1943年)",
      description: "女性の内的体験を非線形映像で可視化した実験映画の祖。アニメーションで内側を描くWomb Storiesの表現と構造的に近い。",
      url: "https://en.wikipedia.org/wiki/Meshes_of_the_Afternoon",
    },
    {
      title: "Bodyform「Blood Normal」(2017年)",
      description: "前作。「血の赤を初めて生理用品広告で使った」作品として同シリーズの起点となった。Cannes 2018 Glass Grand Prix受賞。",
      url: "https://www.youtube.com/watch?v=8Q1GVOYIcOs",
    },
  ],
  "microsoft-we-all-win": [
    {
      title: "Nike「Unlimited You」(2016年リオ五輪)",
      description: "競技用義肢を持つアスリートを主役にしたキャンペーン。障害者を「鑑賞対象」ではなく「主役」として描いた先駆的広告。",
      url: "https://www.youtube.com/watch?v=I4lUJwxBFwA",
    },
    {
      title: "Aimee Mullins「It's time to question bio-chauvinism」TED (2009年)",
      description: "義足を持つモデル・アスリートが「障害と能力」の定義を問い直したトーク。Adaptive Controllerの思想的背景と共鳴。",
      url: "https://www.ted.com/talks/aimee_mullins_the_opportunity_of_adversity",
    },
    {
      title: "Apple「Accessibility」広告シリーズ(2019〜)",
      description: "視覚・聴覚・運動障害を持つユーザーの日常を描いたAppleの長期キャンペーン。We All Winと並ぶインクルーシブ広告の代表作。",
      url: "https://www.apple.com/accessibility/",
    },
  ],
  "nike-dream-crazy": [
    {
      title: "Patagonia「The President Stole Your Land」(2017年)",
      description: "トランプ政権の国定公園縮小に対してブランドが直接反論した広告。政治的リスクを取るブランドの先例として参照される。",
      url: "https://eu.patagonia.com/gb/en/stories/the-president-stole-your-land/story-31468.html",
    },
    {
      title: "Gillette「We Believe」(2019年)",
      description: "#MeToo運動を受けて「有害な男らしさ」に反論したCM。Dream Crazyと同時期に「社会的スタンスを取る広告」のブームを形成した。",
      url: "https://www.youtube.com/watch?v=koPmuEyP3a0",
    },
    {
      title: "Muhammad Ali のベトナム戦争徴兵拒否 (1967年)",
      description: "キャリアを失いながらも信念を貫いたAliの姿は、Kaepernickのナラティブの原型として作中でも引用される。",
      url: "https://en.wikipedia.org/wiki/Muhammad_Ali%27s_draft_refusal",
    },
  ],
  "palau-pledge": [
    {
      title: "Tuvalu「The First Digital Nation」(2023年)",
      description: "同じ太平洋小島国が気候変動と向き合い、国家ブランディングをサステナビリティの軸に構築した事例。問題意識と地理的文脈が共鳴する。",
      url: "https://newsroom.accenture.com/news/2023/accenture-song-wins-dan-wieden-titanium-grand-prix-for-tuvalu-the-first-digital-nation",
    },
    {
      title: "REI「#OptOutside」(2015年)",
      description: "ブランドの価値観を「行動の選択」として体現した事例。制度とコミュニケーションの融合という点でPalau Pledgeと構造が近い。",
      url: "https://www.rei.com/opt-outside",
    },
    {
      title: "Richard Thaler「Nudge」(2008年)",
      description: "行動設計で人々の選択を誘導する「ナッジ」概念の提唱。Palau Pledgeは観光客の行動を誓約という設計で変えるナッジの実践例。",
      url: "https://en.wikipedia.org/wiki/Nudge_(book)",
    },
  ],
  "fearless-girl": [
    {
      title: "Banksy《Girl with Balloon》(2002年)",
      description: "少女と希望のシンボルをストリートアートで表現した先駆的作品。都市空間に突如現れるアート的介入という手法がFearless Girlと共鳴する。",
      url: "https://en.wikipedia.org/wiki/Girl_with_Balloon",
    },
    {
      title: "Marc Quinn《Alison Lapper Pregnant》(2005年 トラファルガー広場)",
      description: "権威的な公共空間の象徴性を転倒させる手法の先例。障害を持つ女性のヌード彫刻をロンドン中心地に設置した。",
      url: "https://en.wikipedia.org/wiki/Alison_Lapper_Pregnant",
    },
    {
      title: "Pussy Riot「Punk Prayer」(2012年)",
      description: "権力の象徴的空間でのゲリラ的抗議行動。Fearless Girlと同様に「場所の象徴性を逆用する」という戦略。",
      url: "https://en.wikipedia.org/wiki/Pussy_Riot#Punk_Prayer",
    },
  ],
  "heineken-worlds-apart": [
    {
      title: "Daryl Davis「Accidental Courtesy」(2016年ドキュメンタリー)",
      description: "黒人ミュージシャンが白人至上主義者たちと対話を重ねてKKKメンバーを脱退させたドキュメンタリー。接触仮説の実践。",
      url: "https://www.imdb.com/title/tt5390066/",
    },
    {
      title: "The Forgiveness Project",
      description: "暴力の加害者と被害者が対話するアート×社会プロジェクト。対話の力を可視化する試みとして共鳴する。",
      url: "https://www.theforgivenessproject.com/",
    },
    {
      title: "Coca-Cola「I'd Like to Buy the World a Coke」(1971年)",
      description: "多様な人々が一緒に歌う映像で世界平和を訴えたCM。飲料ブランドが「統合」のシンボルになる原型。",
      url: "https://www.youtube.com/watch?v=1VM2eLhvsSM",
    },
  ],
  "rei-opt-outside": [
    {
      title: "Patagonia「Don't Buy This Jacket」(2011年)",
      description: "自社製品の購入抑制を訴えたブラックフライデー広告。消費文化への反論という姿勢がOptOutsideと共鳴する。",
      url: "https://www.patagonia.com/stories/dont-buy-this-jacket/story-18615.html",
    },
    {
      title: "IKEA「Buy Back Friday」(2020年)",
      description: "ブラックフライデーに中古IKEAを買い取る逆転キャンペーン。既存の買い物習慣を問い直すアンチ消費広告の文脈。",
      url: "https://www.youtube.com/watch?v=QiuAF8X1A2E",
    },
    {
      title: "Slow Food Movement (1989〜, カルロ・ペトリーニ)",
      description: "食文化と地域性を守るための反ファストフード運動。REIの哲学と同様に「ペースを落とすことの豊かさ」を訴える。",
      url: "https://www.slowfood.com/",
    },
  ],
  "old-spice-the-man": [
    {
      title: "Burger King「Subservient Chicken」(2004年)",
      description: "ウェブカメラ前のニワダ着ぐるみが視聴者のコマンドに従う初期インタラクティブ広告。ユーザーとブランドの対話を可能にした先駆作。",
      url: "https://en.wikipedia.org/wiki/Subservient_Chicken",
    },
    {
      title: "Dollar Shave Club「Our Blades Are F***ing Great」(2012年)",
      description: "カリスマ的な「語りかけ」形式でバイラルを生んだD2C広告。Old Spiceの影響を直接受けたとされる。",
      url: "https://www.youtube.com/watch?v=ZUG9qYTJMsI",
    },
    {
      title: "Marina Abramović《The Artist Is Present》(2010年 MoMA)",
      description: "観客と1対1で向き合うパフォーマンスアート。個人との「直接の関係性」を生み出すという点でOld Spiceの返信動画戦略と構造的に共鳴する。",
      url: "https://www.moma.org/learn/moma_learning/marina-abramovic-marina-abramovic-the-artist-is-present-2010/",
    },
  ],
  "volvo-epic-split": [
    {
      title: "Honda「The Cog」(2003年)",
      description: "製品部品そのものを使った精密なパフォーマンスで品質を「見せる」広告。スペック説明を超えた「体験型製品デモ」の原型。",
      url: "https://www.youtube.com/watch?v=_ve4M4UsJQo",
    },
    {
      title: "Cirque du Soleil (1984〜)",
      description: "人体の限界への挑戦を美的体験に昇華するサーカスアート。Van Dammeの開脚が単なるスタントではなく美しさを持つ点と共鳴する。",
      url: "https://www.cirquedusoleil.com/",
    },
    {
      title: "デイヴィッド・カッパーフィールドのマジック映像 (1980〜)",
      description: "不可能を実現するパフォーマンスが信頼を生む構造。Epic Splitの「本当にやった」という驚きと同質の感動を生む。",
      url: "https://www.davidcopperfield.com/",
    },
  ],
  "red-bull-stratos": [
    {
      title: "Chris Hadfield「Space Oddity」(ISS, 2013年)",
      description: "ISS船上でDavid Bowie「Space Oddity」をカバーした宇宙飛行士の映像。「宇宙という場所をエンターテインメントの舞台にする」発想が共鳴。",
      url: "https://www.youtube.com/watch?v=KaOC9danxNo",
    },
    {
      title: "Yves Rossy「Jet Man」(2008〜)",
      description: "カーボン繊維翼を背中に装着し飛行するパフォーマンス。Red Bull Stratosと同様に人間の飛行への挑戦をブランドと結びつけたコラボ。",
      url: "https://www.yves-rossy.com/",
    },
    {
      title: "NASA「Earthrise」写真 (1968年, Apollo 8)",
      description: "宇宙から見た地球の写真。人類が宇宙から自分たちの星を「発見」した瞬間。Red Bull Stratosが目指した「宇宙視点からの世界」と同じ感動。",
      url: "https://en.wikipedia.org/wiki/Earthrise",
    },
  ],
  "vw-the-force": [
    {
      title: "Honda「The Cog」(2003年)",
      description: "精密な連鎖反応を一発撮りで記録し、製品品質への信頼を感情的に表現した先駆的作品。見せ方の工夫がアイデアの核。",
      url: "https://www.youtube.com/watch?v=_ve4M4UsJQo",
    },
    {
      title: "VW「Fun Theory」(2009年)",
      description: "同メーカーによる「楽しさで行動を変える」実験シリーズ。日常のユーモラスな発見をブランドと結びつけるVWの哲学的一貫性。",
      url: "https://www.youtube.com/watch?v=SByymar3bds",
    },
    {
      title: "Pixar のコマーシャル群 (2010〜)",
      description: "子どもの視点から大人が発見を得る物語構造。Forceにおける少年の感動がPixar的感情のアークと共鳴する。",
      url: "https://www.pixar.com/",
    },
  ],
  "als-ice-bucket-challenge": [
    {
      title: "Movember (2003〜)",
      description: "男性が11月に髭を伸ばして男性の健康問題への認知を高めるムーブメント。「身体への行為」を媒介にした自発的参加型チャリティ活動の先行事例。",
      url: "https://us.movember.com/",
    },
    {
      title: "Planking・Harlem Shake等のバイラルチャレンジ (2010〜2013年)",
      description: "SNS上で自発拡散するチャレンジカルチャーの先行形態。Ice Bucket Challengeはこの文化に社会的意義を接続した。",
      url: "https://en.wikipedia.org/wiki/Harlem_Shake_(meme)",
    },
    {
      title: "Peter Singer「効果的利他主義」(Effective Altruism)",
      description: "感情的共鳴より合理的インパクトを重視する慈善哲学。Ice Bucket Challengeの感情ドリブンなアプローチとの対比として参照される。",
      url: "https://www.effectivealtruism.org/",
    },
  ],
  "chipotle-back-to-start": [
    {
      title: "Pixar「For the Birds」(2000年 短編映画)",
      description: "短編アニメで弱者への優しさという普遍的テーマを語る。Stop-Motionを使った感情的ストーリーテリングの先行作。",
      url: "https://www.youtube.com/watch?v=nYTrIcn4rjg",
    },
    {
      title: "「The Story of Stuff」(2007年 Annie Leonard)",
      description: "消費文化の問題を20分のアニメで説明したバイラルドキュメンタリー。同様に「商業的言語を超えたアニメの訴求力」を示す。",
      url: "https://www.storyofstuff.org/movies/story-of-stuff/",
    },
    {
      title: "Budweiser「Brotherhood」(2013年 スーパーボウル)",
      description: "Clydesdaleの馬と飼育員の絆を描いたスーパーボウルCM。製品登場なしで感情を喚起するFilm Advertisingの同時期の傑作。",
      url: "https://www.youtube.com/watch?v=yOjn0Ub-lCE",
    },
  ],
  "pg-thank-you-mom": [
    {
      title: "Budweiser「Brotherhood」(2013年 スーパーボウル)",
      description: "親子の別れと再会をClydesdale馬で描いたスーパーボウルCM。普遍的な絆を製品の価値と結びつける同時代の傑作。",
      url: "https://www.youtube.com/watch?v=yOjn0Ub-lCE",
    },
    {
      title: "John Lewis「The Bear and the Hare」(2013年)",
      description: "感情訴求型の長尺フィルム広告として同時期に評価された。クリスマスという節目に家族・友人との絆を描く。",
      url: "https://www.youtube.com/watch?v=WCFGRkFUGLQ",
    },
    {
      title: "NHK「母と子の映像詩」系列 (1990〜)",
      description: "日本のドキュメンタリーテレビで母と子の絆を叙情的に描いたシリーズ。P&G「Best Job」と同様に「言葉より映像で感情を語る」手法。",
      url: "https://www.nhk.or.jp/",
    },
  ],
  "apple-shot-on-iphone": [
    {
      title: "Instagram「Year in Review」(2013〜)",
      description: "プラットフォームが年末にユーザーの投稿を再編集してシェアする機能。UGCをキュレーションすることで「参加者全員がコンテンツの一部になる」構造が共鳴する。",
      url: "https://www.instagram.com/",
    },
    {
      title: "Shirin Neshat「Women of Allah」写真シリーズ (1993〜1997年)",
      description: "アマチュアの人々が主体となったドキュメンタリー写真の美学。Shot on iPhoneが示す「素人の眼が持つ力」と同じ問いを抱く。",
      url: "https://en.wikipedia.org/wiki/Shirin_Neshat",
    },
    {
      title: "Henri Cartier-Bresson「決定的瞬間」(1952年)",
      description: "スナップ写真の美学を確立した写真家の代表作。日常の瞬間を芸術に昇華するiPhone写真文化の思想的起源。",
      url: "https://en.wikipedia.org/wiki/The_Decisive_Moment_(book)",
    },
  ],
  "john-lewis-bear-hare": [
    {
      title: "Coca-Cola「Holidays Are Coming」(1995年)",
      description: "クリスマストラックのCMがUK・USの「クリスマスの訪れ」のシンボルになった先駆例。ブランドが季節感と文化的に融合した最初の大規模成功例。",
      url: "https://www.youtube.com/watch?v=UuGbRjGMFmQ",
    },
    {
      title: "宮崎駿「となりのトトロ」(1988年)",
      description: "子どもの目から見た自然・友情・家族の絵本的アニメーション。John Lewisアニメシリーズが持つ手作り感・温かさと同質のビジュアル言語。",
      url: "https://www.imdb.com/title/tt0096283/",
    },
    {
      title: "Charles Dickens「クリスマス・キャロル」(1843年)",
      description: "クリスマスを「贈ることと感謝の季節」として近代的に定義した物語の原点。John Lewis広告シリーズの感情的基盤。",
      url: "https://en.wikipedia.org/wiki/A_Christmas_Carol",
    },
  ],
  "dove-evolution": [
    {
      title: "Jean Kilbourne「Killing Us Softly」(1979〜)",
      description: "広告が女性の自己イメージに与える影響を分析したドキュメンタリーシリーズ。Dove Evolutionが問題提起した「作られた美」の批判の思想的先祖。",
      url: "https://www.jeankilbourne.com/",
    },
    {
      title: "Morgan Spurlock「Super Size Me」(2004年)",
      description: "商業的食品産業の実態を暴くドキュメンタリー形式のフィルム。業界自身が自己批判する構造がDove Evolutionと共鳴する。",
      url: "https://www.imdb.com/title/tt0390521/",
    },
    {
      title: "Cindy Sherman 写真シリーズ (1977〜)",
      description: "自分自身をさまざまなメディアの女性イメージに扮した写真。「メディアが作り出す女性像」への批評的視点がDove Evolutionと同じ問いを持つ。",
      url: "https://en.wikipedia.org/wiki/Cindy_Sherman",
    },
  ],
  "uniqlock": [
    {
      title: "We Feel Fine (2006年 / Jonathan Harris & Sep Kamvar)",
      description: "世界中のブログから「I feel...」という文章を収集しビジュアライズしたウェブアート。UNIQLOCKの「世界中に広がる時計」と共鳴する。",
      url: "http://wefeelfine.org/",
    },
    {
      title: "Nike「Running App (Nike+iPod)」(2006年)",
      description: "スポーツ×デジタルの融合で「使われる広告」を初めて大規模に実現したアプリ。UNIQLOCKと同時期に「ユーティリティとしての広告」の概念を形成した。",
      url: "https://en.wikipedia.org/wiki/Nike%2B",
    },
    {
      title: "Sol LeWitt「Wall Drawings」(1968〜)",
      description: "世界中の場所でインストラクションに基づき誰もが実施できる壁画アート。UNIQLOCKが「誰もが場所を選ばず実装できる広告」という概念と構造的に共鳴する。",
      url: "https://en.wikipedia.org/wiki/Sol_LeWitt",
    },
  ],
  "field-trip-to-mars": [
    {
      title: "Google「Cardboard」(2014年)",
      description: "段ボールで作れるVRゴーグルで教育・体験のVR民主化を図ったプロジェクト。テクノロジーを教育に結びつける試みとして構造が近い。",
      url: "https://arvr.google.com/cardboard/",
    },
    {
      title: "Christo & Jeanne-Claude「The Floating Piers」(2016年 イタリア北部)",
      description: "イタリア北部の湖に浮かぶ橋を設置した大型インスタレーション。日常の「移動」を非日常の「体験」に変換するコンセプトが共鳴する。",
      url: "https://christojeanneclaude.net/projects/the-floating-piers",
    },
    {
      title: "James Turrell「Roden Crater」(1977〜 制作中)",
      description: "アリゾナ州の火山噴火口を光の体験空間に変えた大型インスタレーション。「移動して到達する体験」という点でField Trip to Marsと構造が近い。",
      url: "https://rodencrater.com/",
    },
  ],
  "spotify-wrapped": [
    {
      title: "Facebook「Year in Review」(2013〜)",
      description: "ソーシャルメディアが個人の年間活動を自動まとめして振り返らせる機能。Wrapped同様に個人データを感情的体験に変換する試み。",
      url: "https://www.facebook.com/",
    },
    {
      title: "Nicholas Felton「Annual Reports」(2005〜2013年)",
      description: "デザイナーが自分自身の年間行動データを美しいインフォグラフィックとして印刷製本し配布。Wrappedのデータ自己表現の概念的先駆者。",
      url: "http://feltron.com/",
    },
    {
      title: "Brian Eno「77 Million Paintings」(2006年)",
      description: "個々のコンピューターで無限に異なるビジュアルを生成するジェネラティブアート。「一人ひとり異なる体験を自動生成する」思想がWrappedの個人化と共鳴する。",
      url: "https://www.enoshop.co.uk/product/77-million-paintings.html",
    },
  ],
  "volkswagen-fun-theory": [
    {
      title: "Richard Thaler & Cass Sunstein「Nudge」(2008年)",
      description: "行動設計で人々の選択を誘導する「ナッジ」概念の提唱。Fun Theoryはこの概念をエンターテインメントとして可視化したキャンペーン。",
      url: "https://en.wikipedia.org/wiki/Nudge_(book)",
    },
    {
      title: "Improv Everywhere「Frozen Grand Central」(2008年)",
      description: "グランドセントラル駅で数百人が同時に凍りつくフラッシュモブ。日常空間を驚きの体験に変える介入型パフォーマンスとして構造が近い。",
      url: "https://improveverywhere.com/2008/01/31/frozen-grand-central/",
    },
    {
      title: "Dan Ariely「Predictably Irrational」(2008年)",
      description: "人間の非合理的な意思決定を解明した行動経済学の著書。Fun Theoryの理論的基盤とも言える「楽しさと選択の関係」を科学的に記述する。",
      url: "https://en.wikipedia.org/wiki/Predictably_Irrational",
    },
  ],
  "honda-the-cog": [
    {
      title: "Céleste Boursier-Mougenot《From Here to Ear》(1999〜)",
      description: "ギターを自由に走り回るフィンチ（鳥）たちが偶然に音楽を奏でるインスタレーション。精密な設計と偶発性の共存という美学がThe Cogと構造的に近い。",
      url: "https://en.wikipedia.org/wiki/C%C3%A9leste_Boursier-Mougenot",
    },
    {
      title: "Rube Goldberg Machineアート (1930〜)",
      description: "複雑な連鎖装置で簡単なタスクを達成するユーモラスな機械アートの伝統。The Cogはこの文脈の最も崇高な実現例の一つ。",
      url: "https://en.wikipedia.org/wiki/Rube_Goldberg_machine",
    },
    {
      title: "George Rhoads「Audiokinetic Sculptures」(1970〜)",
      description: "球が転がりながら音を奏でる精密連鎖彫刻。The Cogのリアルな連鎖美学と直接接続する美術的先祖。",
      url: "https://en.wikipedia.org/wiki/George_Rhoads",
    },
  ],
};

const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
let updated = 0;

for (const c of cases) {
  if (RELATED_WORKS_DATA[c.id]) {
    c.relatedWorks = RELATED_WORKS_DATA[c.id];
    updated++;
  }
}

await fs.writeFile(CASES_PATH, JSON.stringify(cases, null, 2));
console.log(`${updated}件のrelatedWorksを配列形式に変換完了`);
const remaining = cases.filter(c => typeof c.relatedWorks === "string");
if (remaining.length > 0) {
  console.log("未変換:", remaining.map(c => c.id).join(", "));
}
