import { useEffect, useRef, useState } from "react";
import { createJob, getJob, subscribeJobStream } from "../api";
import { estimateRemainingMinutes } from "../eta";
import { minDelay } from "../timing";
import type { Job, ResultCard } from "../types";
import CaseCard from "./CaseCard";
import SegmentedControl from "./SegmentedControl";

type Stage = "form" | "loading" | "results" | "error";
type Kind = "Case Study" | "Technology" | "両方";

interface Summary {
  theme: string;
  count: number;
}

// ジョブ状況ポーリング間隔。SSE接続に失敗/切断した場合のフォールバックとして使う
// （DESIGN.md §10 P4: SSE優先、切断時は既存ポーリングへフォールバック）。
const POLL_INTERVAL_MS = 3000;

export default function ResearchPanel() {
  const [stage, setStage] = useState<Stage>("form");
  const [kind, setKind] = useState<Kind>("Case Study");
  const [theme, setTheme] = useState("");
  const [refUrl, setRefUrl] = useState("");
  const [viewpoint, setViewpoint] = useState("");
  const [count, setCount] = useState("8");
  const [resultCards, setResultCards] = useState<ResultCard[]>([]);
  const [summary, setSummary] = useState<Summary>({ theme: "", count: 0 });
  const [progress, setProgress] = useState("収集 → 一次ソース検証 → 反映（自動）");
  const [warning, setWarning] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [jobError, setJobError] = useState("");
  const pollTimer = useRef<number | null>(null);
  const sseCleanup = useRef<(() => void) | null>(null);

  const stopWatching = () => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    sseCleanup.current?.();
    sseCleanup.current = null;
  };

  useEffect(() => stopWatching, []);

  /** running/error/done それぞれをUI状態へ反映する（SSE・ポーリング共通のロジック）。 */
  const applyJob = (job: Job, themeAtStart: string): void => {
    if (job.status === "running") {
      setProgress(job.progress || "処理中…");
      return;
    }
    if (job.status === "error") {
      setJobError(job.error || "不明なエラーが発生しました。");
      setStage("error");
      return;
    }
    setResultCards(job.resultCards);
    setSummary({ theme: themeAtStart, count: job.resultCards.length });
    setWarning(job.warning);
    setStage("results");
  };

  const pollJob = (id: string, themeAtStart: string) => {
    const tick = async () => {
      let job: Job;
      try {
        job = await getJob(id);
      } catch (err) {
        // サーバは監査/verify中に子プロセスを起動する（P4で非ブロッキング化済みだが、
        // ネットワーク瞬断等でポーリングが一時的に失敗する可能性は残る）。ジョブJSONが
        // error と言うまでは失敗＝終了とせず、注記を出して粘る。
        console.warn("[studio] job polling failed (transient?), retrying", err);
        setProgress("サーバ応答待ち（処理は継続中の可能性）…");
        pollTimer.current = window.setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }
      applyJob(job, themeAtStart);
      if (job.status === "running") {
        pollTimer.current = window.setTimeout(tick, POLL_INTERVAL_MS);
      }
    };
    void tick();
  };

  /** SSEで進捗を購読する。接続エラー時は購読を止めて既存ポーリングへフォールバックする。 */
  const watchJob = (id: string, themeAtStart: string): void => {
    sseCleanup.current = subscribeJobStream(
      id,
      (job) => applyJob(job, themeAtStart),
      (err) => {
        console.warn("[studio] SSE stream failed, falling back to polling", err);
        sseCleanup.current = null;
        pollJob(id, themeAtStart);
      },
    );
  };

  const handleRun = async () => {
    setFormError(null);
    stopWatching(); // 前回ジョブの購読が残っていれば止める（二重購読防止）
    // ETAが誤らないよう種別ごとに文言を変える（eta.ts参照。サーバ応答が届くまでの
    // クライアント側の楽観的初期表示。「両方」はCaseフェーズから始まるため既定のままでよい）。
    setProgress(kind === "Technology" ? "技術収集を開始しています…" : "収集を開始しています…");
    setStage("loading");
    try {
      const [job] = await Promise.all([
        createJob("research", { kind, theme, refUrl, viewpoint, count }),
        minDelay(),
      ]);
      if (job.status === "error") {
        setJobError(job.error || "不明なエラーが発生しました。");
        setStage("error");
        return;
      }
      if (job.status === "done") {
        setResultCards(job.resultCards);
        setSummary({ theme, count: job.resultCards.length });
        setWarning(job.warning);
        setStage("results");
        return;
      }
      watchJob(job.id, theme);
    } catch (err) {
      console.error("[studio] research job failed", err);
      setFormError(
        err instanceof Error ? err.message : "リサーチの実行に失敗しました。もう一度お試しください。",
      );
      setStage("form");
    }
  };

  const handleAgain = () => {
    setFormError(null);
    setStage("form");
  };

  const etaMinutes = stage === "loading" ? estimateRemainingMinutes(progress) : null;

  return (
    <>
      <div className={`stage${stage === "form" ? " on" : ""}`} data-stage="form">
        <form className="form" onSubmit={(e) => e.preventDefault()}>
          <div className="field">
            <label>リサーチ種別</label>
            <SegmentedControl
              label="種別"
              options={["Case Study", "Technology", "両方"]}
              value={kind}
              onChange={(v) => setKind(v as Kind)}
            />
          </div>
          <div className="field">
            <label>テーマ</label>
            <input
              className="inp"
              placeholder="例: 新聞広告のクリエイティブ事例"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            />
          </div>
          <div className="field">
            <label>
              参照URL <span className="sub">任意 · 「これ系」の例を1〜3本（精度が上がる）</span>
            </label>
            <input
              className="inp"
              placeholder="https://…（＋で追加）"
              value={refUrl}
              onChange={(e) => setRefUrl(e.target.value)}
            />
          </div>
          <div className="field">
            <label>
              観点 <span className="sub">何を「新しい」と見るか</span>
            </label>
            <input
              className="inp"
              placeholder="例: 新聞という媒体の使い方が新しい"
              value={viewpoint}
              onChange={(e) => setViewpoint(e.target.value)}
            />
          </div>
          <div className="field">
            <label>件数</label>
            <input className="inp" value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
          <button className="go" type="button" data-run="research" onClick={handleRun}>
            リサーチ開始
          </button>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
        </form>
      </div>

      <div className={`stage${stage === "loading" ? " on" : ""}`} data-stage="loading">
        <div className="loading" role="status">
          <div className="lead">
            Researching<span className="dots"></span>
          </div>
          <div className="bar">
            <i></i>
          </div>
          <div className="steps">{progress}</div>
          {etaMinutes !== null && <div className="eta">残り 〜{etaMinutes}分程度</div>}
        </div>
      </div>

      <div className={`stage${stage === "error" ? " on" : ""}`} data-stage="error">
        <div className="error-block" role="alert">
          <div className="lead">リサーチに失敗しました</div>
          <div className="msg">{jobError}</div>
          <button className="again" type="button" onClick={handleAgain}>
            新しいリサーチ
          </button>
        </div>
      </div>

      <div className={`stage${stage === "results" ? " on" : ""}`} data-stage="results">
        <div className="rhead">
          <span className="done">✓ RM に自動反映</span>
          <span className="q">
            テーマ <b>{summary.theme}</b> · {summary.count}件
          </span>
          <button className="again" type="button" data-again="research" onClick={handleAgain}>
            新しいリサーチ
          </button>
        </div>
        {warning && <p className="warning-note">⚠ {warning}</p>}
        <div className="grid-case">
          {resultCards.map((card) => (
            <CaseCard key={card.id} card={card} />
          ))}
        </div>
      </div>
    </>
  );
}
