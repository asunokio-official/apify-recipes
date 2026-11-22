// Upper-bound cost estimate for a run, from the Actor's pay-per-event prices in catalog.json.
// Nothing here calls Apify. Prices can change: check the Pricing tab of each Actor before large runs.

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** Normalises a domain/URL the way the Actor dedupes them (scheme, www and trailing slash ignored). */
export function normalizeSite(u) {
  return String(u)
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

export function estimateCost(actorKey, input, catalog) {
  const actor = catalog.actors[actorKey];
  if (!actor) throw new Error(`Unknown Actor "${actorKey}" in catalog.json.`);
  let items;
  let unitPriceUsd = actor.priceUsd;
  let event = actor.event;
  let memoryMb = actor.memoryMb;
  let basis;
  if (actor.countFrom === 'urls') {
    const urls = Array.isArray(input.urls) ? input.urls : [];
    items = new Set(urls.map(normalizeSite).filter(Boolean)).size;
    if (input.alwaysUseBrowser || input.browserFallback) {
      // Upper bound: every site could be rendered in the browser and billed as a full scan.
      unitPriceUsd = actor.browserPriceUsd;
      event = actor.browserEvent;
      memoryMb = actor.browserMemoryMb;
    }
    basis = `${items} unique website(s); blocked, robots-skipped and failed sites are free`;
  } else {
    items = Number.isInteger(input.maxItems) ? input.maxItems : actor.defaultMaxItems;
    basis = `maxItems cap of ${items}; filtered-out and already-seen rows are free, so most runs cost less`;
  }
  const gb = Math.max(1, Math.ceil(memoryMb / 1024));
  const startFeeUsd = round6(catalog.startFeeUsdPerGb * gb);
  const itemsCostUsd = round6(items * unitPriceUsd);
  return {
    actorKey,
    actorId: actor.actorId,
    event,
    unit: actor.unit,
    unitPriceUsd,
    items,
    itemsCostUsd,
    startFeeUsd,
    maxTotalUsd: round6(itemsCostUsd + startFeeUsd),
    memoryMb,
    basis,
  };
}

/** $1.20 for amounts of a dollar or more; up to 5 decimals below that ($0.005, $0.40005, $0.60). */
export function usd(n) {
  const v = Number(n);
  if (Math.abs(v) >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(5).replace(/0{1,3}$/, '')}`;
}

export function formatEstimate(est, maxCostUsd) {
  const cap = maxCostUsd ?? est.maxTotalUsd;
  const lines = [
    `Actor:          ${est.actorId}`,
    `Price:          ${usd(est.unitPriceUsd)} per ${est.unit} (event "${est.event}") + ${usd(est.startFeeUsd)} start fee`,
    `Estimate (max): ${usd(est.maxTotalUsd)}  (${est.items} x ${usd(est.unitPriceUsd)} + start fee; ${est.basis})`,
    `Run spend cap:  ${usd(cap)} (maxTotalChargeUsd; the Actor stops storing before it would exceed it)`,
  ];
  if (maxCostUsd != null && maxCostUsd < est.maxTotalUsd) {
    lines.push('Note: the cap is below the estimate, so the run may stop early. Rows it did not store stay "new" for the next run.');
  }
  return lines.join('\n');
}

/** Actual charge from a finished run's chargedEventCounts (e.g. { notice: 12, "apify-actor-start": 1 }). */
export function actualCost(chargedEventCounts, actorKey, catalog) {
  if (!chargedEventCounts || typeof chargedEventCounts !== 'object') return null;
  const actor = catalog.actors[actorKey];
  const prices = { [actor.event]: actor.priceUsd, 'apify-actor-start': catalog.startFeeUsdPerGb };
  if (actor.browserEvent) prices[actor.browserEvent] = actor.browserPriceUsd;
  let total = 0;
  for (const [event, count] of Object.entries(chargedEventCounts)) {
    if (prices[event] != null) total += prices[event] * Number(count || 0);
  }
  return round6(total);
}
