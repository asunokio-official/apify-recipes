// Pure logic for the "client site watchdog" workflow. build.mjs inlines this file into the Code nodes.
// No network, no credentials. Everything is unit-tested in test/logic.test.js.

const DAY = 86400000;
const LEVELS = ['critical', 'high', 'medium', 'low'];
const LEVEL_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

function normalizeDomain(raw) {
  let s = String(raw ?? '').trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '').replace(/^www\./, '');
  return DOMAIN_RE.test(s) ? s : null;
}

// "Client name | domain" per line (the client name is optional). Lines starting with # are comments.
function parseClients(text, maxDomains = 100) {
  const domains = [];
  const problems = [];
  const seen = new Set();
  let truncated = 0;
  String(text ?? '').split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const parts = t.split('|').map((x) => x.trim());
    const rawDomain = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    const client = parts.length > 1 ? parts.slice(0, -1).join(' | ') || 'Unassigned' : 'Unassigned';
    const domain = normalizeDomain(rawDomain);
    if (!domain) { problems.push(`line ${i + 1}: "${t.slice(0, 60)}" is not a valid domain name`); return; }
    if (seen.has(domain)) { problems.push(`line ${i + 1}: ${domain} is listed twice (kept the first)`); return; }
    seen.add(domain);
    if (domains.length >= maxDomains) { truncated += 1; return; }
    domains.push({ client, domain });
  });
  if (truncated) problems.push(`${truncated} domain(s) over maxDomains (${maxDomains}) were left out`);
  return { domains, problems };
}

function round(x, n = 2) { const f = 10 ** n; return Math.round(x * f) / f; }

function estimateCost(count, techToday, prices = {}) {
  const dns = prices.dnsPerCheck ?? 0.002;
  const tech = prices.techPerCheck ?? 0.003;
  const start = prices.start ?? 0.00005;
  const run = count * dns + start + (techToday ? count * tech + start : 0);
  const month = (count * dns * 30) + (count * tech * 4.35) + 2 * start * 30;
  return { perRunUsd: round(run, 4), perMonthUsd: round(month, 2) };
}

// 1 = Monday ... 7 = Sunday (UTC)
function weekdayUtc(now) { const d = new Date(now).getUTCDay(); return d === 0 ? 7 : d; }

function planRun(settings, now = Date.now()) {
  const parsed = parseClients(settings.clients, settings.maxDomains ?? 100);
  const techToday = settings.useMockData === true ? true : settings.techCheckWeekday === 0 ? false : (settings.techCheckWeekday === 8 ? true : weekdayUtc(now) === (settings.techCheckWeekday || 1));
  const cost = estimateCost(parsed.domains.length, techToday);
  const plan = { problems: parsed.problems, domains: parsed.domains, techToday, cost, skip: false, reason: '' };
  if (!parsed.domains.length) { plan.skip = true; plan.reason = 'No valid domains in Settings.clients. Nothing was run and nothing was charged.'; return plan; }
  if (!settings.useMockData && settings.maxRunCostUsd > 0 && cost.perRunUsd > settings.maxRunCostUsd) {
    plan.skip = true; plan.reason = `Estimated cost of this run ($${cost.perRunUsd}) is above maxRunCostUsd ($${settings.maxRunCostUsd}). Nothing was run and nothing was charged.`; return plan;
  }
  const names = parsed.domains.map((d) => d.domain);
  plan.maxTotalChargeUsd = round(Math.max(0.01, cost.perRunUsd * 1.3), 3);
  plan.dnsInput = { domains: names, watchlistName: settings.watchlistName, confirmRuns: settings.confirmRuns ?? 2, expiryWarningDays: [30, 14] };
  plan.techInput = { domains: names, watchlistName: settings.watchlistName, confirmRuns: settings.confirmRuns ?? 2, minConfidence: 50 };
  return plan;
}

// ---- classification -------------------------------------------------------------------------------------------------

const TECH_IMPORTANT = /pay|commerce|shop|analytic|tag manager|consent|cookie|checkout|security|captcha/i;

