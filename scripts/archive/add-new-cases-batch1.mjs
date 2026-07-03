/**
 * 新規事例バッチ1（2021-2025）追加スクリプト
 * デジクリラジオ収録事例＋独自リサーチ計21件
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");

const newCases = [
  {
    id: "sphere-las-vegas",
    title: "MSG SPHERE",
    summary: "直径157mの球体に5万平方メートルのLEDスクリーンを張り巡らせた世界最大のエンターテインメント施設。U2のコンサートで2023年9月開業。",
    client: "MSG Entertainment",
    agency: "（自社開発）",
    categories: ["空間体験", "メディア発明", "コンテンツ革新"],
    award: "（受賞情報なし）",
    year: "2023",
    regions: ["北米"],
    link: "https://www.thesphere.com/",
    thumbnail: "https://i.ytimg.com/vi/v25qmBJsmXY/hqdefault.jpg",
    videoId: "v25qmBJsmXY",
    overview: "ラスベガスに建設された直径157m・高さ112mの球体型エンターテインメント施設。内径全面が解像度16Kの巨大LEDスクリーンで覆われており、5万平方メートル超のImmersive Display（没入型ディスプレイ）面積は世界最大。外壁も10万個のLEDパックで覆われ、外部からも視覚的なランドマークとして機能する。",
    background: "拡張現実（XR）や没入型体験の限界に挑むために建設。メディア企業MSG（マディソン・スクエア・ガーデン）が約23億ドルを投じて開発。当初2021年開業予定だったが工事遅延で2023年9月開業。U2がこけら落とし公演「U2:UV Achtung Baby Live」を担当した。",
    execution: "内側の巨大LEDディスプレイは解像度16K、輝度は屋外の数倍。座席数は約18,000席で、全席から画面が見渡せる扇形設計。音響システムは可動式スピーカーを含む1,500万ワット以上。外壁はラスベガスの夜景として既に観光スポット化。U2の開幕公演では映像演出とバンドの演奏が完全に融合した前例のないライブ体験を実現した。",
    evaluationImpact: "「新しいメディアから新しい表現が生まれる」という概念を物理空間で実現した象徴的施設。開業後、メタリカ、Eagles、Dead & Companyなどが追随してSphere専用公演を実施。映画・スポーツ・コンサートを超えた新しいジャンルの「球体エクスペリエンス」という市場を創出した。建築・テクノロジー・エンターテインメントの交点に立つ事例として世界中から注目される。",
    relatedWorks: [
      { title: "Anyma「2100」DJセット / Sphere (2023年)", description: "イタリアのテクノDJが球体型映像と完全同期したSphere専用のAVライブを実施。映像表現とエレクトロニックミュージックの融合として注目を集めた。", url: "https://www.youtube.com/watch?v=YFjgmf5GXCE" },
      { title: "teamLab Borderless (2018〜)", description: "境界のない作品群が相互に影響し合う没入型メディアアート施設。物理空間と映像表現の融合という点でSphereと同じ問いを持つ。", url: "https://borderless.teamlab.art/" },
      { title: "Universal Epic Universe（オーランド, 2025年）", description: "Nintendoエリアや新テーマパークを含む没入型エンターテインメント施設。Sphereと並ぶ2020年代の大規模体験型施設。", url: "https://www.universalorlando.com/web/en/us/universal-epic-universe" }
    ]
  },
  {
    id: "stillspeakingup-deeptruth",
    title: "#StillSpeakingUp",
    summary: "暗殺されたジャーナリストをディープフェイクで蘇らせ、生前に言えなかった真実を語らせる——国境なき記者団（RSF）が報道の自由を訴えた広告。",
    client: "RSF（国境なき記者団）",
    agency: "Publicis Mexico / Publicis Worldwide",
    categories: ["テクノロジー×アイデア", "社会包摂", "AIクリエイティブ"],
    award: "Cannes Lions 2021 Grand Prix for Good / Direct Gold / SDGs Gold",
    year: "2021",
    regions: ["グローバル"],
    link: "https://www.lovethework.com/campaigns/stillspeakingup-deeptruth-710063",
    thumbnail: "https://i.ytimg.com/vi/R9BlHObma_o/hqdefault.jpg",
    videoId: "R9BlHObma_o",
    overview: "メキシコ・ロシア・サウジアラビアなどで暗殺された実在のジャーナリスト5人をAIディープフェイクで復元。生前に沈黙させられた「言えなかった真実」を彼らの口から語らせる動画キャンペーン。ディープフェイク技術の破壊的用途を「報道の自由のための兵器」として逆用した。",
    background: "2021年時点でジャーナリストの暗殺・投獄が世界規模で増加しており、RSFは毎年多くのジャーナリストが沈黙させられていると報告していた。ディープフェイク技術の普及による「フェイクニュース」の問題が社会的焦点になっている中、RSFとPublicis Mexicoはその技術を逆手に取り、「真実を語ることを奪われた人が、死後に語る」という構造を設計した。",
    execution: "実在の故人ジャーナリスト5人（ジャマル・カショギほか）の写真・映像資料をもとにAIで顔と声を復元。各ジャーナリストが生前に報道しようとしていた内容を調査し、彼らの言葉として動画化。映像はSNSでオーガニックに拡散され、RSFのウェブサイトへ誘導する設計。ディープフェイク技術の倫理的使用についての議論も意図的に喚起した。",
    evaluationImpact: "Cannes Lions 2021 Grand Prix for Goodをはじめ複数の最高賞を受賞。ディープフェイクを社会的善のために使うという発想の転換が評価された。報道の自由への注目度が向上し、技術の倫理的応用というデバイトを喚起した点でも社会的意義が認められた。「危険技術を正義に使う」という構造は後の多くのディープフェイク応用キャンペーンの原型となった。",
    relatedWorks: [
      { title: "Reporters Without Borders「The Uncensored Library」(2020年)", description: "Minecraftの仮想図書館に、報道が検閲されている国の禁止記事を収納したキャンペーン。RSFによる技術逆用の前作。", url: "https://www.uncensoredlibrary.com/" },
      { title: "Orange「Dear Future Messi」(2023年)", description: "VFXで男子選手の映像を女子選手に差し替えたキャンペーン。技術で「見えない存在」を可視化する構造が共鳴する。", url: "https://www.contagious.com/en/article/news-and-views/campaign-of-the-week-orange-employs-digital-fakery-in-support-of-les-bleues" },
      { title: "EA Sports「Long Live the Prince」(2022年)", description: "亡くなった少年をAIでFIFAに蘇らせたキャンペーン。故人の「存在」をデジタルで再現するという同じ倫理的問いを持つ。", url: "https://lbbonline.com/news/digitally-resurrecting-kiyan-prince-to-prevent-knife-crime" }
    ]
  },
  {
    id: "cadbury-not-just-ad",
    title: "#NotJustACadburyAd",
    summary: "キャドバリーのCM枠を地元の小規模商店のために開放——AI技術でシャー・ルク・カーンが個人商店のオリジナルCMに出演する仕組みをつくった。",
    client: "Cadbury Celebrations（Mondelez India）",
    agency: "Ogilvy India / Wavemaker India",
    categories: ["テクノロジー×アイデア", "AIクリエイティブ", "社会包摂"],
    award: "Cannes Lions 2021 Grand Prix for Good",
    year: "2021",
    regions: ["アジア"],
    link: "https://www.wpp.com/featured/work/2021/03/ogilvy-and-wavemaker-notjustacadburyad",
    thumbnail: "https://i.ytimg.com/vi/R3FnhpelBR0/hqdefault.jpg",
    videoId: "R3FnhpelBR0",
    overview: "コロナ禍のディワリ商戦で苦境に立たされたインドの中小商店を支援するため、Cadburyの全国TV広告枠を地元の個人商店のCMに変換する仕組みを開発。AIで顔・口・声を合成するDeepfake技術を使い、人気俳優シャー・ルク・カーンが各商店名を呼んで紹介するCMを自動生成。商店名を入力するだけで任意の店舗向けCMが作れるWebツールを一般公開した。",
    background: "2020年コロナ禍でインドの中小小売業者が苦境に立たされ、大手ECの台頭で地域商店の廃業が相次いだ。Cadburyはブランド広告予算を「地元経済の活性化」に転用するという発想で企画を立案。有名俳優に全パターン分の撮影を依頼するのは非現実的なため、AIによる映像合成を採用した。",
    execution: "ウェブサイトに商店名と場所を入力すると、AIがシャー・ルク・カーンの既存映像から「○○の△△さんを訪ねて」と語りかけるCMを自動生成。生成されたCMは商店主がSNSで自由に使用可能。全国2,000店以上がツールを利用してオリジナルCMを作成した。",
    evaluationImpact: "Cannes Lions 2021 Grand Prix for Good受賞。AIを「中小企業民主化ツール」として活用した先駆事例として評価。コロナ禍で打撃を受けた地域経済の支援とブランドCMの目的を両立した構造的誠実さが審査員に高く評価された。インドでの売上も前年比大幅増を記録。",
    relatedWorks: [
      { title: "Messi Messages / Lay's (2021年)", description: "同じく著名人のAI映像をパーソナライズしてファンに届けた事例。個人化×AI映像の商業応用という構造が共鳴する。", url: "https://www.youtube.com/watch?v=mwWtxF7wKvQ" },
      { title: "JCDecaux「Meet Marina Prieto」(2024年)", description: "既存メディア（OOH）の枠を弱者のために開放した事例。メディア資産を社会的目的に転用する構造が近い。", url: "https://lbbonline.com/news/ogilvy-wins-grand-prix-for-ceraves-michael-cerave-and-jcdecauxs-meet-marina-prieto" },
      { title: "DoorDash「All The Ads」(2024年)", description: "既存の広告枠の仕組みを逆手に取ったキャンペーン。メディアの「与件」を創造的に転用する思想が共鳴する。", url: "https://lbbonline.com/news/cannes-lions-titanium-grand-prix-awarded-to-doordash-all-the-ads" }
    ]
  },
  {
    id: "outhorse-your-email",
    title: "OUTHORSE YOUR EMAIL",
    summary: "アイスランドの馬が休暇中の仕事メールを代わりに返信してくれる——Visit Icelandが「仕事を切り離した旅行」を馬の鼻で体現した。",
    client: "Visit Iceland（観光庁）",
    agency: "The North Alliance",
    categories: ["メディア発明", "カルチャーインサイト", "ブランドエクスペリエンス"],
    award: "Cannes Lions 2022 PR Grand Prix",
    year: "2022",
    regions: ["欧州"],
    link: "https://outhorseyouremail.com/",
    thumbnail: "https://i.ytimg.com/vi/kbfD_lX1Tog/hqdefault.jpg",
    videoId: "kbfD_lX1Tog",
    overview: "「氷河ハイクをボスからのメールで邪魔されたくない」という旅行者の課題に対し、Visit Icelandがアイスランド固有馬（アイスランディック・ホース）が実際に鼻でキーボードを踏んで返信を送るサービスを提供。専用ウェブサイト（outhorseyouremail.com）から自動返信メッセージの設定ができ、本物の馬が「返信」するライブ映像も閲覧可能だった。",
    background: "コロナ禍後の2022年、観光業界が回復期に入る中、アイスランドは「スマートフォンを手放せない現代人」が休暇中も仕事から離れられない問題をインサイトとして設定。前年に同国が展開した「Icelandverse」（メタバースをパロディしたキャンペーン）に続くシリーズとして企画された。",
    execution: "アイスランド各地の農場で複数頭の馬を起用。馬がキーボードを踏む様子をライブ配信。訪問者がウェブで「自動返信設定」をすると、馬が踏んだランダムなキー入力がそのまま送信されるユーモラスな仕組み。Twitterでの拡散を前提にPR設計された。コンセプトのシンプルさとユーモアがメディアを通じて自然にバイラルした。",
    evaluationImpact: "Cannes Lions 2022 PR Grand Prix受賞。「観光地のプロモーション」という文脈を超え、「現代人の働き方」への風刺として世界的なメディア露出を獲得。観光目的のコンテンツが1億回以上のインプレッションを記録。Visit Icelandの前作「Icelandverse」と同様に、低予算で最大の話題形成ができる観光PR手法の先例となった。",
    relatedWorks: [
      { title: "Visit Iceland「Icelandverse」(2021年)", description: "Metaverseの概念をパロディし、「リアルなアイスランドこそ最高のメタバース」と宣言したキャンペーン。同クライアントの前作。", url: "https://www.youtube.com/watch?v=-peUrRUH218" },
      { title: "REI「#OptOutside」(2015年)", description: "ブランドの価値観をブラックフライデー閉店という行動で体現した事例。「消費から離れる自由」という同じ精神。", url: "https://www.rei.com/opt-outside" },
      { title: "Palau Pledge (2017年)", description: "観光行動を制度デザインで変えた事例。観光プロモーションがブランドコミュニケーションを超えた先例として共鳴。", url: "https://www.palaupledge.com/" }
    ]
  },
  {
    id: "bts-spot-boston-dynamics",
    title: "SPOT'S ON IT（BTS × Boston Dynamics）",
    summary: "4足歩行ロボット「Spot」数台がBTSの楽曲に合わせて完璧にダンス——現代ロボット工学の到達点を音楽と融合させた映像。",
    client: "Boston Dynamics / Hyundai Motor Group",
    agency: "（自社制作）",
    categories: ["テクノロジー×アイデア", "コンテンツ革新"],
    award: "（受賞情報なし）",
    year: "2021",
    regions: ["グローバル"],
    link: "https://youtu.be/7atZfX85nd4",
    thumbnail: "https://i.ytimg.com/vi/7atZfX85nd4/hqdefault.jpg",
    videoId: "7atZfX85nd4",
    overview: "Boston DynamicsがHyundai Motor Groupの傘下に入ったことを記念して制作。複数台のSpotロボットがBTS（防弾少年団）の楽曲「IONIQ: I'm On It」に合わせて精密にシンクロしたダンスパフォーマンスを披露。4足歩行ロボットの運動制御技術の高さを「エンターテインメント」として可視化した。",
    background: "現代美術・エンターテインメント界でロボットの「感情的表現」への関心が高まる中、Boston Dynamicsは技術デモを「アート」として発信する戦略を継続していた（前作：「Do You Love Me」2020年）。2021年の韓国自動車大手Hyundaiによる買収後、アジア市場への認知拡大を目的としたグローバルコンテンツとしてBTSとのコラボを実現した。",
    execution: "複数台のSpotが同一の振り付けを同期して実行。ロボットの動きはモーションキャプチャとプログラミングによって設計されており、BTSの楽曲のリズムと歌詞に合わせた演出が施されている。撮影は実際のBoston Dynamicsのラボで行われ、映像編集でエンターテインメント性を強調。公開後即座にバイラルし、ロボット工学の象徴的映像コンテンツとなった。",
    evaluationImpact: "YouTubeで数千万回再生を記録。ロボットの「技術デモ」がエンターテインメントとして消費された稀有な事例。技術の「感情的接触」という観点でAIとロボットの社会受容に貢献した。BTSのグローバルファンダムとテクノロジーの交差による広報効果は、Boston DynamicsとHyundaiの両社ブランドに対する好意度向上に寄与したと報告されている。",
    relatedWorks: [
      { title: "Boston Dynamics「Do You Love Me」(2020年)", description: "前作。Atlas・Spot・Handleが音楽に合わせて踊る映像が2800万回再生。ロボットをエンタメ化する手法を確立した。", url: "https://www.youtube.com/watch?v=fn3KWM1kuAw" },
      { title: "Spot's On It のBTS楽曲「IONIQ: I'm On It」", description: "楽曲はHyundaiのEVブランドIONIQのために制作されたもので、テクノロジーとサステナビリティをテーマにしている。", url: "https://www.youtube.com/watch?v=xvxr0WEZERM" },
      { title: "Cirque du Soleil とロボットのコラボ公演", description: "人間とロボットが同一ステージでパフォーマンスするシーンは、BTS × Spotと同様に「機械の身体性」を芸術化した実践。", url: "https://www.cirquedusoleil.com/" }
    ]
  },
  {
    id: "abba-voyage",
    title: "ABBA VOYAGE",
    summary: "ABBA 4人の「ABBAtars」——40年ぶりに全員が再集結し、デジタルアバターが本物の生演奏と共にライブを行う前例なき永続公演。",
    client: "ABBA / Ludvig Studios",
    agency: "Industrial Light & Magic（ILM）",
    categories: ["空間体験", "テクノロジー×アイデア", "コンテンツ革新"],
    award: "（受賞情報なし）",
    year: "2022",
    regions: ["欧州"],
    link: "https://www.abbavoyage.com/",
    thumbnail: "https://i.ytimg.com/vi/iEikjzZO2N8/hqdefault.jpg",
    videoId: "iEikjzZO2N8",
    overview: "ABBA解散から40年後、4人のメンバーが1970年代の姿にデジタル復元された「ABBAtars」として専用アリーナでライブを行う永続公演。ロンドンのABBA Arenaで2022年5月に開幕し、リアルバンド演奏（10人の生バンド）とABBAのデジタルアバターが同一ステージに共存する新しいライブ形式を確立した。",
    background: "2021年に新アルバム「Voyage」を発表したABBAが、70代のメンバーが実際にステージに立つことなく、全盛期の姿でライブを行う方法を模索。「Star Wars」のVFXで知られるIndustrial Light & Magicが制作を担当。5年以上の開発期間をかけてモーションキャプチャとリアルタイムレンダリングを組み合わせたABBAtarsを完成させた。",
    execution: "4人が実際にモーションキャプチャスーツを着用して動きを収録。髪の毛1本まで再現するため、3000個以上のカメラによるフォトグラメトリを実施。ABBA Arena（ロンドン）は公演専用設計で、前後左右から見ても自然な映像が楽しめるようディスプレイとプロジェクション配置が設計されている。バンドと空間を組み合わせた「ハイブリッドライブ」として新ジャンルを確立した。",
    evaluationImpact: "2022年5月開演以来、2年以上にわたって継続公演を実施し、120万人以上が観覧。デジタルアバターの「永続的なライブ」という概念を実証した。エンターテインメント産業における「デジタルと肉体の境界」の問いを再提起し、後続のホログラム・アバター型コンサートの実現可能性を示した。批評家から「コンサートというジャンルの再発明」と評された。",
    relatedWorks: [
      { title: "MSG Sphere Las Vegas（2023年）", description: "ABBA Voyageと同じく「空間そのものをメディアにする」ライブ体験の革新。デジタルと物理空間の融合という同じ問い。", url: "https://www.thesphere.com/" },
      { title: "Hatsune Miku コンサート（2009〜）", description: "初音ミクが透明スクリーン映像で「ライブ」を行う形式を確立した先駆例。デジタルキャラクターのライブという概念の原型。", url: "https://en.wikipedia.org/wiki/Hatsune_Miku" },
      { title: "The Weeknd「The Weeknd Experience」メタバースコンサート（2021年）", description: "TikTokとFortnitでメタバースコンサートを実施。アバター型ライブの同時期の並行事例。", url: "https://en.wikipedia.org/wiki/The_Weeknd" }
    ]
  },
  {
    id: "gorillaz-skinny-ape-ar",
    title: "GORILLAZ PRESENTS SKINNY APE（ARライブ）",
    summary: "タイムズスクエアとピカデリーサーカスに出現したGorillazのARライブ——GoogleのARCore Geospatial APIを使い都市空間を舞台にした前例なき音楽体験。",
    client: "Gorillaz",
    agency: "Nexus Studios / Google",
    categories: ["空間体験", "テクノロジー×アイデア", "コンテンツ革新"],
    award: "（受賞情報なし）",
    year: "2022",
    regions: ["北米", "欧州"],
    link: "https://www.nexusstudios.com/work/gorillaz-ar",
    thumbnail: "https://i.ytimg.com/vi/iFaKhtlBU7A/hqdefault.jpg",
    videoId: "iFaKhtlBU7A",
    overview: "Gorillazの仮想メンバーが、スマートフォンのカメラ越しにニューヨークのタイムズスクエアやロンドンのピカデリーサーカスの現実空間に出現してパフォーマンスを行うARライブ体験。GoogleのARCore Geospatial API（ストリートビュー画像をもとに屋外空間を精密にトラッキングする技術）を初めて大規模音楽体験に応用した。",
    background: "Gorillazはアニメキャラクターによる「仮想バンド」として2001年に設立され、以降継続的にAR・XR・デジタル表現の最前線で活動してきた。2022年の新曲「Skinny Ape」のプロモーションとして、NexusStudiosとGoogleが共同でARCore Geospatial APIの活用事例として企画。キャンペーンはAR業界のショーケースとしても機能した。",
    execution: "専用アプリ「Gorillaz presents」を起動し、タイムズスクエア/ピカデリーサーカスの特定位置に立つと、Gorillazのキャラクター「Murdoc」が建物の壁面を走り回ったり空中に浮いたりするARパフォーマンスが展開。位置情報とARCoreの高精度空間トラッキングを組み合わせることで、建物との正確な空間的整合性を実現した。",
    evaluationImpact: "ARCore Geospatial APIを使った都市スケールの音楽ARという世界初の試みとして、テクノロジー・エンターテインメント双方のメディアで大きく報道。参加者の現地映像がSNSでオーガニックに拡散し、新曲の認知度向上に貢献。Gorillazの「現実との境界を壊す」というコンセプトをARで最も高次に実現した事例として評価される。",
    relatedWorks: [
      { title: "Pokémon GO（2016年〜）", description: "GPSと現実空間を組み合わせたARゲームの先駆け。都市空間をARの舞台にする概念の最大の普及事例。", url: "https://en.wikipedia.org/wiki/Pok%C3%A9mon_Go" },
      { title: "Google ARCore Geospatial API（2022年）", description: "ストリートビューのデータを使って屋外の現実空間を高精度でトラッキングする技術。Gorillaz ARの技術的基盤。", url: "https://developers.google.com/ar/develop/geospatial" },
      { title: "Kaws:Holiday（2018〜）", description: "KAWSの巨大フィギュアが世界各地のランドマークに登場した体験型アートプロジェクト。都市空間を使った大規模体験という点で共鳴。", url: "https://kaws.com/" }
    ]
  },
  {
    id: "dove-real-beauty-ai-era",
    title: "REAL BEAUTY REDEFINED FOR THE AI ERA",
    summary: "AI生成画像が「美の基準」を歪める時代に、Doveが人間の手だけで作られた「リアルな美しさ」を守ることを誓約したキャンペーン。",
    client: "Dove（Unilever）",
    agency: "Ogilvy UK",
    categories: ["カルチャーインサイト", "社会包摂", "AIクリエイティブ"],
    award: "Cannes Lions 2025 Glass Grand Prix",
    year: "2024",
    regions: ["グローバル"],
    link: "https://www.dove.com/us/en/stories/campaigns/keep-beauty-real.html",
    thumbnail: "https://i.ytimg.com/vi/8vYoL8nga-A/hqdefault.jpg",
    videoId: "8vYoL8nga-A",
    overview: "2024年、AI画像生成ツールが普及し「AI美女」による美の基準の歪曲が問題化する中、Doveは「Doveは広告・コンテンツにAI生成の人物画像を使用しない」という誓約を発表。Real Beautyキャンペーン（2004年〜）の現代的更新として、AIが生成する非現実的な「完璧な美」に対するブランドスタンスを明確にした。",
    background: "2004年に始まったDoveのReal Beautyキャンペーンは「修正した写真ではなく本物の女性を」というメッセージで20年間継続してきた。2024年にAI生成画像が広告業界に普及し始め、完璧な皮膚・完璧なプロポーションのAI美女が広告に溢れ始めた。2023年には「Stable Diffusionで生成した人物を使うとコストが下がる」という業界トレンドが広がる中、DoveはReal Beautyの延長線上にこの問題を捉えた。",
    execution: "「The Dove Code」という誓約として公式に発表。AI生成の人物を使用しないことと、「人間が実際に存在しうる」身体と顔のみを使用することを誓約。同時に、AIによる美の基準の歪曲を可視化する動画「How AI Sees Beauty」を公開し、プロンプトから生成された「平均的な美女」の非現実的な画像と、実際の多様な女性を対比した。",
    evaluationImpact: "Cannes Lions 2025 Glass Grand Prix受賞。AI時代における女性の自己認識・美の基準という問題を最も早く大規模に提起したブランドとして評価。「広告業界全体への問いかけ」として、多くのブランドがAI画像使用方針を見直すきっかけとなった。20年間のReal Beautyというブランドプラットフォームが時代によって更新され続けることを示した。",
    relatedWorks: [
      { title: "Dove「Real Beauty Sketches」(2013年）", description: "Real Beautyシリーズの代表作。女性の自己認識の歪みを可視化した史上最多シェア広告。", url: "https://www.youtube.com/watch?v=CSWanX7UTVk" },
      { title: "Dove「Evolution」(2006年）", description: "Real Beautyシリーズの原点。広告が「作られた美」を生み出す構造を暴いた。", url: "https://www.youtube.com/watch?v=iYhCn0jf46U" },
      { title: "Apple「Shot on iPhone」(2015年〜）", description: "「本物の人間が撮った本物の写真」を広告にするキャンペーン。AIではなく人間の視点を重視する同じ思想。", url: "https://www.youtube.com/watch?v=uDy9TUj4N3Q" }
    ]
  },
  {
    id: "ekimatope",
    title: "エキマトペ",
    summary: "JR東日本の駅で音声情報をオノマトペ（擬音語）と手話で可視化——聴覚障害者に駅の音の豊かさを伝える実証実験。",
    client: "JR東日本",
    agency: "電通／Dentsu Lab Tokyo（詳細不明）",
    categories: ["社会包摂", "テクノロジー×アイデア", "OOH革新"],
    award: "（受賞情報なし）",
    year: "2021",
    regions: ["国内"],
    link: "https://www.jreast.co.jp/",
    thumbnail: "https://i.ytimg.com/vi/QE3YSkWUIco/hqdefault.jpg",
    videoId: "QE3YSkWUIco",
    overview: "JR東日本の上野駅・高輪ゲートウェイ駅ほかで実施された実証実験。電車の発着音・アナウンス・騒音などの音声情報を、AIがリアルタイムでオノマトペ（ガタン、ドドドなど）と手話のアニメーションに変換して駅構内のディスプレイに表示する。聴覚障害を持つ人が「電車の音を初めて知る」体験を目指した。",
    background: "日本の駅には多様な音情報（発着メロディー・アナウンス・環境音）が溢れているが、聴覚障害者にはそのすべてが届かない。「音の情報格差」の解消を目指し、JR東日本が研究機関・障害者団体と連携して企画。「音を文字で表現する」という日本語のオノマトペ文化を起点にしたアプローチが評価された。",
    execution: "音声認識AIが環境音を分類 → 対応するオノマトペとアニメーション手話をリアルタイム生成 → 駅構内のデジタルサイネージに表示。日本語のオノマトペの豊かさ（「ガタンゴトン」「ドドドド」「チリンチリン」等）を視覚的・感情的に表現するデザインを採用。手話通訳者との協力でアニメーション精度を向上させた。",
    evaluationImpact: "実証実験時に「電車の音、初めて知った」という聴覚障害者からの感想が多く寄せられ、メディア報道が相次いだ。「音の可視化」という技術アプローチが社会包摂の観点で高く評価され、国内の交通・公共施設での類似取り組みを促進した。駅というパブリックスペースが障害者と健常者の経験格差を縮める場所に変わりうる可能性を示した。",
    relatedWorks: [
      { title: "Wavio「See Sound」(2019/2024年）", description: "家庭内の音をAIで識別してスマホに通知するデバイス。聴覚障害者の「音の情報格差」解消という同じ問い。", url: "https://www.adweek.com/creativity/wavio-and-area-23s-see-sound-project-wins-top-innovation-grand-prix-at-cannes-lions/" },
      { title: "Knock Knock / Korean National Police（2023年）", description: "緊急通報を「サイレント」にすることで声を出せない人が助けを求められる仕組み。情報アクセス格差の解消という同じ哲学。", url: "https://www.brandinginasia.com/cheil-worldwide-takes-home-glass-the-lion-for-change-grand-prix-at-cannes-lions-2023/" },
      { title: "Christine Sun Kim のサウンドアート作品群", description: "聴覚障害者である著者が「音の世界」を視覚アートで表現するプロジェクト群。エキマトペと逆方向のコミュニケーションとして共鳴。", url: "https://christinesunkim.com/" }
    ]
  },
  {
    id: "roadrunner-bourdain-ai",
    title: "ROADRUNNER: A FILM ABOUT ANTHONY BOURDAIN",
    summary: "故アンソニー・ボーデインのドキュメンタリーで、AIが故人の声を再現——倫理的論争を巻き起こした映像制作の分岐点。",
    client: "Focus Features（映画配給）",
    agency: "Morgan Neville（監督）",
    categories: ["AIクリエイティブ", "コンテンツ革新"],
    award: "（受賞情報なし）",
    year: "2021",
    regions: ["北米"],
    link: "https://www.imdb.com/title/tt14129590/",
    thumbnail: "https://i.ytimg.com/vi/qbgKJPDo0tU/hqdefault.jpg",
    videoId: "qbgKJPDo0tU",
    overview: "2018年に急死したシェフ・作家・テレビ司会者のアンソニー・ボーデインのドキュメンタリー映画。監督のモーガン・ネヴィルが「ボーデインが書いたがナレーションを録音していなかった文章」をAIで生成した声で再現した。公開後、AIによる故人の声の使用は適切か、という倫理的議論が世界的に広がった。",
    background: "ボーデインは膨大なメールや文章を残していたが、すべてにナレーション録音があるわけではなかった。監督はOpenAIに依頼してボーデインの声を学習させたAIに、彼のメールの一節を読ませることで「ナレーション」を補完した。この事実が公開後に明らかになり、ボーデインの遺族（特に元妻）が「本人の許可なくAIで声を作ることは許されない」と批判した。",
    execution: "OpenAIのテキスト音声合成AIにボーデインの音声データを学習させ、彼のメールの内容を読み上げる形で使用。映画本編では「AIで生成した声」であることは明示されていなかった。監督は後に「ボーデインが生きていれば了承してくれたと思った」と釈明。この事例が故人のAI音声使用に関する業界ガイドラインの議論を促した。",
    evaluationImpact: "映画作品の評価は高かったが、AI倫理の観点から「故人の声をAIで再現する行為の是非」を問う事例として記録された。Hollyoodにおける俳優・声優の権利保護、AI学習データの同意問題などの議論に影響を与え、後のSAGアフトラのストライキにおけるAIの権利要求につながった。「良い目的であっても同意なきAI使用は問題か」というエシックスの分岐点。",
    relatedWorks: [
      { title: "#StillSpeakingUp（RSF, 2021年）", description: "故人をAIで復元した同時期の事例。ただしこちらは報道の自由という目的での「意図的」な制作。", url: "https://www.lovethework.com/campaigns/stillspeakingup-deeptruth-710063" },
      { title: "ホロコースト記念館「Dimensions in Testimony」(2017〜)", description: "ホロコースト生存者のインタビューをAIが返答する対話型アーカイブ。本人存命中に収録・同意を得た上でのAI応用の先例。", url: "https://sfi.usc.edu/dit" },
      { title: "Ryuichi Sakamoto「12」(2023年)", description: "余命宣告後に坂本龍一が「死後も音楽が残るように」と意図して制作したアルバム。創作者が自らの死後を見越した作品。", url: "https://www.youtube.com/watch?v=X2V3GYPD3dQ" }
    ]
  },
  {
    id: "refik-anadol-unsupervised",
    title: "UNSUPERVISED（Refik Anadol）",
    summary: "MoMAの200年以上のコレクションデータを機械学習で学んだAIが「美術館が夢を見るとどんな映像になるか」を生成し続ける大型インスタレーション。",
    client: "MoMA（ニューヨーク近代美術館）",
    agency: "Refik Anadol Studio",
    categories: ["AIクリエイティブ", "空間体験", "テクノロジー×アイデア"],
    award: "（受賞情報なし）",
    year: "2022",
    regions: ["北米"],
    link: "https://www.moma.org/calendar/exhibitions/5535",
    thumbnail: "https://i.ytimg.com/vi/S9J96Pq_rvg/hqdefault.jpg",
    videoId: "S9J96Pq_rvg",
    overview: "MoMAが所蔵する200年超・13万点以上の作品データを機械学習モデルが学習。そのモデルがリアルタイムでMoMAのロビーの巨大スクリーン（約8m×8m）に「ハルシネーション（幻覚）」映像を生成し続けるインスタレーション。「美術館が夢を見たら」という問いを、AIが実際に視覚化した試み。2022年11月〜2023年3月展示。",
    background: "トルコ系アメリカ人アーティストのRefik Anadolは「データドリブンなメディアアート」の第一人者として、建築物のファサードや公共空間を大型LEDディスプレイと機械学習の映像で変容させる作品を継続制作。MoMAとの協働は彼のキャリアで最も注目された展示。AI生成アートが主要美術館に初めて長期展示された事例の一つ。",
    execution: "MoMAのデジタルアーカイブAPIからデータを取得し、Stable DiffusionベースのカスタムモデルをAnadol Studioが開発。リアルタイム生成のため、毎回異なる映像が流れる。モデルは美術史の様式（印象派・キュビズム・ポップアートなど）を内包しており、それらが融合・変容・ハルシネーションを繰り返す。音響設計も映像に同期するよう設計された。",
    evaluationImpact: "4ヶ月間で50万人以上が来場し、SNSで大量に映像がシェアされた。「AI＝アーティスト」論争を芸術界で再燃させた。その後、2023年のMoMA permanentコレクションへのAI作品収蔵にも影響を与えた。Anadolの作品は後にサウジアラビアのNEOMプロジェクトやドバイのExpoなどでも展示され、AIアートが国際的なアート機関に正式認定される契機となった。",
    relatedWorks: [
      { title: "teamLab Borderless（2018〜）", description: "データと空間の融合、参加者の存在が作品を変化させる境界のないメディアアート施設。Unsupervisedと同じく「空間＝作品」の体験。", url: "https://borderless.teamlab.art/" },
      { title: "Ryoji Ikeda「test pattern」(2008〜）", description: "バーコードや二進数データを変換した映像を超高速・超大型で展示する池田亮司の代表的インスタレーション。データを美として可視化する先駆的事例。", url: "https://www.ryojiikeda.com/" },
      { title: "Beeple「Everydays: The First 5000 Days」(2021年）", description: "AI/デジタルアートがオークション史上最高額をつけた事例。AI生成アートの市場的認知の分岐点。", url: "https://www.christies.com/lot/lot-6296648" }
    ]
  },
  {
    id: "coca-cola-create-real-magic",
    title: "CREATE REAL MAGIC",
    summary: "コカ・コーラがGPT-4とDALL-Eを開放——世界中のファンがブランドのアーカイブとAIで自由にアート作品を制作できるプラットフォーム。",
    client: "Coca-Cola",
    agency: "OpenAI / Bain & Company",
    categories: ["AIクリエイティブ", "ブランドエクスペリエンス", "コンテンツ革新"],
    award: "（受賞情報なし）",
    year: "2023",
    regions: ["グローバル"],
    link: "https://www.coca-cola.com/us/en/media-center/create-real-magic",
    thumbnail: "https://i.ytimg.com/vi/37S8NpeG1gg/hqdefault.jpg",
    videoId: "37S8NpeG1gg",
    overview: "コカ・コーラが自社の広告アーカイブ（レトロなイラスト・ロゴ・キャラクター）をDALL-EとGPT-4に学習させ、ユーザーがブランドのアーカイブを素材としてAIでオリジナルアートを制作できるプラットフォーム「Create Real Magic」を2023年3月に公開。ユーザー生成コンテンツとAIの組み合わせで、ブランドの資産を開放する試みとして注目された。",
    background: "ChatGPTとDALL-Eの急速な普及を受けて、Coca-Colaは「AI時代のブランドコンテンツ戦略」を模索。マッキンゼーグループのBain & Companyとコンサルティング関係にあったOpenAIとの三者協力で実現。従来「ブランドのトーンを守るためにコントロールされていた」クリエイティブを、ユーザーに解放するという逆転の発想で企画された。",
    execution: "専用ウェブサイトでユーザーがテキストプロンプトを入力すると、Coca-Colaの歴史的なビジュアルアーカイブを学習したAIモデルがアート作品を生成。優秀作品はCoca-Colaの公式デジタルビルボードや広告に採用される仕組みを設けた。2023年末にはクリスマスCMもAI活用で制作したが、こちらは批判を受けた（後述）。",
    evaluationImpact: "公開後数週間で数千のファン作品がSNSでシェアされ、AIとブランドの協働という新形態の先例を作った。一方、2023年クリスマスCMのAI生成映像（不気味の谷効果、誤った人物描写）に批判が集まり、「AIコンテンツの品質管理」という課題も浮き彫りに。ブランドがAIを活用する際の成功例と失敗例の両方を示した事例として業界で研究される。",
    relatedWorks: [
      { title: "Cadbury「Not Just A Cadbury Ad」(2021年）", description: "AIをユーザーの創造性に開放した先行事例。AIがブランドのクリエイティブを民主化するという同じ思想。", url: "https://www.youtube.com/watch?v=R3FnhpelBR0" },
      { title: "Refik Anadol「Unsupervised」(2022年）", description: "ブランドや機関の歴史的アーカイブをAIに学習させる手法の同時期の事例。", url: "https://www.moma.org/calendar/exhibitions/5535" },
      { title: "Adobe「Firefly」(2023年）", description: "クリエイターのための著作権クリアなAI生成ツール。Create Real Magicと同様に「AIによるクリエイティブの民主化」という問いに対する別回答。", url: "https://firefly.adobe.com/" }
    ]
  },
  {
    id: "fortnite-balenciaga",
    title: "FORTNITE × BALENCIAGA",
    summary: "ゲーム空間とラグジュアリーファッションの衝突——バレンシアガがフォートナイトで史上初の3D DOOHキャンペーンとゲーム内スキンを同時展開。",
    client: "Balenciaga",
    agency: "Balenciaga Creative Studio（内製）",
    categories: ["ブランドエクスペリエンス", "メディア発明", "カルチャーインサイト"],
    award: "（受賞情報なし）",
    year: "2021",
    regions: ["グローバル"],
    link: "https://www.balenciaga.com/",
    thumbnail: "https://i.ytimg.com/vi/5-lTfxuwlJE/hqdefault.jpg",
    videoId: "5-lTfxuwlJE",
    overview: "フォートナイトのゲーム内でバレンシアガのスキン（衣装）を販売すると同時に、ニューヨーク・ロンドン・パリ・東京の4都市の屋外広告スクリーンにゲームエンジン（Unreal Engine）で制作した3D映像広告を展開。物理世界とゲーム世界の境界を意図的に曖昧にした最初の大規模ラグジュアリーファッションキャンペーン。",
    background: "バレンシアガのクリエイティブディレクター・デムナ・ヴァザリアがゲーム文化への強い親和性を持ち、2020年秋冬コレクションをビデオゲームの形式で発表した「Afterworld: The Age of Tomorrow」からの流れ。Epic Games（フォートナイト運営）との提携が成立し、ラグジュアリーファッションとゲームの相互乗り入れを具体的に実現した。",
    execution: "フォートナイト内に「Balenciaga Hub」という専用エリアを設置し、4種類のバレンシアガスキンを販売。同時にゲームのビジュアルスタイルで撮影したファッション映像をWWD等のファッション誌に掲載。都市部の3D曲面スクリーンに向けてUnreal Engineで制作した裸眼3D映像広告も展開。ゲーム内・現実世界・メディアの三つの接触面を同時に活用した。",
    evaluationImpact: "ラグジュアリーファッションとゲームの本格的融合の先例として業界で広く取り上げられた。フォートナイトのバレンシアガスキンは数日間でミリオン以上が購入されたとされる。2021年以降、Gucci・Louis Vuitton・Ralphなど主要ブランドが相次いでゲームとの連携を発表する「ファッション×メタバース」ブームの起点となった事例。",
    relatedWorks: [
      { title: "Gucci Garden on Roblox（2021年）", description: "ラグジュアリーブランドがRobloxに仮想空間を開設した同年の事例。ゲームとファッションの融合の並行事例。", url: "https://www.youtube.com/watch?v=016X2X50mHc" },
      { title: "Louis Vuitton「Louis: The Game」(2021年）", description: "LVV創業者の創業記念にゲームをリリースしたキャンペーン。ラグジュアリーがゲーム形式を採用した先例。", url: "https://eu.louisvuitton.com/eng-e1/magazine/articles/louis-the-game" },
      { title: "Balenciaga「Afterworld: The Age of Tomorrow」(2020年)", description: "前作。バレンシアガのファッションショーをビデオゲームとして発表した最初の試み。", url: "https://afterworld.balenciaga.com/" }
    ]
  },
  {
    id: "ryuichi-sakamoto-exhibition",
    title: "坂本龍一｜音を視る 時を聴く",
    summary: "坂本龍一が自ら構想を残した遺作的展覧会——高谷史郎・真鍋大度・岩井俊雄らとのコラボレーションが、死後も「彼の音」が生き続けることを実証した。",
    client: "東京都現代美術館",
    agency: "（坂本龍一 + 共同制作者たち）",
    categories: ["空間体験", "コンテンツ革新", "AIクリエイティブ"],
    award: "（受賞情報なし）",
    year: "2025",
    regions: ["国内"],
    link: "https://www.mot-art-museum.jp/exhibitions/RS/",
    thumbnail: "https://i.ytimg.com/vi/Gjtl74lcf6g/hqdefault.jpg",
    videoId: "Gjtl74lcf6g",
    overview: "2023年に逝去した坂本龍一が生前に構想を残した東京都現代美術館での個展。高谷史郎（Dumb Type）、真鍋大度（Rhizomatiks）、カールステン・ニコライ、アピチャッポン・ウィーラセタクン、岩井俊雄ら世界的アーティストとのコラボレーション作品を展示。音楽と時間・空間の知覚をめぐる坂本の哲学を視覚・聴覚・身体感覚として体験できる大規模展示。2024年12月〜2025年3月開催。",
    background: "坂本龍一は晩年に自身の死後も作品が語り続けることへの強い意志を示しており、この展覧会はその集大成として位置づけられた。「音を視る（音楽を視覚で感じる）」「時を聴く（時間を音で感じる）」というテーマは、坂本が生涯にわたって追求してきた知覚の境界への探求を反映している。出展作品の多くは坂本が協働アーティストと構想し、坂本の逝去後に完成させた作品を含む。",
    execution: "東京都現代美術館の大規模スペースに複数の没入型インスタレーションを展開。真鍋大度との作品「ロスト」、岩井俊雄との「インター[サウンド]プレイ」、高谷史郎との「追憶の泉」など、テクノロジーと音と映像が融合した体験型作品群。坂本自身の映像や声もアーカイブとして展示に組み込まれた。",
    evaluationImpact: "開幕後、国内外から多くの来場者を集め「日本で最も重要な展覧会の一つ」として高く評価された。坂本龍一という存在が音楽・メディアアート・テクノロジーの交点に立ち、死後も表現し続けるという事例として、AIと創造性・死後の著作権・デジタルアーカイブといった現代的テーマと接続する。デジタルとリアルが融合した追悼展示の新しい形を示した。",
    relatedWorks: [
      { title: "坂本龍一「12」(2023年）", description: "余命宣告後に制作・リリースされたアルバム。「死後も音楽が残るように」という意図で制作された遺作アルバム。", url: "https://www.youtube.com/watch?v=X2V3GYPD3dQ" },
      { title: "Ryoji Ikeda「test pattern」(2008〜）", description: "データを変換した映像インスタレーション。日本発のメディアアートとしてSakamotoと同じ系譜に属する池田亮司の代表作。", url: "https://www.ryojiikeda.com/" },
      { title: "Refik Anadol「Unsupervised」(2022年）", description: "AIが文化的アーカイブから「幻覚」を生成するインスタレーション。坂本展と同様にデータ・記憶・空間の融合という問いを持つ。", url: "https://www.moma.org/calendar/exhibitions/5535" }
    ]
  },
  {
    id: "project-cold",
    title: "Project:;COLD",
    summary: "SNS上でリアルタイムに展開される「不可逆性SNSミステリー」——TwitterとYouTubeを舞台にした物語体験が10万人以上を引き込んだ日本発のARG。",
    client: "（制作元情報非公開）",
    agency: "（制作元情報非公開）",
    categories: ["コンテンツ革新", "メディア発明"],
    award: "（受賞情報なし）",
    year: "2021",
    regions: ["国内"],
    link: "https://www.project-cold.net/",
    thumbnail: "https://i.ytimg.com/vi/AVe9jPDKt5Q/hqdefault.jpg",
    videoId: "AVe9jPDKt5Q",
    overview: "Twitter・YouTube・Discordなどのリアルタイムなソーシャルメディアを舞台に展開される「ARG（代替現実ゲーム）」的なミステリー体験。参加者はSNSの投稿・映像・暗号を解読しながら物語に参加する。「不可逆性」というコンセプトのもと、一度起きた出来事は現実のタイムラインと同様に取り消せないという設計が特徴。10万人以上が参加し、声優・杉田智和が概要動画を担当した。",
    background: "日本では2000年代初頭から「ARG（代替現実ゲーム）」の文化があり、「電車男」などの前例もある。Project:;COLDはその流れを受け継ぎながら、現代のSNSプラットフォームの特性（リツイート・コミュニティ解析・リアルタイム更新）を最大限に活用した設計。完全無料・匿名で参加でき、謎解きコミュニティが自発的に形成されるメカニズムが独特。",
    execution: "Twitter上の複数の「登場人物」アカウントが相互に投稿し合い、YouTubeの映像に暗号が埋め込まれ、参加者がDiscordやTwitterで集合知を使って解読する。物語は数ヶ月単位でリアルタイムに進行し、「参加した日」によって見える情報が異なる。後に家庭用ゲームへの展開（case.mirage等）も実現した。",
    evaluationImpact: "SNS参加型ナラティブ体験として国内で最も注目されたARGの一つ。「フィクションとリアルの境界を曖昧にする」体験設計が若年層から高い支持を得た。有料コンテンツではなく、参加者の集合知とコミュニティを創造物として設計した点が評価される。後続のSNSを舞台にしたインタラクティブな物語体験の日本の先行事例として位置づけられる。",
    relatedWorks: [
      { title: "The Sun Vanished（Twitter ARG, 2017〜）", description: "TwitterでリアルタイムにSFホラーが展開される英語圏の有名ARG。Project:;COLDと同様にSNSをフィクションの舞台にする手法。", url: "https://twitter.com/TheSunVanished" },
      { title: "「ずっと真夜中でいいのに。」ARG的マーケティング", description: "正体を伏せてSNSで活動を開始し、謎解きを通じてファンが発見するという音楽プロモーションの日本的手法の先例。", url: "https://www.youtube.com/@zutomayo" },
      { title: "Lock & Code（謎解きイベント×AR）各種", description: "現実空間での謎解きとデジタルARを組み合わせた体験型エンターテインメント。Project:;COLDのリアル/デジタル境界を溶かす発想と共鳴。", url: "https://en.wikipedia.org/wiki/Alternate_reality_game" }
    ]
  },
  {
    id: "imaginary-soundscape",
    title: "IMAGINARY SOUNDSCAPE",
    summary: "1枚の写真からその場所で聞こえるはずの「想像上の音風景」をAIが生成——Qosmoが開発した画像×音の横断体験ウェブアプリ。",
    client: "（Qosmoの自主研究プロジェクト）",
    agency: "Qosmo Inc.（東京）",
    categories: ["AIクリエイティブ", "テクノロジー×アイデア", "コンテンツ革新"],
    award: "Google Arts & Experiments掲載作品",
    year: "2019",
    regions: ["国内", "グローバル"],
    link: "https://imaginarysoundscape.net/",
    thumbnail: "https://i.ytimg.com/vi/HPM1adZ45_U/hqdefault.jpg",
    videoId: "HPM1adZ45_U",
    overview: "任意の画像（写真・絵画など）をアップロードすると、AIがその場所・シーンで「聞こえるであろう環境音」を生成・再生するウェブアプリ。砂浜の写真なら波と風の音、雑踏の写真なら人々のざわめきを、52,705の音声サンプルデータベースから適切な組み合わせを選択して生成する。Googleの「Experiments with Google」にも掲載されたQosmoの代表的プロジェクト。",
    background: "東京を拠点とするAI×音楽研究集団Qosmo（Nao Tokui代表）が「視覚と聴覚の間に存在する想像力」を機械学習で実装しようとした研究プロジェクト。2019年に初版を公開し、2022年にv2として更新。「画像を見て音を想像する」という人間の認知能力をAIが模倣できるかという問いを、アートプロジェクトとして実験的に公開した。",
    execution: "画像認識AI（シーン分類モデル）が画像内の環境カテゴリ（海岸・森・都市・室内等）を識別。分類結果に基づき、対応する環境音データベースから最適な音を選択・ミックスしてリアルタイム生成。ユーザーはブラウザ上で写真をアップロードするだけで体験でき、インターフェースは最小限のシンプルな設計。",
    evaluationImpact: "Googleの公式実験サイトに掲載されたことで国際的に認知が広がり、世界中のメディアアーティスト・研究者が参照した。「マルチモーダルAI」（複数の感覚を横断するAI）の文化的応用として先駆的事例となった。Qosmoはこの研究を基盤に、後にリアルタイムDJ×AI、AR音楽体験などへと発展させた。",
    relatedWorks: [
      { title: "Google「Magenta」プロジェクト（2016〜）", description: "Googleの機械学習による音楽・アート生成研究プロジェクト群。Imaginary Soundscapeと同様にAI×表現の研究の文脈に属する。", url: "https://magenta.tensorflow.org/" },
      { title: "坂本龍一「音を視る 時を聴く」展（2025年）", description: "「音を視る」というテーマがImaginary Soundscapeの「聴こえない音を想像する」という問いと深く共鳴する。", url: "https://www.mot-art-museum.jp/exhibitions/RS/" },
      { title: "Ryoji Ikeda「test pattern」（2008〜）", description: "データを音と映像に変換するメディアアート。「異なる感覚をデータで橋渡しする」という同じ思想的系譜。", url: "https://www.ryojiikeda.com/" }
    ]
  },
  {
    id: "gucci-garden-roblox",
    title: "GUCCI GARDEN（Roblox）",
    summary: "ラグジュアリーブランドが初めてRobloxに没入型仮想空間を開設——デジタルファッションとゲームの融合を大規模に実証した2021年の転換点。",
    client: "Gucci",
    agency: "Roblox（プラットフォーム）",
    categories: ["ブランドエクスペリエンス", "空間体験", "カルチャーインサイト"],
    award: "（受賞情報なし）",
    year: "2021",
    regions: ["グローバル"],
    link: "https://www.roblox.com/",
    thumbnail: "https://i.ytimg.com/vi/016X2X50mHc/hqdefault.jpg",
    videoId: "016X2X50mHc",
    overview: "Gucci創立100周年を記念した「Gucci Garden Archetypes」展示（フィレンツェ）をRoblox上に再現した没入型バーチャル体験。ユーザーは無個性なマネキンアバターでGucci Gardenに入場し、各部屋の展示を体験するにつれてグッチのテキスタイルや素材がアバターに吸収され、独自のアバターが完成するという設計。期間限定のバーチャルアイテムも販売され、一部アイテムは物理的なグッチの商品より高値で転売された。",
    background: "2021年前後にZ世代のデジタルネイティブ層が「ゲーム内ファッション」に価値を感じ始めていることが各社調査で明らかになった。Robloxは月間アクティブユーザー2億人以上の若年層プラットフォームとして存在感を増しており、グッチは「未来の顧客（10〜20代）」に直接リーチする手段としてRobloxを選択。物理的な店舗に来ない世代のブランド経験の場として機能させた。",
    execution: "Roblox内にGucciの世界観を反映した13の部屋（Garden of the Archetypes）を設計。ユーザーがゾーンを移動するにつれてアバターが変化するインタラクション設計。バーチャルのGucciアイテムの一部が一次販売価格の数十倍で転売されたことが話題になり、デジタルファッションの希少価値をリアルに証明した。2週間の限定開催で、リアルの展示会と同時展開した。",
    evaluationImpact: "「デジタルファッションの価値はリアルを超えうる」という命題をマーケットが実証した最初の大規模事例。グッチのバーチャルバッグが物理バッグより高値で取引されたことは世界中でメディアに報道された。以降、Louis Vuitton・Nike・Balenciagaなど主要ブランドが相次いでゲームプラットフォームへの進出を表明するきっかけとなった。",
    relatedWorks: [
      { title: "Fortnite × Balenciaga（2021年）", description: "同年のラグジュアリー×ゲームの並行事例。都市OOHとゲーム内の同時展開でより大規模にメタバースファッションを実証した。", url: "https://www.youtube.com/watch?v=5-lTfxuwlJE" },
      { title: "Nike × RTFKT「Clone X」NFT（2022年）", description: "NikeがNFTスニーカーブランドRTFKTを買収し、デジタルスニーカーとフィジカルスニーカーを連動させた事例。", url: "https://www.rtfkt.com/" },
      { title: "Animal Crossing「あつまれ どうぶつの森」× ブランドマーケティング（2020年）", description: "コロナ禍でMarc Jacobs等がゲーム内にブランドデザインの服を無料配布し若年層にリーチした先行事例。", url: "https://en.wikipedia.org/wiki/Animal_Crossing:_New_Horizons" }
    ]
  },
  {
    id: "beeple-everydays-nft",
    title: "EVERYDAYS: THE FIRST 5000 DAYS（Beeple）",
    summary: "5,000日間毎日作り続けたデジタルアートをNFT化し、Christie'sで約75億円で落札——NFTとデジタルアートが美術市場に正式参入した歴史的事件。",
    client: "（Beeple個人）",
    agency: "Christie's（オークションハウス）",
    categories: ["AIクリエイティブ", "カルチャーインサイト", "コンテンツ革新"],
    award: "（受賞なし、歴史的オークション記録）",
    year: "2021",
    regions: ["グローバル"],
    link: "https://www.christies.com/lot/lot-6296648",
    thumbnail: "https://i.ytimg.com/vi/S8p1B8NHLFQ/hqdefault.jpg",
    videoId: "S8p1B8NHLFQ",
    overview: "デジタルアーティストMike Winkelmann（Beeple）が2007年5月1日から13年間、毎日1枚ずつ制作したデジタルアート5000枚をコラージュした単一のJPEGファイルをNFT化。2021年3月11日にChristie'sのオンラインオークションで6,930万ドル（約75億円）で落札。生存するアーティストの作品として史上3位の高値となり、NFTとデジタルアートの歴史を変えた。",
    background: "NFT（Non-Fungible Token）技術自体は2017年頃から存在していたが、2021年初頭の仮想通貨バブルと重なりNFTアートが急速に注目された。Beepleは以前からデジタルアーティストとして知られていたが、Christie'sによる「伝統的オークションハウスでのNFT作品の初売却」がNFTの正当性を一気に高めた。落札者はシンガポールの仮想通貨投資家Vignesh Sundaresanだった。",
    execution: "5000点のデジタル作品を1枚の画像に結合し、Makersplaceを通じてNFTとして発行。Christie'sは初めてイーサリアムで入札を受け付けた。最終的に入札額は1億円超でスタートし、終了直前に数時間で50億円以上跳ね上がる劇的な展開となった。落札後も作品のJPEGファイルは誰でもダウンロード可能で「所有」と「鑑賞」が切り離された。",
    evaluationImpact: "NFTアートという新しい市場カテゴリを世界的に認知させた最重要事件。伝統的美術市場とブロックチェーンが交差したこの売却は、その後2021年にNFTバブルを生み出し、音楽・スポーツ・ゲームなど様々な分野でのNFT活用を促進した。2022年以降のNFT市場崩壊後も、デジタルアートの所有権という概念を美術史に刻んだ分岐点として評価される。",
    relatedWorks: [
      { title: "CryptoPunks（2017年）", description: "NFTアートの先駆け。ピクセルアートの10,000キャラクターが高値で取引されるNFTコレクションの原点。", url: "https://www.larvalabs.com/cryptopunks" },
      { title: "Refik Anadol「Unsupervised」(2022年）", description: "AIアートが主要美術館に進出した事例。Beepleのオークションと合わせ「デジタルアートの美術市場への参入」という同じ文脈。", url: "https://www.moma.org/calendar/exhibitions/5535" },
      { title: "Jack Dorsey「初めてのツイート」NFT（2021年）", description: "Twitterの最初の投稿がNFTで約3億円で取引された事例。NFTブームの象徴的出来事の一つとしてBeepleと並行して発生。", url: "https://v.cent.co/tweet/20" }
    ]
  },
  {
    id: "openai-sora",
    title: "SORA（OpenAI）",
    summary: "テキストから最大60秒の高品質動画を生成するAIを公開——「映像制作の民主化」という言葉では収まらない、映画産業への根本的な問いを投じた。",
    client: "OpenAI",
    agency: "（自社開発）",
    categories: ["AIクリエイティブ", "テクノロジー×アイデア", "コンテンツ革新"],
    award: "（受賞情報なし）",
    year: "2024",
    regions: ["グローバル"],
    link: "https://openai.com/sora",
    thumbnail: "https://i.ytimg.com/vi/HK6y8DAPN_0/hqdefault.jpg",
    videoId: "HK6y8DAPN_0",
    overview: "OpenAIが2024年2月に発表したテキストから動画を生成するAIモデル。最大60秒、高解像度（1080p相当）の映像をテキスト記述から生成可能。複数キャラクター・複雑なカメラモーション・物理的に自然な動きの表現が特徴。発表時のデモ映像（東京の雑踏・マンモスの群れ等）の品質が映像業界に衝撃を与えた。一般公開は2024年12月。",
    background: "2022年のDALL-E 2（テキストから画像生成）、2023年のGPT-4（高度な言語理解）に続き、テキストから動画という最後のフロンティアにOpenAIが到達した。Soraの発表はハリウッドを含む映像制作業界に大きな波紋を呼び、SAGアフトラ（俳優組合）やWGA（脚本家組合）がAIによる雇用への懸念を再び表明した。Runwayなど既存の動画生成AIとは一段異なる品質として業界に認識された。",
    execution: "拡散モデルをベースにしたアーキテクチャで、テキストプロンプトを受け取り時間的に一貫したフレームを生成する。既存の動画生成AI（Runway、Pika等）と比較して物理的リアリティと長時間の時間的整合性が優れる。発表当初は限定アクセスで映像クリエイターにテストを提供し、2024年12月に一般ユーザーへの段階的公開を開始した。",
    evaluationImpact: "映像制作・広告業界において「AIが撮影クルーを代替できるか」という議論を最も加速させた発表。公開後、複数のCM・MV・映画プリビズがSoraで制作され実際の商業利用が始まった。Cannesでは2025年からAI生成コンテンツへの審査基準が設けられるなど、広告賞の審査方式にも影響。「映像とは何か」という根本的な問いを改めて業界全体に突きつけた。",
    relatedWorks: [
      { title: "Runway Gen-3（2024年）", description: "SoraのライバルとなるRunwayの動画生成AI。Soraより先に商業利用が可能で、多くのCMやMVに使われ始めた。", url: "https://runwayml.com/" },
      { title: "Pika Labs（2023年）", description: "2023年に登場したテキスト・画像から動画生成するスタートアップ。Soraに先立ち動画AI市場を開拓した。", url: "https://pika.art/" },
      { title: "Coca-Cola「Create Real Magic」(2023年）", description: "AIを使ったコンテンツ生成をブランドとして先駆的に採用した事例。Soraと同様に「AIによるクリエイティブの変容」を示した。", url: "https://www.coca-cola.com/us/en/media-center/create-real-magic" }
    ]
  },
  {
    id: "messi-messages-lays",
    title: "MESSI MESSAGES（Lay's）",
    summary: "メッシが自分の言葉で語りかけてくれる——Lay'sがAI技術でファン一人ひとりへのパーソナライズドビデオメッセージを世界規模で実現した。",
    client: "Lay's（Frito-Lay / PepsiCo）",
    agency: "（制作エージェンシー詳細不明）",
    categories: ["テクノロジー×アイデア", "AIクリエイティブ", "ブランドエクスペリエンス"],
    award: "Cannes Lions 2021（詳細情報は確認中）",
    year: "2021",
    regions: ["グローバル"],
    link: "https://www.lovethework.com/campaigns/messi-messages-715897",
    thumbnail: "https://i.ytimg.com/vi/mwWtxF7wKvQ/hqdefault.jpg",
    videoId: "mwWtxF7wKvQ",
    overview: "Lay'sのグローバルアンバサダーであるリオネル・メッシが、ファン一人ひとりの名前と出身地を組み込んでパーソナルにメッセージを語りかける動画を自動生成するシステム。AIを用いたディープフェイク的映像合成技術により、メッシが「〇〇さん、あなたのためにプレーする」と語りかける動画が生成される。世界中のファンがSNSで動画を共有した。",
    background: "Lay'sはFIFAワールドカップのスポンサーとして、メッシというサッカー最大のスターとの契約を最大化するキャンペーンを模索。メッシが実際に何百万人ものファンに個人的にメッセージを送ることは物理的に不可能なため、AIによる映像合成でスケーラブルなパーソナライゼーションを実現した。当時まだ「ディープフェイク」の倫理的問題が広く議論されていない時期の実施だった。",
    execution: "ウェブサイトまたはSNSで名前と国籍等の基本情報を入力すると、AIがメッシの映像にその人向けの発話を合成した動画を生成。英語・スペイン語・ポルトガル語など複数言語に対応。生成された動画はSNSでシェア可能な形式で提供された。メッシ側からの同意・収録協力のもとで実施されたと報告されている。",
    evaluationImpact: "AIによるセレブリティの「個別化メッセージ」という形式の先駆的商業実装として評価。Cadburyの#NotJustACadburyAdと同年（2021年）に、AIを使った大規模パーソナライゼーションキャンペーンが相次いだことで「AIパーソナライゼーション広告」というカテゴリが確立された。ただし同時期のRoadrunner（ボーデイン）騒動と合わせ、AI映像の倫理的同意という問題を提起した事例でもある。",
    relatedWorks: [
      { title: "Cadbury「Not Just A Cadbury Ad」(2021年）", description: "同年、AIを使ってシャー・ルク・カーンが個人商店を宣伝するCMを生成した事例。AI×パーソナライゼーション×スターという同じ文脈。", url: "https://www.youtube.com/watch?v=R3FnhpelBR0" },
      { title: "#StillSpeakingUp（RSF, 2021年）", description: "AI映像生成の「善意の応用」と「倫理的問題」を同時に提起した2021年の他の事例。Messi Messagesと並べることで技術の多様な用途が見えてくる。", url: "https://www.lovethework.com/campaigns/stillspeakingup-deeptruth-710063" },
      { title: "Lil Miquela × Prada/Calvin Klein（2018〜）", description: "AIが生成した仮想インフルエンサーが実在するブランドとコラボした先行事例。「存在しないスター」と「存在するスターのAI化」の対比。", url: "https://www.instagram.com/lilmiquela/" }
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
