// Investor recall test against the deployed app: runs a fresh live lookup for each
// company and compares the investors it found with a known list.
//   node scripts/investor-recall.mjs            (all companies)
//   node scripts/investor-recall.mjs Waymo      (one company)
// The answer keys are publicly reported investors, not exhaustive cap tables.

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

const base44 = createClient({ appId: APP_ID, serverUrl: "https://base44.app", requiresAuth: false });
const only = process.argv[2];
let total = 0, hit = 0;
for (const [name, key] of Object.entries(ANSWER_KEY)) {
  if (only && only.toLowerCase() !== name.toLowerCase()) continue;
  const t0 = Date.now();
  const res = (await base44.functions.invoke("lookupCompany", { name, force: true })).data;
  if (res?.error) {
    console.log(`\n${name}: lookup failed: ${res.error}\n  ${(res.log || []).join("\n  ")}`);
    continue;
  }
  const g = (await base44.functions.invoke("graphData", { action: "load" })).data;
  const ck = companyKey(name);
  const inbound = g.relationships.filter((r) => r.target === ck && ["investment", "venture", "owner"].includes(r.type));
  const found = new Set(inbound.map((r) => r.source));
  const want = key.investors.map(companyKey);
  const missing = key.investors.filter((n) => !found.has(companyKey(n)));
  const extra = [...found].filter((k) => !want.includes(k));
  const ownerOk = !key.owner || inbound.some((r) => r.type === "owner" && r.source === companyKey(key.owner));
  // A round total pinned on one investor is the bug this test guards against.
  const pinned = inbound.filter((r) => r.amount_usd && inbound.filter((x) => x.round_total_usd === r.amount_usd).length > 1);
  total += want.length;
  hit += want.length - missing.length;
  console.log(`\n${name}: ${want.length - missing.length}/${want.length} known investors found (${Math.round((100 * (want.length - missing.length)) / want.length)}%) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (key.owner) console.log(`  owner ${key.owner}: ${ownerOk ? "found" : "MISSING"}`);
  if (missing.length) console.log(`  missing: ${missing.join(", ")}`);
  if (extra.length) console.log(`  also found: ${extra.join(", ")}`);
  if (pinned.length) console.log(`  WARNING round total on one investor: ${pinned.map((r) => r.key).join(", ")}`);
  console.log(`  log: ${(res.log || []).join(" | ")}`);
}
if (total) console.log(`\nOverall recall: ${hit}/${total} (${Math.round((100 * hit) / total)}%)`);
