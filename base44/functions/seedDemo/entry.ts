// Loads the demo dataset (AI vendor-financing cluster + demo portfolio) and fixes the deals
// listed in corrections.ts. Idempotent: existing records with the same key are left alone.
// { dry_run: true } reports what it would change without writing (scripts/sync-seed.mjs).

import { createClientFromRequest } from "npm:@base44/sdk@0.8.41";
import { SEED_COMPANIES, SEED_RELATIONSHIPS, SEED_HOLDINGS } from "../../shared/seed.js";
import { REVERSED_EDGES } from "./corrections.ts";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;
    const body = await req.json().catch(() => ({}));
    const dryRun = !!body.dry_run;
    const [companies, rels, holdings] = await Promise.all([
      db.Company.list("-created_date", 5000),
      db.Relationship.list("-created_date", 5000),
      db.Holding.list("-created_date", 500),
    ]);

    // Fixes first, so a seed deal already saved the wrong way round isn't added a second time.
    const relByKey = new Map<string, any>(rels.map((r: any) => [r.key, r]));
    const flipped: string[] = [];
    const deleted: string[] = [];
    for (const { key } of REVERSED_EDGES) {
      const row = relByKey.get(key);
      if (!row) continue;
      const fixedKey = `${row.target}|${row.type}|${row.source}`;
      relByKey.delete(key);
      if (relByKey.has(fixedKey)) {
        deleted.push(key);
        if (!dryRun) await db.Relationship.delete(row.id);
      } else {
        flipped.push(key);
        relByKey.set(fixedKey, row);
        if (!dryRun) await db.Relationship.update(row.id, { key: fixedKey, source: row.target, target: row.source });
      }
    }

    const haveC = new Set(companies.map((c: any) => c.key));
    const newC = SEED_COMPANIES.filter((c) => !haveC.has(c.key)).map((c) => ({ ...c, origin: "seed" }));
    const newR = SEED_RELATIONSHIPS.filter((r) => !relByKey.has(r.key));
    const newH = holdings.length === 0 ? SEED_HOLDINGS : [];
    if (!dryRun) {
      if (newC.length) await db.Company.bulkCreate(newC);
      if (newR.length) await db.Relationship.bulkCreate(newR);
      if (newH.length) await db.Holding.bulkCreate(newH);
    }
    return Response.json({
      dry_run: dryRun,
      companies: newC.length, relationships: newR.length, holdings: newH.length,
      new_companies: newC.map((c) => c.key), new_relationships: newR.map((r) => r.key),
      flipped, deleted,
    });
  } catch (err) {
    console.error(err);
    return Response.json({ error: String((err as Error)?.message || err) }, { status: 500 });
  }
});
