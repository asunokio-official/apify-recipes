import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWorkflow } from '../build.mjs';
import { buildActorInput, buildDigest, money, splitList } from '../src/logic.js';
import { validateWorkflow } from '../validate.mjs';

const committed = JSON.parse(readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
const byName = (wf, name) => wf.nodes.find((n) => n.name === name);
const SETTINGS = Object.fromEntries(byName(committed, 'Settings').parameters.assignments.assignments.map((a) => [a.name, a.value]));

test('workflow.json is up to date with build.mjs and passes validation', () => {
  assert.deepEqual(committed, buildWorkflow());
  assert.deepEqual(validateWorkflow(committed), []);
});

test('validator catches credentials, secrets, broken links and an enabled schedule', () => {
  const wf = structuredClone(committed);
  wf.nodes[0].credentials = { apifyApi: { id: '1' } };
  wf.connections['Build digest'].main[0][0].node = 'Missing';
  byName(wf, 'Weekdays 07:30 (enable after a test run)').disabled = false;
  byName(wf, 'Settings').parameters.assignments.assignments[0].value = `apify_api_${'x'.repeat(16)}`; // fake, built at runtime so secret scanners do not flag the repo
  const p = validateWorkflow(wf).join('\n');
  assert.match(p, /credentials block/);
  assert.match(p, /unknown node Missing/);
  assert.match(p, /must be disabled/);
  assert.match(p, /possible secret/);
});

test('buildActorInput: defaults, lists, validation and cost', () => {
  const plan = buildActorInput(SETTINGS);
  assert.deepEqual(plan.actorInput, { noticeTypes: ['opportunity'], cpvPrefixes: ['72', '48'], days: 3, onlyNew: true, openOnly: true, maxItems: 100, minValueGbp: 100000 });
  assert.equal(plan.estimateUsd, 0.40005);
  assert.equal(plan.maxTotalChargeUsd, 0.40005);
  assert.equal(buildActorInput({ ...SETTINGS, maxTotalChargeUsd: 0.1 }).maxTotalChargeUsd, 0.1);
  assert.deepEqual(buildActorInput({ regions: 'uki, ukj', maxItems: '50000' }).actorInput.regions, ['UKI', 'UKJ']);
  assert.equal(buildActorInput({ maxItems: '50000' }).actorInput.maxItems, 10000);
  assert.throws(() => buildActorInput({ cpvPrefixes: '7' }), /2 to 8 digits/);
  assert.throws(() => buildActorInput({ noticeTypes: 'tender' }), /Notice type/);
  assert.deepEqual(splitList(' a, ,b '), ['a', 'b']);
  assert.equal(money(1500000, 'GBP'), 'GBP 1,500,000');
  assert.equal(money(null), 'value not published');
});

test('buildDigest: sorts by deadline, escapes, reports failures and empty runs', () => {
  const items = [
    { type: 'notice', title: 'B <late>', buyerName: 'X & Y', submissionDeadline: '2026-12-30T12:00:00Z', noticeUrl: 'https://f/2', estimatedValue: 200000, currency: 'GBP' },
    { type: 'notice', title: 'A', buyerName: 'Z', submissionDeadline: '2026-12-01T12:00:00Z', noticeUrl: 'https://f/1' },
    { type: 'summary', charged: 2, moreAvailable: true },
  ];
  const d = buildDigest(items, { digestTitle: 'T', maxLinesInDigest: 1 }, null);
  assert.equal(d.count, 2);
  assert.ok(d.shouldSend);
  assert.match(d.text, /^\*T\*: 2 new notice/);
  assert.match(d.text, /<https:\/\/f\/1\|A>/);
  assert.match(d.text, /and 1 more/);
  assert.match(d.text, /stay new for the next run/);
  assert.match(d.text, /about \$0\.008/);
  const failed = buildDigest([{ error: { message: 'boom' } }], {}, null);
  assert.ok(failed.failed && failed.shouldSend);
  assert.match(failed.text, /run failed: boom/);
  const empty = buildDigest([{ type: 'summary', charged: 0 }], {}, null);
  assert.equal(empty.shouldSend, false);
});

test('end to end in mock mode: Code nodes run as n8n would run them', () => {
  // Minimal stand-ins for n8n's $() and $input inside Code nodes.
  const outputs = { Settings: [{ json: SETTINGS }] };
  const run = (name, inputItems) => {
    const code = byName(committed, name).parameters.jsCode;
    const $ = (n) => ({ first: () => outputs[n][0], all: () => outputs[n] });
    const $input = { all: () => inputItems, first: () => inputItems[0] };
    outputs[name] = new Function('$', '$input', code)($, $input);
    return outputs[name];
  };
  const plan = run('Build Actor input', outputs.Settings);
  assert.equal(plan[0].json.actorInput.maxItems, 100);
  const mock = run('Mock Actor output (free, no Apify call)', plan);
  assert.ok(mock.length >= 2);
  const digest = run('Build digest', mock);
  assert.equal(digest[0].json.count, mock.filter((i) => i.json.type === 'notice').length);
  assert.match(digest[0].json.html, /Open Government Licence/);
});
