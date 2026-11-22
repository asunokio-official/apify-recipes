import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, loadPreset } from '../src/catalog.js';
import { fetchAllItems, runRecipe } from '../src/run.js';

const catalog = loadCatalog();
const quiet = () => {};

/** Minimal stand-in for apify-client's ApifyClient. Records calls; never touches the network. */
function mockClient({ items = [], status = 'SUCCEEDED', charged = { notice: 2, 'apify-actor-start': 1 } } = {}) {
  const calls = { actor: [], call: [], dataset: [], listItems: [] };
  const client = {
    actor(id) {
      calls.actor.push(id);
      return {
        async call(input, options) {
          calls.call.push({ input, options });
          return { id: 'RUN1', status, defaultDatasetId: 'DS1', chargedEventCounts: charged };
        },
      };
    },
    dataset(id) {
      calls.dataset.push(id);
      return {
        async listItems(opts) {
          calls.listItems.push(opts);
          return { items: items.slice(opts.offset, opts.offset + opts.limit), total: items.length };
        },
      };
    },
  };
  return { client, calls };
}

test('real run: passes merged input, spend cap and memory; returns rows and summary', async () => {
  const items = [{ type: 'notice', title: 'A' }, { type: 'notice', title: 'B' }, { type: 'summary', charged: 2 }];
  const { client, calls } = mockClient({ items });
  const preset = loadPreset('uk-it-tenders-100k-weekly');
  const r = await runRecipe({
    preset, catalog, overrides: { regions: ['UKM'] }, token: 'test-token-not-real', confirmed: true, log: quiet,
    clientFactory: async (token) => { assert.equal(token, 'test-token-not-real'); return client; },
  });
  assert.deepEqual(calls.actor, ['asunoki/uk-public-tenders-feed']);
  assert.deepEqual(calls.call[0].input.regions, ['UKM']);
  assert.deepEqual(calls.call[0].input.cpvPrefixes, ['72', '48']);
  assert.equal(calls.call[0].options.maxTotalChargeUsd, 1.20005);
  assert.equal(calls.call[0].options.memory, 256);
  assert.equal(r.rows.length, 2);
  assert.equal(r.summary.charged, 2);
  assert.equal(r.chargedUsd, 0.00805);
  assert.equal(r.dryRun, false);
});

test('--max-cost overrides the cap passed to the run', async () => {
  const { client, calls } = mockClient();
  await runRecipe({ preset: loadPreset('austin-solar-roof-permits'), catalog, token: 't', confirmed: true, maxCostUsd: 0.25, log: quiet, clientFactory: async () => client });
  assert.equal(calls.call[0].options.maxTotalChargeUsd, 0.25);
});

test('dry run never creates a client and returns redacted sample rows', async () => {
  let created = false;
  const r = await runRecipe({ preset: loadPreset('tx-dental-new-npis-weekly'), catalog, dryRun: true, token: 'x', log: quiet, clientFactory: async () => { created = true; } });
  assert.equal(created, false);
  assert.equal(r.dryRun, true);
  assert.ok(r.rows.length > 0);
  assert.ok(r.rows.every((row) => row.type === 'provider'));
  assert.ok(r.summary);
});

test('refuses to run without a token or without --yes', async () => {
  const preset = loadPreset('uk-it-tenders-100k-weekly');
  await assert.rejects(runRecipe({ preset, catalog, log: quiet, clientFactory: async () => assert.fail('no client') }), /APIFY_TOKEN is not set/);
  await assert.rejects(runRecipe({ preset, catalog, token: 't', log: quiet, clientFactory: async () => assert.fail('no client') }), /--yes/);
});

test('rejects a non-positive --max-cost', async () => {
  await assert.rejects(runRecipe({ preset: loadPreset('uk-it-tenders-100k-weekly'), catalog, dryRun: true, maxCostUsd: 0, log: quiet }), /positive/);
});

test('Tech Stack Detector run with no websites is refused before calling Apify', async () => {
  await assert.rejects(runRecipe({ preset: loadPreset('tsd-shopify-prospect-check'), catalog, overrides: { urls: [] }, token: 't', confirmed: true, log: quiet, clientFactory: async () => assert.fail('no client') }), /no websites/);
});

test('failed run still returns stored rows', async () => {
  const { client } = mockClient({ items: [{ type: 'permit', permitId: 'x' }], status: 'FAILED' });
  const logs = [];
  const r = await runRecipe({ preset: loadPreset('sf-adu-permits'), catalog, token: 't', confirmed: true, log: (m) => logs.push(m), clientFactory: async () => client });
  assert.equal(r.run.status, 'FAILED');
  assert.equal(r.rows.length, 1);
  assert.ok(logs.some((l) => /did not succeed/.test(l)));
});

test('fetchAllItems pages through large datasets', async () => {
  const items = Array.from({ length: 2500 }, (_, i) => ({ i }));
  const { client, calls } = mockClient({ items });
  const got = await fetchAllItems(client.dataset('DS'), 1000);
  assert.equal(got.length, 2500);
  assert.deepEqual(calls.listItems.map((c) => c.offset), [0, 1000, 2000]);
  assert.ok(calls.listItems.every((c) => c.clean === true));
});
