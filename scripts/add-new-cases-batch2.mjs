import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");

const newCases = [
  {
    id: "teamlab-borderless",
    title: "teamLab Borderless",
    summary: "境界のない作品群が相互に影響し合う——デジタル技術によって人間と自然・人間と人間の間の境界を溶かすことを目指した世界初のデジタルアート美術館。",
    client: "森ビル（Mori Building）",
    agency: "チームラボ（teamLab）",
    categories: ["空間体験", "テクノロジー×アイデア", "AIクリエイティブ"],
    award: "（受賞情報なし）",
    year: "2018",
    regions: ["国内"],
    link: "https://borderless.teamlab.art/",
    thumbnail: "https://i.ytimg.com/vi/-DtLKZLol4A/hqdefault.jpg",
    videoId: "-DtLKZLol4A",
    overview: "2018年6月、お台場にオープンした世界初の「境界のないデジタルアート美術館」。60点以上の作品が相互に影響し合い、部屋の壁・床・天井を超えて動き回る。訪問者の動きや触れ方によって作品が変化するインタラクティブ性が特徴。2024年2月に麻布台ヒルズに移転リニューアルし、「チームラボボーダレス」として継続展開。開館からの総来場者数は世界100カ国以上から1,000万人を超えた（旧施設）。",
    background: "チームラボは「デジタルテクノロジーでアートを民主化する」という思想のもと、2001年から活動を続けてきた。「Borderless」は「ブラックボックス（作品が展示室に収まる通常の美術館）」への対抗概念として企画された。各作品が独立して展示されるのではなく、相互に連動して全体で一つの体験を生み出す設計は、従来の美術館展示の概念を覆した。",
    execution: "520台以上のコンピューターと470台以上のプロジェクター（リニューアル前数値）によって制御される。訪問者の位置・動きをセンサーが検知し、作品がリアルタイムに反応・変化する。地図を持たない迷宮設計により「迷子になる体験」も意図的に設計。デジタルとフィジカルの境界を溶かすというコンセプトは日本を代表する文化輸出事例ともなっている。",
    evaluationImpact: "2018年開館後、SNSで世界中に拡散し、国際メディアから「最もSNSで写真が撮られる美術館の一つ」として取り上げられた。ハンブルク・サウジアラビア・上海など世界各地へ展開。デジタルアートが美術館という形態で大衆化するという流れを作り、後続の多くのデジタルアート施設の先例となった。日本のクリエイティブテクノロジーの国際的ショーケースとしても機能した。",
    relatedWorks: [
      { title: "Refik Anadol「Unsupervised」MoMA (2022年)", description: "AIがデータから「幻覚」映像を生成する大型インスタレーション。teamLabと同様にデジタルと空間の融合。", url: "https://www.moma.org/calendar/exhibitions/5535" },
      { title: "MSG Sphere Las Vegas (2023年)", description: "全面LEDの球体空間という物理スケールでの没入型体験。teamLabより大規模・商業的な空間体験の発展形。", url: "https://www.thesphere.com/" },
      { title: "Ryoji Ikeda「test pattern」(2008〜）", description: "データを音と映像に変換する日本発のメディアアート。teamLabとともに「日本のデジタルアート」の国際的文脈を形成。", url: "https://www.ryojiikeda.com/" }
    ]
  },
  {
    id: "lil-miquela",
    title: "LIL MIQUELA",
    summary: "実在しない19歳のCGIインフルエンサーが300万人のフォロワーを持ち、Prada・Samsung・Calvein Kleinとコラボする——バーチャルアイデンティティが商業的現実になった先例。",
    client: "Brud（現Metaphysic）",
    agency: "（Brud内製）",
    categories: ["カルチャーインサイト", "テクノロジー×アイデア", "AIクリエイティブ"],
    award: "（受賞情報なし）",
    year: "2016",
    regions: ["北米", "グローバル"],
    link: "https://www.instagram.com/lilmiquela/",
    thumbnail: "https://i.ytimg.com/vi/j3hCQoMYxJA/hqdefault.jpg",
    videoId: "j3hCQoMYxJA",
    overview: "2016年にInstagramに登場したCGI（コンピューターグラフィクス）で作られた架空の19歳の人物。LAを拠点にブラジル系アメリカ人のモデル・音楽家として設定され、「彼女」はブランドとのコラボレーションを行い、社会的メッセージを発信する。運営はBrud（現Metaphysic）という秘密主義のスタートアップで、長期間にわたって「本物か偽物か」という謎を意図的に維持した。",
    background: "「バーチャルインフルエンサー」という概念を最初に大規模に商業化した事例。Brudは当初正体を明かさず、Miquela自身が「自分はロボットなのか人間なのか」を問うような投稿を続けることで謎めいたキャラクターを構築。2018年にBrud自身が「彼女はAIだ」と正式に認め、その「告白」もマーケティングとして機能した。",
    execution: "高品質な3DCGで制作されたリアルな映像をInstagramに定期投稿。Calvin Klein・Prada・Samsung・スウォッチ等のブランドとコラボレーション広告を実施。楽曲を発表してSpotifyで配信し、BTSメンバーとの「対談」コンテンツも制作。「フォロワーはリアルな人間で、本人は架空の存在」というデジタルと現実の境界を意図的に混乱させる設計。",
    evaluationImpact: "2018年にTIME誌「最も影響力ある25人のインターネット有名人」に選出。バーチャルインフルエンサー市場を生み出し、日本の「伊月」（imma）、韓国のRozy等の後継事例を刺激した。広告業界では「実在しない人物を広告に起用することの倫理」という議論を引き起こした。",
    relatedWorks: [
      { title: "imma（バーチャルモデル、日本）(2018年〜）", description: "日本初のCGIバーチャルモデル。PORTERやIKEAとのコラボで国内外に認知され、Miquela の日本版として位置づけられる。", url: "https://www.instagram.com/imma.gram/" },
      { title: "ABBA Voyage（2022年）", description: "実在するアーティストをデジタルアバター化してライブを行う逆方向の事例。「実在↔仮想」の問いを違う角度から提起。", url: "https://www.abbavoyage.com/" },
      { title: "Roadrunner: Anthony Bourdain（2021年）", description: "故人の声をAIで再現した事例。Miquela（存在しない人物を実在のように）と逆方向だが「デジタルとリアルの同一性」という同じ問いを持つ。", url: "https://www.imdb.com/title/tt14129590/" }
    ]
  },
  {
    id: "nike-rtfkt-clonex",
    title: "Nike × RTFKT「Clone X」",
    summary: "Nikeがデジタルスニーカー企業RTFKTを買収——NFTスニーカーとフィジカルスニーカーを連動させた「デジタルファッション」の産業化。",
    client: "Nike",
    agency: "RTFKT Studios（Nike子会社）",
    categories: ["テクノロジー×アイデア", "ブランドエクスペリエンス", "カルチャーインサイト"],
    award: "（受賞情報なし）",
    year: "2021",
    regions: ["グローバル"],
    link: "https://rtfkt.com/",
    thumbnail: "https://i.ytimg.com/vi/h6dtzwMfLa0/hqdefault.jpg",
    videoId: "h6dtzwMfLa0",
    overview: "2021年12月、NikeがデジタルスニーカーNFTのスタートアップRTFKT Studiosを買収。RTFKT（「Artifact」と読む）は仮想通貨・NFT市場向けの3Dスニーカーや服をデザインし販売するブランドで、村上隆とのNFTコレクション「Clone X」（2021年11月）が数億円規模で取引されるほどの人気を誇っていた。Nikeはこの買収によりメタバース・デジタルファッション市場に本格参入した。",
    background: "NFTバブルと重なる2021年後半、Nikeは「デジタルで育つZ世代にとってのスニーカー文化をどう維持するか」という課題を抱えていた。RTFKTはゲーマー・NFT収集家・ストリートカルチャーファンに熱狂的に支持されており、Nikeにとって「若年層のデジタル文化への橋渡し役」として買収に踏み切った。買収金額は非公開だが、業界では「億ドル規模」と推測された。",
    execution: "Clone X NFTコレクションは村上隆がアート監修した2万点のNFTアバター。各NFTにはスキン（ヒューマン・ロボット・エイリアン等）が割り当てられ、対応するNikeのフィジカルスニーカーが後に発売される仕組み。「Nike CryptoKicks」はNFTと物理的スニーカーを紐付けた試み。2024年にはRTFKT事業を終了したが、期間中にデジタルファッション産業の可能性と課題の両方を示した。",
    evaluationImpact: "Nikeというグローバルスポーツブランドがデジタルファッションに本格参入したことで「メタバースファッション」の正当性が確立された。Clone XのNFT価格は最高値で数万ドルに達した。一方で2024年のRTFKT閉鎖は「NFTファッションビジネスの持続可能性」という問いも残した。デジタルファッション産業の草創期を代表する事例として参照され続ける。",
    relatedWorks: [
      { title: "Fortnite × Balenciaga（2021年）", description: "同時期のゲーム×ラグジュアリーファッションの事例。デジタル衣装の価値化という同じ文脈。", url: "https://www.youtube.com/watch?v=5-lTfxuwlJE" },
      { title: "Adidas × BAYC（Bored Ape Yacht Club, 2021年）", description: "AdidasがBored Ape NFTを購入してデジタルコレクションを展開。Nike RTFKT と並ぶスポーツブランドのNFT参入事例。", url: "https://en.wikipedia.org/wiki/Bored_Ape_Yacht_Club" },
      { title: "Gucci Garden Roblox（2021年）", description: "ラグジュアリーブランドのゲーム内デジタルファッション。Nike RTFKTと同じ「デジタル衣装の市場化」の流れ。", url: "https://www.youtube.com/watch?v=016X2X50mHc" }
    ]
  },
  {
    id: "louis-vuitton-pharrell-ss2024",
    title: "LOUIS VUITTON Men's SS2024 by Pharrell Williams",
    summary: "ファレル・ウィリアムスのルイ・ヴィトンメンズデビューコレクション——パリのポン・ヌフ橋上でJay-Zがパフォーマンスし、ヒップホップとラグジュアリーの融合を象徴した歴史的ショー。",
    client: "Louis Vuitton（LVMH）",
    agency: "（自社制作）",
    categories: ["ブランドエクスペリエンス", "カルチャーインサイト", "コンテンツ革新"],
    award: "（受賞情報なし）",
    year: "2023",
    regions: ["欧州", "グローバル"],
    link: "https://us.louisvuitton.com/eng-us/mens",
    thumbnail: "https://i.ytimg.com/vi/pDsjAIrmSKM/hqdefault.jpg",
    videoId: "pDsjAIrmSKM",
    overview: "グラミー賞受賞プロデューサー・ミュージシャンのファレル・ウィリアムスが、故ヴァージル・アブローの後を継いでルイ・ヴィトンのメンズクリエイティブディレクターに就任。2023年6月のデビューショーはパリのポン・ヌフ橋を封鎖して開催され、Jay-Z、Beyoncé、Kim Kardashianらが来場。ショー中にJay-Zがパフォーマンスを行い、ヒップホップ文化とラグジュアリーファッションの歴史的な融合として世界中に配信された。",
    background: "2021年に急逝したヴァージル・アブローが「ストリートウェアとラグジュアリーの融合」を実現したLVのメンズ路線を、ファレルが継承する形で就任。ファレルはストリート文化・音楽・スポーツ・アートの接点に立つ人物として選ばれた。コレクションの舞台として「パリの観光名所を封鎖する」という大胆な判断がグローバルメディアを惹きつけた。",
    execution: "ポン・ヌフ橋を数日間封鎖してランウェイを設置。観客1,000人超を招待し、セーヌ川を背景にショーを実施。Jay-ZのサプライズパフォーマンスはSNSで即時拡散。ルイ・ヴィトンのYouTubeによるライブ配信で世界中から同時視聴が可能だった。コレクション自体はドレイク・タイラー・ザ・クリエイターら著名人が着用してSNSで拡散した。",
    evaluationImpact: "ファッションショーがエンターテインメントイベントと融合する「ショースペクタクル化」の極点として評価された。YouTubeライブ配信は通常のファッションショーを大幅に超える視聴者数を記録。ラグジュアリーファッションの顧客層を若年層・ヒップホップカルチャー愛好者に拡大するという戦略的成功として語られる。ヴァージル・アブロー亡き後のLVメンズの方向性を世界に示した転換点。",
    relatedWorks: [
      { title: "Virgil Abloh / Off-White × Louis Vuitton SS2017", description: "ファレルの前任者ヴァージル・アブローがLVデビューを果たし、ストリートウェアとラグジュアリーの融合を確立したショー。", url: "https://en.wikipedia.org/wiki/Virgil_Abloh" },
      { title: "Balenciaga「Afterworld: The Age of Tomorrow」(2020年）", description: "ファッションショーをビデオゲームの形式で発表したデムナの試み。ファッションショーの「形式」を問い直す文脈で共鳴。", url: "https://afterworld.balenciaga.com/" },
      { title: "Ye（Kanye West）×アディダス「Yeezy」シリーズ（2013〜）", description: "ヒップホップアーティストとスポーツブランドの共同ブランドの先例。ストリート文化とメインストリームファッションの融合の文脈。", url: "https://en.wikipedia.org/wiki/Adidas_Yeezy" }
    ]
  },
  {
    id: "shibuya-3d-ooh",
    title: "渋谷センター街 裸眼3D広告",
    summary: "渋谷センター街の曲面型大型ビジョンを使った裸眼立体視（3D）広告——中国発の技術が東京に上陸し、OOHの表現可能性を一段拡大した。",
    client: "（複数広告主）",
    agency: "シブハチヒットビジョン（媒体社）",
    categories: ["OOH革新", "メディア発明", "テクノロジー×アイデア"],
    award: "（受賞情報なし）",
    year: "2021",
    regions: ["国内"],
    link: "https://space-media.jp/",
    thumbnail: "https://i.ytimg.com/vi/CzAEGPEqKVA/hqdefault.jpg",
    videoId: "CzAEGPEqKVA",
    overview: "渋谷センター街の屋外大型ビジョン（シブハチヒットビジョン）が「裸眼3D」表示に対応し、2021年頃から3D広告が相次いで話題に。ビルのコーナー部分にL字型スクリーンを設置し、視覚的トリックで物体が画面から飛び出すように見える「Forced Perspective（強制遠近法）」技術を使用。中国の大画面スクリーンで普及した手法が日本に本格上陸した。",
    background: "裸眼3D OOH広告は2019〜2020年頃に中国・成都の「太古里」ショッピングモールの巨大ビジョンで普及し、SNSでバイラルした技術。日本では2021年前後から渋谷を中心に大型ビジョンを持つ媒体社が対応を開始。FINAL FANTASY・新庄剛志・各ブランドの広告が次々に制作・掲出され、SNSでの拡散を前提としたメディア設計として注目を集めた。",
    execution: "映像はL字型スクリーンの両面に整合した映像を制作し、視差効果で3D感を演出。映像の「外枠」を設計することで飛び出し感を強調。渋谷センター街のシブハチヒットビジョンのほか、新宿・池袋・大阪など日本各地の大型コーナービジョンで展開が広がった。SNSでの撮影・拡散を前提とした「映え」設計が特徴。",
    evaluationImpact: "屋外広告という古い媒体が「バイラルコンテンツの生成装置」として再評価されるきっかけとなった。FINAL FANTASY・Dクリニック・新庄剛志（ビッグボス就任）など様々な広告が裸眼3Dで制作され、リアル視聴者数を大幅に超えるSNSでの拡散効果を得た。OOHの「メディアとしての再発明」の日本における象徴的事例。",
    relatedWorks: [
      { title: "成都太古里・裸眼3D広告（中国、2019〜）", description: "裸眼3D OOH広告が最初に普及した中国での事例。渋谷3DはこのトレンドのグローバルへのPropagation事例。", url: "https://en.wikipedia.org/wiki/Taikoo_Li_Chengdu" },
      { title: "Dark Mode Ads / Plenitude（2026年）", description: "デジタルサイネージという同じ媒体に新しい意味を付加した事例。OOHの技術的革新という文脈で共鳴。", url: "https://corporate.eniplenitude.com/en/about/partnerships-and-events/darkmodeads" },
      { title: "Nike「Times Square」各種広告", description: "ニューヨーク・タイムズスクエアの大型スクリーンでのNikeの革新的OOH表現。グローバルにおける大型OOHの表現拡張の同文脈。", url: "https://en.wikipedia.org/wiki/One_Times_Square" }
    ]
  },
  {
    id: "moshimoshi-brutus",
    title: "もしもし、ブルータス。",
    summary: "45年分のBRUTUS誌全記事をGeminiに学習させ、電話ボックスで「BRUTUS自身と対話」できる体験——ブランドの記憶とAIの対話型インターフェースを融合。",
    client: "マガジンハウス（BRUTUS）",
    agency: "Think & Craft / Google",
    categories: ["AIクリエイティブ", "ブランドエクスペリエンス", "コンテンツ革新"],
    award: "（受賞情報なし）",
    year: "2025",
    regions: ["国内"],
    link: "https://thinkandcraft.tokyo/works/brutus",
    thumbnail: "https://picsum.photos/seed/moshimoshi-brutus/1200/630",
    videoId: "",
    overview: "「マガジンハウス博 銀座から世界へ」の企画の一つとして、2025年10月10〜25日に銀座ソニーパークで開催。BRUTUS創刊45年分の全記事をGoogleのGeminiに学習させ、電話ボックス型インスタレーションの受話器を持つと「BRUTUS自身」が応答する体験型AI展示。文化・旅・デザイン・音楽など幅広い分野の「BRUTUSならではの視点」でユーザーの質問に答える。",
    background: "BRUTUSは1980年創刊の男性向けライフスタイル誌で、独特の切り口と深い取材で知られる。創刊45周年を機に「BRUTUSとは何か」を問い直すプロジェクトとして企画。単なるデジタルアーカイブではなく「45年分の編集知性」をAIに宿らせるというコンセプトでGoogleとのコラボが実現。",
    execution: "Google GeminiのカスタムファインチューニングまたはRAG（検索拡張生成）技術を使い、BRUTUS全号のテキストをナレッジベース化。レトロな電話ボックス型の物理インスタレーションで「電話をかける」という行為が対話のUIとなる設計。銀座ソニーパークという場所の選定も「文化・洗練」というブランドイメージと一致した。",
    evaluationImpact: "「雑誌というメディアの知性をAIに移植する」という実験的な試みとして、広告・出版・AIの各業界で注目された。BRUTUSのブランドを「人格」として再定義する試みは、今後の「ブランドAIエージェント」の先行事例として位置づけられる。RAG×ブランドパーソナリティという技術的・文化的試みは、出版業界のデジタル変革の文脈でも語られる。",
    relatedWorks: [
      { title: "Spot's On It / BTS × Boston Dynamics（2021年）", description: "技術の「感情的接触」によってブランドイメージを塑造した事例。技術が文化的文脈に埋め込まれる設計として共鳴。", url: "https://youtu.be/7atZfX85nd4" },
      { title: "Radio Time Machine / TBWA HAKUHODO（2026年）", description: "AIが「記憶の媒体」として機能する事例。ブルータスが45年分の記憶を持つAIという設計と同じ問いを持つ。", url: "https://www.tbwahakuhodo.co.jp/en/news/260305-rtm/" },
      { title: "OpenAI「Custom GPT」(2023年〜）", description: "特定の知識ベースでカスタマイズされた対話AIを誰でも作れる仕組み。もしもしブルータスの技術的背景にある文脈。", url: "https://openai.com/chatgpt" }
    ]
  },
  {
    id: "dalle2-launch",
    title: "DALL-E 2（OpenAI）",
    summary: "「宇宙飛行士が馬に乗っている写真、写実的」という文章から数秒で本物のような画像が生成される——テキストから画像を生むAIが一般公開され、デザイン・クリエイティブの意味を変えた。",
    client: "OpenAI",
    agency: "（自社開発）",
    categories: ["AIクリエイティブ", "テクノロジー×アイデア"],
    award: "（受賞情報なし）",
    year: "2022",
    regions: ["グローバル"],
    link: "https://openai.com/dall-e-2",
    thumbnail: "https://i.ytimg.com/vi/FpNugDdWuPc/hqdefault.jpg",
    videoId: "FpNugDdWuPc",
    overview: "2022年4月にOpenAIが発表したテキストから画像を生成するAIシステム。前バージョン（DALL-E, 2021年）から大幅に品質向上し、「写実的な写真」「特定の絵画スタイル」「概念の視覚化」など多様なスタイルの画像を自然言語の記述から生成できる。2022年秋に段階的に一般公開され、同年のStable Diffusion（オープンソース版）と合わせて「AI画像生成の民主化元年」を作った。",
    background: "2021年のDALL-E初版は限定公開で研究者向けだったが、DALL-E 2は一般ユーザーへの開放を視野に入れた設計だった。2022年はMidjourney（3月）・DALL-E 2（4月）・Stable Diffusion（8月）と立て続けに主要テキスト→画像AIが登場し、SNS上で「AIが描いたアート」が溢れた年。AdobeのFireflyや他社の後追いを生み出したパイオニア。",
    execution: "CLIPモデル（画像とテキストの関係を学習したモデル）と拡散モデル（Diffusion Model）を組み合わせてテキストから画像を逆算生成する。解像度1024×1024ピクセルの画像を複数生成し、ユーザーが選択・編集できる。テキストプロンプトの書き方（プロンプトエンジニアリング）という新しいスキルを生み出した。",
    evaluationImpact: "「画像生成AIがクリエイターの仕事を奪うか」という業界論争を巻き起こした。Adobeがクリエイター向けのFireflyを発表するなど、既存クリエイティブツールベンダーが対応を迫られた。マーケティング・広告制作フローの変化をもたらし、「コンセプト画像の即時可視化」という新しい制作スタイルを定着させた。2024年のCannesではAI生成コンテンツへの審査基準設定が始まった。",
    relatedWorks: [
      { title: "Stable Diffusion（2022年）", description: "DALL-E 2と同年にリリースされたオープンソース版テキスト→画像AI。商用利用・カスタマイズが自由で、AI画像生成の民主化をさらに加速させた。", url: "https://stability.ai/" },
      { title: "Midjourney（2022年〜）", description: "Discordを使った独特のユーザー体験で普及したAI画像生成。DALL-E 2と並ぶ2022年AI画像革命の主役。", url: "https://www.midjourney.com/" },
      { title: "Coca-Cola「Create Real Magic」(2023年）", description: "企業がDALL-Eを自社ブランドに組み込んでユーザーに開放した具体的な商業応用事例。", url: "https://www.coca-cola.com/us/en/media-center/create-real-magic" }
    ]
  }
];

const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
const existingIds = new Set(cases.map(c => c.id));
const toAdd = newCases.filter(c => !existingIds.has(c.id));
const updated = [...cases, ...toAdd];
await fs.writeFile(CASES_PATH, JSON.stringify(updated, null, 2));
console.log(`追加: ${toAdd.length}件 / スキップ（既存）: ${newCases.length - toAdd.length}件`);
console.log(`合計: ${updated.length}件`);
