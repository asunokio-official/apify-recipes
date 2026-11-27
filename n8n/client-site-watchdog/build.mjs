// Generates workflow.json from src/logic.js.
// Usage: node build.mjs          (write workflow.json)
//        node build.mjs --check  (exit 1 if workflow.json is out of date)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const lib = readFileSync(here('./src/logic.js'), 'utf8').replace(/\nexport \{[^}]*\};\s*/g, '\n').trim();

export const DNS_ACTOR_ID = 'ASFOeHBwIA693rtne'; // asunoki/dns-rdap-change-feed
export const TECH_ACTOR_ID = 'pRJT6ZiLLUe0I1YeG'; // asunoki/tech-stack-change-monitor

let seq = 0;
const h8 = (s) => createHash('sha1').update(s).digest('hex').slice(0, 8);
const node = (name, type, typeVersion, position, parameters, extra = {}) => {
  seq += 1;
  return { parameters, id: `csw-${String(seq).padStart(3, '0')}-${h8(name)}`, name, type, typeVersion, position, ...extra };
};
const assign = (name, value, type) => ({ id: `csw-set-${h8(name)}`, name, value, type });
const ifTrue = (name, expr) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: `csw-if-${h8(name)}`, leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  },
  options: {},
});
const COLS = ['kind', 'key', 'domain', 'scope', 'level', 'at', 'note'];
const S = "$('Settings').first().json";
const LIVE = `${S}.useMockData !== true && (${S}.slackEnabled === true || ${S}.emailEnabled === true)`;
const SAMPLE = [
  '# One line per site:  Client name | domain   (the client name is optional; lines starting with # are ignored)',
  '# These are fictional .example domains used by the free test mode. Replace them with your clients\' domains.',
  'Acme Bakery | acme-bakery.example',
  'Acme Bakery | shop.acme-bakery.example',
  'Northwind Dental | northwind-dental.example',
  'Blue Harbor Cafe | blue-harbor-cafe.example',
  'Blue Harbor Cafe | harbor-events.example',
  'Old Mill Studio | old-mill-studio.example',
  'Green Leaf Florist | green-leaf-florist.example',
].join('\n');

const OVERVIEW = `### Client site watchdog: DNS, domain expiry and technology changes
For agencies and freelancers who look after many client websites. Once a day it checks every client domain for **confirmed** changes to nameservers, mail records (MX, SPF, DMARC), registrar and domain status, warns before domains expire, and once a week checks for technology changes (a payment, analytics or consent tool that disappeared after a deploy). You get **one digest per run, only when something needs attention**, sorted by urgency (critical, high, medium, low) and grouped by client.

What this adds on top of the two ASUNOKI Apify Actors it uses (*DNS & RDAP Change Feed*, *Tech Stack Change Monitor*; both already report a change only after it repeats on consecutive checks):
- urgency levels, so a nameserver change is not buried under a new tag
- daily expiry reminders from 7 days out (the Actors warn once per threshold), also after a domain has expired
- a failed check is "unknown", never a change; a persistent failure is reported after 3 runs in a row
- an empty or failed Actor run is reported as "monitoring did not run", never as all-clear
- the same alert is never sent twice (a small data table remembers what you were told)
- clean list handling: bad lines, duplicates and URLs are reported and skipped

**Setup**
1. Install the Apify community node (@apify/n8n-nodes-apify) and create an *Apify API* credential. Select it on both Apify nodes.
2. Edit **Settings**: put your clients in *clients* (one "Client | domain" per line).
3. Free test first: keep useMockData = true and click *Run now*. No Apify call, nothing is sent, nothing is saved. Read the output of *Classify and deduplicate* (digest.text).
4. Set useMockData = false and run once: this saves the baseline (no alerts on the first run).
5. Turn on slackEnabled and/or emailEnabled, select the credential on the send node, then enable the daily schedule.`;

