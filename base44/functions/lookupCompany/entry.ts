// Live company lookup: web search (Bright Data SERP API) -> read the top articles
// (Bright Data Web Unlocker, as markdown) -> LLM extracts relationships with a quote
// and source for each -> keep only sourced edges that touch the company -> save.
//
// Secrets: BRIGHTDATA_API_KEY, BRIGHTDATA_SERP_ZONE, BRIGHTDATA_UNLOCKER_ZONE.
// Without them it falls back to InvokeLLM's own internet search (marked "llm_web").

import { createClientFromRequest } from "npm:@base44/sdk@0.8.41";
import { secrets } from "base44:runtime";
import { companyKey, KNOWN_COMPANIES } from "../../shared/seed.js";

const TYPES = ["owner", "investment", "venture", "hardware", "cloud", "software", "supplier", "acquisition", "partnership", "competitor"];
// No money changes hands, so the direction carries no meaning: stored with the looked-up company as source.
const UNDIRECTED = new Set(["partnership", "competitor"]);
const CACHE_HOURS = 72;
const MAX_ARTICLES_FAST = 8;
const ARTICLE_CHARS = 10000;
// Passages worth keeping when an article is longer than ARTICLE_CHARS: investor lists
// and supplier/customer deals often sit deep in a page (e.g. Wikipedia, long news features).
const RELEVANT = /(invest|led by|co-led|participat|funding|raised|raises|round|backer|valuation|owner|owned|subsidiary|parent|stake|acqui|partner|customer|client|supplier|supplies|supplied|vendor|manufactur|built by|sources|purchas|buys|bought|order|fleet|cloud|chips?\b|contract|agreement|deal)/gi;
const SKIP_HOSTS = /(youtube\.com|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|reddit\.com|linkedin\.com\/in\/|glassdoor\.|indeed\.)/i;

function secret(name: string): string | undefined {
  try {
    return secrets.get(name) || undefined;
  } catch {
    return Deno.env.get(name) || undefined;
  }
}

async function brightData(apiKey: string, zone: string, url: string, extra: Record<string, unknown> = {}, timeoutMs = 25000) {
  const res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ zone, url, format: "raw", ...extra }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Bright Data ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.text();
}

// Promise.allSettled that stops waiting early: when `enough` promises have fulfilled it
// waits at most `graceMs` for the rest, and it never waits longer than `hardMs`.
// (doubled while nothing has come back). Whatever is still pending then counts as rejected.
function settleFast<T>(promises: Promise<T>[], { enough, graceMs, hardMs, label }: { enough: number; graceMs: number; hardMs: number; label: string }) {
  return new Promise<PromiseSettledResult<T>[]>((resolve) => {
    const out: (PromiseSettledResult<T> | undefined)[] = promises.map(() => undefined);
    let settled = 0, ok = 0, done = false, grace: number | undefined;
    const start = Date.now();
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(hard);
      clearTimeout(grace);
      resolve(out.map((r) => r || { status: "rejected", reason: new Error(label) }));
    };
    // With nothing back at all, give up only at the requests' own timeout: an empty
    // result is worse than a slow one.
    let hard = setTimeout(function cut() {
      if (ok === 0 && settled < promises.length && Date.now() - start < hardMs * 2) hard = setTimeout(cut, 1000);
      else finish();
    }, hardMs);
    promises.forEach((p, i) =>
      p.then(
        (value) => { out[i] = { status: "fulfilled", value }; ok++; },
        (reason) => { out[i] = { status: "rejected", reason }; },
      ).finally(() => {
        settled++;
        if (settled === promises.length) finish();
        else if (ok >= enough && grace === undefined) grace = setTimeout(finish, graceMs);
      }),
    );
    if (!promises.length) finish();
  });
}

// The one known key within a typo's reach of `key` (edit distance 1, or 2 for longer
// names (8+ letters), counting a swap of neighbouring letters as one edit); none if it's ambiguous.
function closestKey(key: string, keys: string[]): string | null {
  const max = key.length >= 8 ? 2 : 1;
  const dist = (a: string, b: string) => {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  };
  let best: string | null = null, bestD = max + 1, tie = false;
  for (const k of keys) {
    const dd = dist(key, k);
    if (dd < bestD) [best, bestD, tie] = [k, dd, false];
    else if (dd === bestD) tie = true;
  }
  return best && !tie ? best : null;
}

// One retry for quick failures (empty or bad responses); a timeout is not retried.
async function brightDataRetry(apiKey: string, zone: string, url: string, extra: Record<string, unknown> = {}, timeoutMs = 30000) {
  const t0 = Date.now();
  try {
    const out = await brightData(apiKey, zone, url, extra, timeoutMs);
    if (extra.data_format || out.trim().startsWith("{")) return out;
    throw new Error("empty search response");
  } catch (err) {
    if ((err as Error)?.name === "TimeoutError" || Date.now() - t0 > timeoutMs * 0.6) throw err;
    return await brightData(apiKey, zone, url, extra, timeoutMs);
  }
}

// Keep the start of the article plus the passages around deal and investor language.
function relevantText(text: string, max = ARTICLE_CHARS) {
  text = text.replace(/\n{3,}/g, "\n\n");
  if (text.length <= max) return text;
  const head = 2000;
  const spans: [number, number][] = [];
  for (const m of text.matchAll(RELEVANT)) {
    const a = Math.max(head, (m.index ?? 0) - 600);
    const b = Math.min(text.length, (m.index ?? 0) + 600);
    if (spans.length && a <= spans[spans.length - 1][1]) spans[spans.length - 1][1] = b;
    else spans.push([a, b]);
  }
  let out = text.slice(0, head);
  for (const [a, b] of spans) {
    if (out.length >= max) break;
    out += "\n…\n" + text.slice(a, Math.min(b, a + (max - out.length)));
  }
  return out;
}

