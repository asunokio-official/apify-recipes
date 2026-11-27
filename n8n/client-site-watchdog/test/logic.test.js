import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClients, normalizeDomain, planRun, classify, buildDigest, planWrites, mockActorRows, estimateCost } from '../src/logic.js';

const NOW = Date.parse('2026-11-30T07:00:00Z'); // a Monday
const C = (d, client = 'Client') => ({ client, domain: d });
const dnsOk = (domain, extra = {}) => ({ type: 'domain', domain, status: 'ok', exists: true, baseline: false, changes: 0, current: { expiresAt: '2027-12-31' }, daysToExpiry: 400, errors: [], ...extra });
const techOk = (domain, extra = {}) => ({ type: 'domain', domain, scanStatus: 'ok', baseline: false, ...extra });

test('invalid input: bad lines, URLs, duplicates, IPs and over-limit are reported, never run', () => {
  const r = parseClients('Acme | https://www.Acme.com/shop?x=1\nnot a domain\n192.168.1.1\nlocalhost\nAcme | acme.com\n# comment\n\nsecond.example\nthird.example', 2);
  assert.deepEqual(r.domains.map((d) => d.domain), ['acme.com', 'second.example']);
  assert.equal(r.domains[0].client, 'Acme');
  assert.equal(r.domains[1].client, 'Unassigned');
  assert.ok(r.problems.some((p) => /not a valid domain/.test(p)));
  assert.ok(r.problems.some((p) => /listed twice/.test(p)));
  assert.ok(r.problems.some((p) => /over maxDomains/.test(p)));
  assert.equal(normalizeDomain('Example.COM.'), 'example.com');
  assert.equal(normalizeDomain('a b.com'), null);
});

test('empty input and budget guard stop before any Apify call', () => {
  assert.equal(planRun({ clients: '', useMockData: false }, NOW).skip, true);
  const p = planRun({ clients: 'a.example\nb.example', useMockData: false, maxRunCostUsd: 0.001, watchlistName: 'w' }, NOW);
  assert.equal(p.skip, true); assert.match(p.reason, /above maxRunCostUsd/);
  const ok = planRun({ clients: 'a.example\nb.example', useMockData: false, maxRunCostUsd: 1, watchlistName: 'w', techCheckWeekday: 1 }, NOW);
  assert.equal(ok.skip, false); assert.equal(ok.techToday, true); assert.equal(ok.dnsInput.domains.length, 2); assert.ok(ok.maxTotalChargeUsd >= ok.cost.perRunUsd);
});

test('technology check runs only on its weekday (or never / always)', () => {
  const s = { clients: 'a.example', useMockData: false, watchlistName: 'w' };
  assert.equal(planRun({ ...s, useMockData: true, techCheckWeekday: 2 }, NOW).techToday, true); // test mode always shows both checks
  assert.equal(planRun({ ...s, techCheckWeekday: 1 }, NOW).techToday, true);
  assert.equal(planRun({ ...s, techCheckWeekday: 2 }, NOW).techToday, false);
  assert.equal(planRun({ ...s, techCheckWeekday: 0 }, NOW).techToday, false);
  assert.equal(planRun({ ...s, techCheckWeekday: 8 }, NOW).techToday, true);
});

test('cost estimate matches the published prices', () => {
  const e = estimateCost(100, true);
  assert.equal(e.perRunUsd, Math.round((100 * 0.002 + 100 * 0.003 + 0.0001) * 10000) / 10000);
  assert.ok(Math.abs(e.perMonthUsd - (100 * 0.002 * 30 + 100 * 0.003 * 4.35 + 0.003)) < 0.01);
});

test('first run (baseline): no alerts, a quiet note, nothing to send', () => {
  const c = [C('a.example'), C('b.example')];
  const r = classify({ dnsRows: c.map((x) => dnsOk(x.domain, { baseline: true })), techRows: c.map((x) => techOk(x.domain, { baseline: true })), techRan: true, clients: c, state: [], now: NOW });
  const d = buildDigest(r, {});
  assert.equal(d.send, false); assert.equal(d.baselineOnly, true); assert.match(d.quietNote, /Baseline saved for 2/);
});

test('nothing changed: all quiet, no notification, no state noise', () => {
  const c = [C('a.example')];
  const r = classify({ dnsRows: [dnsOk('a.example')], techRows: [techOk('a.example')], techRan: true, clients: c, state: [], now: NOW });
  assert.equal(r.alerts.length, 0);
  const d = buildDigest(r, {});
  assert.equal(d.send, false); assert.match(d.quietNote, /All quiet/);
  assert.deepEqual(planWrites(r, false, NOW), []);
});

