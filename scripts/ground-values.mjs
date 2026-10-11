// Ground the values of companies already on the graph: for each one, the latest valuation
// or market cap that a dated page states (see base44/functions/lookupCompany/valuation.ts).
//   BASE44_APP_ID=<app id> node scripts/ground-values.mjs            (dry run: report only)
//   BASE44_APP_ID=<app id> node scripts/ground-values.mjs --apply    (save the new values)
//   ... --keys stripe,nvidia                                         (only these companies)
//   ... --verbose                                                    (every figure found and its verdict)
//   ... --reverify   (replace stored grounded values even when dated later, to redo values
//                     grounded by earlier, less strict versions)
//   ... --shard 0/2  (only every 2nd company starting at 0, to run two copies in parallel)
// Funds and VC firms (kind "investor") have no valuation and are skipped.

import { createClient } from "@base44/sdk";

const APP_ID = process.env.BASE44_APP_ID || "6acaa6f6770567c4e1a3ea84";
const BATCH = 8;
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const onlyKeys = args.includes("--keys") ? args[args.indexOf("--keys") + 1].split(",") : null;
const verbose = args.includes("--verbose");
const reverify = args.includes("--reverify");
const [shard, shards] = args.includes("--shard") ? args[args.indexOf("--shard") + 1].split("/").map(Number) : [0, 1];

const base44 = createClient({ appId: APP_ID, serverUrl: "https://base44.app", requiresAuth: false });
const fmt = (n) => (n == null ? "-" : n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`);

const graph = (await base44.functions.invoke("graphData", { action: "load" })).data;
const companies = graph.companies.filter((c) => (onlyKeys ? onlyKeys.includes(c.key) : c.kind !== "investor")).filter((_, i) => i % shards === shard);
console.log(`${apply ? "Grounding" : "Dry run:"} ${companies.length} companies, ${BATCH} per call\n`);

const rows = [];
let calls = 0;
for (let i = 0; i < companies.length; i += BATCH) {
  const keys = companies.slice(i, i + BATCH).map((c) => c.key);
  const res = (await base44.functions.invoke("lookupCompany", { action: "values", keys, dry_run: !apply, reverify })).data;
  calls += Number((res.log || []).join(" ").match(/bright data: (\d+) calls/)?.[1] || 0);
  if (res.error) console.log(`  batch failed: ${res.error}`);
  for (const v of res.values || []) {
    rows.push(v);
    const before = `${fmt(v.before.value_usd)} (${v.before.value_source}${v.before.value_as_of ? ` ${v.before.value_as_of}` : ""})`;
    const after = v.found ? `${fmt(v.found.amount_usd)} ${v.found.basis} as of ${v.found.as_of}  ${v.found.url}` : "no dated value found";
    console.log(`${v.changed ? "*" : " "} ${v.name.padEnd(28).slice(0, 28)} ${before.padEnd(34)} -> ${after}`);
    if (verbose) for (const c of v.candidates || []) console.log(`      ${c.verdict.padEnd(22)} ${fmt(c.amount_usd).padEnd(9)} ${(c.as_of || "-").padEnd(10)} ${String(c.basis).padEnd(13)} "${c.quote.slice(0, 110)}" ${c.url.slice(0, 70)}`);
  }
}
const changed = rows.filter((r) => r.changed).length;
console.log(`\n${rows.filter((r) => r.found).length}/${rows.length} grounded, ${changed} would change${apply ? " (saved)" : ""}; ${calls} Bright Data calls`);
