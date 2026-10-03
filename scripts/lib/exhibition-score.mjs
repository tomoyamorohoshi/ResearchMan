/**
 * profile.scoring.components に沿った決定論の採点（seed 用。日次ジョブの発見は Claude 自己採点＋機械の上書き）。
 * penalties は seed（listing 由来・hard 除外済み）では適用しない。
 */
import { daysBetween } from "./exhibition-status.mjs";

const CORE = ["media_art", "generative", "onchain", "ai_media_art"];
const PERIPHERAL = ["light", "installation", "kinetic", "sculpture", "video_art", "sound", "glass"];
const LIGHT_SPACE = ["light", "kinetic", "installation", "glass"];
const DESIGN = ["design_archive", "graphic_design", "architecture"];

const norm = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/\([^)]*\)|（[^）]*）/g, "").replace(/\s+/g, "");
const listHas = (list, name) => {
  const n = norm(name);
  return !!n && list.some((x) => { const m = norm(x); return m && (m.includes(n) || n.includes(m)); });
};

/**
 * @param {{tags:string[], artists:string[], venue:string, venueType:string, startDate:string, endDate:string}} x
 * @param {object} profile  data/exhibition-profile.json
 * @param {string} today
 */
export function computeSeedScore(x, profile, today) {
  const c = Object.fromEntries(profile.scoring.components.map((k) => [k.key, k]));
  const has = (set) => x.tags.some((t) => set.includes(t));
  let s = 0;
  if (has(CORE)) s += c.core_tech_media.points;
  else if (has(PERIPHERAL)) s += c.core_tech_media.peripheralPoints;
  if (has(LIGHT_SPACE)) s += c.light_space_kinetic_installation.points;
  if (has(DESIGN)) s += c.boundary.points;
  if ((x.artists || []).some((a) => listHas(profile.watch.artists, a))) s += c.known_artist.points;
  if (listHas(profile.watch.venues, x.venue) || ["museum", "media_art_center"].includes(x.venueType)) s += c.venue_trust.points;
  const untilStart = daysBetween(today, x.startDate);
  const remaining = daysBetween(today, x.endDate);
  if ((untilStart > 0 && untilStart <= 30) || (untilStart <= 0 && remaining >= 7)) s += c.timeliness.points;
  return Math.max(0, Math.min(profile.scoring.max, s));
}
