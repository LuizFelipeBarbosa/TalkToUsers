# Prompt for a new Claude session: supplier & customer relationships in Ripple

Copy everything below the line into a new Claude Code session opened in `/Users/apple/code/ripple`.

---

You are working on **Ripple**, a Base44 CLI project in `/Users/apple/code/ripple` (React + Vite frontend in `src/`, Base44 backend in `base44/`). Ripple lets a VC analyst type any company, builds a map of who it's connected to from the live web (with a source on every line), and runs "what if" shocks that propagate through the map to their portfolio. Read `README.md` first.

## The problem

Today Ripple mostly captures **capital** relationships: investments, VC rounds and acquisitions. Operating relationships, meaning **who supplies whom and who sells to whom**, are thin or missing. That's the most important channel for real-world risk (a supplier failure, a lost major customer). The few non-capital types (`hardware`, `cloud`, `software`) are AI-sector-specific and don't generalize to, for example, a retailer, a manufacturer or a fintech.

Concretely, from the current code:
- `base44/functions/lookupCompany/entry.ts`
  - The two SERP queries in `searchAndRead()` are capital-biased: `"X" invests OR acquires OR partnership OR "deal with"` and `"X" customers OR investors OR funding round OR supplier`. As a result, few supplier/customer articles get read.
  - `TYPES` and `extractionPrompt()` only offer `hardware`, `cloud` and `software` for commercial relationships. There's no generic supplier/customer type, and nothing about the *strength* of the dependency (for example "Apple is 25% of Foxconn's revenue", "sole supplier", "largest customer").
  - `EXTRACT_SCHEMA` has `amount_usd`, but no field for revenue share, contract length or exclusivity.
- `base44/entities/Relationship.jsonc`: the `type` enum mirrors `TYPES`, and there are no dependency-strength fields.
- `src/lib/graph.js`
  - `EDGE_TYPES`, `RECEIVER_DEPENDENCE` and `PAYER_DEPENDENCE` hard-code per-type defaults.
  - `transmission()` only scales by `amount_usd / company value`. It can't use "X% of revenue" or "sole source", which are the strongest signals for supply-chain contagion.
  - `findSharedDependencies()` treats every non-competitor edge the same. "3 holdings share the same sole supplier" should be flagged as a distinct, higher-severity risk.
- `src/App.jsx`: the Details panel groups edges as "Money out: invests in, buys from" and "Money in: investors, customers". It should clearly separate **Investors / Investments**, **Suppliers** and **Customers**.
- `src/components/GraphView.jsx`: the legend and edge colors come from `EDGE_TYPES`.
- `base44/shared/seed.js`: the demo data (an AI vendor-financing cluster, 32 companies / 49 relationships) and the demo portfolio.

## Your task

**First plan, then implement.** Start by reading every file listed above. Then write a short plan covering the decisions below and show it to me before you write code. Keep the existing "direction follows the money" convention: buyer → seller, so a customer is the `source` and a supplier is the `target`.

