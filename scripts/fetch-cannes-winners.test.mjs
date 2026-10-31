import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractJsonBlock, buildOutput, toWslPath, parseUsage, normalizeCategoryName, checkExpected, revalidateOutput, writeJsonAtomic } from './fetch-cannes-winners.mjs';

const okCat = {
  entryTypeId: 10, slug: 'digital-craft', category: 'Digital Craft', exists: true, yearVerified: true, complete: true, mismatches: [],
  sourceUrl: 'https://x/digital-craft', headings: { 'Grand Prix': 1, Shortlist: 43 },
  counts: { 'Grand Prix': { heading: 1, scraped: 1 }, Shortlist: { heading: 43, scraped: null } },
  cards: [{ level: 'Grand Prix', subcategory: 'UX', title: 'T', brand: 'B', product: 'P', agency: 'A', location: 'L', prize: 'Grand Prix', entryUrl: 'https://x/e1' }],
};
const badCat = {
  entryTypeId: 20, slug: 'film', category: 'Film', exists: true, yearVerified: true, complete: false,
  mismatches: [{ level: 'Gold', heading: 2, scraped: 1 }], sourceUrl: 'https://x/film',
  headings: { Gold: 2 }, counts: { Gold: { heading: 2, scraped: 1 } },
  cards: [{ level: 'Gold', subcategory: '', title: 'F', brand: 'B', product: '', agency: '', location: '', prize: 'Gold Lion', entryUrl: 'https://x/e2' }],
};
const missing = { entryTypeId: 99, tableUrl: 'https://x/99', exists: false, httpStatus: 404 };
const errored = (id) => ({ entryTypeId: id, tableUrl: 'https://x/' + id, exists: null, fetchError: { httpStatus: 500, error: 'HTTP 500' } });

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
  assert.deepEqual(o.notFoundDetail, [{ entryTypeId: 99, httpStatus: 404 }]);
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

test('buildOutput: 500 is a fetchError (ok:false), never notFound', () => {
  const o = buildOutput(2025, [okCat, errored(41)], null, 't');
  assert.deepEqual(o.notFound, []);
  assert.equal(o.ok, false);
  assert.deepEqual(o.fetchErrors, [{ entryTypeId: 41, tableUrl: 'https://x/41', httpStatus: 500, error: 'HTTP 500' }]);
});

test('buildOutput: no errors + no expected list => ok true, expectedCheck skipped', () => {
  const o = buildOutput(2025, [okCat, missing], null, 't');
  assert.equal(o.ok, true);
  assert.equal(o.expectedCheck, 'skipped');
  assert.equal(o.missingCategories, undefined);
});

test('buildOutput: scan range and yearVerified recorded', () => {
  const scan = { explicit: false, scannedFrom: 1, scannedTo: 90, stopGap: 40, maxFoundId: 50, capped: false };
  const o = buildOutput(2025, [okCat], null, 't', { scan });
  assert.deepEqual(o.scan, scan);
  assert.equal(o.yearVerified, true);
  const o2 = buildOutput(2025, [{ ...okCat, yearVerified: false }], null, 't');
  assert.equal(o2.yearVerified, false);
});

test('yearVerified:false fails closed: ok:false with yearUnverifiedIds', () => {
  const o = buildOutput(2025, [okCat, { ...badCat, yearVerified: false }], null, 't');
  assert.equal(o.ok, false);
  assert.deepEqual(o.yearUnverifiedIds, [20]);
  assert.equal(buildOutput(2025, [okCat], null, 't').yearUnverifiedIds.length, 0);
});

test('zero categories found => ok:false even without expected list', () => {
  const o = buildOutput(2025, [missing], null, 't');
  assert.equal(o.ok, false);
});

test('aborted scan (consecutive errors) => ok:false', () => {
  const o = buildOutput(2025, [okCat], null, 't', { scan: { explicit: false, capped: false, aborted: 'consecutive-errors' } });
  assert.equal(o.ok, false);
});

test('partial re-run keeps the full-scan record; explicit runs go to partialRuns', () => {
  const full = buildOutput(2025, [okCat], null, 't1', { scan: { explicit: false, scannedTo: 90, capped: true, aborted: null } });
  assert.equal(full.ok, false);
  const partial = { explicit: true, ids: [10], scannedFrom: 10, scannedTo: 10, capped: false, aborted: null };
  const merged = buildOutput(2025, [okCat], full, 't2', { scan: partial });
  assert.equal(merged.scan.capped, true);
  assert.equal(merged.ok, false);
  assert.equal(merged.partialRuns.length, 1);
  assert.deepEqual(merged.partialRuns[0].ids, [10]);
  assert.equal(merged.partialRuns[0].at, 't2');
});

test('partial re-run after a clean full scan stays ok', () => {
  const full = buildOutput(2025, [okCat], null, 't1', { scan: { explicit: false, scannedTo: 90, capped: false, aborted: null } });
  const merged = buildOutput(2025, [okCat], full, 't2', { scan: { explicit: true, ids: [10], capped: false, aborted: null } });
  assert.equal(merged.ok, true);
  assert.equal(merged.scan.scannedTo, 90);
});