type Doc = { id: number; url: string; title: string; text: string };

// `deep` is for pre-filling the cache, where nobody is waiting: read more articles and
// wait for slow searches and pages instead of skipping them. (A stronger extraction model
// took ~2 min on 16 articles and pushed big companies past the function time limit.)
async function searchAndRead(name: string, log: string[], deep = false): Promise<Doc[]> {
  const MAX_ARTICLES = deep ? 14 : MAX_ARTICLES_FAST;
  const apiKey = secret("BRIGHTDATA_API_KEY")!;
  const serpZone = secret("BRIGHTDATA_SERP_ZONE") || "serp_api1";
  const unlockerZone = secret("BRIGHTDATA_UNLOCKER_ZONE") || "web_unlocker1";
  // Plain-language queries: Google answers them faster and more reliably than long
  // OR chains, and "X investors" surfaces the company's own funding announcements.
  // Two of them are about where the money goes (suppliers, cloud, chips, the company's own
  // investments and acquisitions) and who pays it (customers); all run in parallel.
  const queries = [
    `${name} investors funding round`,
    `${name} parent company owner`,
    `${name} suppliers manufacturing partner cloud contract`,
    `${name} customers acquisitions investments deals`,
    // The biggest commercial deals of a large company (multi-year compute or chip contracts)
    // are news stories that the generic queries above rank below its funding coverage.
    `${name} signs multi-year billion deal agreement`,
  ];
  const t0 = Date.now();
  // Google via Bright Data sometimes hangs on one query: once all but one are back, wait
  // at most 2 s for the last one, and never more than 14 s in all.
  const serps = await settleFast(
    queries.map((q) => brightDataRetry(apiKey, serpZone, `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=us&num=10&brd_json=1`, {}, deep ? 30000 : 28000)),
    deep ? { enough: queries.length, graceMs: 0, hardMs: 30000, label: "slow search skipped" } : { enough: queries.length - 1, graceMs: 2000, hardMs: 14000, label: "slow search skipped" },
  );
  const docs: Doc[] = [];
  const seen = new Set<string>();
  const capital = /invest|rais|fund|round|backer|valuation/i;
  const snippets: string[] = [];
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  // Interleave the queries' results so each query gets some of the reading budget.
  const lists: any[][] = [];
  for (const [i, r] of serps.entries()) {
    if (r.status !== "fulfilled") {
      log.push(`search failed (${queries[i]}): ${String(r.reason).slice(0, 120)}`);
      continue;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(r.value);
    } catch {
      continue;
    }
    lists.push([...(parsed.organic || []), ...(parsed.news || [])]);
  }
  const candidates: Doc[] = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) {
    for (const list of lists) {
      const o = list[i];
      const link = o?.link || o?.url;
      if (!link || seen.has(link) || SKIP_HOSTS.test(link)) continue;
      seen.add(link);
      snippets.push(`${o.title || ""} — ${o.description || o.snippet || ""} (${link})`);
      candidates.push({ id: 0, url: link, title: o.title || link, text: "" });
    }
  }
  // The company's own site (its newsroom/blog) comes first: funding posts list every investor.
  const own = companyKey(name);
  const isOwn = (u: string) => own.length > 2 && companyKey(host(u).split(".").slice(-2, -1)[0] || "") === own;
  const funding = (d: Doc) => capital.test(d.url + " " + d.title);
  const ownDocs = candidates.filter((d) => isOwn(d.url)).sort((a, b) => Number(funding(b)) - Number(funding(a))).slice(0, 3);
  // At most half the reading budget goes to funding articles, so suppliers and customers get read too.
  let fundingLeft = Math.ceil((MAX_ARTICLES + 2) / 2);
  const ordered = [...ownDocs, ...candidates.filter((d) => !isOwn(d.url))];
  const picked = ordered.filter((d) => !funding(d) || fundingLeft-- > 0);
  docs.push(...[...picked, ...ordered.filter((d) => !picked.includes(d))].slice(0, MAX_ARTICLES + 2));
  log.push(`search: ${seen.size} results from ${lists.length}/${queries.length} queries in ${Date.now() - t0}ms`);

  // Read the top articles in parallel; keep whichever come back in time.
  const t1 = Date.now();
  const toRead = docs.slice(0, MAX_ARTICLES + 2);
  // Once most pages are in, a slow site isn't worth holding the whole lookup for.
  const pages = await settleFast(
    toRead.map((d) => brightData(apiKey, unlockerZone, d.url, { data_format: "markdown" }, deep ? 25000 : 24000)),
    deep ? { enough: toRead.length, graceMs: 0, hardMs: 25000, label: "slow page skipped" } : { enough: MAX_ARTICLES - 2, graceMs: 2000, hardMs: 12000, label: "slow page skipped" },
  );
  pages.forEach((p, i) => {
    if (p.status === "fulfilled") toRead[i].text = relevantText(p.value);
  });
  const read = toRead.filter((d) => d.text.length > 400).slice(0, MAX_ARTICLES);
  log.push(`read: ${read.length}/${toRead.length} articles in ${Date.now() - t1}ms (${read.map((d) => host(d.url)).join(", ")})`);

  // Search snippets are evidence too (short, but cheap and often name the deal).
  read.push({ id: 99, url: "search-snippets", title: "Search result snippets", text: snippets.join("\n").slice(0, 6000) });
  return read.map((d, i) => ({ ...d, id: d.id === 99 ? 99 : i + 1 }));
}

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    company: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: { type: "string", enum: ["public", "private", "investor"] },
        sector: { type: "string" },
        value_usd: { type: "number", description: "Market cap or latest valuation in USD, 0 if unknown" },
        value_doc_id: { type: "number", description: "Id of the document that states value_usd, 0 if it isn't stated in one" },
        ticker: { type: "string", description: "Stock ticker if publicly traded" },
        description: { type: "string", description: "One sentence" },
        parent: {
          type: "object",
          description: "Majority owner or parent company, only if a document states it",
          properties: {
            name: { type: "string" },
            kind: { type: "string", enum: ["public", "private", "investor"] },
            value_usd: { type: "number", description: "The parent's market cap or valuation in USD, 0 if unknown" },
            ticker: { type: "string", description: "Stock ticker if publicly traded" },
            relation: { type: "string", description: "e.g. 'majority owner', 'parent company', 'wholly owned subsidiary of'" },
            doc_id: { type: "number" },
            evidence: { type: "string", description: "Short verbatim quote" },
          },
        },
      },
      required: ["name"],
    },
    funding_rounds: {
      type: "array",
      description: "Every funding round of the company of interest that the documents describe",
      items: {
        type: "object",
        properties: {
          round: { type: "string", description: "e.g. 'Series C', 'external round'" },
          date: { type: "string", description: "YYYY-MM or YYYY-MM-DD" },
          amount_usd: { type: "number", description: "Total size of the round in USD, 0 if not stated" },
          lead_investors: { type: "array", items: { type: "string" }, description: "Every investor said to lead or co-lead" },
          other_investors: { type: "array", items: { type: "string" }, description: "Every other investor named as participating, existing or new" },
          doc_id: { type: "number" },
          evidence: { type: "string", description: "Short verbatim quote naming the round" },
        },
        required: ["lead_investors", "other_investors", "doc_id"],
      },
    },
    counterparties: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          kind: { type: "string", enum: ["public", "private", "investor"], description: "'investor' for VC, PE, asset managers and funds" },
          sector: { type: "string" },
          value_usd: { type: "number", description: "0 if unknown" },
          value_doc_id: { type: "number", description: "Id of the document that states value_usd, 0 if it isn't stated in one" },
          ticker: { type: "string", description: "Stock ticker if publicly traded" },
        },
        required: ["name"],
      },
    },
    relationships: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string", description: "Company the money flows FROM (investor, buyer, customer, acquirer)" },
          target: { type: "string", description: "Company the money flows TO (investee, supplier, seller, acquired)" },
          type: { type: "string", enum: TYPES },
          amount_usd: { type: "number", description: "Deal size in USD, 0 if not stated" },
          label: { type: "string", description: "Callout under 70 characters, e.g. 'Nvidia to invest up to $100B in OpenAI'" },
          date: { type: "string", description: "YYYY-MM or YYYY-MM-DD if stated" },
          doc_id: { type: "number", description: "Id of the document that states it" },
          evidence: { type: "string", description: "Short verbatim quote from that document" },
          confidence: { type: "number", description: "0 to 1" },
        },
        required: ["source", "target", "type", "doc_id", "evidence"],
      },
    },
  },
  required: ["company", "relationships"],
};

