// Builds static demo pages (demo/index.html and demo/<actor>/index.html) from catalog.json, presets/ and the
// redacted real sample rows in samples/. No JavaScript, no external requests: the pages can be hosted anywhere.
// Usage: node scripts/build-demos.mjs [--check]
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const catalog = readJson('catalog.json');
const presets = readdirSync(join(ROOT, 'presets')).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(`presets/${f}`));

const PAGES = {
  'nppes-new-providers-feed': {
    job: 'Get the healthcare providers and organizations that received a new NPI last week, filtered by state, category or taxonomy code, delivered once.',
    columns: ['enumerationDate', 'entityType', 'name', 'credential', 'category', 'primaryTaxonomyCode', 'practiceCity', 'practiceState', 'practiceZip'],
    source: 'Data: CMS NPPES Downloadable Files (public, FOIA-disclosable; US government work). Not affiliated with CMS or HHS. No NUCC taxonomy descriptions included.',
  },
  'us-building-permits-feed': {
    job: 'Get newly issued building permits from San Francisco, Austin and New Orleans in one schema, filtered by keyword, value, ZIP and type, delivered once.',
    columns: ['issuedDate', 'city', 'permitType', 'workType', 'valueUsd', 'address', 'contractorCompany', 'description'],
    source: 'Data: DataSF (PDDL 1.0), City of Austin Open Data (public domain), City of New Orleans (CC0). Not affiliated with any city.',
  },
  'uk-public-tenders-feed': {
    job: 'Get new UK public-sector tenders and contract awards from Find a Tender and Contracts Finder, filtered by CPV code, region and value, delivered once.',
    columns: ['publishedAt', 'noticeType', 'title', 'buyerName', 'mainCpvDescription', 'estimatedValue', 'awardedValue', 'suppliers[].name', 'noticeUrl'],
    source: 'Contains public sector information licensed under the Open Government Licence v3.0. Not affiliated with the Cabinet Office or GOV.UK.',
  },
  'tech-stack-detector': {
    job: 'For a list of websites you already have: which e-commerce platform, CMS, theme, storefront apps, CDN and analytics each one runs, with the evidence for every detection.',
    columns: ['url', 'ecommercePlatform', 'ecommerce.shopifyTheme.name', 'ecommerce.currency.value', 'ecommerce.apps[].name', 'cms', 'cdn', 'analytics', 'tagManagers', 'technologyCount', 'technologies'],
    source: 'Public pages and public DNS only; no login, no personal data. Results of an HTTP scan on 11 Nov 2026; sites change.',
  },
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const utm = (url, campaign) => `${url}?utm_source=github&utm_medium=recipes&utm_campaign=${encodeURIComponent(campaign)}`;
const money = (n) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(5).replace(/0{1,3}$/, '')}`);

function get(row, path) {
  let cur = row;
  for (const part of path.split('.')) {
    if (cur == null) return null;
    if (part.endsWith('[]')) {
      const arr = cur[part.slice(0, -2)];
      return Array.isArray(arr) ? arr : null;
    }
    cur = cur[part];
  }
  return cur;
}

function cell(row, col) {
  if (col === 'suppliers[].name') return esc((row.suppliers || []).map((s) => s.name).join('; '));
  if (col === 'ecommerce.apps[].name') return esc((row.ecommerce?.apps || []).map((a) => a.name).join(', '));
  if (col === 'technologies') {
    const items = (row.technologies || []).slice(0, 4).map((t) => {
      const e = (t.evidence || [])[0];
      const proof = e ? `${e.method}${e.key ? ` ${e.key}` : ''}: ${String(e.value).slice(0, 70)}` : 'see full row';
      return `<li><b>${esc(t.name)}</b> (${esc(t.category)}, ${t.confidence}) <span class="ev">${esc(proof)}</span></li>`;
    });
    return items.length ? `<details><summary>${row.technologies.length} detections</summary><ul>${items.join('')}</ul></details>` : '';
  }
  const v = get(row, col);
  if (v == null || v === '') return '<span class="muted">null</span>';
  if (col === 'noticeUrl') return `<a href="${esc(v)}" rel="nofollow">notice</a>`;
  if (Array.isArray(v)) return esc(v.join(', '));
  if (col === 'description') return esc(String(v).slice(0, 140) + (String(v).length > 140 ? '…' : ''));
  if (typeof v === 'number' && /value/i.test(col)) return esc(v.toLocaleString('en-US'));
  if (/At$|Date$/.test(col)) return esc(String(v).slice(0, 10));
  return esc(v);
}

const CSS = `body{font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;color:#1d232b;background:#fafbfc}
main{max-width:1100px;margin:0 auto;padding:28px 20px 48px}h1{font-size:1.6rem;margin:.2em 0}h2{font-size:1.15rem;margin-top:2em}
a{color:#0b5cad}.lead{font-size:1.05rem;color:#333}.box{background:#fff;border:1px solid #dde2e8;border-radius:8px;padding:14px 18px;margin:14px 0}
.cta{display:inline-block;background:#0b5cad;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:600}
.scroll{overflow-x:auto;background:#fff;border:1px solid #dde2e8;border-radius:8px}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:7px 9px;border-bottom:1px solid #edf0f3;text-align:left;vertical-align:top}th{background:#f3f5f8;white-space:nowrap}
.muted{color:#98a1ad}.ev{color:#5b6573;font-size:12px}details ul{margin:.4em 0 0;padding-left:1.1em}code,pre{font:12.5px ui-monospace,Menlo,monospace}
pre{background:#f3f5f8;padding:10px;border-radius:6px;overflow-x:auto}.note{font-size:13px;color:#5b6573}nav a{margin-right:12px}
footer{margin-top:40px;font-size:12.5px;color:#5b6573}`;

const page = (title, body) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(title)}: real sample output, input presets and cost per run.">
<style>${CSS}</style>
</head>
<body><main>
${body}
<footer>Generated by scripts/build-demos.mjs in the asunoki-apify-recipes repository (MIT). Opening this page does not run anything and costs nothing. Apify is a trademark of Apify Technologies s.r.o.; this page is published by the Actor developer (ASUNOKI), not by Apify.</footer>
</main></body>
</html>
`;

function actorPage(key) {
  const a = catalog.actors[key];
  const p = PAGES[key];
  const sample = readJson(`samples/${key}.json`);
  const rows = sample.rows.filter((r) => r.type !== 'summary');
  const summary = sample.rows.find((r) => r.type === 'summary');
  const head = p.columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = rows.map((r) => `<tr>${p.columns.map((c) => `<td>${cell(r, c)}</td>`).join('')}</tr>`).join('\n');
  const mine = presets.filter((x) => x.actor === key);
  const presetHtml = mine.map((x) => {
    const n = a.countFrom === 'urls' ? new Set(x.input.urls || []).size : (x.input.maxItems ?? a.defaultMaxItems);
    const max = n * a.priceUsd + catalog.startFeeUsdPerGb;
    return `<div class="box"><b>${esc(x.title)}</b><br><span class="note">For: ${esc(x.who)} Schedule: ${esc(x.schedule)}. Max cost per run: ${money(max)}.</span>
<pre>${esc(JSON.stringify(x.input, null, 2))}</pre><span class="note">Run it: <code>node node/src/cli.js run ${esc(x.id)} --dry-run</code> (free preview), then with <code>APIFY_TOKEN</code> and <code>--yes</code>.</span></div>`;
  }).join('\n');
  const priceLine = a.browserPriceUsd
    ? `${money(a.priceUsd)} per ${esc(a.unit)} (HTTP scan), ${money(a.browserPriceUsd)} with the optional browser scan`
    : `${money(a.priceUsd)} per ${esc(a.unit)}`;
  return page(`${a.title}: sample output`, `<nav><a href="../index.html">All demos</a></nav>
<h1>${esc(a.title)}</h1>
<p class="lead">${esc(p.job)}</p>
<p><a class="cta" href="${esc(utm(a.storeUrl, `${key}-demo`))}">Open ${esc(a.actorId)} on Apify</a></p>
<div class="box"><b>Price (pay per event):</b> ${priceLine}, plus a $0.00005 run-start fee. ${a.countFrom === 'urls' ? 'Blocked, robots-skipped and failed websites are free.' : 'Rows you filter out or already received are free; maxItems caps every run.'} Prices checked ${esc(catalog.pricesCheckedOn)}; the Pricing tab on Apify is authoritative.</div>
<h2>Real sample output</h2>
<p class="note">${esc(sample.note)}</p>
<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>
${body}
</tbody></table></div>
${summary ? `<p class="note">Every run also writes one free summary row, e.g. scanned ${esc(summary.scanned)}, matched ${esc(summary.matched)}, charged ${esc(summary.charged)}, stopped by ${esc(summary.stoppedBy)}.</p>` : ''}
<h2>Honest limits</h2>
<ul>${a.limits.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
<h2>Ready-made inputs</h2>
${presetHtml}
<p class="note">${esc(p.source)}</p>`);
}

export function buildAll() {
  const files = {};
  for (const key of Object.keys(catalog.actors)) files[`demo/${key}/index.html`] = actorPage(key);
  const cards = Object.entries(catalog.actors).map(([key, a]) => `<div class="box"><h2 style="margin-top:0"><a href="${key}/index.html">${esc(a.title)}</a></h2>
<p>${esc(PAGES[key].job)}</p><p class="note">${money(a.priceUsd)} per ${esc(a.unit)}. <a href="${esc(utm(a.storeUrl, `${key}-demo-index`))}">Apify Store page</a></p></div>`).join('\n');
  files['demo/index.html'] = page('ASUNOKI Apify Actors: sample outputs', `<h1>Sample outputs</h1>
<p class="lead">Real rows produced by four public Apify Actors, with the inputs to reproduce them and the cost of a run.</p>
${cards}`);
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = buildAll();
  let stale = 0;
  for (const [rel, html] of Object.entries(files)) {
    const abs = join(ROOT, rel);
    if (process.argv.includes('--check')) {
      let cur = '';
      try { cur = readFileSync(abs, 'utf8'); } catch { /* missing */ }
      if (cur !== html) { console.error(`stale: ${rel}`); stale += 1; }
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, html);
    }
  }
  if (stale) { console.error('Run node scripts/build-demos.mjs'); process.exit(1); }
  console.log(process.argv.includes('--check') ? 'demo pages are up to date' : `wrote ${Object.keys(files).length} pages`);
}
