// Reads the graph and edits the demo portfolio with the service role, so the app
// works for visitors who aren't signed in (judges, the audience) whatever the
// entity access rules are.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.41";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "addHolding": {
        const existing = await db.Holding.filter({ company: body.company });
        if (existing.length) return Response.json(existing[0]);
        return Response.json(await db.Holding.create({ company: body.company, name: body.name, stake_usd: body.stake_usd }));
      }
      case "updateHolding":
        return Response.json(await db.Holding.update(body.id, { stake_usd: Number(body.stake_usd) || 0 }));
      case "removeHolding":
        await db.Holding.delete(body.id);
        return Response.json({ ok: true });
      default: {
        const [companies, relationships, holdings] = await Promise.all([
          db.Company.list("-created_date", 5000),
          db.Relationship.list("-created_date", 5000),
          db.Holding.list("created_date", 500),
        ]);
        return Response.json({ companies, relationships, holdings });
      }
    }
  } catch (err) {
    console.error(err);
    return Response.json({ error: String((err as Error)?.message || err) }, { status: 500 });
  }
});
