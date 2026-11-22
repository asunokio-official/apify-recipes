# n8n: daily digest of new UK public tenders (Find a Tender + Contracts Finder)

Every weekday morning this workflow runs the [UK Public Tenders Feed](https://apify.com/asunoki/uk-public-tenders-feed?utm_source=github&utm_medium=recipes&utm_campaign=n8n)
Actor on Apify with your CPV codes, regions and minimum value, and posts the **new** notices to Slack, sorted by
submission deadline, with buyer, value and a link to the notice. Each run returns only notices you have not received
before for the same filters.

For suppliers, SMEs and bid writers who want a short daily list instead of checking two government portals.

## What is in the workflow

| Node | What it does |
|---|---|
| Run now / Weekdays 07:30 | Manual trigger, and a schedule (cron `30 7 * * 1-5`, **disabled on import**). |
| Settings | Your filters and switches (see below). |
| Build Actor input | Turns Settings into the Actor input, computes the maximum cost and the spend cap. |
| Use mock data? | `true`: uses redacted real sample rows, no Apify call (free test). `false`: runs the Actor. |
| Run UK Public Tenders Feed | Apify community node, *Run actor and get dataset*, with `maxTotalChargeUsd` set. A failed run continues as an error item so you are told. |
| Build digest | Drops the free summary row, sorts by deadline, builds `text` (Slack) and `html` (e-mail). |
| Anything to send? / Slack enabled? / Send to Slack | Posts only when there is something new or the run failed. |

## Setup

1. Import `workflow.json` (n8n: *Import from file*).
2. Install the Apify community node `@apify/n8n-nodes-apify` if n8n asks, create an **Apify API** credential and select
   it on *Run UK Public Tenders Feed*.
3. Free test: keep `useMockData = true`, click *Run now*, open *Build digest* and read `text`.
4. Set `useMockData = false` and run once (this is a paid run, capped as shown in `estimateText` of *Build Actor input*).
5. Set `slackEnabled = true`, select a Slack credential on *Send to Slack* and set `slackChannel`.
6. Enable the schedule trigger and activate the workflow.

## Settings

| Field | Example | Meaning |
|---|---|---|
| `noticeTypes` | `opportunity` | Comma-separated: opportunity, planning, award, update. |
| `cpvPrefixes` | `72,48` | CPV code starts: 72 IT services, 48 software, 45 construction, 79 business services, 85 health and social, 90 environmental. |
| `regions` | `UKI,UKJ` | ITL codes: UKC North East … UKI London, UKJ South East, UKM Scotland, UKN Northern Ireland. Nationwide notices always match. |
| `keywords` / `excludeKeywords` | `cyber` | Title or description contains any of these / none of these. |
| `minValueGbp` | `100000` | 0 = no minimum. Notices without a published value are kept unless you change `includeUnknownValue` in the Actor input. |
| `days` | `3` | Publication window read on every run. Use 3 for a daily schedule, 10 for weekly. |
| `maxItems` | `100` | Cap on notices per run (and on cost). |
| `maxTotalChargeUsd` | `0` | Spend cap per run; 0 = use the maxItems estimate. |
| `stateStoreName` | (empty) | Optional name for the Actor's "already seen" memory, to keep several digests apart. |

## Cost

Pay per event: **$0.004 per new notice stored** plus a $0.00005 start fee. Filtered-out and already-seen notices are free.

- `maxItems` 100: at most about $0.40 per run.
- A niche (one CPV group and a region): typically 0 to 20 new notices a day, under $0.10 a day.
- All UK open opportunities: about 85 per working day, about $0.35 a day.

Check the Actor's Pricing tab for current prices. Whether runs are covered by your Apify plan credit depends on your plan.

## Limits

Find a Tender and Contracts Finder only (notices only on Public Contracts Scotland, Sell2Wales or eTendersNI are not
included). About a third of notices have no value. No contact officer details. Contains public sector information
licensed under the Open Government Licence v3.0. Not affiliated with the Cabinet Office or GOV.UK.

## Development

The JavaScript of both Code nodes lives in `src/logic.js` and is inlined by `build.mjs`, so the unit-tested code is the
code in `workflow.json`. The node types and versions are the ones used in our other n8n template, which was tested on
n8n 2.48.6 with `@apify/n8n-nodes-apify` 0.9.0. This workflow itself has been validated statically and by running its
Code nodes in the tests; import it into your n8n and use the mock mode first.

```bash
node build.mjs            # regenerate workflow.json
node build.mjs --check    # fail if workflow.json is out of date
node validate.mjs         # JSON, names, connections, reachability, no credentials or secrets, Code nodes parse
npm test                  # logic tests + an end-to-end run of the Code nodes in mock mode
```
