/**
 * Case Study リサーチ v3（docs/CASE_RESEARCH_V3_SPEC.md §2・§4）の純関数群。
 * auto-research-cc.mjs から使う。I/O・モデル呼び出しは持たない（テスト容易性のため）。
 *
 *   - 鮮度: 作品の公開・発表が固定14日以内
 *   - 4レンズ × 多言語: 毎日4レンズとも回す。英語・日本語は常に、加えて中国語/韓国語/スペイン語・ポルトガル語/
 *     フランス語/ドイツ語の5言語を2言語ずつ日替わりで割り当て、4レンズ合計で5言語が毎日すべて使われるようにずらす
 *   - 最終 tier の決定（関門1×関門2）・採用枠（accept 最大10 + borderline 別枠最大3、gateScore 上位）
 *   - 不足時の追加ラウンド（accept < 5 のとき、accept の少ないレンズを未使用言語で最大2回）
 */

export const FRESHNESS_DAYS = 14;
export const LENS_COUNT = 4;
export const MAX_ACCEPT = 10;
export const MAX_BORDERLINE = 3;
export const MIN_ACCEPT_BEFORE_EXTRA = 5;
export const MAX_EXTRA_ROUNDS = 2;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ymdJst = (d) => new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);

/** 鮮度の窓（JST暦日）。前回調査日には依存しない固定日数。 */
export function freshnessWindow(now = new Date()) {
  const cutoff = new Date(now.getTime() - FRESHNESS_DAYS * 86400000);
  return { days: FRESHNESS_DAYS, cutoffYmd: ymdJst(cutoff), todayYmd: ymdJst(now) };
}

// ── 言語 ────────────────────────────────────────────────────

/**
 * レンズ別の「物差し」（受賞作の具体例は data/case-gate.json の litmus。ここは賞名のみ）。
 * レンズ番号はコード側の固定（data/research-tuning.json の cc.roundFoci の並びと対応）。
 */
export const LENS_YARDSTICKS = [
  "Cannes Lions Grand Prix／D&AD Pencil／ADC Cube／One Show Pencil／Clio Grand の近年作",
  "D&AD Graphic・Digital Design／Information is Beautiful Awards／Type Directors Club／ADC Design の近年作",
  "Ars Electronica Prix・STARTS Prize／Dezeen Awards／建築・デザインのビエンナーレの近年作",
  "アワード向きでない実験・手法の発明（物差しは基準D。受賞の有無・完成度は問わない）",
];

/** 日替わりで回す言語（5つ）。en/ja は常に使うので含めない。 */
export const ROTATING_LANG_IDS = ["zh", "ko", "es", "fr", "de"];

// 各言語の表示名と、レンズ別（index 0..3）の検索語の例。検索語はあくまで例（そのまま使う必要はない）。
export const LANGUAGES = {
  en: {
    label: "英語",
    terms: [
      ["award-winning campaign", "experiential activation case study", "media invention OOH stunt"],
      ["brand identity generative", "data visualization new project", "typography experimental", "interactive web design"],
      ["computational architecture", "digital fabrication craft", "media art installation", "material research bio-design"],
      ["creative coding experiment", "generative sensing robotics performance", "new technique prototype"],
    ],
  },
  ja: {
    label: "日本語",
    terms: [
      ["広告 話題 施策 アイデア", "体験型 キャンペーン 事例", "メディア発明 屋外広告"],
      ["ブランドアイデンティティ 新作", "データビジュアライゼーション 新作", "タイポグラフィ 実験", "インタラクティブ Webサイト 手法"],
      ["メディアアート 展示 新作", "伝統工芸 デジタルファブリケーション", "計算設計 建築 新作", "素材研究 バイオ"],
      ["実験 プロトタイプ 手法 公開", "生成 センシング 映像 ライブ演出", "個人制作 新しい表現"],
    ],
  },
  zh: {
    label: "中国語",
    terms: [
      ["创意广告 获奖 案例", "品牌营销 互动装置 案例", "户外广告 创新 媒介"],
      ["品牌视觉 设计 新作", "数据可视化 新作", "字体设计 实验", "交互设计 网站 创意"],
      ["数字艺术 装置 展览", "参数化设计 建筑 新作", "数字制造 传统工艺", "新材料 设计 研究"],
      ["生成式 艺术 实验 技术", "创意科技 互动 新方法", "机器人 传感 表演"],
    ],
  },
  ko: {
    label: "韓国語",
    terms: [
      ["광고 캠페인 수상작", "브랜드 마케팅 아이디어 사례", "옥외광고 미디어 혁신"],
      ["브랜드 아이덴티티 신작", "데이터 시각화 신작", "타이포그래피 실험", "인터랙티브 웹 디자인"],
      ["미디어 아트 전시 신작", "건축 컴퓨테이셔널 디자인", "디지털 패브리케이션 공예", "소재 연구 디자인"],
      ["크리에이티브 코딩 실험", "생성형 센싱 로보틱스 퍼포먼스", "새로운 표현 기법"],
    ],
  },
  es: {
    label: "スペイン語・ポルトガル語（スペイン/中南米/ブラジル）",
    terms: [
      ["campaña publicitaria premiada", "ação criativa campanha premiada", "innovación en medios publicidad exterior"],
      ["identidad de marca nueva", "visualización de datos nuevo proyecto", "tipografía experimental", "design interativo site"],
      ["arte digital instalación", "arquitectura computacional", "fabricación digital artesanía", "pesquisa de materiais design"],
      ["experimento creativo código", "arte generativo sensores robótica", "nueva técnica prototipo"],
    ],
  },
  fr: {
    label: "フランス語",
    terms: [
      ["campagne publicitaire primée", "dispositif d'activation créatif", "invention média affichage"],
      ["identité de marque nouvelle", "data visualisation nouveau projet", "typographie expérimentale", "design interactif site"],
      ["art numérique installation", "architecture computationnelle", "fabrication numérique artisanat", "recherche matériaux design"],
      ["expérimentation code créatif", "art génératif capteurs robotique", "nouvelle technique prototype"],
    ],
  },
  de: {
    label: "ドイツ語",
    terms: [
      ["preisgekrönte Kampagne", "kreative Aktivierung Fallstudie", "Medienerfindung Außenwerbung"],
      ["Markenidentität neu", "Datenvisualisierung neues Projekt", "experimentelle Typografie", "interaktives Webdesign"],
      ["Medienkunst Installation", "computergestützte Architektur", "digitale Fertigung Handwerk", "Materialforschung Design"],
      ["kreatives Coding Experiment", "generative Kunst Sensorik Robotik", "neue Technik Prototyp"],
    ],
  },
};

