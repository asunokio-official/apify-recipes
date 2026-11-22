import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../src/catalog.js';
import { actualCost, estimateCost, formatEstimate, normalizeSite, usd } from '../src/cost.js';

const catalog = loadCatalog();

test('maxItems actors: estimate = maxItems x price + start fee', () => {
  const e = estimateCost('uk-public-tenders-feed', { maxItems: 300 }, catalog);
  assert.equal(e.items, 300);
  assert.equal(e.unitPriceUsd, 0.004);
  assert.equal(e.itemsCostUsd, 1.2);
  assert.equal(e.startFeeUsd, 0.00005);
  assert.equal(e.maxTotalUsd, 1.20005);
  assert.equal(e.event, 'notice');
});

test('missing maxItems falls back to the Actor default', () => {
  assert.equal(estimateCost('nppes-new-providers-feed', {}, catalog).items, 500);
  assert.equal(estimateCost('us-building-permits-feed', {}, catalog).maxTotalUsd, 0.40005);
});

test('prices match the published PPE prices', () => {
  assert.equal(catalog.actors['nppes-new-providers-feed'].priceUsd, 0.002);
  assert.equal(catalog.actors['us-building-permits-feed'].priceUsd, 0.002);
  assert.equal(catalog.actors['uk-public-tenders-feed'].priceUsd, 0.004);
  assert.equal(catalog.actors['tech-stack-detector'].priceUsd, 0.005);
});

test('Tech Stack Detector counts unique sites, not maxItems', () => {
  const e = estimateCost('tech-stack-detector', { urls: ['https://www.Example.com/', 'example.com', 'shop.example.com', ' '] }, catalog);
  assert.equal(e.items, 2);
  assert.equal(e.maxTotalUsd, 0.01005);
});

test('browser options use the full-scan price and 2 GB start fee as the upper bound', () => {
  const e = estimateCost('tech-stack-detector', { urls: ['a.com', 'b.com'], browserFallback: true }, catalog);
  assert.equal(e.unitPriceUsd, 0.015);
  assert.equal(e.event, 'full-scan');
  assert.equal(e.startFeeUsd, 0.0001);
  assert.equal(e.maxTotalUsd, 0.0301);
});

test('usd formats small prices without rounding them away', () => {
  assert.deepEqual([0.015, 0.005, 0.40005, 0.6, 1.20005, 0].map(usd), ['$0.015', '$0.005', '$0.40005', '$0.60', '$1.20', '$0.00']);
});

test('normalizeSite strips scheme, www, query and trailing slash', () => {
  assert.equal(normalizeSite('HTTPS://www.Shop.com/path/?a=1'), 'shop.com/path');
});

test('formatEstimate warns when the cap is below the estimate', () => {
  const e = estimateCost('uk-public-tenders-feed', { maxItems: 100 }, catalog);
  assert.match(formatEstimate(e), /Estimate \(max\): \$0\.40/);
  assert.match(formatEstimate(e, 0.1), /may stop early/);
});

test('actualCost prices charged events', () => {
  assert.equal(actualCost({ notice: 12, 'apify-actor-start': 1 }, 'uk-public-tenders-feed', catalog), 0.04805);
  assert.equal(actualCost({ 'basic-scan': 3, 'full-scan': 1 }, 'tech-stack-detector', catalog), 0.03);
  assert.equal(actualCost(undefined, 'tech-stack-detector', catalog), null);
});

test('unknown Actor is rejected', () => {
  assert.throws(() => estimateCost('nope', {}, catalog), /Unknown Actor/);
});
