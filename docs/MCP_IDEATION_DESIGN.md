# DESIGN — RM Ideation MCP（リモートMCPサーバ）

RMのアイデア発想エンジンを**リモートMCPサーバ**として公開し、Claudeアプリ（スマホ/web）から自由に会話しながら使えるようにする設計。2026-07-17 起票（Fable計画）。実装は別セッションで implementer に委任する（大機能）。

**設計の芯（コスト方針）**: サーバは**LLMを一切持たない**。推論（生成・採点・改稿）はクライアントのClaude（あなたのアプリ＝サブスク内）が行う。サーバは「素材（実データ検索）＋手順（発想メソッド）」の供給に徹する。→ **API従量課金ゼロ**（絶対要件）。

## 1. 概要・目的

- **何を作るか**: RMの発想機能（事例検索・22の切り口の型・発想メソッド）を、read-onlyのMCPツール群としてリモート公開する。Claudeアプリにカスタムコネクタとして登録し、スマホからでも会話で使う。
- **なぜ**: LINEの「規定演技（お題→定型で返る）」は壁打ち・深掘り・尖らせ・逆張りといった**自由なインプット**に向かない。会話型Claudeに「素材・道具」を持たせることで、自由な往復 × 実データの刺激を両取りする。中身はRM本体の再利用。
- **`docs/IDEA_ENGINE.md` との関係**: .mdは「手順＋固定の事例刺激」を1枚に焼いた持ち出し版。MCPは、.mdが運べなかった**お題ごとの事例の動的検索（＝封印していたB）を自動化**して足すもの。手順そのものはMCPツールからも供給する。

## 2. スコープ

**含む（v1）**
- リモートMCPサーバ（Streamable HTTP / SSE）と Claude カスタムコネクタ接続（OAuth）
- read-only の素材・手順ツール群（§4）。**すべて非LLM（データ検索・整形・照合のみ）**
- 既存 `data/*.json` の再利用（検索・型・事例）

**含まない（v1・次段階以降）**
- **サーバ側でのLLM実行**（＝従量課金の発生源。恒久的に持たない方針）
- 学習の書き戻し（♡/ゴミ箱 → 型重み更新、ideas.json への永続化、commit/push）※ユーザー選択「発想に集中」による
- Web での受賞裏取り（v1はDB内照合のみ）
- 複数ユーザー / 一般公開
- LINE入口の置換（LINEは併存。これは"自由な会話"用の別surface）

## 3. アーキテクチャ・データフロー

```
スマホ/web Claudeアプリ  ← ここが唯一のLLM（サブスク内・追加課金なし）
   │  ・生成/咀嚼/採点/改稿はすべてこの会話モデルが実行
   │  (カスタムコネクタ / OAuth 2.1)
   ▼
Vercel  app/api/mcp  (MCPサーバ: ツール定義 + SSE) ← LLMを持たない
   ├─ data/*.json 読み取り（cases≈590 / tech / idea-angles 22）
   ├─ 検索・整形ロジック（search-cases のロジックを共有・非LLM）
   └─ 手順（IDEA_ENGINEのフェーズ/ルーブリック）を構造化して返す
   ▼
「素材＋手順」を会話へ返す → アプリのClaudeがそれを使って発想
```

- **配置**: 既存 Next.js アプリ（Vercel）に `app/api/mcp` として**同居**。data が既にデプロイ済みで、単一デプロイ・既存の push→Vercel フローを再利用できる。
- **プロトコル**: MCP over Streamable HTTP（SSE）。Claude のカスタムコネクタとして登録。
- **認証**: OAuth 2.1（単一ユーザー想定の最小構成）。
- **LLMなし**: サーバ内でモデル呼び出しをしない。ツールは純粋なデータ操作のみ。

## 4. 変更対象（具体）