function extractionPrompt(name: string, docs: Doc[] | null) {
  const rules = `You map business relationships for venture capital analysts.
Company of interest: "${name}".
Funding: put every funding round of "${name}" in funding_rounds and list EVERY investor the documents name for it, one name per entry: leads in lead_investors, everyone else ("with participation from", "existing investors", "also joined") in other_investors. If a document lists 15 investors, return all 15. The round total belongs to the round only, never to a single investor. Do not repeat round investors in relationships.
Ownership: if a document says "${name}" is owned by, a subsidiary of, or majority-owned by another company, fill company.parent, including its kind and market value.
List every other concrete relationship between "${name}" and another named company or investor in relationships. Cover both directions of money, not just who funds "${name}":
- Money OUT of "${name}" (source "${name}"): companies "${name}" invested in ("investment") or acquired ("acquisition"); its suppliers, manufacturers and vehicle/component/equipment makers ("supplier"); chips/hardware it buys ("hardware"); its cloud or compute providers ("cloud"); software or technology it licenses FROM others ("software").
- Money IN to "${name}" (target "${name}"): direct investments outside a round ("investment" for corporate investors, "venture" for VC funds); customers that buy from it or license its technology (type by what they buy: "supplier" for goods/services, "cloud", "hardware" or "software").
If a document only says two companies "partner" without saying who supplies or pays whom, use "partnership".
- No money either way: "partnership" only when neither side pays the other (joint development, integration, distribution or ride-hailing tie-ups with no stated payment), and named "competitor"s.
Direction rule: source is who pays (investor, buyer, customer, acquirer); target is who receives the money. E.g. "<A> manufactures products for ${name}" is source "${name}", target <A>, type "supplier"; "${name} runs on <B>'s cloud" is source "${name}", target <B>, type "cloud"; "<C> signed a contract to buy from ${name}" is source <C>, target "${name}".
Use canonical company names (e.g. "Nvidia", not "NVIDIA Corporation"; "Andreessen Horowitz", not "a16z"). Add every investor and counterparty to counterparties with its kind. Skip people, governments and unnamed parties.
Only include relationships the documents actually state; do not use outside knowledge. Copy a short verbatim quote as evidence.
Ignore news on the page that is about other companies and does not involve "${name}". Skip deals that were called off, blocked or only rumored.
Also give "${name}"'s and each counterparty's market value or latest valuation in USD: if a document states it (e.g. "valued at $126 billion"), set value_doc_id to that document; otherwise give the figure you know with value_doc_id 0. Give the stock ticker of every public company.`;
  if (!docs) return rules.replace("Only include relationships the documents actually state; do not use outside knowledge. Copy a short verbatim quote as evidence.", "Search the web. For each relationship, funding round and parent give the URL of the article that states it as evidence.");
  return `${rules}\n\nDocuments:\n${docs.map((d) => `\n[doc ${d.id}] ${d.title}\nURL: ${d.url}\n${d.text}`).join("\n")}`;
}

