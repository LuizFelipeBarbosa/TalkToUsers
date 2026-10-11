// Live company lookup, in research rounds that the client calls one after another:
//   1. { name, force }: Google searches (Bright Data SERP API), read the top articles
//      (Web Unlocker, as markdown), LLM extraction; ground the company's value (see
//      valuation.ts). Also starts collecting the Crunchbase profile, which takes minutes.
//   2. { key, round: 2, state }: targeted searches per relationship type; read new
//      articles; extract again; ground the values of counterparties on deals with an amount.
//   3. { key, round: 3, state }: once Crunchbase is collected, look for an article behind
//      its most important relationships; save the rest citing the Crunchbase profile.
// { action: "values", keys, dry_run, reverify } grounds the values of companies already on
// the graph (at most 8 per call) and reports old and new values. With reverify, a value
// found now replaces a stored grounded one even if that one is dated later, provided this
// run saw the stored value (its amount or its page) and ranked another above it: that
// redoes values grounded by earlier, less strict versions of valuation.ts without letting
// a search that missed the better sources downgrade a good value.
//
// Each round saves what it found and returns `next_round` and `state` (pass both back)
// until research is done; `background` marks the slow Crunchbase round, which a client
// can run without making the user wait. Every edge cites an article we read or the
// Crunchbase profile.
//
// Secrets: BRIGHTDATA_API_KEY, BRIGHTDATA_SERP_ZONE, BRIGHTDATA_UNLOCKER_ZONE.
// Without them a lookup is one round using InvokeLLM's own web search (marked "llm_web").

import { createClientFromRequest } from "npm:@base44/sdk@0.8.41";
import { secrets } from "base44:runtime";
import { companyKey } from "../../shared/seed.js";
import { BrightData, type Doc, type Query, searchAndRead } from "./brightdata.ts";
import { CRUNCHBASE_DATASET, edgesFromRecord, findProfile, sameCompany } from "./crunchbase.ts";
import { type CompanyInfo, edgesFromExtraction, extract, isDirectName, norm } from "./extract.ts";
import { type Candidate, groundValues, type Valuation } from "./valuation.ts";

const CACHE_HOURS = 72;
// Collecting one Crunchbase profile took 5 to 11 minutes in testing.
const CRUNCHBASE_WAIT_MS = 15 * 60e3;
const CRUNCHBASE_POLL_S = 20;
// A grounded value older than this is looked up again.
const VALUE_MAX_AGE_DAYS = 90;
// How long round 1 waits for its value and Crunchbase profile once the articles are read.
const ROUND_ONE_GRACE_MS = 5000;

type State = {
  name: string;
  read: string[]; // article URLs already read, so later rounds read new ones
  retry?: Query[]; // round 1 searches that failed, for round 2 to try again
  valued?: boolean; // round 1 grounded the company's value
  found: number; // edges found so far by this lookup
  // undefined: not tried yet; null: no profile found or collection couldn't start.
  crunchbase?: { url: string; snapshot: string; started: number } | null;
};
type Found = { edges: any[]; companies: Map<string, CompanyInfo>; valuations: Valuation[] };
type Ctx = { base44: any; db: any; bd: BrightData | null; log: string[] };

const STEPS: Record<number, string> = {
  2: "Following up with targeted searches",
  3: "Checking Crunchbase",
};

function secret(name: string): string | undefined {
  try {
    return secrets.get(name) || undefined;
  } catch {
    return Deno.env.get(name) || undefined;
  }
}

