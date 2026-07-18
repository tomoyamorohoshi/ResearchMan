// MCPサーバ本体（段階(a): 最小の動く土台。認証なし）。
// 設計: docs/MCP_IDEATION_DESIGN.md §4・§8
//
// 重要（絶対制約）: このルート（および import されるモジュール）は絶対にLLMを呼ばない。
// 検索・整形はすべてローカルの data/cases.json に対する非LLMのデータ操作のみ。
// @anthropic-ai/sdk や ai(AI Gateway) 系のimportは eslint.config.mjs の
// no-restricted-imports で機械的に禁止している（従量課金の物理遮断）。
import { createMcpHandler } from "mcp-handler";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { searchCases } from "../../../../scripts/lib/case-search.mjs";
import type { CaseRecord } from "../../../../scripts/lib/case-search.mjs";

export const runtime = "nodejs";
export const maxDuration = 60;

// data/cases.json はモジュールスコープで一度だけ読み込みキャッシュする。
// ネットワークアクセスは行わず、process.cwd() 基準でファイルシステムから読む。
let casesCache: CaseRecord[] | null = null;
function loadCases(): CaseRecord[] {
  if (casesCache) return casesCache;
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), "data", "cases.json"), "utf8")
  ) as CaseRecord[] | { cases: CaseRecord[] };
  casesCache = Array.isArray(raw) ? raw : raw.cases;
  return casesCache;
}

const searchCasesInputSchema = {
  query: z
    .string()
    .describe(
      "空白区切りのキーワード（OR検索・大文字小文字を区別しない）。tagのみで絞り込みたい場合は空文字を渡す。"
    ),
  tag: z
    .array(z.string())
    .optional()
    .describe("tags/categories に部分一致させるタグ（複数指定時はAND、例: 'Tech/AI'）"),
  year: z
    .string()
    .optional()
    .describe("年フィルタ。'2024' のような単年、または '2024-2026' のような範囲"),
  region: z.string().optional().describe("regions に部分一致させる文字列（例: '北米'）"),
  source: z
    .string()
    .optional()
    .describe("sources に部分一致させる文字列（例: 'cannes', 'Radar'）"),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .default(12)
    .describe("返却件数の上限（デフォルト12、最大50）"),
  requireAll: z
    .boolean()
    .default(false)
    .describe("true にすると query のキーワードをAND評価する（デフォルトはOR）"),
};

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "search_cases",
      {
        title: "search_cases",
        description:
          "RMの事例DB（data/cases.json、約600件のクリエイティブ事例）をキーワード・タグ・年・地域・ソースで検索する。read-only・非LLM（データ検索と整形のみ）。",
        inputSchema: searchCasesInputSchema,
      },
      async ({ query, tag, year, region, source, limit, requireAll }) => {
        const cases = loadCases();
        const keywords = query
          .split(/\s+/)
          .map((k) => k.trim())
          .filter(Boolean);

        const { total, results } = searchCases(cases, {
          keywords,
          tags: tag ?? [],
          yearRange: year ?? null,
          region: region ?? null,
          source: source ?? null,
          limit,
          requireAll,
        });

        const items = results.map(({ c, score }) => ({
          score,
          id: c.id,
          title: c.title,
          year: c.year,
          client: c.client,
          award: c.award,
          summary: c.summary,
          link: c.link,
          tags: c.tags,
          categories: c.categories,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { total, count: items.length, results: items },
                null,
                2
              ),
            },
          ],
        };
      }
    );
  },
  {},
  { basePath: "/api" }
);

export { handler as GET, handler as POST, handler as DELETE };
