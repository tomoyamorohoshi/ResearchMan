import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // ResearchMan Studio: 独立したローカル専用アプリ。RM本体のlint対象外。
    "studio/**",
  ]),
  // MCPルート（docs/MCP_IDEATION_DESIGN.md §8）: サーバはLLMを一切持たない方針の物理遮断。
  // @anthropic-ai/sdk やAI Gateway系(ai)のimportがこの配下に紛れ込むと、
  // MCPツール呼び出しごとにAPI従量課金が発生しうるため機械的に禁止する。
  {
    files: ["src/app/api/mcp/**", "src/lib/mcp-auth*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@anthropic-ai/sdk",
              message:
                "MCPルートはLLMを呼ばない方針（docs/MCP_IDEATION_DESIGN.md §8）。@anthropic-ai/sdk のimportは禁止。",
            },
            {
              name: "ai",
              message:
                "MCPルートはLLMを呼ばない方針（docs/MCP_IDEATION_DESIGN.md §8）。AI Gateway系(ai)のimportは禁止。",
            },
          ],
          patterns: [
            {
              group: ["@ai-sdk/*"],
              message:
                "MCPルートはLLMを呼ばない方針（docs/MCP_IDEATION_DESIGN.md §8）。AI Gateway系のimportは禁止。",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
