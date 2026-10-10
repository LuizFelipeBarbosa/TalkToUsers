// Loads the demo dataset (AI vendor-financing cluster + demo portfolio).
// Idempotent: existing records with the same key are left alone.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.41";
import { SEED_COMPANIES, SEED_RELATIONSHIPS, SEED_HOLDINGS } from "../../shared/seed.js";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;
    const [companies, rels, holdings] = await Promise.all([
      db.Company.list("-created_date", 5000),
      db.Relationship.list("-created_date", 5000),
      db.Holding.list("-created_date", 500),
    ]);
    const haveC = new Set(companies.map((c: any) => c.key));
    const haveR = new Set(rels.map((r: any) => r.key));
    const newC = SEED_COMPANIES.filter((c) => !haveC.has(c.key)).map((c) => ({ ...c, origin: "seed" }));
    const newR = SEED_RELATIONSHIPS.filter((r) => !haveR.has(r.key));
    if (newC.length) await db.Company.bulkCreate(newC);
    if (newR.length) await db.Relationship.bulkCreate(newR);
    let newH = 0;
    if (holdings.length === 0) {
      await db.Holding.bulkCreate(SEED_HOLDINGS);
      newH = SEED_HOLDINGS.length;
    }
    return Response.json({ companies: newC.length, relationships: newR.length, holdings: newH });
  } catch (err) {
    console.error(err);
    return Response.json({ error: String((err as Error)?.message || err) }, { status: 500 });
  }
});
