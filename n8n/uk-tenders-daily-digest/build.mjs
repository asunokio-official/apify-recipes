// Generates workflow.json from src/logic.js and the redacted sample rows.
// Usage: node build.mjs          (write workflow.json)
//        node build.mjs --check  (exit 1 if workflow.json is out of date)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const lib = readFileSync(here('./src/logic.js'), 'utf8').replace(/\nexport \{[^}]*\};\s*$/, '\n').trim();
const sample = JSON.parse(readFileSync(here('../../samples/uk-public-tenders-feed.json'), 'utf8'));

export const ACTOR_ID = 'a2lVfWUOdjJjU9DwO'; // asunoki/uk-public-tenders-feed (public Store id)

let seq = 0;
const node = (name, type, typeVersion, position, parameters, extra = {}) => {
  seq += 1;
  const id = `ukt-${String(seq).padStart(3, '0')}-${createHash('sha1').update(name).digest('hex').slice(0, 8)}`;
  return { parameters, id, name, type, typeVersion, position, ...extra };
};
const assign = (name, value, type) => ({ id: `ukt-set-${createHash('sha1').update(name).digest('hex').slice(0, 8)}`, name, value, type });
const ifTrue = (name, expr) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: `ukt-if-${createHash('sha1').update(name).digest('hex').slice(0, 8)}`, leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  },
  options: {},
});

const OVERVIEW = `### UK public tenders: daily digest
Runs the **UK Public Tenders Feed** Actor (asunoki/uk-public-tenders-feed on Apify) every weekday morning and posts the **new** notices for your CPV codes, regions and minimum value to Slack. Find a Tender + Contracts Finder, official APIs, Open Government Licence v3.0.

**Setup**
1. Install the Apify community node (@apify/n8n-nodes-apify) and create an **Apify API** credential; select it on *Run UK Public Tenders Feed*.
2. Edit **Settings** (CPV codes, regions, min value, days, maxItems).
3. Free test first: keep useMockData = true, click *Run now*, read the output of *Build digest*. No Apify call, nothing sent.
4. Set useMockData = false, run once. Then set slackEnabled = true, select a Slack credential on *Send to Slack*, and enable the schedule.

Only new notices are returned on each run (the Actor remembers what it returned for the same filters).`;

const COST = `### Cost
Pay per event: **$0.004 per new notice stored** + $0.00005 run start. Filtered-out and already-seen notices are free.
- maxItems 100 = at most about $0.40 a run.
- A niche (one CPV group + region) is typically 0 to 20 new notices a day: under $0.10 a day.
- All UK open opportunities: about 85 a working day, about $0.35 a day.
The spend cap (maxTotalChargeUsd) is sent with every run; 0 in Settings means "use the maxItems estimate".`;