**新規ツール（MCP）— すべて read-only・非LLM**
1. `search_cases(query, {tag, year, region, source, limit})` — 事例DBの検索。`scripts/search-cases.mjs` と同じ検索ロジックを共有。
2. `list_angles()` / `get_angle(id)` — 22の切り口の型（description + 代表事例参照）。
3. `get_case(id)` / `get_tech(id)` — 事例・技術の詳細（深掘り用）。
4. `get_ideation_kit(theme, constraint, count)` — **本命ツール**。サーバがお題テキストで事例を検索し、関連度の高い候補型（タグ/キーワード重なりのヒューリスティック・非LLM）を選び、次を1バンドルで返す: `{relevant_cases, suggested_angles(+exemplars), method(フェーズ0-5 + 足切りルーブリック)}`。**この素材を使って実際に発想するのはアプリのClaude**。サーバはLLMを呼ばない。
5. `get_critique_protocol()` — 3軸採点＋足切りの手順を返す。会話中に「これで採点して甘い案を落として」をクライアント側で実行させる。
6. `verify_refs(refs)` — 引用した事例/受賞情報を**DB内で**照合（純粋なlookup）。誤情報の企画書転記を防ぐ。

**新規（インフラ）**
- `app/api/mcp/route.ts`（MCPサーバ本体・SSE）
- OAuth エンドポイント群（authorize/token/register。既製ライブラリ/テンプレを優先調査）

**再利用**: `data/*.json`、`scripts/search-cases.mjs` の検索ロジック、`scripts/lib`（norm系）、`data/idea-angles.json`、`docs/IDEA_ENGINE.md`（手順の出所）。※LLMを呼ばないため `ideaPrompts.ts` の**プロンプト文面はクライアントに返す手順として**使う（サーバ実行はしない）。

**影響範囲**: 既存サイト・Studio・LINEジョブには影響させない（read-only・独立ルート）。

## 5. 設計判断と理由（ADR-lite）

- **ADR1: 既存Next.jsに同居（`/api/mcp`）**。data同梱・単一デプロイ・運用一元化。却下=独立サービス（データ同期の二重化という不要な複雑さ）。
- **ADR2: サーバはLLMを持たない（最重要）**。API従量課金が絶対NGのため。推論はクライアントのClaude（サブスク内）に委ね、サーバは素材＋手順のみ供給する。副次的に、LLMアダプタ・APIキー管理・レイテンシ・障害点が消え**実装も軽くなる**。
- **ADR3: v1は read-only**。本番data書き換えは git/lock/pre-push監査に絡み事故リスクが大きい。学習の書き戻しは設計を固めてから別段階で。
- **ADR4: `get_ideation_kit` で"検索×型×手順"をまとめて渡す**。.mdが運べない「お題ごとの事例検索」を自動化するのがMCPの主目的。生成・採点はクライアントが行うので、ツールは薄いdata供給でよい。
- **ADR5: 独立採点（別モデル）は持たない**。それにはサーバLLMが要り課金が発生するため。会話モデル自身が足切りルーブリックで自己採点する（＝2 Claude Codeの通常挙動と同じ。本日の検証で実用水準を確認済み）。→ トレードオフは §6。
- **ADR6: OAuthは単一ユーザー最小構成**。個人用。複数ユーザーは対象外。

## 6. トレードオフ・リスク・未解決

- **コスト**: **API従量課金ゼロ**（サーバLLMなし）。動くのは既存Vercel上の関数と、あなたのClaudeサブスクのみ。Vercelの関数実行は既存プラン内（単一ユーザーで無視できる量）。
- **品質トレードオフ**: サーバで独立採点モデルを回せないため、"別モデルによる辛口採点"は持てない。→ 足切りルーブリック（`get_critique_protocol`）の徹底で代替。.md版より上（実データ検索が入る）、サーバLLM版より一歩下、という位置づけ。
- **最大の重し=OAuth**。Claudeカスタムコネクタの認証要件を満たす実装が必要。→ 実装1歩目で「Vercel上のリモートMCP + OAuth」の既製テンプレ/ライブラリを調査（技術spike）。
- **データ鮮度**: Vercel同梱データは push時点のスナップショット（read-onlyなら許容）。
- **性能**: cases≈590件をサーバレスでフルロード・検索する速度（許容想定だが計測で確認）。

## 7. 検証方針

