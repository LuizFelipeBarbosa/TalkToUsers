# PR #1: Rename to Orbit, redesign the UI, and ground company values

`ui-redesign` → `main` · commit `c66cb34` · 44 files, +4,114 / −1,283

This PR does four things:

1. **Redesigns the UI** so a first-time visitor can tell what the map shows.
2. **Runs the company lookup in research rounds**, which adds Crunchbase as a source.
3. **Grounds company values**: each value is quoted from a dated page, and the app says where it came from.
4. **Renames the project from Ripple to Orbit** in config and code.

The main [README](README.md) describes the app as it is after this PR. This file covers what changed, why, and how to deploy and review it.

---

## At a glance

| Area | Before | After |
|---|---|---|
| First screen | Opens on OpenAI's neighbourhood | Opens on the biggest money loop (Nvidia → OpenAI → Oracle → Nvidia), with the layout already settled and the Risks panel open |
| Reading the map | No legend | A **Key** (open on first visit) explains the map and has deal-size and company-value filters |
| Layout | Tabs and banners across the page | A floating **command bar**, one **Inspector** card or bottom sheet, and **map controls** |
| Risks | "Hidden risks" tab | **Risks** panel; tapping a row draws that loop or dependency on the map |
| Lookup | One call; the progress steps ran on a timer | 2 awaited rounds plus a background Crunchbase round; steps come from the server |
| Sources | Articles, or the model's own web search | Articles, the **Crunchbase profile** (new `crunchbase` origin), or the model's web search |
| Company value | Curated or estimated by the model, source not shown | Quoted from a dated page where one exists, with the source shown in Details; otherwise labelled as curated or estimated |
| Name | Ripple | Orbit (Base44 config, `package.json`, deploy commands, prompts) |

---

## 1. UI redesign

**Why.** Both testers in the first Sense Check session were confused on first open. One couldn't tell what the graph showed. The other found it "way too busy", asked for filters, and took distance from the centre to mean exposure. The changes below follow from that: the legend shows by default, filters by size, deal details on click, and the layout no longer suggests that position means anything.

### New components

| Component | What it does |
|---|---|
| `src/components/CommandBar.jsx` | Floating search bar with a **Map / What if** switch. In Map mode it jumps to a company already on the map or starts a web lookup for a new one. In What if mode it runs a scenario. Lookup progress and the active scenario show underneath it. `⌘K` or `/` focuses it. |
| `src/components/Inspector.jsx` | Holds the Details, What if, Risks and Portfolio panels. Wide screens get a floating card that hugs its content. Phones and upright tablets get a bottom sheet with peek, half and full positions. |
| `src/components/MapControls.jsx` | Zoom and fit buttons, plus a Layers popover with three toggles: *Show whole map*, *Fold busy companies* and *Deal callouts*. Touch layouts drop the zoom buttons. |
| `src/components/MapKey.jsx` | How to read the map, pinned bottom-left. It opens on the first visit, and the browser remembers whether it was left open or closed. It holds the deal-size and company-value filters. |
| `src/components/Suggestions.jsx` | Matches company names (prefix matches first) and handles arrow-key navigation for the command bar. |
| `src/components/panels/{Details,WhatIf,Risks,Portfolio}.jsx` | The panels, split out of `App.jsx` (which shrinks by about 230 lines). Details shows the value's source (see §3). |
| `src/components/ui/{list,segmented-control,switch}.jsx` | iOS-style grouped list, segmented control and switch. The unused `checkbox` and `input` components are removed. |
| `src/lib/useMediaQuery.js` | Small hook used to switch between the compact and wide layouts. |

### Behaviour