function level(l, why) { return { level: l, why }; }

function classifyDnsChange(r) {
  const f = r.field;
  if (r.change === 'expiring_soon') {
    const d = r.daysToExpiry;
    if (d <= 7) return level('critical', `expires in ${d} day(s)`);
    if (d <= 14) return level('high', `expires in ${d} days`);
    return level('medium', `expires in ${d} days`);
  }
  if (f === 'nameservers' || f === 'rdapNameservers') return level('critical', 'nameservers changed: the DNS provider may have moved (or the domain was hijacked)');
  if (f === 'registrar') return level('critical', 'registrar changed: the domain was transferred');
  if (f === 'domainStatus') return level('high', 'registry status flags changed (a lock may have been removed or a hold added)');
  if (f === 'mx') return level('high', 'mail routing (MX) changed: check mail still arrives');
  if (f === 'dmarc' || f === 'spf') {
    if (r.after == null || (Array.isArray(r.after) && !r.after.length)) return level('high', `${f.toUpperCase()} record was removed: mail from this domain is easier to spoof and may land in spam`);
    return level('medium', `${f.toUpperCase()} record was edited`);
  }
  if (f === 'expiresAt') return level('low', 'expiry date changed (usually a renewal)');
  return level('medium', `${f || 'record'} changed`);
}

function classifyTechChange(r) {
  const important = TECH_IMPORTANT.test(`${r.category || ''} ${r.technology || ''}`);
  if (r.change === 'removed') return important ? level('high', `${r.technology} disappeared (${r.category || 'tool'}): the client site may have lost something it relied on`) : level('medium', `${r.technology} was removed`);
  return level('low', `${r.technology} was added`);
}

function listText(v) { return Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : (v == null ? 'none' : String(v)); }
function short(s, n = 140) { s = String(s); return s.length > n ? `${s.slice(0, n - 1)}…` : s; }
function dayKey(now) { return new Date(now).toISOString().slice(0, 10); }