Deno.serve(async (req) => {
  const started = Date.now();
  const log: string[] = [];
  let bd: BrightData | null = null;
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const round = Number(body.round) || 1;
    if (body.action === "values" && !(Array.isArray(body.keys) && body.keys.length)) return Response.json({ error: "keys are required" }, { status: 400 });
    if (!body.action && round === 1 && !String(body.name || "").trim()) return Response.json({ error: "name is required" }, { status: 400 });
    if (round > 1 && !(body.key && body.state?.name)) return Response.json({ error: "key and state are required" }, { status: 400 });

    const apiKey = secret("BRIGHTDATA_API_KEY");
    if (apiKey) bd = new BrightData(apiKey, secret("BRIGHTDATA_SERP_ZONE") || "serp_api1", secret("BRIGHTDATA_UNLOCKER_ZONE") || "web_unlocker1");
    const ctx: Ctx = { base44, db: base44.asServiceRole.entities, bd, log };
    if (body.action === "values" && !bd) return Response.json({ error: "values need BRIGHTDATA_API_KEY" }, { status: 400 });
    const out = body.action === "values"
      ? await refreshValues(ctx, body.keys.slice(0, 8), !!body.dry_run, !!body.reverify)
      : round === 1 ? await firstRound(ctx, body) : round === 2 ? await secondRound(ctx, body.key, body.state) : await crunchbaseRound(ctx, body.key, body.state);
    if (bd) log.push(bd.summary());
    return Response.json({ ...out, round, log, ms: Date.now() - started });
  } catch (err) {
    console.error(err);
    if (bd) log.push(bd.summary());
    return Response.json({ error: String((err as Error)?.message || err), log }, { status: 500 });
  } finally {
    bd?.close();
  }
});

async function firstRound({ base44, db, bd, log }: Ctx, body: any) {
  const name = String(body.name).trim().slice(0, 80);
  const key = companyKey(name);

  // Cache: a recent lookup is reused unless the analyst forces a refresh. If its follow-up
  // rounds never finished (the page was closed), they pick up again from round 2.
  const existing = (await db.Company.filter({ key }))[0];
  if (!body.force && existing?.last_fetched && Date.now() - Date.parse(existing.last_fetched) < CACHE_HOURS * 3600e3) {
    log.push("cache hit");
    // research_done is "" while rounds run; rows from before research rounds don't have it.
    const unfinished = bd && typeof existing.research_done === "string" && !(existing.research_done >= existing.last_fetched);
    return { key, cached: true, ...(unfinished ? next(2, { name: existing.name, read: [], found: 1 }) : {}) };
  }

  // Search and read; meanwhile ground the company's value, and find the Crunchbase
  // profile and start collecting it. Those two don't hold up the first results: whichever
  // isn't done shortly after the articles are read is left to round 2.
  const state: State = { name, read: [], found: 0 };
  let docs: Doc[] | null = null;
  let values: Valuation[] = [];
  if (bd) {
    const valuing = groundValues(bd, base44, [{ key, name }], log);
    const crunchbase = startCrunchbase(bd, name, log);
    const searched = await searchAndRead(bd, name, [
      // Plain-language queries: Google answers them faster and more reliably than long
      // OR chains, and "X investors" surfaces the company's own funding announcements.
      { q: `${name} investors funding round` },
      { q: `"${name}" partnership OR acquires OR "deal with" OR customer OR supplier` },
      { q: `${name} parent company owner` },
    ], log);
    const late = <T>(p: Promise<T>) => Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ROUND_ONE_GRACE_MS))]);
    const [valued, started] = await Promise.all([late(valuing), late(crunchbase)]);
    values = valued || [];
    state.crunchbase = started; // undefined if still searching: round 2 starts it
    docs = searched.docs;
    state.read = docs.filter((d) => d.id !== 99).map((d) => d.url);
    state.retry = searched.failed;
    state.valued = values.length > 0;
  } else {
    log.push("BRIGHTDATA_API_KEY not set: using the LLM's own web search");
  }

  const found = await extractEdges(base44, name, key, docs, log);
  found.valuations = values;
  const edges = await save(db, key, found, log, { refresh: true, crunchbaseUrl: state.crunchbase?.url });
  state.found = found.edges.length;
  // Without Bright Data there are no follow-up rounds.
  if (!bd) return await finish(db, key, state, { key, cached: false, added: found.edges.length, edges });
  return { key, cached: false, added: found.edges.length, edges, ...next(2, state) };
}

