// OAuth 2.1 + PKCE(S256) の /authorize エンドポイント（docs/MCP_IDEATION_DESIGN.md §8）。
// GET: パスフレーズ入力フォームを返す（OAuthパラメータはhiddenで引き回す）。
// POST: パスフレーズを検証し、成功なら authorization code を発行して redirect_uri へ302。
//
// 単一ユーザー認可(env MCP_AUTH_PASSPHRASE)。ステートレス(Redis/DB不使用)。
// 絶対制約: このルートはLLM呼び出し・外部API発信を一切行わない。
import {
  CODE_TTL_SECONDS,
  generateJti,
  isAllowedRedirectUri,
  issueToken,
  verifyPassphrase,
  type CodePayload,
} from "@/lib/mcp-auth";

export const runtime = "nodejs";

interface OAuthParams {
  response_type: string | null;
  client_id: string | null;
  redirect_uri: string | null;
  code_challenge: string | null;
  code_challenge_method: string | null;
  state: string | null;
}

function readOAuthParams(params: URLSearchParams): OAuthParams {
  return {
    response_type: params.get("response_type"),
    client_id: params.get("client_id"),
    redirect_uri: params.get("redirect_uri"),
    code_challenge: params.get("code_challenge"),
    code_challenge_method: params.get("code_challenge_method"),
    state: params.get("state"),
  };
}

// response_type/client_id/code_challenge/code_challenge_method の妥当性。
// redirect_uri は別途 isAllowedRedirectUri で検証する(ここでは見ない)。
function validateOAuthShape(p: OAuthParams): string | null {
  if (p.response_type !== "code") return "response_type must be 'code'";
  if (!p.client_id) return "client_id is required";
  if (!p.code_challenge) return "code_challenge is required";
  if (p.code_challenge_method !== "S256") {
    return "code_challenge_method must be 'S256'";
  }
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderForm(p: OAuthParams, errorMessage?: string): string {
  const hidden = (name: string, value: string | null) =>
    value !== null
      ? `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`
      : "";
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ResearchMan MCP - 認可</title>
<style>
body{font-family:system-ui,sans-serif;max-width:24rem;margin:4rem auto;padding:0 1rem;}
input[type=password]{width:100%;padding:.5rem;font-size:1rem;box-sizing:border-box;}
button{width:100%;padding:.6rem;margin-top:.75rem;font-size:1rem;}
.error{color:#b00020;margin-bottom:.75rem;}
</style>
</head>
<body>
<h1>ResearchMan MCP</h1>
<p>接続を許可するにはパスフレーズを入力してください。</p>
${errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : ""}
<form method="POST" action="/authorize">
${hidden("response_type", p.response_type)}
${hidden("client_id", p.client_id)}
${hidden("redirect_uri", p.redirect_uri)}
${hidden("code_challenge", p.code_challenge)}
${hidden("code_challenge_method", p.code_challenge_method)}
${hidden("state", p.state)}
<label for="passphrase">パスフレーズ</label>
<input type="password" id="passphrase" name="passphrase" autofocus required>
<button type="submit">許可する</button>
</form>
</body>
</html>`;
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function serviceUnavailable(): Response {
  return htmlResponse(
    renderErrorPage("サーバ未設定のため一時的に利用できません。"),
    503
  );
}

function renderErrorPage(message: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>ResearchMan MCP - エラー</title></head><body><p>${escapeHtml(
    message
  )}</p></body></html>`;
}

function redirectWithError(
  redirectUri: string,
  error: string,
  description: string,
  state: string | null
): Response {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state !== null) url.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

export async function GET(req: Request): Promise<Response> {
  if (!process.env.MCP_AUTH_PASSPHRASE) return serviceUnavailable();

  const url = new URL(req.url);
  const params = readOAuthParams(url.searchParams);

  if (!params.redirect_uri || !isAllowedRedirectUri(params.redirect_uri)) {
    return htmlResponse(
      renderErrorPage("redirect_uri が許可されていません。"),
      400
    );
  }
  const shapeError = validateOAuthShape(params);
  if (shapeError) {
    return redirectWithError(
      params.redirect_uri,
      "invalid_request",
      shapeError,
      params.state
    );
  }

  return htmlResponse(renderForm(params), 200);
}

export async function POST(req: Request): Promise<Response> {
  if (!process.env.MCP_AUTH_PASSPHRASE || !process.env.MCP_TOKEN_SECRET) {
    return serviceUnavailable();
  }

  const form = await req.formData();
  const params = readOAuthParams(
    new URLSearchParams(
      Array.from(form.entries()).map(([k, v]) => [k, String(v)])
    )
  );
  const passphrase = String(form.get("passphrase") ?? "");

  if (!params.redirect_uri || !isAllowedRedirectUri(params.redirect_uri)) {
    return htmlResponse(
      renderErrorPage("redirect_uri が許可されていません。"),
      400
    );
  }
  const shapeError = validateOAuthShape(params);
  if (shapeError) {
    return redirectWithError(
      params.redirect_uri,
      "invalid_request",
      shapeError,
      params.state
    );
  }

  if (!verifyPassphrase(passphrase, process.env.MCP_AUTH_PASSPHRASE)) {
    return htmlResponse(
      renderForm(params, "パスフレーズが正しくありません。"),
      401
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const codePayload: CodePayload = {
    type: "code",
    challenge: params.code_challenge as string,
    redirect_uri: params.redirect_uri,
    client_id: params.client_id as string,
    exp: nowSec + CODE_TTL_SECONDS,
    jti: generateJti(),
  };
  const code = issueToken(codePayload, process.env.MCP_TOKEN_SECRET);

  const location = new URL(params.redirect_uri);
  location.searchParams.set("code", code);
  if (params.state !== null) location.searchParams.set("state", params.state);

  return new Response(null, {
    status: 302,
    headers: { Location: location.toString() },
  });
}
