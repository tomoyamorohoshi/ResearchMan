// src/lib/mcp-auth.ts の単体テスト（node:test / tsx実行）。
// 実行: npx tsx --test src/lib/mcp-auth.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  issueToken,
  verifyTokenString,
  computeS256Challenge,
  verifyPkce,
  verifyPassphrase,
  isAllowedRedirectUri,
  ALLOWED_REDIRECT_URIS,
  CODE_TTL_SECONDS,
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  type CodePayload,
  type AccessPayload,
} from "./mcp-auth";

const SECRET = "test-secret-do-not-use-in-prod";
const nowSec = () => Math.floor(Date.now() / 1000);

test("issueToken/verifyTokenString: 往復が成功する（access）", () => {
  const payload: AccessPayload = {
    type: "access",
    client_id: "https://example.com/client.json",
    exp: nowSec() + ACCESS_TTL_SECONDS,
  };
  const token = issueToken(payload, SECRET);
  const result = verifyTokenString(token, SECRET, "access");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.client_id, payload.client_id);
    assert.equal(result.payload.type, "access");
  }
});

test("verifyTokenString: payloadを改竄したトークンは拒否される", () => {
  const payload: AccessPayload = {
    type: "access",
    client_id: "client-a",
    exp: nowSec() + ACCESS_TTL_SECONDS,
  };
  const token = issueToken(payload, SECRET);
  const [payloadB64, sig] = token.split(".");
  // client_id を書き換えたペイロードに差し替える(署名は元のまま=不一致になるはず)
  const tamperedPayload: AccessPayload = { ...payload, client_id: "client-b" };
  const tamperedB64 = Buffer.from(JSON.stringify(tamperedPayload), "utf8").toString(
    "base64url"
  );
  assert.notEqual(tamperedB64, payloadB64);
  const tamperedToken = `${tamperedB64}.${sig}`;
  const result = verifyTokenString(tamperedToken, SECRET, "access");
  assert.equal(result.ok, false);
});

test("verifyTokenString: signatureを改竄したトークンは拒否される", () => {
  const payload: AccessPayload = {
    type: "access",
    client_id: "client-a",
    exp: nowSec() + ACCESS_TTL_SECONDS,
  };
  const token = issueToken(payload, SECRET);
  const [payloadB64] = token.split(".");
  const tamperedToken = `${payloadB64}.${"A".repeat(43)}`;
  const result = verifyTokenString(tamperedToken, SECRET, "access");
  assert.equal(result.ok, false);
});

test("verifyTokenString: exp切れのトークンは拒否される", () => {
  const payload: AccessPayload = {
    type: "access",
    client_id: "client-a",
    exp: nowSec() - 10, // 10秒前に失効済み
  };
  const token = issueToken(payload, SECRET);
  const result = verifyTokenString(token, SECRET, "access");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "expired");
});

test("verifyTokenString: type混同は拒否される(accessをcodeとして検証)", () => {
  const payload: AccessPayload = {
    type: "access",
    client_id: "client-a",
    exp: nowSec() + ACCESS_TTL_SECONDS,
  };
  const token = issueToken(payload, SECRET);
  const result = verifyTokenString(token, SECRET, "code");
  assert.equal(result.ok, false);
});

test("verifyTokenString: 異なるsecretで署名されたトークンは拒否される", () => {
  const payload: AccessPayload = {
    type: "access",
    client_id: "client-a",
    exp: nowSec() + ACCESS_TTL_SECONDS,
  };
  const token = issueToken(payload, "other-secret");
  const result = verifyTokenString(token, SECRET, "access");
  assert.equal(result.ok, false);
});

test("verifyTokenString: refreshトークンの往復も成功する", () => {
  const payload = {
    type: "refresh" as const,
    client_id: "client-a",
    exp: nowSec() + REFRESH_TTL_SECONDS,
  };
  const token = issueToken(payload, SECRET);
  const result = verifyTokenString(token, SECRET, "refresh");
  assert.equal(result.ok, true);
});

test("verifyTokenString: codeトークンの必須フィールド欠落は拒否される", () => {
  // challenge/redirect_uri が欠けた不正payloadを直接組み立てる
  const badPayload = {
    type: "code",
    client_id: "client-a",
    exp: nowSec() + CODE_TTL_SECONDS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(badPayload), "utf8").toString(
    "base64url"
  );
  const sig = issueToken(badPayload as unknown as CodePayload, SECRET).split(".")[1];
  const token = `${payloadB64}.${sig}`;
  const result = verifyTokenString(token, SECRET, "code");
  assert.equal(result.ok, false);
});

// PKCE S256: RFC 7636 Appendix B の公式テストベクタで標準準拠を確認する。
test("computeS256Challenge: RFC7636 Appendix B のテストベクタと一致する", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const expectedChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  assert.equal(computeS256Challenge(verifier), expectedChallenge);
});

test("verifyPkce: 正しいcode_verifierは成功する", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = computeS256Challenge(verifier);
  assert.equal(verifyPkce(verifier, challenge), true);
});

test("verifyPkce: 誤ったcode_verifierは拒否される", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = computeS256Challenge(verifier);
  assert.equal(verifyPkce("wrong-verifier-xxxxxxxxxxxxxxxxxxxxxxxxxxx", challenge), false);
});

test("verifyPassphrase: 正しいパスフレーズは成功する", () => {
  assert.equal(verifyPassphrase("correct-horse", "correct-horse"), true);
});

test("verifyPassphrase: 誤ったパスフレーズは拒否される", () => {
  assert.equal(verifyPassphrase("wrong", "correct-horse"), false);
});

test("verifyPassphrase: 長さが異なる入力でも例外を投げない", () => {
  assert.doesNotThrow(() => verifyPassphrase("a", "much-longer-passphrase-value"));
  assert.equal(verifyPassphrase("a", "much-longer-passphrase-value"), false);
});

test("isAllowedRedirectUri: 既定でclaude.aiのauth_callbackを許可する", () => {
  assert.ok(ALLOWED_REDIRECT_URIS.includes("https://claude.ai/api/mcp/auth_callback"));
  assert.equal(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback"), true);
});

test("isAllowedRedirectUri: 許可リスト外・部分一致は拒否する", () => {
  assert.equal(isAllowedRedirectUri("https://evil.example.com/callback"), false);
  assert.equal(
    isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback/../evil"),
    false
  );
});