async function secondRound({ base44, db, bd, log }: Ctx, key: string, state: State) {
  const name = state.name;
  const [companies, touching] = await Promise.all([companiesByKey(db), edgesTouching(db, key)]);
  // Values to ground: the company itself if round 1 couldn't, and the counterparties on
  // deals with an amount (the only edges where a company's value changes how strongly a
  // shock travels), at most 4. Funds and VC firms have no valuation.
  const valueTargets = [...new Set([...(state.valued ? [] : [key]), ...touching.filter((r: any) => r.amount_usd > 0).map((r: any) => (r.source === key ? r.target : r.source))])]
    .map((k) => companies.get(k))
    .filter((c) => c && c.kind !== "investor" && needsValue(c))
    .slice(0, 5)
    .map((c) => ({ key: c.key, name: c.name }));
  // Round 1's failed searches go again. A lookup resumed from the cache hasn't started
  // Crunchbase yet.
  const queries: Query[] = [
    ...(state.retry || []),
    { q: `${name} funding round led by` },
    { q: `${name} acquisition` },
    { q: `${name} biggest customers suppliers contracts` },
  ];
  state.retry = [];
  const [{ docs }, values, crunchbase] = await Promise.all([
    searchAndRead(bd!, name, queries, log, { skip: new Set(state.read) }),
    groundValues(bd!, base44, valueTargets, log),
    state.crunchbase === undefined ? startCrunchbase(bd!, name, log) : state.crunchbase,
  ]);
  state.crunchbase = crunchbase;
  state.read.push(...docs.filter((d) => d.id !== 99).map((d) => d.url));

  const found = await extractEdges(base44, name, key, docs, log);
  found.valuations = values;
  const edges = await save(db, key, found, log, { crunchbaseUrl: crunchbase?.url });
  state.found += found.edges.length;
  const out = { key, cached: false, added: found.edges.length, edges };
  return state.crunchbase ? { ...out, ...next(3, state) } : await finish(db, key, state, out);
}

async function crunchbaseRound({ base44, db, bd, log }: Ctx, key: string, state: State) {
  const done = (extra: object = {}) => finish(db, key, state, { key, cached: false, added: 0, edges: [], ...extra });
  const cb = state.crunchbase;
  if (!cb) return await done();
  let records: any[] | null;
  try {
    records = await bd!.snapshot(cb.snapshot);
  } catch (err) {
    log.push(`crunchbase: ${String((err as Error)?.message || err).slice(0, 160)}`);
    return await done();
  }
  if (!records) {
    if (Date.now() - cb.started < CRUNCHBASE_WAIT_MS) {
      log.push(`crunchbase: still collecting after ${Math.round((Date.now() - cb.started) / 1000)}s`);
      return { key, cached: false, added: 0, edges: [], retry_after: CRUNCHBASE_POLL_S, ...next(3, state, "Waiting for Crunchbase") };
    }
    log.push("crunchbase: gave up waiting");
    return await done();
  }
  const record = records.find((r) => r?.name && sameCompany(r.name, state.name));
  if (!record) {
    log.push(`crunchbase: no record for ${state.name} (${records.length} returned${records[0]?.error ? `: ${String(records[0].error).slice(0, 100)}` : ""})`);
    return await done();
  }

  // Crunchbase's relationships that no article backs yet. For the most important of them
  // (parent, round leads, acquisitions), search for an article that states them.
  const [companies, touching] = await Promise.all([companiesByKey(db), edgesTouching(db, key)]);
  const { candidates, companies: listedCompanies, news } = edgesFromRecord(record, key, (k) => companies.get(k)?.kind);
  const backedBy = new Map(touching.filter((r: any) => r.origin === "live" || r.origin === "seed").map((r: any) => [relationshipKey(r), r.key]));
  const backed = new Set(backedBy.keys());
  const open = candidates.filter((c) => !backed.has(relationshipKey(c.edge)));
  // Relationships Crunchbase confirms that are already on the graph count as found.
  const confirmedOnGraph = candidates.map((c) => backedBy.get(relationshipKey(c.edge))).filter(Boolean);
  const toCheck = open.filter((c) => c.priority >= 2).slice(0, 4);
  log.push(`crunchbase: ${candidates.length} relationships, ${candidates.length - open.length} already sourced, checking ${toCheck.length} against articles`);

  let found: Found = { edges: [], companies: new Map(), valuations: [] };
  if (toCheck.length) {
    const relatedNews = news.filter((n) => toCheck.some((c) => norm(n.title).includes(norm(c.name)))).slice(0, 2);
    const { docs } = await searchAndRead(bd!, state.name, toCheck.map((c) => ({ q: `"${state.name}" "${c.name}"` })), log, { skip: new Set(state.read), extraUrls: relatedNews });
    state.read.push(...docs.filter((d) => d.id !== 99).map((d) => d.url));
    found = await extractEdges(base44, state.name, key, docs, log, toCheck.map((c) => c.edge.evidence));
  }
  // The rest are saved citing the Crunchbase profile.
  const confirmed = new Set([...backed, ...found.edges.map(relationshipKey)]);
  const listed = open.filter((c) => !confirmed.has(relationshipKey(c.edge))).map((c) => c.edge);
  found.edges.push(...listed);
  for (const [k, info] of listedCompanies) if (!found.companies.has(k)) found.companies.set(k, info);
  log.push(`crunchbase: ${listed.length} relationships saved citing the profile`);

  const edges = await save(db, key, found, log, { crunchbaseUrl: cb.url });
  state.found += found.edges.length;
  return await finish(db, key, state, { key, cached: false, added: found.edges.length, edges: [...new Set([...edges, ...confirmedOnGraph])] });
}

