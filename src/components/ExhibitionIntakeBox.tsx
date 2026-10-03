"use client";

import { useState, type FormEvent } from "react";

const TOKEN_KEY = "researchman-exhibition-intake-token";

type Message = { kind: "ok" | "info" | "error"; text: string };

function readToken(): string {
  try {
    return (window.localStorage.getItem(TOKEN_KEY) ?? "").trim();
  } catch {
    return "";
  }
}
function saveToken(token: string) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage 不可（プライベートモード等）。今回の送信は通り、次回は再入力になるだけ
  }
}
function clearToken() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 無視
  }
}

// 全角空白を含む空白を全て除去（URL に空白は入らない。貼り付け時の混入対策）
const stripSpaces = (s: string) => s.replace(/[\s　]/g, "");

export default function ExhibitionIntakeBox() {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [needToken, setNeedToken] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot（人間は触らない）
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (busy) return;
    const cleanUrl = stripSpaces(url);
    if (!cleanUrl) {
      setMessage({ kind: "error", text: "URLを入力してください" });
      return;
    }
    const effectiveToken = needToken ? token.trim() : readToken();
    if (!effectiveToken) {
      // 初回送信（保存済みパスフレーズ無し）: 入力欄を出して入力を促す
      setNeedToken(true);
      setMessage({ kind: "info", text: "パスフレーズを入力してから、もう一度送信してください" });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/exhibition-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-intake-token": effectiveToken },
        body: JSON.stringify({ url: cleanUrl, website }),
      });
      if (res.status === 401) {
        clearToken();
        setToken("");
        setNeedToken(true);
        setMessage({ kind: "error", text: "パスフレーズが違います。もう一度入力してください" });
        return;
      }
      // 401 以外ならパスフレーズは受理されている
      saveToken(effectiveToken);
      setNeedToken(false);
      setToken("");
      if (res.status === 200) {
        let status = "";
        try {
          status = ((await res.json()) as { status?: string }).status ?? "";
        } catch {
          // 本文が読めなくても 200 は受付成功
        }
        if (status === "duplicate") {
          setMessage({ kind: "info", text: "すでに受付済みです。明日の更新で反映されます" });
        } else if (status === "already_processed") {
          setMessage({ kind: "info", text: "このURLはすでに処理済みです" });
        } else {
          setMessage({ kind: "ok", text: "受け付けました。明日の更新で反映されます" });
          setUrl("");
        }
      } else if (res.status === 400) {
        setMessage({ kind: "error", text: "X/Instagramの投稿URLのみ受け付けます" });
      } else if (res.status === 429) {
        setMessage({ kind: "error", text: "受付上限に達しています。時間をおいてお試しください" });
      } else if (res.status === 503) {
        setMessage({ kind: "error", text: "現在受付できません" });
      } else {
        setMessage({ kind: "error", text: "送信に失敗しました。時間をおいてお試しください" });
      }
    } catch (err) {
      // 非 ASCII のパスフレーズはヘッダ設定時に TypeError（fetch 到達前）
      const nonAscii = err instanceof TypeError && [...effectiveToken].some((c) => c.charCodeAt(0) > 127);
      setMessage({
        kind: "error",
        text: nonAscii
          ? "パスフレーズは半角英数字記号で入力してください"
          : "送信に失敗しました。通信状況を確認してください",
      });
    } finally {
      setBusy(false);
    }
  }

  const tone =
    message?.kind === "ok" ? "text-emerald-700" : message?.kind === "error" ? "text-red-600" : "text-gray-600";

  return (
    <section aria-label="展覧会URLの投稿" className="border-b border-gray-300 bg-[#eeece7]">
      <form onSubmit={onSubmit} className="max-w-[1600px] mx-auto px-4 py-3 flex flex-wrap items-end gap-x-4 gap-y-2" noValidate>
        <div className="flex flex-col gap-1 flex-1 min-w-60 max-w-xl">
          <label htmlFor="exhibition-intake-url" className="text-[9px] tracking-[0.2em] font-bold text-gray-500">
            気になる展示の投稿URL（X / Instagram）
          </label>
          <input
            id="exhibition-intake-url"
            type="text"
            inputMode="url"
            autoComplete="off"
            placeholder="https://x.com/…/status/…"
            value={url}
            onChange={(e) => setUrl(stripSpaces(e.target.value))}
            className="bg-transparent border-b border-gray-400 pb-0.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-900 tracking-wide"
          />
        </div>

        {needToken && (
          <div className="flex flex-col gap-1 min-w-40">
            <label htmlFor="exhibition-intake-token" className="text-[9px] tracking-[0.2em] font-bold text-gray-500">
              パスフレーズ
            </label>
            <input
              id="exhibition-intake-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="bg-transparent border-b border-gray-400 pb-0.5 text-xs text-gray-900 focus:outline-none focus:border-gray-900"
            />
          </div>
        )}

        {/* honeypot: 画面外・支援技術からも隠す。bot だけが埋める */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
          <label htmlFor="exhibition-intake-website">website</label>
          <input
            id="exhibition-intake-website"
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="text-[10px] tracking-[0.2em] uppercase font-black px-3 py-1.5 bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors"
        >
          {busy ? "送信中…" : "投稿する"}
        </button>

        <p role="status" aria-live="polite" className={`basis-full text-[11px] min-h-4 ${tone}`} data-intake-message>
          {message?.text ?? ""}
        </p>
      </form>
    </section>
  );
}