const COST = `### Cost you pay to Apify (pay per event, no n8n cost)
- DNS & RDAP Change Feed: **$0.002 per successful domain check**. Tech Stack Change Monitor: **$0.003 per successful domain check**. Failed, blocked and non-existent domains and all change rows are free. A tiny start fee ($0.00005) applies per run.
- DNS runs daily, technology runs once a week (techCheckWeekday). **100 domains: about $6 + $1.30 = about $7.40 a month. 25 domains: about $1.85 a month.**
- Safety: maxRunCostUsd stops the run before any Apify call if the estimate is above your limit, and each Apify run carries a spending cap (1.3 x the estimate).
- Apify's free monthly credit may cover small lists. The estimate for your list is in *Plan run* (cost.perRunUsd, cost.perMonthUsd).`;

const LIMITS = `### Limits (read before relying on it)
- Changes are only as good as what is public: DNS over HTTPS, RDAP and the site's HTML. Some TLDs have no RDAP, so expiry is unknown for them (DNS changes still work). Technology detection can miss tools loaded only after interaction.
- Urgency levels are rules of thumb (for example: nameserver or registrar change = critical, a removed payment/analytics/consent tool = high). Adjust them in the *Classify and deduplicate* code if your policy differs.
- The first run only saves a baseline. A change is reported after it is seen twice (confirmRuns), so alerts arrive one run late by design.
- State lives in the data table *client_watchdog_state* (append-only; delete old rows whenever you like). If a send node fails, nothing is saved and the next run alerts again.
- Not tested on n8n Cloud. The data table nodes need an n8n version with data tables.`;