// Find the company's Crunchbase profile and start collecting it; a later round picks it up.
async function startCrunchbase(bd: BrightData, name: string, log: string[]) {
  try {
    const { url, seen } = await findProfile(bd, name);
    if (!url) {
      log.push(`crunchbase: no profile found (${seen.length ? `got ${seen.slice(0, 3).join(", ")}` : "search returned nothing"})`);
      return null;
    }
    const snapshot = await bd.trigger(CRUNCHBASE_DATASET, [{ url }]);
    log.push(`crunchbase: collecting ${url}`);
    return { url, snapshot, started: Date.now() };
  } catch (err) {
    log.push(`crunchbase: ${String((err as Error)?.message || err).slice(0, 160)}`);
    return null;
  }
}

async function extractEdges(base44: any, name: string, key: string, docs: Doc[] | null, log: string[], hints: string[] = []): Promise<Found> {
  const t0 = Date.now();
  const result = await extract(base44, name, docs, hints);
  const { edges, companies, summary } = edgesFromExtraction(result, docs, key, name);
  log.push(`extract: ${summary} in ${Date.now() - t0}ms`);
  return { edges, companies, valuations: [] };
}

// Whether a company's value should be grounded (again): it has none from a page, or the
// one it has is older than VALUE_MAX_AGE_DAYS.
function needsValue(c: any) {
  const cutoff = new Date(Date.now() - VALUE_MAX_AGE_DAYS * 864e5).toISOString().slice(0, 10);
  return !(c?.value_source === "article" && (c.value_as_of || "") >= cutoff);
}

// Ground the values of companies already on the graph; with dryRun, only report them.
async function refreshValues({ base44, db, bd, log }: Ctx, keys: string[], dryRun: boolean, reverify: boolean) {
  const companies = await companiesByKey(db);
  const rows = keys.map((k) => companies.get(k)).filter(Boolean);
  const candidates: Candidate[] = [];
  const values = await groundValues(bd!, base44, rows.map((c) => ({ key: c.key, name: c.name })), log, candidates);
  const byKey = new Map(values.map((v) => [v.key, v]));
  const updates: [string, any][] = [];
  const report = rows.map((c) => {
    const seenStored = candidates.some((x) => x.key === c.key && ((c.value_usd && Math.abs(x.amount_usd - c.value_usd) / c.value_usd < 0.03) || x.url === c.value_source_url));
    const patch = valuePatch(c, undefined, byKey.get(c.key), reverify && seenStored);
    if (Object.keys(patch).length) updates.push([c.id, patch]);
    return {
      key: c.key, name: c.name, changed: Object.keys(patch).length > 0, found: byKey.get(c.key) || null,
      before: { value_usd: c.value_usd, value_source: c.value_source || (c.origin === "seed" ? "seed" : "llm_estimate"), value_as_of: c.value_as_of },
      candidates: candidates.filter((x) => x.key === c.key),
    };
  });
  if (!dryRun) await pool(updates, ([id, patch]) => db.Company.update(id, patch));
  return { values: report, saved: dryRun ? 0 : updates.length };
}

