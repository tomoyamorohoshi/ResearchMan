/**
 * 週次チューンアップ（scripts/biweekly-tuneup.mjs。ファイル名は後方互換で維持しているが実体は
 * 週次実行）の分析パス1「リサーチ計画」・分析パス2「アイデア構造見直し」のプロンプト組み立て。
 *
 * biweekly-tuneup.mjsのmain()は即時実行スクリプトのため単体テストできない
 * （OPERATIONS.md「main()を即実行するスクリプトをimportしない」参照）。ここへ切り出すことで
 * 実ファイルI/O・実Claude CLI呼び出しなしに「ごみ箱（弱化シグナル）・ユーザー追加事例
 * （強化シグナル）・アイデア評価シグナル（いいね=強化・ゴミ箱=弱化）が正しくプロンプト文字列に
 * 含まれるか、該当0件時にセクションが省略されるか」を単体検証できる
 * （scripts/smoke-tuneup-prompts.mjs 参照）。
 */

// v3: 1つの配列セクションに流す件数の上限（プロンプト肥大＝ENAMETOOLONG事故の再発防止。全文は流さない）
export const V3_PROMPT_LIMITS = { borderlineExamples: 12, rejectionSamples: 10, sourcesLines: 70, titleMax: 60, summaryMax: 80, recentProposals: 5, proposalTextMax: 200 };

