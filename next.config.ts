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
};

export default nextConfig;