- **Opens on the money loop.** A `useLayoutEffect` highlights the first circular financing loop before the first paint, so the map never appears without it. "Explore the map" in the command bar clears the highlight.
- **Settled layout.** The first force layout runs to rest off screen, so a new visitor never sees the map move. Later changes (a lookup, a filter) settle visibly, so you can see what changed. Every company has the same charge, so distance on the map doesn't depend on size or exposure.
- **Folding smaller connections** (`collapseMap` in `src/lib/graph.js`, on by default). The focus company shows its 8 biggest direct connections, and each of those shows its 3 biggest connections further out (on the whole map: 3 of the companies that link only to it). The rest fold into a dashed **+N** node beside the company: clicking it shows 10 more, and once all are shown it turns into **−**, which folds them back. Details has the same *Show more* / *Show fewer* buttons. Centring another company starts folded again. Pinned companies (focus, holdings, the selection, and what a scenario or highlight points at) are never folded.
- **Filters.** Deals below the minimum size and companies below the minimum value are hidden. The focus company, portfolio holdings, and whatever a scenario or highlight points at always stay visible. Filters only change the view: Risks and What if still use every edge.
- **Theme.** Colour tokens in `src/index.css` cover light and dark mode (`prefers-color-scheme`), and `tailwind.config.js` reads them. The connection colours now use Apple's system colours. Pure red is reserved for risk in a what-if.
- **New dependency:** `d3-transition`, for animated zoom and fit.

---

## 2. Lookup in research rounds

**Why.** Base44 doesn't guarantee that work after a function's response finishes. Collecting a Crunchbase profile took 5–11 minutes in testing. So the lookup is split into rounds that the client calls one after another, passing `state` back each time.

### The rounds (`base44/functions/lookupCompany/entry.ts`)

| Round | Request | What it does |
|---|---|---|
| 1 | `{ name, force? }` | Runs 3 Google searches (Bright Data SERP API), reads the top articles (Web Unlocker, as markdown), and has the model extract relationships. At the same time it grounds the company's value and finds and starts collecting its Crunchbase profile. Each of those two gets 5 s after the articles are read; whatever isn't done by then moves to round 2. |
| 2 | `{ key, round: 2, state }` | Retries round 1's failed searches and runs targeted ones (round leads, acquisitions, biggest customers and suppliers). It reads only new articles and extracts again. It grounds the values of up to 5 companies: the company itself if round 1 couldn't, and counterparties on deals that report an amount. |
| 3 (background) | `{ key, round: 3, state }` | Polls the Crunchbase collection every 20 s for up to 15 min. It then searches for an article behind its 4 most important unsourced relationships (parent, round leads, acquisitions). Any it can't find an article for are saved citing the Crunchbase profile, with confidence 0.65. |
| — | `{ action: "values", keys, dry_run?, reverify? }` | Grounds the values of up to 8 companies already on the graph and reports the old and new values. Needs `BRIGHTDATA_API_KEY`. |

**Response.** Each round returns `{ key, cached, added, edges, round, log, ms }`. Until research is done it also returns `next_round`, `state`, `step` (a progress label), `background` (true for round 3) and `retry_after` (seconds to wait before polling again). The last round returns `done: true`, or `error` if no round found anything.

**Client** (`src/api/backend.js`). `api.lookup(name, onStep, { force, onUpdate })` awaits rounds 1 and 2, which take about a minute together, and shows each round's `step`. It then starts round 3 in the background and returns `{ key, cached, added, ms, researching }`. `onUpdate` fires whenever a round saves new relationships, and the app reloads the graph. If a follow-up round fails after earlier rounds found something, the lookup still counts as a success.

**Caching.** A lookup is reused for 72 hours unless `force` is set. If its rounds never finished (for example, the page was closed), the next lookup resumes at round 2. `Company.research_done` tracks this.

**Saving rules**:

- Round 1 refreshes. It replaces what an earlier lookup saved between the same two companies.
- Rounds 2 and 3 only add or improve. A better source replaces a worse one: an article beats Crunchbase, which beats the model's web search. A missing amount gets filled in. Nothing is removed.
- `owner`, `investment` and `venture` count as the same capital relationship when matching.
- Curated (seed) edges are never changed.
- Writes go in bulk or 3 at a time, because Base44 rate-limits bursts of one-by-one calls.

