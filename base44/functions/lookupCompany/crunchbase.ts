// Crunchbase, through Bright Data's Web Scraper API. Collecting a profile takes minutes,
// so a lookup starts it in round 1 and turns the record into edges in a later round.
// Crunchbase lists investors per round (with leads), the parent company, acquisitions,
// subsidiaries and investments. It has no valuations and no round or deal dates.

import { companyKey } from "../../shared/seed.js";
import type { BrightData } from "./brightdata.ts";
import { type CompanyInfo, fmtUsd } from "./extract.ts";

export const CRUNCHBASE_DATASET = "gd_l1vijqt9jfj7olije";
// A structured listing without an article behind it: below a quoted article (0.85), above
// an article that names the investor without quoting the deal (0.6).
const CONFIDENCE = 0.65;

// Crunchbase names a company by display name or URL slug ("anduril-industries").
export function sameCompany(a: string, b: string) {
  const x = companyKey(a);
  const y = companyKey(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)));
}

// The company's profile URL from a Google search, or null when no result is clearly it,
// with the links the search returned (for the log). Google via Bright Data sometimes
// answers empty or fails, so an empty answer gets a retry.
export async function findProfile(bd: BrightData, name: string): Promise<{ url: string | null; seen: string[] }> {
  let seen: string[] = [];
  for (let attempt = 0; attempt < 2 && !seen.length; attempt++) {
    const results = await bd.search(`site:crunchbase.com/organization ${name}`).catch(() => []);
    seen = results.map((r) => String(r.link || ""));
    for (const r of results) {
      const slug = String(r.link || "").match(/^https:\/\/www\.crunchbase\.com\/organization\/([a-z0-9-]+)\/?$/)?.[1];
      const title = String(r.title || "").split(" - ")[0];
      if (slug && (sameCompany(title, name) || sameCompany(slug.replace(/-/g, " "), name))) {
        return { url: `https://www.crunchbase.com/organization/${slug}`, seen };
      }
    }
  }
  return { url: null, seen };
}

export type Candidate = { edge: any; name: string; priority: number };

const titleCase = (slug: string) => slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const roundName = (title: string) => String(title || "").replace(/ - .*$/, "");