export function buildWorkflow() {
  seq = 0;
  const nodes = [
    node('Run now', 'n8n-nodes-base.manualTrigger', 1, [0, 300], {}),
    node('Weekdays 07:30 (enable after a test run)', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 480], {
      rule: { interval: [{ field: 'cronExpression', expression: '30 7 * * 1-5' }] },
    }, { disabled: true }),
    node('Settings', 'n8n-nodes-base.set', 3.4, [240, 380], {
      assignments: {
        assignments: [
          assign('digestTitle', 'New UK public tenders', 'string'),
          assign('noticeTypes', 'opportunity', 'string'),
          assign('cpvPrefixes', '72,48', 'string'),
          assign('regions', '', 'string'),
          assign('keywords', '', 'string'),
          assign('excludeKeywords', '', 'string'),
          assign('minValueGbp', 100000, 'number'),
          assign('days', 3, 'number'),
          assign('maxItems', 100, 'number'),
          assign('maxTotalChargeUsd', 0, 'number'),
          assign('maxLinesInDigest', 15, 'number'),
          assign('stateStoreName', '', 'string'),
          assign('useMockData', true, 'boolean'),
          assign('slackEnabled', false, 'boolean'),
          assign('slackChannel', '#tenders', 'string'),
        ],
      },
      options: {},
    }, { notes: 'Comma-separated lists. CPV: 72 IT services, 48 software, 45 construction, 79 business services, 85 health/social, 90 environmental. Regions: UKC..UKN (UKI London, UKM Scotland). maxTotalChargeUsd 0 = use the maxItems estimate.' }),
    node('Build Actor input', 'n8n-nodes-base.code', 2, [480, 380], {
      jsCode: `${lib}\n\nconst plan = buildActorInput($('Settings').first().json);\nreturn [{ json: plan }];`,
    }, { notes: 'Builds the Actor input from Settings and computes the cost estimate and spend cap.' }),
    node('Use mock data?', 'n8n-nodes-base.if', 2.2, [720, 380], ifTrue('Use mock data?', "={{ $('Settings').first().json.useMockData }}")),
    node('Mock Actor output (free, no Apify call)', 'n8n-nodes-base.code', 2, [960, 240], {
      jsCode: `// Redacted real rows from a local run on 2026-11-22 (award notices) plus the free summary row.\n// TEST DATA ONLY: used while useMockData is true. Contains public sector information licensed under the OGL v3.0.\nconst rows = ${JSON.stringify(sample.rows, null, 2)};\nreturn rows.map((json) => ({ json }));`,
    }),
    node('Run UK Public Tenders Feed', '@apify/n8n-nodes-apify.apify', 2, [960, 480], {
      authentication: 'apifyApi',
      resource: 'Actors',
      operation: 'Run actor and get dataset',
      actorSource: 'store',
      actorId: { __rl: true, mode: 'id', value: ACTOR_ID },
      actorInputMode: 'json',
      customBody: '={{ JSON.stringify($json.actorInput) }}',
      timeout: 600,
      memory: 256,
      maxTotalChargeUsd: '={{ $json.maxTotalChargeUsd }}',
      build: '',
    }, { onError: 'continueRegularOutput', retryOnFail: false, notes: 'asunoki/uk-public-tenders-feed (pay per event, $0.004 per new notice). Select your Apify API credential. If the run fails, the error item continues to the digest so you are told.' }),
    node('Build digest', 'n8n-nodes-base.code', 2, [1200, 380], {
      jsCode: `${lib}\n\nconst items = $input.all().map((i) => i.json);\nconst digest = buildDigest(items, $('Settings').first().json, $('Build Actor input').first().json);\nreturn [{ json: digest }];`,
    }, { notes: 'Drops the free summary row, sorts by deadline, builds Slack text (digest.text) and HTML (digest.html).' }),
    node('Anything to send?', 'n8n-nodes-base.if', 2.2, [1440, 380], ifTrue('Anything to send?', '={{ $json.shouldSend }}')),
    node('Slack enabled?', 'n8n-nodes-base.if', 2.2, [1680, 280], ifTrue('Slack enabled?', "={{ $('Settings').first().json.slackEnabled }}")),
    node('Send to Slack', 'n8n-nodes-base.slack', 2.3, [1920, 180], {
      select: 'channel',
      channelId: { __rl: true, mode: 'name', value: "={{ $('Settings').first().json.slackChannel.replace(/^#/, '') }}" },
      messageType: 'text',
      text: "={{ $('Build digest').first().json.text }}",
      otherOptions: { includeLinkToWorkflow: false },
    }, { notes: 'Select your Slack credential. To e-mail instead, replace this node with Send Email and use digest.html.' }),
    node('Slack is off (read Build digest)', 'n8n-nodes-base.noOp', 1, [1920, 380], {}),
    node('Nothing new', 'n8n-nodes-base.noOp', 1, [1680, 500], {}),
    node('Overview', 'n8n-nodes-base.stickyNote', 1, [-20, -320], { content: OVERVIEW, height: 560, width: 700, color: 4 }),
    node('Cost', 'n8n-nodes-base.stickyNote', 1, [720, -320], { content: COST, height: 300, width: 520, color: 6 }),
  ];
  const to = (name) => [{ node: name, type: 'main', index: 0 }];
  const connections = {
    'Run now': { main: [to('Settings')] },
    'Weekdays 07:30 (enable after a test run)': { main: [to('Settings')] },
    Settings: { main: [to('Build Actor input')] },
    'Build Actor input': { main: [to('Use mock data?')] },
    'Use mock data?': { main: [to('Mock Actor output (free, no Apify call)'), to('Run UK Public Tenders Feed')] },
    'Mock Actor output (free, no Apify call)': { main: [to('Build digest')] },
    'Run UK Public Tenders Feed': { main: [to('Build digest')] },
    'Build digest': { main: [to('Anything to send?')] },
    'Anything to send?': { main: [to('Slack enabled?'), to('Nothing new')] },
    'Slack enabled?': { main: [to('Send to Slack'), to('Slack is off (read Build digest)')] },
  };
  return {
    name: 'UK public tenders: daily digest to Slack (Apify, Find a Tender + Contracts Finder)',
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
    if (current !== json) {
      console.error('workflow.json is out of date: run node build.mjs');
      process.exit(1);
    }
    console.log('workflow.json is up to date');
  } else {
    writeFileSync(target, json);
    console.log('wrote workflow.json');
  }
}
