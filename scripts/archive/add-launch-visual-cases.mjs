import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");

const newCases = [
  // ══ LAUNCH/REVEAL CASES ══
  {
    id: "why-so-serious-dark-knight",
    title: "WHY SO SERIOUS?（The Dark Knight ARG）",
    summary: "ゴッサムシティの生きたWebインフラ——15ヶ月・75サイト・1000万人参加のARG。WhySoSerious.comはGCPDをジョーカーが改ざんした体裁で、バースデーケーキに携帯が焼き込まれ次のミッションが届く。",
    client: "Warner Bros.（The Dark Knight）",
    agency: "42 Entertainment",
    categories: ["メディア発明", "ブランドエクスペリエンス", "カルチャーインサイト"],
    award: "Cannes Lions Cyber Grand Prix 2009 / One Show Grand Prix",
    year: "2008",
    regions: ["グローバル"],
    link: "https://whysoseriousredux.com/",
    thumbnail: "https://i.ytimg.com/vi/KAOdjqyG37A/hqdefault.jpg",
    videoId: "KAOdjqyG37A",
    overview: "映画The Dark Knightの宣伝として設計された史上最大規模のARG。WhySoSerious.com、IBelieveInHarveyDent.com、GothamCityPolice.comなど75以上のWebサイトが「ゴッサムシティの実在するインフラ」として機能。ジョーカーがミッションを発令し、ファンが現実世界のタスクを遂行することでWebサイトのコンテンツが更新されていく。",
    background: "映画のプロモーションを「映画の広告」ではなく「映画の世界への参加」として再定義しようとした試み。バットマンの世界観をWebサイト・物理世界・リアルタイムイベントで立体化し、ファンが「ゴッサムシティ市民」として物語に参加できる設計。",
    execution: "IBelieveInHarveyDent.comはリアルな選挙キャンペーンサイトとして機能。メールアドレスを送るとHarvey Dentの顔が1ピクセルずつ明らかに→ファンがタスクを完了するとジョーカーが1ピクセルずつ毀損していく。バースデーケーキの中に携帯電話が焼き込まれ、回収した人だけが次のミッションを受信。15ヶ月・75カ国・10万件のリアルイベント参加者。",
    evaluationImpact: "11,000,000人参加・77カ国展開で「映画ARGの原型」を確立。Cannes Cyber Grand Prix史上最高得点受賞。「URLが秘密の入口になる」「WebサイトがフィクションのURLになる」という設計の原点として現在もすべてのARGキャンペーンが参照する。",
    relatedWorks: [
      { title: "Cloverfield ARG（2007年）", description: "同時期の映画ARG。「タイトルも公開しない」という情報制御でWeb上の架空企業サイトが唯一の情報源になった。", url: "https://www.youtube.com/watch?v=4WyaKvNwS1Q" },
      { title: "I Love Bees / Halo 2（2004年）", description: "物理世界との連動型ARGの先行事例。公衆電話+Webサイト+声優のリアルタイム対話。", url: "https://en.wikipedia.org/wiki/I_Love_Bees" },
      { title: "Sombra ARG / Overwatch（2016年）", description: "ゲーム業界での直接的後継事例。架空企業サイトが「ハックされた」状態で公開され5ヶ月間謎が続く。", url: "https://en.wikipedia.org/wiki/Overwatch" }
    ]
  },
  {
    id: "cloverfield-arg",
    title: "CLOVERFIELD ARG（1-18-08.com）",
    summary: "タイトルなし・キャストなし——1-18-08.comはポラロイド写真のみ。Slusho.jpという架空スラッシードリンクサイトから企業エコシステムが広がり、映画の「神話」がWebに存在した。",
    client: "Paramount Pictures / Bad Robot",
    agency: "在内部",
    categories: ["メディア発明", "カルチャーインサイト"],
    award: "（受賞情報なし）",
    year: "2008",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=4WyaKvNwS1Q",
    thumbnail: "https://i.ytimg.com/vi/4WyaKvNwS1Q/hqdefault.jpg",
    videoId: "4WyaKvNwS1Q",
    overview: "映画Cloverfieldの予告篇にはタイトルなし、キャストなし、ただ「1-18-08」という日付のみ。1-18-08.comはポラロイド写真だけが掲載され説明ゼロ。予告篇に映り込む「Slusho」TシャツからSlusho.jp（架空日本スラッシードリンク会社）が発見され、その親会社Tagruato.jp（深海掘削企業）、内部告発NGO「TIDOWave.com」へと世界観が広がった。",
    background: "2007年当時、インターネットで映画情報を探すファン文化が成熟しつつあった。J.J. Abramsはこの習性を逆手に取り「情報を隠すことで最大の話題を生む」戦略を設計。架空企業サイトが現実のインターネットに存在することで、フィクションと現実の境界を曖昧にした。",
    execution: "6ヶ月間、1-18-08.comが「唯一の公式情報源」として機能。Tagruato.jpは深海掘削企業の完全な企業サイトとして運営（採用情報・プレスリリース・財務情報付き）。映画公開前にTagruato衛星の大西洋への落下・Chuai Station掘削基地の謎の沈没がサイト上で「報告」される。",
    evaluationImpact: "「情報を与えないことが最大のプロモーション」という発想を証明。架空企業サイトのエコシステムという手法の完成形。後続のPrometheus（Weyland Industries）などに直接影響。",
    relatedWorks: [
      { title: "Why So Serious?（2008年）", description: "同時期の映画ARGの最大規模事例。Cloverfieldが「情報を隠す」ならDark Knightは「情報を小出しにする」という対照的な設計。", url: "https://whysoseriousredux.com/" },
      { title: "Prometheus / Weyland Industries（2012年）", description: "Cloverfieldの架空企業サイト手法を4年後に洗練させた事例。TED講演まで制作。", url: "https://www.youtube.com/watch?v=4PPGrNsJxEI" },
      { title: "10 Cloverfield Lane（2016年）", description: "同シリーズの8年後。Tagruatoサイトを「再稼働」させることで既存ARGのノスタルジアを活用。", url: "https://www.youtube.com/watch?v=ICbMQiH1MIE" }
    ]
  },
  {
    id: "prometheus-weyland-industries",
    title: "WEYLAND INDUSTRIES（Prometheus ARG）",
    summary: "2023年設立の架空ハイテク企業が映画公開2年前からWebに存在——CEO Peter WeylandのTED講演、採用情報、製品ラインをすべて「本物」として構築した。",
    client: "20th Century Fox（Prometheus）",
    agency: "Scott Free Productions",
    categories: ["メディア発明", "コンテンツ革新"],
    award: "Cannes Lions Titanium",
    year: "2012",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=4PPGrNsJxEI",
    thumbnail: "https://i.ytimg.com/vi/4PPGrNsJxEI/hqdefault.jpg",
    videoId: "4PPGrNsJxEI",
    overview: "WeylandIndustries.comが映画Prometheusの設定上の企業として2年前から運営。CEO Peter WeylandによるTED講演（設定上2023年の未来）をYouTubeで公開。製品ライン・採用情報・株主向けIR・プレスリリースを完備した。映画公開直前、エンジニアリング部門ページが異星人の発見を示唆するコンテンツに変化。",
    background: "Ridley Scott監督のPrometheus公開前キャンペーン。「映画のプロモーション」ではなく「映画の世界の企業Webサイト」として設計。Cloverfield ARGの架空企業サイト手法を本格的に洗練させた事例。",
    execution: "Guy Pearce演じるPeter WeylandがTED2023で「不死」について語る4分間の講演をYouTubeで公開（撮影はTEDの本物のステージで）。weylandindustries.comには採用ページ・財務報告・製品カタログを掲載。公開2週間前、サイトが「外星体発見」に関するシグナルを受信したというフィクション更新が行われた。",
    evaluationImpact: "「映画の世界の企業が本当にTED講演する」という虚構と現実の融合の洗練された実装。TED講演動画は現在も500万回以上の再生を記録。",
    relatedWorks: [
      { title: "Cloverfield ARG（2008年）", description: "架空企業サイト手法の先行事例。Cloverfield→Prometheusという進化の系譜。", url: "https://www.youtube.com/watch?v=4WyaKvNwS1Q" },
      { title: "Westworld DiscoverWestworld（2016年）", description: "架空のリゾートサイトとして機能したHBOドラマのARG。Weylandと同じ「架空企業サイトがリアルである」設計。", url: "https://www.youtube.com/watch?v=TECDx6hE5_M" },
      { title: "Jurassic World公式サイト（2015年）", description: "架空テーマパークの予約サイト。同様の「実在する世界として機能するWebサイト」設計の展開形。", url: "https://www.youtube.com/watch?v=RFinNxS5KN4" }
    ]
  },
  {
    id: "jurassic-world-park-site",
    title: "JURASSIC WORLD 公式サイト（テーマパーク体裁）",
    summary: "映画公開2年前から「実在するジュラシック・ワールドへの予約サイト」として運営——キャスト・公開日なし、恐竜のデータシートや観光マップが本物の旅行サイトのように機能した。",
    client: "Universal Pictures",
    agency: "Universal Creative",
    categories: ["メディア発明", "ブランドエクスペリエンス"],
    award: "（受賞情報なし）",
    year: "2015",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=RFinNxS5KN4",
    thumbnail: "https://i.ytimg.com/vi/RFinNxS5KN4/hqdefault.jpg",
    videoId: "RFinNxS5KN4",
    overview: "映画Jurassic World（2015年）の公開2年前からJurassicWorld.comが「実在するテーマパーク」の予約・観光サイトとして機能。インタラクティブマップで各恐竜ゾーン・アトラクション・水族館・ゴルフコース・ナイトクラブをクリック体験。各恐竜種のデータシートがPDFで公開（完全な架空生物学資料）。映画公開直前に「恐竜脱走事件」でサイトが改ざんされる演出。",
    background: "「映画のプロモーションサイトを作る」のではなく「映画の世界の公式サイトを作る」という発想の転換。2年間継続的に更新され、訪問者はキャスト情報を一切得られないまま「実在する場所」への親しみを積み重ねた。",
    execution: "JurassicWorld.comには「今週の注目恐竜」「従業員の声」「観光パッケージ」など定期更新コンテンツを設置。映画の物語と連動した「事件」がサイト改ざんとして演出される。映画公開後もサイトは映画の世界観で維持。",
    evaluationImpact: "「2年間、映画のことを忘れさせる」という長期的な世界観構築の成功事例。ファンがサイトを「おすすめスポット情報として」シェアするという有機的拡散。",
    relatedWorks: [
      { title: "Westworld DiscoverWestworld（2016年）", description: "架空テーマパーク予約サイトという同一設計。Jurassic Worldとほぼ同時期の直接的並行事例。", url: "https://www.youtube.com/watch?v=TECDx6hE5_M" },
      { title: "Weyland Industries（2012年）", description: "架空企業Webサイトの先行事例。JurassicWorldはテーマパーク版。", url: "https://www.youtube.com/watch?v=4PPGrNsJxEI" },
      { title: "Cyberpunk 2077 nightcity.love（2020年）", description: "ゲームの舞台となる都市の「観光サイト」を架空で構築した同設計のゲーム版。", url: "https://nightcity.love" }
    ]
  },
  {
    id: "discover-westworld-aideden",
    title: "DISCOVER WESTWORLD / AEDEN（HBO）",
    summary: "架空テーマパーク「Westworld」の本物の予約サイトとして機能——AIコンシェルジュ「Aeden」が250以上のユニーク応答を持ち、「HostとHumanの違い」を問うると哲学的な答えが返ってくる。",
    client: "HBO",
    agency: "Elastic",
    categories: ["AIクリエイティブ", "ブランドエクスペリエンス", "メディア発明"],
    award: "Cannes Lions Entertainment Grand Prix（Entertainment for TV & Streaming）",
    year: "2016",
    regions: ["北米"],
    link: "https://www.youtube.com/watch?v=TECDx6hE5_M",
    thumbnail: "https://picsum.photos/seed/westworld-discover/1200/630",
    videoId: "",
    overview: "HBOドラマWestworld Season 1の宣伝として、DiscoverWestworld.comがラグジュアリーリゾートの本物の予約サイトとして機能。AIコンシェルジュ「Aeden」が250以上のユニーク応答を持つチャットボットとして動作。「HostとHumanを区別できるか」「意識とは何か」という哲学的質問への回答が番組の核心テーマと完璧に一致。チャットのlogがTwitter・Redditで大量シェアされ最大の宣伝効果に。",
    background: "ドラマのテーマ（AIと人間の区別・テーマパークの本質）を、まさにそのテーマパークへの「予約サイト」というフォーマットで体現した設計。ドラマのWebサイトではなく「ドラマの世界のWebサイト」。",
    execution: "DiscoverWestworld.comは完全なリゾート予約UI（ツアーパッケージ選択・旅程確認）を持つ。AIアシスタントAedenは通常の旅行相談に答えながら、ドラマのネタバレを含む回答も持ち合わせる。Season 2では「Delos Destinations」にリブランディング。",
    evaluationImpact: "「AIチャットボットがARGの中心になる」という設計の先駆事例。ファンがAedenとの会話スクリーンショットをSNSで共有することで有機的なコンテンツ生成が発生。",
    relatedWorks: [
      { title: "Jurassic World公式サイト（2015年）", description: "同時期の架空テーマパーク予約サイト。映画版とドラマ版の比較として参照できる。", url: "https://www.youtube.com/watch?v=RFinNxS5KN4" },
      { title: "Cyberpunk 2077 nightcity.love（2020年）", description: "ゲームの都市観光サイトという同設計のゲーム版。AIではなく静的コンテンツだが世界観構築の手法は同一。", url: "https://nightcity.love" },
      { title: "Longlegs キャンペーンサイト（2024年）", description: "映画の世界観をWebサイトとして構築した同設計の最新事例。", url: "https://www.youtube.com/watch?v=kMZCE1LhFE4" }
    ]
  },
  {
    id: "longlegs-birthday-murders",
    title: "THE BIRTHDAY MURDERS（Longlegs ARG）",
    summary: "新聞の半ページ暗号広告から始まり、1990年代のアマチュア真犯罪サイトに辿り着く——映画のURLではなく「実際の殺人犯の記録サイト」として完璧に偽装したキャンペーン。",
    client: "Neon Films（Longlegs）",
    agency: "MAKE",
    categories: ["メディア発明", "カルチャーインサイト"],
    award: "（受賞情報なし）",
    year: "2024",
    regions: ["北米"],
    link: "https://www.youtube.com/watch?v=kMZCE1LhFE4",
    thumbnail: "https://i.ytimg.com/vi/kMZCE1LhFE4/hqdefault.jpg",
    videoId: "kMZCE1LhFE4",
    overview: "映画Longlegs（2024年）の発表前にシアトルタイムズに「Longlegusが要求した」という暗号グリッドが半ページ広告として掲載。解読するとthebirthdaymurders.net——1990年代のアマチュア真犯罪調査サイトとして完璧に再現されたWebサイトに辿り着く。架空の連続殺人犯の犯行記録・証拠写真・警察資料が掲載（すべて架空）。",
    background: "ホラー映画Longlegsは連続殺人犯を追うFBI捜査官の物語。宣伝チームは「映画のプロモーションサイト」ではなく、映画の世界に実在する「真犯罪記録サイト」を制作した。1990年代のHTML・デザイン・フォントを完璧に再現した時代考証が話題に。",
    execution: "暗号グリッド広告は本物のThe Seattle Times紙面に掲載。解読した人だけがURLに辿り着く設計。thebirthdaymurders.netはGeoCities時代のWeb再現（低解像度画像・テキストリンク・蛍光色）で「本物感」を演出。",
    evaluationImpact: "映画公開前からホラーファンとARGコミュニティの両方に話題が広がり、1990年代ノスタルジアと謎解き欲求を同時に満たした。Neonによるホラー映画マーケティングの革新事例として言及される。",
    relatedWorks: [
      { title: "Why So Serious?（2008年）", description: "「映画の世界のWebサイト」という同じ設計思想の原点。Dark KnightとLonglegsはジャンルが異なるが構造は同一。", url: "https://whysoseriousredux.com/" },
      { title: "Cloverfield ARG（2008年）", description: "架空企業サイトによる世界観構築の先行事例。Longlegsは「真犯罪サイト」バージョン。", url: "https://www.youtube.com/watch?v=4WyaKvNwS1Q" },
      { title: "underscores Wallsocket ARG（2023年）", description: "音楽アルバムの架空の町Webサイト群。Longlegsの「架空の犯罪記録サイト」と同じ「フィクションのWebが実在する」手法。", url: "https://wallsocketgov.com" }
    ]
  },
  {
    id: "tenet-voice-activation",
    title: "TENET tenetfilm.com 音声起動体験",
    summary: "マイクに「Tenet」と話しかけると未公開映像が解禁される——映画の「秘密の合言葉」というテーマをWebサイトのUIそのものに体現した。",
    client: "Warner Bros.（TENET）",
    agency: "Elastic",
    categories: ["テクノロジー×アイデア", "メディア発明", "コンテンツ革新"],
    award: "Webby Award 2021",
    year: "2020",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=LkjgzlZH8_E",
    thumbnail: "https://picsum.photos/seed/tenet-voice/1200/630",
    videoId: "",
    overview: "tenetfilm.comにアクセスするとマイクへのアクセス許可のみ要求される。「Tenet」と発話すると未公開のトレーラー映像が起動。劇中の秘密の合言葉「We live in a twilight world」を言うとさらに深いコンテンツへ。TensorFlow.jsによりクライアントサイド完結（サーバーへの音声データ送信なし）。",
    background: "Christopher Nolan監督作品TENETのテーマは「秘密・逆行・合言葉」。宣伝サイトのUIにこのテーマを直接実装することで、サイト訪問が映画体験の予告になる設計。Nolan作品恒例の「体験的マーケティング」の一環。",
    execution: "TensorFlow.jsのSpeech Recognitionモデルをブラウザで実行。音声データはすべてローカル処理（プライバシー配慮）。2段階の発話認証——「Tenet」で第1段階、「We live in a twilight world」で第2段階のコンテンツ解禁。",
    evaluationImpact: "映画のコンセプトとWebのUIが完全一致したキャンペーンとして高評価。Webby Award受賞。「音声で解禁する」というインタラクションの先駆事例として参照される。",
    relatedWorks: [
      { title: "Magnif-Eye / 1001 Optometry（2026年）", description: "センサーや入力によってWebコンテンツが変化する設計の同系譜。", url: "https://www.vml.com/work/magnifeye" },
      { title: "Massive Attack「Fantom」(2019年）", description: "心拍・位置・動きで音楽が変化するセンサー連動体験。TENETと同じく「物理インタラクション＝コンテンツ変化」設計。", url: "https://www.massiveattack.co.uk/" },
      { title: "Why So Serious?（2008年）", description: "現実の行動がWebコンテンツを変化させるARGの原型。TENETの「発話すると解禁」はその洗練された現代版。", url: "https://whysoseriousredux.com/" }
    ]
  },
  {
    id: "straight-outta-somewhere",
    title: "STRAIGHT OUTTA SOMEWHERE（Beats by Dre）",
    summary: "写真をアップロードして出身地を入力するだけ——世界中の人が自分の「Straight Outta ○○」画像を作りシェアし、48時間で100万枚・最終4000万枚超を達成した広告費ゼロのキャンペーン。",
    client: "Beats by Dre / Apple",
    agency: "Translation LLC",
    categories: ["メディア発明", "カルチャーインサイト", "コンテンツ革新"],
    award: "Cannes Lions Cyber Grand Prix 2016 / One Show Grand Prix",
    year: "2015",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=7PJCv7HYsP4",
    thumbnail: "https://picsum.photos/seed/straight-outta-somewhere/1200/630",
    videoId: "",
    overview: "映画「Straight Outta Compton」公開に合わせ、straightouttasomewhere.comがワンページのミームジェネレーターとして公開。写真アップロード+出身地入力だけで「Straight Outta ○○」画像を生成。Dr. Dre・Serena Williams・Richard Shermanが先行投稿してシード。その後NASA・FBI・CIA・Disney・NFL/NBA公式アカウントが参加。広告費ゼロで展開。",
    background: "Beats by DreはAppleに買収された直後のタイミング。「Straight Outta Compton」映画との連携でヒップホップ文化との接続を強化したかった。ユーザーが「自分のコンテンツを作る」という参加設計で、宣伝費をかけずに全世界への拡散を実現した。",
    execution: "サイトはシンプルなHTMLフォーム（写真アップロード + テキスト入力 + ダウンロードボタン）のみ。生成画像はSNSで直接共有可能なフォーマット。機能を絞り込んだシンプルさが参加障壁をゼロに。",
    evaluationImpact: "Cannes Cyber Grand Prix受賞。「UGCをミームとして設計する」という現代マーケティングの定石を確立した事例。「シンプルなWebツール＋文化的共鳴」という組み合わせの最高峰。",
    relatedWorks: [
      { title: "Barbie Selfie Generator（2023年）", description: "同じミームジェネレーター型。8年後の技術進化（AI背景除去）で同コンセプトを映画Barbieが実施。", url: "https://barbieselfie.ai" },
      { title: "Bad Bunny「Tracking Bad Bunny」(2025年）", description: "ファンが能動的に参加・シェアする設計という同思想の最新進化形。", url: "https://www.youtube.com/watch?v=wTMC_zesAt4" },
      { title: "Always #LikeAGirl（2014年）", description: "ユーザーがコンテンツを自分ごと化してシェアするという同じソーシャル設計の先行事例。", url: "https://www.youtube.com/watch?v=vxd_DKsITXo" }
    ]
  },
  {
    id: "barbie-selfie-ai",
    title: "BARBIE SELFIE GENERATOR（barbieselfie.ai）",
    summary: "映画公開3.5ヶ月前から全世界がバービーになった——AIが写真をバービーポスター風に変換するだけのサイトがUGCで爆発し、政治家からスポーツ選手まで誰もが参加した。",
    client: "Warner Bros.（Barbie）",
    agency: "Bond Agency / PhotoRoom",
    categories: ["AIクリエイティブ", "メディア発明", "カルチャーインサイト"],
    award: "Cannes Lions Titanium / Webby Award 2024",
    year: "2023",
    regions: ["グローバル"],
    link: "https://barbieselfie.ai",
    thumbnail: "https://picsum.photos/seed/barbie-selfie-ai/1200/630",
    videoId: "",
    overview: "barbieselfie.aiは2023年4月3日（映画公開3.5ヶ月前）から公開。PhotoRoom AIが背景除去→バービーポスター様式（ピンク・タイポグラフィ・特定フォーマット）に変換。テイラー・スウィフト・NBA選手・政治家・企業公式アカウントまでが参加。映画公開前に「バービーの世界観」が全世界に形成された。",
    background: "Greta Gerwig監督作品Barbieのコアコンセプト「あなたもバービーになれる」をWebツールとして実装。映画の世界観への「参加」を事前に大量に作り出すことで、公開前から映画への親しみを醸成する戦略。",
    execution: "サイト設計は極めてシンプル（写真アップロード→AI処理→ダウンロード）。生成された画像のフォーマットはInstagram/Twitter最適化済み。「#Barbie」「#BarbieMovie」タグが自然発生的に付与された。",
    evaluationImpact: "映画公開前に「バービーの審美観」を全世界のSNSタイムラインに浸透させることに成功。Barbieの2023年全世界興行収入14億ドルに貢献した最重要プロモーション要素として評価。",
    relatedWorks: [
      { title: "Straight Outta Somewhere（2015年）", description: "ミームジェネレーター型の先行事例。AI背景除去がない時代の同コンセプト実施。", url: "https://www.youtube.com/watch?v=7PJCv7HYsP4" },
      { title: "DALL-E 2（OpenAI, 2022年）", description: "テキストから画像を生成するAIの普及がbarbieselfie.ai成立の技術的背景。", url: "https://openai.com/dall-e-2" },
      { title: "Taylor Swift「1989 Vault Puzzle」(2023年）", description: "同年、映画公開前からファンが集合参加するキャンペーン設計の並行事例。", url: "https://www.taylorswift.com/" }
    ]
  },
  {
    id: "puma-black-station-3d",
    title: "PUMA BLACK STATION（Unreal Engine 5 ファッションショー）",
    summary: "NYFWをキャンセルしてWebサイトが代わりになった——Unreal Engine 5製の3Dロビーにアクセスすると、2つのポータルが新作スニーカーのランウェイ展示として機能する。",
    client: "PUMA",
    agency: "The Working Assembly",
    categories: ["空間体験", "テクノロジー×アイデア", "ブランドエクスペリエンス"],
    award: "Awwwards SOTD / One Show Merit",
    year: "2022",
    regions: ["グローバル"],
    link: "https://www.puma.com/",
    thumbnail: "https://picsum.photos/seed/puma-black-station/1200/630",
    videoId: "",
    overview: "PUMAはNYFWへの参加をキャンセルし、代わりにblackstation.puma.comをリリース。Unreal Engine 5製の超リアルな3Dロビーをブラウザで直接体験。2つのポータルが新商品「Nitro NFRNO」「Nitro FASTROID」のランウェイ展示として機能。物理ショーゼロで発表した。",
    background: "コロナ禍後のファッション業界でフィジカルショーのあり方が問われていた中、PUMAはデジタルファーストのアプローチを選択。NFT/Web3ブームも追い風となり「ファッションショーがゲームのような体験になる」という新形式を提示。",
    execution: "blackstation.puma.comにアクセスするとUE5のリアルタイムレンダリングが起動（ダウンロード不要）。ロビーの2つのポータルが商品発表スペースとして機能。NFT連動要素も含む。",
    evaluationImpact: "「ファッションショーの代替としてのWebGL 3D空間」の成功事例として業界に影響。Awwwards SOTD受賞。Balenciaga Afterworldと並ぶ「デジタル発表の本格実装」として参照される。",
    relatedWorks: [
      { title: "Balenciaga「Afterworld」(2020年）", description: "ゲームがファッションショーになった最初の大規模事例。PUMA Black StationはBalenciagaの直接的後継。", url: "https://afterworld.balenciaga.com/" },
      { title: "LOEWE「Show in a Box」(2020年）", description: "Jonathan Andersonによるファッションショーのデジタルリプレイスメントのもうひとつの形態。", url: "https://www.loewe.com/" },
      { title: "Radiohead「Kid A Mnesia Exhibition」(2021年）", description: "WebGL/ゲームエンジンで「空間体験」をデジタル提供する同系譜の音楽版。", url: "https://store.epicgames.com/p/kid-a-mnesia-exhibition" }
    ]
  },
  {
    id: "balenciaga-afterworld-game",
    title: "AFTERWORLD: THE AGE OF TOMORROW（Balenciaga）",
    summary: "ブラウザで直接起動するUE4製ゲームがFall 2021ファッションショーの代替——2031年設定の5ステージを歩き、NPCが実際のコレクションを着用し、ゲーム内から購入できる。",
    client: "Balenciaga",
    agency: "Balenciaga Creative Studio（Demna Gvasalia）",
    categories: ["空間体験", "テクノロジー×アイデア", "ブランドエクスペリエンス"],
    award: "（受賞情報なし）",
    year: "2020",
    regions: ["グローバル"],
    link: "https://afterworld.balenciaga.com/",
    thumbnail: "https://picsum.photos/seed/balenciaga-afterworld/1200/630",
    videoId: "",
    overview: "Balenciaga Fall 2021コレクションをUnreal Engine 4製のビデオゲームとして発表。2031年のBalenciagaショップからスタートし、デジタルアバタールーム・ポストアポカリプスの廃墟・サイバーパンク都市など5ステージを歩く。NPCが実際の商品を着用し、コレクション全点をゲーム内から購入可能。",
    background: "COVID-19でパリコレが開催不可能だった2020年末、Demna Gvasaliaはショーをゲームとして再定義することを選んだ。「ファッションショーがRunwayである必要があるか」という問いへの回答。Gareth Pynn作のオリジナルサウンドトラック付き。",
    execution: "afterworld.balenciaga.comにアクセスするとダウンロード不要でゲームが起動。コントローラー操作（キーボード/マウス/ゲームパッド対応）でキャラクターを操作。各ステージでショーピースを着たNPCと会話→商品詳細ページに遷移。",
    evaluationImpact: "「ファッションショーをゲームに置き換える」という概念の実装として業界に衝撃。コレクションがゲームスクリーンショットとしてSNSに大量共有。Fortnite × Balenciagaへの布石となった転換点。",
    relatedWorks: [
      { title: "PUMA Black Station（2022年）", description: "直接的後継事例。UE5でより高品質なデジタルショー体験を実現。", url: "https://www.puma.com/" },
      { title: "Fortnite × Balenciaga（2021年）", description: "Afterworld翌年に実施されたゲーム×ファッションの次のステップ。ゲームを「制作した」から「ゲームに参入した」へ。", url: "https://www.youtube.com/watch?v=5-lTfxuwlJE" },
      { title: "Radiohead「Kid A Mnesia Exhibition」(2021年）", description: "ゲームエンジンを非ゲーム体験に転用する同設計の音楽版。", url: "https://store.epicgames.com/p/kid-a-mnesia-exhibition" }
    ]
  },
  {
    id: "telfar-bag-security-program",
    title: "TELFAR BAG SECURITY PROGRAM",
    summary: "ボットも転売ヤーも存在しない——24時間無制限オープン受注で「本当に欲しいファン」だけが定価購入できる仕組みを作ったEコマースの革命。",
    client: "Telfar",
    agency: "（自社設計）",
    categories: ["ブランドエクスペリエンス", "カルチャーインサイト", "社会包摂"],
    award: "Time誌 Best Inventions of 2020",
    year: "2020",
    regions: ["北米"],
    link: "https://telfar.net/",
    thumbnail: "https://picsum.photos/seed/telfar-bag-security/1200/630",
    videoId: "",
    overview: "通常の「ドロップ」販売は数秒で完売→ボット・転売ヤーが価格を5〜10倍に釣り上げる問題に対し、Telfar Bag Security Programは2020年8月19〜20日の24時間、全カラー・全サイズを無制限でオープン受注。ボット対策なし・抽選なし・キュー待ちなし。本当に欲しいファンだけが定価で購入できた。",
    background: "Telfar ClementsはBlack-owned fashion brandとして、ラグジュアリーのアクセシビリティを民主化することをブランドコアに置いている。「Shopping Bag for everyone」というスローガンを体現するために、通常の希少性演出とは正反対の販売システムを設計した。",
    execution: "telfar.netに全在庫を24時間オープン表示。通常のカートシステムを使うが「在庫制限なし」に設定。投機的購入者（転売目的）は「すぐに売り切れない」ことで興味を失い離脱。ブランドとして初めて翌年「Telfar TV」との組み合わせに発展。",
    evaluationImpact: "Time誌 Best Inventions of 2020選出。「Eコマースの仕組みの設計変更がそのままブランドメッセージになる」という発想の最高峰。後続の多くのブランドが抽選・無制限・先行予約など「ドロップの代替形式」を模索するきっかけに。",
    relatedWorks: [
      { title: "Supreme drops（2011〜）", description: "週次ドロップによる希少性演出の代表事例。TelfarはSupremeの「希少性」に真正面から反論した。", url: "https://www.supremenewyork.com/" },
      { title: "Nike × RTFKT（2021年）", description: "デジタルファッションにおける購入・所有体験の革新。Telfarのアナログ版と対比して参照できる。", url: "https://rtfkt.com/" },
      { title: "DoorDash「All The Ads」(2024年）", description: "既存のシステム・ルールの転覆がキャンペーンになるという同思想の広告版。", url: "https://lbbonline.com/news/cannes-lions-titanium-grand-prix-awarded-to-doordash-all-the-ads" }
    ]
  },
  {
    id: "the-wilderness-downtown",
    title: "THE WILDERNESS DOWNTOWN（Arcade Fire × Google）",
    summary: "幼少期の住所を入力するとGoogleマップが同期して「自分の育った場所のMV」が生成される——複数のブラウザウィンドウが振り付けされたように動く世界初のパーソナライズドMV体験。",
    client: "Arcade Fire / Google Chrome",
    agency: "B-Reel / Google Creative Lab",
    categories: ["テクノロジー×アイデア", "コンテンツ革新", "AIクリエイティブ"],
    award: "Cannes Lions Cyber Grand Prix 2011 / FWA Site of the Year",
    year: "2010",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=Zo1FQJBzSxY",
    thumbnail: "https://picsum.photos/seed/wilderness-downtown/1200/630",
    videoId: "",
    overview: "wilderness-downtown.comで幼少期の住所を入力するとGoogleマップ・Googleストリートビューが同期。Arcade Fireの楽曲「We Used to Wait」に合わせて、ユーザーが育った実際の街のMVが生成される。複数のブラウザウィンドウが自動的に開き、コレオグラフィのように動くHTML5体験。",
    background: "Chrome Experimentsの一環として、HTML5の可能性を示すためにArcade FireとGoogle Creative Labが協働。「普遍的な感情（懐かしさ・故郷）」を個人化されたWebページで体験させる。",
    execution: "Google Maps API + Google Street View APIを使い、入力した住所の航空写真とストリートビューをリアルタイム取得。計算されたタイミングで複数のChrome Windowsが自動開閉。MVが進むにつれて異なる形式のビジュアルが統合される。",
    evaluationImpact: "Cannes Cyber Grand Prix受賞。「Webサイト上で世界初のパーソナライズドMV」として歴史に刻まれた。Google Chromeの「これでしかできないこと」の実証事例として現在もWebデザイン教育で参照される。",
    relatedWorks: [
      { title: "The Weeknd「Alone With Me AI」(2020年）", description: "個人のSpotifyデータで体験をパーソナライズする同コンセプトの10年後の進化形。", url: "https://alonewithme.ai" },
      { title: "Bad Bunny「Tracking Bad Bunny」(2025年）", description: "Googleのインフラを音楽体験に転用する同発想の最新事例。", url: "https://www.youtube.com/watch?v=wTMC_zesAt4" },
      { title: "Bon Iver「Viisualiizer」(2019年）", description: "リアルタイムデータを視覚化する同思想の音楽Web体験。", url: "https://boniver.withspotify.com" }
    ]
  },
  {
    id: "honda-the-other-side",
    title: "THE OTHER SIDE（Honda Civic Type R）",
    summary: "「R」キーを押すだけで同じ映像の裏の世界に切り替わる——普通の父親の通勤シーンとアンダーグラウンドレーサーの物語が、同じ俳優・同じ場所で並行展開するデュアルナラティブ体験。",
    client: "Honda UK",
    agency: "Wieden+Kennedy London",
    categories: ["コンテンツ革新", "テクノロジー×アイデア", "ブランドエクスペリエンス"],
    award: "Cannes Lions Film Craft Grand Prix 2015 / D&AD Yellow Pencil / FWA",
    year: "2014",
    regions: ["欧州"],
    link: "https://www.youtube.com/watch?v=CUFhMT2vINY",
    thumbnail: "https://i.ytimg.com/vi/CUFhMT2vINY/hqdefault.jpg",
    videoId: "CUFhMT2vINY",
    overview: "Hondaのサイトで通常版Civic（家族向け）のCMが流れる。キーボードの「R」を押すと瞬時に同じシーン・同じ俳優でCivic Type R（スポーツ）バージョンに切り替わる。ストーリーが完全に反転（普通の父親 vs 夜の裏社会レーサー）しながら、同じロケーション・同じカット割りで展開。「R」を押し続ける間だけ「もう一つの世界」が見える。",
    background: "Honda Civic Type Rの新型モデルローンチに際し、「同じ車の表と裏」というコンセプトを映像表現に落とした。単一キー操作でパラレルワールドに移動するという体験設計は、当時のWeb技術の限界に挑戦した。",
    execution: "同一のシーンを2バージョンで撮影し、JavaScriptでキー入力を検知して動画ストリームをシームレス切り替え。両バージョンは完全に同期しており、どの時点でも「R」を押せば正確に対応するシーンに移行。",
    evaluationImpact: "Cannes Film Craft Grand Prix受賞。「インタラクションがナラティブの一部になる」Webビデオの最高峰として現在も参照される。TENET（2020年）の音声起動体験など後続の「映画×Webインタラクション」事例に影響。",
    relatedWorks: [
      { title: "TENET tenetfilm.com（2020年）", description: "映画のテーマをWebインタラクションに実装した直接的後継。Honda:「R」キー→TENET:「Tenet」音声入力。", url: "https://www.youtube.com/watch?v=LkjgzlZH8_E" },
      { title: "Volvo Trucks「The Epic Split」(2013年）", description: "同年代の革新的自動車ビデオコンテンツ。Honda Other Sideとともに「車のWebコンテンツ」の新基準を確立。", url: "https://www.youtube.com/watch?v=M7FIvfx5J10" },
      { title: "The Wilderness Downtown（2010年）", description: "ユーザーの入力でWebビデオ体験が変化するという同設計の先行事例。", url: "https://www.youtube.com/watch?v=Zo1FQJBzSxY" }
    ]
  },

  // ══ CREATIVE VISUAL WEB CASES ══
  {
    id: "bruno-simon-portfolio",
    title: "BRUNO SIMON PORTFOLIO（3Dゲーム型）",
    summary: "ポートフォリオ全体が俯瞰3Dゲーム世界——RCカーを矢印キーで操縦してプロジェクトゾーンに「到達」することがナビゲーションになる。Awwwards Site of the Year 2020受賞。",
    client: "Bruno Simon（個人）",
    agency: "Bruno Simon",
    categories: ["テクノロジー×アイデア", "コンテンツ革新", "ブランドエクスペリエンス"],
    award: "Awwwards Site of the Month 2019 / Site of the Year 2020 / FWA",
    year: "2019",
    regions: ["欧州"],
    link: "https://bruno-simon.com/",
    thumbnail: "https://picsum.photos/seed/bruno-simon-portfolio/1200/630",
    videoId: "",
    overview: "ポートフォリオ全体がThree.js + Cannon.js物理演算で構築された俯瞰3Dゲーム世界。ユーザーがRCカーを矢印キーで操縦し、地形内を移動してプロジェクトゾーンに「到達」することがナビゲーション。看板を倒したり木に衝突したりできる物理演算あり。通常のスクロールもクリックもない。",
    background: "WebGL/Three.jsを専門とするフリーランス開発者Bruno Simonが自身のスキルを「ポートフォリオの形式」で証明した。「ポートフォリオのUIを通じて開発者の技術力が分かる」という設計思想。",
    execution: "草（78,400本の1ポリゴン葉）の物理シミュレーション、カスタム車両シェーダー、Cannon.jsリアルタイム物理演算。プロジェクトゾーンに入るとカメラがオーバーヘッドドリー→スクロールでズームしてケーススタディを読む。",
    evaluationImpact: "Awwwards Site of the Year 2020受賞は「Webポートフォリオの概念を変えた」として評価。Three.js学習コースが50万人以上の受講者を集め、業界に最も影響を与えたWebGL開発者の一人に。",
    relatedWorks: [
      { title: "Radiohead「Kid A Mnesia Exhibition」(2021年）", description: "ゲームエンジン×アート体験の同系譜。Bruno Simonがポートフォリオでやったことをラジオヘッドがアルバムキャンペーンで実施。", url: "https://store.epicgames.com/p/kid-a-mnesia-exhibition" },
      { title: "Gorillaz「Kong Studios Revival」(2025年）", description: "ブラウザベースのWebGL空間探索というBruno Simonの設計を音楽キャンペーンに転用した事例。", url: "https://kongstudios.gorillaz.com" },
      { title: "Active Theory Portfolio（2024年）", description: "同じくWebGL 3D空間でポートフォリオを展開するインタラクティブ制作会社。", url: "https://activetheory.net" }
    ]
  },
  {
    id: "unseen-studio-infinite-canvas",
    title: "UNSEEN STUDIO 無限ドラッグキャンバス",
    summary: "ポートフォリオ全体が無限の2DXYキャンバス——ドラッグで自由にパン移動し、任意の方向に際限なく移動しながら作品を発見する「ページ」を持たないWebサイト。",
    client: "Unseen Studio",
    agency: "Unseen Studio",
    categories: ["テクノロジー×アイデア", "コンテンツ革新"],
    award: "Awwwards SOTD / Site of the Month February 2023",
    year: "2023",
    regions: ["グローバル"],
    link: "https://unseen.studio/",
    thumbnail: "https://picsum.photos/seed/unseen-studio-canvas/1200/630",
    videoId: "",
    overview: "Unseen Studio（ウェリントン/NZ）の公式サイト「World Page」は、全ポートフォリオが無限の2DXYキャンバス上に散在。ドラッグで自由にパン移動し、任意の方向に際限なく移動できる。従来の「ページ」という概念がなく、作品は「発見するもの」として配置されている。",
    background: "従来のポートフォリオサイトが「スクロールして全作品を見る」設計であるのに対し、Unseen Studioは「自分で探し回る」体験を設計した。「ポートフォリオの構造をなくす」という逆転発想。",
    execution: "仮想XY座標系で任意方向への無制限移動を実装。作品は意図的に「疎ら」に配置され、移動して近づくことで徐々に詳細が見えてくる。バーチャル座標マネジメントで数千点の作品を管理。",
    evaluationImpact: "Awwwards Site of the Month受賞。「ポートフォリオの閲覧体験を遊びに変える」設計として業界で参照される。",
    relatedWorks: [
      { title: "Bruno Simon Portfolio（2019年）", description: "同じく「空間を移動して作品を発見する」ポートフォリオの3D版。Unseenが2Dキャンバス、Brunoが3D世界という対比。", url: "https://bruno-simon.com/" },
      { title: "Heliotropy / Studio CRONICA（2023年）", description: "自由ドラッグ型デスクトップキャンバスとして写真・メモ・動画を配置した同時期の類似設計。", url: "https://heliotropy.com/" },
      { title: "Davide Baratta Portfolio（2024年）", description: "空間的な2Dキャンバスで全プロジェクトを探索する同系譜の発展事例。", url: "https://davidebaratta.com/" }
    ]
  },
  {
    id: "aristide-benoist-portfolio",
    title: "ARISTIDE BENOIST PORTFOLIO（キーボード直接ジャンプ）",
    summary: "28プロジェクトをスクロールなしで展示——キーボードの数字キー1〜28で直接ジャンプ、各プロジェクトが独自の色システムとレイアウトを持つ「本を開くような」ポートフォリオ。",
    client: "Aristide Benoist（個人）",
    agency: "Aristide Benoist + Jon Way",
    categories: ["コンテンツ革新", "テクノロジー×アイデア"],
    award: "Awwwards Site of the Month 2021 / SOTD",
    year: "2021",
    regions: ["グローバル"],
    link: "https://aristidebenoist.com/",
    thumbnail: "https://picsum.photos/seed/aristide-benoist-portfolio/1200/630",
    videoId: "",
    overview: "28プロジェクトをスクロールなしで表示するポートフォリオ。サムネイルインデックスとキーボードの数字キー（1〜28）と矢印キーで直接ナビゲーション。各プロジェクトに固有のカラーシステムと固有のレイアウト構成。WebGLAPIでホームページ画像をレンダリング。",
    background: "フリーランス開発者Aristide Benoistが「28件の密度をどう優雅に処理するか」という問いへの回答として設計。「ページ遷移なし」「無限スクロールなし」という制約の中で情報の完全性と閲覧の快適さを両立。",
    execution: "各プロジェクトが完全に独立した視覚言語（色・タイポグラフィ変形・レイアウト）を持つ。キーボードで直接プロジェクト番号を入力すると即座にジャンプ。Art DirectionはJon Wayが担当。",
    evaluationImpact: "「28件の作品を迷わず見させる設計」の解決策として評価。Awwwards Site of the Month受賞。",
    relatedWorks: [
      { title: "Bruno Simon Portfolio（2019年）", description: "同じく「通常のスクロール/クリックではない」ポートフォリオナビゲーションの先行事例。", url: "https://bruno-simon.com/" },
      { title: "Unseen Studio（2023年）", description: "「ページ」を持たないポートフォリオの無限キャンバス版。", url: "https://unseen.studio/" },
      { title: "G. Colombel Portfolio（2024年）", description: "ドラッグ変形カルーセルという物理的インタラクションを持つポートフォリオ。", url: "https://gcolombel.com/" }
    ]
  },
  {
    id: "jam3-fwa100-webgl",
    title: "JAM3 FWA 100 WebGL体験",
    summary: "FWA100勝を3幕構成WebGL体験に——過去（岩石を描くと砕ける）・現在（球体を弾き飛ばせる）・未来（粒子の渦を飛行）という独立した物理演算で100回受賞を祝う没入型サイト。",
    client: "Jam3（自社）",
    agency: "Jam3",
    categories: ["テクノロジー×アイデア", "コンテンツ革新", "空間体験"],
    award: "Awwwards SOTD（7.92/10）/ CSS Design Awards Website of the Month",
    year: "2022",
    regions: ["北米"],
    link: "https://fwa100.jam3.com/",
    thumbnail: "https://picsum.photos/seed/jam3-fwa100/1200/630",
    videoId: "",
    overview: "インタラクティブ制作会社Jam3のFWA100受賞記念サイト。3幕構成：「過去」は変形する岩石（描くと砕ける物理演算）、「現在」はスプリングジョイントで繋がる球体群（触れるとはじき飛ぶ）、「未来」はFWA100ロゴ形状の粒子群の中を飛行。画像ギャラリーではなく「触れるアート」として100の受賞を体験させる。",
    background: "制作会社のマイルストーン祝賀に「100点の受賞作一覧を見せる」という正直なアプローチではなく「100という数字を触覚的な体験に変換する」アプローチを選択。3幕のそれぞれが異なるインタラクション比喩（描く・投げる・飛ぶ）で「過去・現在・未来」を体現。",
    execution: "Three.js + カスタムWebGLシェーダー（ガウスぼかし・被写界深度）で構築。カスタム最適化されたシェーダーにより高品質な映像処理を性能を犠牲にせず実現。",
    evaluationImpact: "Awwwards Creativity 8.52/10という高スコア受賞。「受賞を祝うサイト自体が新たな受賞作になる」という再帰的な設計として評価。",
    relatedWorks: [
      { title: "Bruno Simon Portfolio（2019年）", description: "物理演算をWebGL体験の核にする同思想。Jam3が組織の記念に使ったのに対しBrunoは個人ポートフォリオに使った。", url: "https://bruno-simon.com/" },
      { title: "Beck「Hyperspace」AI探索（2020年）", description: "GAN生成ビジュアルと音楽を統合したブラウザWebGL体験の同系譜。", url: "https://hyperspace.beck.com" },
      { title: "Refik Anadol「Unsupervised」MoMA（2022年）", description: "データをGANで可視化するリアルタイムインスタレーションとWebGL体験の親戚事例。", url: "https://www.moma.org/calendar/exhibitions/5535" }
    ]
  },
  {
    id: "obys-agency-website",
    title: "OBYS AGENCY ポートフォリオサイト",
    summary: "シネマティックスクロールとカバー切り替えアニメーション——作品集を「映画のオープニングシーケンス」として体験させる。Awwwards SOTD受賞の常連クリエイティブスタジオ。",
    client: "Obys Agency（自社）",
    agency: "Obys Agency",
    categories: ["コンテンツ革新", "テクノロジー×アイデア"],
    award: "Awwwards SOTD 複数回受賞",
    year: "2022",
    regions: ["欧州"],
    link: "https://obys.agency/",
    thumbnail: "https://picsum.photos/seed/obys-agency-website/1200/630",
    videoId: "",
    overview: "ウクライナ/アムステルダムのクリエイティブスタジオObys Agencyのポートフォリオサイト。カバー画像の切り替えに独自のアニメーションを適用したシネマティックスクロール体験。作品集が映画のオープニングシーケンスのように展開する。「Grids」という教育プロジェクト（グリッドシステムをインタラクティブに学べるサイト）も制作。",
    background: "デザイン×フロントエンド×モーションの統合を自社サイトで体現する姿勢で業界に認知されたスタジオ。「ポートフォリオサイトがそのまま制作物のショーケース」という設計。",
    execution: "GSAPをベースにしたスクロール連動アニメーション。カバー画像の切り替えに独自のイージングと変形を適用。タイポグラフィのモーション設計が特徴的。",
    evaluationImpact: "Awwwards SOTD複数回受賞で「Awwwardsらしいスタジオ」として認知。grids.obys.agencyは「グリッドシステムを楽しく学べる」教材として5万人以上が参照。",
    relatedWorks: [
      { title: "Aristide Benoist Portfolio（2021年）", description: "ポートフォリオサイトのナビゲーション革新の同時期事例。タイポグラフィへのこだわりが共鳴する。", url: "https://aristidebenoist.com/" },
      { title: "Quechua 2025 Lookbook", description: "スクロール連動の透視投影ギャラリーという同カテゴリの最新事例。", url: "https://www.quechua.fr/" },
      { title: "Bruno Simon Portfolio（2019年）", description: "ポートフォリオ体験の再発明という同設計思想。", url: "https://bruno-simon.com/" }
    ]
  },
];

const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
const existingIds = new Set(cases.map(c => c.id));
const toAdd = newCases.filter(c => !existingIds.has(c.id));
const updated = [...toAdd, ...cases];
await fs.writeFile(CASES_PATH, JSON.stringify(updated, null, 2));
console.log(`追加: ${toAdd.length}件 / 合計: ${updated.length}件`);
toAdd.forEach(c => console.log(`  + ${c.id} (${c.year})`));
