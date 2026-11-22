// Code-node logic for the "UK tenders daily digest" n8n workflow.
// build.mjs inlines these functions into the Code nodes, so the unit-tested code is the code in workflow.json.
// Keep this file free of imports: n8n Code nodes run it as plain JavaScript.

const NOTICE_PRICE_USD = 0.004; // asunoki/uk-public-tenders-feed, event "notice" (check the Actor's Pricing tab)
const START_FEE_USD = 0.00005; // Apify run-start event at 256 MB

function splitList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value ?? '').split(',').map((v) => v.trim()).filter(Boolean);
}

function toInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || String(value ?? '').trim() === '') return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Settings node -> Actor input, cost estimate and spend cap. */
function buildActorInput(s) {
  const types = splitList(s.noticeTypes);
  const input = {
    noticeTypes: types.length ? types : ['opportunity'],
    cpvPrefixes: splitList(s.cpvPrefixes),
    keywords: splitList(s.keywords),
    excludeKeywords: splitList(s.excludeKeywords),
    regions: splitList(s.regions).map((r) => r.toUpperCase()),
    days: toInt(s.days, 3, 1, 30),
    onlyNew: true,
    openOnly: true,
    maxItems: toInt(s.maxItems, 100, 1, 10000),
  };
  for (const t of input.noticeTypes) {
    if (!['opportunity', 'planning', 'award', 'update'].includes(t)) throw new Error(`Notice type "${t}" must be opportunity, planning, award or update.`);
  }
  for (const c of input.cpvPrefixes) {
    if (!/^\d{2,8}$/.test(c)) throw new Error(`CPV prefix "${c}" must be 2 to 8 digits.`);
  }
  if (Number(s.minValueGbp) > 0) input.minValueGbp = Math.round(Number(s.minValueGbp));
  if (s.stateStoreName) input.stateStoreName = String(s.stateStoreName);
  for (const k of ['cpvPrefixes', 'keywords', 'excludeKeywords', 'regions']) if (!input[k].length) delete input[k];
  const estimateUsd = Math.round((input.maxItems * NOTICE_PRICE_USD + START_FEE_USD) * 1e6) / 1e6;
  const cap = Number(s.maxTotalChargeUsd) > 0 ? Number(s.maxTotalChargeUsd) : estimateUsd;
  return {
    actorInput: input,
    maxTotalChargeUsd: cap,
    estimateUsd,
    estimateText: `Max cost of this run: $${estimateUsd.toFixed(2)} (${input.maxItems} notices x $${NOTICE_PRICE_USD} + start fee); spend cap $${cap.toFixed(2)}. Filtered-out and already-seen notices are free.`,
  };
}

function esc(t) {
  return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function money(n, cur) {
  if (n == null || n === '') return 'value not published';
  return `${cur || 'GBP'} ${Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function day(iso) {
  return iso ? String(iso).slice(0, 10) : 'n/a';
}

/** Actor dataset items (plus an error item if the run failed) -> Slack text and HTML digest. */
function buildDigest(items, settings, plan) {
  const error = items.find((i) => i && i.error);
  const notices = items.filter((i) => i && i.type === 'notice');
  const summaries = items.filter((i) => i && i.type === 'summary');
  const summary = summaries.length ? summaries[summaries.length - 1] : null;
  notices.sort((a, b) => String(a.submissionDeadline || '9999').localeCompare(String(b.submissionDeadline || '9999')));
  const maxLines = toInt(settings.maxLinesInDigest, 15, 1, 100);
  const title = settings.digestTitle || 'New UK public tenders';
  const charged = summary && Number.isFinite(summary.charged) ? summary.charged : notices.length;
  const costLine = `Cost: ${charged} notice(s) charged x $${NOTICE_PRICE_USD}, about $${(charged * NOTICE_PRICE_USD + START_FEE_USD).toFixed(3)} with the start fee`;

  const lines = notices.slice(0, maxLines).map((n) => `• <${n.noticeUrl}|${esc(n.title)}>\n   ${esc(n.buyerName)} | ${money(n.estimatedValue, n.currency)} | deadline ${day(n.submissionDeadline)} | CPV ${n.mainCpv || 'n/a'}`);
  if (notices.length > maxLines) lines.push(`…and ${notices.length - maxLines} more in the Apify dataset.`);
  const errText = error ? (error.error && error.error.message) || error.message || String(error.error) : '';
  const parts = [`*${esc(title)}*: ${notices.length} new notice(s)`];
  if (error) parts.push(`:warning: The Actor run failed: ${esc(errText)}`);
  if (summary && summary.moreAvailable) parts.push('More notices matched than maxItems allowed; they stay new for the next run.');
  parts.push(...lines);
  parts.push(`_${costLine}._`);

  const rows = notices.slice(0, maxLines).map((n) => `<tr><td><a href="${esc(n.noticeUrl)}">${esc(n.title)}</a></td><td>${esc(n.buyerName)}</td><td>${esc(money(n.estimatedValue, n.currency))}</td><td>${esc(day(n.submissionDeadline))}</td></tr>`).join('');
  return {
    count: notices.length,
    failed: Boolean(error),
    shouldSend: notices.length > 0 || Boolean(error),
    text: parts.join('\n'),
    html: `<h3>${esc(title)}: ${notices.length} new notice(s)</h3>${error ? '<p><b>The Actor run failed.</b></p>' : ''}<table border="1" cellpadding="4" cellspacing="0"><tr><th>Notice</th><th>Buyer</th><th>Value</th><th>Deadline</th></tr>${rows}</table><p><small>${esc(costLine)}. ${plan ? esc(plan.estimateText) : ''} Contains public sector information licensed under the Open Government Licence v3.0.</small></p>`,
    summary,
  };
}

export { buildActorInput, buildDigest, splitList, toInt, money, NOTICE_PRICE_USD, START_FEE_USD };