**Without Bright Data secrets**, a lookup is a single round that uses the model's own web search. Its edges are marked `llm_web`, as before.

### Module split

`entry.ts` now holds only the rounds and the saving rules. The rest moved into new files:

| File | Contents |
|---|---|
| `brightdata.ts` | The `BrightData` client (SERP API, Web Unlocker, Web Scraper trigger and snapshot) and `searchAndRead`. It runs at most 8 searches at once. Once the first search returns, the others get 10 s more and are then aborted. Requests still running when a round ends are aborted rather than left running (and billed). Long articles are cut to their opening plus the passages about deals and investors. |
| `crunchbase.ts` | Finds the profile URL with a `site:crunchbase.com/organization` search and turns the record into candidate edges, most important first. |
| `extract.ts` | The extraction prompt and schema, and validation: every edge must touch the company, cite a document we read and, when we have its text, quote it. |
| `valuation.ts` | Value grounding (§3). |

---

## 3. Grounded company values

**Why.** Circle size, and how strongly a shock travels along deals with an amount, both depend on a company's value. Before this PR that value was curated or a model estimate, and the app didn't say which.

### How a value is chosen (`valuation.ts`)

Each company gets four Google searches: valuation, funding news and market cap, each limited to the past year, plus one plain search. The model lists every figure the results state, and code keeps a figure only if all of these hold:

- its quote is in a result that names the company itself, not a namesake or an arm ("Databricks Ventures" is not Databricks);
- its amount is a number in the quote, in US dollars;
- it is an actual value, not an estimate, target or round still in talks ("aiming for", "mulls", "could value"). A figure the text dates before publication counts as a past event, so it is exempt from this check;
- it has a date, either stated in the text or the page's publication date. An earlier value mentioned for comparison ("up from $45 billion") is only kept if the text dates it;
- for a market cap, the date is within the last 45 days.

