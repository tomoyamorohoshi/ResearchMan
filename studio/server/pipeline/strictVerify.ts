/**
 * verify の厳密化（DESIGN.md §10 P4 #5・studio側のみ、デイリースクリプト無改変）。
 *
 * 既存の scripts/verify-deploy.mjs / scripts/verify-tech-pages.mjs は
 * 「新規ページが200を返すか」までしか確認しない（cases/technologyの新規idはos.tmpdir()/*-last-add.json
 * から最大2件のみ・ideaは/ideasの新規反映確認自体が無い）。このモジュールは push 後の
 * 追加確認として、新規追加した各エントリのページが実際に「そのタイトルを含む本文」で
 * 200を返すまでポーリングする（200だけでは古いビルドのキャッシュ等を反映済みと誤認しうる
 * ため、実際の内容マーカーで確認する＝「厳密化」）。
 *
 * 既存verify-deploy呼び出しは置き換えず、その後段の追加確認として各パイプラインから呼ぶ。
 * タイムアウトしても例外は投げない（P1 #2の流儀＝呼び出し側がstatus:doneのままwarningを
 * 付けて返す。基本のverify-deployが既にpush到達を確認済みのため、ここでの時間切れは
 * 「もう少し待てば反映される」程度の注意喚起で十分という判断）。
 *
 * fetch/sleep はDIし、実ネットワークに依存せず単体テストできるようにする
 * （budget.tsと同じ「危険側の分岐をユニットテストで検証する」方針）。
 */
export interface StrictVerifyTarget {
  url: string;
  /** このURLの本文に全て含まれていれば「反映済み」と判定するマーカー文字列群（例: タイトル）。 */
  markers: string[];
}

export interface StrictVerifyResult {
  ok: boolean;
  /** タイムアウト時点でまだ未達だったURL（ok=trueなら常に空配列）。 */
  failedUrls: string[];
}

export interface PollStrictVerifyOptions {
  maxTries?: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  /** 1リクエストあたりの上限（独立レビュー指摘#6）。既定10秒。 */
  requestTimeoutMs?: number;
}

const DEFAULT_MAX_TRIES = 12;
const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

// 独立レビュー指摘#5: ReactのSSR出力は"&"/"<"/">"を自動でHTMLエンティティ化するため
// （例: "Tom & Jerry" → "Tom &amp; Jerry"）、これらを含むマーカー（生の形）は本文に
// 絶対に現れず恒久的に不一致になる（cases.jsonに413件実在。毎回タイムアウトまでの
// 無駄待ち＋誤warningの原因だった）。エスケープ済み形とのOR一致で救う。
function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function checkTarget(
  target: StrictVerifyTarget,
  fetchImpl: typeof fetch,
  requestTimeoutMs: number,
): Promise<boolean> {
  try {
    // 独立レビュー指摘#6: fetchがハングすると（相手サーバの応答なし等）、verify-deployが
    // 既にpush到達を確認済みであるにも関わらず、この追加確認だけが無期限にlockを
    // 保持したまま止まってしまう。AbortControllerで1リクエストの上限を明示する。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const res = await fetchImpl(target.url, {
        headers: { "User-Agent": "studio-strict-verify" },
        signal: controller.signal,
      });
      if (res.status !== 200) return false;
      const body = await res.text();
      return target.markers.every((m) => body.includes(m) || body.includes(htmlEscape(m)));
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/**
 * 全targetの本文に、それぞれのmarkersが揃って現れるまで最大 maxTries 回ポーリングする。
 * targetsが空なら即ok（何も確認するものが無い）。
 */
export async function pollStrictVerify(
  targets: StrictVerifyTarget[],
  options: PollStrictVerifyOptions = {},
): Promise<StrictVerifyResult> {
  if (targets.length === 0) return { ok: true, failedUrls: [] };

  const maxTries = options.maxTries ?? DEFAULT_MAX_TRIES;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  let lastFailedUrls: string[] = targets.map((t) => t.url);
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const results = await Promise.all(
      targets.map(async (t) => ({ url: t.url, ok: await checkTarget(t, fetchImpl, requestTimeoutMs) })),
    );
    const failedUrls = results.filter((r) => !r.ok).map((r) => r.url);
    if (failedUrls.length === 0) return { ok: true, failedUrls: [] };
    lastFailedUrls = failedUrls;
    if (attempt < maxTries) await sleepImpl(intervalMs);
  }
  return { ok: false, failedUrls: lastFailedUrls };
}