const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function fmtUsd(n: number) {
  if (n >= 1e9) return `$${+(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(0)}M`;
  return `$${Math.round(n)}`;
}

// Fragments the model sometimes returns instead of an investor's name.
const GENERIC = /^(capital|ventures?|partners|investors?|management|funds?|others|existinginvestors|newinvestors|and|various|.{0,1})$/;

// Run fn over items, a few at a time.
async function pool<T>(items: T[], fn: (item: T) => Promise<unknown>, size = 3) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function whenLabel(date?: string) {
  const m = String(date || "").match(/^(\d{4})(?:-(\d{2}))?/);
  if (!m) return "";
  return m[2] ? `${MONTHS[Number(m[2]) - 1] || ""} ${m[1]}`.trim() : m[1];
}

// Market values come from, in order: a stock quote (public companies), the articles the
// lookup already read, and a Google search per company through Bright Data, run in the
// background after the map is shown. The known-companies table is only a display fallback.
const VALUE_SCHEMA = {
  type: "object",
  properties: {
    companies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Exactly as given" },
          value_usd: { type: "number", description: "Market cap if public, else latest reported valuation, in USD; 0 if the results don't state one" },
          as_of: { type: "string", description: "YYYY-MM or YYYY-MM-DD of the figure if stated" },
          source_url: { type: "string", description: "URL of the result that states the figure" },
        },
        required: ["name", "value_usd"],
      },
    },
  },
};

type Value = { value_usd: number; as_of?: string; source_url?: string; source?: string };
type ValueTarget = { key: string; name: string; sector?: string; ticker?: string };
const VALUE_TTL_DAYS = 7;

// Public companies: market cap from Financial Modeling Prep, a second or two for all of them.
async function quoteValues(list: ValueTarget[], log: string[]): Promise<Map<string, Value & { ticker: string }>> {
  const out = new Map<string, Value & { ticker: string }>();
  const apiKey = secret("FMP_API_KEY");
  if (!apiKey || !list.length) return out;
  const t0 = Date.now();
  const fmp = async (path: string, params: Record<string, string>) => {
    const u = new URL(`https://financialmodelingprep.com/stable/${path}`);
    for (const [k, v] of Object.entries({ ...params, apikey: apiKey })) u.searchParams.set(k, v);
    const res = await fetch(u, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`FMP ${res.status}`);
    return await res.json();
  };
  const one = async (c: ValueTarget) => {
    try {
      let symbol = String(c.ticker || "").trim().toUpperCase().replace(/^[A-Z]+:/, "");
      if (!symbol) {
        // Only an exact name match in US dollars, so "Bridge" never picks up an unrelated listing.
        const hits = await fmp("search-name", { query: c.name, limit: "10" });
        symbol = (hits || []).find((h: any) => companyKey(h.name) === c.key && h.currency === "USD")?.symbol || "";
      }
      if (!symbol) return;
      const p = (await fmp("profile", { symbol }))?.[0];
      if (!(p?.marketCap > 0) || (p.currency && p.currency !== "USD")) return;
      out.set(c.key, {
        value_usd: p.marketCap, ticker: symbol, as_of: new Date().toISOString().slice(0, 10),
        source: `Financial Modeling Prep (${symbol})`, source_url: `https://finance.yahoo.com/quote/${symbol}`,
      });
    } catch (err) {
      log.push(`quote failed for ${c.name}: ${String(err).slice(0, 60)}`);
    }
  };
  // Never hold the lookup up for more than a few seconds; whatever is back by then counts.
  await Promise.race([Promise.all(list.map(one)), new Promise((r) => setTimeout(r, 6000))]);
  log.push(`quotes: ${out.size}/${list.length} market caps in ${Date.now() - t0}ms`);
  return out;
}

