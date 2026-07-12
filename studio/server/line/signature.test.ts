import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { verifyLineSignature } from "./signature.js";

function sign(secret: string, body: Buffer): string {
  return crypto.createHmac("sha256", secret).update(body).digest("base64");
}

test("verifyLineSignature: 正しい署名はtrue", () => {
  const secret = "test-channel-secret";
  const body = Buffer.from(JSON.stringify({ events: [] }), "utf-8");
  const sig = sign(secret, body);
  assert.equal(verifyLineSignature(body, sig, secret), true);
});

test("verifyLineSignature: 本文が改ざんされていればfalse", () => {
  const secret = "test-channel-secret";
  const body = Buffer.from(JSON.stringify({ events: [] }), "utf-8");
  const sig = sign(secret, body);
  const tampered = Buffer.from(JSON.stringify({ events: [{ evil: true }] }), "utf-8");
  assert.equal(verifyLineSignature(tampered, sig, secret), false);
});

test("verifyLineSignature: secretが違えばfalse", () => {
  const body = Buffer.from(JSON.stringify({ events: [] }), "utf-8");
  const sig = sign("secret-a", body);
  assert.equal(verifyLineSignature(body, sig, "secret-b"), false);
});

test("verifyLineSignature: 署名ヘッダ無しはfalse", () => {
  const body = Buffer.from("{}", "utf-8");
  assert.equal(verifyLineSignature(body, undefined, "secret"), false);
  assert.equal(verifyLineSignature(body, null, "secret"), false);
});

test("verifyLineSignature: channelSecret未設定（空文字）はfalse", () => {
  const body = Buffer.from("{}", "utf-8");
  const sig = sign("", body);
  assert.equal(verifyLineSignature(body, sig, ""), false);
});
