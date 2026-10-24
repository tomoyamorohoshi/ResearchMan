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
  venue: string; // 代表の会場名（束ねたうち最初の会場。トリム後）。マーカーのキーに使う
  venues: string[]; // 束ねた会場名（初出順・重複なし）
  lat: number;
  lng: number;
  items: Exhibition[];
  urgent: boolean; // items のどれかが終了間近
};

// 会場名が違っても、この距離（m）以内なら同じピンに束ねる（例: 美術館本館とコレクション展示室）
export const PIN_MERGE_METERS = 50;

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// 座標ありは「同じ会場名」または「PIN_MERGE_METERS 以内」で1ピンへ束ね（初出順）、座標なしは unlocated で返す。
export function buildPins(
  items: readonly Exhibition[],
  geo: VenueGeo,
  today: string,
): { pins: VenuePin[]; unlocated: Exhibition[] } {
  const pins: VenuePin[] = [];
  const unlocated: Exhibition[] = [];
  for (const e of items) {
    const g = lookupVenueGeo(geo, e.venue);
    if (!g) {
      unlocated.push(e);
      continue;
    }
    const key = e.venue.trim();
    let pin = pins.find(
      (p) => p.venues.includes(key) || distanceKm(p, g) * 1000 <= PIN_MERGE_METERS,
    );
    if (!pin) {
      pin = { venue: key, venues: [key], lat: g.lat, lng: g.lng, items: [], urgent: false };
      pins.push(pin);
    } else if (!pin.venues.includes(key)) {
      pin.venues.push(key);
    }
    pin.items.push(e);
    if (isEndingSoon(e, today)) pin.urgent = true;
  }
  return { pins, unlocated };
}

// 「東京都」→「東京」。北海道はそのまま。
export function regionLabel(prefecture: string): string {
  return prefecture.length > 2 && /[都府県]$/.test(prefecture) ? prefecture.slice(0, -1) : prefecture;
}

export type PinCluster = { label: string; count: number; pins: VenuePin[] };

// ピン同士が thresholdKm 以内で連結しているものを地域グループにする。展覧会件数の多い順
// （同数は先に出たほう）。ラベルは所属展覧会で最も多い prefecture。
export function clusterPins(pins: readonly VenuePin[], thresholdKm: number): PinCluster[] {
  const parent = pins.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      if (distanceKm(pins[i], pins[j]) <= thresholdKm) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, VenuePin[]>();
  pins.forEach((p, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), p]);
  });
  const out: PinCluster[] = [...groups.values()].map((ps) => {
    const tally = new Map<string, number>();
    for (const p of ps) for (const e of p.items) tally.set(e.prefecture, (tally.get(e.prefecture) ?? 0) + 1);
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    return { label: regionLabel(top), count: ps.reduce((n, p) => n + p.items.length, 0), pins: ps };
  });
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.count - a.c.count || a.i - b.i)
    .map((x) => x.c);
}

// ---- カレンダー案 (?cal=) ----

export type CalStyle = "lines" | "count" | "bands";

// ?cal= の解釈。不正値・無しは既定の lines
export function parseCalStyle(v: string | string[] | undefined): CalStyle {
  return v === "count" || v === "bands" ? v : "lines";
}

// 展示の番号（一覧と同じ並び順の 0 始まり index → "01"）
export function visitNo(index: number): string {
  return String(index + 1).padStart(2, "0");
}

// date が終了日に当たる展示の id
export function endingOn(items: readonly Pick<Exhibition, "id" | "endDate">[], date: string): string[] {
  return items.filter((e) => e.endDate === date).map((e) => e.id);
}

export type WeekSegment = {
  id: string;
  col: number; // 0〜6
  span: number; // 1〜7
  lane: number; // 0 始まり。重ならない最小の段
  capLeft: boolean; // この区間の左端が実際の会期開始日
  capRight: boolean; // 右端が実際の会期終了日
};

// 6週×7日のマスを週ごとの帯に分割。items の順に段(lane)を貪欲に詰める。
export function weekSegments(
  days: readonly CalendarDay[],
  items: readonly Pick<Exhibition, "id" | "startDate" | "endDate">[],
): WeekSegment[][] {
  const weeks: WeekSegment[][] = [];
  for (let w = 0; w * 7 < days.length; w++) {
    const row = days.slice(w * 7, w * 7 + 7);
    const segs: WeekSegment[] = [];
    const laneEnds: number[] = []; // 各段の使用済み最終列
    for (const e of items) {
      const cols = row.map((d, i) => (d.ids.includes(e.id) ? i : -1)).filter((i) => i >= 0);
      if (cols.length === 0) continue;
      const col = cols[0];
      const last = cols[cols.length - 1];
      let lane = laneEnds.findIndex((end) => end < col);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = last;
      segs.push({
        id: e.id,
        col,
        span: last - col + 1,
        lane,
        capLeft: row[col].date === e.startDate,
        capRight: row[last].date === e.endDate,
      });
    }
    weeks.push(segs);
  }
  return weeks;
}
