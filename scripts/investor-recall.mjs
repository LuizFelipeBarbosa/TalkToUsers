// Investor recall test against the deployed app: runs a fresh live lookup for each
// company and compares the investors that lookup found with a known list.
//   BASE44_APP_ID=<app id> node scripts/investor-recall.mjs              (all companies)
//   BASE44_APP_ID=<app id> node scripts/investor-recall.mjs Waymo        (one company)
//   BASE44_APP_ID=<app id> node scripts/investor-recall.mjs Stripe --runs 2
// The answer keys are publicly reported investors, not exhaustive cap tables.
//
// Only edges written by this lookup count: a refresh keeps edges from earlier lookups,
// so the graph as a whole would credit this run with what an older one found.

import { createClient } from "@base44/sdk";
import { companyKey } from "../base44/shared/seed.js";

const APP_ID = process.env.BASE44_APP_ID || "6acaa6f6770567c4e1a3ea84";
const ANSWER_KEY = {
  Waymo: {
    owner: "Alphabet",
    investors: ["Alphabet", "Andreessen Horowitz", "Fidelity", "Silver Lake", "Tiger Global", "T. Rowe Price", "Dragoneer", "DST Global", "Sequoia Capital", "Kleiner Perkins", "Mubadala Capital"],
  },
  Anthropic: { investors: ["Google", "Amazon", "Spark Capital", "Menlo Ventures", "Lightspeed", "ICONIQ", "Fidelity", "Salesforce Ventures"] },
  Stripe: { investors: ["Sequoia Capital", "Andreessen Horowitz", "General Catalyst", "Founders Fund", "Thrive Capital"] },
  Databricks: { investors: ["Andreessen Horowitz", "Thrive Capital", "Insight Partners", "NEA", "Lightspeed", "T. Rowe Price", "Microsoft"] },
};
const INVESTOR_TYPES = ["investment", "venture", "owner"];
// Follow-up rounds, including polls while Crunchbase collects (up to 15 minutes).
const MAX_CALLS = 60;

const base44 = createClient({ appId: APP_ID, serverUrl: "https://base44.app", requiresAuth: false });
const args = process.argv.slice(2);
const runsAt = args.indexOf("--runs");
const runs = runsAt >= 0 ? Number(args[runsAt + 1]) || 1 : 1;
const only = args.filter((_, i) => runsAt < 0 || (i !== runsAt && i !== runsAt + 1))[0];

const invoke = async (fn, body) => (await base44.functions.invoke(fn, body)).data;
const loadGraph = () => invoke("graphData", { action: "load" });
const touching = (g, ck) => g.relationships.filter((r) => r.source === ck || r.target === ck);

// Runs the lookup and the follow-up research rounds it asks for, like the app does.
// Returns the responses, each with the seconds since the lookup started.
async function lookup(name) {
  const t0 = Date.now();
  const call = async (body) => ({ ...(await invoke("lookupCompany", body)), at: (Date.now() - t0) / 1000 });
  const responses = [await call({ name, force: true })];
  while (responses.at(-1)?.next_round && responses.length < MAX_CALLS) {
    const prev = responses.at(-1);
    if (prev.retry_after) await new Promise((r) => setTimeout(r, prev.retry_after * 1000));
    responses.push(await call({ key: responses[0].key, round: prev.next_round, state: prev.state }));
  }
  return responses;
}

// Lenient name match, so "Lightspeed" finds "Lightspeed Venture Partners".
const sameName = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

// Edges this lookup wrote. Newer deployments list them in the response; for older ones,
// diff the graph: a new edge or one whose updated_date moved was written by this run.
function edgesFromRun(responses, before, after, ck) {
  const listed = responses.flatMap((r) => r?.edges || []);
  if (listed.length) {
    const keys = new Set(listed.map((e) => e.key || e));
    return touching(after, ck).filter((r) => keys.has(r.key));
  }
  const prev = new Map(touching(before, ck).map((r) => [r.key, r.updated_date]));
  return touching(after, ck).filter((r) => prev.get(r.key) !== r.updated_date);
}

// Bright Data calls, from the counter newer deployments log. Older ones only log the
// queries sent and articles requested (retries aren't logged).
function brightDataCalls(responses) {
  const lines = responses.flatMap((r) => r?.log || []);
  const counted = lines.map((l) => l.match(/^bright data: (\d+) calls/)).filter(Boolean);
  if (counted.length) return counted.reduce((sum, m) => sum + Number(m[1]), 0);
  return lines.reduce((sum, l) => sum + Number(l.match(/^search: .* from \d+\/(\d+) queries/)?.[1] || l.match(/^read: \d+\/(\d+) articles/)?.[1] || 0), 0);
}

const countBy = (items, f) => items.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
const fmt = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ") || "none";

