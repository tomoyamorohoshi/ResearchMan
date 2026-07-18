// OAuth 2.1 の /token エンドポイント（docs/MCP_IDEATION_DESIGN.md §8）。
// grant_type=authorization_code / refresh_token の2種のみサポート。
// ステートレス(Redis/DB不使用)。10秒以内・application/x-www-form-urlencoded 前提。
//
// 絶対制約: このルートはLLM呼び出し・外部API発信を一切行わない。
import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  generateJti,
  issueToken,
  verifyPkce,
  verifyTokenString,
  type AccessPayload,
  type RefreshPayload,
} from "@/lib/mcp-auth";

export const runtime = "nodejs";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function oauthError(
  error: string,
  description: string,
  status: number
): Response {
  return jsonResponse({ error, error_description: description }, status);
}

function issueTokenPair(clientId: string): {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  refresh_token: string;
} {
  const nowSec = Math.floor(Date.now() / 1000);
  const accessPayload: AccessPayload = {
    type: "access",
    client_id: clientId,
    exp: nowSec + ACCESS_TTL_SECONDS,
    jti: generateJti(),
  };
  const refreshPayload: RefreshPayload = {
    type: "refresh",
    client_id: clientId,
    exp: nowSec + REFRESH_TTL_SECONDS,
    jti: generateJti(),
  };
  const secret = process.env.MCP_TOKEN_SECRET as string;
  return {
    access_token: issueToken(accessPayload, secret),
    token_type: "bearer",
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: issueToken(refreshPayload, secret),
  };
}

export async function POST(req: Request): Promise<Response> {
  if (!process.env.MCP_TOKEN_SECRET) {
    return oauthError(
      "temporarily_unavailable",
      "server is not configured",
      503
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return oauthError("invalid_request", "malformed request body", 400);
  }

  const grantType = String(form.get("grant_type") ?? "");
  const secret = process.env.MCP_TOKEN_SECRET;

  if (grantType === "authorization_code") {
    const code = String(form.get("code") ?? "");
    const codeVerifier = String(form.get("code_verifier") ?? "");
    const redirectUri = String(form.get("redirect_uri") ?? "");
    const clientId = form.get("client_id");

    if (!code || !codeVerifier || !redirectUri) {
      return oauthError(
        "invalid_request",
        "code, code_verifier and redirect_uri are required",
        400
      );
    }

    const result = verifyTokenString(code, secret, "code");
    if (!result.ok) {
      return oauthError("invalid_grant", "code is invalid or expired", 400);
    }
    const { payload } = result;

    if (!verifyPkce(codeVerifier, payload.challenge)) {
      return oauthError("invalid_grant", "code_verifier does not match", 400);
    }
    if (redirectUri !== payload.redirect_uri) {
      return oauthError("invalid_grant", "redirect_uri does not match", 400);
    }
    if (clientId !== null && String(clientId) !== payload.client_id) {
      return oauthError("invalid_grant", "client_id does not match", 400);
    }

    return jsonResponse(issueTokenPair(payload.client_id), 200);
  }

  if (grantType === "refresh_token") {
    const refreshToken = String(form.get("refresh_token") ?? "");
    if (!refreshToken) {
      return oauthError("invalid_request", "refresh_token is required", 400);
    }

    const result = verifyTokenString(refreshToken, secret, "refresh");
    if (!result.ok) {
      return oauthError(
        "invalid_grant",
        "refresh_token is invalid or expired",
        400
      );
    }

    // ステートレスなのでローテーションは「新しいペアを返すだけ」。古いrefreshの明示的失効はしない。
    return jsonResponse(issueTokenPair(result.payload.client_id), 200);
  }

  return oauthError(
    "unsupported_grant_type",
    `grant_type '${grantType}' is not supported`,
    400
  );
}
