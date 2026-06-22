import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");

const newCases = [
  {
    id: "bon-iver-fable-spaces",
    title: "fABLE sPACEs（Bon Iver）",
    summary: "世界100カ所のジオフェンスに実際に行かないと聴けない——アルバム「SABLE, fABLE」の発売2日前、GPS位置情報が解禁の鍵になったロケーション連動体験。",
    client: "Bon Iver",
    agency: "（自社企画）",
    categories: ["ブランドエクスペリエンス", "テクノロジー×アイデア", "メディア発明"],
    award: "（受賞情報なし）",
    year: "2025",
    regions: ["グローバル"],
    link: "https://fablespaces.boniver.org",
    thumbnail: "https://i.ytimg.com/vi/lmdZx93BVds/hqdefault.jpg",
    videoId: "lmdZx93BVds",
    overview: "2025年4月、Bon IverのアルバムSABLE, fABLE発売2日前に世界100カ所以上の公園・広場にジオフェンスを設定。専用サイトfablespaces.boniver.orgにアクセスし、指定地点（現地時間16〜19時）にGPSを持って移動するとアルバムフル再生が解禁された。同じ公園で同じことをしているファンと出会う体験が生まれ、リスニングを個人的な儀式から集合的な出来事に変換した。",
    background: "「音楽を場所と時間に結びつける」というコンセプトで設計された。配信解禁が当たり前の時代に、物理的な移動という摩擦を意図的に設けることでリスニング体験を特別な儀式に変換。ファンが指定地点に向かいSNSに投稿することで、有機的な話題拡散と一体感を同時に生み出した。",
    execution: "fablespaces.boniver.orgを構築し、世界100カ所以上にジオフェンスを設定。ブラウザのGeolocation APIでユーザーのGPSを検出し、該当エリア内でかつ指定時間帯（現地時間16〜19時）の場合のみアルバムのフル試聴が解禁される仕組み。参加者は#fABLEsPACEsのハッシュタグで体験をシェアし、世界各地でファンが「聖地」に集まる様子がSNSで可視化された。",
    evaluationImpact: "「行かなければ聴けない」という制約が逆説的にファンの没入感と特別感を高めた。ストリーミング時代における音楽体験の再発明として音楽業界・マーケティング業界双方で注目を集めた。日本語圏でも「聖地巡礼」文化との親和性が指摘された。",
    relatedWorks: [
      { title: "Bad Bunny「Tracking Bad Bunny」(2025年）", description: "Google Mapsを使ったアルバムトラックリスト宝探し。GPS/マップ×音楽プロモーションのもう一つの代表的形態。", url: "https://www.youtube.com/watch?v=wTMC_zesAt4" },
      { title: "Palau Pledge（2017年）", description: "観光客が現地に行くことで体験が成立する制度設計。「場所に行く」行為そのものをコミュニケーションの核にする思想的先例。", url: "https://www.palaupledge.com/" },
      { title: "Gorillaz AR「Skinny Ape」(2022年）", description: "都市空間のARを使った音楽体験。物理空間と音楽を接続するアプローチとして共鳴。", url: "https://www.youtube.com/watch?v=iFaKhtlBU7A" }
    ]
  },
  {
    id: "underscores-wallsocket-arg",
    title: "WALLSOCKET ARG（underscores）",
    summary: "架空の町「Wallsocket, Michigan」を6つの独立したウェブサイトで構築——架空の自治体・ピザ屋・コミュニティ掲示板が「本物」として機能し、アルバムの世界観をリアルな町として体験させた。",
    client: "underscores（Mom + Pop Music）",
    agency: "（自主制作）",
    categories: ["メディア発明", "コンテンツ革新", "ブランドエクスペリエンス"],
    award: "（受賞情報なし）",
    year: "2023",
    regions: ["北米"],
    link: "https://wallsocketgov.com",
    thumbnail: "https://i.ytimg.com/vi/k6Z0Khe69WY/hqdefault.jpg",
    videoId: "k6Z0Khe69WY",
    overview: "2023年、undrescoresのアルバム「Wallsocket」のプロモーションとして架空の町Wallsocket, Michiganを構成する6つのウェブサイト群を構築。wallsocketgov.com（町の公式自治体サイト）、momsofwallsocket.com（住民コミュニティフォーラム）、wallsocketpizza.com（地元ピザ屋）、secretariat.tech（謎のテック企業）など、それぞれが独立して機能するサイトに架空の銀行強盗事件・市職員横領・テック企業によるジェントリフィケーションなどのナラティブが展開された。",
    background: "undrescoresは架空の場所を舞台にしたコンセプトアルバム「Wallsocket」のために、その世界観をリアルに体験させる手段として複数の架空サイト群を構築した。専用URLや特設ページではなく、「本当に存在する町」のように見せることで、ファンが住民として謎を追いかけるARG体験を作り上げた。",
    execution: "wallsocketgov.comは本物の自治体サイトを模したデザインで町の歴史・駐車違反罰金・タウンホール議事録を掲載。momsofwallsocket.comはWordPressベースのコミュニティフォーラムで架空住民が噂や事件について議論。各サイトに「不審な路上ミュージシャン（underscores）」への言及が含まれ、ファンが手がかりを集め集合知で物語を解読する設計。",
    evaluationImpact: "Reddit、Discord、Twitterでファンがコミュニティを形成して謎解きを進めた。アルバムの世界観を「読み物」ではなく「住む・体験する場所」として提供したことで深いエンゲージメントを生み出した。低予算ながら6サイトを構築するというアプローチが音楽マーケティング界隈で話題になった。",
    relatedWorks: [
      { title: "Arcade Fire「Everything Now Corp」(2017年）", description: "架空のコンテンツマーケティング会社と偽メディアを作った同コンセプトの先行事例。架空組織でアルバムをリリースする手法の原型。", url: "https://en.wikipedia.org/wiki/Arcade_Fire" },
      { title: "Project:;COLD（2021年）", description: "SNS上で展開される日本発のARGミステリー。架空の世界をSNSとWebで構築する手法の国内版として比較可能。", url: "https://www.project-cold.net/" },
      { title: "米津玄師「感電 STRAY SHEEP CODE」(2020年）", description: "既存プラットフォームを謎解きの舞台にした点で共鳴。Wallsocketが複数サイトを作るのに対し、こちらはYouTubeチャンネル自体を壊す設計。", url: "https://www.youtube.com/watch?v=UFQEttrn6CQ" }
    ]
  },
  {
    id: "muse-will-of-people-3d",
    title: "WILL OF THE PEOPLE インタラクティブ3Dサイト（Muse）",
    summary: "ブラウザで開くとディストピアな3D世界が起動し、ストリーミングサービスに接続するとアルバムがBGMとして流れ続ける中を探索——WebGLと音楽ストリーミングを統合した没入体験。",
    client: "Muse（Warner Records）",
    agency: "Wayward Creative",
    categories: ["空間体験", "テクノロジー×アイデア", "ブランドエクスペリエンス"],
    award: "（受賞情報なし）",
    year: "2022",
    regions: ["グローバル"],
    link: "https://willofthepeople.muse.mu",
    thumbnail: "https://i.ytimg.com/vi/MClg7zpm6VQ/hqdefault.jpg",
    videoId: "MClg7zpm6VQ",
    overview: "Museの第9作アルバム「Will of the People」（2022年8月）のプロモーション用インタラクティブ3Dウェブ体験。willofthepeople.muse.muにアクセスすると権威主義的ディストピアをテーマにした3D空間が起動。Spotify・Apple Music・TIDALアカウントでログインするとアルバムがBGMとして常時再生される中、空間内に配置されたアルバムアートワークの巨大マスクをポータルとしてMV・グッズ・ツアー・イースターエッグなどへアクセスできる。",
    background: "「権威と反乱」をテーマにしたアルバムの世界観を体験型ウェブで表現するためにWayward Creativeが制作。アルバムそのものを「入れる箱」として3D空間を設計し、ストリーミングサービスを直接統合することでサイト訪問とアルバム試聴を同時体験させる構造を構築した。",
    execution: "WebGLベースの3D空間をブラウザで構築。Spotify / Apple Music / TIDAL OAuth連携でログイン後、アルバムがバックグラウンドBGMとして再生開始。空間内のWOTPマスク（アルバムのシンボル）にアプローチするとコンテンツポータルが起動。自由に歩き回りながら探索できる非線形設計で、隠しイースターエッグも複数配置。",
    evaluationImpact: "「アルバムをウェブサイトとして体験する」という形式の洗練された実装として業界で評価された。ストリーミングAPIとWebGLの統合という技術的アプローチが後続のインタラクティブ音楽体験の参照事例となった。アルバム発売後も長期間アクセス可能な体験として機能した。",
    relatedWorks: [
      { title: "Radiohead「Kid A Mnesia Exhibition」(2021年）", description: "アルバム世界観を3D空間として無料配布した先行事例。Museとは異なりダウンロード型だが「アルバムを空間で体験する」という同じ発想。", url: "https://store.epicgames.com/p/kid-a-mnesia-exhibition" },
      { title: "Beck「Hyperspace: A.I. Exploration」(2020年）", description: "アルバム曲をNASAミッションにマッピングした没入型ブラウザ体験。ジェネラティブビジュアルとアルバムを結びつけた同時期の類似事例。", url: "https://www.youtube.com/watch?v=ADrC9dLjHaE" },
      { title: "FKA twigs「EUSEXUA」(2024年）", description: "最小限の入力で最大の神秘性を演出した招待制サイト。Museの没入型3Dとは対照的に「シンプルさ」による排他設計。", url: "https://eusexua.fkatwi.gs" }
    ]
  },
  {
    id: "taylor-swift-ttpd-qr-murals",
    title: "THE TORTURED POETS DEPARTMENT QRウォールアート（Taylor Swift）",
    summary: "世界9都市のビル壁面にQRコードのウォールアートが出現——スキャンすると各都市が1文字を持ち、全都市の文字を集めるとアルバムへのメッセージが完成するダイナミックQR型集合謎解き。",
    client: "Taylor Swift（Republic Records）",
    agency: "Taylor Swift Productions",
    categories: ["メディア発明", "カルチャーインサイト", "OOH革新"],
    award: "（受賞情報なし）",
    year: "2024",
    regions: ["グローバル"],
    link: "https://www.taylorswift.com/",
    thumbnail: "https://picsum.photos/seed/taylor-swift-ttpd/1200/630",
    videoId: "",
    overview: "2024年4月、アルバム「The Tortured Poets Department」発売（4月19日）の数日前にシカゴ・シドニー・パリ・NY・ナッシュビル等9都市のビル壁面に巨大QRコードのウォールアートが出現。QRコード自体のデザインが「TTPD」と「13」（ラッキーナンバー）の文字で構成。スキャンすると初日は「Error 321」と打ち込むタイプライター映像（YouTube Unlisted Shorts）が再生され、翌日以降は都市ごとに異なる1文字を表示する映像に更新された。",
    background: "ダイナミックQRコード（後から指すURLを変更できる）を使い、1回のQRコード設置で複数の情報を段階的に出すという設計。ファンが世界各地でQRをスキャンしSNSで文字を共有 → 集合知でメッセージを解読するという参加型構造。「アルバム情報をファンが能動的に発見する」という発表の仕方の革新。",
    execution: "各都市の壁面にQRコード（TTPD文字パターンデザイン）を掲出。ダイナミックQRコードサービスを使い、初日はYouTube Unlisted Shortsの「Error 321」映像にリダイレクト。翌日以降、都市ごとに1文字（例：「T」「H」「E」）を表示する映像に切り替え。ファンがSNSで「自分の都市の文字」をシェア → 9文字が揃うと「THE TORTURED POETS DEPARTMENT」が完成。",
    evaluationImpact: "ファンコミュニティが自発的に情報収集・共有・解読するというメカニズムが数日間にわたるSNSエンゲージメントを生み出した。ダイナミックQRコードという低コストな技術で世界的な謎解き体験を設計した事例として、デジタルマーケティング業界で参照される。アルバム発売後も「あのQRの意味は何だったか」という考察が続いた。",
    relatedWorks: [
      { title: "Taylor Swift「1989 Vault Puzzle」(2023年）", description: "同アーティストによる前作のグローバル集合解禁キャンペーン。カウンター型と文字収集型という異なるアプローチの比較として参照できる。", url: "https://en.wikipedia.org/wiki/1989_(Taylor%27s_Version)" },
      { title: "Bad Bunny「Tracking Bad Bunny」(2025年）", description: "実際の街角にアルバム情報を隠しファンが現地調査するキャンペーン。TTPD QRとBad BunnyはOOH×デジタル×ファン参加という同じ設計思想。", url: "https://www.youtube.com/watch?v=wTMC_zesAt4" },
      { title: "Twenty One Pilots「Dmaorg.info ARG」(2018〜2022年）", description: "Spotify CanvasにQR/座標を仕込みファンが解読する同形式の先行事例。ストリーミングプラットフォーム起点の情報解禁という構造が共鳴する。", url: "https://en.wikipedia.org/wiki/Twenty_One_Pilots" }
    ]
  },
  {
    id: "gorillaz-kong-studios-revival",
    title: "KONG STUDIOS REVIVAL（Gorillaz）",
    summary: "17年ぶりに架空スタジオを復活——Gorillazの仮想本拠地「Kong Studios」が2025年に再開し、新アルバムの月次シングル公開に合わせて毎月新しい部屋が解禁されるプログレッシブアンロック型体験。",
    client: "Gorillaz（Demon Music Group）",
    agency: "Observer Interactive",
    categories: ["空間体験", "ブランドエクスペリエンス", "メディア発明"],
    award: "（受賞情報なし）",
    year: "2025",
    regions: ["グローバル"],
    link: "https://kongstudios.gorillaz.com",
    thumbnail: "https://picsum.photos/seed/gorillaz-kong-studios/1200/630",
    videoId: "",
    overview: "Gorillaz結成25周年（2025年）を記念し、2008年に閉鎖した架空本拠地「Kong Studios」を17年ぶりにブラウザ上で復活。Observer Interactiveが制作。Doomライクな一人称視点ゾンビシューターを入口として設け、無料会員証「Kong Card」取得で建物内部を探索できる。アルバム「The Mountain」（2026年）の月次シングルリリースに合わせて毎月新しい部屋が解放されるプログレッシブアンロック方式を採用。",
    background: "Gorillazは2001年から架空キャラクターが「実在する」ように運営されてきたバーチャルバンドとして独自の世界観を持つ。2008年版の閉鎖後17年間ファンが「Kong Studiosの再開」を望み続けており、25周年という節目でその期待に応えた。架空空間の「復元・再開」という設計は既存ファンベースへの強力なノスタルジア喚起として機能。",
    execution: "ブラウザ上のWebGL空間としてKong Studiosビルを高解像度再現。入口のゾンビシューターはオプション。無料アカウント「Kong Card」登録で上階へアクセス可能。Jamie Hewlett直筆アートで生成するパーソナライズアバター、新曲早期アクセス、チケット先行などの特典を付与。新アルバムの月次シングルリリースに合わせ新部屋を定期解放するため、ファンがサイトに繰り返し戻る動機を作り続けた。",
    evaluationImpact: "「ファンが長年待ち望んだものを復活させる」というアプローチが熱狂的な反響を生んだ。月次更新型の設計により、1回限りの体験ではなく「継続的に戻ってきたいサイト」として機能。アーティストの世界観とファンのエンゲージメントを長期間維持するモデルケースとして評価される。",
    relatedWorks: [
      { title: "Gorillaz「Song Machine」(2020年）", description: "同アーティストによる前作の週次エピソード公開方式。Kong Studiosの月次部屋解放はSong Machineの「継続的発見」設計の進化版。", url: "https://www.gorillaz.com/" },
      { title: "Gorillaz AR「Skinny Ape」(2022年）", description: "都市空間にARキャラクターを出現させた同アーティストの先行インタラクティブ施策。Gorillazのデジタル体験の系譜として参照。", url: "https://www.youtube.com/watch?v=iFaKhtlBU7A" },
      { title: "Radiohead「Kid A Mnesia Exhibition」(2021年）", description: "アルバム世界観を3D空間として提供した最良の比較事例。Gorillaz Kong Studiosとはアーカイブ復元 vs. 新作連動という方向性の違いがある。", url: "https://store.epicgames.com/p/kid-a-mnesia-exhibition" }
    ]
  },
  {
    id: "kamitsubaki-emergence",
    title: "神椿市建設中。 EMERGENCE（KAMITSUBAKI STUDIO）",
    summary: "2万人超のファンが4チームに分かれてARGに参加——毎日出現する謎を集合知で解き、正解するとチームに楽曲・ビジュアル・ロアテキストが報酬として解放される国内発の参加型アルバム体験。",
    client: "KAMITSUBAKI STUDIO / V.W.P",
    agency: "（自社制作）",
    categories: ["ブランドエクスペリエンス", "メディア発明", "コンテンツ革新"],
    award: "（受賞情報なし）",
    year: "2021",
    regions: ["国内"],
    link: "https://uc.kamitsubaki.jp",
    thumbnail: "https://i.ytimg.com/vi/V73x8YYtanc/hqdefault.jpg",
    videoId: "V73x8YYtanc",
    overview: "KAMITSUBAKI STUDIOのバーチャルアーティスト集団V.W.Pのデビューキャンペーン。公式Twitter・LINEで登録すると4チームのいずれかにランダム振り分け。毎日決まった時刻にマップ上の拠点に謎が出現し、テキスト回答またはGPS送信で解く。正解するとチーム全員にキャラクターイラスト・ロアテキスト・未発表楽曲サンプルが支給。10月の期間中に約2万人が参加し、新エリアが段階的に追加解放され続けた。",
    background: "VTuber・バーチャルアーティスト文化が根付く日本語圏で、「ファン全員が世界観の共同制作者になる」というフレームを採用。楽曲・ビジュアル・キャラクターを「謎解きの報酬」として設計することで情報解禁自体をエンターテインメント化した。Discordを情報共有の場として活用することでコミュニティの自律的な発展を促した。",
    execution: "uc.kamitsubaki.jpを構築し、マップ上に謎の拠点を設置。Twitterログイン連携で参加登録・チーム振り分けを自動化。毎日新しい謎がマップに出現し、正解後にチーム全員へのコンテンツ配布を自動実施。Discordサーバーでファンが自発的に情報交換・考察コミュニティを形成。キャンペーン期間中2万人超が参加し、特定イベント時には同時接続数がサーバーを圧迫するほどのアクセスが発生。",
    evaluationImpact: "「ファンが能動的に世界観を構築する」参加体験として国内VTuber・バーチャルアーティスト界隈で高い評価を得た。2万人規模の参加者がリアルタイムで集合知を駆使して謎を解くという大規模ARGの日本語圏成功事例。その後のKAMITSUBAKI STUDIO関連コンテンツのマーケティングのロールモデルとなった。",
    relatedWorks: [
      { title: "Project:;COLD（2021年）", description: "同年に展開されたSNS型ARGの日本代表事例。神椿市が音楽×キャラクター解放に焦点を当てるのに対し、Project:;COLDはミステリーナラティブが中心。", url: "https://www.project-cold.net/" },
      { title: "Taylor Swift「1989 Vault Puzzle」(2023年）", description: "全世界ファンの集合参加でコンテンツを解禁する同じ構造の国際版事例。規模は異なるが設計思想が同一。", url: "https://en.wikipedia.org/wiki/1989_(Taylor%27s_Version)" },
      { title: "KAMITSUBAKI STUDIO V.W.P公式", description: "このキャンペーンを展開したアーティスト集団の公式チャンネル。EMERGENCEの後続のコンテンツ展開を確認できる。", url: "https://www.youtube.com/@VWP_official" }
    ]
  }
];

const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
const existingIds = new Set(cases.map(c => c.id));
const toAdd = newCases.filter(c => !existingIds.has(c.id));
const updated = [...toAdd, ...cases];
await fs.writeFile(CASES_PATH, JSON.stringify(updated, null, 2));
console.log(`追加: ${toAdd.length}件 / 合計: ${updated.length}件`);
