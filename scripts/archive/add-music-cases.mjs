import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");

const newCases = [
  {
    id: "charli-xcx-brat",
    title: "BRAT（Charli XCX）",
    summary: "「安くてダサい」緑色のカバーをあえて採用——Charli XCXが2024年夏の文化を席巻した「bratサマー」現象。カマラ・ハリス選挙キャンペーンにまで波及した。",
    client: "Charli XCX",
    agency: "（本人 + Atlantic Records）",
    categories: ["カルチャーインサイト", "メディア発明", "コンテンツ革新"],
    award: "2025 Brit Award Album of the Year / Cannes Lions 2025 Entertainment Lions受賞",
    year: "2024",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=WJW-VvmRKsE",
    thumbnail: "https://i.ytimg.com/vi/WJW-VvmRKsE/hqdefault.jpg",
    videoId: "WJW-VvmRKsE",
    overview: "2024年6月7日リリースのアルバム「BRAT」。鮮やかな黄緑色（PANTONE 3570 C）のシンプルなカバーと、わざと安っぽく見えるフォントを採用。「brat summer」というハッシュタグが世界的ミームとなり、Charliが「kamala is brat」とポストしたことでカマラ・ハリスの選挙キャンペーンが公式にBRATグリーンを採用する異例の展開に。アルバム単体でなく「美学」がコミュニティを生んだ。",
    background: "Charli XCXはデジタルネイティブなPC Music/ハイパーポップ文化の旗手として知られる。BRATはアルバム制作費節約のために「一番シンプルなデザインにした」というエピソードが逆に話題を呼んだ。Z世代のアンチ・ポリッシュ（完璧主義への反抗）というインサイトを鋭く突いた。",
    execution: "黄緑のカバーデザインをブランドカラーとして全プロモーションに展開。ミュージックビデオ「360」ではブラットの美学を体現するモデル・俳優・アーティスト（Julia Fox、Alex Demie等）が登場。SNSでは公式が積極的にミームを拡散・リポスト。Spotifyやビルボードの視覚素材もすべてBRATグリーンで統一。カマラ・ハリス選挙本部が公式SNSアカウントを「kamala hq is brat」に変更してBRATグリーンを採用した。",
    evaluationImpact: "2024年夏の「brat summer」はPopビジネス史に残る有機的文化現象となった。2025年Brit Award最多5部門受賞（アルバム・オブ・ザ・イヤー含む）。「アンチ・パーフェクションの美学」「ミームがブランドになる」モデルとして、マーケティング・文化批評の両面で分析される。アルバムの音楽的革新性（ハイパーポップとメインストリームの橋渡し）と同等以上に「プロモーション現象」として語られた事例。",
    relatedWorks: [
      { title: "Charli XCX「360」Official MV (2024年)", description: "BRATの核心を体現したリードシングルMV。ファッション・アート界のアイコンが登場し「ブラットの美学」を定義した。", url: "https://www.youtube.com/watch?v=WJW-VvmRKsE" },
      { title: "Kamala Harris 2024年選挙キャンペーン × BRAT", description: "「kamala is brat」からアメリカ副大統領がBRATグリーンを選挙に使うという異例の展開。ポップカルチャーと政治の接触。", url: "https://en.wikipedia.org/wiki/Kamala_Harris_2024_presidential_campaign" },
      { title: "Olivia Rodrigo「SOUR」(2021年）", description: "同じくZ世代アーティストが「アンチ・グラム」な美学でメインストリームを席巻したデビューアルバム。BRATと同じ文化的文脈。", url: "https://www.youtube.com/watch?v=AJtDXIazrMo" }
    ]
  },
  {
    id: "kendrick-not-like-us",
    title: "NOT LIKE US（Kendrick Lamar × Drake Beef）",
    summary: "1週間で5曲のディストラックを投下、7月4日に独立記念日のMVをリリース——SNS時代最大のラップビーフが、リアルタイムのエンターテインメントとしての「音楽プロモーション」を再定義した。",
    client: "Kendrick Lamar（pgLang）",
    agency: "Dave Free（監督）/ pgLang",
    categories: ["カルチャーインサイト", "コンテンツ革新", "メディア発明"],
    award: "Grammy 2025 Record of the Year / Song of the Year他4部門",
    year: "2024",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=H58vbez_m4E",
    thumbnail: "https://i.ytimg.com/vi/H58vbez_m4E/hqdefault.jpg",
    videoId: "H58vbez_m4E",
    overview: "2024年4月〜5月、KendrickとDrakeの間で展開されたラップビーフ。Kendrickは「Euphoria」「6:16 in LA」「Meet the Grahams」「Not Like Us」「The Heart Part 6 Response」を1週間以内に相次いでリリース。特に「Not Like Us」（2024年5月4日）はDissin TrackがBillboard Hot 100首位に達した初の事例。7月4日（独立記念日）にMVをリリースすることで「Drake支配からの独立」のメタファーを付与。文化的イベントとして音楽史に残った。",
    background: "KendrickとDrakeの対立は数年続いていたが、2024年にJ. Coleも絡む三つ巴の展開で爆発。Kendrickは「Meet the Grahams」でDrakeの隠し子疑惑を告発し、「Not Like Us」でLAの地元コミュニティをバックにDrakeを批判。リリーススケジュール・タイミング・MV公開日の選択がすべてメッセージとして機能した。",
    execution: "5曲を1週間に投下する「速攻戦略」でSNSを占拠。「Not Like Us」のMVはロサンジェルスの地元住民数百人を動員した集会映像として制作。7月4日という「独立記念日」のリリースはDrakeへのメタファーとして設計。Spotifyでは公開直後に史上最速のストリーム記録を更新。12月には「ザ・サンズ・アー・アライニング」タイトルのケンドリックのコンサート「ザ・グレートエスト・ショー・オン・アース」のヘッドラインまで発展した。",
    evaluationImpact: "2025年 Grammy Award Record of the Year・Song of the Year・Best Rap Song・Best Music Video・Best Melodic Rap Performance 5部門受賞。「ディス曲がGrammyを総なめにする」という前例のない事態。音楽の「プロモーション」という概念をリアルタイム・カルチャー・イベントとして再定義した。ソーシャルメディア時代のラップビーフが持つ「商業的価値」を最大化した事例として音楽ビジネス史に刻まれた。",
    relatedWorks: [
      { title: "Drake「Pusha T」ビーフ (2018年）", description: "前世代の有名ラップビーフ。社会的影響は大きかったがSNS時代の「リアルタイム性」はまだ限定的だった比較事例。", url: "https://en.wikipedia.org/wiki/Pusha_T_and_Drake_beef" },
      { title: "Taylor Swift「Eras Tour」(2023年）", description: "同じ2024年にScooter Braun問題からの「勝利のナラティブ」を体現したプロモーション戦略。Kendrickと同様「カルチャー的勝利」として消費された。", url: "https://www.youtube.com/watch?v=rRjTdbmpQxM" },
      { title: "Beyoncé「Lemonade」(2016年）", description: "個人的な怒りと社会的メッセージを融合し、アルバム全体がナラティブとして機能した先行事例。", url: "https://en.wikipedia.org/wiki/Lemonade_(Beyonc%C3%A9_album)" }
    ]
  },
  {
    id: "ado-world-tour-wish",
    title: "Ado THE FIRST WORLD TOUR「Wish」",
    summary: "素顔を一度も公開したことのない匿名シンガーが、初のワールドアリーナツアーを完走——「顔を見せない」戦略で成立させた前例なき世界規模の音楽体験。",
    client: "Ado（Universal Music Japan）",
    agency: "Crunchyroll（北米・欧州パートナー）",
    categories: ["ブランドエクスペリエンス", "カルチャーインサイト", "コンテンツ革新"],
    award: "（受賞情報なし）",
    year: "2024",
    regions: ["グローバル", "国内"],
    link: "https://www.youtube.com/watch?v=TR7pmffN2EY",
    thumbnail: "https://i.ytimg.com/vi/TR7pmffN2EY/hqdefault.jpg",
    videoId: "TR7pmffN2EY",
    overview: "2022年デビュー以来、SNSなどで一切素顔を公開しない「匿名シンガー」として活動するAdo（アド）が2024年に実施した世界初のワールドアリーナツアー。北米・欧州・アジア21都市。ライブでは独自のシルエットと衣装・照明演出で「顔が見えない」ままで数万人のアリーナを満員にした。「One Piece Film: Red」のウタ役で国際的ブレイクを果たした後、Crunchyrollとのパートナーシップで北米・欧州でのアニメファン層を開拓した。",
    background: "AdoはSoundCloud系のVOCALOID文化出身で、2021年の「うっせぇわ」が若者に爆発的にヒット。その後「One Piece Film: Red」でキャラクター「ウタ」の声を担当し、グローバルな認知を獲得。しかし終始素顔を公開しないことで「声だけの存在」としてのミステリアスなブランドが形成された。世界ツアーは「顔が見えない状態でのリアルライブ」という矛盾した企画に挑戦した。",
    execution: "ステージでは大型スクリーンにシルエット・エフェクト映像を投影。Adoはステージ上で衣装とオーバーサイズの特殊スーツを着用してパフォーマンス。「顔を見せずに感動させる」演出設計として照明・映像・音響の統合演出を最大化。北米・欧州はCrunchyrollが共同主催することでアニメファン・日本音楽ファン双方にリーチした。",
    evaluationImpact: "全21都市完売・累計約30万人動員（2024年ツアー）。「素顔を見せない日本人歌手が世界のアリーナを満員にする」という前例のない実績を残した。アイドルやアーティストのプロモーションにおける「顔の重要性」への根本的な問いを投げかけた。後の2025年の大阪万博における追加公演など、引き続き国際的な活動を継続している。",
    relatedWorks: [
      { title: "Daft Punk（1993〜2021年）", description: "ロボットヘルメットで素顔を隠し続けたエレクトロニックデュオ。「匿名性がブランドになる」という先行事例の象徴。", url: "https://en.wikipedia.org/wiki/Daft_Punk" },
      { title: "Ado「New Genesis (Uta from One Piece Film: Red)」(2022年）", description: "Adoがグローバル認知を獲得したきっかけとなった作品。素顔非公開のまま映画の主役キャラクターを演じるという特異な事例。", url: "https://www.youtube.com/watch?v=6lnnPnr_0SU" },
      { title: "Gorillaz（2001〜）", description: "アニメキャラクターを前面に出してメンバーの素顔を基本的に隠すバーチャルバンド。匿名/仮想アーティストのプロモーション先例。", url: "https://www.gorillaz.com/" }
    ]
  },
  {
    id: "taylor-swift-eras-tour",
    title: "TAYLOR SWIFT: THE ERAS TOUR",
    summary: "「Swiftonomics」と呼ばれた経済現象——17年分の音楽キャリアを「時代」として再編し、コンサートフィルムを配給会社なしで劇場公開した史上最大の音楽エンターテインメント事業。",
    client: "Taylor Swift / Taylor Swift Productions",
    agency: "AMC Theaters（劇場パートナー）",
    categories: ["ブランドエクスペリエンス", "コンテンツ革新", "カルチャーインサイト"],
    award: "（受賞情報なし）",
    year: "2023",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=rRjTdbmpQxM",
    thumbnail: "https://i.ytimg.com/vi/rRjTdbmpQxM/hqdefault.jpg",
    videoId: "rRjTdbmpQxM",
    overview: "2023年3月開幕の「Eras Tour」は全149公演・21億ドル超の興行収入を記録し、史上最高収益コンサートツアーとなった。「時代（Era）」という概念でSwiftの17年のキャリアを再文脈化し、各アルバム時代のコスチューム・セットリストで3時間半のショーを構成。さらに2023年10月にコンサートフィルムを映画スタジオを通さずAMCシアターと直接交渉して劇場公開——映画産業のディストリビューション慣習を破った。",
    background: "スクーターブラウンとのマスター音源問題（2019年）から「テイラーズ・バージョン」として旧作を再録音し権利を取り戻す過程が「Swifties」ファンムーブメントと連動。「アーティストが自分の音楽の所有権を持つ」という主張がEras Tour全体のナラティブの核になった。コンサートフィルム直接劇場配給は映画業界の「プロデューサー→スタジオ→劇場」の流通構造を迂回する事例として業界震撼を呼んだ。",
    execution: "友情ブレスレット交換文化（Swiftiesがコンサートで自作ブレスレットを交換）がSNSで拡散。毎公演で「サプライズソング」をアコースティックで演奏する慣習が話題に。コンサートフィルムはAMCシアターと直接交渉でスタジオを介さずに配給。映画公開3週間で1億ドル以上を稼ぎ、「コンサートフィルム」ジャンルを再活性化した。",
    evaluationImpact: "ツアー訪問都市の地元経済に合計46億ドルの経済効果（「Swiftonomics」）。全公演完売・チケット転売価格高騰が社会問題化するほどの需要を生んだ。コンサートフィルムの直接配給モデルはハリウッドの配給システムを問い直す先行事例となった。文化現象として「友情ブレスレット・ファン文化・再録音」が音楽ビジネスの教科書事例になった。",
    relatedWorks: [
      { title: "Beyoncé「Renaissance World Tour」コンサートフィルム（2023年）", description: "同年、BeoncéもRenaissance世界ツアーのコンサートフィルムを劇場公開。Taylor Swiftとともに「コンサートフィルム」ジャンルを復活させた。", url: "https://www.youtube.com/watch?v=01RW5OtnFkE" },
      { title: "BTS「Permission to Dance」ライブビューイング（2021年）", description: "世界同時ライブビューイングという形式でグローバルファンを繋いだ先行事例。コンサートの映像化・広域配信という文脈で共鳴。", url: "https://www.youtube.com/watch?v=CuklIb9d3fI" },
      { title: "Prince「Purple Rain」(1984年）", description: "アーティストが自ら映画制作・配給に関わり音楽と映像を融合した先例。Taylorの「コンサートフィルムの直接配給」という自律的流通の先駆。", url: "https://en.wikipedia.org/wiki/Purple_Rain_(film)" }
    ]
  },
  {
    id: "yoasobi-idol",
    title: "YOASOBI「アイドル」",
    summary: "アニメ「推しの子」のOP——日本語曲として初めてBillboard Global 200首位を獲得し、アニメを入口に日本音楽のグローバル進出を塗り替えた。",
    client: "YOASOBI（Ayase & Ikura）",
    agency: "Sony Music Labels Inc.",
    categories: ["コンテンツ革新", "カルチャーインサイト"],
    award: "Billboard Global 200 #1（日本語曲初）/ Spotify Global Viral 50 #1",
    year: "2023",
    regions: ["グローバル", "国内"],
    link: "https://www.youtube.com/watch?v=ZRtdQ81jPUQ",
    thumbnail: "https://i.ytimg.com/vi/ZRtdQ81jPUQ/hqdefault.jpg",
    videoId: "ZRtdQ81jPUQ",
    overview: "2023年4月12日公開。アニメ「推しの子」の主題歌として制作。アイドル業界の虚構と真実・SNS文化の欺瞞を批判的に内包した歌詞と、YOASOBIならではの高速ボーカルと転調が融合した4分弱の楽曲。アニメ「推しの子」が世界中で配信されたことで、日本語楽曲として初めてBillboard Global 200の首位を獲得。Spotifyグローバル・バイラル50でも首位。",
    background: "YOASOBIは「小説を音楽にする」コンセプトで2019年に結成。小説投稿サイト「monogatary.com」に掲載されたゆずはらとしのぶ「45510」を原案に制作された。アイドル産業への批評的眼差しと感情的共鳴の両立が、日本国内のみならず英語圏・東南アジア・欧州でも受容された。アニメ配信プラットフォーム（Crunchyroll等）のグローバル展開が間接的に楽曲の普及を後押しした。",
    execution: "アニメ「推しの子」放映開始直後にMVが公開。アニメの物語と深くリンクした歌詞が視聴者の理解を深め、非日本語話者でも「意味を調べて感動する」というエンゲージメントが生まれた。英語歌詞版も制作されたが、原曲の日本語版が圧倒的に多くストリームされた。TikTokでのカバー・リアクション動画が欧米の非アニメファン層にも伝播した。",
    evaluationImpact: "Billboard Global 200首位は日本語曲として史上初の快挙。日本音楽のグローバル展開において「アニメ主題歌」というフォーマットの有効性を最大限に実証した。韓国語（BTS）・英語（テイラー・スウィフト）以外の言語の楽曲がグローバルチャートを制覇したことで「言語の壁を超える音楽」の議論が再燃した。後続のYOASOBIの欧米ツアー（2024年）の成功にも直結した。",
    relatedWorks: [
      { title: "Ado「New Genesis」One Piece Film: Red (2022年）", description: "日本アニメとの結合でグローバルに展開した先行事例。同じく「アニメ主題歌が日本音楽のグローバル入口になる」という文脈。", url: "https://www.youtube.com/watch?v=6lnnPnr_0SU" },
      { title: "BTS「Dynamite」(2020年）", description: "韓国語アーティストが英語曲でBillboard Hot 100首位を初獲得した事例。アジア音楽のグローバル進出という同じ文脈の先行事例。", url: "https://www.youtube.com/watch?v=bdj2eo8FHZY" },
      { title: "Kenshi Yonezu「Lemon」(2018年）", description: "日本国内で記録的ヒットを達成しYoasobi以前のJ-POPのピーク事例として比較参照される。", url: "https://www.youtube.com/watch?v=SX_ViT4Ra7k" }
    ]
  },
  {
    id: "newjeans-phoning-app",
    title: "NewJeans「Phoning」ファンプラットフォーム",
    summary: "「彼女感」設計の専用SNSアプリ——NewJeansのメンバーが直接投稿・通話するような親密な体験を提供し、K-POPのファン接触モデルを再定義した。",
    client: "NewJeans（ADOR / HYBE）",
    agency: "ADOR（内製）",
    categories: ["ブランドエクスペリエンス", "メディア発明", "カルチャーインサイト"],
    award: "（受賞情報なし）",
    year: "2023",
    regions: ["グローバル", "アジア"],
    link: "https://www.youtube.com/watch?v=sLk2ZOj7vI0",
    thumbnail: "https://i.ytimg.com/vi/sLk2ZOj7vI0/hqdefault.jpg",
    videoId: "sLk2ZOj7vI0",
    overview: "NewJeansのために開発された専用ファンコミュニケーションアプリ「Phoning」。一般的なファンカフェやWeverse（他K-POPアーティスト用）と異なり、「友達に電話する」という体験デザインが特徴。メンバーが不定期に「通話」「テキスト」「写真」を投稿し、ファンは友人とのやり取りような親密感を体験できる。UIは意図的に2000年代風のレトロデザインを採用。",
    background: "NewJeansはMIN HEE JINがADOR（HYBE子会社）で立ち上げたグループで、過剰なマーケティングを排除した「自然体」コンセプトで2022年デビュー。PhoningはK-POPの「ファン管理プラットフォーム」（Weverse等）に対するアンチテーゼとして設計された。「アーティストとファンの距離感を縮める」というFandom 2.0のコンセプト。",
    execution: "アプリをインストールすると「メンバーから電話がかかってきた」ような通知が届き、不定期な「通話ライブ」「写真」「短いテキスト」が投稿される。通話ライブでは各メンバーが個別に配信を行い、普段の様子を見せる「彼女感」演出。着信音やUIの細部まで「友人に電話する」体験として設計された。",
    evaluationImpact: "Phoningは「K-POPファンプラットフォームの次世代モデル」として業界から注目を集めた。NewJeansのデビューから1年でグローバルに急速なファンダム拡大を実現。2023年の「OMG」「ETA」「Super Shy」等の連続ヒットにPhoningによるファンコミュニティの熱量が寄与したとされる。WeverseやV LIVEとは異なる「親密さ設計」のプラットフォームモデルとして、後続のK-POPグループのファンアプリ開発に影響を与えた。",
    relatedWorks: [
      { title: "BTS「Weverse」プラットフォーム（2019年〜）", description: "K-POPファンコミュニケーションの標準プラットフォームとして機能してきた先行事例。NewJeansのPhoningが目指した「脱Weverse」の比較対象。", url: "https://weverse.io/" },
      { title: "Taylor Swift「Swiftie」ファンダム構築戦略", description: "友情ブレスレット・イースターエッグ等でファンの主体的な参加を設計した事例。NewJeansのPhoningと同じく「ファンとの関係設計」を核にしたアーティスト戦略。", url: "https://www.youtube.com/watch?v=rRjTdbmpQxM" },
      { title: "Instagram「Close Friends」機能（2018年〜）", description: "限定的な「親友」にだけ投稿を公開する機能。PhoningのUI設計思想（選ばれた感・親密さ）と共鳴するSNS設計。", url: "https://www.instagram.com/" }
    ]
  },
  {
    id: "aespa-kwangya",
    title: "aespa「KWANGYA」メタバース概念",
    summary: "実在のメンバー4人＋デジタルアバター4人が「KWANGYA」という仮想世界で存在する——SM Entertainmentが構築したK-POPとメタバースの融合ナラティブ。",
    client: "aespa（SM Entertainment）",
    agency: "SM Entertainment（内製）",
    categories: ["ブランドエクスペリエンス", "空間体験", "テクノロジー×アイデア"],
    award: "（受賞情報なし）",
    year: "2020",
    regions: ["グローバル", "アジア"],
    link: "https://www.youtube.com/watch?v=vbH4Lk5wYWg",
    thumbnail: "https://i.ytimg.com/vi/vbH4Lk5wYWg/hqdefault.jpg",
    videoId: "vbH4Lk5wYWg",
    overview: "2020年11月デビューのK-POPグループaespaは、Karina・Giselle・Winter・NingNingの4人の実在メンバーと、それぞれに対応するAIアバター「ae-Karina」等がデジタル世界「KWANGYA（광야）」で存在するという設定を持つ。楽曲・MVはすべてこの「SM Culture Universe（SMCU）」の世界観と連動し、ファンが物語を追いながら音楽を楽しむ多層的なブランド体験を構築した。",
    background: "SM Entertainmentが「SM Culture Universe」というK-POP初の包括的なメタバースナラティブを構築する戦略の核として設計。「現実の人間とその分身がメタバースで共存する」コンセプトは、2020年代初頭のメタバースブームと同期した先取りだった。デビュー曲「Black Mamba」のMVはAIと人間の融合・KWANGYA世界の初提示として制作された。",
    execution: "MVがSMCU（SM Culture Universe）の「Ep.1」として位置づけられ、各楽曲が連続するエピソードの形を取る。「KWANGYA」という固有の地名・世界観を設定し、ファンがコンテンツを考察するコミュニティが自発的に形成された。VRコンサート「LYNK-POP」も実施。2021年にはaespaが国連に出席し「メタバースで持続可能な世界を代表する」スピーチを行った。",
    evaluationImpact: "「K-POPにメタバースが来た」と世界中のメディアが報道。デビュー半年で「Next Level」がBillboard Global 200入り。ファン（MY）がKWANGYAの世界観を自発的に分析・考察する「ロアコミュニティ」が形成され、音楽消費の新しいエンゲージメント形態を生み出した。後にSM傘下グループのNaVisとEXO等が同一ユニバースに統合される「SM Culture Universe」戦略の起点となった。",
    relatedWorks: [
      { title: "Marvel Cinematic Universe（MCU, 2008〜）", description: "複数の作品が相互に連動する「ユニバース構築」の映画的先例。aespaのSMCUはMCUのK-POP版として設計された。", url: "https://en.wikipedia.org/wiki/Marvel_Cinematic_Universe" },
      { title: "Hatsune Miku（2007〜）", description: "仮想キャラクターが「実在するアーティスト」として機能した先例。aespaの「実在メンバー×デジタルアバター」のコンセプトの思想的先祖。", url: "https://piapro.net/" },
      { title: "BTS「BTS Universe（BU）」(2015〜）", description: "楽曲・MV・小説が相互に連動する物語世界を構築した先行事例。aespaのSMCUのK-POP内の直接的先例。", url: "https://en.wikipedia.org/wiki/BTS_Universe" }
    ]
  },
  {
    id: "beyonce-renaissance",
    title: "RENAISSANCE & THE RENAISSANCE WORLD TOUR",
    summary: "「映像なし」で発売し、コンサートで世界を席巻——Beyoncéがダンスミュージックの歴史を讃えながら、自らの50代でのブランドを刷新した2022〜2023年の一大プロジェクト。",
    client: "Beyoncé（Parkwood Entertainment）",
    agency: "Ed Burke（ツアーディレクター）",
    categories: ["コンテンツ革新", "カルチャーインサイト", "ブランドエクスペリエンス"],
    award: "Grammy 2023 Best Dance/Electronic Album 他 / Renaissance World Tour 5.8億ドル",
    year: "2022",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=01RW5OtnFkE",
    thumbnail: "https://i.ytimg.com/vi/nrtfZ4Ik1q4/hqdefault.jpg",
    videoId: "01RW5OtnFkE",
    overview: "2022年7月29日発売のアルバム「Renaissance」は、発売時にミュージックビデオを一切リリースしないという異例の戦略を採用。LGBTQコミュニティ・ハウスミュージックの歴史へのオマージュとして制作された16曲は、Black Baller Culture・Vogue文化・クラブシーンの原点を讃える構成。2023年のRenaissance World Tourは5.8億ドルを稼ぐ巨大興行となり、2023年12月には同ツアーのコンサートフィルムを自身で配給した。",
    background: "2022年当時、ストリーミング時代のアルバム発売に「シングル先行→MV公開」という定型が定着していた。BeやoncéはRenaissanceで「ビジュアルを出さない」という逆説的戦略を採り、音楽そのものへの集中を促した。作品の背景にあるハウス・ボール文化（1970〜80年代のニューヨーク黒人・クィアコミュニティの文化）の文脈が、CDセールスより批評的評価で高く評価された。",
    execution: "アルバム発売後、ビジュアルは一切公開せず。代わりにコンサートツアーのビジュアルで「映像のない作品」を視覚化。Renaissance World Tourは56カ国・56都市・57公演で展開。銀色の宇宙的衣装・巨大ステージセット・ホログラムを用いた演出が各地で話題に。ツアー後、BeyoncéはAmericanaとカントリーへと転身した「Cowboy Carter」(2024年)を発表し、Renaissanceとの三部作プロジェクトとして設計されていることを明かした。",
    evaluationImpact: "Renaissance World Tourは単一アーティストの年間ツアー売上で史上最高記録（当時）を更新（後にTaylor Swift Eras Tourが上回る）。「音楽を映像で補完しない」という戦略は批評家から「作品の純度を守る」と高く評価された。Renaissanceをルーツとするハウス・ボール文化の認知が世界的に拡大した。",
    relatedWorks: [
      { title: "Beyoncé「Lemonade」(2016年）", description: "映像作品として先に公開し、アルバムを後追いするという逆転発表の先作。ReissancEとあわせてBeyoncéのアルバム発表戦略の革新系譜をなす。", url: "https://en.wikipedia.org/wiki/Lemonade_(Beyonc%C3%A9_album)" },
      { title: "Taylor Swift「The Eras Tour」(2023年）", description: "同時期にコンサートフィルムの直接配給という共通手法を採用した事例。最大ライバルとして比較される2大コンサートフィルム。", url: "https://www.youtube.com/watch?v=rRjTdbmpQxM" },
      { title: "Frank Ocean「Blonde」(2016年）", description: "ビジュアルアルバムとして自社Appleストアで独占先行配信し、その後ビジュアルメディアを「Endless」として分離公開するという戦略的な情報発信。", url: "https://en.wikipedia.org/wiki/Blonde_(Frank_Ocean_album)" }
    ]
  },
  {
    id: "ado-uta-one-piece",
    title: "Ado「ウタ（Uta）」ONE PIECE FILM: RED",
    summary: "素顔を隠す匿名歌手が、Shonen Jumpの国民的アニメの主人公「ウタ」として世界デビュー——アーティストとアニメキャラクターが「同一」になった前例なき融合。",
    client: "東映アニメーション / Ado（Universal Music Japan）",
    agency: "東映アニメーション",
    categories: ["コンテンツ革新", "カルチャーインサイト", "ブランドエクスペリエンス"],
    award: "Billboard Japan Hot Albums #1 / Billboard Global 200 Top 80入り",
    year: "2022",
    regions: ["グローバル", "国内"],
    link: "https://www.youtube.com/watch?v=6lnnPnr_0SU",
    thumbnail: "https://i.ytimg.com/vi/6lnnPnr_0SU/hqdefault.jpg",
    videoId: "6lnnPnr_0SU",
    overview: "2022年8月公開の映画「ONE PIECE FILM: RED」において、Adoがアニメキャラクター「ウタ」の歌声を担当。「ウタ」は劇中で「世界最高の歌手」として設定されており、その歌声として実際のAdoの楽曲が使用された。映画の歌声「New Genesis」「Tot Musica」等の楽曲が映画公開とともにリリースされ、グローバル展開された。素顔を見せないAdoとアニメキャラクターが重なる設定が、Adoのブランドと完璧に一致した。",
    background: "ONE PIECEは世界60カ国以上で配信された人気アニメで、FILM: REDは「RED」というテーマから音楽を中心に置いた設計だった。制作サイドがAdo（当時不出頭・匿名）の圧倒的な歌唱力に着目し、「素顔を見せないウタ」という設定を設計した。「声だけで存在するアーティスト」と「声が存在の全てのキャラクター」が融合した。",
    execution: "映画のプロデュースとAdo所属Universal Musicが共同でサウンドトラックを制作。日本語と英語のバージョンが制作され、楽曲はSpotify等で全世界配信。映画公開後、楽曲はOricon・Billboard Japanで複数1位獲得。その後Adoは国際的な歌手として認知され、世界ツアー（2024年）へとつながった。",
    evaluationImpact: "日本国内外でBillboard各チャートに複数曲がランクイン。Adoの楽曲は米国・東南アジア・ヨーロッパのチャートにも初登場し、ONE PIECEのグローバル認知が日本語音楽の国際進出の入口として機能することを実証した。Anonymous（匿名）アーティストがグローバルIPとの融合でブランドを確立するという独自モデルを作った。",
    relatedWorks: [
      { title: "Ado THE FIRST WORLD TOUR「Wish」(2024年）", description: "One Piece FILM REDでの国際的ブレイクを経て実現したワールドツアー。本作がいかにAdoのグローバルキャリアの転換点だったかがわかる。", url: "https://www.youtube.com/watch?v=TR7pmffN2EY" },
      { title: "YOASOBI「アイドル」(2023年）", description: "日本アニメとの結合でグローバルに展開した翌年の事例。「アニメが日本音楽のグローバル入口になる」という同じ文脈。", url: "https://www.youtube.com/watch?v=ZRtdQ81jPUQ" },
      { title: "Gorillaz（2001〜）", description: "実在するミュージシャンが「架空の存在」として活動するバーチャルバンドの先例。AdoとウタのコンセプトはGorillazの問いと共鳴する。", url: "https://www.gorillaz.com/" }
    ]
  },
  {
    id: "rosalia-motomami",
    title: "ROSALÍA「MOTOMAMI」",
    summary: "フラメンコ×レゲトン×R&B×日本語——どのジャンルにも収まらないアルバムがグラミーを席巻し、TikTokで自然バイラルした2022年の音楽的事件。",
    client: "ROSALÍA",
    agency: "Columbia Records",
    categories: ["コンテンツ革新", "カルチャーインサイト"],
    award: "Grammy 2023 Best Latin Pop Album / Pitchfork Albums of 2022 #1",
    year: "2022",
    regions: ["グローバル", "欧州"],
    link: "https://www.youtube.com/watch?v=EslzthDFm2w",
    thumbnail: "https://i.ytimg.com/vi/EslzthDFm2w/hqdefault.jpg",
    videoId: "EslzthDFm2w",
    overview: "スペイン人アーティストROSALÍAの3rdアルバム「MOTOMAMI」（2022年3月）は、フラメンコ・レゲトン・ドリルポップ・R&B・バチャータを縦横無尽に組み合わせた16曲。The Weeknd・Tokischaとのコラボに加え、日本語の音韻への言及や日本のバイク文化へのオマージュ（「CHICKENTERIYAKI」等）を含む。ジャンル崩壊したコラージュアルバムとして批評・商業の両面で最高評価を受けた。",
    background: "ROSALÍAは2018年「El Mal Querer」でフラメンコとポップの融合で国際的評価を確立した後、MOTOMAMIではさらにジャンルの垣根を壊した。スペインとニューヨーク・マイアミを拠点に、南米・アジア・欧米の多様な音楽文化を吸収・再合成するアーティストとして、「次世代のグローバルアーティスト」として位置づけられた。",
    execution: "各曲に異なるスタイルの短いMVを制作（「CHICKEN TERIYAKI」は1分以下のクリップ等）。TikTokでの「CHICKEN TERIYAKI」が日本ミーム的に拡散。Motomami World Tourは北米・欧州のハイエンドベニューとフェスを組み合わせた「格上げ」戦略で実施。アルバムのフィジカル版には詩集・アートブックが同梱された。",
    evaluationImpact: "Pitchfork年間ベストアルバム1位・Rolling Stone年間1位等、主要批評メディアで最高評価を受けた。Grammy Best Latin Pop Album受賞。「ジャンルという概念自体が時代遅れ」という文化的議論の中心に立った事例。TikTokでのバイラルが欧米以外の市場（特に日本・韓国・南米）での認知拡大に貢献した。",
    relatedWorks: [
      { title: "Charli XCX「BRAT」(2024年）", description: "同じく「ジャンルを壊す」ことを意図的に行い、文化現象になったアルバム。ROSALÍAとCharliは「次世代ポップの再定義者」として並べて語られる。", url: "https://www.youtube.com/watch?v=WJW-VvmRKsE" },
      { title: "Björk「Vespertine」(2001年）〜各作品", description: "20年以上にわたり毎作品ごとにジャンルを破壊してきた先達。ROSALÍAのジャンル横断の問いはBjörkの系譜に位置づけられる。", url: "https://en.wikipedia.org/wiki/Bj%C3%B6rk_discography" },
      { title: "Bad Bunny「Un Verano Sin Ti」(2022年）", description: "同年のラテン音楽で批評・商業ともに最高評価を受けた対照的なアルバム。ROSALÍAとBad Bunnyは2022年ラテン音楽の革新者として比較される。", url: "https://en.wikipedia.org/wiki/Un_Verano_Sin_Ti" }
    ]
  },
  {
    id: "ariana-grande-rift-tour",
    title: "Fortnite「Rift Tour」featuring Ariana Grande",
    summary: "フォートナイトの世界がArianaの宇宙に変容する5日間——インゲームコンサートの第二世代として「キャラクターとして存在するアーティスト」を実現した。",
    client: "Ariana Grande / Epic Games",
    agency: "Epic Games（ゲーム内制作）",
    categories: ["空間体験", "テクノロジー×アイデア", "ブランドエクスペリエンス"],
    award: "（受賞情報なし）",
    year: "2021",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=RiM0moNk74o",
    thumbnail: "https://i.ytimg.com/vi/RiM0moNk74o/hqdefault.jpg",
    videoId: "RiM0moNk74o",
    overview: "2021年8月6〜8日、フォートナイト内で開催された「Rift Tour」。Travis Scott「Astronomical」(2020年)の後継として実施された第2弾インゲームコンサート。Arianaのシングル曲に合わせてフォートナイトの世界そのものが変容——全プレイヤーが宇宙に浮かんだり、巨大なAriana Grandeのキャラクターがゲーム世界を歩いたりする体験を5公演・2日半にわたって実施した。同時接続プレイヤーは数百万人規模。",
    background: "Travis Scott「Astronomical」が1200万同時接続という前例のない数字を記録した後、Epic GamesはFortniteコンサートを重要な音楽プロモーション媒体として発展させる戦略を取った。Arianaは当時「Positions」アルバムのプロモーション期であり、ゲームを主要なメディアチャネルとして活用することを選択した。",
    execution: "ゲーム内にAriana Grandeのスキン（衣装）が販売され、プレイヤーが彼女になってゲームをプレイできる。コンサート中はマップが楽曲に合わせて変容（宇宙空間・水中・虹の上を歩く等）。複数の時間帯で5回公演を実施し、グローバルのタイムゾーンに対応。",
    evaluationImpact: "Fortniteコンサートシリーズの第2弾として、音楽×ゲームの融合をさらに発展させた。Ariana Grandeのゲームスキンは発売期間中の人気スキンランキング上位を記録。インゲームコンサートが「ゲームキャラクターとして存在するアーティスト」という新しい形態を確立した。後継のFortnite Festival（2023年〜）という常設音楽フィーチャーの先例となった。",
    relatedWorks: [
      { title: "Travis Scott「Astronomical」Fortnite (2020年）", description: "直接の先行事例で同シリーズの第1弾。1200万同時接続でインゲームコンサートの可能性を証明した。", url: "https://www.youtube.com/watch?v=wYeFAlVC8qU" },
      { title: "Gorillaz AR Live「Skinny Ape」(2022年）", description: "現実の都市空間にARでミュージシャンを出現させたコンサート。インゲームと現実空間の違いはあるが「非物理空間でのライブ」という同じ問い。", url: "https://www.youtube.com/watch?v=iFaKhtlBU7A" },
      { title: "ABBA Voyage（2022年）", description: "デジタルアバターがリアルアリーナでライブを行う事例。Fortniteコンサートとは方向が逆（仮想→現実）だが「デジタルと人間のライブ融合」という同じ問いを持つ。", url: "https://www.abbavoyage.com/" }
    ]
  },
  {
    id: "travis-scott-astronomical",
    title: "Travis Scott × Fortnite「ASTRONOMICAL」",
    summary: "1,200万人が同時接続したゲーム内コンサート——フォートナイト内でTravisが地球規模の巨人として歌い踊り、コンサートという概念を根底から変えた。",
    client: "Travis Scott / Epic Games",
    agency: "Epic Games（ゲーム内制作）",
    categories: ["空間体験", "メディア発明", "テクノロジー×アイデア"],
    award: "（受賞情報なし）",
    year: "2020",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=wYeFAlVC8qU",
    thumbnail: "https://i.ytimg.com/vi/wYeFAlVC8qU/hqdefault.jpg",
    videoId: "wYeFAlVC8qU",
    overview: "2020年4月23〜25日、フォートナイト内で開催されたインゲームコンサート「Astronomical」。コロナ禍でリアルコンサートが全面中止になった直後のタイミングで実施。Travis Scottの巨大な3Dキャラクターがフォートナイトの世界中を移動・変容させながら楽曲を披露。5公演の合計同時接続数は延べ2,770万人（最大1公演1,200万人同時接続）を記録。Kylie Jenner・Kid Cudi等もゲーム内でサプライズ登場した。",
    background: "2020年3月、COVID-19によるライブエンターテインメントの全面停止直後にEpic Gamesがコンサートを企画。Travis ScottはFortniteとのコラボ（スキン販売）を以前から行っており、今回はゲーム空間そのものをコンサート会場として設計することを提案した。「物理的な制約のない空間でのライブ」というコンセプトが、コロナ禍の状況と完璧に合致した。",
    execution: "フォートナイトのゲームエンジン（Unreal Engine）を使用してリアルタイムに世界を変容させるコンサート体験を設計。地下・宇宙・水中と場面が転換し、Travis Scottの巨大アバターが世界を歩く。専用のAstronomicalスキン・グライダー・エモートが別途販売され、コンサート参加者には限定グッズも配布された。",
    evaluationImpact: "1,200万人同時接続はそれまでの記録を大幅に超える数字で「デジタルコンサートの歴史が始まった」と評された。コンサートグッズのゲーム内販売で推定2000万ドル超を稼いだとされる。後続のFortnite×Ariana Grande（2021年）、Eminem（2024年）等の大型インゲームコンサートの原型となった。「ゲームがコンサート会場になる」という概念を音楽業界に根付かせた。",
    relatedWorks: [
      { title: "Ariana Grande「Rift Tour」Fortnite (2021年）", description: "直接の後継事例。Astronomicalで確立したフォーマットをさらに発展させたインゲームコンサート。", url: "https://www.youtube.com/watch?v=RiM0moNk74o" },
      { title: "Minecraft「Block by Blockwest」フェスティバル（2020年）", description: "COVID禍にMinecraft内で実施した音楽フェスティバル。ゲーム内コンサートの同期事例として対比される。", url: "https://en.wikipedia.org/wiki/Minecraft" },
      { title: "ABBA Voyage（2022年）", description: "異なるアプローチでデジタルアーティストとリアル空間を融合させたライブ形態。Astronomicalと並ぶ「コンサートの再定義」事例。", url: "https://www.abbavoyage.com/" }
    ]
  },
  {
    id: "kenshi-yonezu-boy-and-heron",
    title: "米津玄師「地球儀」×「君たちはどう生きるか」",
    summary: "宮崎駿×スタジオジブリ初の商業タイアップ楽曲——「タイアップを一切しない」伝説のスタジオが例外を設けた相手として米津玄師が選ばれた歴史的事実。",
    client: "スタジオジブリ / 米津玄師（Sony Music）",
    agency: "Sony Music Labels",
    categories: ["コンテンツ革新", "カルチャーインサイト"],
    award: "Billboard Japan Hot 100 #1 / ゴールデングローブ賞最優秀アニメーション映画賞（映画）",
    year: "2023",
    regions: ["グローバル", "国内"],
    link: "https://www.youtube.com/watch?v=VUsURj_OYdA",
    thumbnail: "https://i.ytimg.com/vi/VUsURj_OYdA/hqdefault.jpg",
    videoId: "VUsURj_OYdA",
    overview: "2023年7月、宮崎駿監督の映画「君たちはどう生きるか（The Boy and the Heron）」の主題歌として米津玄師が「地球儀（Spinning Globe）」を提供。スタジオジブリは従来、映画のタイアップ楽曲・主題歌での商業協力を基本的に行わない方針を持っていたが、米津玄師への例外を設けた。映画はゴールデングローブ賞最優秀アニメーション映画賞・アカデミー賞最優秀長編アニメーション映画賞を受賞。",
    background: "宮崎駿はティーザー予告も制作せず、映画の内容を一切事前に公開しないという「完全ノーヒント公開」戦略で映画を公開した。この異例な秘密主義の映画に、唯一公開されたのが米津玄師の楽曲だけだった。米津玄師は以前「バウムクーヘン」等でジブリ的世界観へのオマージュを示していた作家であり、宮崎との親和性が高く評価された。",
    execution: "映画公開初日（2023年7月14日）に楽曲をリリース。映画の予告編・情報解禁が最小限だったため、「地球儀」のMVが映画の「唯一の窓口」として機能した。MVはアニメーション（蟲師の久保田誓等）と米津の実写が融合した独特の映像で制作された。映画の世界興行収入は現在（2024年）も更新中で、日本映画として異例の海外展開を達成した。",
    evaluationImpact: "「ジブリ初のタイアップ楽曲」という歴史的事実そのものが大きなニュースとなった。Billboard Japan Hot 100首位、ストリーミングでも記録的数字。米津玄師の国際的認知度をさらに高め、「地球儀」は米国・欧州でも広く再生された。映画の「ノーヒント公開戦略」と楽曲の組み合わせが、情報過多の現代において「秘密主義がPRになる」という逆説を体現した。",
    relatedWorks: [
      { title: "YOASOBI「アイドル」推しの子 (2023年）", description: "同じ2023年、アニメ×音楽でグローバルヒットを達成した事例。「アニメ主題歌が日本音楽の国際窓口になる」という同じ文脈。", url: "https://www.youtube.com/watch?v=ZRtdQ81jPUQ" },
      { title: "米津玄師「Lemon」(2018年）", description: "ドラマ「アンナチュラル」タイアップで日本音楽史上最多ストリーミング記録を作った楽曲。米津のタイアップ史の原点。", url: "https://www.youtube.com/watch?v=SX_ViT4Ra7k" },
      { title: "Joe Hisaishi / Studio Ghibli Original Soundtracks", description: "久石譲が長年ジブリ映画音楽を担当してきた先例。「地球儀」は久石以外の外部アーティストが関わるという点で異例中の異例。", url: "https://en.wikipedia.org/wiki/Joe_Hisaishi" }
    ]
  }
];

const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
const existingIds = new Set(cases.map(c => c.id));
const toAdd = newCases.filter(c => !existingIds.has(c.id));
const updated = [...cases, ...toAdd];
await fs.writeFile(CASES_PATH, JSON.stringify(updated, null, 2));
console.log(`追加: ${toAdd.length}件 / スキップ: ${newCases.length - toAdd.length}件`);
console.log(`合計: ${updated.length}件`);