test('DNS changes are classified by urgency', () => {
  const c = [C('a.example')];
  const ch = (field, before, after, extra = {}) => ({ type: 'change', domain: 'a.example', change: 'field_changed', field, before, after, confirmedAt: '2026-11-30T05:00:00Z', ...extra });
  const rows = [dnsOk('a.example'), ch('nameservers', ['x'], ['y']), ch('registrar', 'A', 'B'), ch('mx', ['m1'], ['m2']), ch('dmarc', 'v=DMARC1', null), ch('spf', 'v=spf1 a', 'v=spf1 mx'), ch('expiresAt', '2026-12-30', '2027-12-30')];
  const lv = Object.fromEntries(classify({ dnsRows: rows, clients: c, state: [], now: NOW }).alerts.map((a) => [a.title.replace('DNS/registration: ', ''), a.level]));
  assert.equal(lv.nameservers, 'critical'); assert.equal(lv.registrar, 'critical'); assert.equal(lv.mx, 'high'); assert.equal(lv.dmarc, 'high'); assert.equal(lv.spf, 'medium'); assert.equal(lv.expiresAt, 'low');
});

test('expiry approaching: threshold rows from the Actor, daily reminders from 7 days, expired is critical; no double alert', () => {
  const c = [C('a.example'), C('b.example'), C('c.example')];
  const rows = [
    dnsOk('a.example', { daysToExpiry: 30, current: { expiresAt: '2026-12-30' } }), { type: 'change', domain: 'a.example', change: 'expiring_soon', after: '2026-12-30', daysToExpiry: 30, threshold: 30 },
    dnsOk('b.example', { daysToExpiry: 6, current: { expiresAt: '2026-12-06' } }), { type: 'change', domain: 'b.example', change: 'expiring_soon', after: '2026-12-06', daysToExpiry: 7, threshold: 7 },
    dnsOk('c.example', { daysToExpiry: -2, current: { expiresAt: '2026-11-28' } }),
  ];
  const r = classify({ dnsRows: rows, clients: c, state: [], now: NOW });
  const by = Object.fromEntries(r.alerts.map((a) => [a.domain, a]));
  assert.equal(by['a.example'].level, 'medium');
  assert.equal(by['b.example'].level, 'critical'); assert.equal(r.alerts.filter((a) => a.domain === 'b.example').length, 1);
  assert.equal(by['c.example'].level, 'critical'); assert.match(by['c.example'].detail, /expired 2 day/);
  // a second run the same day is suppressed; the next day it reminds again
  const state = planWrites(r, true, NOW);
  assert.equal(classify({ dnsRows: rows, clients: c, state, now: NOW + 3600000 }).alerts.filter((a) => a.domain === 'b.example').length, 0);
  assert.equal(classify({ dnsRows: rows.map((x) => (x.domain === 'b.example' && x.type === 'domain' ? { ...x, daysToExpiry: 5 } : x)), clients: c, state, now: NOW + DAYMS() }).alerts.some((a) => a.domain === 'b.example'), true);
});
function DAYMS() { return 86400000; }

test('technology change: removed important tool is high, added is low', () => {
  const c = [C('a.example')];
  const rows = [techOk('a.example'), { type: 'change', domain: 'a.example', change: 'removed', technology: 'Stripe', category: 'Payments', confirmedAt: 't1' }, { type: 'change', domain: 'a.example', change: 'added', technology: 'Hotjar', category: 'Analytics', confirmedAt: 't1' }, { type: 'change', domain: 'a.example', change: 'removed', technology: 'jQuery', category: 'JavaScript library', confirmedAt: 't1' }];
  const r = classify({ dnsRows: [dnsOk('a.example')], techRows: rows, techRan: true, clients: c, state: [], now: NOW });
  const by = Object.fromEntries(r.alerts.map((a) => [a.detail.split(' ')[0], a.level]));
  assert.equal(by.Stripe, 'high'); assert.equal(by.Hotjar, 'low'); assert.equal(by.jQuery, 'medium');
});

test('fetch failure is "unknown", never a change; alert only after 3 failed runs in a row; recovery resets', () => {
  const c = [C('a.example')];
  const failedDns = [dnsOk('a.example', { status: 'failed', errors: ['dns_timeout'], current: {}, daysToExpiry: null })];
  let state = [];
  for (let i = 1; i <= 3; i++) {
    const r = classify({ dnsRows: failedDns, clients: c, state, now: NOW + i * 86400000 });
    assert.equal(r.failed.length, 1);
    assert.equal(r.alerts.filter((a) => a.title.startsWith('Could not check')).length, i === 3 ? 1 : 0, `run ${i}`);
    assert.equal(r.alerts.some((a) => /Domain does not exist|DNS\/registration/.test(a.title)), false);
    state = state.concat(planWrites(r, true, NOW + i * 86400000));
  }
  const ok = classify({ dnsRows: [dnsOk('a.example')], clients: c, state, now: NOW + 4 * 86400000 });
  const w = planWrites(ok, false, NOW + 4 * 86400000);
  assert.deepEqual(w.map((x) => x.kind), ['ok']);
  state = state.concat(w);
  assert.equal(classify({ dnsRows: failedDns, clients: c, state, now: NOW + 5 * 86400000 }).failed[0].streak, 1);
});

