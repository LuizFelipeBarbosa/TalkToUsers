// One data API for the UI. Deployed on Base44 it uses entities + backend functions;
// opened locally without an app id (or with ?offline=1) it runs on the bundled demo
// data so the app can be shown even with no network.

import { base44 } from "@/api/base44Client";
import { SEED_COMPANIES, SEED_RELATIONSHIPS, SEED_HOLDINGS, companyKey } from "../../base44/shared/seed.js";

const params = new URLSearchParams(window.location.search);
export const OFFLINE = params.get("offline") === "1" || !import.meta.env.VITE_BASE44_APP_ID;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Offline (bundled demo data) ----------
const mem = {
  companies: SEED_COMPANIES.map((c) => ({ ...c, id: c.key, origin: "seed" })),
  relationships: SEED_RELATIONSHIPS.map((r) => ({ ...r, id: r.key })),
  holdings: SEED_HOLDINGS.map((h) => ({ ...h, id: h.company })),
};

const offline = {
  async loadAll() {
    return { companies: [...mem.companies], relationships: [...mem.relationships], holdings: [...mem.holdings] };
  },
  async seed() {
    return { companies: 0, relationships: 0, holdings: 0 };
  },
  async lookup(name, onStep) {
    const key = companyKey(name);
    onStep?.("Searching the web");
    await sleep(500);
    onStep?.("Reading articles");
    await sleep(600);
    onStep?.("Extracting relationships");
    await sleep(500);
    if (!mem.companies.some((c) => c.key === key)) {
      throw new Error("Offline demo only knows the bundled companies. Live lookup works on the deployed app.");
    }
    return { key, cached: true, log: ["offline demo data"] };
  },
  async addHolding(company, name, stake_usd) {
    const h = { id: company, company, name, stake_usd };
    mem.holdings = [...mem.holdings.filter((x) => x.company !== company), h];
    return h;
  },
  async removeHolding(id) {
    mem.holdings = mem.holdings.filter((h) => h.id !== id);
  },
  async updateHolding(id, patch) {
    mem.holdings = mem.holdings.map((h) => (h.id === id ? { ...h, ...patch } : h));
  },
  async parseEvent(event, companies) {
    await sleep(400);
    return heuristicParse(event, companies);
  },
  async explain() {
    await sleep(300);
    return null; // the UI writes its own explanation from the paths
  },
};

// Rough keyword parse, used offline and as a fallback if the LLM call fails.
export function heuristicParse(event, companies) {
  const text = event.toLowerCase();
  const hits = companies
    .filter((c) => {
      const names = [c.name.toLowerCase(), c.name.toLowerCase().replace(/\s*\(.*\)/, ""), c.key];
      const paren = c.name.match(/\((.*)\)/)?.[1]?.toLowerCase();
      if (paren) names.push(paren);
      return names.some((n) => n.length > 2 && text.includes(n));
    })
    .slice(0, 3);
  const positive = /(raises|ipo|wins|surge|beats|doubles|boom|grows|上涨|融资成功|增长)/.test(text);
  const severe = /(bankrupt|collapse|fails|fraud|default|halts|shut|破产|倒闭|暴雷|违约)/.test(text);
  const serious = /(cut|cancel|delay|miss|lawsuit|ban|sanction|downgrade|loses|layoff|削减|取消|推迟|失败|制裁|裁员)/.test(text);
  const severity = severe ? 0.85 : serious ? 0.55 : 0.4;
  return {
    headline: event,
    shocks: hits.map((c) => ({ company: c.key, direction: positive && !severe && !serious ? 1 : -1, severity, reason: "keyword match" })),
  };
}

// ---------- Deployed on Base44 ----------
const online = {
  async loadAll() {
    const res = await base44.functions.invoke("graphData", { action: "load" });
    if (res.data?.error) throw new Error(res.data.error);
    return res.data;
  },
  async seed() {
    return (await base44.functions.invoke("seedDemo", {})).data;
  },
  async lookup(name, onStep, { force = false } = {}) {
    // The function runs search, reading and extraction in one call; the steps are
    // shown on a timer so the audience sees what is happening.
    const steps = ["Searching the web (Bright Data)", "Reading articles", "Extracting relationships with AI", "Checking sources"];
    let i = 0;
    onStep?.(steps[0]);
    const timer = setInterval(() => {
      i = Math.min(i + 1, steps.length - 1);
      onStep?.(steps[i]);
    }, 6000);
    try {
      const res = await base44.functions.invoke("lookupCompany", { name, force });
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    } finally {
      clearInterval(timer);
    }
  },
  async addHolding(company, name, stake_usd) {
    return (await base44.functions.invoke("graphData", { action: "addHolding", company, name, stake_usd })).data;
  },
  async removeHolding(id) {
    return (await base44.functions.invoke("graphData", { action: "removeHolding", id })).data;
  },
  async updateHolding(id, patch) {
    return (await base44.functions.invoke("graphData", { action: "updateHolding", id, ...patch })).data;
  },
  async parseEvent(event, companies) {
    try {
      const res = await base44.functions.invoke("analyzeScenario", {
        mode: "parse",
        event,
        companies: companies.map((c) => ({ key: c.key, name: c.name })),
      });
      if (res.data?.shocks?.length) return res.data;
    } catch (e) {
      console.warn("parse failed, using keywords", e);
    }
    return heuristicParse(event, companies);
  },
  async explain(event, impacts) {
    try {
      return (await base44.functions.invoke("analyzeScenario", { mode: "explain", event, impacts })).data;
    } catch (e) {
      console.warn("explain failed", e);
      return null;
    }
  },
};

export const api = OFFLINE ? offline : online;
export { companyKey };