const clipText = (s, n) => {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/**
 * v3（docs/CASE_RESEARCH_V3_SPEC.md §5）の追加入力セクション。v3Input が無ければ空文字（後方互換）。
 * v3Input: { tierStats, lensStats, rejectionSummary, criteria:[{id,text}], litmusChanges:[...], sourcesSummary:[{id,tier,enabled,lang,region,count,fav,trashed}] }
 */
export function buildV3Section(v3Input) {
  if (!v3Input) return "";
  const L = V3_PROMPT_LIMITS;
  const gateOk = v3Input.gateAvailable !== false && Array.isArray(v3Input.criteria);
  const ex = (list) =>
    (list || []).slice(0, L.borderlineExamples).map((c) => ({ title: clipText(c.title, L.titleMax), link: c.link || "", summary: clipText(c.summary, L.summaryMax) }));
  const t = v3Input.tierStats;
  const rej = v3Input.rejectionSummary;
  const src = (v3Input.sourcesSummary || []).slice(0, L.sourcesLines).map((s) => `${s.id}\ttier${s.tier}\t${s.enabled ? "ON" : "off"}\t${s.lang || ""}\t${s.region || ""}\t採用${s.count ?? 0}/fav${s.fav ?? 0}/trash${s.trashed ?? 0}`);
  return `
# v3 選別の結果（gateTier=関門の判定段階。borderline=accept未満の枠。旧エントリはlegacy）
- gateTier別: ${JSON.stringify(t.byTier)}
- borderlineでfavされた例（採用例候補。なぜ良かったかを見る）: ${JSON.stringify(ex(t.borderlineFav))}
- borderlineでトラッシュされた例（不採用例候補。なぜ外れたかを見る）: ${JSON.stringify(ex(t.borderlineTrashed))}
- レンズ別（discoveryLens 1〜4）の採用数/fav/トラッシュ: ${JSON.stringify(v3Input.lensStats.byLens)}（タグ無し=旧データ${v3Input.lensStats.untagged}件）
- 却下ログ（直近${rej.windowDays}日・${rej.total}件。理由上位のみ）: ${JSON.stringify(rej.byReason)} / パイプライン別: ${JSON.stringify(rej.byPipeline)} / サンプル: ${JSON.stringify(rej.samples.slice(0, L.rejectionSamples))}
${
    gateOk
      ? `
# 現行の採用基準 A〜D（文面の変更案を出す場合の「変更前」）
${JSON.stringify(v3Input.criteria)}
${
  (v3Input.recentProposals || []).length
    ? `
# 直近の基準変更案（却下・置き換え済み。同じ趣旨の案は再提案しない）
${JSON.stringify(
  v3Input.recentProposals.slice(0, L.recentProposals).map((p) => ({ status: p.status, criterionId: p.criterionId, after: clipText(p.after, L.proposalTextMax), reason: clipText(p.reason, L.proposalTextMax) }))
)}
`
    : ""
}`
      : ""
  }

# 巡回先（data/sources.json。id / tier / ON-off / 言語 / 地域 / この巡回先発の採用・fav・トラッシュ数。変更できるのは tier と enabled のみ）
${src.join("\n")}
`;
}

const V3_RULES = `- cc.roundFoci は**4レンズ固定**: 件数・順序・各レンズの領域は変えない。変更してよいのは label / sources / diversity の文言と、sourceRefs の**並び順のみ**（要素の追加・削除は不可。lens等その他のキーは現状のまま維持）`;

export function buildPass1Prompt({ favStats, trashStats, userCaseStats, oldResearchTuning, oldXRadarQueries, oldResearchPlan, v3Input = null }) {
  // case-gate.json が読めない時は v3 のうち具体例・基準案だけ省く（巡回先の変更などは続ける）
  const gateOk = Boolean(v3Input) && v3Input.gateAvailable !== false && Array.isArray(v3Input.criteria);
  // ユーザー追加事例（強化シグナル）は該当0件のときセクションごと省略する（空セクションを出さない）。
  const userSection =
    userCaseStats.userCaseCount > 0
      ? `
# ユーザー追加事例（強化シグナル: LINE経由でユーザー自身がcases.jsonに登録した事例。明確な関心の表明として強く扱ってよい）
- ユーザー追加事例: ${userCaseStats.userCaseCount}件
- タグ分布: ${JSON.stringify(userCaseStats.caseTagDistributionUser)}
- カテゴリ分布: ${JSON.stringify(userCaseStats.caseCategoryDistributionUser)}
- 一覧（抜粋）: ${JSON.stringify(userCaseStats.userCases.slice(0, 40))}
`
      : "";

  return `ResearchMan（デジタルクリエイティブ事例・技術データベース）の週次チューンアップ「リサーチ計画」担当。
ユーザーがサイトでお気に入り(★)した Case Study / Technology の傾向を、全体分布と比較して、
日次自動収集（auto-research-cc.mjs / auto-research-tech.mjs）の探索レーン・角度・X検索クエリを
ブラッシュアップしてください。

# お気に入り統計
- お気に入り事例: ${favStats.favoriteCaseCount}件 / 全${favStats.totalCaseCount}件
- お気に入り技術: ${favStats.favoriteTechCount}件 / 全${favStats.totalTechCount}件
- 事例タグ分布（全体）: ${JSON.stringify(favStats.caseTagDistributionAll)}
- 事例タグ分布（お気に入りのみ）: ${JSON.stringify(favStats.caseTagDistributionFav)}
- 技術domain分布（全体）: ${JSON.stringify(favStats.techDomainDistributionAll)}
- 技術domain分布（お気に入りのみ）: ${JSON.stringify(favStats.techDomainDistributionFav)}
- お気に入り事例のsources分布: ${JSON.stringify(favStats.caseSourcesDistributionFav)}
- お気に入り技術のtype分布: ${JSON.stringify(favStats.techTypeDistributionFav)}
- お気に入り事例一覧（抜粋）: ${JSON.stringify(favStats.favoriteCases.slice(0, 40))}
- お気に入り技術一覧（抜粋）: ${JSON.stringify(favStats.favoriteTech.slice(0, 40))}

# ごみ箱（弱化シグナル: ユーザーがTOPのごみ箱に入れた事例。関心が低いと推測される。お気に入りとは
逆方向の重みとして参考にし、ごみ箱に偏るタグ・カテゴリ・sourcesは探索レーンを弱める根拠にしてよい）
- ごみ箱事例: ${trashStats.trashedCaseCount}件 / 全${trashStats.totalCaseCount}件
- ごみ箱事例タグ分布: ${JSON.stringify(trashStats.caseTagDistributionTrashed)}
- ごみ箱事例カテゴリ分布: ${JSON.stringify(trashStats.caseCategoryDistributionTrashed)}
- ごみ箱事例sources分布: ${JSON.stringify(trashStats.caseSourcesDistributionTrashed)}
- ごみ箱事例一覧（抜粋）: ${JSON.stringify(trashStats.trashedCases.slice(0, 40))}
${userSection}${buildV3Section(v3Input)}
# 現行設定
research-tuning.json: ${JSON.stringify(oldResearchTuning)}
x-radar-queries.json: ${JSON.stringify(oldXRadarQueries)}
現行RESEARCH_PLAN.md:
${oldResearchPlan}

# 厳守事項（機械検証で拒否される。逸脱すると変更全体が破棄される）
- research-tuning.json の構造（tech.lanes / cc.roundFoci、各要素の必須キー）は変えない。
  label/sources/diversityの**文言**のみ変更可。cc.roundFociの sourceRefs（data/sources.json の情報源id配列）は
  そのまま維持する（情報源の有効/無効・tierの変更は別ガードレールでオーナー判断の範囲）
- tech.lanes は件数3〜6件を維持
${V3_RULES}
- x-radar-queries.jsonは文字列配列のまま、件数は1〜6件を維持
- **変更は保守的に**: tech.lanes と cc.roundFoci を合わせて2件まで、x-radarクエリは3件までしか
  差し替えない（大半は現状維持し、お気に入りが強く示す傾向がある部分だけピンポイントで変える）
- 有意な傾向が見えない・お気に入りが少なすぎる場合は、無理に変えず現状のJSONをそのまま返してよい
${
  v3Input
    ? `- 巡回先の変更(sourceChanges)は tier / enabled のみ。tier変更は5件まで・enabled変更は5件まで。id・locator・lang等は変えない。**enabled は true→false のみ**（OFF→ONの有効化は週次見直しでは行わない。有効化はベイクオフ経由）。fav実績のある巡回先のtierを上げ、トラッシュ偏重で採用が無い巡回先のtierを下げる/OFFにする。根拠が弱ければ空配列${
        gateOk
          ? `
- 判定の具体例の why(litmusWhy): 上の「borderlineでfav/トラッシュされた例」のうち具体例にふさわしいものについて、title と side と why を返す。why は**記事の要約ではなく「なぜ採用／不採用の物差しになるか」の一文**（採用側=どの基準(A〜D)をどう満たすか、不採用側=なぜ基準に届かないか）。不採用側は、トラッシュ理由が品質以外（重複・リンク切れ・既知の話題など）と思われるもの、または理由が説明できないものは出さない。物差しにならない例は出さない（出さなければ採用されない）
- 基準A〜Dの文面の変更案(gateCriterionProposal)は**0〜1件**。borderlineのfav/トラッシュの実例が基準文の言葉では説明できない時だけ出す。根拠(evidence)には上の「borderlineでfav/トラッシュされた例」に載っているタイトルをそのまま使う（載っていないものは破棄される）。基準文は自動では書き換わらず、オーナーがLINEで承認した時だけ変わる。却下・置き換え済みの案と同じ趣旨の再提案はしない。無ければnull`
          : ""
      }`
    : ""
}

# 出力
JSON1つのみ（前置き・後書きなし）:
{
  "researchTuning": ${JSON.stringify({ tech: { lanes: "..." }, cc: { roundFoci: "..." } })},
  "xRadarQueries": ["..."],${
    v3Input
      ? `
  "sourceChanges": [{ "id": "巡回先id", "tier": 1, "enabled": false }],${
    gateOk
      ? `
  "litmusWhy": [{ "title": "上の例のタイトル", "side": "accept|reject", "why": "物差しになる理由の一文" }],
  "gateCriterionProposal": null,`
      : ""
  }`
      : ""
  }
  "researchPlanMarkdown": "# RESEARCH_PLAN.md の全文（Markdown）。現在の関心仮説・強化する源・弱める源・根拠を人間可読に書く",
  "rationale": "LINE報告用の変更理由の要約（2〜4文、日本語）"
}${
    gateOk
      ? `
gateCriterionProposal を出す場合の形: { "criterionId": "A|B|C|D", "after": "変更後の基準文（全文）", "reason": "理由（1〜2文）", "evidence": [{ "title": "上の例のタイトル", "signal": "fav|trash" }] }`
      : ""
  }`;
}

/**
 * 分析パス2「アイデア構造見直し」プロンプト組み立て。
 * アイデア評価シグナル（GET /api/idea-likes＝強化・GET /api/idea-trash＝弱化。
 * data/ideas.jsonのpattern別分布・refs先(cases.json/tech.json)タグ分布・scoresとの相関）が
 * 1件もない場合はセクションごと省略する（buildPass1Promptのユーザー追加事例0件時と同じ流儀）。
 */
export function buildPass2Prompt({ favStats, ideaStats, ideaFeedbackStats, oldIdeaTuning }) {
  const hasFeedbackSignal = ideaFeedbackStats.likedIdeaCount > 0 || ideaFeedbackStats.trashedIdeaCount > 0;
  const feedbackSection = hasFeedbackSignal
    ? `
# アイデア評価シグナル（いいね=強化・ゴミ箱=弱化。件数が少ない場合は無理に反映しなくてよい）
- いいねされたアイデア: ${ideaFeedbackStats.likedIdeaCount}件 / ゴミ箱行きのアイデア: ${ideaFeedbackStats.trashedIdeaCount}件
- パターン別いいね分布: ${JSON.stringify(ideaFeedbackStats.patternLikeCounts)}
- パターン別ゴミ箱分布: ${JSON.stringify(ideaFeedbackStats.patternTrashCounts)}
- 参照先(事例タグ/技術domain)のいいね分布: ${JSON.stringify(ideaFeedbackStats.refTagLikeCounts)}
- 参照先(事例タグ/技術domain)のゴミ箱分布: ${JSON.stringify(ideaFeedbackStats.refTagTrashCounts)}
${
  ideaFeedbackStats.scoreCorrelations
    ? `- ★スコア(discovery/surprise/conviction)といいね/ゴミ箱の相関係数（-1〜1。nullはデータ不足等で判定不能）: ${JSON.stringify(ideaFeedbackStats.scoreCorrelations)}\n`
    : ""
}`
    : "";

  return `ResearchMan「アイデアの種」生成（generate-idea-seeds.mjs）の週次チューンアップ「構造見直し」担当。
ideas.json蓄積の機械指標とお気に入り分布（下にいいね/ゴミ箱の反応データがあればそれも）から、
サンプリング重み・パターン混合比・プロンプト文言の**構造**だけを見直してください
（個々のアイデアの書き直しはしない）。

# ideas.json 機械指標
- 総アイデア数: ${ideaStats.totalIdeas}
- パターン分布: ${JSON.stringify(ideaStats.patternCounts)}
- ユニーク参照数: ${ideaStats.uniqueRefsUsed}
- 使い回され気味の参照（3回以上）: ${JSON.stringify(ideaStats.overusedRefs)}

# お気に入り分布（Case/Techの関心シグナル）
- 事例タグ分布（お気に入り）: ${JSON.stringify(favStats.caseTagDistributionFav)}
- 技術domain分布（お気に入り）: ${JSON.stringify(favStats.techDomainDistributionFav)}
${feedbackSection}
# 現行設定 (idea-tuning.json)
${JSON.stringify(oldIdeaTuning)}

# 厳守事項（機械検証で拒否される。逸脱すると変更全体が破棄される）
- キー構造は変えない。seedCount/caseSample/techSample は正の整数のまま
- patternMix の contextXTech/techXTech/repurpose/free は合計が必ず1になるようにする
- samplingWeights.caseTags / samplingWeights.techDomains の各値は0.25〜4.0の範囲に収める
  （キーは cases.json の tags 文字列 / tech.json の domains 文字列。過度な傾倒を避けるため
  基本は1.0付近に留め、明確な偏りがある場合だけ調整する）
- 変更する重み項目は合計10項目まで（大半のキーは1.0のままでよい）
- promptText.patternDefinitions/roleIntro/styleNotes は文言の調整のみ（空にしない）
- 有意な傾向が見えない場合は無理に変えず現状のJSONをそのまま返してよい

# 出力
JSON1つのみ（前置き・後書きなし）:
{
  "ideaTuning": ${JSON.stringify(oldIdeaTuning)},
  "rationale": "LINE報告用の変更理由の要約（2〜4文、日本語）"
}`;
}