function next(round: number, state: State, step = STEPS[round]) {
  return { next_round: round, step, state, background: round === 3 };
}

// The last round: mark research done, or report that no round found anything. Then the
// cache is left alone, so the next try searches again.
async function finish(db: any, key: string, state: State, out: Record<string, unknown>) {
  if (!state.found) return { ...out, error: `Couldn't find sourced relationships for ${state.name} this time. Try again.` };
  const row = (await db.Company.filter({ key }))[0];
  if (row) await db.Company.update(row.id, { research_done: new Date().toISOString() });
  return { ...out, done: true };
}

async function companiesByKey(db: any) {
  return new Map<string, any>((await db.Company.list("-created_date", 5000)).map((c: any) => [c.key, c]));
}

async function edgesTouching(db: any, key: string) {
  const [out, inbound] = await Promise.all([db.Relationship.filter({ source: key }), db.Relationship.filter({ target: key })]);
  return [...out, ...inbound];
}

// Two edges describe the same relationship when they join the same companies the same way;
// owner, investment and venture are all one capital relationship.
const relationshipKey = (e: any) => `${e.source}|${["owner", "investment", "venture"].includes(e.type) ? "capital" : e.type}|${e.target}`;

// Value precedence: a grounded value (dated, quoted from a page) wins, and a newer one
// replaces an older one (with reverify, any one does). It also replaces a curated demo
// value, which is kept in seed_value_usd. The model's estimate only fills in where nothing
// better exists.
function valuePatch(row: any, estimate: number | undefined, v: Valuation | undefined, reverify = false) {
  const grounded = row?.value_source === "article";
  if (v && (!grounded || reverify || v.as_of >= (row.value_as_of || ""))) {
    return {
      value_usd: v.amount_usd, value_source: "article", value_as_of: v.as_of, value_basis: v.basis,
      value_source_url: v.url, value_evidence: v.evidence,
      ...(row?.origin === "seed" && row.seed_value_usd == null ? { seed_value_usd: row.value_usd } : {}),
    };
  }
  if (estimate && !grounded && row?.origin !== "seed") return { value_usd: estimate, value_source: "llm_estimate" };
  return {};
}

const SOURCE_RANK: Record<string, number> = { llm_web: 0, crunchbase: 1, live: 2 };

// What a later round's edge adds to a saved one: a better kind of source (an article beats
// Crunchbase, Crunchbase beats the model's web search) or the same kind with a higher
// confidence, and an amount where there was none. Nothing saved is ever removed.
function improvement(row: any, e: any) {
  const rank = (o: string) => SOURCE_RANK[o] ?? 0;
  const better = rank(e.origin) > rank(row.origin) || (e.origin === row.origin && (e.confidence ?? 0) > (row.confidence ?? 0));
  const patch: any = better ? { source_url: e.source_url, evidence: e.evidence, confidence: e.confidence, origin: e.origin, ...(e.label ? { label: e.label } : {}), ...(e.date ? { date: e.date } : {}) } : {};
  if (e.amount_usd && !row.amount_usd) patch.amount_usd = e.amount_usd;
  return Object.keys(patch).length ? patch : null;
}

// Run fn over items, a few at a time.
async function pool<T>(items: T[], fn: (item: T) => Promise<unknown>, size = 3) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