// Candidate edges from a Crunchbase record, most important first (parent, round leads,
// acquisitions). kindOf gives the kind of a company already on the graph.
export function edgesFromRecord(record: any, key: string, kindOf: (k: string) => string | undefined) {
  const candidates = new Map<string, Candidate>();
  const companies = new Map<string, CompanyInfo>();
  const name = record.name;
  // Edges run from the other company to this one unless `edge` says otherwise.
  const add = (other: string, priority: number, defaultKind: string, edge: any) => {
    const k = companyKey(other);
    if (!k || k === key) return;
    const e = {
      source: k, target: key, ...edge,
      source_url: record.url, confidence: CONFIDENCE, origin: "crunchbase",
      label: String(edge.label).slice(0, 90), evidence: String(edge.evidence).slice(0, 300),
    };
    e.key = `${e.source}|${e.type}|${e.target}`;
    if (candidates.has(e.key)) return;
    candidates.set(e.key, { edge: e, name: other, priority });
    if (!companies.has(k)) companies.set(k, { name: other, defaultKind });
  };

  // 1. Parent company: the ownership line, not an investor.
  const parentSlug = String(record.sub_organization_of || "").match(/organization\/([a-z0-9-]+)/)?.[1];
  const parentKey = parentSlug ? companyKey(parentSlug.replace(/-/g, " ")) : "";
  if (parentSlug) {
    const parent = titleCase(parentSlug);
    add(parent, 4, "private", { type: "owner", label: `${parent}: parent company`, evidence: `Crunchbase lists ${name} as a sub-organization of ${parent}` });
  }

  // 2. Investors, one edge each, with the newest round they were in. Round totals stay in
  // the label: a round's total is never one investor's cheque.
  const rounds = new Map<string, { title: string; amount: number; leads: string[] }>();
  for (const r of record.funding_rounds_list || []) {
    rounds.set(r.id, { title: r.title, amount: r.money_raised?.value_usd || 0, leads: (r.lead_investors || []).map((l: any) => l.name) });
  }
  // Grants aren't investments (and often come from governments, which the graph skips).
  const isGrant = (title: string) => /^grant\b/i.test(String(title || ""));
  const byInvestor = new Map<string, { name: string; rounds: string[]; led: string[] }>();
  const note = (investor: string, roundId: string, lead: boolean) => {
    const k = companyKey(investor);
    if (!k || isGrant(rounds.get(roundId)?.title || "")) return;
    const entry = byInvestor.get(k) || { name: investor, rounds: [], led: [] };
    if (!entry.rounds.includes(roundId)) entry.rounds.push(roundId);
    if (lead && !entry.led.includes(roundId)) entry.led.push(roundId);
    byInvestor.set(k, entry);
  };
  for (const i of record.investors || []) {
    if (i.investor?.type === "person" || !i.investor?.value) continue;
    const roundId = i.funding_round?.id;
    if (!rounds.has(roundId)) rounds.set(roundId, { title: i.funding_round?.value, amount: 0, leads: [] });
    note(i.investor.value, roundId, !!i.lead_investor || rounds.get(roundId)!.leads.includes(i.investor.value));
  }
  // Round leads the investor list leaves out (it is capped).
  for (const [roundId, r] of rounds) for (const lead of r.leads) note(lead, roundId, true);
  // Crunchbase lists rounds newest first.
  const order = [...rounds.keys()];
  const newest = (ids: string[]) => ids.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
  for (const [k, inv] of byInvestor) {
    if (k === parentKey) continue;
    // Name the newest round the investor led, else the newest one it joined.
    const shown = newest(inv.led) || newest(inv.rounds);
    const round = rounds.get(shown)!;
    const what = `${roundName(round.title)}${round.amount ? ` (${fmtUsd(round.amount)} round)` : ""}`;
    const more = inv.rounds.length > 1 ? ` (+${inv.rounds.length - 1} more)` : "";
    const lead = inv.led.length > 0;
    const kind = kindOf(k);
    add(inv.name, lead ? 3 : 1, "investor", {
      type: kind === "public" || kind === "private" ? "investment" : "venture",
      label: `${lead ? "Led" : "Joined"} ${what}${more}`,
      evidence: `Crunchbase lists ${inv.name} as ${lead ? "a lead investor" : "an investor"} in ${round.title}`,
    });
  }

  // 3. Acquisitions, then subsidiaries that aren't also acquisitions.
  for (const a of record.acquisitions || []) {
    const acquired = a.acquiree_identifier?.value;
    if (acquired) {
      add(acquired, 2, "private", {
        source: key, target: companyKey(acquired), type: "acquisition",
        label: `Acquired ${acquired}`, evidence: `Crunchbase: ${a.identifier?.value || `${acquired} acquired by ${name}`}`,
      });
    }
  }
  const acquiredKeys = new Set([...candidates.values()].filter((c) => c.edge.type === "acquisition").map((c) => c.edge.target));
  for (const s of record.sub_organizations || []) {
    if (!s.ownee || acquiredKeys.has(companyKey(s.ownee))) continue;
    add(s.ownee, 1, "private", {
      source: key, target: companyKey(s.ownee), type: "owner",
      label: `${s.ownee}: ${String(s.ownership_type || "subsidiary").replace(/_/g, " ")}`, evidence: `Crunchbase: ${s.title || `${name} owns ${s.ownee}`}`,
    });
  }

  // 4. The company's own investments in other companies.
  for (const i of record.investments || []) {
    const investee = i.organization?.value;
    if (!investee) continue;
    add(investee, 1, "private", {
      source: key, target: companyKey(investee), type: kindOf(key) === "investor" ? "venture" : "investment",
      label: `${i.lead_investor ? "Led" : "Joined"} ${roundName(i.funding_round?.value)} of ${investee}`,
      evidence: `Crunchbase: ${i.value || `${name} investment in ${i.funding_round?.value}`}`,
    });
  }

  const news: { url: string; title: string }[] = (record.news || []).filter((n: any) => n?.url).map((n: any) => ({ url: String(n.url), title: String(n.title || n.url) }));
  return { candidates: [...candidates.values()].sort((a, b) => b.priority - a.priority), companies, news };
}
