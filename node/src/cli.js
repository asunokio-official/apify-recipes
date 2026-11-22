#!/usr/bin/env node
// Usage:
//   node src/cli.js list
//   node src/cli.js show <preset>
//   node src/cli.js run <preset> [--dry-run] [--yes] [--out file.csv] [--json file.json] [--bom]
//                                [--all-columns] [--max-cost USD] [--input '{"states":["CA"]}']
//                                [--urls-file domains.txt] [--slack]
//   node src/cli.js diff <old.json> <new.json> [--out changes.csv]   technologies added/removed per site between two tech-stack-detector results (offline)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listPresets, loadCatalog, loadPreset, parseUrlList } from './catalog.js';
import { estimateCost, formatEstimate, usd } from './cost.js';
import { allColumns, toCsv } from './csv.js';
import { runRecipe } from './run.js';
import { diffCsv, diffTech, rowsOf } from './diff.js';
import { buildSlackMessage, postSlack } from './slack.js';

const FLAGS = new Set(['--dry-run', '--yes', '--bom', '--all-columns', '--slack', '--help']);
const OPTIONS = new Set(['--out', '--json', '--max-cost', '--input', '--urls-file']);

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (FLAGS.has(a)) args[a.slice(2)] = true;
    else if (OPTIONS.has(a)) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value.`);
      args[a.slice(2)] = argv[(i += 1)];
    } else if (a.startsWith('--')) throw new Error(`Unknown option ${a}.`);
    else args._.push(a);
  }
  return args;
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export async function main(argv, env = process.env, deps = {}) {
  const log = deps.log ?? console.error;
  const out = deps.out ?? console.log;
  const args = parseArgs(argv);
  const [cmd, presetId] = args._;
  const catalog = loadCatalog();

  if (!cmd || args.help) {
    out(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 7).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  if (cmd === 'diff') {
    const [, oldFile, newFile] = args._;
    if (!oldFile || !newFile) throw new Error('diff needs two files: diff <old.json> <new.json>.');
    const changes = diffTech(JSON.parse(readFileSync(oldFile, 'utf8')), JSON.parse(readFileSync(newFile, 'utf8')));
    const compared = rowsOf(JSON.parse(readFileSync(newFile, 'utf8'))).length;
    for (const c of changes) out(`${c.site.padEnd(34)} ${c.change.padEnd(14)} ${c.added.length ? '+ ' + c.added.join(', ') : ''} ${c.removed.length ? '- ' + c.removed.join(', ') : ''} ${c.note}`.trimEnd());
    out(`${changes.length} of ${compared} sites differ.`);
    if (args.out) writeFile(args.out, diffCsv(changes));
    return 0;
  }
  if (cmd === 'list') {
    for (const p of listPresets()) {
      const est = estimateCost(p.actor, p.input, catalog);
      out(`${p.id.padEnd(36)} ${p.actor.padEnd(26)} max ${usd(est.maxTotalUsd).padEnd(8)} ${p.title}`);
    }
    return 0;
  }
  if (!presetId) throw new Error(`"${cmd}" needs a preset id. Run "list" to see them.`);
  const preset = loadPreset(presetId);
  const overrides = args.input ? JSON.parse(args.input) : {};
  if (args['urls-file']) overrides.urls = parseUrlList(readFileSync(args['urls-file'], 'utf8'));

  if (cmd === 'show') {
    out(JSON.stringify({ ...preset, input: { ...preset.input, ...overrides } }, null, 2));
    out(formatEstimate(estimateCost(preset.actor, { ...preset.input, ...overrides }, catalog)));
    return 0;
  }
  if (cmd !== 'run') throw new Error(`Unknown command "${cmd}". Use list, show or run.`);

  const maxCostUsd = args['max-cost'] != null ? Number(args['max-cost']) : undefined;
  const result = await runRecipe({
    preset, catalog, overrides, maxCostUsd, log,
    dryRun: Boolean(args['dry-run']),
    confirmed: Boolean(args.yes),
    token: env.APIFY_TOKEN,
    clientFactory: deps.clientFactory,
  });
  const actor = catalog.actors[preset.actor];
  const columns = args['all-columns'] ? allColumns(result.rows) : actor.columns;
  const csv = toCsv(result.rows, columns, { bom: Boolean(args.bom) });
  if (args.out) {
    writeFile(args.out, csv);
    log(`Wrote ${result.rows.length} row(s) to ${args.out}`);
  } else {
    out(csv);
  }
  if (args.json) writeFile(args.json, `${JSON.stringify({ preset: preset.id, dryRun: result.dryRun, input: result.input, estimate: result.estimate, chargedUsd: result.chargedUsd, runId: result.run?.id ?? null, summary: result.summary, rows: result.rows }, null, 2)}\n`);
  if (result.summary) log(`Summary row: ${JSON.stringify(result.summary).slice(0, 400)}`);
  if (result.chargedUsd != null && !result.dryRun) log(`Charged (from run events): ${usd(result.chargedUsd)}`);

  if (args.slack) {
    if (!env.SLACK_WEBHOOK_URL) throw new Error('--slack needs the SLACK_WEBHOOK_URL environment variable.');
    const msg = buildSlackMessage({ preset, actor, rows: result.rows, estimate: result.estimate, chargedUsd: result.dryRun ? null : result.chargedUsd, dryRun: result.dryRun });
    await postSlack(env.SLACK_WEBHOOK_URL, msg, deps.fetch);
    log('Posted the digest to Slack.');
  }
  return result.run && result.run.status !== 'SUCCEEDED' ? 2 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (err) => { console.error(`Error: ${err.message}`); process.exitCode = 1; },
  );
}
