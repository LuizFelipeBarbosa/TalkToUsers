// LLM extraction: documents in, sourced edges out. Every edge must cite a document we
// actually read and, when we have its text, quote it. (Values are grounded separately,
// in valuation.ts.)

import { companyKey } from "../../shared/seed.js";
import type { Doc } from "./brightdata.ts";

export const TYPES = ["owner", "investment", "venture", "hardware", "cloud", "software", "supply", "acquisition", "partnership", "competitor"];

// What the other company is to the company of interest. The model names the role, which it
// gets right far more often than "who pays": asked for source/target, it put the provider
// first ("Microsoft → Anthropic" for Anthropic buying Azure capacity). Code sets the direction.
const ROLES = ["supplier", "customer", "investor", "investee", "acquirer", "acquired", "partner", "competitor"];
// Roles whose counterparty receives the company's money: the edge runs company → counterparty.
const PAID_BY_COMPANY = new Set(["supplier", "investee", "acquired"]);
const COMMERCIAL = ["hardware", "cloud", "software", "supply"];

// What a lookup learned about a company. `kind` overwrites the saved kind; `defaultKind` is
// only used when the company is new. `estimate` is the model's own guess at its value.
export type CompanyInfo = { name: string; kind?: string; defaultKind?: string; sector?: string; description?: string; estimate?: number };

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    company: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: { type: "string", enum: ["public", "private", "investor"] },
        sector: { type: "string" },
        value_usd: { type: "number", description: "Your own estimate of its market cap or latest valuation in USD, 0 if unknown" },
        description: { type: "string", description: "One sentence" },
        parent: {
          type: "object",
          description: "Majority owner or parent company, only if a document states it",
          properties: {
            name: { type: "string" },
            relation: { type: "string", description: "e.g. 'majority owner', 'parent company', 'wholly owned subsidiary of'" },
            doc_id: { type: "number" },
            evidence: { type: "string", description: "Short verbatim quote" },
          },
        },
      },
      required: ["name"],
    },
    funding_rounds: {
      type: "array",
      description: "Every funding round of the company of interest that the documents describe",
      items: {
        type: "object",
        properties: {
          round: { type: "string", description: "e.g. 'Series C', 'external round'" },
          date: { type: "string", description: "YYYY-MM or YYYY-MM-DD" },
          amount_usd: { type: "number", description: "Total size of the round in USD, 0 if not stated" },
          lead_investors: { type: "array", items: { type: "string" }, description: "Every investor said to lead or co-lead" },
          other_investors: { type: "array", items: { type: "string" }, description: "Every other investor named as participating, existing or new" },
          doc_id: { type: "number" },
          evidence: { type: "string", description: "Short verbatim quote naming the round" },
        },
        required: ["lead_investors", "other_investors", "doc_id"],
      },
    },
    counterparties: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          kind: { type: "string", enum: ["public", "private", "investor"], description: "'investor' for VC, PE, asset managers and funds" },
          sector: { type: "string" },
          value_usd: { type: "number", description: "Your own estimate, 0 if unknown" },
        },
        required: ["name"],
      },
    },
    relationships: {
      type: "array",
      items: {
        type: "object",
        properties: {
          counterparty: { type: "string", description: "The other company or investor" },
          role: { type: "string", enum: ROLES, description: "What the counterparty is to the company of interest, e.g. 'supplier' if the company buys from it" },
          type: { type: "string", enum: TYPES.filter((t) => t !== "owner"), description: "What the deal is about" },
          amount_usd: { type: "number", description: "Deal size in USD, 0 if not stated" },
          label: { type: "string", description: "Callout under 70 characters, e.g. 'Nvidia to invest up to $100B in OpenAI'" },
          date: { type: "string", description: "YYYY-MM or YYYY-MM-DD if stated" },
          doc_id: { type: "number", description: "Id of the document that states it" },
          evidence: { type: "string", description: "Short verbatim quote from that document" },
          confidence: { type: "number", description: "0 to 1" },
        },
        required: ["counterparty", "role", "type", "doc_id", "evidence"],
      },
    },
  },
  required: ["company", "relationships"],
};

