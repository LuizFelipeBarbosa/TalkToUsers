# Ripple

Type any company and get a map of who it is connected to (investors, customers, suppliers, acquisitions), built live from the web with sources on every line. Then ask "what if" and watch the shock travel through the map to your portfolio.

- **Circle size** = market value or last valuation
- **Line color** = relationship type; **line thickness** = deal size; **arrows follow the money**
- **★** = companies in your portfolio
- **Hidden risks** tab: circular financing loops (money invested in a customer that comes back as purchases) and concentration (several holdings depending on the same company)

## How it works

| Piece | Where |
|---|---|
| Live lookup: Bright Data SERP API search, Bright Data Web Unlocker reads the top articles, LLM extracts relationships with a quote and doc id, then only edges that touch the company and cite an article we actually read are kept | `base44/functions/lookupCompany` |
| What-if: LLM turns free text into shocks; propagation is deterministic (`src/lib/graph.js`); LLM writes the per-holding memo | `base44/functions/analyzeScenario` |
| Demo data: AI vendor-financing cluster (32 companies, 49 sourced relationships) + demo portfolio | `base44/shared/seed.js`, loaded by `base44/functions/seedDemo` on first open |
| Reads and portfolio edits (service role, so visitors don't need to sign in) | `base44/functions/graphData` |
| Data | Base44 entities `Company`, `Relationship`, `Holding` |

Propagation: each relationship passes on part of a shock. Strength = sqrt(deal size / exposed company's value), or a default per relationship type when no amount is reported; investees depend on investors more than the reverse; competitors move the opposite way; 15% decay per hop, up to 3 hops; several paths into one company combine (noisy-OR).

## Deploy to Base44 (about 5 minutes)

Needs Node.js 20.19 or newer.

```bash
npm install -g base44@latest
base44 login
cd ripple
npm install
base44 link --create --name ripple
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

1. Open on OpenAI: the Bloomberg-style map, with sources on every line.
2. Hidden risks: "5 of 6 holdings depend directly on OpenAI" and the Nvidia → OpenAI → Oracle → Nvidia loop.
3. What if: "OpenAI fails to raise its next round and halves its compute commitments". Drag the severity slider and watch the portfolio numbers move.
4. Ask the audience for any company name and map it live.
