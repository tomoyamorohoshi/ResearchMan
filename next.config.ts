import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // /ideas ページ（goofy-hatching-mango.md 2026-07-07バッチ・固定2サイズタイポグラフィ＋
  // 内容適応カードサイズ改訂計画）。solveFixedSizeShape(src/lib/ideaShapes.ts)が全50件×3
  // ティアぶんカードスケールを二分探索で解くため、静的生成に既定の60秒を超える時間
  // (実測: 単独実行で約130〜160秒、ビルド時のワーカー競合を考慮し余裕を持たせる)を要する。
  // これを許容するため既定値を引き上げる
  staticPageGenerationTimeout: 300,
};

export default nextConfig;
