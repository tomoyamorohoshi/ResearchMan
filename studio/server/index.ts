/**
 * ResearchMan Studio ローカルサーバ。
 *
 * Express + Vite(middlewareMode) で SPA を配信しつつジョブAPIを提供する。
 * research タブは Case Study(P1)/Technology(P2)/両方(P2) すべて実パイプライン化済み
 * （Claude Agent SDK。jobs.ts::createJob 参照）。idea タブも P3 で実パイプライン化済み。
 *
 * SSE 進捗ストリーム（GET /api/jobs/:id/stream）は P4 で実装予定。
 * 現時点では意図的に未実装（ルートも作らない。進捗はポーリングで返す）。
 */
import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createJob, getJob, listJobs, ValidationError } from "./jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.STUDIO_PORT) || 5178;

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());

  // ── API ルート（Vite middleware より先にmount） ──────────────────
  app.post("/api/jobs", async (req, res) => {
    try {
      const { tab, request } = req.body ?? {};
      if (tab !== "research" && tab !== "idea") {
        res.status(400).json({ error: 'tab must be "research" or "idea"' });
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

  // GET /api/jobs/:id/stream (SSE進捗) は P4 予定。P0では実装しない。

  // ── Vite dev middleware（SPA） ─────────────────────────────────────
  const vite = await createViteServer({
    root: path.join(STUDIO_ROOT, "web"),
    configFile: path.join(STUDIO_ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
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

main();
