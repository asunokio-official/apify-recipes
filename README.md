# Apify recipes: weekly feeds of new NPIs, building permits and UK tenders, plus tech-stack checks

Runnable examples for four public Apify Actors, with ready-made inputs for real jobs, **a cost estimate printed before
every run**, a hard spend cap, and output as spreadsheet-ready CSV. Node.js and Python, a weekly GitHub Actions
workflow, an importable n8n workflow and static sample-data pages.

- Try every recipe **for free** with `--dry-run`: no Apify account, no token, no network call. It prints the cost of the
  real run and writes a CSV from real (redacted) sample rows so you can see the columns.
- Real runs use the official [`apify-client`](https://docs.apify.com/api/client/js/) with your own `APIFY_TOKEN`, start
  only with `--yes`, and pass a spend cap (`maxTotalChargeUsd`) to Apify, so a run cannot cost more than the printed maximum.

> Disclosure: the Actors are published by ASUNOKI, the maintainer of this repository. Runs are billed to your Apify
> account at the Actor's pay-per-event price, and part of that goes to the Actor developer.

## Use-case index

| Job to be done | Preset | Actor | Max cost per run |
|---|---|---|---|
| Weekly new NPIs in Texas for dental practices | `tx-dental-new-npis-weekly` | [New NPI Providers Feed](https://apify.com/asunoki/nppes-new-providers-feed?utm_source=github&utm_medium=recipes&utm_campaign=readme) | $0.60 |
| New clinics and agencies in Texas and Oklahoma | `tx-ok-new-clinics-agencies-weekly` | New NPI Providers Feed | $1.00 |
| New behavioral-health clinics and agencies, all states | `us-behavioral-health-orgs-weekly` | New NPI Providers Feed | $2.00 |
| New urgent-care centers, all states | `us-urgent-care-new-weekly` | New NPI Providers Feed | $0.60 |
| New solar and roofing permits in Austin, TX | `austin-solar-roof-permits` | [US Building Permits Feed](https://apify.com/asunoki/us-building-permits-feed?utm_source=github&utm_medium=recipes&utm_campaign=readme) | $0.60 |
| New ADU permits in San Francisco | `sf-adu-permits` | US Building Permits Feed | $0.40 |
| Projects of $100k+ in SF, Austin and New Orleans | `three-cities-100k-plus` | US Building Permits Feed | $1.00 |
| UK IT and software tenders above £100k (weekly) | `uk-it-tenders-100k-weekly` | [UK Public Tenders Feed](https://apify.com/asunoki/uk-public-tenders-feed?utm_source=github&utm_medium=recipes&utm_campaign=readme) | $1.20 |
| UK IT tenders in London and the South East (daily) | `uk-it-tenders-london-se-daily` | UK Public Tenders Feed | $0.80 |
| Who won construction contracts in Scotland | `uk-construction-awards-scotland` | UK Public Tenders Feed | $0.80 |
| UK marketing and PR tenders suitable for SMEs | `uk-marketing-tenders-sme` | UK Public Tenders Feed | $0.80 |
| Which prospect stores run Shopify, which theme and apps | `tsd-shopify-prospect-check` | [Tech Stack Detector](https://apify.com/asunoki/tech-stack-detector?utm_source=github&utm_medium=recipes&utm_campaign=readme) | $0.005 per site |
| Analytics / tag manager / consent audit with evidence | `tsd-martech-audit` | Tech Stack Detector | $0.005 per site |
| Weekly snapshot of client sites to spot stack changes (pairs with the offline `diff` command) | `tsd-agency-change-watch` | Tech Stack Detector | $0.005 per site |
| Which email provider each domain uses (Google Workspace, Microsoft 365, Zoho), from public DNS | `tsd-email-provider-lookup` | Tech Stack Detector | $0.005 per site |

"Max cost" is the `maxItems` cap times the price plus the start fee. Rows that your filters drop, and rows you already
received in an earlier run, are free, so most runs cost far less. Each preset is a JSON file in [`presets/`](presets/)
and is checked against the Actor's input schema by the tests.

## Quick start (Node.js 18+)

```bash
cd node && npm ci
node src/cli.js list                                          # presets with their max cost
node src/cli.js run uk-it-tenders-100k-weekly --dry-run       # free preview: cost + sample CSV on stdout
export APIFY_TOKEN=...                                        # from https://console.apify.com/settings/integrations
node src/cli.js run uk-it-tenders-100k-weekly --yes --out out/tenders.csv
```

Options:

| Option | What it does |
|---|---|
| `--dry-run` | Never contacts Apify. Prints the estimate and writes CSV from the redacted samples in `samples/`. |
| `--yes` | Required for a real (paid) run. Without it the CLI prints the estimate and stops. |
| `--max-cost 0.50` | Spend cap for the run in USD (default: the estimate). The Actor stops storing rows at the cap; rows it did not store stay "new" for the next run. |
| `--input '{"states":["CA"]}'` | Replace preset input keys, e.g. another state, CPV code or city. |
| `--urls-file domains.txt` | Tech Stack Detector: one domain per line, or a CSV whose first column is the domain. |
| `--out file.csv` / `--json file.json` | Write the CSV / the rows plus summary and actual charge. |
| `--bom` | Add a UTF-8 BOM for Excel. |
| `--all-columns` | Every field instead of the curated column list. |
| `--slack` | Post a digest to the Slack incoming webhook in `SLACK_WEBHOOK_URL`. |

Exit codes: 0 ok, 1 error before or during the run, 2 the Actor run finished but did not succeed (rows it stored are still written).

## Quick start (Python 3.10+)

```bash
cd python && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
python -m asunoki_recipes list
python -m asunoki_recipes run tx-dental-new-npis-weekly --dry-run
APIFY_TOKEN=... python -m asunoki_recipes run tx-dental-new-npis-weekly --yes --out out/tx-dental.csv
```

Same presets, same options (except `--slack`), byte-identical CSV (a test compares both ports).

### What a run looks like

```
Actor:          asunoki/uk-public-tenders-feed
Price:          $0.004 per new notice stored (event "notice") + $0.00005 start fee
Estimate (max): $1.20  (300 x $0.004 + start fee; maxItems cap of 300; filtered-out and already-seen rows are free, so most runs cost less)
Run spend cap:  $1.20 (maxTotalChargeUsd; the Actor stops storing before it would exceed it)
```

After a real run the CLI also prints the actual charge, computed from the run's charged events.

## Pricing (pay per event, checked 2026-11-22)

| Actor | Event | Price | Free |
|---|---|---|---|
| [nppes-new-providers-feed](https://apify.com/asunoki/nppes-new-providers-feed?utm_source=github&utm_medium=recipes&utm_campaign=pricing) | new provider stored | $0.002 | filtered out, already seen, summary row |
| [us-building-permits-feed](https://apify.com/asunoki/us-building-permits-feed?utm_source=github&utm_medium=recipes&utm_campaign=pricing) | new permit stored | $0.002 | filtered out, already seen, summary row |
| [uk-public-tenders-feed](https://apify.com/asunoki/uk-public-tenders-feed?utm_source=github&utm_medium=recipes&utm_campaign=pricing) | new notice stored | $0.004 | filtered out, already seen, summary row |
| [tech-stack-detector](https://apify.com/asunoki/tech-stack-detector?utm_source=github&utm_medium=recipes&utm_campaign=pricing) | website scanned successfully | $0.005 (HTTP), $0.015 (browser, optional) | blocked, robots-skipped, failed sites |

Every run also has Apify's start event, $0.00005 per GB of memory (256 to 512 MB runs count as one). The Pricing tab
of each Actor is authoritative; `catalog.json` holds the prices used by the estimate. Whether runs are covered by your
Apify plan's monthly credit depends on your plan.

Typical volumes, from the Actors' documentation: about 11,000 new NPIs a week nationally (Texas about 770); about 85 new
UK open opportunities per working day across all sectors (a niche of one CPV group plus a region is typically 0 to 20 a day).

## CSV for Google Sheets and Excel

The CSV is flat: arrays are joined with `; `, nested objects are JSON, one row per record, the free summary row is left
out (it is in the `--json` file). Text that a spreadsheet would execute as a formula (`=`, `+`, `-`, `@`) is prefixed
with an apostrophe.

- **Google Sheets:** File > Import > Upload. To keep leading zeros in ZIP codes and IDs, untick *Convert text to
  numbers, dates, and formulas*.
- **Excel:** use `--bom` so non-ASCII characters (for example £) display correctly.

## Scheduled weekly run with GitHub Actions

[`.github/workflows/weekly-feed.yml`](.github/workflows/weekly-feed.yml) runs one preset every Tuesday, uploads the CSV
and JSON as a build artifact (kept 30 days) and, if the `SLACK_WEBHOOK_URL` secret is set, posts a digest to Slack.

1. Fork or copy this repository.
2. Add the secret `APIFY_TOKEN` (and optionally `SLACK_WEBHOOK_URL`).
3. Add the variables `RECIPE_PRESET` (e.g. `uk-it-tenders-100k-weekly`), optionally `RECIPE_MAX_COST_USD`, and
   `RECIPE_SCHEDULE_ENABLED=true`.
4. Run it once from the Actions tab (*Run workflow*, tick *dry run* first if you like).

Without `APIFY_TOKEN` the job does a dry run, so a fork never spends money by accident. The schedule does nothing until
`RECIPE_SCHEDULE_ENABLED` is `true`. GitHub Actions minutes are free on public repositories; Apify charges are the per-row
prices above, capped per run.

## n8n: UK tenders daily digest

[`n8n/uk-tenders-daily-digest/workflow.json`](n8n/uk-tenders-daily-digest/) is an importable workflow: every weekday
morning it runs the UK Public Tenders Feed with your CPV codes, regions and minimum value, and posts the new notices,
sorted by deadline, to Slack. It ships with a free mock mode (no Apify call), contains no credentials, and its Code-node
logic is unit-tested. See its [README](n8n/uk-tenders-daily-digest/README.md).

## Sample-data pages

[`demo/`](demo/) holds static HTML pages, one per Actor, built from real sample output by
`node scripts/build-demos.mjs`: what the Actor does, real rows, presets with their cost, honest limits. No JavaScript
and no external requests, so they can be hosted on GitHub Pages or any static host. Personal data is redacted in the
NPI and permit samples (names, NPIs, phones and street numbers); the Actors themselves return those fields as described
in their READMEs.

## Honest limits

- **New NPI Providers Feed:** weekly source (CMS posts one file per week, 1 to 2 days after the week ends), only the two
  latest weeks exist, so schedule at least every two weeks. A new NPI is an ID, not a licence, credential, Medicare
  enrolment or proof that a practice opened. No e-mail addresses exist in the source. You are responsible for TCPA,
  CAN-SPAM and any other rules for outreach.
- **US Building Permits Feed:** three cities only (San Francisco, Austin, New Orleans), chosen because their data has an
  explicit public-domain or CC0 licence. Permits appear 1 to 3 days after issue. No owner or applicant names, phones or
  e-mails. Austin asks users not to contact individuals represented in the data.
- **UK Public Tenders Feed:** Find a Tender and Contracts Finder only (not Public Contracts Scotland, Sell2Wales or
  eTendersNI). About a third of notices have no value. No contact officer details; tender documents are not downloaded.
- **Tech Stack Detector:** checks websites you already have; it does not find companies. "Not detected" never means
  "not used": tools loaded after consent, at checkout or by inline loaders can be missed. No bypass of bot protection.

## Data sources and licences

- NPI data: CMS NPPES Downloadable Files (FOIA-disclosable public data, US government work). Not affiliated with CMS or HHS.
- Permits: DataSF (PDDL 1.0), City of Austin Open Data Portal (public domain; credit the City of Austin), City of New
  Orleans (CC0). Not affiliated with any city.
- UK notices: contains public sector information licensed under the Open Government Licence v3.0.
- Tech Stack Detector: public pages and public DNS records only.

## Development

```bash
cd node && npm ci && npm test                                    # Node: unit tests with a mocked ApifyClient
cd python && python -m unittest discover -s tests -t .           # Python: apify-client mocked, not needed
cd n8n/uk-tenders-daily-digest && node build.mjs --check && node validate.mjs && npm test
node scripts/build-demos.mjs --check
```

No test uses a real token or calls the Apify API. `catalog.json` (prices, columns), `presets/`, `samples/` and
`schemas/` (copies of the Actors' input schemas) are shared by both ports.

## License

MIT, see [LICENSE](LICENSE). Data you obtain through the Actors stays under its source's terms (see above).

## Spot technology changes between two runs (offline)

```
node node/src/cli.js run tsd-agency-change-watch --urls-file clients.txt --json snapshots/2026-11-16.json --yes
node node/src/cli.js run tsd-agency-change-watch --urls-file clients.txt --json snapshots/2026-11-23.json --yes
node node/src/cli.js diff snapshots/2026-11-16.json snapshots/2026-11-23.json --out changes.csv
```

`diff` lists, per site, technologies that appeared or disappeared. A site that was blocked or failed in either run shows as `not-comparable`, never as unchanged. It reads two local files and sends nothing.
