// Visit タブの純関数群（docs/EXHIBITION_VISIT_SPEC.md §4/§5）。React / Leaflet / DOM に依存しない。
// 日付は全て JST 暦日の YYYY-MM-DD 文字列。「今日」は常に引数で受け取る。
import { computeStatus, daysBetween, todayJst, type Exhibition } from "./exhibition";

export { todayJst };

// 終了間近: 終了まで7日以内（今日を含む＝残り 0〜7 日）。
export const ENDING_SOON_DAYS = 7;
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

// ---- カレンダー（今日を含む週から6週） ----

export type CalendarCell = {
  date: string;
  day: number;
  past: boolean; // 今日より前（帯なし・押せない）
  showMonth: boolean; // 「11/1」のように月付きで出す（各月1日と範囲の最初のマス）
};

// 日曜始まりで、ymd を含む週の日曜
export function weekStart(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return addDays(ymd, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
}

export const CALENDAR_CELLS = 42;

// 今日を含む週の日曜から 6週(42マス) を1ページとし、page ページ目（0 始まり）のマス目。
// 今日より前のマスは past。月付きは各月1日と「範囲の最初の過去でないマス」。
export function rangeGrid(today: string, page: number): CalendarCell[] {
  const start = addDays(weekStart(today), CALENDAR_CELLS * Math.max(0, Math.floor(page)));
  const cells: CalendarCell[] = [];
  let firstShown = false;
  for (let i = 0; i < CALENDAR_CELLS; i++) {
    const date = addDays(start, i);
    const past = date < today;
    const day = Number(date.slice(8, 10));
    const showMonth = !past && (!firstShown || day === 1);
    if (!past) firstShown = true;
    cells.push({ date, day, past, showMonth });
  }
  return cells;
}

// 見出し「10.25 — 12.05」。開始は最初の過去でないマス（最初のページでは今日）。
export function rangeLabel(cells: readonly CalendarCell[]): string {
  const first = cells.find((c) => !c.past) ?? cells[0];
  const last = cells[cells.length - 1];
  const md = (ymd: string) => `${ymd.slice(5, 7)}.${ymd.slice(8, 10)}`;
  return `${md(first.date)} — ${md(last.date)}`;
}

// その日（date）に開いている展覧会（startDate <= date <= endDate）。入力順を保つ。
export function exhibitionsOpenOn<T extends Pick<Exhibition, "startDate" | "endDate">>(
  items: readonly T[],
  date: string,
): T[] {
  return items.filter((e) => e.startDate <= date && date <= e.endDate);
}

export type CalendarDay = CalendarCell & { ids: string[] };

// 各マスに開いている展覧会 ID。今日より前のマスは空（帯は今日から始まる）。
export function rangeCalendar(
  today: string,
  page: number,
  items: readonly Pick<Exhibition, "id" | "startDate" | "endDate">[],
): CalendarDay[] {
  return rangeGrid(today, page).map((c) => ({
    ...c,
    ids: c.past ? [] : exhibitionsOpenOn(items, c.date).map((e) => e.id),
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
    const laneEnds: number[] = []; // 各段の使用済み最終列
    // 週内で開始列の昇順に詰める（段数が最小になる）。返り値は items の順に戻す
    const found = items
      .map((e, order) => {
        const cols = row.map((d, i) => (d.ids.includes(e.id) ? i : -1)).filter((i) => i >= 0);
        return { e, order, cols };
      })
      .filter((x) => x.cols.length > 0);
    const byOrder: WeekSegment[] = [];
    for (const { e, order, cols } of [...found].sort((p, q) => p.cols[0] - q.cols[0] || p.order - q.order)) {
      const col = cols[0];
      const last = cols[cols.length - 1];
      let lane = laneEnds.findIndex((end) => end < col);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = last;
      byOrder[order] = {
        id: e.id,
        col,
        span: last - col + 1,
        lane,
        capLeft: row[col].date === e.startDate,
        capRight: row[last].date === e.endDate,
      };
    }
    weeks.push(byOrder.filter(Boolean));
  }
  return weeks;
}
