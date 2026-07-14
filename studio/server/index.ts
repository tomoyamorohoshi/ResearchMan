/**
 * ResearchMan Studio ローカルサーバ。
 *
 * Express + Vite(middlewareMode) で SPA を配信しつつジョブAPIを提供する。
 * research タブは Case Study(P1)/Technology(P2)/両方(P2) すべて実パイプライン化済み
 * （Claude Agent SDK。jobs.ts::createJob 参照）。idea タブも P3 で実パイプライン化済み。
 *
 * SSE 進捗ストリーム（GET /api/jobs/:id/stream、P4 #2）を実装済み。jobs.ts::updateJob() が
 * jobs.ts::subscribeJob() 経由でemitするジョブ更新をそのままSSEフレームとして流す。
 * ジョブがrunningでなくなった時点でサーバ側からストリームを閉じる。UI側は接続失敗/切断時
 * 既存のポーリング（5c8251e のリトライ耐性込み）へフォールバックする（ResearchPanel.tsx/
 * IdeaPanel.tsx参照）。
 *
 * createApp() はルート登録のみを行う（Vite mount・listen・ブラウザ自動起動は含めない）。
 * index.test.ts がVite抜きでHTTPルートだけを単体テストできるようにするための分離
 * （Viteのmiddlewaresをmountするとテストごとに web/ ルートの解決が必要になり重い）。
 */
import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createJob, getJob, listJobs, subscribeJob, ValidationError, type Job } from "./jobs.js";
import { createLineWebhookHandler } from "./line/webhook.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.STUDIO_PORT) || 5178;

// 従量課金防止ガード: APIキー系の環境変数が紛れ込んでいても必ず捨て、
// Claude Agent SDK / CLI が常にサブスクリプションのログイン認証で動くことを保証する
// （ユーザー方針 2026-07-13。scripts/lib/claude-cli.mjs / scripts/windows/run-job.mjs にも同じガードあり）。
for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
  if (process.env[key]) {
    console.warn(`[studio] ${key} が設定されていましたが従量課金防止のため無視します`);
    delete process.env[key];
  }
}

export function createApp(): express.Express {
  const app = express();

  // POST /api/line-webhook（LINEで依頼機能）: X-Line-Signature の検証には生のリクエスト
  // ボディが必要なため、下の express.json() より前に、このルート専用の express.raw() を
  // 登録する（Expressはミドルウェア/ルートを登録順に評価するため、ここでボディを
  // Bufferとして消費すれば、後段の express.json() はこのパスに関しては素通りする）。
  // ルート本体（署名検証・許可送信者チェック・pending・ジョブ投入）は line/webhook.ts に分離。
  app.post("/api/line-webhook", express.raw({ type: "*/*" }), createLineWebhookHandler());

  app.use(express.json());

  // ── API ルート ──────────────────────────────────────────────────
  app.post("/api/jobs", async (req, res) => {
    try {
      const { tab, request } = req.body ?? {};
      if (tab !== "research" && tab !== "idea" && tab !== "add-case") {
        res.status(400).json({ error: 'tab must be "research", "idea", or "add-case"' });
        return;
      }
      const job = await createJob(tab, request ?? {});
      res.status(200).json(job);
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error("[studio] POST /api/jobs failed", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  app.get("/api/jobs", async (_req, res) => {
    try {
      const jobs = await listJobs();
      res.status(200).json(jobs);
    } catch (err) {
      console.error("[studio] GET /api/jobs failed", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  app.get("/api/jobs/:id", async (req, res) => {
    const job = await getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.status(200).json(job);
  });

  // GET /api/jobs/:id/stream (SSE進捗・P4 #2)
  app.get("/api/jobs/:id/stream", async (req, res) => {
    const job = await getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "not found" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // リバースプロキシ経由でもバッファされないよう明示（ローカル用途だが安全側）
    });

    let ended = false;
    const send = (j: Job): void => {
      if (ended) return;
      res.write(`data: ${JSON.stringify(j)}\n\n`);
    };
    const endStream = (): void => {
      if (ended) return;
      ended = true;
      unsubscribe();
      res.end();
    };

    // adversarial-review指摘#2: 「最初のgetJob() → subscribeJob()」の順だと、その間に
    // updateJob()が発火した更新イベントを取りこぼし、ストリームがrunningのまま
    // 応答されなくなる（clientはonerrorでしかポーリングへフォールバックしないため
    // 無音ハングになる）。取りこぼし窓を塞ぐため、まず購読を先に登録し（以降の更新は
    // 必ずlistenerが拾う）、その後もう一度現在状態を読み直してから初期スナップショットとして
    // 送る（購読登録前に発生した更新は、この再読み込みが最新のファイル内容を拾うことで
    // カバーされる。subscribeJob〜再readの間に同期処理の隙間は無い＝Node単一スレッド）。
    const unsubscribe = subscribeJob(job.id, (updated) => {
      send(updated);
      if (updated.status !== "running") endStream();
    });

    const current = (await getJob(job.id)) ?? job;
    send(current);
    if (current.status !== "running") {
      endStream();
    }

    req.on("close", endStream);
  });

  return app;
}

async function main(): Promise<void> {
  const app = createApp();

  // ── Vite dev middleware（SPA） ─────────────────────────────────────
  const vite = await createViteServer({
    root: path.join(STUDIO_ROOT, "web"),
    configFile: path.join(STUDIO_ROOT, "vite.config.ts"),
    // allowedHosts: localhost以外のホスト名アクセスをViteが既定で拒否するため、
    // Tailscale(MagicDNS)のホスト名を許可する（2026-07-11 Windows移行）。
    // アクセス到達自体はTailscale網とLANにファイアウォールで限定済みのため、
    // サフィックス許可で十分安全（デバイス名変更にも耐える）
    server: { middlewareMode: true, allowedHosts: [".ts.net"] },
    appType: "spa",
  });
  app.use(vite.middlewares);

  app.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`[studio] ResearchMan Studio running at ${url}`);
    if (process.platform === "darwin" && !process.env.STUDIO_NO_OPEN) {
      try {
        exec(`open ${url}`);
      } catch (err) {
        console.warn("[studio] failed to auto-open browser", err);
      }
    }
  });
}

// このファイルが直接実行された場合のみサーバを起動する（`tsx server/index.ts`）。
// index.test.ts のように createApp() だけをimportするテストからは main() を走らせない
// （Vite起動・実ポートlisten・ブラウザ自動起動という副作用を避けるため）。
const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main();
}
