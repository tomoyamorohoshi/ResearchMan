// Visit タブの純関数群（docs/EXHIBITION_VISIT_SPEC.md §4/§5）。React / Leaflet / DOM に依存しない。
// 日付は全て JST 暦日の YYYY-MM-DD 文字列。「今日」は常に引数で受け取る。
import { computeStatus, daysBetween, todayJst, type Exhibition } from "./exhibition";

export { todayJst };

// 終了間近: 終了まで7日以内（今日を含む＝残り 0〜7 日）。
export const ENDING_SOON_DAYS = 7;
// 会期バーの最大表示日数。仮定: 「6か月」= 183日。
export const MAX_RANGE_DAYS = 183;
// 会期バー: 今日より何日前から表示するか。
export const RANGE_LEAD_DAYS = 7;
// active が0件のときの既定の表示幅（今日 + この日数 を end にする）。
export const EMPTY_RANGE_AHEAD_DAYS = 30;

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// 終了日までの残り日数（当日=0、終了済みは負）
export function remainingDays(e: Pick<Exhibition, "endDate">, today: string): number {
  return daysBetween(today, e.endDate);
}

export function isEnded(e: Pick<Exhibition, "startDate" | "endDate">, today: string): boolean {
  return computeStatus(e.startDate, e.endDate, today) === "ended";
}

export function isUpcoming(e: Pick<Exhibition, "startDate" | "endDate">, today: string): boolean {
  return computeStatus(e.startDate, e.endDate, today) === "upcoming";
}

// 仮定: 「終了まで7日以内」は開催中のみ対象。開催前は終了日が7日以内でも終了間近にしない
// （開催前は「M/D から」バッジを出す）。
export function isEndingSoon(e: Pick<Exhibition, "startDate" | "endDate">, today: string): boolean {
  if (computeStatus(e.startDate, e.endDate, today) !== "ongoing") return false;
  const left = daysBetween(today, e.endDate);
  return left >= 0 && left <= ENDING_SOON_DAYS;
}

export type VisitBadge = { kind: "urgent" | "upcoming"; label: string };

// バッジ: 当日「今日まで」/ 1〜7日「あと N 日」/ 開催前「M/D から」/ それ以外は null
export function badgeFor(e: Pick<Exhibition, "startDate" | "endDate">, today: string): VisitBadge | null {
  const status = computeStatus(e.startDate, e.endDate, today);
  if (status === "upcoming") {
    const [, m, d] = e.startDate.split("-").map(Number);
    return { kind: "upcoming", label: `${m}/${d} から` };
  }
  if (status === "ongoing") {
    const left = daysBetween(today, e.endDate);
    if (left === 0) return { kind: "urgent", label: "今日まで" };
    if (left <= ENDING_SOON_DAYS) return { kind: "urgent", label: `あと ${left} 日` };
  }
  return null;
}

export type VisitList = { active: Exhibition[]; ended: Exhibition[] };

// Visit 一覧: 行きたい かつ トラッシュでない。終了済み（endDate < today）は ended に分離。
// active: 終了間近を先頭 → 終了日昇順（同日は開始日 → title → id で安定化）。
// ended: 終了日の新しい順（同日は title → id）。
export function deriveVisit(
  items: readonly Exhibition[],
  wantIds: ReadonlySet<string>,
  trashIds: ReadonlySet<string>,
  today: string,
): VisitList {
  const picked = items.filter((e) => wantIds.has(e.id) && !trashIds.has(e.id));
  const active: Exhibition[] = [];
  const ended: Exhibition[] = [];
  for (const e of picked) (isEnded(e, today) ? ended : active).push(e);
  const tie = (a: Exhibition, b: Exhibition) =>
    a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  active.sort((a, b) => {
    const ua = isEndingSoon(a, today) ? 0 : 1;
    const ub = isEndingSoon(b, today) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return a.endDate.localeCompare(b.endDate) || a.startDate.localeCompare(b.startDate) || tie(a, b);
  });
  ended.sort((a, b) => b.endDate.localeCompare(a.endDate) || tie(a, b));
  return { active, ended };
}

// ---- 会期バー ----

export type BarRange = {
  start: string; // 表示範囲の最初の日（含む）
  end: string; // 表示範囲の最後の日（含む）
  days: number; // 日数（start〜end を両端含めて数える）
  clipped: boolean; // 6か月上限で end を切り詰めたか
};

