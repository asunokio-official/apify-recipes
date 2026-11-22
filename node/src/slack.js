// Slack incoming-webhook digest. The webhook URL comes from the environment (SLACK_WEBHOOK_URL), never from a file.
import { getPath, toCell } from './csv.js';
import { usd } from './cost.js';

export function fillTemplate(template, row) {
  return template.replace(/\{([^}]+)\}/g, (_, path) => {
    const v = toCell(getPath(row, path.trim()));
    return v === '' ? 'n/a' : v;
  });
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildSlackMessage({ preset, actor, rows, estimate, chargedUsd, dryRun = false, maxLines = 10 }) {
  const head = `${dryRun ? '[dry run, sample data] ' : ''}*${esc(actor.title)}*: ${rows.length} new row(s) for "${esc(preset.title)}"`;
  const cost = chargedUsd != null ? `charged ${usd(chargedUsd)}` : `estimated max ${usd(estimate.maxTotalUsd)}`;
  const lines = rows.slice(0, maxLines).map((r) => {
    const text = esc(fillTemplate(actor.slackLine, r));
    const link = getPath(r, actor.linkField);
    return typeof link === 'string' && /^https?:\/\//.test(link) ? `• <${link}|${text}>` : `• ${text}`;
  });
  if (rows.length > maxLines) lines.push(`…and ${rows.length - maxLines} more in the CSV artifact.`);
  if (rows.length === 0) lines.push('No new rows this time.');
  return { text: [head, `(${cost})`, ...lines].join('\n') };
}

export async function postSlack(webhookUrl, payload, fetchImpl = globalThis.fetch) {
  if (!/^https:\/\/hooks\.slack\.com\//.test(String(webhookUrl))) {
    throw new Error('SLACK_WEBHOOK_URL must be a Slack incoming-webhook URL (https://hooks.slack.com/...).');
  }
  const res = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Slack webhook returned HTTP ${res.status}.`);
}
