import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffTech, diffCsv } from '../src/diff.js';
import { main } from '../src/cli.js';

const row = (url, techs, scanStatus = 'ok') => ({ url, finalUrl: url, scanStatus, technologies: techs.map(([name, category]) => ({ name, category })) });
const oldRows = [row('https://a.example/', [['WordPress', 'CMS'], ['jQuery', 'JS'], ['Google Analytics', 'Analytics']]), row('https://b.example/', [['Hugo', 'Static']]), row('https://c.example/', [['X', 'CMS']]), row('https://d.example/', [], 'blocked')];
const newRows = [row('https://www.a.example', [['WordPress', 'CMS'], ['Google Tag Manager', 'Tag manager']]), row('https://b.example/', [['Hugo', 'Static']]), row('https://d.example/', [['Y', 'CMS']]), row('https://e.example/', [['Z', 'CMS']])];

test('diffTech: added/removed per site, www and trailing slash ignored, unchanged sites omitted', () => {
  const d = diffTech(oldRows, { rows: newRows });
  const by = Object.fromEntries(d.map((c) => [c.site, c]));
  assert.deepEqual(by['a.example'].added, ['Google Tag Manager (Tag manager)']);
  assert.deepEqual(by['a.example'].removed, ['jQuery (JS)', 'Google Analytics (Analytics)']);
  assert.equal(by['b.example'], undefined);
  assert.equal(by['c.example'].change, 'missing-now');
  assert.equal(by['d.example'].change, 'not-comparable');
  assert.equal(by['e.example'].change, 'new-site');
});
test('diffCsv guards spreadsheet formulas and cli diff prints a summary line', async () => {
  assert.ok(diffCsv([{ site: '=x', change: 'changed', added: ['+a (c)'], removed: [], note: '' }]).includes("'=x"));
  const dir = mkdtempSync(join(tmpdir(), 'tsd-'));
  writeFileSync(join(dir, 'o.json'), JSON.stringify(oldRows)); writeFileSync(join(dir, 'n.json'), JSON.stringify({ rows: newRows }));
  const lines = []; await main(['diff', join(dir, 'o.json'), join(dir, 'n.json'), '--out', join(dir, 'c.csv')], {}, { out: (l) => lines.push(l), log: () => {} });
  assert.match(lines.at(-1), /^4 of 4 sites differ\.$/);
  assert.ok(readFileSync(join(dir, 'c.csv'), 'utf8').startsWith('site,change,added,removed,note'));
});
test('diffTech rejects input that is not rows', () => { assert.throws(() => diffTech({}, []), /Expected a JSON array/); });