const totals = { want: 0, hit: 0, lenient: 0, lookups: 0, failed: 0, seconds: 0, first: 0, calls: 0 };
for (const [name, key] of Object.entries(ANSWER_KEY)) {
  if (only && only.toLowerCase() !== name.toLowerCase()) continue;
  for (let run = 1; run <= runs; run++) {
    const label = runs > 1 ? `${name} (run ${run})` : name;
    const ck = companyKey(name);
    const before = await loadGraph();
    const t0 = Date.now();
    const responses = await lookup(name);
    const seconds = (Date.now() - t0) / 1000;
    const firstSeconds = responses[0]?.at ?? 0;
    const calls = brightDataCalls(responses);
    totals.lookups++;
    totals.seconds += seconds;
    totals.first += firstSeconds;
    totals.calls += calls;
    const failure = responses.find((r) => r?.error);
    if (failure) {
      totals.failed++;
      console.log(`\n${label}: lookup FAILED in ${seconds.toFixed(0)}s: ${failure.error}`);
      for (const r of responses) console.log(`  log: ${(r?.log || []).join(" | ")}`);
      continue;
    }
    const after = await loadGraph();
    const edges = edgesFromRun(responses, before, after, ck);
    const inbound = edges.filter((r) => r.target === ck && INVESTOR_TYPES.includes(r.type));
    const originOf = new Map(inbound.map((r) => [r.source, r.origin]));
    const want = key.investors.map(companyKey);
    const found = want.filter((k) => originOf.has(k));
    const foundLenient = want.filter((k) => [...originOf.keys()].some((f) => sameName(f, k)));
    const missing = key.investors.filter((n) => !originOf.has(companyKey(n)));
    const extra = [...originOf.keys()].filter((k) => !want.includes(k));
    const ownerOk = !key.owner || inbound.some((r) => r.type === "owner" && r.source === companyKey(key.owner));
    // A round total copied onto every investor in the round is the bug this test guards against.
    const pinned = inbound.filter((r) => r.amount_usd && inbound.filter((x) => x.amount_usd === r.amount_usd).length > 1);
    const graphInbound = new Set(touching(after, ck).filter((r) => r.target === ck && INVESTOR_TYPES.includes(r.type)).map((r) => r.source));
    totals.want += want.length;
    totals.hit += found.length;
    totals.lenient += foundLenient.length;

    console.log(`\n${label}: ${found.length}/${want.length} known investors found (${Math.round((100 * found.length) / want.length)}%; ${foundLenient.length}/${want.length} matching names leniently), ${edges.length} edges, ${seconds.toFixed(0)}s (first results ${firstSeconds.toFixed(0)}s), ${calls} Bright Data calls`);
    const landed = responses.filter((r) => r.added || r.done || r.round === 1).map((r) => `round ${r.round} +${r.added ?? 0} at ${r.at.toFixed(0)}s`);
    console.log(`  rounds: ${landed.join(", ")} (${responses.length} calls)`);
    console.log(`  known investors by source: ${fmt(countBy(found, (k) => originOf.get(k)))}`);
    console.log(`  edges by type: ${fmt(countBy(edges, (r) => r.type))}`);
    console.log(`  edges by source: ${fmt(countBy(edges, (r) => r.origin))}`);
    if (key.owner) console.log(`  owner ${key.owner}: ${ownerOk ? "found" : "MISSING"}`);
    if (missing.length) console.log(`  missing: ${missing.join(", ")}`);
    if (extra.length) console.log(`  also found: ${extra.join(", ")}`);
    if (pinned.length) console.log(`  WARNING same amount on several investors: ${pinned.map((r) => r.key).join(", ")}`);
    const kept = Number(responses[0]?.log?.join(" ").match(/kept: (\d+)/)?.[1] || 0);
    if (!responses.some((r) => r?.edges) && kept > edges.length) console.log(`  note: lookup kept ${kept} edges; ${kept - edges.length} matched existing ones unchanged and aren't counted`);
    console.log(`  in the graph overall (all lookups): ${want.filter((k) => graphInbound.has(k)).length}/${want.length} known investors`);
    for (const r of responses) if (!/still collecting/.test((r?.log || []).join())) console.log(`  log: round ${r.round}: ${(r?.log || []).join(" | ")}`);
  }
}
if (totals.lookups) {
  const pct = (n) => (totals.want ? Math.round((100 * n) / totals.want) : 0);
  console.log(`\nOverall recall: ${totals.hit}/${totals.want} (${pct(totals.hit)}%); matching names leniently ${totals.lenient}/${totals.want} (${pct(totals.lenient)}%)`);
  console.log(`Lookups: ${totals.lookups}, failed: ${totals.failed}, first results after ${(totals.first / totals.lookups).toFixed(0)}s and done after ${(totals.seconds / totals.lookups).toFixed(0)}s on average, ${(totals.calls / totals.lookups).toFixed(0)} Bright Data calls per lookup`);
}