The newest qualifying value wins if a trusted source states it (a major outlet, a market-data site, SEC, Wikipedia or the company's own site) or two different sites do.

### Precedence

A grounded value (`article`) beats a curated one (`seed`), which beats a model estimate (`llm_estimate`). A newer grounded value replaces an older one. When a grounded value replaces a curated one, the curated value is kept in `seed_value_usd`. A lookup always re-grounds the company being looked up. In round 2, counterparties on deals with an amount are re-grounded if they have no grounded value or theirs is older than 90 days. **Details** shows the quote, date, basis and a link to the source. Where no page states a value, it says the value is curated or estimated.

### Auditing values across the graph

```bash
BASE44_APP_ID=<app id> node scripts/ground-values.mjs                 # dry run: report only
BASE44_APP_ID=<app id> node scripts/ground-values.mjs --apply         # save new values
BASE44_APP_ID=<app id> node scripts/ground-values.mjs --keys stripe,nvidia --verbose
BASE44_APP_ID=<app id> node scripts/ground-values.mjs --reverify      # redo values grounded by earlier, looser rules
BASE44_APP_ID=<app id> node scripts/ground-values.mjs --shard 0/2     # split the run across two processes
```

`--verbose` prints every figure the model proposed, with the reason it was kept or rejected. Funds and VC firms (`kind: "investor"`) have no valuation and are skipped.

---

## 4. Data model changes

**`Company`** (`base44/entities/Company.jsonc`), all fields optional:

| Field | Meaning |
|---|---|
| `value_source` | `seed`, `article` or `llm_estimate`. Empty on older rows, which the app reads as `seed` for seed companies and as an estimate otherwise. |
| `value_as_of` | The date the value applies to (`YYYY-MM` or `YYYY-MM-DD`) |
| `value_basis` | `funding_round`, `tender_offer`, `ipo`, `acquisition`, `market_cap` or `other` |
| `value_source_url`, `value_evidence` | The page that states the value, and a short quote from it |
| `seed_value_usd` | The curated value, kept when a grounded value replaced it |
| `crunchbase_url` | The Crunchbase profile the last lookup used |
| `research_done` | When the last lookup's rounds finished. It is older than `last_fetched` while rounds are still running. |

**`Relationship`** (`base44/entities/Relationship.jsonc`): `origin` gains `crunchbase`, for an edge listed on the Crunchbase profile with no article behind it. For those edges, `source_url` is the profile.

`companyKey` (`base44/shared/seed.js`) also strips `PBC` now, so "Anthropic PBC" and "Anthropic" get the same key.

---

## 5. Rename

`Ripple` → `Orbit` in `base44/config.jsonc`, `package.json`, the deploy commands in the README (`cd orbit`, `base44 link --create --name orbit`) and both `PROMPT_*.md` files.

Some places still say Ripple: the README heading, the page `<title>` in `index.html` and the deployed site's URL.

---

## Scripts

| Script | Purpose |
|---|---|
| `scripts/ground-values.mjs` | **New.** Audits or refreshes values across the graph (see §3). |
| `scripts/investor-recall.mjs` | **Updated.** Follows the research rounds, including Crunchbase polls, and counts only edges this lookup wrote. It compares the investors found with publicly reported ones for Waymo, Anthropic, Stripe and Databricks. Run it with `BASE44_APP_ID=<app id> node scripts/investor-recall.mjs [Company] [--runs N]`. |
| `scripts/.audit.mjs` | **New, hidden.** A one-off report of value sources: portfolio holdings, the 20 largest companies, stale market caps, values still curated, and the sites cited. |
| `PROMPT_valuations_deep_research.md` | **New.** A prompt for a separate research session on sourcing valuations. |

---

## Deploying this PR

The Bright Data secrets are unchanged (`BRIGHTDATA_API_KEY`, `BRIGHTDATA_SERP_ZONE`, `BRIGHTDATA_UNLOCKER_ZONE`). Crunchbase is collected through the same API key with Bright Data's Web Scraper API (dataset `gd_l1vijqt9jfj7olije`), so that dataset has to be enabled on the account. It costs about $1.50 per 1,000 records.

```bash
npm install                    # picks up d3-transition
npm run build
base44 entities push --yes     # new Company fields and the crunchbase origin
base44 deploy                  # functions and site
```

To redeploy only the lookup function: `base44 functions deploy lookupCompany`.

Existing data needs no migration: rows without `value_source` are read as curated or estimated. To ground values that are already on the graph, run `scripts/ground-values.mjs` as a dry run first, then with `--apply`.

---

## Test plan

- [ ] `npm install && npm run build`
- [ ] `base44 deploy`, then open the site. It opens on the money loop, and the Key, Risks and What if panels work.
- [ ] On a phone-width window, the Inspector is a bottom sheet and the Key and map controls stay clear of it.
- [ ] Look up a new company. The rounds report progress, edges appear, and Crunchbase edges arrive later, shown as "Crunchbase profile".
- [ ] Close the page during a lookup and look the company up again: research resumes from round 2.
- [ ] Details shows a quoted, linked source for grounded values, and labels curated and estimated ones.
- [ ] `node scripts/ground-values.mjs` (dry run) reports values without writing anything.

---

## Notes for reviewers

- **`dist-fold/` is committed** (built `index.html`, JS and CSS). `.gitignore` covers `dist` but not `dist-fold`, so this build output probably shouldn't be in the PR.
- **The main README is out of date in one place**: its "How it works" table says value grounding runs two Google searches per company. `valuation.ts` runs four.
- **Default app IDs differ** between scripts. `ground-values.mjs` and `investor-recall.mjs` fall back to one app ID when `BASE44_APP_ID` isn't set, and `.audit.mjs` hard-codes a different one. Set `BASE44_APP_ID` explicitly.
- **Folding busy companies** is in the UI but not in the PR description.