// hints: relationships a structured source lists, for the model to confirm or ignore.
function extractionPrompt(name: string, docs: Doc[] | null, hints: string[]) {
  const rules = `You map business relationships for venture capital analysts.
Company of interest: "${name}".
Funding: put every funding round of "${name}" in funding_rounds and list EVERY investor the documents name for it, one name per entry: leads in lead_investors, everyone else ("with participation from", "existing investors", "also joined") in other_investors. If a document lists 15 investors, return all 15. The round total belongs to the round only, never to a single investor. Do not repeat round investors in relationships.
Ownership: if a document says "${name}" is owned by, a subsidiary of, or majority-owned by another company, fill company.parent.
Suppliers and customers matter as much as investors. In relationships, list EVERY company the documents say sells to, supplies, hosts, manufactures for or licenses to "${name}" (role "supplier"), and EVERY company that buys from or uses "${name}" (role "customer"), one entry per company. If a document names 10 customers, return all 10. Type them by what is bought: chips or hardware ("hardware"), cloud or compute ("cloud"), software, AI models or online services ("software"), anything else such as components, manufacturing, vehicles, logistics or licensing ("supply").
Also list in relationships: investments outside a round (role "investor" if it invests in "${name}", "investee" if "${name}" invests in it; type "investment" for companies, "venture" for VC funds), acquisitions (role "acquired" if "${name}" bought it, "acquirer" if it bought "${name}"; type "acquisition"), partnerships where neither side buys from the other (role "partner", type "partnership") and named competitors (role "competitor", type "competitor").
role is what the counterparty is to "${name}", read from who sells to whom: "Google provides TPUs to Anthropic" makes Google Anthropic's supplier, and Anthropic Google's customer. A "partnership" in which one side buys from the other is a supplier or customer relationship.
Use canonical company names (e.g. "Nvidia", not "NVIDIA Corporation"; "Andreessen Horowitz", not "a16z"). Add every investor and counterparty to counterparties with its kind. Skip people, governments and unnamed parties.
Only include relationships the documents actually state; do not use outside knowledge. Copy a short verbatim quote as evidence.
Ignore news on the page that is about other companies and does not involve "${name}".
In company.value_usd and each counterparty's value_usd, give your own rough estimate of its market value or latest valuation if you know it; it is shown as an estimate.${hints.length ? `\nLeads to check: a database lists these relationships. Include each one a document confirms, citing that document; ignore the rest.\n- ${hints.join("\n- ")}` : ""}`;
  if (!docs) return rules.replace("Only include relationships the documents actually state; do not use outside knowledge. Copy a short verbatim quote as evidence.", "Search the web. For each relationship, funding round and parent give the URL of the article that states it as evidence.");
  return `${rules}\n\nDocuments:\n${docs.map((d) => `\n[doc ${d.id}] ${d.title}\nURL: ${d.url}\n${d.text}`).join("\n")}`;
}

export async function extract(base44: any, name: string, docs: Doc[] | null, hints: string[] = []) {
  return await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: extractionPrompt(name, docs, hints),
    response_json_schema: EXTRACT_SCHEMA,
    ...(docs ? {} : { add_context_from_internet: true }),
  });
}

export const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function fmtUsd(n: number) {
  if (n >= 1e9) return `$${+(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(0)}M`;
  return `$${Math.round(n)}`;
}

// Whether a name is the company itself rather than an alias of it (Alphabet, not "GV").
export const isDirectName = (n?: string) => !!n && norm(n).replace(/ /g, "").startsWith(companyKey(n).slice(0, 4));

// Fragments the model sometimes returns instead of an investor's name.
const GENERIC = /^(capital|ventures?|partners|investors?|management|funds?|others|existinginvestors|newinvestors|and|various|.{0,1})$/;

