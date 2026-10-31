import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonBlock, buildOutput, toWslPath, parseUsage } from './fetch-cannes-winners.mjs';

const okCat = {
  entryTypeId: 10, slug: 'digital-craft', category: 'Digital Craft', exists: true, complete: true, mismatches: [],
  sourceUrl: 'https://x/digital-craft', headings: { 'Grand Prix': 1, Shortlist: 43 },
  counts: { 'Grand Prix': { heading: 1, scraped: 1 }, Shortlist: { heading: 43, scraped: null } },
  cards: [{ level: 'Grand Prix', subcategory: 'UX', title: 'T', brand: 'B', product: 'P', agency: 'A', location: 'L', prize: 'Grand Prix', entryUrl: 'https://x/e1' }],
};
const badCat = {
  entryTypeId: 20, slug: 'film', category: 'Film', exists: true, complete: false,
  mismatches: [{ level: 'Gold', heading: 2, scraped: 1 }], sourceUrl: 'https://x/film',
  headings: { Gold: 2 }, counts: { Gold: { heading: 2, scraped: 1 } },
  cards: [{ level: 'Gold', subcategory: '', title: 'F', brand: 'B', product: '', agency: '', location: '', prize: 'Gold Lion', entryUrl: 'https://x/e2' }],
};
const missing = { entryTypeId: 99, tableUrl: 'https://x/99', exists: false, httpStatus: 500 };

test('extractJsonBlock picks the delimited block from noisy output', () => {
  const out = 'log line\n===JSON_BEGIN===\n{"year":2025,"results":[]}\n===JSON_END===\ntrailer';
  assert.deepEqual(extractJsonBlock(out), { year: 2025, results: [] });
});

test('extractJsonBlock throws when block is absent', () => {
  assert.throws(() => extractJsonBlock('nothing here'), /JSON_BEGIN/);
});

test('buildOutput: flattens winners, marks incomplete with both counts, lists notFound', () => {
  const o = buildOutput(2025, [okCat, badCat, missing], null, '2026-10-31T00:00:00Z');
  assert.equal(o.year, 2025);
  assert.equal(o.categories.length, 2);
  assert.deepEqual(o.notFound, [99]);
  const film = o.categories.find((c) => c.entryTypeId === 20);
  assert.equal(film.complete, false);
  assert.equal(film.incomplete, true);
  assert.deepEqual(film.mismatches, [{ level: 'Gold', heading: 2, scraped: 1 }]);
  const dc = o.categories.find((c) => c.entryTypeId === 10);
  assert.equal(dc.complete, true);
  assert.equal('incomplete' in dc, false);
  assert.equal(o.winners.length, 2);
  assert.equal(o.winners[0].category, 'Digital Craft');
  assert.equal(o.winners[0].sourceUrl, 'https://x/digital-craft');
  assert.equal(o.winners[0].prize, 'Grand Prix');
  assert.equal(film.headingsMissing, undefined);
});

test('buildOutput: partial run replaces only the given categories in existing output', () => {
  const first = buildOutput(2025, [okCat, badCat], null, 't1');
  const fixedFilm = { ...badCat, complete: true, mismatches: [], counts: { Gold: { heading: 1, scraped: 1 } }, headings: { Gold: 1 } };
  const merged = buildOutput(2025, [fixedFilm], first, 't2');
  assert.equal(merged.categories.length, 2);
  assert.equal(merged.categories.find((c) => c.entryTypeId === 20).complete, true);
  assert.equal(merged.winners.filter((w) => w.category === 'Digital Craft').length, 1);
});

test('toWslPath converts a Windows path', () => {
  assert.equal(toWslPath('C:\\Users\\a b\\x.py'), '/mnt/c/Users/a b/x.py');
});

test('parseUsage extracts balance-like text line', () => {
  assert.match(parseUsage('foo\nBalance: 98.76 units\nbar'), /98\.76/);
});
