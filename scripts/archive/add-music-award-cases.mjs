import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");

const newCases = [
  {
    id: "tracking-bad-bunny",
    title: "TRACKING BAD BUNNY",
    summary: "Bad Bunnyのアルバム発売をGoogleストリートビューでのプエルトリコ横断宝探しに変えた——ファンが実際の街角を「ハント」することで楽曲タイトルを解読する世界規模のARG。",
    client: "Rimas Entertainment（Bad Bunny所属レーベル）",
    agency: "DDB Latina Puerto Rico",
    categories: ["メディア発明", "ブランドエクスペリエンス", "カルチャーインサイト"],
    award: "Cannes Lions 2025 Entertainment Lions for Music Grand Prix / Clio Music 2026 Grand Prix（複数部門）",
    year: "2025",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=odwi6eFznM4",
    thumbnail: "https://i.ytimg.com/vi/wTMC_zesAt4/hqdefault.jpg",
    videoId: "wTMC_zesAt4",
    overview: "Bad Bunnyのアルバム「DeBÍ TiRAR MáS FOToS（もっと写真を撮ればよかった）」の発売に際し、アルバムタイトルと同名のコンセプトでプロモーションを設計。Googleストリートビューのプエルトリコの実際の街角の写真の中に、楽曲タイトルが隠されており、ファンが世界中からGoogle マップ上のプエルトリコ各地を「巡回」してタイトルを発見・共有する宝探し体験を構築した。",
    background: "Bad Bunnyはプエルトリコ出身のラテントラップ/レゲトンアーティストで、グローバルなスーパースターでありながら常にプエルトリコのアイデンティティを前面に出してきた。「DeBÍ TiRAR MáS FOToS」はプエルトリコの文化・風景・記憶へのオマージュをテーマにしたアルバムで、プロモーションもGoogleストリートビューを通じてプエルトリコの実際の街並みを世界に届けるという思想で設計された。",
    execution: "アルバム発売前、Bad BunnyのSNSにプエルトリコの特定の場所の写真が投稿される。写真にはGoogleストリートビューのリンクが含まれており、ファンがアクセスすると実際の街角に楽曲タイトルが視覚的に隠されている。ファンはSNSで発見を報告・共有し、集合知で全曲のタイトルが解読される。プエルトリコ各地の地元コミュニティもキャンペーンに巻き込まれた。",
    evaluationImpact: "Cannes 2025 Entertainment Lions for Music Grand Prix受賞。Clio Music 2026でDigital/Mobile・AI & Emerging Technologies・Experience/Activation・Fan Engagementの4部門でGrand Clio受賞。アルバムはBillboard Global 200首位を獲得し、プエルトリコ文化への注目度も大幅に向上した。「アルバム発売そのものを体験型ゲームにした」事例として音楽マーケティング史に刻まれた。",
    relatedWorks: [
      { title: "米津玄師「STRAY SHEEP」感電プロモーション（2020年）", description: "YouTubeチャンネルの404エラーをジャックしてファンを巻き込む謎解きプロモーションのJP版。同じく「プラットフォームの仕組み×謎解き」という設計思想。", url: "https://www.youtube.com/watch?v=UFQEttrn6CQ" },
      { title: "Spotify「Spreadbeats」(2024年）", description: "ExcelスプレッドシートをMVにするという「既存ツールの転用」という思想でTracking Bad Bunnyと共鳴する。", url: "https://www.youtube.com/watch?v=ErTCQB09rsM" },
      { title: "Google Arts & Culture「Art Selfie」(2018年〜）", description: "Googleの既存インフラをアートとの接点に転用した先行事例。Tracking Bad BunnyのGoogleストリートビュー活用と同じ「Googleをメディアに使う」発想。", url: "https://artsandculture.google.com/" }
    ]
  },
  {
    id: "johnnie-walker-errata-88",
    title: "ERRATA AT 88（Johnnie Walker × Alaíde Costa）",
    summary: "ボサノバの「忘れられた母」を88歳でカーネギーホールに連れ戻した——ウイスキーブランドが歴史の間違いを正すことで音楽史と自社ブランドを同時に刷新した。",
    client: "Johnnie Walker（Diageo）",
    agency: "AlmapBBDO（サンパウロ）",
    categories: ["カルチャーインサイト", "ブランドエクスペリエンス", "社会包摂"],
    award: "Cannes Lions 2024 Entertainment Lions for Music Grand Prix",
    year: "2024",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=GH4nkkp3n7Y",
    thumbnail: "https://i.ytimg.com/vi/GH4nkkp3n7Y/hqdefault.jpg",
    videoId: "GH4nkkp3n7Y",
    overview: "1962年、カーネギーホールでブラジルのボサノバを世界に紹介した歴史的コンサートに参加していたAlaíde Costa（アライジ・コスタ）は、後の音楽史書から名前を消され「ボサノバの忘れられた母」となっていた。Johnnie Walkerは2023年、88歳のAlaídeを再びカーネギーホールのステージに立たせることで、歴史の誤りを正すとともにブランドの「進歩し続ける」というメッセージを体現した。",
    background: "Johnnie Walkerはブラジルで最も愛されるウイスキーブランドの地位を競合に奪われ、存在感の回復を求めていた。AlmapBBDOはブランドの「Keep Walking」という長年のテーマに着目し、「実際に歩み続けた女性」の物語を探した。Alaíde Costaはブラジルで知る人ぞ知る伝説の歌手であり、彼女の経歴にある「消された歴史」という不正義を正すことがブランドと完璧に一致すると判断した。",
    execution: "ブラジル国内メディアで「ボサノバの忘れられた母」を発掘する調査キャンペーンを展開。88歳のAlaídéへのインタビュー・ドキュメンタリーを制作し、2023年10月8日にカーネギーホールで還暦を超えるパフォーマンスを実現。イベントはNYタイムズ・BBC等の国際メディアが報道。Johnnie Walkerのビジュアルが会場に一切登場せず、Alaídeの物語だけが語られた。",
    evaluationImpact: "Cannes 2024 Entertainment Lions for Music Grand Prix受賞。「ブランドが消え、ストーリーだけが輝く」演出が審査員に最高評価された。ブラジルでのJohnnie Walkerのブランド好意度が大幅に回復。Alaíde Costaの名前がボサノバの歴史書に公式に復活する動きが始まった。「音楽の歴史を修正すること」がマーケティングになった事例として引用される。",
    relatedWorks: [
      { title: "L'Oréal「The Final Copy of Ilon Specht」(2025年）", description: "「長年クレジットされなかった女性クリエイターを正式に認める」という同じ「歴史の修正」構造。音楽業界版 vs 広告業界版の対比として参照できる。", url: "https://www.youtube.com/watch?v=9Q3XZFTRvuw" },
      { title: "Kenshi Yonezu × Studio Ghibli「地球儀」(2023年）", description: "文化的に重要な巨匠との初コラボが「歴史的事件」として機能した事例。伝統的権威の文脈でブランドが語られる設計が共鳴。", url: "https://www.youtube.com/watch?v=VUsURj_OYdA" },
      { title: "ALWAYS #LikeAGirl（P&G, 2014年）", description: "社会的不公正を広告で問い直し、文化的変化を生んだ構造がErrata at 88と同じ。「ブランドが正義の側に立つ」パターンの先例。", url: "https://www.youtube.com/watch?v=vxd_DKsITXo" }
    ]
  },
  {
    id: "spotify-spreadbeats",
    title: "SPREADBEATS（Spotify）",
    summary: "ExcelスプレッドシートそのものをMVにした——Spotifyが音楽広告を出さない企業に向けて「使い慣れたビジネスツールの中に音楽を埋め込む」という逆転のB2Bキャンペーン。",
    client: "Spotify",
    agency: "FCB New York",
    categories: ["メディア発明", "テクノロジー×アイデア", "データクリエイティブ"],
    award: "Cannes Lions 2024 Creative B2B Grand Prix / D&AD 2025 Annual掲載",
    year: "2024",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=ErTCQB09rsM",
    thumbnail: "https://i.ytimg.com/vi/ErTCQB09rsM/hqdefault.jpg",
    videoId: "ErTCQB09rsM",
    overview: "Spotifyの広告部門がB2B顧客（音楽広告を使ったことのない企業）に向けて、Microsoft Excelのスプレッドシートをそのまま使った動画コンテンツを制作。セルが動いて文字が現れ、計算式がビートと同期するという「スプレッドシートMV」を、実際の広告媒体計画書（メディアプラン）に埋め込んで配信。音楽広告に懐疑的なCFO・マーケターに「Excelの中で音楽に出会わせる」という逆転の設計。",
    background: "多くのB2B企業は「音楽広告はブランド向け」と考え、Spotifyの広告プログラムに興味を示さなかった。FCBはその「音楽は自分たちに関係ない」という壁を崩すために、相手が最も使い慣れているツール（Excel）の中に音楽を持ち込むアイデアを発案。スプレッドシートという「最も非クリエイティブな媒体」を「最もクリエイティブな媒体」に変えた。",
    execution: "Spotifyの営業チームが送る実際のメディアプランのExcelファイルにSpreadbeatsの動画が埋め込まれており、ファイルを開いたクライアントが発見する設計。Excelのセル・数式・グラフが音楽に合わせてアニメーションする動画はExcel内で再生される。グリッチ効果やASCIIアートを活用した独特の映像スタイルで制作。",
    evaluationImpact: "Cannes 2024 Creative B2B Grand Prix受賞（音楽関連ではこの部門での受賞が珍しい）。音楽業界に縁のなかったB2B企業のSpotify広告問い合わせが大幅増加。「媒体の意外性」で注目を集めるという手法の洗練された実例として、B2Bマーケティング全般の教材となった。",
    relatedWorks: [
      { title: "UNIQLOCK（2008年）", description: "広告コンテンツをユーティリティ（時計ウィジェット）として設計し、ユーザーが自発的に設置する手法。Spreadbeatsの「ビジネスツールに埋め込む」発想の先例。", url: "https://www.campaignasia.com/article/uniqlo-japan-wins-cyber-grand-prix-at-cannes/206499" },
      { title: "Tracking Bad Bunny（2025年）", description: "Googleストリートビューという非音楽ツールを音楽プロモーションに転用した事例。「既存インフラの転用」という同じ思想。", url: "https://www.youtube.com/watch?v=wTMC_zesAt4" },
      { title: "OK Go「Here It Goes Again」(2006年）", description: "トレッドミルだけを使った完全ローコストのMVが驚異的バイラルを起こした事例。Spreadbeatsと同様に「制約をクリエイティブに変える」手法。", url: "https://www.youtube.com/watch?v=dTAAsCNK7RA" }
    ]
  },
  {
    id: "specsavers-misheard-version",
    title: "THE MISHEARD VERSION（Specsavers × Rick Astley）",
    summary: "聴力検査を避けるイギリス人のために、Rick AstleyにNever Gonna Give You Upを「空耳バージョン」で再録させた——難聴啓発の文脈で「聴こえていない」ことを音楽で可視化。",
    client: "Specsavers",
    agency: "Golin London",
    categories: ["カルチャーインサイト", "コンテンツ革新", "社会包摂"],
    award: "Cannes Lions 2023 PR Grand Prix",
    year: "2023",
    regions: ["欧州"],
    link: "https://www.youtube.com/watch?v=f8y8hay39QQ",
    thumbnail: "https://i.ytimg.com/vi/f8y8hay39QQ/hqdefault.jpg",
    videoId: "f8y8hay39QQ",
    overview: "イギリスでは難聴の認識・検査忌避が社会問題化しており、症状に気づいていても10年以上検査を受けない人が多い。眼鏡・補聴器ブランドのSpecsaversが難聴啓発のために、「Never Gonna Give You Up」で知られるRick Astleyに、歌詞を「よく聴こえていない人が聴き間違えたバージョン」として再録させたアルバムを発売。難聴当事者の視点を体験させることで受診促進を図った。",
    background: "Specsaversはイギリスで「Should've Gone to Specsavers（Specsaversに行けばよかった）」のキャッチフレーズで知られるユーモラスなブランド。補聴器部門を強化する中で「聴力検査の忌避」という文化的課題に直面。Rick Astleyというイギリス人なら誰もが知るアーティストに協力を依頼し、難聴を「あるある体験」として笑いとともに共感できる形で提示した。",
    execution: "Rick Astleyが実際に「空耳バージョン」を再録したアルバムを発売。CDとレコードでの販売に加え、Spotifyでも配信。空耳歌詞はすべて聴力に問題がある人が実際に聴き間違えやすい言葉に設計。Rickの公式YouTube・SNSでも展開し、「難聴テスト」として自分の聴力を確認するよう訴求した。難聴当事者のコミュニティにも積極的に働きかけた。",
    evaluationImpact: "Cannes 2023 PR Grand Prix受賞。Specsaversの聴力検査予約数が前年比大幅増加。「深刻な医療問題をユーモアで解決する」という英国的アプローチが高く評価された。Rick Astleyの「リックロール」文化（インターネットミームとして定着した同曲）を活用することで、既存の文化的文脈を医療啓発にリダイレクトした点も評価された。",
    relatedWorks: [
      { title: "Rick Astley「Never Gonna Give You Up」リックロール文化（2007〜）", description: "元々のリックロールミームを「社会的に意味ある文脈」に転用した事例。既存の文化コードを新しい目的に使う手法の精巧な例。", url: "https://en.wikipedia.org/wiki/Rickrolling" },
      { title: "エキマトペ（JR東日本, 2021年）", description: "音の情報格差を解消しようとする試みとして共鳴。「聴こえない人の体験」を可視化・共有する手法が同じ問いを持つ。", url: "https://www.youtube.com/watch?v=QE3YSkWUIco" },
      { title: "Wavio「See Sound」(2019年）", description: "難聴者の音情報格差をテクノロジーで解決した事例。Specsaversとは異なるアプローチだが「難聴×コミュニケーション」の問い。", url: "https://www.adweek.com/creativity/wavio-and-area-23s-see-sound-project-wins-top-innovation-grand-prix-at-cannes-lions/" }
    ]
  },
  {
    id: "kiwanuka-beautiful-life",
    title: "BEAUTIFUL LIFE（Michael Kiwanuka）",
    summary: "COVID禍のNetflixドキュメンタリーのために書かれた1曲が、Cannes最高賞を受賞——監督Philip Youmansが「若い黒人男性の脆弱さと美しさ」を映した映像との完璧な一致。",
    client: "Michael Kiwanuka（Island Records）",
    agency: "Smuggler（制作会社）",
    categories: ["コンテンツ革新", "社会包摂", "カルチャーインサイト"],
    award: "Cannes Lions 2023 Entertainment Lions for Music Grand Prix",
    year: "2022",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=TiaxTzkkzB0",
    thumbnail: "https://i.ytimg.com/vi/TiaxTzkkzB0/hqdefault.jpg",
    videoId: "TiaxTzkkzB0",
    overview: "「Beautiful Life」は、NetflixドキュメンタリーFilm「Convergence: Courage in a Crisis」（COVID-19パンデミック初期の医療現場を記録した作品）のために作られたMichael Kiwanukaの楽曲。監督Philip Youmans（「Burning Cane」等で知られる若手黒人監督）が、楽曲のために「若い黒人男性の日常的な美しさと脆弱さ」を映像化したMVが、審査員全員一致でGrand Prixを受賞した。",
    background: "Michael Kiwanukaはウガンダ系イギリス人のシンガーソングライターで、自己認識・人種・脆弱さをテーマにした音楽で知られる。「Beautiful Life」はCOVID禍の困難の中に人間の強さと美しさを見出す詩的な楽曲。MVは商業的なプロモーション目的ではなく、楽曲の哲学的テーマを映像として昇華することを目的として制作された。",
    execution: "MVはPhilip Youmansが監督。若い黒人男性たちの日常的な場面（友人と笑う、ただ空を見る、踊る）を、商業的な演出なしに記録的な映像で描写。音楽と映像が互いに独立した芸術作品として機能しつつ、融合した時に新しい意味を生む設計。",
    evaluationImpact: "Cannes 2023 Entertainment Lions for Music Grand Prix。「音楽ビデオがアート作品として評価される」事例の一つとして音楽業界で広く言及された。Kiwanukaの作品は商業的マーケティング戦略に依存せず、批評的評価と有機的なファンダム拡大で評価されるモデルを体現している。",
    relatedWorks: [
      { title: "Beyoncé「Formation」(2016年）", description: "同じく黒人文化・コミュニティへの敬意と誇りを映像で表現した音楽作品。政治的メッセージと視覚的美しさの融合として系譜が共鳴する。", url: "https://www.youtube.com/watch?v=WDZJPJV__bQ" },
      { title: "Childish Gambino「This is America」(2018年）", description: "アフリカ系アメリカ人の現実と喜びを対比させた政治的MVとして、Beautiful Lifeの系譜に位置する。", url: "https://www.youtube.com/watch?v=VYOjWnS4cMY" },
      { title: "坂本龍一「音を視る 時を聴く」展（2025年）", description: "音楽と映像・空間が独立した芸術として融合する体験設計という点で共鳴する。", url: "https://www.youtube.com/watch?v=Gjtl74lcf6g" }
    ]
  },
  {
    id: "residente-this-is-not-america",
    title: "THIS IS NOT AMERICA（Residente ft. Ibeyi）",
    summary: "ラテンアメリカ全土の先住民・奴隷・革命の歴史を1曲に詰め込んだMV——「アメリカ」という言葉の意味を南北大陸規模で問い直したResidenteの音楽的宣言。",
    client: "Residente（Sony Music Latin）",
    agency: "Doomsday Entertainment（ロサンゼルス）",
    categories: ["コンテンツ革新", "社会包摂", "カルチャーインサイト"],
    award: "Cannes Lions 2022 Entertainment Lions for Music Grand Prix",
    year: "2022",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=GK87AKIPyZY",
    thumbnail: "https://i.ytimg.com/vi/GK87AKIPyZY/hqdefault.jpg",
    videoId: "GK87AKIPyZY",
    overview: "プエルトリコ出身のアーティストResidente（元Calle 13）が、「America」がラテンアメリカも含む大陸全体の名前であるという事実から着想。アルゼンチン・ブラジル・メキシコ・キューバ等の先住民・奴隷・革命・現代の民衆蜂起までの歴史を、フランスのツインシスターIbeyiとともに楽曲と映像で表現した。楽曲タイトルはChildish Gambino「This is America」への直接的な応答・反論でもある。",
    background: "Childish Gambino「This is America」が2018年に米国の銃社会・黒人差別を問題提起した後、Residenteは「ラテンアメリカにも深い歴史的傷がある」という視点で応答する楽曲を構想した。Ibeyiはキューバとフランスのルーツを持つツインで、アフロ・ラテンのルーツを音楽に昇華するアーティスト。南北アメリカ大陸の「アメリカ」を再定義するという壮大なコンセプト。",
    execution: "MVは7分超の長尺で制作。ラテンアメリカ各国の先住民・奴隷制・革命等の歴史的シーンと現代の抵抗運動映像を組み合わせたビジュアル。Residenteが科学的に自身のDNAを検査し、アフリカ・先住民・ヨーロッパのルーツを確認するドキュメンタリー要素も含む。音楽は伝統的なラテン音楽と現代のトラップを融合。",
    evaluationImpact: "Cannes 2022 Entertainment Lions for Music Grand Prix受賞。ラテンアメリカ文化の多様性と歴史的苦難への世界的な注目を高めた。「音楽ビデオが文化的・歴史的議論を生む」という事例として批評家・学術界でも引用された。YouTubeで1億回以上の再生を記録。",
    relatedWorks: [
      { title: "Childish Gambino「This is America」(2018年）", description: "直接的な「応答先」となった楽曲。「This is America」というタイトルが持つ政治的文脈を継承・拡張した。", url: "https://www.youtube.com/watch?v=VYOjWnS4cMY" },
      { title: "Beyoncé「Formation」(2016年）", description: "黒人文化・歴史を音楽映像で語る作品系譜の先例。南北アメリカ大陸に広がる黒人のルーツという同じ文脈。", url: "https://www.youtube.com/watch?v=WDZJPJV__bQ" },
      { title: "Bad Bunny「Tracking Bad Bunny」(2025年）", description: "同じプエルトリコ・ラテン文化のアイデンティティを核にしたプロモーション。ラテン音楽のグローバル化という同じ文脈。", url: "https://www.youtube.com/watch?v=wTMC_zesAt4" }
    ]
  },
  {
    id: "childish-gambino-this-is-america",
    title: "THIS IS AMERICA（Childish Gambino）",
    summary: "ダンスの背後で銃撃が起き、その混乱が本体の出来事になる——ドナルド・グローヴァーとHiro Muraiが「アメリカにおける黒人の日常」を4分間に凝縮した問題作。",
    client: "Childish Gambino（Donald Glover）",
    agency: "Doomsday Entertainment（LA）/ Hiro Murai（監督）",
    categories: ["コンテンツ革新", "カルチャーインサイト", "社会包摂"],
    award: "Cannes Lions 2019 Entertainment Lions for Music Grand Prix / Grammy Best Music Video",
    year: "2018",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=VYOjWnS4cMY",
    thumbnail: "https://i.ytimg.com/vi/VYOjWnS4cMY/hqdefault.jpg",
    videoId: "VYOjWnS4cMY",
    overview: "ドナルド・グローヴァー（Childish Gambino）が2018年5月5日に突然リリースしたシングルおよびMV。前半の陽気なダンスの裏で銃撃・暴力が繰り返されるという二重構造で、米国における「エンターテインメント」と「黒人への暴力」の共存を視覚化した。公開後数時間でSNS上に膨大な解説・考察が溢れ、現代アメリカ社会の最も重要な芸術作品の一つとして即座に認識された。",
    background: "2018年はチャールストン教会銃撃事件・ブラック・ライブズ・マターへの関心が再び高まっていた時期。グローヴァーとMuraiは「エンターテインメント産業が暴力を隠蔽する」という批判を、エンターテインメントの文法（ダンス映像）そのものを使って表現することを選んだ。事前告知なし・突然リリースという戦略も「予測できない暴力」のメタファーとして機能した。",
    execution: "4分で30以上の象徴的シンボルが登場するとされ、SNSでの「隠れた意味探し」がバイラルを加速した。グローヴァーは「ジム・クロウ」的な誇張されたダンスと表情でアフリカ系アメリカ人への歴史的偏見を体現。銃が丁寧に布で包まれる一方で人が粗雑に扱われる演出が各シーンに繰り返される。",
    evaluationImpact: "Cannes 2019 Entertainment Lions for Music Grand Prix受賞（同年にBaco Exu do Bluesの「Bluesman」とともに2件受賞）。Grammy Best Music Videoも受賞。YouTube公開後24時間で1億回超の再生。「音楽ビデオが文化的事件になる」という現代の事例として繰り返し引用される。",
    relatedWorks: [
      { title: "Beyoncé「Formation」(2016年）", description: "同じく黒人文化・政治性を音楽映像として表現した先例。「エンターテインメント×社会批評」の系譜。", url: "https://www.youtube.com/watch?v=WDZJPJV__bQ" },
      { title: "Residente「This is Not America」(2022年）", description: "直接的な応答作品。「America」という言葉の意味をラテンアメリカ側から問い直した。", url: "https://www.youtube.com/watch?v=GK87AKIPyZY" },
      { title: "Kendrick Lamar「Not Like Us」MV (2024年）", description: "同じく黒人アーティストが社会的問題意識を音楽と映像で表現した事例。「エンターテインメントが社会的宣言になる」という系譜の現代版。", url: "https://www.youtube.com/watch?v=H58vbez_m4E" }
    ]
  },
  {
    id: "adidas-original-never-finished",
    title: "ORIGINAL IS NEVER FINISHED（adidas Originals）",
    summary: "フランク・シナトラ「My Way」を現代スターたちが上書きし続ける——Snoop Dogg・Stormzy・Kareem Abdul-Jabbarたちが「オリジナルに終わりはない」を体現したadidas Originalsの宣言。",
    client: "adidas Originals",
    agency: "Johannes Leonardo（ニューヨーク）",
    categories: ["コンテンツ革新", "カルチャーインサイト", "ブランドエクスペリエンス"],
    award: "Cannes Lions 2017 Entertainment Lions for Music Grand Prix",
    year: "2017",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=w25rhdJNkrI",
    thumbnail: "https://i.ytimg.com/vi/w25rhdJNkrI/hqdefault.jpg",
    videoId: "w25rhdJNkrI",
    overview: "adidas Originalsのキャンペーン「Original is Never Finished」の核となった90秒のフィルム。フランク・シナトラの「My Way」をSnoop Dogg・Stormzy・Kareem Abdul-Jabbar・Ian Brown・Noel Gallagher等がリレーして歌い継ぐ構成。「過去の偉大さを否定するのではなく、その上に新しいオリジナルを積み重ねる」というブランドの哲学を、音楽の伝承という形で可視化した。",
    background: "adidasはNikeに対して「Originalityの象徴」というポジションを強化したかった。Johannes Leonardoはadidas Originalsの本質が「文化的継承と革新」にあると捉え、世代を超えた有名人が同じ曲を再解釈することで「オリジナルに終わりはない」を演出。フランク・シナトラの「My Way」という、世代を超えて知られる楽曲を選んだことが設計の核。",
    execution: "フィルム制作に加え、ユーザーがオンラインで自分のバージョンの「My Way」カバーを投稿するキャンペーンも実施。SNSでの二次拡散を前提にした構造。スポーツ・音楽・ファッションを横断する著名人の組み合わせが話題を多面的に生んだ。",
    evaluationImpact: "Cannes 2017 Entertainment Lions for Music Grand Prix受賞。adidas OriginalsのブランドポジションをNikeに対して「文化的継承者」として差別化する転換点となった。「ブランドのフィロソフィーを音楽で表現する」エンターテインメント広告の手本として継続的に引用される。",
    relatedWorks: [
      { title: "Nike「Dream Crazy」(2018年）", description: "同じスポーツブランドが翌年により政治的・文化的スタンスを取った事例。adidas OriginalsとNikeの「文化戦略」の比較軸として参照できる。", url: "https://www.youtube.com/watch?v=WW2yKSt2C_A" },
      { title: "Beyoncé「Formation」(2016年）", description: "同年期の「文化的継承と革新」を音楽で体現した事例。adidasの「原点を尊重しつつ更新する」というテーマと共鳴。", url: "https://www.youtube.com/watch?v=WDZJPJV__bQ" },
      { title: "Coca-Cola「Holidays Are Coming」から「Hilltop」まで（1971〜）", description: "世代を超えた楽曲がブランドのアイコンになるという長期事例。Original Is Never Finishedのコンセプトを商業的に最大化した先行事例。", url: "https://www.youtube.com/watch?v=1VM2eLhvsSM" }
    ]
  },
  {
    id: "beyonce-formation",
    title: "FORMATION（Beyoncé）",
    summary: "スーパーボウルのハーフタイムショー前日に突然公開——ニューオーリンズ・ブラック・パンサー・BLMを一曲に詰め込んだ「文化的爆弾」がキャンペーンとしてCannesで最高賞を受賞した。",
    client: "Beyoncé（Parkwood Entertainment）",
    agency: "Prettybird（制作会社）",
    categories: ["コンテンツ革新", "カルチャーインサイト", "社会包摂"],
    award: "Cannes Lions 2016 Entertainment Lions for Music Grand Prix / Grammy Best Music Video",
    year: "2016",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=WDZJPJV__bQ",
    thumbnail: "https://i.ytimg.com/vi/WDZJPJV__bQ/hqdefault.jpg",
    videoId: "WDZJPJV__bQ",
    overview: "2016年2月6日（スーパーボウル前日）に突然公開。ニューオーリンズの文化・カトリーナ後の惨状・ブラック・パンサー運動・南部の黒人文化を詰め込んだ4分半の映像。翌日のスーパーボウルハーフタイムショーで「Formation」を含むLemonadeのパフォーマンスを披露し、世界最大の広告媒体をアクティビズムの舞台に変えた。後に「Lemonade」ビジュアルアルバムの一部となった。",
    background: "2015年〜2016年はBlack Lives Matterが全米を席巻した時期。BeyoncéはFormationでBlack Panther（公民権運動）のシンボルを採用し、スーパーボウルという最も「商業的」な舞台で政治的メッセージを届けた。突然公開という戦略は「警告なし」という意図を持つとされ、文化的事件として即座に認識された。",
    execution: "MVを事前告知なしにYouTube・iTunesに突如公開。翌日のスーパーボウルでLemonadeのメドレーを披露。翌月「Lemonade」ビジュアルアルバムをHBOで公開し、その後Tidal独占配信。「作品を解体してリリースする」という段階的公開戦略が巨大な文化的事件を連続的に生み出した。",
    evaluationImpact: "Cannes 2016 Entertainment Lions for Music Grand Prix受賞。「最も商業的なメディア（スーパーボウル）を最も政治的に使った」事例として歴史に刻まれた。Rolling Stone誌「史上最高のミュージックビデオ」に選出。Beyoncéのキャリア最高傑作かつ2010年代ブラック・カルチャーの代表的芸術作品として引用される。",
    relatedWorks: [
      { title: "Beyoncé「Renaissance」World Tour & Film (2022〜2023年）", description: "同アーティストによるキャリアの次の章。Formationで確立した「政治性×エンターテインメント」の進化形。", url: "https://www.youtube.com/watch?v=01RW5OtnFkE" },
      { title: "Childish Gambino「This is America」(2018年）", description: "Formationの系譜を引き継ぐ「黒人文化×政治性」を音楽映像で表現した次世代の傑作。", url: "https://www.youtube.com/watch?v=VYOjWnS4cMY" },
      { title: "Prince「Purple Rain」スーパーボウル 2007年ハーフタイムショー", description: "スーパーボウルを「音楽的芸術表現の場」に変えた先例。Beyoncéのスーパーボウル戦略の前に存在する文脈。", url: "https://en.wikipedia.org/wiki/Super_Bowl_XLI_halftime_show" }
    ]
  },
  {
    id: "yonezu-kanden-stray-sheep",
    title: "米津玄師「感電」YouTubeチャンネルハック",
    summary: "500万人登録のYouTubeチャンネルを「404 NOT FOUND」でジャック——羊の絵文字によるモールス信号でファンを巻き込んだMV公開プロモーション。",
    client: "米津玄師（Sony Music Labels）",
    agency: "MIDDLE8（博報堂）",
    categories: ["メディア発明", "コンテンツ革新", "カルチャーインサイト"],
    award: "ACC TOKYO CREATIVITY AWARDS グランプリ（メディアクリエーティブ部門）/ Spikes Asia シルバー",
    year: "2020",
    regions: ["国内"],
    link: "https://www.hakuhodo.co.jp/middle8/works/work3.html",
    thumbnail: "https://i.ytimg.com/vi/UFQEttrn6CQ/hqdefault.jpg",
    videoId: "UFQEttrn6CQ",
    overview: "2020年8月5日、米津玄師5thアルバム「STRAY SHEEP（迷える羊）」収録曲「感電」のMV公開にあたり、登録者500万人を超える公式YouTubeチャンネルの全サムネイルを「404 NOT FOUND」エラー画面に差し替える仕掛けを実施。さらに各動画のコメント欄に羊の絵文字（🐑）でモールス信号を埋め込み、ファンが解読することで「感電」のMVに辿り着けるという謎解き体験を設計した。",
    background: "アルバムタイトル「STRAY SHEEP（迷える羊）」のコンセプトから、ファンを「迷える羊」として位置付け、チャンネル内を「迷わせる」体験を設計。米津玄師側からのリクエストで「ファンとの遊び」を大切にした演出を求めた。当時YouTubeを主要プロモーションチャンネルとする中で、そのチャンネル自体をハックするという大胆な発想が生まれた。",
    execution: "MV公開前日、公式YouTubeチャンネルの全サムネイルが突如「404 NOT FOUND」表示に変わる。各動画コメント欄に🐑の絵文字でモールス信号が投稿され、ファンが集合知で解読。「感電」のMVへのリンクが明らかになる。翌日MV公開後も、アルバムのコンセプト「迷える羊」とのリンクが語られ話題が持続した。",
    evaluationImpact: "ACC TOKYO CREATIVITY AWARDS グランプリ（メディアクリエーティブ部門）、Spikes Asia シルバー（デジタル・PR各1件）受賞。MV公開後24時間でYouTube急上昇1位。ファンが謎解きに参加しSNSで拡散したことで、広告費ゼロでのバイラルを実現。「プラットフォーム自体をメディアにする」アイデアとして日本の広告業界で代表事例となった。",
    relatedWorks: [
      { title: "Tracking Bad Bunny（2025年）", description: "Googleストリートビューを音楽プロモーションに転用した構造がほぼ同一。「既存インフラをジャック／転用してファンを巻き込む謎解き」という国際版として参照できる。", url: "https://www.youtube.com/watch?v=wTMC_zesAt4" },
      { title: "Kenshi Yonezu「地球儀」× Ghibli（2023年）", description: "同アーティストによる別のプロモーション文脈の事例。「感電」が戦略的話題設計であるのに対し「地球儀」は「歴史的事実」が話題になるという対比。", url: "https://www.youtube.com/watch?v=VUsURj_OYdA" },
      { title: "UNIQLOCK（2008年）", description: "日本発・博報堂系で「既存プラットフォームをコンテンツに変える」発想の系譜として比較できる。「感電」のYouTubeハックはUNIQLOCKの精神的後継。", url: "https://www.campaignasia.com/article/uniqlo-japan-wins-cyber-grand-prix-at-cannes/206499" }
    ]
  },
  {
    id: "coldplay-ecorecord",
    title: "EcoRecord（Coldplay × Moon Music）",
    summary: "廃プラスチックボトル9本からヴァイナルレコード1枚を製造——Coldplayが「Moon Music」で音楽業界初の大規模エコレコード量産を実現し、業界の環境基準を動かした。",
    client: "Coldplay / Warner Music Group",
    agency: "Sonopress GmbH（製造技術）",
    categories: ["テクノロジー×アイデア", "カルチャーインサイト", "社会包摂"],
    award: "Clio Music 2025 Grand Prix（Sustainability部門）",
    year: "2024",
    regions: ["グローバル", "欧州"],
    link: "https://www.youtube.com/watch?v=3wO7aIw75-I",
    thumbnail: "https://i.ytimg.com/vi/3wO7aIw75-I/hqdefault.jpg",
    videoId: "3wO7aIw75-I",
    overview: "2024年10月リリースのColdplayアルバム「Moon Music」のヴァイナルレコードを、廃棄プラスチックボトルをリサイクルして製造した「EcoRecord」として発売。従来のPVC（塩化ビニル）製レコードに比べCO2排出量を約90%削減。ソノプレス社（ドイツ）との協力で世界初の大量量産エコレコードを実現。Coldplayは過去のアルバム9作品もEcoRecordとして再リリースした。",
    background: "Coldplayは「Music of the Spheres World Tour（2022〜）」から「サステナブルツアー」を宣言し、再生可能エネルギー・植林・CO2削減を系統的に実施してきた。ヴァイナルレコードは音楽業界の中で数少ない「物理的製造物」であり、その製造プロセスの環境負荷が問題視されていた。EcoRecordはその課題への最も直接的な技術的回答。",
    execution: "ドイツのSonopress社が廃プラスチックからレコードを製造する技術を開発・採用。廃棄プラスチックボトルを洗浄・粉砕・成型してレコードを作るという工程を映像化しプロモーションに活用。音質はPVC製と同等とされ、「エコ＝品質妥協」という認識を否定した。Warner Music GroupがColdplayのプロジェクトに協力し、業界全体への波及を意図した。",
    evaluationImpact: "Clio Music 2025 Grand Prix（Sustainability部門）受賞。音楽業界でのヴァイナル製造方法に関する議論が活性化。Coldplayのサステナビリティへのコミットメントは「パフォーマンスではなく実装」として批評家から評価された。複数のレーベルがEcoRecord技術の採用を検討し始めた。",
    relatedWorks: [
      { title: "DP World「Move to -15°C」(2024年）", description: "同じく「業界基準そのものを変える」ことをクリエイティブとした事例。Coldplay EcoRecordはDP World -15°Cの音楽業界版として並べて語れる。", url: "https://www.dpworld.com/" },
      { title: "Patagonia「Don't Buy This Jacket」(2011年）", description: "自社製品の環境負荷を認めてサステナビリティを訴えた先例。ブランドが「自己批判的な誠実さ」を持つ事例として共鳴。", url: "https://www.patagonia.com/stories/dont-buy-this-jacket/story-18615.html" },
      { title: "Taylor Swift「Eras Tour」(2023年）", description: "同時期の大型音楽プロジェクト。Swiftのツアーが環境負荷で批判された一方でColdplayが具体的解決策を提示したという対比。", url: "https://www.youtube.com/watch?v=rRjTdbmpQxM" }
    ]
  }
];

const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
const existingIds = new Set(cases.map(c => c.id));
const toAdd = newCases.filter(c => !existingIds.has(c.id));
// 最新追加が先頭になるよう先頭に挿入
const updated = [...toAdd, ...cases];
await fs.writeFile(CASES_PATH, JSON.stringify(updated, null, 2));
console.log(`追加: ${toAdd.length}件 / スキップ: ${newCases.length - toAdd.length}件`);
console.log(`合計: ${updated.length}件`);
