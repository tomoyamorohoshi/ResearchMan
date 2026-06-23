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
    const { year, category } = parseCollection(c.award ?? '', c.year, orgKey);
    const key = `${year}::${category}`;
    if (!map.has(key)) map.set(key, { year, category, cases: [] });
    map.get(key)!.cases.push(c);
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
