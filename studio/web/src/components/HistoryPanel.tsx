import { useEffect, useState } from "react";
import { listJobs } from "../api";
import type { Job } from "../types";
import CaseCard from "./CaseCard";
import IdeaShape from "./IdeaShape";

// ジョブ履歴（DESIGN.md §7・P4）: 一覧（日時・タブ・テーマ・状態）→クリックで過去ジョブの
// 結果カードを再表示するだけの最小UI。承認・編集は行わない。GET /api/jobs は既にジョブ履歴
// APIとして稼働済み（jobs.ts::listJobs、日時降順ソート済み）。

interface Props {
  onClose: () => void;
}

const STATUS_LABEL: Record<Job["status"], string> = {
  running: "実行中",
  done: "完了",
  error: "失敗",
};

function formatAt(at: string): string {
  try {
    return new Date(at).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return at;
  }
}

/** タブ表示ラベル。research タブは request.kind（Case Study/Technology/両方）で区別する。 */
function tabLabel(job: Job): string {
  if (job.tab === "idea") return "idea";
  const kind = job.request && typeof job.request.kind === "string" ? job.request.kind : "Research";
  return kind;
}

function themeLabel(job: Job): string {
  const theme = job.request && typeof job.request.theme === "string" ? job.request.theme.trim() : "";
  return theme || "（テーマ未記録）";
}

function ResultCardsGrid({ job }: { job: Job }) {
  if (job.status === "error") {
    return <p className="history-empty">このジョブは失敗しました{job.error ? `: ${job.error}` : ""}</p>;
  }
  if (job.resultCards.length === 0) {
    return <p className="history-empty">結果カードがありません。</p>;
  }
  if (job.tab === "idea") {
    return (
      <div className="grid-idea">
        {job.resultCards.map((card) => (
          <IdeaShape key={card.id} card={card} />
        ))}
      </div>
    );
  }
  return (
    <div className="grid-case">
      {job.resultCards.map((card) => (
        <CaseCard key={card.id} card={card} />
      ))}
    </div>
  );
}

export default function HistoryPanel({ onClose }: Props) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Job | null>(null);

  useEffect(() => {
    let cancelled = false;
    listJobs()
      .then((list) => {
        if (!cancelled) setJobs(list);
      })
      .catch((err) => {
        console.error("[studio] failed to load job history", err);
        if (!cancelled) setLoadError("ジョブ履歴の取得に失敗しました。");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (selected) {
    return (
      <div className="history" data-view="history-detail">
        <div className="history-head">
          <button type="button" className="again" data-history-back onClick={() => setSelected(null)}>
            ← 履歴一覧へ戻る
          </button>
          <span className="q">
            {tabLabel(selected)} · <b>{themeLabel(selected)}</b> · {formatAt(selected.at)} ·{" "}
            {STATUS_LABEL[selected.status]}
          </span>
        </div>
        <ResultCardsGrid job={selected} />
      </div>
    );
  }

  return (
    <div className="history" data-view="history-list">
      <div className="history-head">
        <button type="button" className="again" onClick={onClose}>
          ← 戻る
        </button>
        <span className="q">ジョブ履歴</span>
      </div>
      {loadError && <p className="history-empty">{loadError}</p>}
      {!loadError && jobs === null && <p className="history-empty">読み込み中…</p>}
      {!loadError && jobs !== null && jobs.length === 0 && <p className="history-empty">まだジョブがありません。</p>}
      {!loadError && jobs !== null && jobs.length > 0 && (
        <ul className="history-list">
          {jobs.map((job) => (
            <li key={job.id}>
              <button type="button" className="history-item" data-history-item onClick={() => setSelected(job)}>
                <span className="history-item-at">{formatAt(job.at)}</span>
                <span className="history-item-tab">{tabLabel(job)}</span>
                <span className="history-item-theme">{themeLabel(job)}</span>
                <span className={`history-item-status status-${job.status}`}>{STATUS_LABEL[job.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
