// Runs one preset: estimate -> (dry run with sample data | Actor run with a spend cap) -> rows + summary.
import { loadSample, mergeInput } from './catalog.js';
import { actualCost, estimateCost, formatEstimate } from './cost.js';
import { splitRows } from './csv.js';

export async function defaultClientFactory(token) {
  const { ApifyClient } = await import('apify-client');
  return new ApifyClient({ token });
}

/** Reads every item of a dataset in pages (clean items only). */
export async function fetchAllItems(datasetClient, pageSize = 1000) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await datasetClient.listItems({ offset, limit: pageSize, clean: true });
    out.push(...page.items);
    if (page.items.length < pageSize || out.length >= (page.total ?? Infinity)) return out;
  }
}

/**
 * @param {object} o
 * @param {object} o.preset         preset object (presets/*.json)
 * @param {object} o.catalog        catalog.json
 * @param {object} [o.overrides]    input keys that replace the preset's
 * @param {boolean} [o.dryRun]      never contact Apify; use the redacted sample rows
 * @param {boolean} [o.confirmed]   must be true for a real (paid) run
 * @param {string} [o.token]        APIFY_TOKEN
 * @param {number} [o.maxCostUsd]   spend cap for the run; defaults to the estimate
 * @param {Function} [o.clientFactory] (token) => ApifyClient-like object (injected in tests)
 * @param {Function} [o.log]
 */
export async function runRecipe({
  preset, catalog, overrides = {}, dryRun = false, confirmed = false, token, maxCostUsd,
  clientFactory = defaultClientFactory, log = console.error,
}) {
  const actor = catalog.actors[preset.actor];
  if (!actor) throw new Error(`Preset "${preset.id}" uses unknown Actor "${preset.actor}".`);
  const input = mergeInput(preset.input, overrides);
  const estimate = estimateCost(preset.actor, input, catalog);
  if (maxCostUsd != null && !(Number.isFinite(maxCostUsd) && maxCostUsd > 0)) throw new Error('--max-cost must be a positive number.');
  const cap = maxCostUsd ?? estimate.maxTotalUsd;
  log(formatEstimate(estimate, maxCostUsd));

  if (dryRun) {
    const sample = loadSample(preset.actor);
    log('Dry run: Apify was not contacted. Rows below are redacted real sample rows, not results for your filters.');
    return { dryRun: true, input, estimate, ...splitRows(sample.rows), run: null, chargedUsd: 0 };
  }
  if (!token) throw new Error('APIFY_TOKEN is not set. Use --dry-run to try the recipe without an Apify account.');
  if (!confirmed) {
    throw new Error(`Not started: this run can cost up to $${cap}. Re-run with --yes to start it, or --dry-run to preview.`);
  }
  if (estimate.items === 0) throw new Error('Nothing to do: the input has no websites.');

  const client = await clientFactory(token);
  log(`Starting ${actor.actorId} ...`);
  const run = await client.actor(actor.actorId).call(input, { maxTotalChargeUsd: cap, memory: estimate.memoryMb });
  if (!run) throw new Error('The Actor run did not return run details.');
  const items = await fetchAllItems(client.dataset(run.defaultDatasetId));
  const chargedUsd = actualCost(run.chargedEventCounts, preset.actor, catalog);
  log(`Run ${run.id} finished with status ${run.status}; ${items.length} dataset item(s).`);
  if (run.status !== 'SUCCEEDED') {
    log('The run did not succeed. Rows stored before the failure are still written; see the summary row and the run log in Apify Console.');
  }
  return { dryRun: false, input, estimate, ...splitRows(items), run, chargedUsd };
}