test('blocked technology scans count as failures; robots.txt skips are noted once; NXDOMAIN is critical', () => {
  const c = [C('a.example'), C('b.example'), C('c.example')];
  const r = classify({ dnsRows: [dnsOk('a.example'), dnsOk('b.example'), dnsOk('c.example', { exists: false, current: {}, daysToExpiry: null })], techRows: [techOk('a.example', { scanStatus: 'blocked', errorType: 'http_403' }), techOk('b.example', { scanStatus: 'skipped_robots' }), techOk('c.example')], techRan: true, clients: c, state: [], now: NOW });
  assert.equal(r.failed.some((f) => f.domain === 'a.example' && f.scope === 'tech'), true);
  assert.equal(r.alerts.find((a) => a.title === 'Technology check skipped').level, 'low');
  assert.equal(r.alerts.find((a) => a.title === 'Domain does not exist').level, 'critical');
});

test('empty result from the Actor is reported as "monitoring did not run", not as all-clear', () => {
  const r = classify({ dnsRows: [], techRows: [], techRan: true, clients: [C('a.example')], state: [], now: NOW });
  assert.equal(r.alerts[0].title, 'Monitoring did not run'); assert.equal(r.alerts[0].level, 'high');
  assert.match(buildDigest(r, {}).text, /NOT an all-clear|Monitoring did not run/);
  // the same day is not repeated
  assert.equal(classify({ dnsRows: [], clients: [C('a.example')], state: planWrites(r, true, NOW), now: NOW + 600000 }).alerts.length, 0);
});

test('duplicate prevention and re-run: the same confirmed change is alerted once, a new one is alerted', () => {
  const c = [C('a.example')];
  const chg = (after, at) => ({ type: 'change', domain: 'a.example', change: 'field_changed', field: 'mx', before: ['m1'], after, confirmedAt: at });
  const r1 = classify({ dnsRows: [dnsOk('a.example'), chg(['m2'], 't1')], clients: c, state: [], now: NOW });
  assert.equal(r1.alerts.length, 1);
  const state = planWrites(r1, true, NOW);
  const r2 = classify({ dnsRows: [dnsOk('a.example'), chg(['m2'], 't1')], clients: c, state, now: NOW + 1000 });
  assert.equal(r2.alerts.length, 0); assert.equal(r2.notes.length, 1);
  assert.equal(classify({ dnsRows: [dnsOk('a.example'), chg(['m3'], 't2')], clients: c, state, now: NOW + 5000 }).alerts.length, 1);
  // not delivered (no state saved) => alerted again next run
  assert.equal(classify({ dnsRows: [dnsOk('a.example'), chg(['m2'], 't1')], clients: c, state: [], now: NOW + 1000 }).alerts.length, 1);
});

test('digest: sorted by severity, grouped by client, minLevel hides low items but keeps them out of the send decision', () => {
  const c = [C('a.example', 'Zed'), C('b.example', 'Amy')];
  const r = classify({ dnsRows: [dnsOk('a.example'), dnsOk('b.example'), { type: 'change', domain: 'a.example', change: 'field_changed', field: 'expiresAt', before: 'x', after: 'y', confirmedAt: 't' }], clients: c, state: [], now: NOW });
  assert.equal(buildDigest(r, { minLevel: 'medium' }).send, false);
  assert.equal(buildDigest(r, { minLevel: 'low' }).send, true);
  const all = mockAll();
  const d = buildDigest(all, { useMockData: true });
  assert.match(d.subject, /^\[CRITICAL\] 8 client domain alerts \(TEST DATA\)$/);
  assert.ok(d.text.indexOf('CRITICAL') < d.text.indexOf('HIGH') && d.text.indexOf('HIGH') < d.text.indexOf('MEDIUM'));
});

function mockAll() {
  const c = ['northwind-dental.example', 'blue-harbor-cafe.example', 'old-mill-studio.example', 'harbor-events.example', 'shop.acme-bakery.example', 'green-leaf-florist.example'].map((d, i) => C(d, `Client ${i}`));
  return classify({ dnsRows: mockActorRows(c, NOW, 'dns'), techRows: mockActorRows(c, NOW, 'tech'), techRan: true, clients: c, state: [], now: NOW });
}

test('mock scenarios cover every case, use only reserved .example domains, and contain no e-mail addresses', () => {
  const r = mockAll();
  assert.equal(r.alerts.length, 8);
  assert.equal(r.failed.length, 2);
  const text = JSON.stringify(mockActorRows([C('x.example')], NOW, 'dns'));
  assert.equal(/@/.test(text), false);
});
