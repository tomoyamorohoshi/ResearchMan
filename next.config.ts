import type { NextConfig } from "next";
import { isBlobDataEnabled } from "./src/lib/publicDataBlob";

const nextConfig: NextConfig = {
  // 巨大データJSON（cases/ideas/idea-layouts）のBlob配信有無。BLOB_STORE_ID未設定の環境
  // （ローカル開発等）では空＝ローカル /data/ のみを使う（src/lib/publicDataBlob.ts）
  env: {
    NEXT_PUBLIC_DATA_FROM_BLOB: isBlobDataEnabled(process.env.BLOB_STORE_ID) ? "1" : "",
  },
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