Decisions the plan must make (with a recommendation for each):
1. **Type model.** Add generic `supplier` / `customer` types alongside the existing ones, or restructure into a two-level `category` (capital / commercial / competitive) + `subtype` (hardware, cloud, software, components, manufacturing, logistics, distribution, licensing…). Consider backward compatibility with existing `Relationship` rows and the seed data. Don't break `findCircularFinancing()`, which relies on `MONEY_TYPES`.
2. **Dependency strength.** Add optional fields such as `revenue_share` (0–1, share of the seller's revenue this customer represents), `spend_share` (share of the buyer's input from this supplier), `exclusivity` (sole / primary / one of many) and `contract_end`. Explain how the extractor fills them only when a document states them.
3. **Propagation.** Update `transmission()` so a stated revenue share or sole-source status dominates the per-type default. For example, losing a customer that is 40% of revenue should transmit roughly 0.4+ to the seller, and a sole supplier failing should hit the buyer hard. Keep the 15% per-hop decay, the 3-hop limit and the noisy-OR combining. Supply shocks and demand shocks should travel in the right direction with the right strength.
4. **Search & extraction.** Rewrite the SERP queries so a lookup reliably covers capital *and* supply chain, for example `"X" supplier OR "supplies" OR "manufactured by" OR "sources from"`, `"X" "largest customer" OR "major customer" OR "% of revenue"`, and 10-K "customer concentration" language for public companies. Watch Bright Data cost: today a lookup is 2 SERP calls + up to 6 Web Unlocker reads (`MAX_ARTICLES = 4`). Propose a budget, for example 3 SERP + 6 reads, and keep total latency under about 25 s. Update `extractionPrompt()` and `EXTRACT_SCHEMA` accordingly. Keep the existing evidence/doc_id validation, which keeps only edges that cite a document we actually read.
5. **Hidden risks.** Add a "shared critical supplier" / "shared major customer" concentration check that uses the new strength fields, and show it in the Hidden risks tab.
6. **UI.** Group the Details panel into Investors, Investments, Suppliers, Customers, Acquisitions, Partners and Competitors. Update the legend and colors. Keep the graph readable: don't add more than about 3 new colors, and consider a line style for commercial vs capital.
7. **Demo data.** Add sourced supplier/customer edges to `seed.js` that make the demo story stronger, for example TSMC → Nvidia (sole foundry), SK Hynix / Micron HBM supply to Nvidia, and Microsoft as a large share of OpenAI's/CoreWeave's revenue. Each edge must have a real `source_url` and `evidence`. Don't invent facts; if you can't verify one, leave it out.

## Constraints
- Base44 CLI project. Entities live in `base44/entities/*.jsonc`, backend functions in `base44/functions/*/entry.ts` (Deno, `npm:@base44/sdk@0.8.41`), and shared code in `base44/shared/`.
- Bright Data secrets `BRIGHTDATA_API_KEY`, `BRIGHTDATA_SERP_ZONE=serp_api1` and `BRIGHTDATA_UNLOCKER_ZONE=web_unlocker1` are already set on the Base44 app. Never print, log or write the key to a file. The InvokeLLM web-search fallback (used when there's no key) must keep working.
- `src/lib/graph.js` stays pure (no UI, no I/O) so it's easy to test. Add small unit-style checks, for example a `node` script in the scratchpad that imports `graph.js` and asserts the propagation numbers for a few hand-built cases.
- Offline mode (`?offline=1`, or no app ID) must still work from `seed.js`.
- Lookups are cached for 72 h (`CACHE_HOURS`). After changing extraction, test with `force: true`.

## Build & deploy (this Mac)
npm on this Mac's Homebrew Node is broken, so npm and the base44 CLI were installed under `~/Library/pnpm`. Run these in every shell:
```bash
export PATH="$HOME/Library/pnpm:$PATH"
cd /Users/apple/code/ripple
VITE_BASE44_APP_ID=6acaa6f6770567c4e1a3ea84 npm run build   # the app ID MUST be set at build time or the site silently runs on offline demo data
base44 deploy -y --no-build
base44 logs --function lookupCompany   # check function errors
```
- Live site: https://ripple-e1a3ea84.base44.app
- Dashboard: https://app.base44.com/apps/6acaa6f6770567c4e1a3ea84/editor/workspace/overview
- To test a live lookup without the UI cache, run this in the browser console on the live site:
  `await (await fetch('/api/apps/6acaa6f6770567c4e1a3ea84/functions/lookupCompany',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Foxconn',force:true})})).json()`
  It returns a `log` array showing search/read/extract/kept counts.
- After changing seed data, check how `seedDemo` decides whether to reseed. Existing rows in the live DB may need an update path.

## Done when
- Looking up companies with real supply chains, such as **Foxconn**, **TSMC**, **Shopify** and **Rivian**, returns supplier and customer edges with sources, not just investors.
- A what-if like "TSMC halts production for 3 months" visibly propagates to Nvidia → OpenAI → the portfolio, with sensible magnitudes.
- Hidden risks shows a shared-critical-supplier finding on the demo portfolio.
- Existing capital features (circular financing loop, investor edges, offline mode) still work.
- Deployed to the live site and verified in the browser. Give me a short summary of what changed and anything that's still weak.
