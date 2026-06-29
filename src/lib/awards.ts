import { cases, Case } from './cases';

export const AWARD_ORGS = [
  { key: 'cannes', label: 'Cannes Lions', abbr: 'CANNES LIONS' },
  { key: 'dad',    label: 'D&AD',         abbr: 'D&AD'         },
  { key: 'clio',   label: 'Clio',          abbr: 'CLIO'         },
  { key: 'acc',    label: 'ACC',           abbr: 'ACC'          },
  { key: 'spikes', label: 'Spikes Asia',   abbr: 'SPIKES ASIA'  },
] as const;

export type OrgKey = (typeof AWARD_ORGS)[number]['key'];

function matchesOrg(awardStr: string, orgKey: OrgKey): boolean {
  const s = awardStr.toLowerCase();
  switch (orgKey) {
    case 'cannes': return s.includes('cannes');
    case 'dad':    return s.includes('d&ad');
    case 'clio':   return s.includes('clio');
    case 'acc':    return /\bacc\b/.test(s);
    case 'spikes': return s.includes('spikes');
  }
}

function parseCollection(
  awardStr: string,
  caseYear: string,
  orgKey: OrgKey,
): { year: string; category: string } {
  const yearMatch = awardStr.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : caseYear;

  // Extract bracket hints from FULL string before any stripping
  const jpBracket = awardStr.match(/（([^）]+)）/);
  const enBracket = awardStr.match(/\(([^)]+)\)/);
  const bracketHint = (jpBracket?.[1] ?? enBracket?.[1] ?? '')
    .split(/[/\/、,]/)[0].trim()
    .replace(/詳細情報は確認中|受賞/g, '').trim();

  // Strip all brackets (including incomplete ones when / splits mid-bracket), THEN split on /
  const stripped = awardStr
    .replace(/（[^）]*/g, '')  // remove from （ to end (handles split brackets)
    .replace(/[^(]*\)/g, '')   // remove orphaned )
    .replace(/\([^)]*\)/g, '') // normal parens
    .replace(/\([^)]*/g, '');  // incomplete parens

  const parts = stripped.split('/');
  const orgPart = parts.find(p => matchesOrg(p, orgKey)) ?? parts[0];

  let cat = orgPart
    .replace(/\b20\d{2}\b/g, '')
    .replace(/[×x]\d+\b/gi, '')  // ×2 or x2
    .replace(/\d+\s*件/g, '');

  // Remove org name
  switch (orgKey) {
    case 'cannes': cat = cat.replace(/cannes\s*lions/gi, ''); break;
    case 'dad':    cat = cat.replace(/d&ad/gi, '');            break;
    case 'clio':   cat = cat.replace(/clio(\s+music)?/gi, ''); break;
    case 'acc':    cat = cat.replace(/acc(\s+tokyo\s+creativity\s+awards)?/gi, ''); break;
    case 'spikes': cat = cat.replace(/spikes(\s*asia)?/gi, ''); break;
  }

  // Remove award levels (keep "Titanium" which is also a category name)
  cat = cat.replace(
    /\b(grand\s+prix|grand\s+award|grand\s+clio|gold\s+lion|silver\s+lion|bronze\s+lion|gold|silver|bronze|shortlist|finalist|merit|wood|graphite|yellow|black|pencil)\b/gi,
    '',
  );
  cat = cat.replace(/\blions\b/gi, '');
  // Japanese award words (\b doesn't work for CJK)
  cat = cat.replace(/グランプリ|受賞|詳細情報は確認中/g, '');

  cat = cat.replace(/[+\-_]+/g, ' ');
  cat = cat.replace(/\s+/g, ' ').trim().replace(/^[\s\-_/,]+|[\s\-_/,]+$/g, '').trim();

  if (!cat) cat = bracketHint;
  return { year, category: cat || 'Other' };
}

// award文字列に複数受賞（"/"区切り）が含まれる場合、各セグメントを別々のコレクションとして解釈する。
// これにより1作品が複数部門で受賞していれば全部門ページに出る（多重受賞の取りこぼし防止）。
function segmentBelongsToOrg(seg: string, orgKey: OrgKey): boolean {
  const s = seg.toLowerCase();
  const hasAnyOrg = AWARD_ORGS.some(o => o.key === 'dad' ? s.includes('d&ad') : s.includes(o.key));
  // org名を明示するセグメントは当該orgのみ。org名が無いセグメント（例 "Design Lions Gold"）は親awardのorgを継承。
  return matchesOrg(seg, orgKey) || !hasAnyOrg;
}

function parseCollectionsAll(
  awardStr: string,
  caseYear: string,
  orgKey: OrgKey,
): Array<{ year: string; category: string }> {
  const results: Array<{ year: string; category: string }> = [];
  const seen = new Set<string>();
  for (const seg of awardStr.split('/')) {
    if (!seg.trim()) continue;
    if (!segmentBelongsToOrg(seg, orgKey)) continue;
    const { year, category } = parseCollection(seg, caseYear, orgKey);
    if (!category || category === 'Other') continue;
    const key = `${year}::${category}`;
    if (!seen.has(key)) { seen.add(key); results.push({ year, category }); }
  }
  return results;
}

function toSlug(year: string, category: string): string {
  return `${year}-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

export type AwardCollection = {
  org: OrgKey;
  year: string;
  category: string;
  slug: string;
  label: string;
  cases: Case[];
};

export function getAwardCollections(orgKey: OrgKey): AwardCollection[] {
  const matched = cases.filter(c => matchesOrg(c.award ?? '', orgKey));

  const map = new Map<string, { year: string; category: string; cases: Case[] }>();
  for (const c of matched) {
    for (const { year, category } of parseCollectionsAll(c.award ?? '', c.year, orgKey)) {
      const key = `${year}::${category}`;
      if (!map.has(key)) map.set(key, { year, category, cases: [] });
      map.get(key)!.cases.push(c);
    }
  }

  return Array.from(map.values())
    .map(({ year, category, cases: cs }) => ({
      org: orgKey,
      year,
      category,
      slug: toSlug(year, category),
      label: `${year}_${category}`,
      cases: cs,
    }))
    .sort((a, b) => {
      if (b.year !== a.year) return b.year.localeCompare(a.year);
      return a.category.localeCompare(b.category);
    });
}

export function getCollectionBySlug(orgKey: OrgKey, slug: string): AwardCollection | undefined {
  return getAwardCollections(orgKey).find(c => c.slug === slug);
}

export function getOrgByKey(key: string) {
  return AWARD_ORGS.find(o => o.key === key);
}

// 1ケースのaward文字列に複数の受賞が "/" 区切りで含まれる場合に分解して返す。
// 例: "Cannes Lions Film Craft Grand Prix 2015 / D&AD Yellow Pencil / FWA" → 3件。
// CaseCard の「+N」バッジ（複数部門受賞の表示）に使う。
export function getCaseAwardRefs(c: Case): string[] {
  return (c.award ?? '')
    .split('/')
    .map(s => s.trim())
    .filter(Boolean);
}
