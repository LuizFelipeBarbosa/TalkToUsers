// What-if analysis, in two steps the frontend calls in turn:
//   mode "parse":   free-text event -> structured shocks on companies in the graph
//   mode "explain": propagated impacts -> a short analyst memo per portfolio company
// The propagation itself is deterministic and runs in the browser (src/lib/graph.js),
// so the numbers on screen never depend on the LLM.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.41";

const PARSE_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "The event restated in under 12 words" },
    shocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string", description: "Exactly one of the company keys provided" },
          direction: { type: "number", enum: [-1, 1], description: "-1 bad for the company, 1 good" },
          severity: { type: "number", description: "0.1 minor, 0.4 serious, 0.7 severe, 0.9 existential" },
          reason: { type: "string" },
        },
        required: ["company", "direction", "severity"],
      },
    },
  },
  required: ["shocks"],
};

const EXPLAIN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Two sentences for the investment committee" },
    holdings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" },
          explanation: { type: "string", description: "One or two sentences: how the event reaches this company and what to watch" },
          action: { type: "string", description: "One concrete next step for the analyst" },
        },
        required: ["company", "explanation"],
      },
    },
  },
  required: ["summary", "holdings"],
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    // deno-lint-ignore no-explicit-any
    const llm = base44.asServiceRole.integrations.Core.InvokeLLM as (p: { prompt: string; response_json_schema?: object }) => Promise<any>;

    if (body.mode === "parse") {
      const companies: { key: string; name: string }[] = body.companies || [];
      const result = await llm({
        prompt: `An analyst describes a hypothetical event: "${String(body.event).slice(0, 500)}"
Translate it into direct shocks on companies from this list (use the key exactly):
${companies.map((c) => `${c.key}: ${c.name}`).join("\n")}
Only shock companies the event directly hits; knock-on effects are computed separately. Usually 1 to 3 shocks.`,
        response_json_schema: PARSE_SCHEMA,
      });
      const keys = new Set(companies.map((c) => c.key));
      const shocks = (result?.shocks || [])
        .filter((s: any) => keys.has(s.company))
        .map((s: any) => ({ ...s, severity: Math.min(1, Math.max(0.05, Number(s.severity) || 0.5)), direction: s.direction < 0 ? -1 : 1 }));
      return Response.json({ headline: result?.headline || body.event, shocks });
    }

    if (body.mode === "explain") {
      const result = await llm({
        prompt: `You are a VC portfolio risk analyst. Event: "${String(body.event).slice(0, 500)}".
A deterministic model propagated this event through the company relationship graph. Impact is 0 to 1 (1 = existential); "path" is how it travels; edges list the relationships along the path.
${JSON.stringify(body.impacts).slice(0, 12000)}
Write in the same language as the event description. Be specific about the relationships (name the deal and amount when given). Do not invent relationships that are not listed.`,
        response_json_schema: EXPLAIN_SCHEMA,
      });
      return Response.json(result);
    }

    return Response.json({ error: "mode must be parse or explain" }, { status: 400 });
  } catch (err) {
    console.error(err);
    return Response.json({ error: String((err as Error)?.message || err) }, { status: 500 });
  }
});
