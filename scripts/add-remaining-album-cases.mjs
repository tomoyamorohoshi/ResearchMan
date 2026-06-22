import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");

const newCases = [
  {
    id: "the-cure-songs-of-lost-world",
    title: "SONGS OF A LOST WORLD WhatsApp ARG（The Cure）",
    summary: "黒い郵便物 → UV照射 → Webサイト → WhatsApp → スキャベンジャーハントの多段構成——物理とデジタルを7段階でつなぐThe Cureのアルバム解禁ARG。",
    client: "The Cure（Fiction Records）",
    agency: "（制作元詳細不明）",
    categories: ["メディア発明", "ブランドエクスペリエンス"],
    award: "（受賞情報なし）",
    year: "2024",
    regions: ["欧州", "グローバル"],
    link: "https://songsofalost.world",
    thumbnail: "https://picsum.photos/seed/the-cure-songs-of-lost-world/1200/630",
    videoId: "",
    overview: "2024年アルバム発売前、選ばれたファンへ黒い無地の郵便物が届く。UV灯を当てるとローマ数字「I/XI/MMXXIV」が出現。songsofalost.worldにアクセスして日付を入力すると3Dアルバムアートが回転しパスワード入力画面が現れる。正解するとWhatsAppチャンネルへの招待が届き、「YES」と返信するとスキャベンジャーハントが始まる。登録者には断片的な楽曲スニペットと暗号詩が継続配信された。",
    background: "物理×デジタルの多段階体験でアルバム発売を「事件」として演出。ハイテクに見えるが各要素の技術コストは低い設計。「WhatsApp → LINE」に読み替えれば日本語圏で即機能するモデル。",
    execution: "UV暗号カード（郵送）→ 日付入力Webサイト → 3D回転アートワーク → パスワード認証 → WhatsAppチャンネル招待 → スキャベンジャーハント → 楽曲スニペット・暗号詩の継続配信という7段階の体験設計。各ステップが前の謎の解答を次の入口にするチェーン構造。",
    evaluationImpact: "「選ばれた感」と多段階の達成感が熱量の高いファンを強く引きつけた。LINEを使えばそのまま日本語圏に転用可能な設計として業界で参照される。",
    relatedWorks: [
      { title: "underscores「Wallsocket ARG」(2023年）", description: "複数サイトで架空の町を構築したARG。物理カード→Webと類似した多段エンゲージメント設計。", url: "https://wallsocketgov.com" },
      { title: "Bad Bunny「Tracking Bad Bunny」(2025年）", description: "既存プラットフォーム（Google Maps）を謎解きの舞台にした同世代のARG事例。", url: "https://www.youtube.com/watch?v=wTMC_zesAt4" },
      { title: "KAMITSUBAKI「EMERGENCE」(2021年）", description: "LINE×謎解き×楽曲解放という日本版の近似事例。", url: "https://uc.kamitsubaki.jp" }
    ]
  },
  {
    id: "weeknd-alone-with-me-ai",
    title: "ALONE WITH ME AI体験（The Weeknd × Spotify）",
    summary: "Spotifyログインするとあなたの視聴データを使ってThe WeekndのAIが名前で話しかけてくる——個人の聴き方を知るサイトという究極のパーソナライズ体験。",
    client: "The Weeknd（Republic Records）/ Spotify",
    agency: "Interlude（AI/tech）",
    categories: ["AIクリエイティブ", "ブランドエクスペリエンス", "データクリエイティブ"],
    award: "Cannes Lions / Webby Awards",
    year: "2020",
    regions: ["グローバル"],
    link: "https://alonewithme.ai",
    thumbnail: "https://picsum.photos/seed/weeknd-alone-with-me-ai/1200/630",
    videoId: "",
    overview: "AloneWithMe.aiにSpotifyアカウントでログインするとThe WeekndのAI3D映像が出現し、個人の視聴データ（初めて聴いた曲・最多再生曲・聴き始めた年）を織り交ぜて名前で話しかけてくる体験。3曲をパーソナライズされた文脈で視聴できる。公開後48時間で60万アクセスを記録した。",
    background: "「サイトがあなたを知っている」という驚きを核にしたパーソナライズ体験。After Hoursアルバムキャンペーンの一環として制作。Spotify APIのリスニングデータを活用し、ファンごとに異なるナラティブを自動生成するシステムを構築した。",
    execution: "Spotify OAuth連携でユーザー認証。個人のリスニング履歴をリアルタイム取得し、AIがパーソナライズされたスクリプトを生成してThe Weekndの3D映像と組み合わせて配信。48時間で60万アクセスという実績を残し、音楽×AI×ストリーミングデータの三位一体を実証した。",
    evaluationImpact: "Cannes LionsとWebby Awardsを受賞。「サイトが訪問者を個別に認識する」体験の先駆的商業実装として、その後の音楽×AIパーソナライズキャンペーンの原型となった。LINE MusicやApple MusicのAPIで同様の体験をJ-POPに転用できる。",
    relatedWorks: [
      { title: "Bon Iver「Viisualiizer」(2019年）", description: "リアルタイムリスナーデータを視覚化した同時期の事例。データを「体験の素材」にする発想が共鳴。", url: "https://boniver.withspotify.com" },
      { title: "NewJeans「Phoning」(2023年）", description: "メンバーが直接通話するような親密設計のファンプラットフォーム。「アーティストとの個別接続」という同じ感情設計。", url: "https://www.youtube.com/watch?v=sLk2ZOj7vI0" },
      { title: "Spotify Wrapped（2017年〜）", description: "個人データをアイデンティティとして可視化する設計の先例。Alone With Me AIと同じ「私の聴き方を知っている」という驚きの設計。", url: "https://www.spotify.com/wrapped/" }
    ]
  },
  {
    id: "bon-iver-viisualiizer",
    title: "VIISUALIIZER（Bon Iver × Spotify）",
    summary: "今この瞬間アルバムを聴いているファンたちの光点が地球上にリアルタイム表示される——累計再生時間・最もアクティブな国がライブカウンターで更新され続ける集合的リスニング体験。",
    client: "Bon Iver / Spotify",
    agency: "Active Theory",
    categories: ["データクリエイティブ", "テクノロジー×アイデア", "ブランドエクスペリエンス"],
    award: "Webby Award / FWA",
    year: "2019",
    regions: ["グローバル"],
    link: "https://boniver.withspotify.com",
    thumbnail: "https://picsum.photos/seed/bon-iver-viisualiizer/1200/630",
    videoId: "",
    overview: "boniver.withspotify.comにアクセスすると、無数の光点（各点がリアルタイムリスナー）が画面を埋める。マウスを動かすと光点が波紋のように動き、歌詞の断片やアートワークが浮かび上がる。累計再生時間・最もアクティブな国のライブカウンターが表示され、タイポグラフィがリスニング密度に同期して脈打つ体験。",
    background: "Bon Iverのアルバム「i,i」のSpotifyコラボレーションとして制作。「今この瞬間、自分以外にも同じ音楽を聴いている人がいる」という事実を視覚化することで孤独な聴取体験をグローバルな共同体験に変換した。Active Theory制作。",
    execution: "Spotify APIでリアルタイムのグローバルリスナーデータを取得。各リスナーを光点として地球上に配置し、データ密度に応じてタイポグラフィと視覚エフェクトが変化するWebGLベースの体験を構築。マウスインタラクションで歌詞断片とアートワークが出現する設計。",
    evaluationImpact: "「リアルタイムの集合的リスニング」を視覚化した先駆的Webサイト。日本のリスナー集中度を活かし、日本地図上で都道府県ごとにリアルタイム再生が光る演出はJ-POPキャンペーンで強力に機能する可能性を持つ。",
    relatedWorks: [
      { title: "The Weeknd「Alone With Me AI」(2020年）", description: "同じくSpotifyリスニングデータを活用した個別体験。Viisualiizer（集合可視化）とAlone With Me（個別認識）は対になる設計。", url: "https://alonewithme.ai" },
      { title: "Spotify Wrapped（2017年〜）", description: "個人データを可視化する設計の最大規模事例。Viisualiizer はWrappedのリアルタイム集合版として位置づけられる。", url: "https://www.spotify.com/wrapped/" },
      { title: "Gorillaz「Song Machine」ストリーミングヒートマップ", description: "Gorillazファンのリスニングデータをヒートマップとして可視化した関連事例。", url: "https://www.gorillaz.com/" }
    ]
  },
  {
    id: "tycho-forecast-weather",
    title: "FORECAST — 天気連動プレイリスト（Tycho）",
    summary: "現在地の天気を検出して「今日のための音楽」を自動生成——晴れ・雨・雪・風で毎回異なるTychoのプレイリストが即座に作られ、Spotifyへ保存できる。",
    client: "Tycho（Scott Hansen）",
    agency: "（自主制作）",
    categories: ["データクリエイティブ", "テクノロジー×アイデア", "ブランドエクスペリエンス"],
    award: "Google Experiments掲載",
    year: "2019",
    regions: ["グローバル"],
    link: "https://weather.tychomusic.com",
    thumbnail: "https://picsum.photos/seed/tycho-forecast-weather/1200/630",
    videoId: "",
    overview: "weather.tychomusic.comにアクセスすると現在地を自動検出し、晴れ・雨・曇り・雪・風などの天気状態に対応するTychoの楽曲セットが即座に生成される。異なる日・異なる都市で訪問すると毎回異なるプレイリスト。ワンクリックでSpotify / Apple Musicに保存できる。",
    background: "Scott Hansen（Tycho）が「天気と音楽の感情的な対応関係」を実験的に実装したプロジェクト。音楽をシーン・感情・環境に対応させる「コンテキスト音楽」の発想をウェブ体験として具現化した。技術的にはシンプルなAPIの組み合わせで実現。",
    execution: "ブラウザのGeolocation APIで現在地取得 → Weather APIで天気状態取得 → 天気カテゴリ（晴れ/雨/雪/風等）に対応したTychoのプレイリストを返す → Spotify/Apple Music APIでプレイリスト保存。シンプルな実装で「毎回異なる体験」と「実用的な音楽発見」を両立。",
    evaluationImpact: "天気連動音楽体験の最もシンプルかつ完成度の高い実装として業界で参照される。アルバムの楽曲を「感情・天候・時刻」にマッピングすれば即座にJ-POPアルバムサイトに転用可能。技術的難易度が低く再現性が高い。",
    relatedWorks: [
      { title: "Massive Attack「Fantom」(2019年）", description: "天気の代わりに心拍・位置・動きで音楽を変化させる環境連動の進化版。", url: "https://www.massiveattack.co.uk/" },
      { title: "Bon Iver「fABLE sPACEs」(2025年）", description: "GPS位置情報で解禁が変わる同様の「環境と音楽の接続」設計の現代版。", url: "https://fablespaces.boniver.org" },
      { title: "Spotify Wrapped（2017年〜）", description: "データを「音楽の文脈情報」として活用する設計の同系譜。", url: "https://www.spotify.com/wrapped/" }
    ]
  },
  {
    id: "massive-attack-fantom",
    title: "FANTOM（Massive Attack）",
    summary: "iPhoneのセンサー（位置・動き・心拍）がリアルタイムで楽曲のアレンジを変える——同じ曲でも毎回異なるミックスが生成され、体験として音楽が変化する。",
    client: "Massive Attack",
    agency: "3rd Space Agency",
    categories: ["テクノロジー×アイデア", "AIクリエイティブ", "ブランドエクスペリエンス"],
    award: "Webby Award 2020",
    year: "2019",
    regions: ["グローバル"],
    link: "https://www.massiveattack.co.uk/",
    thumbnail: "https://picsum.photos/seed/massive-attack-fantom/1200/630",
    videoId: "",
    overview: "FridayというアプリをダウンロードするとMassive Attackの楽曲が現在地・体の動き・Apple Watch経由の心拍数を読み取りリアルタイムでアレンジを変化させる。落ち着いた心拍ではゆったりしたアンビエントアレンジに、高い心拍ではリズムが強調される。同じ楽曲でも毎回異なるミックスが生成され保存・シェア可能。Mezzanine 20周年記念版（Fantom 2.0）としてリリース。",
    background: "Massive Attackは長年にわたりライブパフォーマンスと政治的メッセージングを実験的に組み合わせてきた。Fantomは「音楽が環境に応じて変容する」というコンセプトをデバイスセンサーで実装した。3rd Space Agencyとのコラボレーション。",
    execution: "iOS専用アプリ「Friday」を通じて実装。Core Motionフレームワークで動作・位置データ取得、HealthKitで心拍データ取得。楽曲のマルチトラック音源をリアルタイムミキサーに流し込み、センサーデータに応じてフェーダーが動く設計。各ユーザーの体験は固有で、生成されたミックスの録音・共有機能も実装。",
    evaluationImpact: "「体験として音楽を変化させる」発想の先駆的商業実装。スマートフォンのセンサーを音楽の演奏パラメータに転換するアプローチは、J-POPアルバムのモバイル特設体験として応用可能。朝・昼・夜で聴き方が変わる設計への展開も考えられる。",
    relatedWorks: [
      { title: "Tycho「Forecast」(2019年）", description: "天気という外部環境で音楽を変化させる同年の事例。Fantomが身体センサーを使うのに対しForecastは天気APIを使う対照的な設計。", url: "https://weather.tychomusic.com" },
      { title: "The Weeknd「Alone With Me AI」(2020年）", description: "視聴履歴データで体験をパーソナライズ。Fantomが「今この瞬間の身体データ」を使うのに対しこちらは「過去の視聴データ」を使う対比。", url: "https://alonewithme.ai" },
      { title: "Bon Iver「fABLE sPACEs」(2025年）", description: "GPS位置情報と連動した音楽体験。環境センサーと音楽を接続する思想的系譜として共鳴。", url: "https://fablespaces.boniver.org" }
    ]
  },
  {
    id: "gorillaz-song-machine",
    title: "SONG MACHINE（Gorillaz）",
    summary: "アルバムを「一括リリース」しない——シーズン制ドラマのように毎週新しいエピソード（楽曲+MV）が公開され、ファンが「次は誰が来るか」を常に待ち続ける連続公開フォーマット。",
    client: "Gorillaz（Demon Music Group）",
    agency: "（自社制作）",
    categories: ["メディア発明", "コンテンツ革新", "ブランドエクスペリエンス"],
    award: "（受賞情報なし）",
    year: "2020",
    regions: ["グローバル"],
    link: "https://www.gorillaz.com/",
    thumbnail: "https://i.ytimg.com/vi/aNGA90mUJds/hqdefault.jpg",
    videoId: "aNGA90mUJds",
    overview: "gorillaz.comをアルバム形式ではなく「シーズン1 / エピソード制」で運営。毎週または隔週で1〜2曲が新しい「エピソード」として追加。各エピソードにコラボアーティスト（Beck・Elton John・Schoolboy Q等）が参加し、それぞれMVとウェブコンテンツを伴う。ファンは「次は誰が来るか」を常にサイトで待ち続け、最終的にアルバムとして発売される。",
    background: "アルバムという従来のリリース形式を解体し、音楽を「番組」として届けるシリアル公開モデルを採用。配信サービスによる「スキップ文化」への対抗策として、毎週の発見と驚きでエンゲージメントを持続させる設計。コロナ禍のロックダウン期と重なったことで、週次の新しいコンテンツを待つ習慣がファンに定着した。",
    execution: "gorillaz.comのメインページをシーズン形式に再設計。各エピソードリリース時にコラボアーティスト発表→MV公開→SNS拡散のサイクルを繰り返す。シーズン1（14エピソード）終了後、アルバム「Song Machine, Season One」として商業リリース。",
    evaluationImpact: "「情報解禁から発売まで」の期間を「1回の大きな発表」ではなく「毎週小さな発見がある連続体験」に変換した。SNSエンゲージメントが期間中ずっと維持される設計として音楽マーケティングに大きな影響を与えた。J-POPのシリアル解禁モデルの最良の参照事例。",
    relatedWorks: [
      { title: "Gorillaz「Kong Studios Revival」(2025年）", description: "同アーティストによる次世代版——月次新部屋解放という進化したシリアル解禁。Song Machineの系譜を継承しブラウザ空間と統合した。", url: "https://kongstudios.gorillaz.com" },
      { title: "KAMITSUBAKI「EMERGENCE」(2021年）", description: "日本語圏での毎日謎解き→コンテンツ解放というシリアル構造の国内版。", url: "https://uc.kamitsubaki.jp" },
      { title: "Netflix「番組リリース戦略」(継続）", description: "週次エピソード配信で話題を維持し続けるコンテンツ配信モデルの確立者。Song Machineの設計思想はNetflixの週次配信モデルに着想を得ている。", url: "https://www.netflix.com/" }
    ]
  },
  {
    id: "radiohead-kid-a-mnesia",
    title: "KID A MNESIA EXHIBITION（Radiohead）",
    summary: "アルバムの世界観をUnreal Engine製の3Dミュージアムに——目的もゴールもない「歩く体験」としてPS5・PCで無料配布し、音楽を「入れる空間」に変えた前例のない試み。",
    client: "Radiohead / Thom Yorke / Epic Games",
    agency: "Namethemachine / Arbitrarily Good Productions",
    categories: ["空間体験", "コンテンツ革新", "テクノロジー×アイデア"],
    award: "New Yorker 2021 Best Video Games",
    year: "2021",
    regions: ["グローバル"],
    link: "https://store.epicgames.com/p/kid-a-mnesia-exhibition",
    thumbnail: "https://picsum.photos/seed/radiohead-kid-a-mnesia/1200/630",
    videoId: "",
    overview: "Kid A（2000年）とAmnesiac（2001年）の21周年記念。Epic Games StoreおよびPS5から無料ダウンロード可能。22の抽象的な3D空間を自由探索するウォーキングシミュレーター。「Paper Chamber」（手書きメモが舞う）「TV Room」（CRT映像の壁）「Pyramid Room」（楽曲が建築として流れる空間）など。目的・スコア・タイマーなし。Nigel Godrichの3Dサラウンドリミックスが移動に連動して変化する。",
    background: "2年かけてThom Yorke、Stanley Donwood、Nigel Godrichが関与して開発。当初はV&Aでの物理インスタレーションとして構想されたが、COVID-19で中止となりデジタル空間に転換された経緯を持つ。「新商業的コンテンツを排除し当時のアーカイブ素材のみ」という制作原則が誠実さを担保した。",
    execution: "Unreal Engine 4 + Wwise（空間オーディオ）でプレイヤーの3D座標に応じてリアルタイムで音楽の各要素をミックス。72本の映像ストリームを低コストで実装するためUVマッピング技術を活用。Epic Gamesが無料配信プラットフォームとして参加し、音楽ファン以外のゲームコミュニティへのリーチを拡大。約1〜1.5時間の体験。",
    evaluationImpact: "New Yorker誌が2021年ゲームオブザイヤーに選出。「アルバムを空間で体験する」という発想の最高峰として、WebGL（Three.js）でのブラウザ版アルバム体験設計の教科書的参照事例となった。各楽曲に対応した「部屋」が毎日1室解禁されていく構造にすればJ-POPアルバムサイトとして直接応用できる。",
    relatedWorks: [
      { title: "Muse「Will of the People」3Dサイト（2022年）", description: "同じくWebGLブラウザベースのアルバム没入体験。Radioheadがダウンロード型・目的なし探索なのに対し、MuseはWeb即時・コンテンツポータル型という対比。", url: "https://willofthepeople.muse.mu" },
      { title: "Beck「Hyperspace」AI体験（2020年）", description: "アルバム曲をNASAミッションにマッピングしGAN映像と統合したブラウザ体験。両者は「アルバムを没入型Webで体験する」という同じ発想。", url: "https://www.youtube.com/watch?v=Mv6c2lKkX0E" },
      { title: "Gorillaz「Kong Studios Revival」(2025年）", description: "17年ぶりに復活した架空スタジオ。3D空間としての音楽体験という同じ設計を継続進化させた事例。", url: "https://kongstudios.gorillaz.com" }
    ]
  },
  {
    id: "beck-hyperspace-ai",
    title: "HYPERSPACE: A.I. EXPLORATION（Beck）",
    summary: "アルバムの11曲それぞれがNASAの実在の宇宙ミッションにマッピングされ、GANが数十万枚のNASA画像から学習してリアルタイム映像を生成する——同じ訪問が二度とないブラウザ体験。",
    client: "Beck / Capitol Records",
    agency: "OSK Studio",
    categories: ["AIクリエイティブ", "テクノロジー×アイデア", "コンテンツ革新"],
    award: "Webby Award 2020",
    year: "2020",
    regions: ["北米", "グローバル"],
    link: "https://hyperspace.beck.com",
    thumbnail: "https://picsum.photos/seed/beck-hyperspace-ai/1200/630",
    videoId: "",
    overview: "hyperspace.beck.comにアクセスすると一人称視点の宇宙ナビゲーターインターフェースが起動。アルバム「Hyperspace」の11曲それぞれがNASAの実在ミッション（Apollo 12・火星・土星等）にマッピングされ、楽曲再生中にGANが数十万枚のNASA画像から学習したリアルタイム映像を生成。非線形・ノーマップ設計で毎回異なる体験が生まれる。",
    background: "Beckのプロデューサー・Pharrell Williamsとの共同制作によるアルバムの宇宙的世界観をウェブ体験として実装。OSK Studioが開発し、NASAのパブリックドメイン画像アーカイブをGAN学習データとして使用した。「同じ訪問が二度とない」というジェネラティブデザインの原則を商業音楽に適用した。",
    execution: "WebGLベースのブラウザ体験。GANがNASA画像から学習したビジュアルをリアルタイムレンダリング。楽曲とビジュアルの同期設計。非線形のナビゲーションで各楽曲に対応した宇宙空間を自由探索。楽曲ごとに全く異なるビジュアル言語を設定し、アルバム全体の統一感と多様性を両立。",
    evaluationImpact: "「毎回異なるビジュアル体験」というジェネラティブデザインの音楽プロモへの応用として先駆的。現在のStable Diffusion / Runway等のAIツールを使えば同様の体験をはるかに低コストで実装可能。アルバムのコンセプト（四季・感情・都市）を生成AIビジュアルに接続するJ-POPサイトの参照事例。",
    relatedWorks: [
      { title: "Radiohead「Kid A Mnesia Exhibition」(2021年）", description: "アルバム世界観を3D空間で体験させる同設計の先進事例。BeckはWebブラウザ、RadioheadはDownload型という違い。", url: "https://store.epicgames.com/p/kid-a-mnesia-exhibition" },
      { title: "Refik Anadol「Unsupervised」MoMA（2022年）", description: "MoMAのデータをGANに学習させた大型インスタレーション。Beckと同じ「機関データ×GAN」の発想の美術館版。", url: "https://www.moma.org/calendar/exhibitions/5535" },
      { title: "Bon Iver「Viisualiizer」(2019年）", description: "リアルタイムデータをビジュアル化した同年の音楽Web体験。データ×映像という同じ設計思想を持つ。", url: "https://boniver.withspotify.com" }
    ]
  },
  {
    id: "glass-animals-dreamland-site",
    title: "DREAMLAND Windows 98サイト（Glass Animals）",
    summary: "アルバムのプロモーションサイトがWindows 98のデスクトップUIで動作する——ドラッグ可能なウィンドウ・クラッシュエラー・フロッピーディスクアイコンがアルバムの「懐かしい未来」観を体現。",
    client: "Glass Animals（Polydor / Republic Records）",
    agency: "（制作元詳細不明）",
    categories: ["コンテンツ革新", "カルチャーインサイト", "ブランドエクスペリエンス"],
    award: "（受賞情報なし）",
    year: "2020",
    regions: ["グローバル"],
    link: "https://opensource.glassanimals.com/",
    thumbnail: "https://i.ytimg.com/vi/mRD0-GxqHVo/hqdefault.jpg",
    videoId: "mRD0-GxqHVo",
    overview: "Glass Animalsのアルバム「Dreamland」（2020年）のプロモーションサイトとして、Windows 98のデスクトップUIを完全模倣したウェブサイトを公開。ドラッグ可能なウィンドウ・クラッシュエラーダイアログ・フロッピーディスクアイコン・ピクセルフォントが動作し、その中にアルバムの楽曲・MVへのリンク・アーティストの個人的な記憶の断片が収録されていた。",
    background: "「Dreamland」はGlass Animalsのフロントマン・Dave Bayleyの個人的な記憶と1990〜2000年代の懐かしさをテーマにしたアルバム。Windows 98のUIはその時代感を最もダイレクトに体現するビジュアル言語として選択された。コロナ禍でのリリースということもあり、デジタル体験への注目が高まっていた時期の実施。",
    execution: "Windows 98の見た目と動作を完全にCSSとJavaScriptで再現。ウィンドウのドラッグ移動・最小化・最大化・クローズが動作。フロッピーディスクアイコンをクリックするとアルバムコンテンツへのアクセス。意図的なクラッシュエラーやブルースクリーンがユーモアとして機能。SNSで「Windows 98サイト」として有機的に拡散された。",
    evaluationImpact: "「ノスタルジーをUIのコンセプトにする」という発想の代表事例。技術的コストが非常に低いながら強力な話題性を生んだ。J-POPでも特定の時代観・懐かしさをテーマにするアルバムにおいて、その時代のUIを採用するアプローチは直接転用できる（ガラケーUI、ファミコン風、昭和の電話帳風など）。",
    relatedWorks: [
      { title: "underscores「Wallsocket ARG」(2023年）", description: "架空の場所をリアルに見せる複数サイト設計。Glass Animalsが「時代」をUIに使うのに対し、undrescoresは「場所」をUIにした対比。", url: "https://wallsocketgov.com" },
      { title: "Arcade Fire「Everything Now Corp」(2017年）", description: "架空の企業サイトというUI設計の先行事例。既存のUIパターンを転用してフィクションを「リアル」に見せる手法。", url: "https://en.wikipedia.org/wiki/Arcade_Fire" },
      { title: "Project:;COLD（2021年）", description: "SNS・Webの「本物らしいUI」をARGに使った日本の先行事例。Windows 98サイトと同じく「親しみある外見でフィクションを包む」手法。", url: "https://www.project-cold.net/" }
    ]
  },
  {
    id: "porter-robinson-nurture",
    title: "NURTURE インタラクティブ体験（Porter Robinson）",
    summary: "ポーターの仮想世界に「スクイグリーライン（くねくね線）」として入場し4つの扉から4つの世界を探索——コロナ禍のソーシャルディスタンスを逆手にとった仮想ファンコミュニティ体験。",
    client: "Porter Robinson（Mom + Pop Music）",
    agency: "（自主制作）",
    categories: ["空間体験", "ブランドエクスペリエンス", "テクノロジー×アイデア"],
    award: "（受賞情報なし）",
    year: "2021",
    regions: ["グローバル"],
    link: "https://porterrobinson.com/",
    thumbnail: "https://i.ytimg.com/vi/TJBh_hj6DzE/hqdefault.jpg",
    videoId: "TJBh_hj6DzE",
    overview: "アルバム「Nurture」の発売に向け、公式サイトにバーチャルインタラクティブ世界を構築。ユーザーは「スクイグリーライン（くねくね線のアバター）」として入場し、4つの異なるシングル楽曲に対応した4つの扉から4つの世界を探索。ユーザー同士がリアルタイムで同じ空間を移動し、光の線で互いの存在を知ることができる。コロナ禍のソーシャルディスタンス期に「物理的に会えない代わりに仮想空間で繋がる」体験として設計された。",
    background: "Porter Robinsonはファンコミュニティとの直接的な繋がりを重視するアーティストとして知られる。コロナ禍でリアルイベントが開催できない中、オンラインでのファン接触を重視し仮想空間を設計。Second Sky Festivalというオンライン音楽フェスの主催者でもあり、デジタル体験の実験を継続的に行ってきた。",
    execution: "ブラウザベースの軽量インタラクティブ空間。シングル「Something Comforting」と「Get Your Wish」に対応した世界が最初に実装され、アルバム発売に向けて世界が追加される形式を採用。他ユーザーのリアルタイムな存在が光の軌跡として表示される多人数同時接続設計。",
    evaluationImpact: "「孤独な聴取体験を集合体験に変える」という発想がコロナ禍に強く共鳴した。ファンとの距離感と多人数同時接続という設計はJ-POPのファン向けキャンペーンとして高い親和性を持つ。アルバムリリースまでの段階的な世界追加設計もGorillaz Song Machineと類似した「育てるサイト」モデル。",
    relatedWorks: [
      { title: "KAMITSUBAKI「EMERGENCE」(2021年）", description: "同年のファン参加型体験。EMERGENCEがチーム対抗謎解きなのに対しPorter Robinsonは仮想空間での自由探索という対比。", url: "https://uc.kamitsubaki.jp" },
      { title: "Gorillaz「Kong Studios Revival」(2025年）", description: "ブラウザベースの建物探索という同設計の発展版。Porter Robinsonの軽量な2D空間に対しGorillazは本格的WebGL。", url: "https://kongstudios.gorillaz.com" },
      { title: "Bon Iver「Viisualiizer」(2019年）", description: "リアルタイムの集合的聴取を可視化した事例。Porter Robinsonは「同じ空間で会える」、Viisualizerは「同じ音楽を聴いている証明」という対比。", url: "https://boniver.withspotify.com" }
    ]
  },
  {
    id: "twenty-one-pilots-dmaorg-arg",
    title: "DMAORG.INFO ARG（Twenty One Pilots）",
    summary: "SpotifyのCanvas映像に埋め込まれた座標がファンを現実の都市へ誘導——毎日新しい都市のビルボードが出現しスキャンすると限定プレイリストが解禁される物理×デジタル連鎖ARG。",
    client: "Twenty One Pilots（Fueled by Ramen）",
    agency: "（自社制作）",
    categories: ["メディア発明", "ブランドエクスペリエンス", "ARG"],
    award: "（受賞情報なし）",
    year: "2021",
    regions: ["グローバル"],
    link: "https://dmaorg.info",
    thumbnail: "https://picsum.photos/seed/twenty-one-pilots-dmaorg/1200/630",
    videoId: "",
    overview: "Spotify Canvasの楽曲映像に座標が出現するのをファンが発見。解読するとロンドンのビルディングの場所。現地に行くと楽曲の歌詞と多言語翻訳・Spotifyスキャンコードのビルボードが存在。スキャンすると限定プレイリストが解禁。翌日また新しい座標がCanvasに出現し、次の都市へ——毎日継続して世界中を巡る連鎖ARGが展開された。dmaorg.infoという謎のサイトも並行して稼働し数年にわたる潜在的ARGとして機能した。",
    background: "Twenty One Pilotsは「Trench」アルバム発売以来、複雑な世界観ARG（DEMA, Bishop）を継続的に展開してきた。Spotify CanvasというビジュアルレイヤーをARGの手がかりメディアに転用することでストリーミングプラットフォームの視聴体験をキャンペーンの入口に変えた。",
    execution: "Spotify Canvas動画にフレームレベルで座標や数字を埋め込む。ファンのコミュニティ（Reddit / Twitterファングループ）が変化を検知・解読。物理ビルボードを複数都市に設置し、Spotify QRコードと紐付け。毎日新しいCanvas更新→座標→都市→ビルボード→限定コンテンツのサイクルを繰り返す。",
    evaluationImpact: "Spotifyという既存のストリーミングプラットフォームを「ARGの舞台」として活用した先駆的事例。LINE MusicやApple MusicのCanvas相当機能を使えばそのままJ-POPに転用可能。「毎日新しい手がかり」という継続参加型設計がファンの習慣的なエンゲージメントを生む。",
    relatedWorks: [
      { title: "Taylor Swift「TTPD QRウォールアート」(2024年）", description: "都市のビルボード×QRコード×デジタル解禁という同形式。DMAORG ARGのより洗練された後継事例として比較できる。", url: "https://www.taylorswift.com/" },
      { title: "Bad Bunny「Tracking Bad Bunny」(2025年）", description: "Google MapsとSNSを使ったアルバム情報宝探し。Twenty One PilotsのSpotify起点ARGと同じ「プラットフォーム×物理世界」の設計。", url: "https://www.youtube.com/watch?v=wTMC_zesAt4" },
      { title: "米津玄師「感電 STRAY SHEEP CODE」(2020年）", description: "既存プラットフォーム（YouTube）を謎解きの舞台にした日本版。Twenty One PilotsがSpotifyを使うのに対しこちらはYouTubeという違いがある。", url: "https://www.youtube.com/watch?v=UFQEttrn6CQ" }
    ]
  },
  {
    id: "fka-twigs-eusexua",
    title: "EUSEXUA キャンペーンサイト（FKA twigs）",
    summary: "1行のテキストと1つのフォームだけのサイト——メールアドレスを入力した者だけがロンドン・NY・LAの秘密ライブに招待される「URLがパスワードになる」最小限の体験設計。",
    client: "FKA twigs（Atlantic Records）",
    agency: "（制作元詳細不明）",
    categories: ["ブランドエクスペリエンス", "メディア発明"],
    award: "（受賞情報なし）",
    year: "2024",
    regions: ["欧州", "北米"],
    link: "https://eusexua.fkatwi.gs",
    thumbnail: "https://picsum.photos/seed/fka-twigs-eusexua/1200/630",
    videoId: "",
    overview: "eusexua.fkatwi.gsにアクセスするとただ1行「To go out we must go in reset. And begin again from within.」のテキストとメールアドレス入力フォームのみ。入力した者の中から選ばれた者にロンドン・ニューヨーク・ロサンゼルスの秘密ライブへの招待が届く。ドレスコードは「unearthed nude expression」。FKA twigsがガラスケース内で未発表曲を演奏した。",
    background: "2024年アルバム「EUSEXUA」の発売前のティザーキャンペーンとして設計。「何もない」ページの極端なシンプルさが逆説的に「何かある」という期待感と神秘性を生み出す体験設計。URLを知っている人だけ、さらにメールを入力した人だけ、さらにそこから選ばれた人だけが体験できるという三重の選別構造。",
    execution: "サイト自体は技術的に非常にシンプル（1ページ・1フォーム）。しかしURLの存在自体が「秘密の招待状」として機能するよう設計された。選ばれたファンへの招待メール送付→秘密ライブ実施→参加者がSNSで体験をシェア→URLの存在が波紋的に拡散するという設計。",
    evaluationImpact: "「最小限のWebサイトが最大のインパクトを生む」ことを証明した事例。情報ゼロの中に「参加したいと思わせる」体験設計の洗練された実装。J-POPでもコアファン向けの先行体験設計として応用可能。「このURLを知っている人だけ」という設計でURL自体のシェアをキャンペーンにできる。",
    relatedWorks: [
      { title: "The Cure「Songs of a Lost World」WhatsApp ARG（2024年）", description: "物理カード→Web→WhatsAppという多段体験。EUSEXUAが最小限のWebで終わるのに対し、The CureはWebを複数の体験に接続する対比。", url: "https://songsofalost.world" },
      { title: "Bon Iver「fABLE sPACEs」(2025年）", description: "「場所に行かないと体験できない」という制約が体験を特別にする同発想。EUSEXUAはURLを知ること、fABLE sPACEsは場所に行くことが鍵。", url: "https://fablespaces.boniver.org" },
      { title: "Porter Robinson「Nurture」体験（2021年）", description: "アルバム世界への「入場」というコンセプトを持つ点で共鳴。EUSEXUAは物理ライブへの入場、Nurtureは仮想空間への入場という違い。", url: "https://porterrobinson.com/" }
    ]
  },
  {
    id: "taylor-swift-1989-vault-puzzle",
    title: "1989 VAULT PUZZLE（Taylor Swift × Google）",
    summary: "「Taylor Swift」をGoogleで検索するとパズルが出現——全世界3,300万回の解答が達成されるまでアルバムの収録曲タイトルは誰にも教えられない集合解禁カウンター。",
    client: "Taylor Swift（Republic Records）/ Google",
    agency: "Google Creative Lab",
    categories: ["メディア発明", "カルチャーインサイト", "データクリエイティブ"],
    award: "Webby Award 2024",
    year: "2023",
    regions: ["グローバル"],
    link: "https://www.taylorswift.com/",
    thumbnail: "https://picsum.photos/seed/taylor-swift-1989-vault/1200/630",
    videoId: "",
    overview: "「Taylor Swift」でGoogle検索すると青い金庫アイコンが出現。クリックするとアナグラムパズル（89種類）が表示され、解くと全世界カウンターが1増加。「3,300万回達成」まで5曲のVaultトラックタイトルは非公開。達成後、タイトルが全世界に一斉公開。開始数時間でGoogleが「金庫が詰まった！」とエラー表示するほどアクセスが集中した。",
    background: "「1989 (Taylor's Version)」の再録音アルバム発売キャンペーンとして、GoogleとのパートナーシップでGoogle検索体験にゲームを統合した。スクーター・ブラウンとの原版権紛争から再録音で自分の音楽を取り戻す過程が「金庫を解錠する」というメタファーと完璧に一致した。",
    execution: "Google検索結果に直接統合されたゲーム機能。Swiftiesが一斉に検索→パズル解答→カウンター更新というサイクルで自発的な動員を生み出した。達成後のタイトル一斉公開が「世界同時解禁」という感覚をファンに提供。アナグラムパズルという低技術コストで最大の参加動機を設計。",
    evaluationImpact: "Google検索体験へのゲーム統合という極めて革新的なメディア発明。「ファン全員の行動が解禁の鍵を握る」というフレームが史上最大規模の同時参加型アルバム発表体験を実現した。J-POPへの応用として、LINEオープンチャット×パズル解答×楽曲解禁などが考えられる。",
    relatedWorks: [
      { title: "Taylor Swift「TTPD QRウォールアート」(2024年）", description: "同アーティストによる翌年の都市QRコード集合謎解き。Vault Puzzleのオンライン集合解禁をOOH物理体験に進化させた事例。", url: "https://www.taylorswift.com/" },
      { title: "KAMITSUBAKI「EMERGENCE」(2021年）", description: "ファン集団が協力してコンテンツを解放する同構造の日本語圏事例。", url: "https://uc.kamitsubaki.jp" },
      { title: "Bad Bunny「Tracking Bad Bunny」(2025年）", description: "ファンが集合知でトラックリストを発見するという同じ「解禁を能動的に体験する」設計の異なる実装。", url: "https://www.youtube.com/watch?v=wTMC_zesAt4" }
    ]
  },
  {
    id: "arcade-fire-everything-now-corp",
    title: "EVERYTHING NOW CORP（Arcade Fire）",
    summary: "架空のコンテンツマーケティング会社を設立し、偽のBillboard記事・偽の商品・ロシアスパムボット風Twitterアカウントを3ヶ月展開——アルバムが「商品」ではなく「漏れた秘密」に見える架空メディアエコシステム。",
    client: "Arcade Fire（Columbia Records）",
    agency: "（自社企画）",
    categories: ["メディア発明", "カルチャーインサイト", "コンテンツ革新"],
    award: "（受賞情報なし）",
    year: "2017",
    regions: ["グローバル"],
    link: "https://en.wikipedia.org/wiki/Arcade_Fire",
    thumbnail: "https://picsum.photos/seed/arcade-fire-everything-now/1200/630",
    videoId: "",
    overview: "架空PR会社「Everything Now Corp」と架空担当者「Tannis Wright」が実在するように機能。偽のBillboard記事・偽のHollywood Reporter記事・$109の限定フィジェットスピナー（デジタルダウンロード付きと称する）・ロシアスパムボットを装ったTwitterアカウントが手がかりをつぶやく。アナグラムになったトラックリスト（「Rectum Roofer Cat」等）が約10の偽ドメインにわたって3ヶ月展開され、最後にバンドが「謝罪して」キャラクターを解除した。",
    background: "フェイクニュース・SNS操作・コンテンツマーケティングへの批判をキャンペーン自体の構造で体現した。アルバム「Everything Now」のテーマ（情報過多・コンテンツ資本主義）とキャンペーン手法を一致させた極めてコンセプチュアルな設計。Pepsi Kendall Jenner CMが炎上した直後のタイミングで「社会問題を扱う広告の失敗例と成功例」として比較されることになった。",
    execution: "約10の偽ドメインを取得・運営。架空人物のSNSアカウント（現実のSNSプラットフォームを使用）、偽メディア記事（本物のメディアサイトを模倣したデザイン）、物理的な偽商品（実際に販売した形跡あり）で構成。3ヶ月間のキャンペーン後、バンドが「謝罪文」をリリースしてキャラクターから離れた。",
    evaluationImpact: "「架空の企業をリアルに見せる」ARGキャンペーンの代表事例。「アルバムが商品ではなく漏れた秘密に見える」演出はJ-POPでも「架空のレコード会社サイト」「架空のドキュメンタリー制作会社」として転用できる。日本のオタク文化の考察・ロア読解能力との相性も良い。",
    relatedWorks: [
      { title: "underscores「Wallsocket ARG」(2023年）", description: "架空の町を複数サイトで構築した直接的な後継事例。Everything Now Corpが企業を偽装するのに対しWallsocketは町を偽装する。", url: "https://wallsocketgov.com" },
      { title: "The Cure「Songs of a Lost World」WhatsApp ARG（2024年）", description: "物理×デジタルの多段ARGという同世代の事例。Arcade Fireは「メディア全体を偽装」、The Cureは「段階的な謎解きチェーン」という対比。", url: "https://songsofalost.world" },
      { title: "#StillSpeakingUp（RSF, 2021年）", description: "フェイク（ディープフェイク）を「善意の目的」に使った事例。Arcade Fireのフェイクメディアとは意図が異なるが「偽の情報が本当のメッセージを伝える」構造が共鳴。", url: "https://www.lovethework.com/campaigns/stillspeakingup-deeptruth-710063" }
    ]
  }
];

const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
const existingIds = new Set(cases.map(c => c.id));
const toAdd = newCases.filter(c => !existingIds.has(c.id));
const updated = [...toAdd, ...cases];
await fs.writeFile(CASES_PATH, JSON.stringify(updated, null, 2));
console.log(`追加: ${toAdd.length}件 / 合計: ${updated.length}件`);
toAdd.forEach(c => console.log(`  + ${c.id} (${c.year})`));