// The edge type for a relationship, checked against the counterparty's role: where they
// disagree, the role decides (a supplier filed as a "partnership" is a supply deal).
// investorKind is the kind of whoever invests.
function typeFor(role: string, type: string, investorKind?: string) {
  if (role === "supplier" || role === "customer") return COMMERCIAL.includes(type) ? type : "supply";
  if (role === "investor" || role === "investee") return type === "investment" || type === "venture" ? type : investorKind === "investor" ? "venture" : "investment";
  if (role === "acquirer" || role === "acquired") return "acquisition";
  return role === "partner" ? "partnership" : "competitor";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function whenLabel(date?: string) {
  const m = String(date || "").match(/^(\d{4})(?:-(\d{2}))?/);
  if (!m) return "";
  return m[2] ? `${MONTHS[Number(m[2]) - 1] || ""} ${m[1]}`.trim() : m[1];
}

// Validate the model's answer: every edge must touch the company, cite a document we
// actually read and (when we have the text) quote it. Returns the edges and what we
// learned about each company on them.
export function edgesFromExtraction(result: any, docs: Doc[] | null, key: string, name: string) {
  const origin = docs ? "live" : "llm_web";
  const docById = new Map((docs || []).map((d) => [d.id, d]));
  const edges: any[] = [];
  const byKey = new Map<string, any>();
  const names: Record<string, string> = {};
  const kinds: Record<string, string> = {};
  const info: Record<string, any> = {};
  for (const c of [result?.company, ...(result?.counterparties || [])]) if (c?.name) info[companyKey(c.name)] = c;

  // Where a claim comes from: the article URL and a confidence, or null if it isn't sourced.
  const sourceFor = (doc_id: any, evidence: string, mustName?: string) => {
    if (!docs) {
      const url = (evidence || "").match(/https?:\/\/\S+/)?.[0] || "";
      return url ? { source_url: url, confidence: 0.6 } : null;
    }
    const d = docById.get(Number(doc_id));
    if (!d) return null;
    const text = norm(d.text);
    // A company must actually be named in the document it was taken from.
    if (mustName) {
      const n = norm(mustName);
      const first = n.split(" ")[0];
      if (!text.includes(n) && !(first.length >= 4 && text.includes(` ${first} `))) return null;
    }
    let source_url = d.url === "search-snippets" ? "" : d.url;
    const quoted = evidence && text.includes(norm(evidence).slice(0, 60));
    if (!source_url) {
      // Snippet-only evidence: keep it, pointing at the snippet's own link if present.
      const probe = norm(evidence || mustName || "").slice(0, 40);
      const m = d.text.split("\n").find((line) => probe && norm(line).includes(probe));
      source_url = m?.match(/\((https?:[^)]+)\)$/)?.[1] || "";
    }
    return source_url ? { source_url, confidence: quoted ? 0.85 : 0.6 } : null;
  };
  const addEdge = (e: any, sourceName: string, targetName: string) => {
    if (!e.source || !e.target || e.source === e.target || (e.source !== key && e.target !== key)) return false;
    if (byKey.has(e.key)) return false;
    names[e.source] ||= sourceName;
    names[e.target] ||= targetName;
    byKey.set(e.key, e);
    edges.push(e);
    return true;
  };

  // 1. Parent / majority owner.
  const parent = result?.company?.parent;
  const parentKey = parent?.name ? companyKey(parent.name) : "";
  if (parentKey && parentKey !== key) {
    const src = sourceFor(parent.doc_id, parent.evidence, parent.name);
    if (src) {
      const rel = String(parent.relation || "owner").toLowerCase();
      addEdge({
        key: `${parentKey}|owner|${key}`, source: parentKey, target: key, type: "owner",
        label: `${parent.name}: ${rel.includes("subsidiary") ? "parent company" : rel}`.slice(0, 90),
        source_url: src.source_url, confidence: src.confidence, evidence: String(parent.evidence || "").slice(0, 300), origin,
      }, parent.name, name);
    }
  }

  // 2. Funding rounds: one edge per investor, never carrying the round total.
  const rounds = (result?.funding_rounds || []).slice().sort((x: any, y: any) => String(y.date || "").localeCompare(String(x.date || "")));
  const roundTotals: number[] = [];
  let roundInvestors = 0;
  for (const r of rounds) {
    const amount = r.amount_usd > 0 ? r.amount_usd : 0;
    const investors = [
      ...(r.lead_investors || []).map((n: string) => ({ n, lead: true })),
      ...(r.other_investors || []).map((n: string) => ({ n, lead: false })),
    ];
    if (amount && investors.length > 1) roundTotals.push(amount);
    const what = [whenLabel(r.date), amount ? fmtUsd(amount) : "", "round"].filter(Boolean).join(" ");
    for (const { n, lead } of investors) {
      const k = companyKey(n);
      if (!k || k === key || GENERIC.test(k)) continue;
      const src = sourceFor(r.doc_id, r.evidence, n);
      if (!src) continue;
      if (k === parentKey) {
        // The owner investing again is part of the ownership line, not a separate edge.
        const own = byKey.get(`${parentKey}|owner|${key}`);
        if (own && !/round/.test(own.label)) own.label = `${own.label}; ${lead ? "led" : "joined"} ${what}`.slice(0, 90);
        continue;
      }
      const type = (info[k]?.kind || "investor") === "investor" ? "venture" : "investment";
      const ekey = `${k}|${type}|${key}`;
      const prev = byKey.get(ekey);
      if (prev) {
        // Same investor in an earlier round: count it in the label, keep the newest source.
        prev.rounds = (prev.rounds || 1) + 1;
        prev.label = `${prev.label.replace(/ \(\+\d+ earlier\)$/, "")} (+${prev.rounds - 1} earlier)`.slice(0, 90);
        continue;
      }
      kinds[k] ||= type === "venture" ? "investor" : "private";
      if (addEdge({
        key: ekey, source: k, target: key, type,
        label: `${lead ? "Led" : "Joined"} ${what}`.slice(0, 90),
        ...(r.date ? { date: String(r.date) } : {}),
        source_url: src.source_url, confidence: src.confidence, evidence: String(r.evidence || "").slice(0, 300), origin,
      }, n, name)) roundInvestors++;
    }
  }

  // 3. Everything else (suppliers, customers, direct investments, acquisitions,
  // partnerships). The counterparty's role sets the direction.
  for (const r of result?.relationships || []) {
    const other = companyKey(r.counterparty);
    if (!other || !ROLES.includes(r.role)) continue;
    const type = typeFor(r.role, r.type, r.role === "investee" ? info[key]?.kind : info[other]?.kind || "investor");
    // Round investors were already added above; don't add them twice under another type.
    if (r.role === "investor" && (byKey.has(`${other}|venture|${key}`) || byKey.has(`${other}|investment|${key}`) || other === parentKey)) continue;
    const src = sourceFor(r.doc_id, r.evidence);
    if (!src) continue;
    let [s, t] = PAID_BY_COMPANY.has(r.role) ? [key, other] : [other, key];
    // Partners and competitors have no money direction: one fixed order, so the same
    // partnership found from either side is one edge.
    if (type === "partnership" || type === "competitor") [s, t] = [s, t].sort();
    // A round's total is never one investor's cheque.
    const amount = r.amount_usd > 0 && !roundTotals.some((x) => Math.abs(x - r.amount_usd) / x < 0.05) ? r.amount_usd : 0;
    const nameOf = (k: string) => (k === key ? name : r.counterparty);
    addEdge({
      key: `${s}|${type}|${t}`, source: s, target: t, type,
      ...(amount ? { amount_usd: amount } : {}),
      label: String(r.label || "").slice(0, 90),
      ...(r.date ? { date: r.date } : {}),
      source_url: src.source_url, confidence: Math.min(src.confidence, Math.max(0.3, r.confidence ?? 0.8)),
      evidence: String(r.evidence || "").slice(0, 300), origin,
    }, nameOf(s), nameOf(t));
  }
  for (const e of edges) delete e.rounds;

  // What we learned about each company on an edge (and the company itself).
  const nameFor = (k: string) => {
    if (k === key) return result?.company?.name || name;
    const options = [info[k]?.name, names[k], ...(result?.counterparties || []).filter((c: any) => companyKey(c?.name) === k).map((c: any) => c.name)].filter(Boolean);
    return options.find(isDirectName) || options[0] || k;
  };
  const companies = new Map<string, CompanyInfo>();
  for (const k of new Set([key, ...edges.flatMap((e) => [e.source, e.target])])) {
    const c = info[k] || {};
    companies.set(k, {
      name: nameFor(k),
      ...(c.kind ? { kind: c.kind } : {}),
      defaultKind: kinds[k] || "private",
      ...(c.sector ? { sector: c.sector } : {}),
      ...(k === key && c.description ? { description: c.description } : {}),
      ...(c.value_usd > 0 ? { estimate: c.value_usd } : {}),
    });
  }

  const summary = `${edges.length} sourced relationships (${rounds.length} rounds, ${roundInvestors} round investors${parentKey && byKey.has(`${parentKey}|owner|${key}`) ? ", owner" : ""})`;
  return { edges, companies, summary };
}