// Bright Data search for the rest. Searches that fail or time out come back in `failed`
// so the caller can try them again instead of treating them as "not found".
async function searchValues(base44: any, list: ValueTarget[], log: string[]): Promise<{ values: Map<string, Value>; failed: string[] }> {
  const out = new Map<string, Value>();
  const failed: string[] = [];
  if (!list.length) return { values: out, failed };
  const names = list.map((c) => c.name);
  // The sector disambiguates common words (Bun the JS runtime, not a memecoin called Bun).
  const described = list.map((c) => (c.sector ? `${c.name} (${c.sector})` : c.name));
  const keyByName = new Map(list.map((c) => [norm(c.name), c.key]));
  const t0 = Date.now();
  const apiKey = secret("BRIGHTDATA_API_KEY");
  const rules = `For each company below give its current market capitalization in USD if it is publicly traded, otherwise its latest reported valuation in USD. Use the most recent figure. Convert other currencies and units (e.g. "4.1T", "$126 billion") to plain USD numbers. Return 0 if no figure is stated or the results are about a different company or token with the same name (check the sector in brackets); never guess. Return every company, with its name exactly as given (without the bracketed sector).`;
  let result: any;
  if (apiKey) {
    const serpZone = secret("BRIGHTDATA_SERP_ZONE") || "serp_api1";
    const blocks: string[] = [];
    await pool(list, async ({ key: k, name: n, sector }) => {
      try {
        const raw = await brightDataRetry(apiKey, serpZone, `https://www.google.com/search?q=${encodeURIComponent(`${n} ${sector || ""} market cap valuation`.replace(/ +/g, " "))}&hl=en&gl=us&num=8&brd_json=1`, {}, 30000);
        const j = JSON.parse(raw);
        const lines = [
          ...[j.knowledge, j.answer_box, j.top_stories].filter(Boolean).map((x: any) => JSON.stringify(x).slice(0, 600)),
          ...[...(j.organic || [])].slice(0, 6).map((o: any) => `${o.title || ""} — ${o.description || o.snippet || ""} (${o.link || o.url || ""})`),
        ];
        if (lines.length) blocks.push(`## ${n}\n${lines.join("\n")}`.slice(0, 2500));
      } catch (err) {
        failed.push(k);
        log.push(`value search failed for ${n}: ${String(err).slice(0, 80)}`);
      }
    }, 6);
    if (!blocks.length) return { values: out, failed };
    result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `${rules} Use only the search results below, and give the URL of the result that states each figure.\n\nCompanies: ${described.join("; ")}\n\nSearch results:\n${blocks.join("\n\n")}`,
      response_json_schema: VALUE_SCHEMA,
    });
  } else {
    result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `${rules} Search the web and give the URL of the page that states each figure.\n\nCompanies: ${described.join("; ")}`,
      response_json_schema: VALUE_SCHEMA,
      add_context_from_internet: true,
    });
  }
  for (const c of result?.companies || []) {
    if (!(c?.value_usd >= 1e6)) continue;
    if (!c.source_url) continue;
    out.set(keyByName.get(norm(c.name)) || companyKey(c.name), { value_usd: c.value_usd, ...(c.as_of ? { as_of: String(c.as_of) } : {}), source_url: String(c.source_url) });
  }
  log.push(`values: ${out.size}/${names.length} market values found in ${Date.now() - t0}ms${failed.length ? `, ${failed.length} searches to retry` : ""}`);
  return { values: out, failed };
}

const valuePatch = (v: Value & { ticker?: string }) => ({
  value_usd: v.value_usd, value_as_of: v.as_of || "", value_source_url: v.source_url || "", value_source: v.source || "",
  value_fetched: new Date().toISOString(), ...(v.ticker ? { ticker: v.ticker } : {}),
});
// A sourced value younger than VALUE_TTL_DAYS isn't searched again.
const hasFreshValue = (c: any) => !!c?.value_source_url && !!c.value_fetched && Date.now() - Date.parse(c.value_fetched) < VALUE_TTL_DAYS * 864e5;

