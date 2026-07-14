/**
 * 週次チューンアップ（scripts/biweekly-tuneup.mjs。ファイル名は後方互換で維持しているが実体は
 * 週次実行）の分析パス1「リサーチ計画」プロンプト組み立て。
 *
 * biweekly-tuneup.mjsのmain()は即時実行スクリプトのため単体テストできない
 * （OPERATIONS.md「main()を即実行するスクリプトをimportしない」参照）。ここへ切り出すことで
 * 実ファイルI/O・実Claude CLI呼び出しなしに「ごみ箱（弱化シグナル）・ユーザー追加事例
 * （強化シグナル）が正しくプロンプト文字列に含まれるか、ユーザー追加事例0件時に
 * セクションが省略されるか」を単体検証できる（scripts/smoke-tuneup-prompts.mjs 参照）。
 */

export function buildPass1Prompt({ favStats, trashStats, userCaseStats, oldResearchTuning, oldXRadarQueries, oldResearchPlan }) {
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
${userSection}
# 現行設定
research-tuning.json: ${JSON.stringify(oldResearchTuning)}
x-radar-queries.json: ${JSON.stringify(oldXRadarQueries)}
現行RESEARCH_PLAN.md:
${oldResearchPlan}

# 厳守事項（機械検証で拒否される。逸脱すると変更全体が破棄される）
- research-tuning.json の構造（tech.lanes / cc.roundFoci、各要素の必須キー）は変えない。
  label/sources/diversityの**文言**のみ変更可
- tech.lanes・cc.roundFociとも件数は3〜6件を維持
- x-radar-queries.jsonは文字列配列のまま、件数は1〜6件を維持
- **変更は保守的に**: tech.lanes と cc.roundFoci を合わせて2件まで、x-radarクエリは3件までしか
  差し替えない（大半は現状維持し、お気に入りが強く示す傾向がある部分だけピンポイントで変える）
- 有意な傾向が見えない・お気に入りが少なすぎる場合は、無理に変えず現状のJSONをそのまま返してよい

# 出力
JSON1つのみ（前置き・後書きなし）:
{
  "researchTuning": ${JSON.stringify({ tech: { lanes: "..." }, cc: { roundFoci: "..." } })},
  "xRadarQueries": ["..."],
  "researchPlanMarkdown": "# RESEARCH_PLAN.md の全文（Markdown）。現在の関心仮説・強化する源・弱める源・根拠を人間可読に書く",
  "rationale": "LINE報告用の変更理由の要約（2〜4文、日本語）"
}`;
}
