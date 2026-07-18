// MCP OAuth spike 用の純関数群（docs/MCP_IDEATION_DESIGN.md §8）。
//
// ステートレス設計: Redis/DB不使用。すべてのトークンはHMAC-SHA256署名付きの
// 自己完結トークン（base64url(JSON payload) + "." + base64url(HMAC)）。
// 署名鍵は呼び出し元がenv MCP_TOKEN_SECRET から渡す（このファイルはenvを読まない）。
//
// 絶対制約: このファイルは外部へのネットワーク発信を一切行わない（node:cryptoのみ使用）。
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type TokenType = "code" | "access" | "refresh";

interface BasePayload {
  exp: number; // unix秒
  // 発行のたびに一意な乱数(jti)。同一秒内に同じ内容のペイロードを複数回発行しても
  // トークン文字列が衝突しないようにするためのもの(refresh rotationの「新しいトークン」性を担保)。
  // 検証では中身を見ない(一意性の付与のみが目的)。
  jti?: string;
}

export interface CodePayload extends BasePayload {
  type: "code";
  challenge: string;
  redirect_uri: string;
  client_id: string;
}

export interface AccessPayload extends BasePayload {
  type: "access";
  client_id: string;
}

export interface RefreshPayload extends BasePayload {
  type: "refresh";
  client_id: string;
}

export type TokenPayload = CodePayload | AccessPayload | RefreshPayload;

// トークン種別ごとのTTL（秒）。
export const CODE_TTL_SECONDS = 5 * 60; // 5分
export const ACCESS_TTL_SECONDS = 30 * 24 * 60 * 60; // 30日
export const REFRESH_TTL_SECONDS = 90 * 24 * 60 * 60; // 90日

// redirect_uri の許可リスト（完全一致のみ）。他の値を足したい場合はここに追加する。
export const ALLOWED_REDIRECT_URIS: readonly string[] = [
  "https://claude.ai/api/mcp/auth_callback",
];

export function isAllowedRedirectUri(uri: string): boolean {
  return ALLOWED_REDIRECT_URIS.includes(uri);
}

/** トークン発行のたびに呼ぶ一意な乱数(jti)。 */
export function generateJti(): string {
  return randomBytes(9).toString("base64url");
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/** payload(type/expを含む) を HMAC 署名付きトークン文字列にする。 */
export function issueToken(payload: TokenPayload, secret: string): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const sig = signPayload(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export type VerifyResult<T extends TokenPayload> =
  | { ok: true; payload: T }
  | { ok: false; error: "malformed" | "signature" | "expired" | "type" };

function isValidPayloadShape(
  payload: unknown,
  type: TokenPayload["type"]
): payload is TokenPayload {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  if (p.type !== type) return false;
  if (typeof p.exp !== "number" || !Number.isFinite(p.exp)) return false;
  if (typeof p.client_id !== "string") return false;
  if (type === "code") {
    return typeof p.challenge === "string" && typeof p.redirect_uri === "string";
  }
  return true;
}

/**
 * トークン文字列を検証する。署名検証はtimingSafeEqualで行う(タイミング攻撃対策)。
 * expectedType と一致しない場合(type混同)は拒否する。
 */
export function verifyTokenString<T extends TokenType>(
  token: string,
  secret: string,
  expectedType: T
): VerifyResult<Extract<TokenPayload, { type: T }>> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, error: "malformed" };
  }
  const [payloadB64, sig] = parts;

  const expectedSig = signPayload(payloadB64, secret);
  const sigBuf = Buffer.from(sig, "base64url");
  const expectedBuf = Buffer.from(expectedSig, "base64url");
  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return { ok: false, error: "signature" };
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "malformed" };
  }

  if (!isValidPayloadShape(rawPayload, expectedType)) {
    return { ok: false, error: "type" };
  }

  if (rawPayload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, error: "expired" };
  }

  return {
    ok: true,
    payload: rawPayload as Extract<TokenPayload, { type: T }>,
  };
}

/** PKCE S256: code_verifier から code_challenge を計算する(RFC 7636)。 */
export function computeS256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** PKCE検証: code_verifier のS256ハッシュが challenge と一致するか。 */
export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(computeS256Challenge(verifier));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/**
 * パスフレーズ比較(タイミング攻撃対策)。
 * 入力長が異なると timingSafeEqual は長さ不一致で使えないため、
 * 先にSHA-256で固定長化してから比較する(長さの違いもタイミングで漏らさない)。
 */
export function verifyPassphrase(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