// 表示範囲: start = 今日 - 7日、end = active 中の最も遅い終了日。start + 183日 を超えたらクリップ。
// active が0件のときは end = 今日 + 30日（バーなしの空の軸を出せるように）。
export function computeBarRange(active: readonly Pick<Exhibition, "endDate">[], today: string): BarRange {
  const start = addDays(today, -RANGE_LEAD_DAYS);
  let end =
    active.length === 0
      ? addDays(today, EMPTY_RANGE_AHEAD_DAYS)
      : active.reduce((max, e) => (e.endDate > max ? e.endDate : max), today);
  const limit = addDays(start, MAX_RANGE_DAYS - 1);
  let clipped = false;
  if (end > limit) {
    end = limit;
    clipped = true;
  }
  return { start, end, days: daysBetween(start, end) + 1, clipped };
}

export type BarLayout = {
  visible: boolean; // false = 範囲外で棒なし
  leftDays: number; // start からのオフセット日数（visible のとき）
  widthDays: number; // 両端含む日数（visible のとき）
  left: number; // 0〜1
  width: number; // 0〜1
};

// 棒の位置。開始日・終了日の日付マスを両端含めて塗る。範囲外はクリップ、完全に範囲外なら visible=false。
export function barLayout(e: Pick<Exhibition, "startDate" | "endDate">, range: BarRange): BarLayout {
  const none: BarLayout = { visible: false, leftDays: 0, widthDays: 0, left: 0, width: 0 };
  if (e.endDate < range.start || e.startDate > range.end) return none;
  const s = e.startDate < range.start ? range.start : e.startDate;
  const t = e.endDate > range.end ? range.end : e.endDate;
  const leftDays = daysBetween(range.start, s);
  const widthDays = daysBetween(s, t) + 1;
  return {
    visible: true,
    leftDays,
    widthDays,
    left: leftDays / range.days,
    width: widthDays / range.days,
  };
}

// 今日の縦線位置（0〜1）。今日の日付マスの中央。
export function todayLinePosition(range: BarRange, today: string): number {
  return (daysBetween(range.start, today) + 0.5) / range.days;
}

// ---- 月カレンダー ----

export type CalendarCell = { date: string; day: number; inMonth: boolean };

// 月表示のマス目。週の始まりは日曜、6週(42マス)固定。month は 1〜12。
export function monthGrid(year: number, month: number): CalendarCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstYmd = first.toISOString().slice(0, 10);
  const offset = first.getUTCDay(); // 日曜=0
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(firstYmd, i - offset);
    const [y, m, d] = date.split("-").map(Number);
    cells.push({ date, day: d, inMonth: y === year && m === month });
  }
  return cells;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

// その日（date）に開いている展覧会（startDate <= date <= endDate）。入力順を保つ。
export function exhibitionsOpenOn<T extends Pick<Exhibition, "startDate" | "endDate">>(
  items: readonly T[],
  date: string,
): T[] {
  return items.filter((e) => e.startDate <= date && date <= e.endDate);
}

export type CalendarDay = CalendarCell & { ids: string[] };

export function monthCalendar(
  year: number,
  month: number,
  items: readonly Pick<Exhibition, "id" | "startDate" | "endDate">[],
): CalendarDay[] {
  return monthGrid(year, month).map((c) => ({
    ...c,
    ids: exhibitionsOpenOn(items, c.date).map((e) => e.id),
  }));
}

// ---- 会場の座標 ----

export type VenueGeoEntry = {
  lat: number;
  lng: number;
  source: "nominatim" | "manual";
  query: string;
  checkedAt: string;
};
export type VenueGeo = { version: 1; venues: Record<string, VenueGeoEntry> };

// 会場名の引き当て。前後空白のトリムのみ（あいまい一致なし）。プロトタイプ汚染は自前キーのみ許可で防ぐ。
export function lookupVenueGeo(geo: VenueGeo, venue: string): VenueGeoEntry | undefined {
  const key = venue.trim();
  return Object.prototype.hasOwnProperty.call(geo.venues, key) ? geo.venues[key] : undefined;
}

export type VenuePin = {
  venue: string; // トリム後の会場名
  lat: number;
  lng: number;
  items: Exhibition[];
  urgent: boolean; // items のどれかが終了間近
};

// 座標ありは同じ会場名ごとに1ピンへ束ね（初出順）、座標なしは unlocated で返す。
export function buildPins(
  items: readonly Exhibition[],
  geo: VenueGeo,
  today: string,
): { pins: VenuePin[]; unlocated: Exhibition[] } {
  const byVenue = new Map<string, VenuePin>();
  const unlocated: Exhibition[] = [];
  for (const e of items) {
    const g = lookupVenueGeo(geo, e.venue);
    if (!g) {
      unlocated.push(e);
      continue;
    }
    const key = e.venue.trim();
    let pin = byVenue.get(key);
    if (!pin) {
      pin = { venue: key, lat: g.lat, lng: g.lng, items: [], urgent: false };
      byVenue.set(key, pin);
    }
    pin.items.push(e);
    if (isEndingSoon(e, today)) pin.urgent = true;
  }
  return { pins: [...byVenue.values()], unlocated };
}
