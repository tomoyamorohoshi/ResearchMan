import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // 2026-07-08 画像402インシデント: Vercel Hobbyの画像変換クォータを使い切り、
    // /_next/image 経由の全サムネが HTTP 402 になった（キャッシュ済み変換も拒否される）。
    // クォータ依存を根絶するため最適化プロキシを使わず元画像を直接配信する。
    // 配信サイズは保存時正規化（scripts/lib/normalize-thumbnail.mjs: 幅≤1600px・JPEG q80）で担保。
    unoptimized: true,
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // MCP(docs/MCP_IDEATION_DESIGN.md §8): data/cases.json が /api/mcp のFunctionバンドルに
  // 同梱されることを保証する保険。Output File Tracing が読み取りを検出できない場合の対策。
  outputFileTracingIncludes: {
    "/api/mcp": ["./data/cases.json"],
  },
};

export default nextConfig;