// Save a round's findings and return the keys of the edges it found. Round 1 refreshes: it
// replaces what an earlier lookup saved between the same two companies. Later rounds only
// add or improve, so they never undo what an earlier round of the same lookup found.
async function save(db: any, key: string, found: Found, log: string[], { refresh = false, crunchbaseUrl = "" } = {}) {
  // Read once, then write in bulk or a few at a time: Base44 rate-limits bursts of
  // one-by-one calls, which a lookup with 30+ investors easily triggers.
  const [companyByKey, touching] = await Promise.all([companiesByKey(db), edgesTouching(db, key)]);
  const relByKey = new Map(touching.map((r: any) => [r.key, r]));
  const changed = (row: any, patch: any) => Object.keys(patch).some((f) => row[f] !== patch[f]);
  const now = new Date().toISOString();

  // Companies: every company on an edge, plus saved companies a document gave a value for
  // and the company looked up.
  const valuations = new Map(found.valuations.map((v) => [v.key, v]));
  const onEdge = new Set(found.edges.flatMap((e) => [e.source, e.target]));
  const keys = new Set([...onEdge, ...valuations.keys()]);
  if (companyByKey.has(key)) keys.add(key);
  const newCompanies: any[] = [];
  const companyUpdates: [string, any][] = [];
  for (const k of keys) {
    const row = companyByKey.get(k);
    const info = found.companies.get(k);
    if (!row && !onEdge.has(k)) continue; // a company with no edge stays off the graph
    const patch: any = {
      // A curated (seed) company keeps its kind; the model's guess has turned a chipmaker
      // into an "investor" before.
      ...(info?.kind && row?.origin !== "seed" ? { kind: info.kind } : {}),
      ...(info?.sector ? { sector: info.sector } : {}),
      ...valuePatch(row, info?.estimate, valuations.get(k)),
      ...(k === key
        ? {
          // Only a lookup that found something counts for the cache.
          ...(onEdge.size && (refresh || !row?.last_fetched) ? { last_fetched: now } : {}),
          ...(onEdge.size && refresh ? { research_done: "" } : {}),
          ...(info?.description ? { description: info.description } : {}),
          ...(crunchbaseUrl ? { crunchbase_url: crunchbaseUrl } : {}),
        }
        : {}),
    };
    if (row) {
      // Fix a name that was saved under an alias on an earlier lookup.
      if (row.origin !== "seed" && info && !isDirectName(row.name) && isDirectName(info.name)) patch.name = info.name;
      if (changed(row, patch)) companyUpdates.push([row.id, patch]);
    } else {
      newCompanies.push({ key: k, name: info!.name, origin: "live", kind: info!.defaultKind || "private", ...patch });
    }
  }

  const newEdges: any[] = [];
  const edgeUpdates: [string, any][] = [];
  const edgeDeletes: string[] = [];
  const keysFound: string[] = [];
  for (const e of found.edges) {
    // A later round matches the relationship, not just the key: an investor saved as
    // "venture" is the same relationship as one now found as "investment".
    const row = relByKey.get(e.key) ?? (refresh ? undefined : touching.find((r: any) => relationshipKey(r) === relationshipKey(e)));
    keysFound.push(row?.key ?? e.key);
    if (!row) newEdges.push(e);
    else if (row.origin === "seed") continue;
    else if (!refresh) {
      const patch = improvement(row, e);
      if (patch) edgeUpdates.push([row.id, patch]);
    } else if (row.amount_usd && !e.amount_usd) {
      // Replace rather than update so a wrongly attributed amount is cleared.
      edgeDeletes.push(row.id);
      newEdges.push(e);
    } else if (changed(row, e)) edgeUpdates.push([row.id, e]);
  }
  // A refresh supersedes older live edges between the same two companies under another
  // type (e.g. an investor first saved as "investment" with the whole round's total).
  let stale = 0;
  if (refresh) {
    const pairs = new Set(found.edges.map((e) => `${e.source}|${e.target}`));
    const fresh = new Set(found.edges.map((e) => e.key));
    const outdated = touching.filter((r: any) => r.origin !== "seed" && !fresh.has(r.key) && pairs.has(`${r.source}|${r.target}`));
    edgeDeletes.push(...outdated.map((r: any) => r.id));
    stale = outdated.length;
  }

  if (newCompanies.length) await db.Company.bulkCreate(newCompanies);
  await pool(companyUpdates, ([id, patch]) => db.Company.update(id, patch));
  await pool(edgeDeletes, (id) => db.Relationship.delete(id));
  if (newEdges.length) await db.Relationship.bulkCreate(newEdges);
  await pool(edgeUpdates, ([id, patch]) => db.Relationship.update(id, patch));
  log.push(`saved: ${newEdges.length} new, ${edgeUpdates.length} updated${stale ? `, replaced ${stale} outdated` : ""}`);
  return keysFound;
}