Deno.serve(async (req) => {
  const started = Date.now();
  const log: string[] = [];
  try {
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;
    const { name: rawName, force = false, deep = false, action, keys: only } = await req.json();

    // Background value fill, called by the app right after a map is shown: quotes for public
    // companies, then a Bright Data search for the rest. A figure is only ever replaced by a
    // newer sourced one; searches that failed come back in `retry`.
    if (action === "fillValues") {
      const all = await db.Company.list("-created_date", 5000);
      const todo = all.filter((c: any) => c.kind !== "investor" && c.origin !== "seed" && !hasFreshValue(c) && (!only || only.includes(c.key)));
      const target = (c: any): ValueTarget => ({ key: c.key, name: c.name.replace(/\s*\(.*\)/, ""), sector: c.sector, ticker: c.ticker });
      const quotes = await quoteValues(todo.filter((c: any) => c.kind === "public").map(target), log);
      const { values, failed } = await searchValues(base44, todo.filter((c: any) => !quotes.has(c.key)).map(target), log);
      const updates = todo
        .filter((c: any) => quotes.has(c.key) || values.has(c.key))
        .map((c: any) => [c.id, valuePatch(quotes.get(c.key) || values.get(c.key)!)] as [string, any]);
      await pool(updates, ([id, patch]) => db.Company.update(id, patch));
      return Response.json({ todo: todo.length, filled: updates.length, retry: failed, log, ms: Date.now() - started });
    }
    let name = String(rawName || "").trim().slice(0, 80);
    if (!name) return Response.json({ error: "name is required" }, { status: 400 });
    const typed = companyKey(name);
    let key = typed;
    let existing = (await db.Company.filter({ key }))[0];
    // A misspelling ("nvdia") resolves to the company already on the map instead of
    // starting a new one; whatever an earlier lookup saved under the misspelling goes.
    // A misspelling saved by an earlier lookup only gives way to a well-mapped company
    // (pre-filled or built in), so two real companies a letter apart don't merge.
    if (key.length >= 5 && !(existing && (existing.origin === "seed" || existing.prefilled))) {
      const all = await db.Company.list("-created_date", 5000);
      const known = (c: any) => existing?.last_fetched ? c.prefilled || c.origin === "seed" : c.last_fetched;
      const near = closestKey(key, all.filter((c: any) => c.key !== key && known(c)).map((c: any) => c.key));
      if (near) {
        log.push(`"${name}" read as ${near}`);
        key = near;
        const stray = existing;
        existing = all.find((c: any) => c.key === near);
        name = existing?.name?.replace(/\s*\(.*\)/, "") || name;
        if (stray && stray.origin !== "seed") {
          const strayEdges = [...(await db.Relationship.filter({ source: typed })), ...(await db.Relationship.filter({ target: typed }))];
          await pool(strayEdges, (r: any) => db.Relationship.delete(r.id), 5);
          await db.Company.delete(stray.id);
        }
      }
    }

    // Cache: a recent live lookup is reused unless the analyst forces a refresh.
    // A pre-filled company never expires: it was mapped thoroughly on purpose.
    if (!force && existing?.last_fetched && (existing.prefilled || Date.now() - Date.parse(existing.last_fetched) < CACHE_HOURS * 3600e3)) {
      log.push("cache hit");
      // Someone searched it: from now on its links belong on the background map too.
      if (!deep && !existing.searched) await db.Company.update(existing.id, { searched: true });
      return Response.json({ key, cached: true, log, ms: Date.now() - started });
    }

    const useBrightData = !!secret("BRIGHTDATA_API_KEY");
    let docs: Doc[] | null = null;
    if (useBrightData) {
      docs = await searchAndRead(name, log, deep);
    } else {
      log.push("BRIGHTDATA_API_KEY not set: using the LLM's own web search");
    }

    const t2 = Date.now();
    const result: any = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: extractionPrompt(name, docs),
      response_json_schema: EXTRACT_SCHEMA,
      ...(docs ? {} : { add_context_from_internet: true }),
    });
    log.push(`extract: ${result?.relationships?.length ?? 0} candidate relationships in ${Date.now() - t2}ms`);

    // Validate: every edge must touch the company, cite a document we actually read,
    // and (when we have the text) quote it.
    const docById = new Map((docs || []).map((d) => [d.id, d]));
    const edges: any[] = [];
    const byKey = new Map<string, any>();
    const names: Record<string, string> = {};
    const kinds: Record<string, string> = {};
    const info: Record<string, any> = {};
    for (const c of [result?.company, ...(result?.counterparties || [])]) if (c?.name) info[companyKey(c.name)] = c;
    // The parent is often left out of counterparties; without this it would be saved with no value.
    const p0 = result?.company?.parent;
    if (p0?.name) info[companyKey(p0.name)] = { ...p0, ...info[companyKey(p0.name)], value_usd: info[companyKey(p0.name)]?.value_usd || p0.value_usd };

    // Where a claim comes from: the article URL and a confidence, or null if it isn't sourced.
    const sourceFor = (doc_id: any, evidence: string, mustName?: string) => {
      let confidence = 0.7;
      if (!docs) {
        const url = (evidence || "").match(/https?:\/\/\S+/)?.[0] || "";
        return url ? { source_url: url, confidence: 0.6 } : null;
      }
      const d = docById.get(Number(doc_id));
      if (!d) return null;
      const text = norm(d.text);
      // An investor must actually be named in the article it was taken from.
      if (mustName) {
        const n = norm(mustName);
        const first = n.split(" ")[0];
        if (!text.includes(n) && !(first.length >= 4 && text.includes(` ${first} `))) return null;
      }
      let source_url = d.url === "search-snippets" ? "" : d.url;
      const quoted = evidence && text.includes(norm(evidence).slice(0, 60));
      confidence = quoted ? 0.85 : 0.6;
      if (!source_url) {
        // Snippet-only evidence: keep it, pointing at the snippet's own link if present.
        const probe = norm(evidence || mustName || "").slice(0, 40);
        const m = d.text.split("\n").find((line) => probe && norm(line).includes(probe));
        source_url = m?.match(/\((https?:[^)]+)\)$/)?.[1] || "";
      }
      return source_url ? { source_url, confidence } : null;
    };
    const addEdge = (e: any, sourceName: string, targetName: string) => {
      if (!e.source || !e.target || e.source === e.target || (e.source !== key && e.target !== key)) return false;
      if (byKey.has(e.key)) return false;
      names[e.source] ||= sourceName;
      names[e.target] ||= targetName;
      // Links found only by the cache pre-fill are drawn only around the company searched.
      e.prefilled = deep;
      byKey.set(e.key, e);
      edges.push(e);
      return true;
    };

    // 1. Parent / majority owner.
    const parent = result?.company?.parent;
    const parentKey = parent?.name ? companyKey(parent.name) : "";
    if (parentKey && parentKey !== key && !/^(na|none|independent|unknown|self|nil)$/.test(parentKey)) {
      const src = sourceFor(parent.doc_id, parent.evidence, parent.name);
      if (src) {
        const rel = String(parent.relation || "owner").toLowerCase();
        addEdge({
          key: `${parentKey}|owner|${key}`, source: parentKey, target: key, type: "owner",
          label: `${parent.name}: ${rel.includes("subsidiary") ? "parent company" : rel}`.slice(0, 90),
          ...src, evidence: String(parent.evidence || "").slice(0, 300), origin: docs ? "live" : "llm_web",
        }, parent.name, name);
      }
    }

    // 2. Funding rounds: one edge per investor, never carrying the round total.
    const rounds = (result?.funding_rounds || []).slice().sort((x: any, y: any) => String(y.date || "").localeCompare(String(x.date || "")));
    const roundTotals: number[] = [];
    let roundInvestors = 0;
    for (const r of rounds) {
      const amount = r.amount_usd > 0 ? r.amount_usd : 0;
      const investors = [
        ...(r.lead_investors || []).map((n: string) => ({ n, lead: true })),
        ...(r.other_investors || []).map((n: string) => ({ n, lead: false })),
      ];
      if (amount && investors.length > 1) roundTotals.push(amount);
      const what = [whenLabel(r.date), amount ? fmtUsd(amount) : "", "round"].filter(Boolean).join(" ");
      for (const { n, lead } of investors) {
        const k = companyKey(n);
        if (!k || k === key || GENERIC.test(k)) continue;
        const src = sourceFor(r.doc_id, r.evidence, n);
        if (!src) continue;
        if (k === parentKey) {
          // The owner investing again is part of the ownership line, not a separate edge.
          const own = byKey.get(`${parentKey}|owner|${key}`);
          if (own && !/round/.test(own.label)) own.label = `${own.label}; ${lead ? "led" : "joined"} ${what}`.slice(0, 90);
          continue;
        }
        const type = (info[k]?.kind || "investor") === "investor" ? "venture" : "investment";
        const ekey = `${k}|${type}|${key}`;
        const prev = byKey.get(ekey);
        if (prev) {
          // Same investor in an earlier round: count it in the label, keep the newest source.
          prev.rounds = (prev.rounds || 1) + 1;
          prev.label = `${prev.label.replace(/ \(\+\d+ earlier\)$/, "")} (+${prev.rounds - 1} earlier)`.slice(0, 90);
          continue;
        }
        kinds[k] ||= type === "venture" ? "investor" : "private";
        if (addEdge({
          key: ekey, source: k, target: key, type,
          label: `${lead ? "Led" : "Joined"} ${what}`.slice(0, 90),
          ...(r.date ? { date: String(r.date) } : {}),
          ...src, evidence: String(r.evidence || "").slice(0, 300), origin: docs ? "live" : "llm_web",
        }, n, name)) roundInvestors++;
      }
    }

    // 3. Everything else (partnerships, acquisitions, customers, direct investments).
    for (const r of result?.relationships || []) {
      if (!TYPES.includes(r.type) || r.type === "owner") continue;
      let [sName, tName] = [r.source, r.target];
      if (UNDIRECTED.has(r.type) && companyKey(tName) === key) [sName, tName] = [tName, sName];
      const s = companyKey(sName);
      const t = companyKey(tName);
      const other = s === key ? t : s;
      // Round investors were already added above; don't add them twice under another type.
      if ((r.type === "investment" || r.type === "venture") && (byKey.has(`${other}|venture|${key}`) || byKey.has(`${other}|investment|${key}`) || other === parentKey)) continue;
      const src = sourceFor(r.doc_id, r.evidence);
      if (!src) continue;
      // A round's total is never one investor's cheque.
      const amount = r.amount_usd > 0 && !roundTotals.some((x) => Math.abs(x - r.amount_usd) / x < 0.05) ? r.amount_usd : 0;
      addEdge({
        key: `${s}|${r.type}|${t}`, source: s, target: t, type: r.type,
        ...(amount ? { amount_usd: amount } : {}),
        label: String(r.label || "").slice(0, 90),
        ...(r.date ? { date: r.date } : {}),
        ...src, confidence: Math.min(src.confidence, Math.max(0.3, r.confidence ?? 0.8)),
        evidence: String(r.evidence || "").slice(0, 300), origin: docs ? "live" : "llm_web",
      }, sName, tName);
    }
    for (const e of edges) delete e.rounds;
    log.push(`kept: ${edges.length} sourced relationships (${rounds.length} rounds, ${roundInvestors} round investors${parentKey && byKey.has(`${parentKey}|owner|${key}`) ? ", owner" : ""})`);

    // Nothing sourced: report it and leave the cache alone so the next try searches again.
    if (!edges.length) {
      return Response.json({ key, error: `Couldn't find sourced relationships for ${name} this time${docs && docs.length <= 1 ? " (web search failed)" : ""}. Try again.`, log, ms: Date.now() - started });
    }

    // Upsert companies (the looked-up one plus every counterparty that survived).
    const keys = new Set([key, ...edges.flatMap((e) => [e.source, e.target])]);
    // Prefer a name that is the company itself over an alias of it (Alphabet, not "GV").
    const direct = (n?: string) => !!n && norm(n).replace(/ /g, "").startsWith(k0(n));
    const k0 = (n: string) => companyKey(n).slice(0, 4);
    const nameFor = (k: string) => {
      if (KNOWN_COMPANIES[k]?.name) return KNOWN_COMPANIES[k].name;
      if (k === key) return result?.company?.name || name;
      const options = [info[k]?.name, names[k], ...(result?.counterparties || []).filter((c: any) => companyKey(c?.name) === k).map((c: any) => c.name)].filter(Boolean);
      return options.find(direct) || options[0] || k;
    };
    // Read once, then write in bulk or a few at a time: Base44 rate-limits bursts of
    // one-by-one calls, which a lookup with 30+ investors easily triggers.
    const companyByKey = new Map((await db.Company.list("-created_date", 5000)).map((c: any) => [c.key, c]));
    const touching = [...(await db.Relationship.filter({ source: key })), ...(await db.Relationship.filter({ target: key }))];
    const relByKey = new Map(touching.map((r: any) => [r.key, r]));
    const changed = (found: any, patch: any) => Object.keys(patch).some((f) => found[f] !== patch[f]);

    // Market values: quotes for public companies (a few seconds at most) and figures the
    // articles state. Anything still missing is searched by the app in the background.
    const kindOf = (k: string) => KNOWN_COMPANIES[k]?.kind || info[k]?.kind || companyByKey.get(k)?.kind || kinds[k] || "private";
    const toQuote = [...keys].filter((k) => kindOf(k) === "public" && companyByKey.get(k)?.origin !== "seed" && !hasFreshValue(companyByKey.get(k)));
    const quotes = await quoteValues(toQuote.map((k) => ({ key: k, name: nameFor(k).replace(/\s*\(.*\)/, ""), ticker: info[k]?.ticker || companyByKey.get(k)?.ticker })), log);
    const stated = (k: string): Value | null => {
      const c = info[k];
      const d = docs && c?.value_usd > 0 ? docById.get(Number(c.value_doc_id)) : null;
      return d && d.url !== "search-snippets" ? { value_usd: c.value_usd, source_url: d.url } : null;
    };

    const newCompanies: any[] = [];
    const companyUpdates: [string, any][] = [];
    for (const k of keys) {
      const known = KNOWN_COMPANIES[k] || {};
      const found = companyByKey.get(k);
      const c = { ...info[k], kind: known.kind || info[k]?.kind };
      // Order of trust: a stock quote, a figure an article states, a fresh sourced figure
      // already saved, and only then the model's own unsourced figure (kept until the
      // background search replaces it).
      const sourced = quotes.get(k) || stated(k);
      const value = found?.origin === "seed" ? {}
        : sourced ? valuePatch(sourced)
        : hasFreshValue(found) ? {}
        : c.value_usd > 0 && !found?.value_source_url ? { value_usd: c.value_usd }
        : {};
      const patch: any = {
        ...(c.kind ? { kind: c.kind } : {}),
        ...(c.sector ? { sector: c.sector } : {}),
        ...value,
        ...(k === key ? { last_fetched: new Date().toISOString(), ...(deep ? { prefilled: true } : { searched: true }), ...(c.description ? { description: c.description } : {}) } : {}),
      };
      if (found) {
        // Fix a name that was saved under an alias on an earlier lookup.
        if (found.origin !== "seed" && !direct(found.name) && direct(nameFor(k))) patch.name = nameFor(k);
        if (changed(found, patch)) companyUpdates.push([found.id, patch]);
      } else {
        newCompanies.push({ key: k, name: nameFor(k), origin: "live", kind: kinds[k] || "private", ...patch });
      }
    }

    const newEdges: any[] = [];
    const edgeUpdates: [string, any][] = [];
    const edgeDeletes: string[] = [];
    for (const e of edges) {
      const found = relByKey.get(e.key);
      // A link someone already found by searching stays on the background map.
      if (found?.prefilled === false) e.prefilled = false;
      if (!found) newEdges.push(e);
      else if (found.origin === "seed") continue;
      else if (found.amount_usd && !e.amount_usd) {
        // Replace rather than update so a wrongly attributed amount is cleared.
        edgeDeletes.push(found.id);
        newEdges.push(e);
      } else if (changed(found, e)) edgeUpdates.push([found.id, e]);
    }
    // A refresh supersedes older live edges between the same two companies under another
    // type (e.g. an investor first saved as "investment" with the whole round's total).
    // A partnership or competitor saved the other way round on an older lookup is replaced too.
    const pairs = new Set(edges.map((e) => `${e.source}|${e.target}`));
    const fresh = new Set(edges.map((e) => e.key));
    const stale = touching.filter((r: any) => r.origin !== "seed" && !fresh.has(r.key) && (pairs.has(`${r.source}|${r.target}`) || (UNDIRECTED.has(r.type) && pairs.has(`${r.target}|${r.source}`))));
    edgeDeletes.push(...stale.map((r: any) => r.id));
    // The pre-fill also flags older unflagged links of this company, except links of a
    // company someone searched: those came from their search and stay on the map.
    if (deep) {
      const handled = new Set([...edgeDeletes, ...edgeUpdates.map(([id]) => id)]);
      const searched = (k: string) => !!companyByKey.get(k)?.searched;
      for (const r of touching) {
        if (r.origin !== "seed" && r.prefilled == null && !handled.has(r.id) && !fresh.has(r.key) && !searched(r.source) && !searched(r.target)) edgeUpdates.push([r.id, { prefilled: true }]);
      }
    }

    if (newCompanies.length) await db.Company.bulkCreate(newCompanies);
    await pool(companyUpdates, ([id, patch]) => db.Company.update(id, patch));
    await pool(edgeDeletes, (id) => db.Relationship.delete(id));
    if (newEdges.length) await db.Relationship.bulkCreate(newEdges);
    await pool(edgeUpdates, ([id, patch]) => db.Relationship.update(id, patch));
    if (stale.length) log.push(`replaced: ${stale.length} outdated relationships`);

    // The saved records go back with the answer, so the app can draw them even if a
    // read right after these writes doesn't see them yet.
    const savedCompanies = [...keys].map((k) => {
      const found = companyByKey.get(k);
      return found ? { ...found, ...(companyUpdates.find(([id]) => id === found.id)?.[1] || {}) } : newCompanies.find((c) => c.key === k);
    }).filter(Boolean);
    return Response.json({ key, cached: false, added: edges.length, companies: savedCompanies, relationships: edges, log, ms: Date.now() - started });
  } catch (err) {
    console.error(err);
    return Response.json({ error: String((err as Error)?.message || err), log }, { status: 500 });
  }
});
