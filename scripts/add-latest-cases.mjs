import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");

const newCases = [
  {
    id: "mercado-livre-field-barcode",
    title: "FIELD BARCODE（Mercado Livre）",
    summary: "ブラジルの名門スタジアム「パカエンブー」のピッチ全体（104m幅）を巨大なバーコードに変え、スタンドからスキャンするとMercado Livreのセール商品が即購入できる——スポーツとEコマースを融合したOOH革新。",
    client: "Mercado Livre",
    agency: "GUT São Paulo",
    categories: ["OOH革新", "テクノロジー×アイデア", "メディア発明"],
    award: "Cannes Lions 2026 Outdoor Grand Prix",
    year: "2026",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=0R4EG1IZ7lE",
    thumbnail: "https://i.ytimg.com/vi/0R4EG1IZ7lE/hqdefault.jpg",
    videoId: "0R4EG1IZ7lE",
    overview: "ブラジルの歴史的スタジアム「パカエンブー」（Mercado Livre Arenaとして運営）のサッカーピッチ全体を、実際にスキャン可能な巨大バーコード（104m幅）として設計。試合観戦中のファンがスマートフォンでスタンドからピッチを撮影するだけでMercado Livreのセール商品を即座に購入できる仕組みを構築した。",
    background: "Mercado Livreはラテンアメリカ最大のEコマースプラットフォームで、スポーツスポンサーシップの文脈で「リアルタイムの購買体験」を実現したかった。試合会場という「スマートフォンを持った人が一斉に同じ方向を向く場所」という特性を逆手に取った発想。",
    execution: "スタジアムのピッチを実際に機能するQRバーコードとして芝を設計・設置。試合中の観客が当該セクションからスマートフォンを向けてスキャンすると、Mercado Livreの試合連動特価セールに直結する。スタジアムスポンサーシップとデジタルEコマースを物理的に一体化した事例。",
    evaluationImpact: "Cannes Lions 2026 Outdoor Grand Prix受賞。「スタジアムそのものをショッピングカートの入口にする」という発想が審査員に高く評価された。OOHとEコマースの融合という新カテゴリを確立した事例として引用される。",
    relatedWorks: [
      { title: "Mercado Livre「Call of Discounts」(2025年）", description: "同クライアントによる前作Cannes Grand Prix。POSシステムを盗難被害者の緊急システムに転用した事例。", url: "https://www.youtube.com/watch?v=9OyHDyI2fpM" },
      { title: "TrackingBadBunny（2025年）", description: "実際の地理空間を活用して音楽とショッピングを結びつけた同年度の近似事例。", url: "https://www.youtube.com/watch?v=wTMC_zesAt4" },
      { title: "「Dark Mode Ads」Plenitude（2026年）", description: "既存のメディア（DOOH）の技術仕様を逆手に取った同年のOOH革新事例。", url: "https://corporate.eniplenitude.com/en/about/partnerships-and-events/darkmodeads" }
    ]
  },
  {
    id: "the-ordinary-periodic-fable",
    title: "THE PERIODIC FABLE（The Ordinary）",
    summary: "美容業界の「科学的っぽいが意味のない言葉」に正面から反論——The OrdinaryがCannes 2026でHealth & Wellness Grand Prixを受賞した、美容マーケティングの欺瞞を告発する寓話広告。",
    client: "The Ordinary（DECIEM）",
    agency: "Uncommon Creative Studio / Smuggler London",
    categories: ["カルチャーインサイト", "コンテンツ革新", "社会包摂"],
    award: "Cannes Lions 2026 Health & Wellness Grand Prix",
    year: "2026",
    regions: ["グローバル"],
    link: "https://www.youtube.com/watch?v=Ev3KoGalZdM",
    thumbnail: "https://i.ytimg.com/vi/Ev3KoGalZdM/hqdefault.jpg",
    videoId: "Ev3KoGalZdM",
    overview: "美容業界で横行する「科学的に聞こえるが実証されていない」マーケティング言語（「細胞レベルで再生」「量子エネルギー注入」等）を寓話（ファブル）形式で批判したキャンペーン。The Ordinaryの「成分を正直に表示する」というブランドポリシーを、業界全体への告発として視覚化した。",
    background: "The Ordinary（DECIEM）は「美容業界の誇大広告に反対し、成分をそのまま正直に表示する」というブランドアイデンティティで成長した。Uncommon Creative Studioが「競合他社の誇大広告を寓話として告発する」というアプローチを提案し、業界全体への公開状として制作された。",
    execution: "架空の美容ブランドが「時代の流行語（量子・AI・バイオハック等）」を使った架空の製品プロモーションを寓話形式で展開し、最後に「The Ordinaryはこうした言葉を使わない」というメッセージで締める。Smuggler London制作の映像は「お伽話」の絵本スタイルで制作。",
    evaluationImpact: "Cannes Lions 2026 Health & Wellness Grand Prix受賞。「競合批判」ではなく「業界批判」という設計が誠実さを担保した。美容・ウェルネス広告の言語規制議論を再燃させ、業界団体が自主基準見直しを検討した。",
    relatedWorks: [
      { title: "Dove「Real Beauty Redefined for the AI Era」(2024年）", description: "同じく美容業界の「作られた美」への反論キャンペーン。AI生成美女問題へのDoveの回答。", url: "https://www.youtube.com/watch?v=8vYoL8nga-A" },
      { title: "Dove「Evolution」(2006年）", description: "美容業界の「作られた美」を暴いた原点。The Periodic Fableの20年後の後継事例として系譜が繋がる。", url: "https://www.youtube.com/watch?v=iYhCn0jf46U" },
      { title: "Burger King「Moldy Whopper」(2020年）", description: "「業界の暗黙のルールを逆手に取って正直さを体現する」という同じ設計思想。", url: "https://www.youtube.com/watch?v=f9B9HGQsx0k" }
    ]
  },
  {
    id: "hyundai-coqui-alarmed",
    title: "COQUÍ ALARMED（Hyundai Puerto Rico）",
    summary: "車の「ピッ」という施錠音をプエルトリコの固有種カエル「コキー」の鳴き声に差し替えた——Hyundaiがレンタカーをプエルトリコ文化のサウンドアンバサダーにしたAudio & Radio Grand Prix。",
    client: "Hyundai Puerto Rico",
    agency: "BBDO Puerto Rico",
    categories: ["カルチャーインサイト", "ブランドエクスペリエンス", "メディア発明"],
    award: "Cannes Lions 2026 Audio & Radio Grand Prix",
    year: "2026",
    regions: ["北米"],
    link: "https://www.youtube.com/watch?v=dpldl5xHJio",
    thumbnail: "https://i.ytimg.com/vi/dpldl5xHJio/hqdefault.jpg",
    videoId: "dpldl5xHJio",
    overview: "Hyundai Puerto Ricoがレンタカー会社と提携し、プエルトリコで貸し出されるHyundai車の「キーロック音（ピッ）」を、プエルトリコ固有種のカエル「コキー（Coquí）」の鳴き声に変更した。コキーはプエルトリコのナショナルシンボルで、島外では鳴かないとされる。観光客がレンタカーを施錠するたびにプエルトリコ文化を体験するという設計。",
    background: "プエルトリコのナショナルシンボルとして知られるコキーガエルは、島の外に持ち出すと鳴き声が変わるという特性があり「プエルトリコの魂は島を離れない」というメタファーを持つ。Hyundaiはこの文化的シンボルを車の機能音に埋め込むことで、レンタカーを「文化体験の媒体」にした。",
    execution: "車の工場出荷設定の「施錠音」をソフトウェアアップデートでコキーの鳴き声に変更するシステムを開発。プエルトリコ内のHyundaiレンタカー全車両に実装。観光客が施錠するたびに思わずスマホで動画を撮影してSNSに投稿し、プエルトリコ文化の有機的な宣伝に繋がった。",
    evaluationImpact: "Cannes Lions 2026 Audio & Radio Grand Prix受賞。「音」という最も普段意識されない車の機能をキャンペーンの核にした独自性が高評価。観光客のSNS投稿が観光プロモーションとして機能する二重設計も評価された。",
    relatedWorks: [
      { title: "Specsavers「The Misheard Version」(2023年）", description: "「音を変える」という同じアプローチで聴力啓発を実現したCannes PR Grand Prix受賞作。", url: "https://www.youtube.com/watch?v=f8y8hay39QQ" },
      { title: "エキマトペ（JR東日本、2021年）", description: "音の体験を視覚化してインクルーシブなコミュニケーションを実現した日本の近似事例。", url: "https://www.youtube.com/watch?v=QE3YSkWUIco" },
      { title: "Palau Pledge（2017年）", description: "観光客の「体験」に地域文化の価値を埋め込む設計として系譜が共鳴する。", url: "https://www.palaupledge.com/" }
    ]
  },
  {
    id: "unhcr-gamechanging-team",
    title: "GAMECHANGING TEAM（UNHCR × Alphonso Davies）",
    summary: "FIFA World Cup 2026開幕直前、難民出身のサッカー選手11人で「象徴チーム」を結成——AI映像で子ども時代と現在を重ね、難民キャンプからプロまでの旅を可視化した。",
    client: "UNHCR（国連難民高等弁務官事務所）",
    agency: "（UNHCR内製 + AI映像制作）",
    categories: ["社会包摂", "AIクリエイティブ", "カルチャーインサイト"],
    award: "（受賞情報なし）",
    year: "2026",
    regions: ["グローバル"],
    link: "https://www.unhcr.org/news/press-releases/uprooted-unstoppable-unhcrs-gamechanging-team-captained-alphonso-davies",
    thumbnail: "https://i.ytimg.com/vi/Tgx-n4UNNoY/hqdefault.jpg",
    videoId: "Tgx-n4UNNoY",
    overview: "FIFA World Cup 2026開幕に合わせUNHCRが発表。難民または避難経験を持つ現役プロサッカー選手11名（Alphonso Davies・Antonio Rüdiger・Eduardo Camavinga・Asmir Begovic等）で構成される「象徴チーム」を結成。AI支援映像制作で選手の子ども時代（難民キャンプ等）と現在のプロ選手姿を重ね合わせ、難民が抱える可能性を世界に訴えた。",
    background: "FIFA World Cup 2026がカナダ・アメリカ・メキシコ共催で開催されるタイミングに合わせ、UNHCRが「スポーツは難民に再起の機会を与える」というメッセージを最大限に可視化する機会と捉えた。カナダ代表主将のAlphonso Davies自身がガーナの難民キャンプ出身という経緯があり、キャプテンとして起用。",
    execution: "AI補助映像制作技術を使い、各選手の子ども時代の難民キャンプ写真と現在のプロ選手映像を並置・融合させたショートフィルムを制作。国連本部ロビーに「Uprooted to Unstoppable」壁画を設置（カナダ人アーティストCarling Jackson制作）。SNSで各選手のストーリーを段階的に公開しフォロワー参加を促した。",
    evaluationImpact: "FIFA World Cup 2026期間中の難民支援への認知拡大に貢献。「世界最大のスポーツイベントを難民問題の文脈に置き換える」という戦略的タイミング設計が高く評価された。Alphonso Davies自身の個人的背景がキャンペーンに真実性を与えた。",
    relatedWorks: [
      { title: "#StillSpeakingUp（RSF、2021年）", description: "迫害された人々をAIで「再生」させて声を届けた同系譜の社会包摂AI映像キャンペーン。", url: "https://www.lovethework.com/campaigns/stillspeakingup-deeptruth-710063" },
      { title: "Nike「Dream Crazy」(2018年）", description: "スポーツと社会正義を結びつけたCannes Titanium Grand Prix。スポーツを社会メッセージの媒体にする同設計。", url: "https://www.youtube.com/watch?v=WW2yKSt2C_A" },
      { title: "EA Sports「Long Live the Prince」(2022年）", description: "失われた可能性をデジタルで蘇らせた同系譜。「あの子が今生きていれば」という問いを視覚化。", url: "https://lbbonline.com/news/digitally-resurrecting-kiyan-prince-to-prevent-knife-crime" }
    ]
  },
  {
    id: "fanduel-dual-fan",
    title: "DUAL FAN（FanDuel）",
    summary: "「カナダ人の43%がFIFA W杯で複数国を応援する」というインサイトから生まれた両面スカーフ——片面はカナダ、もう片面は先祖の国の旗デザインで「二重のアイデンティティ」を可視化した。",
    client: "FanDuel",
    agency: "OneMethod（トロント）",
    categories: ["カルチャーインサイト", "ブランドエクスペリエンス", "社会包摂"],
    award: "（受賞情報なし）",
    year: "2026",
    regions: ["北米"],
    link: "https://www.adsoftheworld.com/campaigns/dual-fan",
    thumbnail: "https://picsum.photos/seed/fanduel-dual-fan/1200/630",
    videoId: "",
    overview: "Angus Reidの調査でカナダのサッカーファンの43%がFIFA W杯開催中に複数の国を応援する計画があることが判明。FanDuelとOneMethodは「レイヤード・ファンダム（重層的な帰属意識）」を可視化するため、カナダと参加48カ国をペアにした限定版両面スカーフを製作。片面をカナダ、もう片面を各人の先祖の国のカラーで染め分けた。",
    background: "FIFA World Cup 2026がカナダ国内開催となり、移民大国カナダの「複数のアイデンティティを持つファン」という独自のインサイトを発見。「どの国を応援するか」という二項対立を超え「両方応援して何が悪い」という価値観を体現するプロダクトを開発した。",
    execution: "48参加国すべてとカナダのコンビネーションスカーフを制作。インフルエンサーへのシード配布・ウォッチパーティでの配布・FanDuelラッピングストリートカーでの景品として展開。SNSでの「#DualFan」投稿を促し、多文化コミュニティの共感を獲得。",
    evaluationImpact: "アナログ（物理的なスカーフ）でありながら移民コミュニティのSNSシェアを促進し、FanDuelとスポーツ観戦文化の繋がりを多文化家族層に訴求。W杯開催国という立地を活かした多文化マーケティングの好例。",
    relatedWorks: [
      { title: "Palau Pledge（2017年）", description: "観光客に「場所への帰属」を物理的なスタンプで表現した先行事例。物理的なオブジェクトがアイデンティティを可視化する設計。", url: "https://www.palaupledge.com/" },
      { title: "Coca-Cola「I'd Like to Buy the World a Coke」(1971年）", description: "多様な人々の「共存」をプロダクトで可視化した原点的広告。DualFanと同じ「多様性の統合」テーマ。", url: "https://www.youtube.com/watch?v=1VM2eLhvsSM" },
      { title: "UNHCR「Gamechanging Team」(2026年）", description: "同じFIFA World Cup 2026を文脈に、「複数のルーツを持つ人々」を主役にした同時期の事例。", url: "https://www.unhcr.org/gamechangers" }
    ]
  },
];

const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
const existingIds = new Set(cases.map(c => c.id));
const toAdd = newCases.filter(c => !existingIds.has(c.id));
const updated = [...toAdd, ...cases];
await fs.writeFile(CASES_PATH, JSON.stringify(updated, null, 2));
console.log(`追加: ${toAdd.length}件 / 合計: ${updated.length}件`);
toAdd.forEach(c => console.log(`  + ${c.title} (${c.year})`));
