import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, parseArgs } from '../src/cli.js';

const quiet = { log: () => {}, out: () => {} };

test('parseArgs handles flags, options and errors', () => {
  const a = parseArgs(['run', 'x', '--dry-run', '--out', 'f.csv', '--max-cost', '1']);
  assert.deepEqual(a._, ['run', 'x']);
  assert.equal(a['dry-run'], true);
  assert.equal(a.out, 'f.csv');
  assert.throws(() => parseArgs(['--out']), /needs a value/);
  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
});

test('list prints every preset with its max cost', async () => {
  const lines = [];
  assert.equal(await main(['list'], {}, { ...quiet, out: (l) => lines.push(l) }), 0);
  assert.ok(lines.some((l) => l.startsWith('uk-it-tenders-100k-weekly') && l.includes('$1.20')));
});

test('dry run writes a CSV and a JSON file without a token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'recipes-'));
  const code = await main(['run', 'uk-it-tenders-100k-weekly', '--dry-run', '--out', join(dir, 'o.csv'), '--json', join(dir, 'o.json')], {}, quiet);
  assert.equal(code, 0);
  const csv = readFileSync(join(dir, 'o.csv'), 'utf8');
  assert.ok(csv.startsWith('publishedAt,noticeType,title,buyerName'));
  assert.equal(csv.trim().split('\r\n').length, 4); // header + 3 sample notices
  const json = JSON.parse(readFileSync(join(dir, 'o.json'), 'utf8'));
  assert.equal(json.dryRun, true);
  assert.equal(json.runId, null);
});

test('dry-run CSV is byte-identical to the Python port (golden file)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'recipes-'));
  await main(['run', 'tsd-shopify-prospect-check', '--dry-run', '--out', join(dir, 'n.csv')], {}, quiet);
  const golden = new URL('../../python/tests/golden_tsd_dry_run.csv', import.meta.url);
  assert.equal(readFileSync(join(dir, 'n.csv'), 'utf8'), readFileSync(golden, 'utf8'));
});

test('--urls-file replaces the Tech Stack Detector url list', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'recipes-'));
  writeFileSync(join(dir, 'd.txt'), 'a.com\nb.com\nwww.a.com\n');
  const lines = [];
  await main(['show', 'tsd-shopify-prospect-check', '--urls-file', join(dir, 'd.txt')], {}, { ...quiet, out: (l) => lines.push(l) });
  assert.match(lines.join('\n'), /2 unique website/);
});

test('--slack posts a dry-run digest through the injected fetch', async () => {
  const posted = [];
  await main(['run', 'austin-solar-roof-permits', '--dry-run', '--slack'], { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/X' }, {
    ...quiet, fetch: async (url, init) => { posted.push(JSON.parse(init.body)); return { ok: true }; },
  });
  assert.equal(posted.length, 1);
  assert.match(posted[0].text, /dry run/);
});

test('a real run without a token fails before anything is called', async () => {
  await assert.rejects(main(['run', 'sf-adu-permits', '--yes'], {}, { ...quiet, clientFactory: async () => assert.fail('no client') }), /APIFY_TOKEN/);
});

test('exit code 2 when the Actor run did not succeed', async () => {
  const client = {
    actor: () => ({ call: async () => ({ id: 'R', status: 'FAILED', defaultDatasetId: 'D', chargedEventCounts: {} }) }),
    dataset: () => ({ listItems: async () => ({ items: [], total: 0 }) }),
  };
  const code = await main(['run', 'sf-adu-permits', '--yes'], { APIFY_TOKEN: 'not-a-real-token' }, { ...quiet, clientFactory: async () => client });
  assert.equal(code, 2);
});
