// Bring the live graph up to date with the demo data in base44/shared/seed.js and the fixes
// in base44/functions/seedDemo/corrections.ts, through the seedDemo function (deploy it first).
//   BASE44_APP_ID=<app id> node scripts/sync-seed.mjs            (dry run: report only)
//   BASE44_APP_ID=<app id> node scripts/sync-seed.mjs --apply    (write the changes)
// Records that already exist are never changed, except the deals listed in corrections.ts.

import { createClient } from "@base44/sdk";

const APP_ID = process.env.BASE44_APP_ID || "6acac1d3560f9955c41aa9b4";
const apply = process.argv.includes("--apply");

const base44 = createClient({ appId: APP_ID, serverUrl: "https://base44.app", requiresAuth: false });
const res = (await base44.functions.invoke("seedDemo", { dry_run: !apply })).data;
if (res.error) {
  console.error(`seedDemo failed: ${res.error}`);
  process.exit(1);
}

const list = (title, keys) => console.log(`${title} (${keys.length})${keys.map((k) => `\n  ${k}`).join("")}`);
console.log(apply ? "Applied:\n" : "Dry run, nothing written. Run with --apply to write:\n");
list("Deals flipped to buyer -> seller", res.flipped);
list("Reversed duplicates deleted", res.deleted);
list("Companies added", res.new_companies);
list("Deals added", res.new_relationships);
if (res.holdings) console.log(`Demo portfolio added (${res.holdings} holdings)`);
