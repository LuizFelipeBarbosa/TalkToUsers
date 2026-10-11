// Grounded company values: the latest valuation (private) or market cap (public), taken
// from pages that state it. Four Google searches per company (valuation, news and market
// cap in the past year, plus a plain one); the model lists every figure the results
// state, and code keeps a figure only if
//   - its quote is in a result about the company itself, not a namesake, a ticker that
//     happens to match, or an arm ("Databricks Ventures" is not Databricks; "RAMP" is
//     LiveRamp, not Ramp): the result's own text must contain the name, and the model,
//     told what the company is, must confirm the figure is about it,
//   - its amount is a number in the quote,
//   - it is in US dollars and an actual value: nothing in its sentence makes it an
//     estimate, a target or a round still in talks ("aiming for", "mulls", "could value").
//     A figure the text dates before the page was published is a past event ("the $965
//     billion valuation from its May 2026 funding"), so hedging nearby doesn't apply to it,
//   - it has a date: the one the text gives for the round, deal or price ("this year" is
//     the year), else the page's publication date. An earlier value mentioned for
//     comparison ("up from $45 billion") is only kept when the text dates it. A market cap
//     changes daily, so one older than MARKET_CAP_MAX_AGE_DAYS isn't a current value.
// The newest value then wins if a trusted source states it (a major outlet, a market-data
// site, SEC filings, Wikipedia, the company's own site) or two different sites do; a
// private company's market cap needs a trusted source (namesakes have tickers). When two
// different values were reported within a month of each other, the one more sites state
// wins ("xAI was valued at $250 billion" over the combined SpaceX–xAI at $1.25 trillion).

import { companyKey } from "../../shared/seed.js";
import type { BrightData } from "./brightdata.ts";
import { norm } from "./extract.ts";

export type Valuation = { key: string; amount_usd: number; as_of: string; url: string; evidence: string; basis: string };
// Every figure the model proposed and what verification made of it (for the dry-run report).
export type Candidate = { key: string; amount_usd: number; as_of: string; basis: string; url: string; quote: string; verdict: string };
// A company to value. `context` says what it is (sector, description, connections), so the
// model can tell it from namesakes; `kind` is what the graph thinks it is.
export type Target = { key: string; name: string; kind?: string; context?: string };
type Result = { url: string; text: string; date: string };

// Social sites, and Google redirect links (which hide the publisher).
const SKIP_HOSTS = /(youtube\.com|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|reddit\.com|linkedin\.com|quora\.com|google\.com\/goto)/i;
// Words that make a figure in the same sentence something other than an actual value:
// estimates, implied prices, targets, rounds being discussed or not yet closed.
const NOT_A_VALUE = /\b(estimat\w*|implied|will value|could|would|might|may|potential\w*|expect\w*|aim\w*|chas\w*|target\w*|seek\w*|eye(s|ing)?|mull\w*|weigh\w*|consider\w*|plan\w*|talks?|negotiat\w*|discuss\w*|explor\w*|pursu\w*|hop(e|es|ing)|in line for|on track)\b/i;
const MARKET_CAP_MAX_AGE_DAYS = 45;
// Statement bases, best first when two figures share a date.
const BASES = ["funding_round", "tender_offer", "ipo", "acquisition", "market_cap", "other"];
const TRUSTED = /(^|\.)(reuters\.com|bloomberg\.com|wsj\.com|ft\.com|cnbc\.com|techcrunch\.com|theinformation\.com|axios\.com|forbes\.com|fortune\.com|businessinsider\.com|nytimes\.com|washingtonpost\.com|apnews\.com|theverge\.com|wired\.com|economist\.com|marketwatch\.com|barrons\.com|finance\.yahoo\.com|sec\.gov|macrotrends\.net|companiesmarketcap\.com|nasdaq\.com|morningstar\.com|stockanalysis\.com|wikipedia\.org)$/;
// Words that don't tell companies apart. Every other word of a name must appear in the
// result: "Anduril" is Anduril Industries, but "Databricks" is not Databricks Ventures.
const GENERIC_WORDS = new Set(["inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "llc", "plc", "pbc", "ag", "sa", "gmbh", "the", "industries", "technologies", "technology", "labs", "lab", "ai", "systems", "group", "holdings", "holding", "global", "international", "platforms"]);

const SCHEMA = {
  type: "object",
  properties: {
    figures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          result: { type: "number", description: "Result number" },
          amount_usd: { type: "number", description: "The valuation or market cap in US dollars, as stated" },
          basis: { type: "string", enum: [...BASES, "estimate"], description: "What the figure comes from" },
          as_of: { type: "string", description: "YYYY-MM-DD, YYYY-MM or YYYY of the round, deal or price the figure comes from, if the text says; otherwise empty" },
          current: { type: "boolean", description: "false if the text mentions it as an earlier value for comparison (e.g. 'up from $45 billion')" },
          same_company: { type: "boolean", description: "false if the result is about a different company with a similar name or ticker" },
          quote: { type: "string", description: "Short verbatim quote from the result that states the figure" },
        },
        required: ["result", "amount_usd", "basis", "quote"],
      },
    },
  },
  required: ["figures"],
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

