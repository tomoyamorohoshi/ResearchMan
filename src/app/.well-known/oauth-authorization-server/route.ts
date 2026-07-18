// RFC 8414 OAuth 2.0 Authorization Server Metadata（docs/MCP_IDEATION_DESIGN.md §8）。
// CIMD対応は client_id_metadata_document_supported で示す
// (@modelcontextprotocol/sdk の shared/auth.ts が定義するフィールド名。実装前に現物確認済み)。
// origin はリクエストのHostから動的に導出(x-forwarded-proto/host対応)。
import { getPublicOrigin, metadataCorsOptionsRequestHandler } from "mcp-handler";

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
  const metadata = {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
  };
  return new Response(JSON.stringify(metadata), {
    headers: {
      ...corsHeaders,
      "Cache-Control": "max-age=3600",
      "Content-Type": "application/json",
    },
  });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