function classify({ dnsRows = [], techRows = [], techRan = false, clients = [], state = [], settings = {}, now = Date.now() }) {
  const clientOf = new Map(clients.map((c) => [c.domain, c.client]));
  const cooldownMs = (settings.cooldownDays ?? 30) * DAY;
  const known = new Map();
  for (const s of state) if (s.kind === 'alert') known.set(s.key, Math.max(known.get(s.key) ?? 0, Date.parse(s.at) || 0));
  const alerts = [];
  const notes = [];
  const add = (a) => {
    const lastAt = known.get(a.key);
    if (lastAt && now - lastAt < (a.cooldownMs ?? cooldownMs)) { notes.push({ key: a.key, suppressed: 'already alerted' }); return; }
    if (alerts.some((x) => x.key === a.key)) return;
    alerts.push({ client: clientOf.get(a.domain) || 'Unassigned', ...a });
  };
  const dailyDays = settings.dailyReminderDays ?? 7;
  const failN = settings.failStreakAlert ?? 3;
  const today = dayKey(now);

  const dnsDomainRows = dnsRows.filter((r) => r.type === 'domain');
  const dnsChanges = dnsRows.filter((r) => r.type === 'change');
  const hasDailyReminder = new Set();

  // expiry reminders: every day while <= dailyDays (escalating), including already expired
  for (const r of dnsDomainRows) {
    if (r.status !== 'ok' || r.exists === false || typeof r.daysToExpiry !== 'number') continue;
    if (r.daysToExpiry <= dailyDays) {
      hasDailyReminder.add(r.domain);
      const exp = r.current?.expiresAt || '';
      const msg = r.daysToExpiry < 0 ? `expired ${-r.daysToExpiry} day(s) ago` : `expires in ${r.daysToExpiry} day(s)`;
      add({ key: `exp-daily|${r.domain}|${exp}|${today}`, domain: r.domain, source: 'dns', level: r.daysToExpiry <= 7 ? 'critical' : 'high', title: 'Domain expiry', detail: `${msg}${exp ? ` (${exp})` : ''}. Reminders repeat daily until it is renewed.`, cooldownMs: DAY });
    }
  }
  for (const r of dnsChanges) {
    if (r.change === 'expiring_soon' && hasDailyReminder.has(r.domain)) continue;
    const c = classifyDnsChange(r);
    const when = r.confirmedAt || r.firstObservedAt || '';
    const key = r.change === 'expiring_soon'
      ? `exp-threshold|${r.domain}|${r.after}|${r.threshold}`
      : `dns|${r.domain}|${r.change}|${r.field}|${short(JSON.stringify(r.after), 80)}|${when}`;
    const detail = r.change === 'expiring_soon' ? `Domain ${c.why} (${r.after}).` : `${c.why}. Before: ${short(listText(r.before))}. Now: ${short(listText(r.after))}.`;
    add({ key, domain: r.domain, source: 'dns', level: c.level, title: r.change === 'expiring_soon' ? 'Domain expiry' : `DNS/registration: ${r.field}`, detail, cooldownMs: 365 * DAY });
  }
  for (const r of dnsDomainRows) {
    if (r.exists === false) add({ key: `nxdomain|${r.domain}|${today}`, domain: r.domain, source: 'dns', level: 'critical', title: 'Domain does not exist', detail: 'The domain returns "does not exist" (NXDOMAIN). It may have lapsed or been deleted, or it is mistyped in your list.', cooldownMs: DAY });
  }
  const techDomainRows = techRows.filter((r) => r.type === 'domain');
  for (const r of techRows.filter((x) => x.type === 'change')) {
    const c = classifyTechChange(r);
    add({ key: `tech|${r.domain}|${r.change}|${r.technology}|${r.confirmedAt || ''}`, domain: r.domain, source: 'tech', level: c.level, title: `Technology ${r.change}`, detail: `${c.why}.${r.category ? ` Category: ${r.category}.` : ''}`, cooldownMs: 365 * DAY });
  }

  // failures: a failed check is "unknown", never a change. Alert only after failN runs in a row.
  const stateRows = state.filter((s) => s.kind === 'fail' || s.kind === 'ok');
  const streakOf = (domain, scope) => {
    const rows = stateRows.filter((s) => s.domain === domain && s.scope === scope).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let n = 0;
    for (const s of rows) n = s.kind === 'fail' ? n + 1 : 0;
    return n;
  };
  const failed = [];
  const okNow = [];
  const check = (rows, scope, isFail, isOk) => {
    for (const r of rows) {
      if (isFail(r)) {
        const streak = streakOf(r.domain, scope) + 1;
        failed.push({ domain: r.domain, scope, streak, reason: r.errorType || (r.errors && r.errors[0]) || r.scanStatus || r.status });
        if (streak >= failN && streak % failN === 0) add({ key: `fail|${r.domain}|${scope}|${streak}`, domain: r.domain, source: scope, level: 'low', title: `Could not check (${scope})`, detail: `${streak} checks in a row failed. This is NOT a change: the last known state is unchanged. Possible causes: the site blocks automated checks or is down.`, cooldownMs: 365 * DAY });
      } else if (isOk(r)) okNow.push({ domain: r.domain, scope, reset: streakOf(r.domain, scope) > 0 });
    }
  };
  check(dnsDomainRows, 'dns', (r) => r.status === 'failed' && r.exists !== false, (r) => r.status === 'ok');
  if (techRan) {
    check(techDomainRows.filter((r) => r.scanStatus !== 'skipped_robots'), 'tech', (r) => r.scanStatus === 'error' || r.scanStatus === 'blocked', (r) => r.scanStatus === 'ok');
    for (const r of techDomainRows.filter((x) => x.scanStatus === 'skipped_robots')) add({ key: `robots|${r.domain}`, domain: r.domain, source: 'tech', level: 'low', title: 'Technology check skipped', detail: 'This site\'s robots.txt disallows automated checks, so technology changes are not monitored for it (DNS and expiry still are).', cooldownMs: 90 * DAY });
  }

  // monitoring health: no rows at all means the Actor run itself failed, which must not look like "all quiet"
  const expected = clients.length;
  const dnsHealthy = dnsDomainRows.length > 0;
  if (expected && !dnsHealthy) add({ key: `health|dns|${today}`, domain: '(all)', source: 'dns', level: 'high', title: 'Monitoring did not run', detail: 'The DNS Actor returned no data (run failed, spending cap reached or Apify credential problem). Nothing was checked today: this is NOT an all-clear.', cooldownMs: DAY });
  if (techRan && expected && !techDomainRows.length) add({ key: `health|tech|${today}`, domain: '(all)', source: 'tech', level: 'medium', title: 'Technology monitoring did not run', detail: 'The Tech Stack Change Monitor returned no data. DNS and expiry checks above are unaffected.', cooldownMs: DAY });

  alerts.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.client.localeCompare(b.client) || a.domain.localeCompare(b.domain));
  const baselineCount = dnsDomainRows.filter((r) => r.baseline).length;
  return { alerts, failed, okNow, notes, summary: { clients: new Set(clients.map((c) => c.client)).size, domains: expected, dnsChecked: dnsDomainRows.filter((r) => r.status === 'ok').length, techChecked: techRan ? techDomainRows.filter((r) => r.scanStatus === 'ok').length : null, baselineCount, alerts: alerts.length, bySeverity: Object.fromEntries(LEVELS.map((l) => [l, alerts.filter((a) => a.level === l).length])) } };
}

