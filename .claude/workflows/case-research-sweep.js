export const meta = {
  name: 'case-research-sweep',
  description: 'お題→多角度収集(Sonnet)→機械検証(Haiku)+受賞照合(Sonnet)→レポート執筆(Opus)の事例リサーチ一括実行',
  whenToUse: '「〇〇の事例をワークフローで一気に調べて」等、事例リサーチをまとめて回すとき。args にお題（文字列 or {theme, angles?}）を渡す',
  phases: [
    { title: 'Collect', detail: '多角度のWeb収集 + ローカルDB照会', model: 'sonnet' },
    { title: 'Verify', detail: 'リンク死活/oEmbed照合(Haiku) + 受賞一次情報照合(Sonnet)' },
    { title: 'Write', detail: '検証済み材料からレポート執筆', model: 'opus' },
  ],
}

// モデル・effort は .claude/agents/ の各定義に一元化してあり、ここでは agentType で参照するだけ
const theme = typeof args === 'string' ? args : (args && args.theme) || ''
if (!theme) throw new Error('args にお題（テーマ文字列）を渡してください')
const angles = (args && args.angles) || [
  '直接キーワード検索',
  '技術・手法（Tech/Form）の切り口',
  'ブランド・業界の切り口',
  'アワードアーカイブ・年鑑の切り口',
]

const CASES_SCHEMA = {
  type: 'object',
  required: ['cases'],
  properties: {
    cases: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'url'],
        properties: {
          title: { type: 'string' },
          brand: { type: 'string' },
          agency: { type: 'string' },
          year: { type: 'string' },
          awardClaim: { type: 'string', description: '受賞主張（未検証のまま）。無ければ空' },
          url: { type: 'string' },
          summary: { type: 'string' },
          existingId: { type: 'string', description: 'ローカルDB既存事例ならそのid' },
        },
      },
    },
  },
}

const LINK_SCHEMA = {
  type: 'object',
  required: ['alive'],
  properties: {
    alive: { type: 'boolean' },
    titleMatch: { type: ['boolean', 'null'] },
    note: { type: 'string' },
  },
}

const AWARD_SCHEMA = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { enum: ['confirmed', 'unverified', 'wrong'] },
    correctedAward: { type: 'string' },
    sourceUrl: { type: 'string' },
    note: { type: 'string' },
  },
}

phase('Collect')
const collected = await parallel(
  angles.map((a) => () =>
    agent(
      `お題「${theme}」のクリエイティブ事例を「${a}」の角度で収集してください。各事例は title/brand/agency/year/awardClaim/url/summary で返し、ローカルDB既存分は existingId を付けること。`,
      { agentType: 'case-collector', label: `collect:${a}`, phase: 'Collect', schema: CASES_SCHEMA }
    )
  )
)
// URL基準の重複排除（全角度の結果が揃ってから行う必要があるためここだけバリア）
const seen = new Set()
const candidates = collected
  .filter(Boolean)
  .flatMap((r) => r.cases)
  .filter((c) => {
    const k = (c.url || '').replace(/\/+$/, '').toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
log(`収集 ${candidates.length}件（重複除去後）。検証に進みます`)

const verified = (
  await pipeline(
    candidates,
    (c) =>
      agent(
        `次の事例のリンク死活と（YouTubeなら）oEmbedタイトル照合を行ってください: ${JSON.stringify(c)}`,
        { agentType: 'link-checker', label: `link:${c.title}`, phase: 'Verify', schema: LINK_SCHEMA }
      ).then((v) => ({ ...c, link: v })),
    (c) => {
      if (!c || !c.link || !c.link.alive) return c // リンク死はここで終了（後段で除外）
      if (!c.awardClaim) return { ...c, award: { status: 'confirmed', note: '受賞主張なし' } }
      return agent(
        `次の受賞主張を一次情報で照合してください。事例: ${c.title}（${c.brand || '?'}, ${c.year || '?'}）/ 主張: ${c.awardClaim} / URL: ${c.url}`,
        { agentType: 'award-verifier', label: `award:${c.title}`, phase: 'Verify', schema: AWARD_SCHEMA }
      ).then((a) => ({ ...c, award: a }))
    }
  )
)
  .filter(Boolean)
  .filter((c) => c.link && c.link.alive)

const dropped = candidates.length - verified.length
if (dropped > 0) log(`リンク切れ等で ${dropped}件 除外`)

phase('Write')
const report = await agent(
  `お題「${theme}」のリサーチレポートを執筆してください。以下は検証済みの材料です（award.status が unverified のものは載せるなら ⚠️未検証 マーク必須、wrong は correctedAward の値を使うこと）:\n${JSON.stringify(verified, null, 2)}\n\nALBUM_SITE_RESEARCH.md の形式で「<テーマ>_RESEARCH.md」としてリポジトリ直下に保存し、保存パスを返してください。`,
  { agentType: 'report-writer', label: 'write-report', phase: 'Write' }
)

return {
  theme,
  collected: candidates.length,
  verified: verified.length,
  awardUnverified: verified.filter((c) => c.award && c.award.status === 'unverified').length,
  reportPath: report,
}
