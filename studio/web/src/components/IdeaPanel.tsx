import { useEffect, useRef, useState } from "react";
import { createJob, getJob, subscribeJobStream } from "../api";
import { estimateRemainingMinutes } from "../eta";
import { minDelay } from "../timing";
import type { Job, ResultCard } from "../types";
import IdeaShape from "./IdeaShape";
import SegmentedControl from "./SegmentedControl";

type Stage = "form" | "loading" | "results" | "error";
type Source = "全事例から" | "お気に入り中心";

interface Summary {
  theme: string;
  count: number;
}

// ジョブ状況ポーリング間隔。SSE接続に失敗/切断した場合のフォールバックとして使う
// （ResearchPanelと同じ値。DESIGN.md §10 P4: SSE優先、切断時は既存ポーリングへフォールバック）。
const POLL_INTERVAL_MS = 3000;

export default function IdeaPanel() {
  const [stage, setStage] = useState<Stage>("form");
  const [theme, setTheme] = useState("");
  const [constraint, setConstraint] = useState("");
  const [source, setSource] = useState<Source>("全事例から");
  const [count, setCount] = useState("6");
  const [resultCards, setResultCards] = useState<ResultCard[]>([]);
  const [summary, setSummary] = useState<Summary>({ theme: "", count: 0 });
  const [progress, setProgress] = useState("切り口抽出 → テーマに適用 → 反映（自動）");
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
        console.warn("[studio] idea job polling failed (transient?), retrying", err);
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
        console.warn("[studio] idea SSE stream failed, falling back to polling", err);
        sseCleanup.current = null;
        pollJob(id, themeAtStart);
      },
    );
  };

  const handleRun = async () => {
    setFormError(null);
    if (!theme.trim()) {
      setFormError("お題を入力してください");
      return;
    }
    stopWatching(); // 前回ジョブの購読が残っていれば止める（二重購読防止）
    setProgress("切り口を選定しています…");
    setStage("loading");
    try {
      const [job] = await Promise.all([
        createJob("idea", { theme, constraint, source, count }),
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
      console.error("[studio] idea job failed", err);
      setFormError(
        err instanceof Error ? err.message : "アイデア生成に失敗しました。もう一度お試しください。",
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
            <label>
              テーマ（お題） <span className="sub">これに対してアイデアをもらう</span>
            </label>
            <input
              className="inp"
              placeholder="例: 通勤の移動体験を豊かにする"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            />
          </div>
          <div className="field">
            <label>
              縛り・文脈 <span className="sub">任意 · 領域/媒体/ブランド等</span>
            </label>
            <input
              className="inp"
              placeholder="例: 屋外・鉄道／若年層"
              value={constraint}
              onChange={(e) => setConstraint(e.target.value)}
            />
          </div>
          <div className="field">
            <label>
              切り口の源 <span className="sub">Case Studyで学んだ発想の型を踏襲</span>
            </label>
            <SegmentedControl
              label="切り口の源"
              options={["全事例から", "お気に入り中心"]}
              value={source}
              onChange={(v) => setSource(v as Source)}
            />
          </div>
          <div className="field">
            <label>件数</label>
            <input className="inp" value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
          <button className="go" type="button" data-run="idea" onClick={handleRun}>
            アイデアを生成
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
            Thinking<span className="dots"></span>
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
          <div className="lead">アイデア生成に失敗しました</div>
          <div className="msg">{jobError}</div>
          <button className="again" type="button" onClick={handleAgain}>
            新しいアイデア生成
          </button>
        </div>
      </div>

      <div className={`stage${stage === "results" ? " on" : ""}`} data-stage="results">
        <div className="rhead">
          <span className="done">✓ RM の Ideas に自動反映</span>
          <span className="q">
            お題 <b>{summary.theme}</b> · 事例の切り口で{summary.count}案
          </span>
          <button className="again" type="button" data-again="idea" onClick={handleAgain}>
            もう一度生成
          </button>
        </div>
        {warning && <p className="warning-note">⚠ {warning}</p>}
        <div className="grid-idea">
          {resultCards.map((card) => (
            <IdeaShape key={card.id} card={card} />
          ))}
        </div>
      </div>
    </>
  );
}
