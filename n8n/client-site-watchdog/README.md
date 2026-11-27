# Client site watchdog (n8n + Apify)

`workflow.json` is an importable n8n workflow for agencies, freelancers and site-care providers who look after many
client websites. Every day it checks each client domain for **confirmed** DNS and registration changes (nameservers,
MX, SPF, DMARC, registrar, domain status), warns before a domain expires, and once a week checks for technology
changes. It sends **one digest per run, only when something needs attention**, sorted by urgency and grouped by client.

It uses two ASUNOKI Actors on Apify and adds the operations layer around them:

| Needs | Done by |
|---|---|
| Confirmed DNS / registration changes, expiry warnings | [DNS & RDAP Change Feed](https://apify.com/asunoki/dns-rdap-change-feed) (a change is reported only after it repeats on consecutive checks) |
| Confirmed technology changes | [Tech Stack Change Monitor](https://apify.com/asunoki/tech-stack-change-monitor) (same confirmation rule) |
| Urgency levels (critical / high / medium / low) | this workflow (`classify` in `src/logic.js`) |
| Daily expiry reminders from 7 days out, also after expiry | this workflow (the Actor warns once per threshold) |
| Failed check = "unknown", persistent failure after 3 runs | this workflow |
| Empty or failed Actor run reported as "monitoring did not run" | this workflow |
| Never the same alert twice, even on re-runs | this workflow + a small data table |
| Bad lines, duplicates and URLs in the client list | this workflow |

Not claimed: the workflow does not check SSL certificates, uptime, DNSSEC or page content, and the urgency rules are
rules of thumb you can edit.

## Cost (paid to Apify, pay per event)
DNS $0.002 and technology $0.003 per successful domain check; failures, non-existent domains and change rows are free.
DNS daily + technology weekly: **25 domains about $1.85 a month, 100 domains about $7.40**. `maxRunCostUsd` stops a run
whose estimate is too high before anything is spent; each Apify run also carries a spending cap.

## Setup
1. Import `workflow.json`, install `@apify/n8n-nodes-apify`, create an *Apify API* credential and select it on both Apify nodes.
2. Edit **Settings** (`clients`: one `Client | domain` per line).
3. Test free: keep `useMockData = true`, click *Run now*. Fictional `.example` domains, no Apify call, nothing sent or saved.
4. `useMockData = false`, run once (baseline, no alerts). Then enable `slackEnabled` and/or `emailEnabled`, pick the credential, enable the schedule.

## Tests (no network, no n8n needed)
`npm test` runs 19 tests, including the exact Code-node code that ships in the workflow:
first run (baseline), no change, DNS change by urgency, expiry approaching (threshold rows, daily reminders, expired),
technology change, failed and blocked checks (streak and recovery), robots.txt skips, non-existent domain, empty Actor
result, duplicate prevention and re-run, invalid input, over-limit lists, budget guard, test mode saves nothing.
`npm run check` verifies `workflow.json` is current and has no credentials, secrets, pinned data or active schedule.

Not yet verified: a real run inside n8n (import, data-table nodes, Slack/e-mail delivery) and a real Actor run through
the n8n Apify node. Tested logic and static checks only.
