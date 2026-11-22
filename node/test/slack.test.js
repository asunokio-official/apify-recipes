import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, loadPreset } from '../src/catalog.js';
import { estimateCost } from '../src/cost.js';
import { buildSlackMessage, fillTemplate, postSlack } from '../src/slack.js';

const catalog = loadCatalog();

test('fillTemplate fills paths and marks missing values', () => {
  assert.equal(fillTemplate('{title} | {buyerName} | {x.y}', { title: 'T', buyerName: null }), 'T | n/a | n/a');
});

test('buildSlackMessage links rows, escapes text and truncates', () => {
  const preset = loadPreset('uk-it-tenders-100k-weekly');
  const actor = catalog.actors[preset.actor];
  const rows = Array.from({ length: 12 }, (_, i) => ({ title: `<T${i}> & co`, buyerName: 'Council', noticeUrl: `https://example.org/${i}` }));
  const msg = buildSlackMessage({ preset, actor, rows, estimate: estimateCost(preset.actor, preset.input, catalog), chargedUsd: 0.048 });
  assert.match(msg.text, /12 new row\(s\)/);
  assert.match(msg.text, /\(charged \$0\.048\)/);
  assert.match(msg.text, /<https:\/\/example\.org\/0\|&lt;T0&gt; &amp; co/);
  assert.match(msg.text, /and 2 more/);
});

test('buildSlackMessage says so when nothing is new, and labels dry runs', () => {
  const preset = loadPreset('austin-solar-roof-permits');
  const actor = catalog.actors[preset.actor];
  const msg = buildSlackMessage({ preset, actor, rows: [], estimate: estimateCost(preset.actor, preset.input, catalog), dryRun: true });
  assert.match(msg.text, /^\[dry run/);
  assert.match(msg.text, /No new rows/);
});

test('postSlack only accepts Slack webhook URLs and reports HTTP errors', async () => {
  await assert.rejects(postSlack('https://evil.example/x', {}, async () => ({ ok: true })), /hooks\.slack\.com/);
  const calls = [];
  await postSlack('https://hooks.slack.com/services/T/B/X', { text: 'hi' }, async (url, init) => { calls.push([url, init]); return { ok: true }; });
  assert.equal(JSON.parse(calls[0][1].body).text, 'hi');
  await assert.rejects(postSlack('https://hooks.slack.com/services/T/B/X', {}, async () => ({ ok: false, status: 404 })), /HTTP 404/);
});
