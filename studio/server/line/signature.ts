/**
 * LINE Messaging API webhook の X-Line-Signature 検証（HMAC-SHA256, base64）。
 *
 * 必ず生のリクエストボディ（express.json() 等でパース済みでない Buffer）で計算すること。
 * JSON.stringify(req.body) で作り直したバイト列は、キー順序・空白・エスケープの違いで
 * 元の送信バイト列と一致しない可能性があり、正当なリクエストを誤って401にし得る
 * （studio/server/line/webhook.ts が express.raw() を index.ts の express.json() より前に
 * このルートへ限定適用しているのはこのため）。
 */
import crypto from "node:crypto";

export function verifyLineSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined | null,
  channelSecret: string,
): boolean {
  if (!signatureHeader || !channelSecret) return false;
  const expected = crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const expectedBuf = Buffer.from(expected, "utf-8");
  const actualBuf = Buffer.from(signatureHeader, "utf-8");
  // 長さが違うと timingSafeEqual が例外を投げるため先に弾く（情報漏洩を避けるためlengthの
  // 不一致自体は早期returnで問題ない。攻撃者はどのみち正しいsignatureを知らない限り通せない）。
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}