// A trusted source: a major business outlet, a market-data site, SEC filings, Wikipedia,
// or the company's own site.
function isTrusted(url: string, name: string) {
  const host = hostOf(url);
  const own = companyKey(name);
  return TRUSTED.test(host) || (own.length >= 3 && companyKey(host.split(".").slice(-2, -1)[0] || "") === own);
}

// The result's own words name the company; a ticker in parentheses or the URL doesn't count.
function namesCompany(r: Result, name: string) {
  const text = ` ${norm(r.text.replace(/\(.*?\)/g, " "))} `;
  const words = norm(name.replace(/\(.*?\)/g, "")).split(" ").filter((w) => w && !GENERIC_WORDS.has(w));
  return words.length > 0 && words.every((w) => text.includes(` ${w} `));
}

// A result's publication date: Google's date line ("Feb 24, 2026", "13 hours ago"), else a
// date in the URL path (/2026/02/24/).
function publishedDate(o: any): string {
  for (const e of o.extensions || []) {
    const text = String(e?.text || "");
    const abs = text.match(/^([A-Z][a-z]{2})[a-z]* (\d{1,2}), (\d{4})$/);
    if (abs && MONTHS.includes(abs[1].toLowerCase())) return `${abs[3]}-${pad(MONTHS.indexOf(abs[1].toLowerCase()) + 1)}-${pad(Number(abs[2]))}`;
    const rel = text.match(/^(\d+) (minute|hour|day|week|month|year)s? ago$/);
    if (rel) {
      const days = Number(rel[1]) * ({ minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365 } as Record<string, number>)[rel[2]];
      return isoDay(new Date(Date.now() - days * 864e5));
    }
  }
  const date = String(o.date || "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (date) return date;
  const path = String(o.link || "").match(/\/(20\d{2})\/(\d{2})(?:\/(\d{2}))?\//);
  return path ? `${path[1]}-${path[2]}${path[3] ? `-${path[3]}` : ""}` : "";
}

// Dollar amounts written in a quote ("$159 billion", "$5.555T", "Market Cap5.526T", "$65bn"),
// each with whether the words before it present it as an earlier value ("up from $45 billion").
function amountsIn(quote: string): { value: number; past: boolean }[] {
  const units: Record<string, number> = { trillion: 1e12, tn: 1e12, t: 1e12, billion: 1e9, bn: 1e9, b: 1e9, million: 1e6, mn: 1e6, m: 1e6 };
  return [...quote.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(trillion|tn|t|billion|bn|b|million|mn|m)\b/gi)].map((m) => ({
    value: Number(m[1].replace(/,/g, "")) * units[m[2].toLowerCase()],
    past: /\b(from|previously|prior|earlier|last|before|had been)\b[^$\d]*\$?\s*$/i.test(quote.slice(Math.max(0, (m.index ?? 0) - 40), m.index)),
  }));
}

function isUsd(quote: string) {
  return /\$|usd|dollar/i.test(quote) || !/[€£¥₹]|\b(eur|euro|gbp|pound|yen|yuan|rmb|rupee|inr|cad|aud|chf)\b/i.test(quote);
}

// The date a figure applies to, and whether the text states it: the model's reading if
// that year appears in the result and it isn't the publication date copied (a coarser
// date, like the year for "this year", counts as stated), else the publication date.
function dateFor(asOf: string, r: Result) {
  const stated = /^\d{4}(-\d{2}){0,2}$/.test(asOf) && (r.text + r.url + r.date).includes(asOf.slice(0, 4)) && asOf !== r.date;
  const date = stated ? asOf : r.date;
  return { date: date && date <= isoDay(new Date()) ? date : "", stated };
}

// Days between two dates of any precision (a year counts as its middle, a month as the 15th).
function daysApart(a: string, b: string) {
  const at = (d: string) => Date.parse(d.length === 4 ? `${d}-07-01` : d.length === 7 ? `${d}-15` : d);
  return Math.abs(at(a) - at(b)) / 864e5;
}

// The sentence (or title) of the result that contains the quote.
function sentenceOf(text: string, quote: string) {
  const probe = norm(quote).slice(0, 30);
  return text.split(/(?<=[.!?])\s+|\s+[—|·]\s+/).find((s) => norm(s).includes(probe)) || quote;
}

// The searches for one company: its valuation, its funding news, its market cap and any
// acquisition in the past year, so the latest round, price or deal shows up even when
// older articles rank higher ("SpaceX to buy Cursor maker Anysphere for $60 billion" never
// says "valuation"), plus a plain one for anything older. A parenthetical in the name is a
// search term: "Anysphere (Cursor)".
function searchesFor(name: string) {
  const q = name.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  return [
    { q: `${q} valuation`, params: "tbs=qdr:y" },
    { q: `${q} raises valuation`, params: "tbs=qdr:y" },
    { q: `${q} market cap`, params: "tbs=qdr:y" },
    { q: `${q} acquisition`, params: "tbs=qdr:y" },
    { q: `${q} valuation market cap`, params: "" },
  ];
}

// Which stored values still hold up: a market cap must not be stale, and the model, told
// what each company is, must not judge the stored quote and page to be about a different
// company ("finance.yahoo.com/quote/0752.HK" is Pico Far East, not ByteDance's Pico; while
// "cnbc.com/quotes/NVDA" is Nvidia even though its quote doesn't say so). One model call.
export async function storedValuesHold(base44: any, stored: (Target & { quote: string; url: string; basis?: string; as_of?: string })[]): Promise<boolean[]> {
  if (!stored.length) return [];
  const fresh = stored.map((s) => !(s.basis === "market_cap" && s.as_of && daysApart(s.as_of, isoDay(new Date())) > MARKET_CAP_MAX_AGE_DAYS));
  const answer: any = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: `For each item, say whether the quoted value and its page are about the company described, or about a different company with a similar name or ticker. Answer "same", "different" or "unsure".

${stored.map((s, i) => `Item ${i + 1}: ${s.name}${s.context ? ` — ${s.context}` : ""}\n  Quote: "${s.quote}"\n  Page: ${s.url}`).join("\n")}`,
    response_json_schema: {
      type: "object",
      properties: { items: { type: "array", items: { type: "object", properties: { item: { type: "number" }, answer: { type: "string", enum: ["same", "different", "unsure"] } }, required: ["item", "answer"] } } },
      required: ["items"],
    },
  });
  const different = new Set((answer?.items || []).filter((x: any) => x.answer === "different").map((x: any) => Number(x.item) - 1));
  return stored.map((_, i) => fresh[i] && !different.has(i));
}

