// RFC 9728 OAuth 2.0 Protected Resource Metadata（docs/MCP_IDEATION_DESIGN.md §8）。
// mcp-handler の generateProtectedResourceMetadata を使い、resource を明示的に
// `<origin>/api/mcp` として指定する(既定の自動導出はサイトルートになってしまうため)。
// origin はリクエストのHostから動的に導出(x-forwarded-proto/host対応)。
import {
  generateProtectedResourceMetadata,
  getPublicOrigin,
  metadataCorsOptionsRequestHandler,
} from "mcp-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export async function GET(req: Request): Promise<Response> {
  const origin = getPublicOrigin(req);
  const metadata = generateProtectedResourceMetadata({
    authServerUrls: [origin],
    resourceUrl: `${origin}/api/mcp`,
    additionalMetadata: {
      bearer_methods_supported: ["header"],
    },
  });
  return new Response(JSON.stringify(metadata), {
    headers: {
      ...corsHeaders,
      "Cache-Control": "max-age=3600",
      "Content-Type": "application/json",
    },
  });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