/**
 * 日替わり言語割り当て。戻り値は lens index 0..lensCount-1 ごとの言語id配列（[en, ja, 回転枠1, 回転枠2]）。
 * 回転枠は 8スロット（4レンズ×2）を ROTATING_LANG_IDS(5) で巡回させるので、
 *   - 同じレンズ内の2言語は重複しない（隣り合うスロットは常に別言語）
 *   - 8 ≥ 5 なので毎日5言語すべてがどこかのレンズで使われる
 *   - 日ごとに 8mod5=3 ずつずれるので同じ言語が同じレンズに固定されない
 */
export function lensLanguagePlan(dayIndex, lensCount = LENS_COUNT) {
  const n = ROTATING_LANG_IDS.length;
  const slotsPerLens = 2;
  const plan = [];
  for (let lens = 0; lens < lensCount; lens++) {
    const langs = ["en", "ja"];
    for (let k = 0; k < slotsPerLens; k++) {
      const slot = lens * slotsPerLens + k;
      langs.push(ROTATING_LANG_IDS[(((dayIndex * lensCount * slotsPerLens + slot) % n) + n) % n]);
    }
    plan.push(langs);
  }
  return plan;
}

/** 4レンズを毎日1回ずつ回す順序（0始まりのlens index の順列）。開始位置だけ日替わりで、特定レンズが毎日最後にならないようにする。 */
export function lensOrderForDay(dayIndex, lensCount = LENS_COUNT) {
  const start = ((dayIndex % lensCount) + lensCount) % lensCount;
  return Array.from({ length: lensCount }, (_, i) => (start + i) % lensCount);
}

/**
 * 発見プロンプトの「検索言語」節。langIds の各言語について検索語の例（lensIndex に対応する行）を示す。
 * 検索語は例であって、そのまま使う必要はない。記事（出力）は日本語。
 */
export function languageSection(langIds, lensIndex = 0, { extra = false } = {}) {
  const lines = [];
  for (const id of langIds) {
    const lang = LANGUAGES[id];
    if (!lang) continue;
    const rows = lang.terms[lensIndex % lang.terms.length] || lang.terms[0];
    lines.push(`- ${lang.label}: ${rows.map((t) => `「${t}」`).join(" / ")}`);
  }
  if (!lines.length) lines.push("- （当日このテーマで未使用の言語は残っていない。通常ラウンドで使っていない検索語・切り口で探す）");
  const head = extra
    ? "## 検索言語（追加ラウンド。通常ラウンドで未使用の言語と、別の検索語で探す）"
    : "## 検索言語（このテーマは下記の言語それぞれで検索する。英語・日本語は毎回、残りは日替わり）";
  return `${head}
${lines.join("\n")}
- 検索語は例（そのまま使う必要はない）。各言語の現地の専門メディア・賞の発表ページ・SNSの話題を、その言語の検索語で自分で探す。
- 検索結果の言語に関わらず、記事・note等の出力は日本語で書く（titleは原題＝正式名称のままでよい）。`;
}