// ---- digest ----------------------------------------------------------------------------------------------------------

const ICON = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function buildDigest(result, settings = {}, plan = {}) {
  const { alerts, summary } = result;
  const minLevel = LEVEL_RANK[settings.minLevel] ?? 3;
  const shown = alerts.filter((a) => LEVEL_RANK[a.level] <= minLevel);
  const maxLines = settings.maxLinesInDigest ?? 40;
  const baselineOnly = !shown.length && summary.baselineCount > 0;
  const send = shown.length > 0;
  const top = shown[0]?.level;
  const subject = send ? `[${top.toUpperCase()}] ${shown.length} client domain alert${shown.length > 1 ? 's' : ''}${settings.useMockData ? ' (TEST DATA)' : ''}` : '';
  const lines = [];
  const clientsSeen = [...new Set(shown.map((a) => a.client))];
  for (const c of clientsSeen) {
    lines.push(`*${c}*`);
    for (const a of shown.filter((x) => x.client === c).slice(0, maxLines)) lines.push(`${ICON[a.level]} ${a.level.toUpperCase()} · ${a.domain} · ${a.title}: ${a.detail}`);
  }
  const foot = `Checked ${summary.domains} domain(s) for ${summary.clients} client(s)${summary.techChecked != null ? `; technology check ran today (${summary.techChecked} ok)` : '; technology check runs on its own weekday'}. Estimated Apify cost of this run: $${plan.cost?.perRunUsd ?? '?'}.`;
  const text = send ? `${subject}\n\n${lines.join('\n')}\n\n${foot}` : '';
  const html = send ? `<h3>${esc(subject)}</h3>${clientsSeen.map((c) => `<h4>${esc(c)}</h4><ul>${shown.filter((x) => x.client === c).map((a) => `<li>${ICON[a.level]} <b>${a.level.toUpperCase()}</b> · ${esc(a.domain)} · ${esc(a.title)}: ${esc(a.detail)}</li>`).join('')}</ul>`).join('')}<p><small>${esc(foot)}</small></p>` : '';
  return { send, subject, text, html, count: shown.length, hiddenByMinLevel: alerts.length - shown.length, baselineOnly, quietNote: send ? '' : (baselineOnly ? `Baseline saved for ${summary.baselineCount} domain(s). No alerts on a first run.` : 'All quiet: nothing changed, nothing to send.'), summary };
}

