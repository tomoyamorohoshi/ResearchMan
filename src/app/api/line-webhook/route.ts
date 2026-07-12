// LINE Webhook中継API（OPERATIONS.md「LINE連携」参照）。
// LINE→Tailscale Funnel直結はFunnel公開入口（特にIPv6側）が断続的に落ち
// 配信成功率が4割を切ることが実測で判明したため（2026-07-13）、
// 常時安定なVercelで受けてStudio（自宅PCのFunnel URL）へIPv4強制で転送する。
//
// 署名検証はここでは行わずStudio側に委ねる（X-Line-Signatureと生ボディを
// そのまま転送するため検証可能性は保たれる。secretをVercelに置かない）。
//
// LINEへは即時200を返し、転送はafter()でレスポンス後に行う。コールドスタート時に
// 転送を待つとLINE側タイムアウトで配信失敗扱いになるため（切替直後の実測で8回中1回）。
// 転送失敗はVercelのログにのみ残る（LINE再送は発火しない点は許容するトレードオフ）。
import { after } from "next/server";
import { request as httpsRequest } from "node:https";

const TARGET_URL =
  process.env.LINE_RELAY_TARGET ??
  "https://laptop-95255niv.tail5f64f5.ts.net/line-webhook";

// Funnel入口のIPv6経路が不安定なためIPv4を強制する
const FORCE_IPV4 = 4;
const FORWARD_TIMEOUT_MS = 8000;
const FORWARD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

export const dynamic = "force-dynamic";

type ForwardResult = { status: number; body: string };

function forwardOnce(rawBody: Buffer, signature: string | null): Promise<ForwardResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(TARGET_URL);
    const req = httpsRequest(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        family: FORCE_IPV4,
        timeout: FORWARD_TIMEOUT_MS,
        headers: {
          "content-type": "application/json",
          "content-length": rawBody.length,
          ...(signature ? { "x-line-signature": signature } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 502, body: Buffer.concat(chunks).toString("utf-8") }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("forward timeout")));
    req.on("error", reject);
    req.end(rawBody);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function forwardWithRetries(rawBody: Buffer, signature: string | null): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FORWARD_ATTEMPTS; attempt++) {
    try {
      const result = await forwardOnce(rawBody, signature);
      if (result.status < 500) return;
      lastError = new Error(`studio returned ${result.status}: ${result.body}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < FORWARD_ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }
  console.error("[api/line-webhook] forward failed after retries", lastError);
}

export async function POST(request: Request) {
  const rawBody = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get("x-line-signature");

  after(() => forwardWithRetries(rawBody, signature));
  return Response.json({ ok: true });
}

export async function GET() {
  return Response.json({ ok: true, role: "line-webhook relay" });
}
