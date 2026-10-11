# Prompt for a new Claude session: grounded valuations and deeper research in Orbit

Copy everything below the line into a new Claude Code session opened in `/Users/luiz/Developer/company-dependency-graph/TalkToUsers`.

---

You're working on **Orbit**, a Base44 CLI project in `/Users/luiz/Developer/company-dependency-graph/TalkToUsers`. The React + Vite frontend is in `src/`, the Deno backend functions are in `base44/functions/`, and the entities are in `base44/entities/`. An analyst types a company name and Orbit maps its investors, customers, suppliers and acquisitions from the live web, with a source on every edge. It then runs "what if" shocks through the map to a portfolio. Read `README.md` first. Then read `base44/functions/lookupCompany/entry.ts` end to end, since most of this work happens there.

## Two goals

### 1. Ground company valuations in Bright Data's Crunchbase and PitchBook datasets

Today `Company.value_usd` comes from the LLM extraction in `lookupCompany` ("Market cap or latest valuation in USD, 0 if unknown"). It has no source and is often wrong. That matters beyond what's displayed:
- circle size is based on it;
- `src/lib/graph.js` uses it for propagation strength (sqrt(deal size / exposed company's value)).

So a bad valuation skews every what-if result.

When Crunchbase or PitchBook has a record for the company, use it as the source of truth for the valuation. Use it for funding rounds and investors too where that helps. Otherwise fall back to the current extraction.

Both datasets appear in the Bright Data account's catalog (`GET https://api.brightdata.com/datasets/list`):
- `gd_l1vijqt9jfj7olije`: Crunchbase companies information (about 2.3M records, 134 fields). Relevant fields include `funding_rounds_list`, `funding_rounds_detailed`, `funds_raised`, `financials_highlights`, `ipo_fields`, `ipo_status`, `stock_symbol`, `investors`, `acquisitions`, `acquired_by`, `sub_organization_of`, `sub_organizations`, `investments` and `similar_companies`.
- `gd_m4ijiqfp2n9oe3oluj`: PitchBook companies information (21 fields): `financing_rounds`, `latest_deal_type`, `latest_deal_amount`, `latest_deal_amount_value`, `latest_deal_date`, `investments`, `all_investments`, `competitors` and `faq`.

Neither schema has an obvious `valuation` field. Before designing anything, pull one real record from each dataset for a few companies (for example Waymo, Anduril and Stripe). Find where a post-money valuation actually lives (maybe in `funding_rounds_detailed`, `financials_highlights` or PitchBook's `faq`) and how often it's present. Also confirm:
- **Access:** a dataset being in the catalog doesn't mean the account can fetch records from it.
- **Fetch method:** collect by profile URL, discover by company name, or filter the stored dataset.
- **Latency:** whether there's a synchronous call or only trigger-then-poll. Bright Data's docs say the synchronous `/datasets/v3/scrape` call turns into an async snapshot after about a minute; measure how often that happens.
- **Price:** the cost per record. Bright Data also bills scrapes that fail because of a bad input, such as a wrong profile URL.

Collecting by URL needs the company's Crunchbase or PitchBook profile URL. The existing SERP zone can find it, for example with `site:crunchbase.com/organization Waymo`. Check that the URL really is the company's profile before fetching it. Report these findings to me before building.

Store where each value came from: for example `value_source` (crunchbase / pitchbook / article / llm_estimate / seed), `value_as_of` and `value_source_url`. Show this in the Details panel next to the value. Don't silently overwrite the hand-picked demo values (`origin: "seed"`). `lookupCompany` already skips them (`!(found?.origin === "seed")`), so decide whether a dataset value may replace one and explain the rule. For public companies, say where market cap will come from. Never use `funds_raised` (total money raised) as a valuation.

Counterparties matter as much as the company you look up. `transmission()` divides by the value of the company being hit, which is usually a counterparty (an investor, customer or supplier). Today their values come from the extraction prompt's "give … each counterparty's approximate market value … if you know it". That is the model's memory, not the articles, and it contradicts "do not use outside knowledge" in the same prompt. Decide whether counterparties get dataset lookups (with a cap per lookup) or keep a model estimate stored as `llm_estimate`, and label it as an estimate.

### 2. Deeper research that finds more connections

A lookup today (`searchAndRead()`) runs 3 Google searches through the SERP zone and reads up to 8 articles through Web Unlocker, keeping 6. One LLM call then extracts relationships, and only edges that cite an article actually read are kept. Testing on this deployment showed:
- **Dropped searches:** in every lookup (Waymo, Stripe, Anduril), one of the 3 searches was dropped as "slow search skipped".
- **Timed-out reads:** only 2 of 8 and 4 of 8 articles came back within the 22-second limit.
- **Failed lookups:** a lookup that ends with no sourced edges returns HTTP 200 with `error: "Couldn't find sourced relationships … Try again."`, and the UI shows that error. The logs suggest an earlier Waymo attempt failed this way before a retry succeeded.
- **Coverage:** Waymo got 21 edges, Stripe 6 and Anduril 8. Stripe found only 3 investors, which is clearly incomplete.

Design a multi-step research pass that finds substantially more sourced connections. For example:
- use the Crunchbase/PitchBook lists (investors, acquisitions, sub-organizations, investments, competitors) as a starting set of candidate edges;
- run targeted follow-up searches per relationship type and per candidate counterparty to find a source that can be cited;
- run a second extraction round over the new articles;
- dedupe against existing edges.

Keep the core rule: every edge needs a source the user can open. Decide whether a dataset record counts as a source. If it does, show it as "Crunchbase" or "PitchBook" with the profile URL and its own confidence level, distinct from "extracted from the article". There's a precedent: edges backed only by search snippets (doc 99) already cite a link that was never read. `Relationship.origin` is `seed | live | llm_web` today, and the Details panel labels any origin other than seed or live as "AI web search". A new origin needs both the enum and the label updated.

Check Base44's time limit for backend functions before designing. The docs say 5 minutes; confirm it. If deeper research can exceed it, split it into rounds:
- the lookup returns quickly with the first results;
- further rounds run as separate calls and the graph grows as each one finishes.

Don't rely on work continuing after a function returns its response. The function logs show Base44 tracking requests still in flight at that point (`post_response_work … inflight_at_response`), so that work isn't guaranteed to finish. The simplest option is for the frontend to call a research-round function repeatedly until it reports that it's done. Each call stays well under the limit, and every call is a real progress step. If you prefer a `LookupJob` entity or scheduled rounds, explain why. The 72-hour cache keys on `last_fetched`, so record whether research finished. Otherwise a cache hit skips rounds that never ran.

Rounds must only add to or improve the results of earlier rounds. Today's save logic is built for a single pass. It deletes any live edge between the same two companies under a different type that this run didn't find. It also replaces an edge that has an amount with one that has none. Across rounds, both would throw away what round 1 found. Define merge rules, for example: keep the higher confidence, keep a stated amount, prefer an article over a dataset record, never delete an edge found in the same refresh.

Make the UI's progress steps reflect real progress; today they advance on a timer (`online.lookup` in `src/api/backend.js`).

## How to work

**Plan first, then implement.** Read the files above and do the dataset investigation. Then show me a short plan with a recommendation for each decision:
- dataset access method and cost per lookup;
- valuation precedence and the fields that record where a value came from;
- counterparty valuations;
- whether dataset records count as sources;
- research rounds and their budget (Bright Data calls, LLM calls, time taken). Time to first results should be no slower than today's baseline;
- synchronous lookup or rounds, and how rounds merge their results;
- UI changes.

Wait for my OK before writing code.

## Constraints

- **Base44 CLI:** installed at `/opt/homebrew/bin/base44`, already logged in and linked to app `6acac1d3560f9955c41aa9b4`. Deploy with `base44 deploy --yes --build`, which injects the app ID at build time. Read logs with `base44 logs --function lookupCompany --since 1h`.
- **Live site:** https://ripple-c41aa9b4.base44.app. Dashboard: https://app.base44.com/apps/6acac1d3560f9955c41aa9b4/editor/workspace/overview
- **Bright Data secrets:** already set on the Base44 app: `BRIGHTDATA_API_KEY`, `BRIGHTDATA_SERP_ZONE=serp_api1` and `BRIGHTDATA_UNLOCKER_ZONE=web_unlocker1`. Never print, log or commit the key, and don't ask me to paste it into the chat. For direct curl tests (the dataset investigation), ask me to save it in a file outside the repo with `chmod 600`. Read it into a header without echoing it, for example `-H "Authorization: Bearer $(< ~/.config/brightdata.key)"`.
- **Old prompt file:** ignore the build/deploy section of `PROMPT_supplier_customer.md`. It's for a different machine and a different Base44 app.
- **UI redesign in progress:** branch `ui-redesign` has an unfinished redesign that another session may still be editing. It touches `index.html`, `src/index.css`, `tailwind.config.js`, `GraphView.jsx`, `src/lib/graph.js` (colors) and `src/components/ui/*`, and adds `CommandBar.jsx`, `Suggestions.jsx` and `src/components/panels/*`. Don't revert or reformat any of it. Check `git status` and ask me whether the redesign is finished before touching UI files. The Details panel is moving from `App.jsx` to `src/components/panels/Details.jsx`, and lookup progress to `LookupStatus` in `CommandBar.jsx`, so make your UI changes there. Backend work doesn't depend on it.
- **Deploying:** `base44 deploy` ships the whole working tree, redesign included. Don't deploy, even a test function, until I've confirmed the redesign is ready to ship.
- **Bright Data budget:** a search skipped as slow is only raced, not cancelled, so it keeps running and may still be billed. The logs show 1–2 Bright Data requests still in flight when a lookup returns. Cancel abandoned requests with an `AbortController` and count them in the budget.
- **Cache:** lookups are cached for 72 hours (`CACHE_HOURS`), so test with `force: true`.
- **Fallbacks:** keep both working. One is the path with no Bright Data key (InvokeLLM's own web search). The other is offline mode (`?offline=1` or no app ID), which serves `base44/shared/seed.js`.
- **`src/lib/graph.js`:** keep it pure, with no network or database calls.
- **Schema changes:** put them in `base44/entities/*.jsonc`. Existing rows must keep working.

## Measuring "more connections"

`scripts/investor-recall.mjs` compares a fresh lookup's investors with publicly reported investor lists for Waymo, Anthropic, Stripe and Databricks. Its default app ID is the original author's deployment, so run it as `BASE44_APP_ID=6acac1d3560f9955c41aa9b4 node scripts/investor-recall.mjs`. Record a baseline before changing anything. Dropped searches and timed-out reads vary from run to run, so a single run is noisy: run the baseline twice, at least for Stripe. Then report, before and after:
- investor recall, split by where the edge came from (article vs Crunchbase/PitchBook). Dataset investor lists can raise recall without adding a single article the user can open;
- edge counts per type;
- how many lookups fail;
- time to first results and to the last round;
- Bright Data calls per lookup. The log counts searches and reads but not retries or abandoned requests, so add a counter to the lookup's `log`.

Fix the script before relying on it:
- If research runs in rounds, the script must wait for the last round before it scores; today it reads the graph straight after the first call returns.
- Its "round total on one investor" check compares against `round_total_usd`, a field that doesn't exist, so the warning can never fire.

Each run forces fresh live lookups, which spends Bright Data credits. While iterating, run it for one company; run all four at the end.