// rows to append to the state data table after a successful notification
function planWrites(result, digestSent, now = Date.now()) {
  const at = new Date(now).toISOString();
  const rows = [];
  for (const a of result.alerts) rows.push({ kind: 'alert', key: a.key, domain: a.domain, scope: a.source, level: a.level, at, note: short(a.title, 60) });
  const failedSet = new Set(result.failed.map((f) => `${f.domain}|${f.scope}`));
  for (const f of result.failed) rows.push({ kind: 'fail', key: '', domain: f.domain, scope: f.scope, level: '', at, note: short(String(f.reason ?? ''), 60) });
  for (const o of result.okNow) if (!failedSet.has(`${o.domain}|${o.scope}`) && o.reset) rows.push({ kind: 'ok', key: '', domain: o.domain, scope: o.scope, level: '', at, note: 'recovered' });
  return rows;
}

export { normalizeDomain, parseClients, estimateCost, planRun, classify, buildDigest, planWrites, classifyDnsChange, classifyTechChange, weekdayUtc };

// ---- test data (fictional .example domains; used only while useMockData is true) ---------------------------------------

function mockActorRows(domains, now, scope) {
  const iso = (ms) => new Date(ms).toISOString();
  const day = (n) => iso(now + n * DAY).slice(0, 10);
  const base = (domain) => ({ type: 'domain', domain, checkedAt: iso(now), status: 'ok', exists: true, baseline: false, changes: 0, errors: [], unknownFields: [], current: { expiresAt: day(400) }, daysToExpiry: 400 });
  const rows = [];
  for (const { domain } of domains) {
    if (scope === 'dns') {
      const r = base(domain);
      if (domain === 'northwind-dental.example') {
        r.daysToExpiry = 5; r.current.expiresAt = day(5);
        rows.push({ type: 'change', domain, change: 'field_changed', field: 'nameservers', before: ['ns1.old-host.example'], after: ['ns1.new-host.example', 'ns2.new-host.example'], confirmedAt: iso(now - 3600000), confirmations: 2 });
      }
      if (domain === 'blue-harbor-cafe.example') {
        rows.push({ type: 'change', domain, change: 'field_changed', field: 'dmarc', before: 'v=DMARC1; p=quarantine', after: null, confirmedAt: iso(now - 7200000), confirmations: 2 });
        rows.push({ type: 'change', domain, change: 'field_changed', field: 'spf', before: 'v=spf1 include:_spf.mail-a.example ~all', after: 'v=spf1 include:_spf.mail-b.example ~all', confirmedAt: iso(now - 7200000), confirmations: 2 });
      }
      if (domain === 'harbor-events.example') { r.status = 'failed'; r.errors = ['dns_timeout']; r.current = {}; r.daysToExpiry = null; }
      if (domain === 'old-mill-studio.example') { r.exists = false; r.current = {}; r.daysToExpiry = null; }
      if (domain === 'green-leaf-florist.example') {
        r.daysToExpiry = 14; r.current.expiresAt = day(14);
        rows.push({ type: 'change', domain, change: 'expiring_soon', after: day(14), daysToExpiry: 14, threshold: 14 });
      }
      rows.push(r);
    } else {
      const r = { type: 'domain', domain, scanStatus: 'ok', errorType: null, baseline: false, changes: 0, technologies: [], pending: [], lastSuccessfulCheckAt: iso(now) };
      if (domain === 'shop.acme-bakery.example') rows.push({ type: 'change', domain, change: 'removed', technology: 'Stripe', category: 'Payments', lastSeenAt: iso(now - 8 * DAY), firstMissingAt: iso(now - 7 * DAY), confirmedAt: iso(now - 3600000), confirmations: 2 });
      if (domain === 'green-leaf-florist.example') rows.push({ type: 'change', domain, change: 'added', technology: 'Klaviyo', category: 'Email marketing', confidence: 90, confirmedAt: iso(now - 3600000), confirmations: 2 });
      if (domain === 'harbor-events.example') { r.scanStatus = 'blocked'; r.errorType = 'http_403'; }
      rows.push(r);
    }
  }
  return rows;
}

export { mockActorRows };
