# Ripple

Type any company and get a map of who it is connected to (investors, customers, suppliers, acquisitions), built live from the web with sources on every line. Then ask "what if" and watch the shock travel through the map to your portfolio.

- **Circle size** = market value or last valuation, grounded: the latest valuation or market cap that a dated page states, quoted and linked in Details. Where no page states one, the curated demo value or the model's estimate (labelled as such)
- **Line color** = relationship type (investment, VC, owner, chips, cloud, software, supply / services, acquisition, partnership, competitor); **line thickness** = deal size; **arrows follow the money** (buyer → supplier, investor → company)
- **★** = companies in your portfolio
- **Loops** panel: every circular financing loop on the map (money invested in a company that comes back as that company's purchases), found automatically from the deals and recomputed whenever a lookup adds some. Loops of up to 5 companies are grouped by the investment that starts them ("Nvidia → OpenAI · comes back 6 ways"), ranked by the most money that can go all the way round (a loop's smallest deal); open one to draw every way back, pick a way back to see its deals
- **Risks** panel: concentration (several holdings depending on the same company)
- **Key** (bottom-left, open on first visit): how to read the map, plus filters by deal size ($100M+ to $100B+, with a switch to keep deals that state no amount) and company value ($1B+ to $1T+). Circle size is on a log scale, and position on the map carries no meaning
- Opens on the biggest money loop, with the layout already settled

## How it works

| Piece | Where |
|---|---|
| Live lookup, in research rounds the app calls one after another. 1: Bright Data SERP API search (investors, deals, parent, suppliers), Web Unlocker reads the top articles, LLM extracts relationships (with a quote and doc id) and stated valuations; only edges that touch the company and cite an article we actually read are kept. The model names each counterparty's role (supplier, customer, investor, acquirer…) and code sets the arrow from it. 2: targeted follow-up searches (round leads, acquisitions, biggest customers, supplier contracts, and for public companies the customers their annual report names; values of counterparties on deals with an amount). 3: the company's Crunchbase profile (Bright Data Web Scraper API; collecting it takes 5–15 minutes, so it runs in the background) adds investors, parent, acquisitions and subsidiaries, each checked against articles first and otherwise shown as "Crunchbase profile" | `base44/functions/lookupCompany` |
| Grounded values: two Google searches per company (one limited to the past year); the LLM lists the figures each result states and code keeps one only if its quote is in the result, its amount is in the quote, it is dated, the result names the company itself, and it is an actual value (not an estimate, target or round in talks). The newest such value wins if a trusted source (major outlet, market-data site, SEC, the company's own site) or two different sites state it. `scripts/ground-values.mjs` audits or refreshes every company on the graph (dry run by default) | `base44/functions/lookupCompany/valuation.ts` |
| What-if: LLM turns free text into shocks; propagation is deterministic (`src/lib/graph.js`); LLM writes the per-holding memo | `base44/functions/analyzeScenario` |
| Demo data: AI vendor-financing cluster and more circular deals (37 companies, 65 sourced relationships) + demo portfolio. `seedDemo` also fixes deals old lookups saved the wrong way round (`seedDemo/corrections.ts`); `scripts/sync-seed.mjs` brings the live graph up to date with both (dry run by default) | `base44/shared/seed.js`, loaded by `base44/functions/seedDemo` on first open |
| Reads and portfolio edits (service role, so visitors don't need to sign in) | `base44/functions/graphData` |
| Data | Base44 entities `Company`, `Relationship`, `Holding` |

Propagation: each relationship passes on part of a shock. Strength = sqrt(deal size / exposed company's value), or a default per relationship type when no amount is reported; investees depend on investors more than the reverse; competitors move the opposite way; 15% decay per hop, up to 3 hops; several paths into one company combine (noisy-OR).

## Deploy to Base44 (about 5 minutes)

Needs Node.js 20.19 or newer.

```bash
npm install -g base44@latest
base44 login
cd orbit
npm install
base44 link --create --name orbit
base44 secrets set BRIGHTDATA_API_KEY=xxxx BRIGHTDATA_SERP_ZONE=serp_api1 BRIGHTDATA_UNLOCKER_ZONE=web_unlocker1
base44 deploy
base44 site open
```

Bright Data: create a **SERP API** zone and a **Web Unlocker** zone in the Bright Data dashboard and use their names above. Without the Bright Data secrets the lookup still works, using the LLM's own web search (edges are marked "AI web search" and capped at 60% confidence).

## Run locally

```bash
npm install
npm run dev          # opens with the bundled demo data (no Base44 app id needed)
```

Add `?offline=1` to the URL of the deployed app to demo from bundled data if the network fails on stage.

## Demo script (2 minutes)

1. It opens on the Microsoft → OpenAI → Microsoft money loop in the Loops panel. Open "Nvidia → OpenAI" to see every way its money comes back, pick "Back via Oracle", click a deal for its source, then "Explore the map" for OpenAI's neighbourhood.
2. Risks: "5 of 6 holdings depend directly on OpenAI".
3. What if (switch the search bar to What if, or pick an example in the What if panel): "OpenAI fails to raise its next round and halves its compute commitments". Drag the severity slider and watch the portfolio numbers move.
4. Ask the audience for any company name and map it live.