// ── 最終 tier・採用枠 ───────────────────────────────────────

/**
 * 最終 tier の決定。最終判定は関門2（記事化時）: accept→accept / borderline→borderline / reject→却下(null)。
 * 関門1が reject の候補は記事化に進まない（null）。関門1 accept でも関門2 が borderline なら borderline、
 * 関門1 borderline でも関門2 が accept なら accept。
 */
export function decideFinalTier(gate1Verdict, gate2Verdict) {
  if (gate1Verdict !== "accept" && gate1Verdict !== "borderline") return null;
  if (gate2Verdict === "accept") return "accept";
  if (gate2Verdict === "borderline") return "borderline";
  return null;
}

const scoreOf = (it) => (Number.isFinite(it?.gateScore) ? it.gateScore : 0);

/**
 * 採用枠の適用。accept は先着で最大 maxAccept 件、borderline は別枠で gateScore 降順（同点は先着）に最大 maxBorderline 件。
 * accept が多い日でも borderline 枠は維持される。枠外は reason 付きで dropped に返す（却下ログ用）。
 * 入力は破壊しない。adopted は accept（入力順）→ borderline（gateScore 降順）の順。
 */
export function selectAdoptions(items, { maxAccept = MAX_ACCEPT, maxBorderline = MAX_BORDERLINE } = {}) {
  const list = Array.isArray(items) ? items : [];
  const accepts = list.filter((x) => x?.tier === "accept");
  const borders = list
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => x?.tier === "borderline")
    .sort((a, b) => scoreOf(b.x) - scoreOf(a.x) || a.i - b.i)
    .map(({ x }) => x);
  const adopted = [...accepts.slice(0, maxAccept), ...borders.slice(0, maxBorderline)];
  const dropped = [
    ...accepts.slice(maxAccept).map((item) => ({ item, reason: "accept-over-cap" })),
    ...borders.slice(maxBorderline).map((item) => ({ item, reason: "borderline-over-cap" })),
  ];
  return { adopted, dropped };
}

// ── 不足時の追加ラウンド ────────────────────────────────────

/** 4レンズ終了時点（またはその後）で、追加ラウンドを回すか。基準は緩めない（件数が足りなくても回すのは探索だけ）。 */
export function shouldRunExtraRound({ acceptCount, extraDone, elapsedMs, budgetMs }) {
  if (acceptCount >= MIN_ACCEPT_BEFORE_EXTRA) return false;
  if (extraDone >= MAX_EXTRA_ROUNDS) return false;
  return elapsedMs < budgetMs;
}

/**
 * 追加ラウンドの計画。accept 数の少ないレンズ（同数なら追加回数の少ない順→レンズ番号順）を選び、
 * そのレンズで当日まだ使っていない回転言語（最大2つ）を割り当てる。未使用言語が尽きていれば langs は空
 * （別の検索語・別の切り口のみで追加）。variant は当該レンズの追加ラウンド通し番号（1始まり）。
 */
export function planExtraRound({ dayIndex, acceptByLens, usedLangsByLens, extraByLens }) {
  const n = acceptByLens.length;
  let lensIndex = 0;
  for (let i = 1; i < n; i++) {
    const better =
      acceptByLens[i] < acceptByLens[lensIndex] ||
      (acceptByLens[i] === acceptByLens[lensIndex] && (extraByLens[i] || 0) < (extraByLens[lensIndex] || 0));
    if (better) lensIndex = i;
  }
  const used = usedLangsByLens[lensIndex] || new Set();
  const start = ((dayIndex % ROTATING_LANG_IDS.length) + ROTATING_LANG_IDS.length) % ROTATING_LANG_IDS.length;
  const unused = [];
  for (let k = 0; k < ROTATING_LANG_IDS.length; k++) {
    const id = ROTATING_LANG_IDS[(start + k) % ROTATING_LANG_IDS.length];
    if (!used.has(id)) unused.push(id);
  }
  return { lensIndex, langs: unused.slice(0, 2), variant: (extraByLens[lensIndex] || 0) + 1 };
}

/**
 * 実行サマリー用: レンズ別・tier別の件数を1レンズ1行で整形する。
 * stats[i] = { candidates, gate1: {accept, borderline, reject}, adopted: {accept, borderline} }
 */
export function formatLensTierSummary(stats, labels = []) {
  return stats
    .map((s, i) => {
      const g = s.gate1 || {};
      const a = s.adopted || {};
      const name = labels[i] ? `（${String(labels[i]).slice(0, 14)}）` : "";
      return `レンズ${i + 1}${name}: 候補${s.candidates || 0} / 関門1 accept ${g.accept || 0} borderline ${g.borderline || 0} reject ${g.reject || 0} / 採用 accept ${a.accept || 0} + borderline ${a.borderline || 0}`;
    })
    .join("\n");
}