export function buildWorkflow() {
  seq = 0;
  const nodes = [
    node('Run now', 'n8n-nodes-base.manualTrigger', 1, [-360, 360], {}),
    node('Every day 07:00 (enable after a test run)', 'n8n-nodes-base.scheduleTrigger', 1.2, [-360, 540], { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 7 }] } }, { disabled: true }),
    node('Settings', 'n8n-nodes-base.set', 3.4, [-120, 440], {
      assignments: {
        assignments: [
          assign('clients', SAMPLE, 'string'),
          assign('watchlistName', 'n8n-client-watch', 'string'),
          assign('maxDomains', 100, 'number'),
          assign('maxRunCostUsd', 1, 'number'),
          assign('techCheckWeekday', 1, 'number'),
          assign('confirmRuns', 2, 'number'),
          assign('dailyReminderDays', 7, 'number'),
          assign('failStreakAlert', 3, 'number'),
          assign('cooldownDays', 30, 'number'),
          assign('minLevel', 'low', 'string'),
          assign('maxLinesInDigest', 40, 'number'),
          assign('stateTableName', 'client_watchdog_state', 'string'),
          assign('useMockData', true, 'boolean'),
          assign('slackEnabled', false, 'boolean'),
          assign('slackChannel', '#client-sites', 'string'),
          assign('emailEnabled', false, 'boolean'),
          assign('emailFrom', '', 'string'),
          assign('emailTo', '', 'string'),
        ],
      },
      options: {},
    }, { notes: 'clients: one "Client | domain" per line. techCheckWeekday: 1 = Monday ... 7 = Sunday, 0 = never, 8 = every run. minLevel: critical, high, medium or low (alerts below it are not sent). maxRunCostUsd: stop before any Apify call if the estimate is higher. useMockData = true: free test with fictional data, nothing sent or saved.' }),
    node('Ensure state table', 'n8n-nodes-base.dataTable', 1.1, [120, 440], {
      columns: { column: COLS.map((name) => ({ name, type: 'string' })) },
      options: { createIfNotExists: true },
      resource: 'table',
      operation: 'create',
      tableName: `={{ ${S}.stateTableName }}`,
    }, { executeOnce: true, notes: 'Creates the small state table if it does not exist.' }),
    node('Get state rows', 'n8n-nodes-base.dataTable', 1.1, [340, 440], {
      resource: 'row',
      operation: 'get',
      returnAll: true,
      dataTableId: { __rl: true, mode: 'id', value: "={{ $('Ensure state table').first().json.id }}" },
    }, { executeOnce: true, alwaysOutputData: true }),
    node('Plan run', 'n8n-nodes-base.code', 2, [560, 440], {
      jsCode: `${lib}\n\nconst plan = planRun($('Settings').first().json, Date.now());\nreturn [{ json: plan }];`,
    }, { notes: 'Reads the client list, reports invalid or duplicate lines, decides whether the technology check runs today, estimates the cost and applies the budget guard.' }),
    node('Anything to run?', 'n8n-nodes-base.if', 2.2, [780, 440], ifTrue('Anything to run?', '={{ $json.skip !== true }}')),
    node('Nothing to run (see reason)', 'n8n-nodes-base.noOp', 1, [780, 660], {}, { notes: 'Empty client list or estimate above maxRunCostUsd. Nothing was run and nothing was charged; read "reason" in the Plan run output.' }),
    node('Use mock data? (DNS)', 'n8n-nodes-base.if', 2.2, [1000, 360], ifTrue('Use mock data? (DNS)', `={{ ${S}.useMockData }}`)),
    node('Mock DNS output (test data, free)', 'n8n-nodes-base.code', 2, [1220, 240], {
      jsCode: `// TEST DATA ONLY (useMockData = true): fictional .example domains, no Apify call.\n${lib}\n\nconst plan = $('Plan run').first().json;\nreturn mockActorRows(plan.domains, Date.now(), 'dns').map((json) => ({ json }));`,
    }),
    node('Run DNS & RDAP Change Feed', '@apify/n8n-nodes-apify.apify', 2, [1220, 480], {
      authentication: 'apifyApi',
      resource: 'Actors',
      operation: 'Run actor and get dataset',
      actorSource: 'store',
      actorId: { __rl: true, mode: 'id', value: DNS_ACTOR_ID },
      actorInputMode: 'json',
      customBody: "={{ JSON.stringify($('Plan run').first().json.dnsInput) }}",
      timeout: 900,
      memory: 256,
      maxTotalChargeUsd: "={{ $('Plan run').first().json.maxTotalChargeUsd }}",
      build: '',
    }, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput', notes: 'asunoki/dns-rdap-change-feed ($0.002 per successful domain check). Select your Apify API credential. If the run fails, the next step reports "Monitoring did not run" instead of an all-clear.' }),
    node('Technology check today?', 'n8n-nodes-base.if', 2.2, [1460, 360], ifTrue('Technology check today?', "={{ $('Plan run').first().json.techToday }}")),
    node('Use mock data? (technology)', 'n8n-nodes-base.if', 2.2, [1680, 240], ifTrue('Use mock data? (technology)', `={{ ${S}.useMockData }}`)),
    node('Mock technology output (test data, free)', 'n8n-nodes-base.code', 2, [1900, 140], {
      jsCode: `// TEST DATA ONLY (useMockData = true): fictional .example domains, no Apify call.\n${lib}\n\nconst plan = $('Plan run').first().json;\nreturn mockActorRows(plan.domains, Date.now(), 'tech').map((json) => ({ json }));`,
    }),
    node('Run Tech Stack Change Monitor', '@apify/n8n-nodes-apify.apify', 2, [1900, 340], {
      authentication: 'apifyApi',
      resource: 'Actors',
      operation: 'Run actor and get dataset',
      actorSource: 'store',
      actorId: { __rl: true, mode: 'id', value: TECH_ACTOR_ID },
      actorInputMode: 'json',
      customBody: "={{ JSON.stringify($('Plan run').first().json.techInput) }}",
      timeout: 1800,
      memory: 256,
      maxTotalChargeUsd: "={{ $('Plan run').first().json.maxTotalChargeUsd }}",
      build: '',
    }, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput', notes: 'asunoki/tech-stack-change-monitor ($0.003 per successful domain check). Select your Apify API credential. Runs only on techCheckWeekday.' }),
    node('Classify and deduplicate', 'n8n-nodes-base.code', 2, [2140, 440], {
      jsCode: `${lib}\n\nconst get = (name) => { try { return $(name).all().map((i) => i.json).filter((r) => r && r.type); } catch (e) { return []; } };\nconst settings = $('Settings').first().json;\nconst plan = $('Plan run').first().json;\nconst mock = settings.useMockData === true;\nlet state = [];\ntry { state = $('Get state rows').all().map((i) => i.json).filter((r) => r && r.kind); } catch (e) { state = []; }\nconst dnsRows = get(mock ? 'Mock DNS output (test data, free)' : 'Run DNS & RDAP Change Feed');\nconst techRows = plan.techToday ? get(mock ? 'Mock technology output (test data, free)' : 'Run Tech Stack Change Monitor') : [];\nconst result = classify({ dnsRows, techRows, techRan: plan.techToday === true, clients: plan.domains, state, settings, now: Date.now() });\nconst digest = buildDigest(result, settings, plan);\nreturn [{ json: { digest, alerts: result.alerts, failedChecks: result.failed, suppressedAsDuplicates: result.notes.length, listProblems: plan.problems, result } }];`,
    }, { notes: 'Urgency levels, daily expiry reminders, failure streaks, duplicate suppression and the digest text (digest.text for Slack, digest.html for e-mail). Edit the level rules here if your policy differs.' }),
    node('Anything to send?', 'n8n-nodes-base.if', 2.2, [2380, 440], ifTrue('Anything to send?', '={{ $json.digest.send }}')),
    node('Live mode? (not test data, a channel is on)', 'n8n-nodes-base.if', 2.2, [2620, 340], ifTrue('Live mode?', `={{ ${LIVE} }}`)),
    node('Preview only (nothing sent, nothing saved)', 'n8n-nodes-base.noOp', 1, [2620, 160], {}, { notes: 'Test data or both channels off: read digest.text in the previous node. Nothing is sent and the alert state is not saved, so enabling a channel later still alerts.' }),
    node('Slack enabled?', 'n8n-nodes-base.if', 2.2, [2860, 340], ifTrue('Slack enabled?', `={{ ${S}.slackEnabled }}`)),
    node('Send to Slack', 'n8n-nodes-base.slack', 2.3, [3100, 240], {
      select: 'channel',
      channelId: { __rl: true, mode: 'name', value: `={{ ${S}.slackChannel.replace(/^#/, '') }}` },
      messageType: 'text',
      text: "={{ $('Classify and deduplicate').first().json.digest.text }}",
      otherOptions: { includeLinkToWorkflow: false },
    }, { notes: 'Select your Slack credential. If sending fails the run stops with an error and nothing is saved, so the next run alerts again.' }),
    node('Email enabled?', 'n8n-nodes-base.if', 2.2, [3340, 440], ifTrue('Email enabled?', `={{ ${S}.emailEnabled }}`)),
    node('Send email', 'n8n-nodes-base.emailSend', 2.1, [3580, 340], {
      html: "={{ $('Classify and deduplicate').first().json.digest.html }}",
      options: {},
      subject: "={{ $('Classify and deduplicate').first().json.digest.subject }}",
      toEmail: `={{ ${S}.emailTo }}`,
      fromEmail: `={{ ${S}.emailFrom }}`,
      emailFormat: 'html',
    }, { notes: 'Select your SMTP credential (any provider). If sending fails the run stops and nothing is saved.' }),
    node('Plan state writes', 'n8n-nodes-base.code', 2, [3820, 440], {
      jsCode: `${lib}\n\nconst settings = $('Settings').first().json;\nconst live = settings.useMockData !== true && (settings.slackEnabled === true || settings.emailEnabled === true);\nif (!live) return [];\nconst d = $('Classify and deduplicate').first().json;\nreturn planWrites(d.result, d.digest.send, Date.now()).map((json) => ({ json }));`,
    }, { notes: 'Only in live mode, and only after the notification went out (or when there was nothing to send): remembers sent alerts and failure streaks.' }),
    node('Save state', 'n8n-nodes-base.dataTable', 1.1, [4060, 440], {
      columns: {
        value: Object.fromEntries(COLS.map((c) => [c, `={{ $json.${c} }}`])),
        mappingMode: 'defineBelow',
        matchingColumns: [],
        schema: COLS.map((id) => ({ id, type: 'string', display: true, removed: false, readOnly: false, required: false, displayName: id, defaultMatch: false })),
      },
      options: {},
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: "={{ $('Ensure state table').first().json.id }}" },
    }),
    node('Overview', 'n8n-nodes-base.stickyNote', 1, [-380, -460], { content: OVERVIEW, height: 700, width: 900, color: 4 }),
    node('Cost', 'n8n-nodes-base.stickyNote', 1, [560, -460], { content: COST, height: 330, width: 620, color: 6 }),
    node('Limits', 'n8n-nodes-base.stickyNote', 1, [1200, -460], { content: LIMITS, height: 450, width: 640, color: 3 }),
    node('Section: settings and state', 'n8n-nodes-base.stickyNote', 1, [-380, 240], { content: '## Settings, state and plan\nEvery editable value is in **Settings**. A small data table remembers alerts you were already told about and failure streaks. *Plan run* validates the list and applies the budget guard before anything is spent.', height: 190, width: 1260, color: 7 }),
    node('Section: run Actors', 'n8n-nodes-base.stickyNote', 1, [980, 100], { content: '## Run the Actors (or free test data)\nDNS & RDAP every run; technology changes only on techCheckWeekday. With useMockData = true nothing is called.', height: 160, width: 1160, color: 7 }),
    node('Section: classify and notify', 'n8n-nodes-base.stickyNote', 1, [2120, 640], { content: '## Classify, deduplicate, notify\nOne digest, only when something needs attention. Slack and/or e-mail. Nothing is sent in test or preview mode.', height: 160, width: 1400, color: 7 }),
    node('Section: record', 'n8n-nodes-base.stickyNote', 1, [3780, 640], { content: '## Record\nSaved only after delivery, so a failed send is retried by the next run.', height: 140, width: 520, color: 7 }),
  ];
  const to = (name) => [{ node: name, type: 'main', index: 0 }];
  const connections = {
    'Run now': { main: [to('Settings')] },
    'Every day 07:00 (enable after a test run)': { main: [to('Settings')] },
    Settings: { main: [to('Ensure state table')] },
    'Ensure state table': { main: [to('Get state rows')] },
    'Get state rows': { main: [to('Plan run')] },
    'Plan run': { main: [to('Anything to run?')] },
    'Anything to run?': { main: [to('Use mock data? (DNS)'), to('Nothing to run (see reason)')] },
    'Use mock data? (DNS)': { main: [to('Mock DNS output (test data, free)'), to('Run DNS & RDAP Change Feed')] },
    'Mock DNS output (test data, free)': { main: [to('Technology check today?')] },
    'Run DNS & RDAP Change Feed': { main: [to('Technology check today?')] },
    'Technology check today?': { main: [to('Use mock data? (technology)'), to('Classify and deduplicate')] },
    'Use mock data? (technology)': { main: [to('Mock technology output (test data, free)'), to('Run Tech Stack Change Monitor')] },
    'Mock technology output (test data, free)': { main: [to('Classify and deduplicate')] },
    'Run Tech Stack Change Monitor': { main: [to('Classify and deduplicate')] },
    'Classify and deduplicate': { main: [to('Anything to send?')] },
    'Anything to send?': { main: [to('Live mode? (not test data, a channel is on)'), to('Plan state writes')] },
    'Live mode? (not test data, a channel is on)': { main: [to('Slack enabled?'), to('Preview only (nothing sent, nothing saved)')] },
    'Slack enabled?': { main: [to('Send to Slack'), to('Email enabled?')] },
    'Send to Slack': { main: [to('Email enabled?')] },
    'Email enabled?': { main: [to('Send email'), to('Plan state writes')] },
    'Send email': { main: [to('Plan state writes')] },
    'Plan state writes': { main: [to('Save state')] },
  };
  return {
    name: 'Monitor client websites for DNS, domain expiry and technology changes (Apify)',
    nodes,
    connections,
    active: false,
    settings: { executionOrder: 'v1' },
    pinData: {},
    meta: { templateCredsSetupCompleted: false },
    tags: [],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const json = `${JSON.stringify(buildWorkflow(), null, 2)}\n`;
  const target = here('./workflow.json');
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(target, 'utf8'); } catch { /* missing */ }
    if (current !== json) { console.error('workflow.json is out of date: run node build.mjs'); process.exit(1); }
    console.log('workflow.json is up to date');
  } else {
    writeFileSync(target, json);
    console.log('wrote workflow.json');
  }
}