- **単体**: 各ツールのテスト（`search_cases`: 既知クエリ→期待id / `get_ideation_kit`: バンドル構造とrefsの実在id / `verify_refs`: 照合結果）。**サーバがLLMを呼ばないこと（外部API発信ゼロ）を明示的にテスト**。
- **疎通**: ローカルで MCP inspector 疎通 → Vercel preview デプロイ → Claudeアプリにカスタムコネクタ登録し**実機（スマホ）で疎通**。
- **品質**: 本日と同じ**盲検A/B**（MCP接続あり vs 素のアプリ会話）で底上げを確認。
- **非破壊**: read-onlyツールが data を一切writeしないことを確認。

## 8. 実装スタック（2026-07-17 調査で確定・一次ソース裏取り済み）

**ホスティング（Vercel）**
- `mcp-handler` v1.1.0（旧 `@vercel/mcp-adapter`）＋ `@modelcontextprotocol/sdk >=1.26.0` ＋ `zod ^3` を追加（3点とも現在未導入）。
- `app/api/mcp/route.ts` に `createMcpHandler(server => {...}, {}, { basePath: '/api' })`、`export { handler as GET, handler as POST, handler as DELETE }`。
- Streamable HTTP・**ステートレス（Redis不要）**。runtime=nodejs、`export const maxDuration=N`、`dynamic='force-static'`は禁止。
- ツールの実行部は `data/*.json` の読取＋整形のみ（LLM呼び出しゼロ）。
- 公式テンプレ: `vercel.com/templates/ai/model-context-protocol-mcp-with-next-js`

**認証（Claudeカスタムコネクタ）**
- OAuth 2.1 ＋ PKCE(S256)。**CIMD方式**（client_secret不要・動的登録不要の最小パス）。
- エンドポイント: `/api/mcp`（本体）／`/.well-known/oauth-protected-resource`(RFC9728)／Authorization Server Metadata(RFC8414)／`/authorize`／`/token`／`/oauth/client-metadata`(CIMD)。
- `withMcpAuth(handler, verifyToken, { resourceMetadataPath })` でラップ。
- redirect_uri = `https://claude.ai/api/mcp/auth_callback`。Anthropicアウトバウンド `160.79.104.0/21` をFirewall許可。`/token`は10秒以内・`application/x-www-form-urlencoded`。

**このリポジトリで確認済み（リスク低下）**
- `middleware.ts` は**存在しない** → MCPルートを巻き込む素通し事故なし。
- `zod` は**未導入** → v3/v4衝突なし（`^3` で新規追加）。
- Next **16.2.9** で GET/POST/DELETE・`maxDuration` 有効。
- ⚠️ `@anthropic-ai/sdk`（^0.105.0）は依存に**存在**（サイト側で使用）。**MCPルートからは絶対にimportしない**（従量課金の物理遮断。依存境界/lintで機械的に禁止推奨）。

**spikeで要確認（残）**
- 既存VercelプロジェクトのFluid Compute有効状態と `maxDuration` 上限（プラン依存）
- claude.aiコネクタが要求するOAuthの実挙動（CIMD単独で通り切るか）
- `data/*.json` がFunctionバンドルに同梱されるか（漏れれば `next.config` の `outputFileTracingIncludes` で明示）

## 次アクション

1. 本設計に合意
2. **新セッションで implementer に委任**（大機能・コンテキスト汚染防止）。着手順:
   - **a. 最小の動く土台**: 依存3点を追加し、`app/api/mcp/route.ts` に `search_cases` 1本だけのMCP（認証なし）→ ローカル MCP Inspector で疎通確認。
   - **b. 最大リスクの検証（OAuth spike）**: CIMD＋メタデータ2種＋`/authorize`・`/token`＋`withMcpAuth` → Vercel preview デプロイ → claude.ai にカスタムコネクタ登録し**実機（スマホ）で疎通**。ここで「要確認」残（Fluid/バンドル同梱/OAuth実挙動）を潰す。
   - **c. ツール実装**: `get_angle`/`get_case` → `get_ideation_kit` → `get_critique_protocol` → `verify_refs`。
   - **d. 品質A/B → 実機確認 → 本番コネクタ登録**。
