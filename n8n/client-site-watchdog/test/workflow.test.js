import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWorkflow } from '../build.mjs';
import { validateWorkflow } from '../validate.mjs';

const wf = JSON.parse(readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
const code = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;
const settingsNode = wf.nodes.find((n) => n.name === 'Settings');
const baseSettings = Object.fromEntries(settingsNode.parameters.assignments.assignments.map((a) => [a.name, a.value]));

// Runs a Code node exactly as n8n would, with stubbed $ for upstream outputs.
function run(name, outputs) {
  const $ = (n) => {
    if (!(n in outputs)) throw new Error(`Node '${n}' hasn't been executed`);
    return { all: () => outputs[n].map((json) => ({ json })), first: () => ({ json: outputs[n][0] }) };
  };
  return new Function('$', '$input', `${code(name)}`)($, null).map((i) => i.json);
}
const RealDate = Date;
function atTime(iso, fn) { const t = RealDate.parse(iso); globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } }; try { return fn(); } finally { globalThis.Date = RealDate; } }

test('workflow.json is current, valid, and contains no credentials, secrets or e-mail addresses', () => {
  assert.deepEqual(validateWorkflow(wf), []);
  assert.equal(JSON.stringify(buildWorkflow(), null, 2) + '\n', readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
  assert.equal(baseSettings.useMockData, true); assert.equal(baseSettings.slackEnabled, false); assert.equal(baseSettings.emailEnabled, false);
});

test('default (test) mode: free end to end, finds every scenario, sends and saves nothing', () => {
  atTime('2026-11-30T07:00:00Z', () => {
    const plan = run('Plan run', { Settings: [baseSettings], 'Get state rows': [{}] })[0];
    assert.equal(plan.skip, false); assert.equal(plan.domains.length, 7); assert.equal(plan.techToday, true);
    const dns = run('Mock DNS output (test data, free)', { 'Plan run': [plan] });
    const tech = run('Mock technology output (test data, free)', { 'Plan run': [plan] });
    const out = { Settings: [baseSettings], 'Plan run': [plan], 'Get state rows': [{}], 'Mock DNS output (test data, free)': dns, 'Mock technology output (test data, free)': tech };
    const c = run('Classify and deduplicate', out)[0];
    assert.equal(c.digest.send, true); assert.match(c.digest.subject, /TEST DATA/); assert.equal(c.alerts.length, 8);
    assert.equal(c.failedChecks.length, 2);
    assert.deepEqual(run('Plan state writes', { ...out, 'Classify and deduplicate': [c] }), []); // test mode saves nothing
  });
});

test('live run with real-looking Actor output: baseline, alert, rerun is quiet, failure then empty result', () => {
  const live = { ...baseSettings, useMockData: false, slackEnabled: true, techCheckWeekday: 1, clients: 'Acme | acme.example\nBeta | beta.example' };
  const day = (d) => `2026-11-${d}T07:00:00Z`;
  let state = [];
  const exec = (when, dnsRows, techRows) => atTime(when, () => {
    const plan = run('Plan run', { Settings: [live], 'Get state rows': state.length ? state : [{}] })[0];
    const out = { Settings: [live], 'Plan run': [plan], 'Get state rows': state.length ? state : [{}], 'Run DNS & RDAP Change Feed': dnsRows, 'Run Tech Stack Change Monitor': techRows };
    const c = run('Classify and deduplicate', out)[0];
    const w = run('Plan state writes', { ...out, 'Classify and deduplicate': [c] });
    state = state.concat(w);
    return { plan, c, w };
  });
  const dom = (d, x = {}) => ({ type: 'domain', domain: d, status: 'ok', exists: true, current: { expiresAt: '2027-11-01' }, daysToExpiry: 300, errors: [], ...x });
  const tdom = (d, x = {}) => ({ type: 'domain', domain: d, scanStatus: 'ok', ...x });
  // 1) first run: baseline
  let r = exec(day('30'), [dom('acme.example', { baseline: true }), dom('beta.example', { baseline: true })], [tdom('acme.example', { baseline: true }), tdom('beta.example', { baseline: true })]);
  assert.equal(r.c.digest.send, false); assert.equal(r.c.digest.baselineOnly, true); assert.deepEqual(r.w, []);
  // 2) a nameserver change on a Tuesday (technology check not run)
  const ns = { type: 'change', domain: 'beta.example', change: 'field_changed', field: 'nameservers', before: ['a'], after: ['b'], confirmedAt: '2026-12-01T05:00:00Z' };
  r = exec('2026-12-01T07:00:00Z', [dom('acme.example'), dom('beta.example'), ns], []);
  assert.equal(r.plan.techToday, false); assert.equal(r.c.alerts.length, 1); assert.equal(r.c.alerts[0].level, 'critical'); assert.equal(r.w.filter((x) => x.kind === 'alert').length, 1);
  // 3) re-run of the same data: no duplicate
  r = exec('2026-12-01T09:00:00Z', [dom('acme.example'), dom('beta.example'), ns], []);
  assert.equal(r.c.alerts.length, 0); assert.equal(r.c.digest.send, false);
  // 4) the Actor run fails entirely (error item only): reported as monitoring failure, not as all-clear
  r = exec('2026-12-02T07:00:00Z', [{ error: 'Actor run failed' }], []);
  assert.equal(r.c.alerts.length, 1); assert.equal(r.c.alerts[0].title, 'Monitoring did not run');
  // 5) invalid list: nothing runs
  const bad = { ...live, clients: 'not a domain\n' };
  const p = atTime(day('30'), () => run('Plan run', { Settings: [bad], 'Get state rows': [{}] })[0]);
  assert.equal(p.skip, true); assert.ok(p.problems.length >= 1);
});

test('Code nodes that read optional upstream nodes survive "node was not executed" errors', () => {
  const plan = { domains: [{ client: 'A', domain: 'a.example' }], techToday: false, problems: [], cost: { perRunUsd: 0.01 } };
  const out = { Settings: [{ ...baseSettings, useMockData: false }], 'Plan run': [plan] }; // no Get state rows, no Actor nodes
  const c = run('Classify and deduplicate', out)[0];
  assert.equal(c.alerts[0].title, 'Monitoring did not run');
});