test('buildOutput: capped scan is not ok', () => {
  const o = buildOutput(2025, [okCat], null, 't', { scan: { capped: true } });
  assert.equal(o.ok, false);
});

test('normalizeCategoryName tolerates case / Lions / for only', () => {
  assert.equal(normalizeCategoryName('Entertainment Lions For Sport'), normalizeCategoryName('Entertainment for Sport'));
  assert.notEqual(normalizeCategoryName('Entertainment'), normalizeCategoryName('Entertainment for Sport'));
  assert.equal(normalizeCategoryName('Film Lions'), normalizeCategoryName('film'));
  assert.notEqual(normalizeCategoryName('Film'), normalizeCategoryName('Film Craft'));
});

test('checkExpected: missing categories reported; skipped without list', () => {
  const cats = [{ category: 'Film' }, { category: 'Entertainment for Sport' }];
  assert.deepEqual(checkExpected(cats, ['Film', 'Entertainment Lions for Sport', 'Entertainment Lions for Music']),
    { expectedCheck: 'failed', missingCategories: ['Entertainment Lions for Music'] });
  assert.deepEqual(checkExpected(cats, ['Film', 'Entertainment Lions for Sport']), { expectedCheck: 'ok', missingCategories: [] });
  assert.deepEqual(checkExpected(cats, undefined), { expectedCheck: 'skipped' });
});

test('buildOutput: expected list failure => ok:false with missingCategories', () => {
  const o = buildOutput(2025, [okCat], null, 't', { expected: ['Digital Craft', 'Glass: The Lion for Change'] });
  assert.equal(o.ok, false);
  assert.deepEqual(o.missingCategories, ['Glass: The Lion for Change']);
  assert.equal(o.expectedCheck, 'failed');
});

test('partial re-run: errored id keeps its old category AND winners; no orphans', () => {
  const first = buildOutput(2025, [okCat, badCat], null, 't1');
  const merged = buildOutput(2025, [errored(20)], first, 't2');
  assert.ok(merged.categories.find((c) => c.entryTypeId === 20));
  assert.equal(merged.winners.filter((w) => w.category === 'Film').length, 1);
  assert.equal(merged.ok, false);
  assert.equal(merged.fetchErrors.length, 1);
  // a later successful re-run clears the error
  const fixed = buildOutput(2025, [{ ...badCat, complete: true, mismatches: [] }], merged, 't3');
  assert.deepEqual(fixed.fetchErrors, []);
  assert.equal(fixed.ok, true);
});

test('partial re-run: winners keyed by entryTypeId even if category was renamed', () => {
  const first = buildOutput(2025, [okCat], null, 't1');
  const renamed = { ...okCat, category: 'Digital Craft Renamed', cards: [{ ...okCat.cards[0], entryUrl: 'https://x/e9' }] };
  const merged = buildOutput(2025, [renamed], first, 't2');
  assert.equal(merged.winners.length, 1);
  assert.equal(merged.winners[0].category, 'Digital Craft Renamed');
});

test('partial re-run: confirmed 404 removes old category and winners', () => {
  const first = buildOutput(2025, [okCat, badCat], null, 't1');
  const merged = buildOutput(2025, [{ entryTypeId: 20, exists: false, httpStatus: 404 }], first, 't2');
  assert.equal(merged.categories.some((c) => c.entryTypeId === 20), false);
  assert.equal(merged.winners.some((w) => w.category === 'Film'), false);
});

test('partial re-run: legacy winners without entryTypeId are mapped via category name', () => {
  const first = buildOutput(2025, [okCat], null, 't1');
  first.winners = first.winners.map(({ entryTypeId, ...w }) => w);
  const merged = buildOutput(2025, [okCat], first, 't2');
  assert.equal(merged.winners.length, 1);
});

test('revalidateOutput: marks existing data ok:false with missingCategories offline', () => {
  const base = buildOutput(2025, [okCat], null, 't1');
  const r = revalidateOutput(base, ['Digital Craft', 'Entertainment Lions for Sport']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingCategories, ['Entertainment Lions for Sport']);
  assert.equal(r.generatedAt, 't1');
});

test('writeJsonAtomic writes via temp file then rename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cannes-'));
  const f = path.join(dir, 'x.json');
  writeJsonAtomic(f, { a: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { a: 1 });
  assert.deepEqual(fs.readdirSync(dir), ['x.json']);
});

test('expected-categories.json has 2025 with 30 categories and a source note', () => {
  const j = JSON.parse(fs.readFileSync(new URL('../data/cannes/expected-categories.json', import.meta.url), 'utf8'));
  assert.equal(j['2025'].categories.length, 30);
  assert.match(j['2025'].source, /unverified/);
});

test('toWslPath converts a Windows path', () => {
  assert.equal(toWslPath('C:\\Users\\a b\\x.py'), '/mnt/c/Users/a b/x.py');
});

test('parseUsage extracts balance-like text line', () => {
  assert.match(parseUsage('foo\nBalance: 98.76 units\nbar'), /98\.76/);
});
