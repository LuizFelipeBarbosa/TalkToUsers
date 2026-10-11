// Pre-runs live lookups for companies likely to be searched at an SF hackathon, so the
// app answers them from the cache. Runs in deep mode (more articles, stronger model),
// which only the deployed function version with `deep` support honours. Already-cached companies are skipped unless --force.
//   node scripts/warm-cache.mjs [--force] [Name ...]
import { createClient } from "@base44/sdk";
import { companyKey } from "../base44/shared/seed.js";

const base44 = createClient({ appId: process.env.BASE44_APP_ID || "6acaa6f6770567c4e1a3ea84", serverUrl: "https://base44.app", requiresAuth: false });
const COMPANIES = [
  // Big tech and AI labs
  "OpenAI", "Anthropic", "Google", "Microsoft", "Amazon", "Meta", "Apple", "Nvidia", "xAI", "Mistral AI", "Cohere", "Salesforce", "Oracle", "Tesla",
  // AI infrastructure and compute
  "CoreWeave", "Lambda", "Groq", "Cerebras", "Together AI", "Fireworks AI", "Baseten", "Modal", "Replicate", "Hugging Face", "Scale AI", "Databricks", "Snowflake",
  // Dev tools and platforms common at hackathons
  "Vercel", "Supabase", "Replit", "Anysphere", "Cognition", "Lovable", "StackBlitz", "Base44", "Neon", "Convex", "Clerk", "Stripe", "GitHub", "Linear", "Retool", "Figma", "Notion",
  // Agent and data tooling
  "Browserbase", "Browser Use", "Steel.dev", "Hyperbrowser", "Bright Data", "Exa", "Tavily", "Firecrawl", "E2B", "Daytona", "LangChain", "LlamaIndex", "Pinecone", "Weaviate", "ElevenLabs", "Vapi", "Perplexity", "Glean", "Sierra", "Decagon", "Harvey", "Mercor", "Ramp", "Brex", "Rippling",
];
const args = process.argv.slice(2);
const force = args.includes("--force");
const names = args.filter((a) => a !== "--force").length ? args.filter((a) => a !== "--force") : COMPANIES;

const touched = new Set();
let i = 0;
async function worker() {
  while (i < names.length) {
    const name = names[i++];
    const t0 = Date.now();
    try {
      const res = (await base44.functions.invoke("lookupCompany", { name, force, deep: true })).data;
      if (res?.error) throw new Error(res.error);
      touched.add(res.key);
      for (const r of res.relationships || []) touched.add(r.source), touched.add(r.target);
      console.log(`${name}: ${res.cached ? "cached" : `${res.added} relationships`} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) {
      console.log(`${name}: FAILED ${String(e.message || e).slice(0, 120)}`);
    }
  }
}
await Promise.all([worker(), worker(), worker()]);

// Market values the lookups couldn't source, a chunk at a time.
const keys = [...touched];
for (let k = 0; k < keys.length; k += 15) {
  let todo = keys.slice(k, k + 15);
  for (let round = 0; round < 2 && todo.length; round++) {
    const res = (await base44.functions.invoke("lookupCompany", { action: "fillValues", keys: todo })).data;
    todo = res?.retry || [];
  }
}
console.log(`done: ${names.length} lookups, values checked for ${keys.length} companies`);
