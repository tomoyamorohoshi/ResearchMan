/**
 * LINE経由の依頼の対話ウィザード状態(pending)。
 *
 * 「何をしますか?」のメニューから始まり、テーマ→観点→参考→最終確認、と1問1答で
 * 会話を進める状態機械の現在地を studio/workdir/line-pending.json に永続化する
 * （サーバ再起動を挟んでも会話の続きが機能するように。jobs.ts::writeJobFile と
 * 同じ「ファイルへの素朴なJSON書き込み」方式に合わせる）。
 *
 * 許可送信者(allowedUserId)は常に1名の運用のため、pendingは配列/マップではなく単一エントリ
 * （直近の未確認依頼のみを保持。新しい依頼が来れば上書きする）。
 *
 * pending===null は「idle（会話未開始）」を表す。状態遷移の全体像・各状態のロジックは
 * wizard.ts 冒頭コメント参照。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LineRequestKind } from "./classify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PENDING_PATH = path.join(__dirname, "..", "..", "workdir", "line-pending.json");

/** 各応答のたびに更新するTTL（ミリ秒）。DESIGN合意: 30分。 */
export const PENDING_TTL_MS = 30 * 60 * 1000;

export type WizardState =
  | "menu"
  | "await_theme"
  | "confirm_theme"
  | "await_viewpoint"
  | "confirm_viewpoint"
  | "await_refs"
  | "confirm_refs"
  | "final_confirm"
  // 以下2つは仕様上の10状態には無い実装上の内部状態。final_confirmで「n」と答えたあとの
  // 「どこを直しますか?」→対応するawait_*へ遷移、を実現するための中間ステップ
  // （「件数」は独立したawait_countが仕様に存在しないため、この2状態で完結させる）。
  | "select_edit_field"
  | "await_count_edit"
  // AWARDS専用（要件A.2）: research/ideaと違いfinal_confirmを挟まず、Q1/Q2の2問だけで
  // 受付・即実行する（confirm_*系のステップが無い）。
  | "await_award_name"
  | "await_award_categories";

export interface LinePending {
  userId: string;
  state: WizardState;
  /** メニューで選ばれた/ショートカットで判定された種別。menu状態ではまだ未確定。 */
  kind?: LineRequestKind;
  theme?: string;
  /** research種別のみ使う観点。ideaに対応する項目は無い（studio/web/IdeaPanel.tsx参照）。 */
  viewpoint?: string;
  /** research: 参照URL（複数はスペース区切り）。idea: 縛り・文脈（ideaPure.tsのconstraint）。 */
  refs?: string;
  /** 「件数 <n>」等で明示指定された場合のみセット。未指定はpure.ts/ideaPure.tsの既定値に従う。 */
  count?: number;
  /** AWARDS Q1「アワード名は?」への回答（自由文のまま保持し、Q2回答後にまとめて構造化する）。 */
  awardNameRaw?: string;
  /** ISO8601。この時刻を過ぎたら期限切れとして扱う。各応答のたびに+30分へ更新する。 */
  expiresAt: string;
}

/** expiresAtの基準時刻（now）+TTL（純粋。テスト容易性のため呼び出し側からnowを注入）。 */
export function expiryFrom(now: Date): string {
  return new Date(now.getTime() + PENDING_TTL_MS).toISOString();
}

/** pendingが期限切れかどうか（純粋）。null（pending無し=idle）は期限切れ扱い（呼び出し側の分岐を単純化する）。 */
export function isPendingExpired(pending: LinePending | null, now: Date): boolean {
  if (!pending) return true;
  return now.getTime() >= new Date(pending.expiresAt).getTime();
}

async function ensureDir(): Promise<void> {
  await mkdir(path.dirname(PENDING_PATH), { recursive: true });
}

/** 現在のpendingを読む。ファイル無し/壊れたJSONはnull（=idleとして扱う）。 */
export async function loadPending(): Promise<LinePending | null> {
  try {
    const raw = await readFile(PENDING_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as LinePending) : null;
  } catch {
    return null;
  }
}

/** pendingを保存する。null を渡すとクリア（ファイルには null を書く。実ファイル削除はしない— 次回読込がnullを返せば十分なため単純化）。 */
export async function savePending(pending: LinePending | null): Promise<void> {
  await ensureDir();
  await writeFile(PENDING_PATH, JSON.stringify(pending, null, 2), "utf-8");
}