// Ground the values of up to ~8 companies: five searches and one model call each, in parallel.
// `candidates`, if given, collects every proposed figure with its verdict.
export async function groundValues(bd: BrightData, base44: any, companies: Target[], log: string[], candidates: Candidate[] = []): Promise<Valuation[]> {
  if (!companies.length) return [];
  const t0 = Date.now();
  const found = await Promise.all(companies.map((c) => groundOne(bd, base44, c, candidates)));
  const values = found.filter((v): v is Valuation => !!v);
  log.push(`values: ${values.length}/${companies.length} grounded in ${Date.now() - t0}ms`);
  return values;
}

async function groundOne(bd: BrightData, base44: any, c: Target, candidates: Candidate[]): Promise<Valuation | null> {
  // Google via Bright Data sometimes fails or hangs: if every search fails, try once more.
  let failure = "";
  let lists: any[][] = [];
  for (let attempt = 0; attempt < 2 && !lists.some((l) => l.length); attempt++) {
    const searches = await Promise.allSettled(searchesFor(c.name).map((s) => bd.search(s.q, undefined, s.params)));
    lists = searches.map((s) => (s.status === "fulfilled" ? s.value : []));
    const failed = searches.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
    if (failed) failure = String(failed.reason?.message || failed.reason).slice(0, 80);
  }
  // Interleave the searches' results so each one contributes, without duplicates.
  const seen = new Set<string>();
  const results: Result[] = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)) && results.length < 16; i++) {
    for (const o of lists.map((l) => l[i]).filter(Boolean)) {
      const url = o.link || o.url;
      if (!url || SKIP_HOSTS.test(url) || seen.has(url) || results.length >= 16) continue;
      seen.add(url);
      results.push({ url, text: `${o.title || ""} — ${o.description || o.snippet || ""}`, date: publishedDate(o) });
    }
  }
  if (!results.length) {
    candidates.push({ key: c.key, amount_usd: 0, as_of: "", basis: "", url: "", quote: "", verdict: `search failed: ${failure || "no results"}` });
    return null;
  }

  const prompt = `List every figure that these search results state as ${c.name}'s valuation (private company) or market capitalization (public company), in US dollars.
The company: ${c.name}${c.context ? ` — ${c.context}` : ""}. Set same_company to false for a figure about a different company with a similar name or ticker (e.g. a steelmaker called "Jindal Stainless" is not the software company "Stainless").
Rules: copy a short verbatim quote that contains the figure. basis: "funding_round" (a priced round or its post-money valuation), "tender_offer" (employee/secondary share sale at a set price), "ipo", "acquisition" (price paid for the whole company), "market_cap", "estimate" (any estimated, implied, targeted or modelled value, e.g. Yahoo Finance or Forge estimates, or a round still being discussed), or "other". as_of: the date of the round, deal or price the figure comes from, not the article's date: "as of October 9, 2026" or "its May 2026 round" give that date; "this year" or "last year" give the year (work it out from the publication date); leave it empty if the text doesn't say. current: false for an earlier value the text mentions for comparison. Skip total funding raised, round sizes, revenue, values of a parent or merged company (e.g. the combined company after an acquisition), and figures about other companies. Do not use outside knowledge.

${results.map((r, j) => `Result ${j + 1}${r.date ? ` (published ${r.date})` : ""}: ${r.text} (${r.url})`).join("\n")}`;
  const answer: any = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt, response_json_schema: SCHEMA });
  if (!answer?.figures?.length) {
    candidates.push({ key: c.key, amount_usd: 0, as_of: "", basis: "", url: "", quote: "", verdict: `no figures in ${results.length} results` });
    return null;
  }

  // The result a figure is quoted from: the one the model names if it contains the quote,
  // else whichever result does.
  const contains = (r: Result | undefined, quote: string) => !!r && !!quote && norm(r.text).includes(norm(quote).slice(0, 80));
  const resultFor = (f: any, quote: string) => {
    const named = results[Number(String(f.result ?? "").match(/\d+/)?.[0]) - 1];
    return contains(named, quote) ? named : results.find((r) => contains(r, quote));
  };
  // Why a proposed figure isn't a grounded value, or "" if it is.
  const reject = (f: any, r: Result | undefined, quote: string, amount: number, stated: boolean, as_of: string) => {
    if (!quote || !(amount >= 1e6 && amount < 1e14)) return "malformed";
    if (!r) return "quote not in results";
    if (!namesCompany(r, c.name)) return "result doesn't name company";
    if (f.same_company === false) return "different company";
    const match = amountsIn(quote).find((a) => Math.abs(a.value - amount) / amount < 0.03);
    if (!match) return "amount not in quote";
    const pastEvent = stated && !!r.date && as_of.slice(0, 7) < r.date.slice(0, 7);
    if (f.basis === "estimate" || (!pastEvent && NOT_A_VALUE.test(sentenceOf(r.text, quote)))) return "estimate or not final";
    if (!isUsd(quote)) return "not USD";
    if ((match.past || f.current === false) && !stated) return "earlier value, undated";
    if (f.basis === "market_cap" && as_of && daysApart(as_of, isoDay(new Date())) > MARKET_CAP_MAX_AGE_DAYS) return "stale market cap";
    return "";
  };
  const mine: Candidate[] = [];
  for (const f of answer?.figures || []) {
    const quote = String(f.quote || "");
    const r = resultFor(f, quote);
    const amount = Number(f.amount_usd);
    const { date: as_of, stated } = r ? dateFor(String(f.as_of || ""), r) : { date: "", stated: false };
    const verdict = reject(f, r, quote, amount, stated, as_of) || (as_of ? "ok" : "undated");
    mine.push({ key: c.key, amount_usd: amount, as_of, basis: BASES.includes(f.basis) ? f.basis : f.basis === "estimate" ? "estimate" : "other", url: r?.url || "", quote, verdict });
  }
  candidates.push(...mine);

  // Group the dated figures by value (within 3%), newest first, with every site that states
  // that value (undated figures count as support, not as a date).
  const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) / b < tolerance;
  type Group = { amount: number; newest: string; members: Candidate[]; sites: Set<string>; trusted: boolean };
  const groups: Group[] = [];
  const dated = mine.filter((x) => x.verdict === "ok").sort((a, b) => b.as_of.localeCompare(a.as_of) || BASES.indexOf(a.basis) - BASES.indexOf(b.basis));
  for (const x of dated) {
    const group = groups.find((g) => near(x.amount_usd, g.amount, 0.03));
    if (group) group.members.push(x);
    else groups.push({ amount: x.amount_usd, newest: x.as_of, members: [x], sites: new Set(), trusted: false });
  }
  for (const g of groups) {
    const support = mine.filter((x) => (x.verdict === "ok" || x.verdict === "undated") && near(x.amount_usd, g.amount, 0.03));
    g.sites = new Set(support.map((x) => hostOf(x.url)));
    g.trusted = support.some((x) => isTrusted(x.url, c.name));
  }
  const privateMarketCap = (g: Group) => c.kind === "private" && g.members[0].basis === "market_cap";
  const supported = groups.filter((g) => g.trusted || (g.sites.size >= 2 && !privateMarketCap(g)));
  for (const g of groups) if (!supported.includes(g)) for (const x of g.members) x.verdict = "single untrusted source";
  // The newest value wins, unless a different value reported within a month of it is
  // stated by more sites: two reports of one event that disagree, so trust the majority.
  let chosen = supported[0];
  if (!chosen) return null;
  for (const g of supported.slice(1)) {
    if (daysApart(g.newest, chosen.newest) <= 31 && g.sites.size > chosen.sites.size) chosen = g;
  }
  for (const g of supported) if (g !== chosen && g.newest >= chosen.newest) for (const x of g.members) x.verdict = "conflicts, fewer sites";

  // Cite the best source for the value, trusted first. A round or tender offer is dated by
  // its first statement (usually the announcement itself; later articles repeat it); a
  // market cap changes daily, so by its newest reading. A more precise date wins within the
  // same period.
  const marketCap = chosen.members[0].basis === "market_cap";
  const byDate = (a: Candidate, b: Candidate) => {
    if (a.as_of.startsWith(b.as_of) || b.as_of.startsWith(a.as_of)) return b.as_of.length - a.as_of.length;
    return marketCap ? b.as_of.localeCompare(a.as_of) : a.as_of.localeCompare(b.as_of);
  };
  const cite = chosen.members.slice().sort((a, b) => Number(isTrusted(b.url, c.name)) - Number(isTrusted(a.url, c.name)) || byDate(a, b))[0];
  return { key: c.key, amount_usd: cite.amount_usd, as_of: cite.as_of, url: cite.url, evidence: cite.quote.slice(0, 300), basis: cite.basis };
}
