// Demo data: the AI "vendor financing" cluster (after Bloomberg's chart) plus three
// companies from the first live-lookup test. Every relationship carries the article
// it came from. Values are approximate, as reported in late 2025.
// Direction follows the money: investor -> investee, buyer -> seller, acquirer -> acquired.

export const SEED_COMPANIES = [
  { key: "nvidia", name: "Nvidia", kind: "public", sector: "Semiconductors", value_usd: 4.5e12 },
  { key: "microsoft", name: "Microsoft", kind: "public", sector: "Cloud / Software", value_usd: 3.9e12 },
  { key: "broadcom", name: "Broadcom", kind: "public", sector: "Semiconductors", value_usd: 1.6e12 },
  { key: "oracle", name: "Oracle", kind: "public", sector: "Cloud", value_usd: 7.5e11 },
  { key: "openai", name: "OpenAI", kind: "private", sector: "AI models", value_usd: 5e11 },
  { key: "amd", name: "AMD", kind: "public", sector: "Semiconductors", value_usd: 3.8e11 },
  { key: "asml", name: "ASML", kind: "public", sector: "Semiconductor equipment", value_usd: 3.8e11 },
  { key: "xai", name: "xAI", kind: "private", sector: "AI models", value_usd: 2e11 },
  { key: "anthropic", name: "Anthropic", kind: "private", sector: "AI models", value_usd: 1.83e11 },
  { key: "intel", name: "Intel", kind: "public", sector: "Semiconductors", value_usd: 1.8e11 },
  { key: "coreweave", name: "CoreWeave", kind: "public", sector: "GPU cloud", value_usd: 6.5e10 },
  { key: "figureai", name: "Figure AI", kind: "private", sector: "Robotics", value_usd: 3.9e10 },
  { key: "anysphere", name: "Anysphere (Cursor)", kind: "private", sector: "AI coding", value_usd: 2.93e10 },
  { key: "nebius", name: "Nebius", kind: "public", sector: "GPU cloud", value_usd: 2.5e10 },
  { key: "mistralai", name: "Mistral AI", kind: "private", sector: "AI models", value_usd: 1.4e10 },
  { key: "harveyai", name: "Harvey AI", kind: "private", sector: "Legal AI", value_usd: 5e9 },
  { key: "nscale", name: "Nscale", kind: "private", sector: "GPU cloud", value_usd: 3e9 },
  { key: "ambiencehealthcare", name: "Ambience Healthcare", kind: "private", sector: "Healthcare AI", value_usd: 1.25e9 },
  // From the live-lookup test (Base44, Ramp, Clay)
  { key: "wix", name: "Wix", kind: "public", sector: "Website builder", value_usd: 7e9 },
  { key: "base44", name: "Base44", kind: "private", sector: "AI app builder", value_usd: 8e7 },
  { key: "etoro", name: "eToro", kind: "public", sector: "Brokerage", value_usd: 5e9 },
  { key: "similarweb", name: "SimilarWeb", kind: "public", sector: "Web analytics", value_usd: 7e8 },
  { key: "ramp", name: "Ramp", kind: "private", sector: "Fintech", value_usd: 1.6e10 },
  { key: "foundersfund", name: "Founders Fund", kind: "investor", sector: "Venture capital" },
  { key: "thrivecapital", name: "Thrive Capital", kind: "investor", sector: "Venture capital" },
  { key: "shopify", name: "Shopify", kind: "public", sector: "E-commerce", value_usd: 2e11 },
  { key: "notion", name: "Notion", kind: "private", sector: "Software", value_usd: 1e10 },
  { key: "anduril", name: "Anduril", kind: "private", sector: "Defense", value_usd: 3.05e10 },
  { key: "navan", name: "Navan", kind: "private", sector: "Travel & expense", value_usd: 6e9 },
  { key: "clay", name: "Clay", kind: "private", sector: "GTM data", value_usd: 3.1e9 },
  { key: "capitalg", name: "CapitalG", kind: "investor", sector: "Venture capital" },
  { key: "sequoiacapital", name: "Sequoia Capital", kind: "investor", sector: "Venture capital" },
];

const S = {
  nvOpenai: "https://www.axios.com/2025/09/22/nvidia-openai-chatgpt-jensen-huang",
  oracle300: "https://the-decoder.com/openai-signs-300-billion-cloud-contract-with-oracle-according-to-wsj/",
  oracleChips: "https://siliconangle.com/2025/05/23/oracle-reportedly-buying-400000-nvidia-chips-first-stargate-data-center/",
  amd: "https://www.tomshardware.com/pc-components/gpus/openai-signs-6gw-amd-gpu-deal",
  cwOpenai: "https://www.coreweave.com/news/coreweave-expands-agreement-with-openai-by-up-to-6-5b",
  nvCw: "https://www.rcrwireless.com/20250916/ai-infrastructure/nvidia-cloud",
  cwIpo: "https://convergedigest.com/coreweave-files-for-ipo-explosive-growth-and-250k-gpus/",
  cwS1: "https://nbcsandiego.com/news/business/money-report/ai-cloud-provider-coreweave-files-for-ipo/3768171",
  nebius: "https://datacenterdynamics.com/en/news/microsoft-to-use-nebius-gpu-data-centers-in-deal-worth-174bn-over-five-years",
  intel: "https://www.emarketer.com/content/nvidia-invests--5-billion-intel--takes-4-5--stake",
  msOpenai: "https://www.scmp.com/tech/big-tech/article/3330714/microsoft-holds-27-openai-revamped-partnership",
  xai: "https://www.datacenterdynamics.com/en/news/nvidia-to-invest-in-xai-special-purpose-vehicle-cash-to-be-used-to-buy-nvidia-gpus/",
  mistral: "https://mistral.ai/news/mistral-ai-raises-1-7-b-to-accelerate-technological-progress-with-ai",
  figure: "https://finance.yahoo.com/news/figure-valued-39-billion-latest-131115237.html",
  oaiFund: "https://techcrunch.com/2025/03/01/openais-startup-empire-the-companies-backed-by-its-venture-fund",
  anthropic: "https://www.scmp.com/tech/big-tech/article/3333330/microsoft-nvidia-invest-anthropic-claude-maker-commits-us30-billion-azure",
  broadcom: "https://openai.com/index/openai-and-broadcom-announce-strategic-collaboration/",
  nscale: "https://www.computing.co.uk/news/2025/nscale-strikes-14-billion-ai-deal-with-microsoft",
  nscaleGpu: "https://www.intelligentcio.com/eu/2025/10/16/nscale-contracts-approximately-200000-nvidia-gb300-gpus-with-microsoft-to-deliver-nvidia-ai-infrastructure-across-europe-and-the-us/",
  wix: "https://finviz.com/news/84002/wix-acquires-base44-to-boost-ai-driven-intent-based-software-development",
  ramp: "https://www.nbcsandiego.com/news/business/money-report/fintech-ramps-valuation-hits-16-billion-in-deal-led-by-peter-thiels-founders-fund/3850034",
  clay: "https://www.businesswire.com/news/home/20250805719448/en/AI-GTM-Leader-Clay-Raises-%2524100M-Series-C-to-Fuel-GTM-Engineering-Roles-Industrywide",
};

// [source, type, target, amount_usd, label, date, source_url]
const E = [
  ["nvidia", "investment", "openai", 1e11, "Nvidia to invest up to $100B in OpenAI", "2025-09-22", S.nvOpenai],
  ["openai", "hardware", "nvidia", null, "OpenAI to deploy 10 GW of Nvidia systems", "2025-09-22", S.nvOpenai],
  ["openai", "cloud", "oracle", 3e11, "OpenAI inks a $300B cloud deal with Oracle", "2025-09-10", S.oracle300],
  ["oracle", "hardware", "nvidia", 4e10, "Oracle buys ~$40B of Nvidia chips for Stargate", "2025-05-23", S.oracleChips],
  ["openai", "hardware", "amd", null, "OpenAI to deploy 6 GW of AMD GPUs", "2025-10-06", S.amd],
  ["amd", "investment", "openai", null, "AMD gives OpenAI a warrant for up to 160M AMD shares", "2025-10-06", S.amd],
  ["openai", "cloud", "coreweave", 2.24e10, "OpenAI contracts with CoreWeave total up to $22.4B", "2025-09-25", S.cwOpenai],
  ["nvidia", "cloud", "coreweave", 6.3e9, "Nvidia backstops $6.3B of CoreWeave's unused capacity", "2025-09-16", S.nvCw],
  ["nvidia", "investment", "coreweave", null, "Nvidia is a CoreWeave shareholder", "2025-03-03", S.cwIpo],
  ["coreweave", "hardware", "nvidia", null, "CoreWeave runs 250k+ Nvidia GPUs", "2025-03-03", S.cwIpo],
  ["microsoft", "cloud", "coreweave", 1.19e9, "Microsoft was 62% of CoreWeave's 2024 revenue", "2025-03-03", S.cwS1],
  ["microsoft", "cloud", "nebius", 1.74e10, "Microsoft signs a $17.4B GPU capacity deal with Nebius", "2025-09-08", S.nebius],
  ["nvidia", "investment", "intel", 5e9, "Nvidia invests $5B in Intel", "2025-09-18", S.intel],
  ["microsoft", "investment", "openai", 1.35e11, "Microsoft holds ~27% of OpenAI (~$135B stake)", "2025-10-28", S.msOpenai],
  ["openai", "cloud", "microsoft", 2.5e11, "OpenAI commits to $250B of Azure", "2025-10-28", S.msOpenai],
  ["nvidia", "investment", "xai", 2e9, "Nvidia invests up to $2B in xAI", "2025-10-08", S.xai],
  ["xai", "hardware", "nvidia", null, "xAI's raise is used to buy Nvidia GPUs", "2025-10-08", S.xai],
  ["asml", "investment", "mistralai", 1.5e9, "ASML leads Mistral's EUR 1.7B Series C", "2025-09-09", S.mistral],
  ["nvidia", "investment", "mistralai", null, "Nvidia joins Mistral's Series C", "2025-09-09", S.mistral],
  ["nvidia", "venture", "figureai", null, "Nvidia backs Figure AI", "2025-09-16", S.figure],
  ["openai", "venture", "harveyai", null, "OpenAI Startup Fund backs Harvey", "2025-03-01", S.oaiFund],
  ["harveyai", "software", "openai", null, "Harvey is built on OpenAI models", "2025-03-01", S.oaiFund],
  ["openai", "venture", "anysphere", null, "OpenAI Startup Fund backs Anysphere (Cursor)", "2025-03-01", S.oaiFund],
  ["anysphere", "software", "openai", null, "Cursor buys OpenAI model access", "2025-03-01", S.oaiFund],
  ["openai", "venture", "ambiencehealthcare", null, "OpenAI Startup Fund backs Ambience", "2025-03-01", S.oaiFund],
  ["ambiencehealthcare", "software", "openai", null, "Ambience is built on OpenAI models", "2025-03-01", S.oaiFund],
  ["microsoft", "investment", "anthropic", 5e9, "Microsoft to invest up to $5B in Anthropic", "2025-11-18", S.anthropic],
  ["nvidia", "investment", "anthropic", 1e10, "Nvidia to invest up to $10B in Anthropic", "2025-11-18", S.anthropic],
  ["anthropic", "cloud", "microsoft", 3e10, "Anthropic commits $30B to Azure", "2025-11-18", S.anthropic],
  ["openai", "hardware", "broadcom", null, "OpenAI and Broadcom to deploy 10 GW of custom chips", "2025-10-13", S.broadcom],
  ["microsoft", "cloud", "nscale", 1.4e10, "Microsoft signs a ~$14B deal with Nscale", "2025-10-15", S.nscale],
  ["nscale", "hardware", "nvidia", null, "Nscale contracts ~200k Nvidia GB300 GPUs", "2025-10-16", S.nscaleGpu],
  ["amd", "competitor", "nvidia", null, "GPU rivals", null, S.amd],
  ["anthropic", "competitor", "openai", null, "Frontier model rivals", null, S.anthropic],
  // Live-lookup test results
  ["wix", "acquisition", "base44", 8e7, "Wix acquires Base44 for ~$80M + earn-out", "2025-06-18", S.wix],
  ["etoro", "software", "base44", null, "eToro is a Base44 customer", "2025-06-18", S.wix],
  ["similarweb", "software", "base44", null, "SimilarWeb is a Base44 customer", "2025-06-18", S.wix],
  ["foundersfund", "venture", "ramp", 2e8, "Founders Fund leads Ramp's $200M round", "2025-06-17", S.ramp],
  ["thrivecapital", "venture", "ramp", null, "Thrive Capital invests in Ramp", "2025-06-17", S.ramp],
  ["shopify", "software", "ramp", null, "Shopify is a Ramp customer", "2025-06-17", S.ramp],
  ["notion", "software", "ramp", null, "Notion is a Ramp customer", "2025-06-17", S.ramp],
  ["anduril", "software", "ramp", null, "Anduril is a Ramp customer", "2025-06-17", S.ramp],
  ["foundersfund", "venture", "anduril", null, "Founders Fund backs Anduril", "2025-06-17", S.ramp],
  ["ramp", "competitor", "navan", null, "Ramp Travel competes with Navan", "2025-06-17", S.ramp],
  ["capitalg", "venture", "clay", 1e8, "CapitalG leads Clay's $100M Series C", "2025-08-05", S.clay],
  ["sequoiacapital", "venture", "clay", null, "Sequoia invests in Clay", "2025-08-05", S.clay],
  ["openai", "software", "clay", null, "OpenAI is a Clay customer", "2025-08-05", S.clay],
  ["anthropic", "software", "clay", null, "Anthropic is a Clay customer", "2025-08-05", S.clay],
  ["anysphere", "software", "clay", null, "Cursor is a Clay customer", "2025-08-05", S.clay],
];

export const SEED_RELATIONSHIPS = E.map(([source, type, target, amount_usd, label, date, source_url]) => ({
  key: `${source}|${type}|${target}`,
  source, target, type,
  ...(amount_usd ? { amount_usd } : {}),
  label, ...(date ? { date } : {}), source_url,
  confidence: 0.95,
  origin: "seed",
}));

export const SEED_HOLDINGS = [
  { company: "harveyai", name: "Harvey AI", stake_usd: 4e7 },
  { company: "anysphere", name: "Anysphere (Cursor)", stake_usd: 6e7 },
  { company: "ambiencehealthcare", name: "Ambience Healthcare", stake_usd: 2.5e7 },
  { company: "coreweave", name: "CoreWeave", stake_usd: 8e7 },
  { company: "clay", name: "Clay", stake_usd: 3e7 },
  { company: "ramp", name: "Ramp", stake_usd: 5e7 },
];

// Shared by the frontend and backend so both dedupe companies the same way.
const ALIASES = { cursor: "anysphere", anysphereinc: "anysphere", harvey: "harveyai", mistral: "mistralai", figure: "figureai", ambience: "ambiencehealthcare", openaistartupfund: "openai", sequoia: "sequoiacapital", nvidiacorporation: "nvidia", microsoftcorporation: "microsoft", oraclecorporation: "oracle",
  // Investor short names, and Alphabet's investment arms counted as Alphabet.
  a16z: "andreessenhorowitz", andreessen: "andreessenhorowitz", dst: "dstglobal", gv: "alphabet", googleventures: "alphabet", capitalg: "alphabet",
  dragoneerinvestment: "dragoneer", tigerglobalmanagement: "tigerglobal", trowepriceassociates: "troweprice", silverlakepartners: "silverlake",
  fidelityinvestments: "fidelity", fidelitymanagementresearch: "fidelity", fidelitymanagementandresearch: "fidelity", kpcb: "kleinerperkins", kleinerperkinscaufieldbyers: "kleinerperkins",
  elementfleet: "elementfleetmanagement", element: "elementfleetmanagement", toyotamotor: "toyota", toyotamotors: "toyota",
  google: "alphabet", googleinvestment: "alphabet", mubadala: "mubadalainvestment", mubadalacapital: "mubadalainvestment" };

// Well-known companies a live lookup often names without a market value (an owner, a
// partner). Fills value_usd when the record has none, so a $4T parent isn't drawn as
// an unknown dot; a `name` here replaces whatever name the lookup saved.
// Approximate market caps, late 2026.
export const KNOWN_COMPANIES = {
  alphabet: { name: "Alphabet (Google)", kind: "public", value_usd: 4e12 },
  apple: { kind: "public", value_usd: 4e12 },
  amazon: { kind: "public", value_usd: 2.4e12 },
  meta: { kind: "public", value_usd: 1.8e12 },
  tsmc: { kind: "public", value_usd: 1.5e12 },
  tesla: { kind: "public", value_usd: 1.4e12 },
  berkshirehathaway: { kind: "public", value_usd: 1e12 },
  walmart: { kind: "public", value_usd: 8e11 },
  jpmorganchase: { kind: "public", value_usd: 8e11 },
  tencent: { kind: "public", value_usd: 7e11 },
  netflix: { kind: "public", value_usd: 4.5e11 },
  samsung: { kind: "public", value_usd: 4e11 },
  palantir: { kind: "public", value_usd: 4e11 },
  alibaba: { kind: "public", value_usd: 3.5e11 },
  salesforce: { kind: "public", value_usd: 2.5e11 },
  ibm: { kind: "public", value_usd: 2.5e11 },
  cisco: { kind: "public", value_usd: 2.7e11 },
  toyota: { kind: "public", value_usd: 2.5e11 },
  softbank: { kind: "public", value_usd: 2e11 },
  qualcomm: { kind: "public", value_usd: 1.8e11 },
  uber: { kind: "public", value_usd: 1.5e11 },
  doordash: { kind: "public", value_usd: 1e11 },
  generalmotors: { kind: "public", value_usd: 6e10 },
  hyundaimotor: { kind: "public", value_usd: 5e10 },
  ford: { kind: "public", value_usd: 4.5e10 },
  magnainternational: { kind: "public", value_usd: 1.5e10 },
  elementfleetmanagement: { name: "Element Fleet Management", kind: "public", value_usd: 1e10 },
  autonation: { kind: "public", value_usd: 8e9 },
  lyft: { kind: "public", value_usd: 5e9 },
  mubadalainvestment: { name: "Mubadala Investment Company", kind: "investor" },
};

export const canonicalKey = (k) => ALIASES[k] || k;

// Folds records saved under an alias (Google, Element, Mubadala Capital) into one company,
// fills known market values, and merges the edges that then coincide.
export function canonicalGraph({ companies, relationships, holdings = [] }) {
  const byKey = new Map();
  for (const c of companies) {
    const key = canonicalKey(c.key);
    const prev = byKey.get(key);
    // The record already under the canonical key is the base; others only fill gaps.
    const [base, extra] = !prev ? [c, {}] : c.key === key && prev.key !== key ? [c, prev] : [prev, c];
    const merged = { ...base };
    for (const f of Object.keys(extra)) if (merged[f] == null || merged[f] === "") merged[f] = extra[f];
    byKey.set(key, { ...merged, key });
  }
  for (const [key, c] of byKey) {
    const known = KNOWN_COMPANIES[key];
    if (!known) continue;
    byKey.set(key, { ...c, ...(known.name ? { name: known.name } : {}), kind: known.kind || c.kind, value_usd: c.value_usd || known.value_usd });
  }

  const rels = new Map();
  const newer = (a, b) => String(a.date || "").localeCompare(String(b.date || "")) > 0;
  for (const r of relationships) {
    let source = canonicalKey(r.source);
    let target = canonicalKey(r.target);
    if (source === target) continue;
    // Partnerships and competitors have no direction: A–B and B–A are the same edge.
    if ((r.type === "partnership" || r.type === "competitor") && source > target) [source, target] = [target, source];
    const key = `${source}|${r.type}|${target}`;
    const prev = rels.get(key);
    const e = { ...r, key, source, target };
    if (!prev) rels.set(key, e);
    else {
      const [keep, other] = newer(e, prev) || (e.amount_usd && !prev.amount_usd) ? [e, prev] : [prev, e];
      // The same investor's two rounds: one edge, the older round counted in the label.
      if ((r.type === "venture" || r.type === "investment") && /round/.test(other.label || "") && !/earlier\)$/.test(keep.label || "")) {
        keep.label = `${keep.label} (+1 earlier)`.slice(0, 90);
      }
      rels.set(key, keep);
    }
  }
  // An owner that also invested is shown once, on the ownership edge.
  const owned = new Set([...rels.values()].filter((r) => r.type === "owner").map((r) => `${r.source}|${r.target}`));
  const relList = [...rels.values()].filter((r) => !((r.type === "venture" || r.type === "investment") && owned.has(`${r.source}|${r.target}`)));

  const seenH = new Set();
  const holdList = holdings
    .map((h) => ({ ...h, company: canonicalKey(h.company) }))
    .filter((h) => !seenH.has(h.company) && seenH.add(h.company));
  return { companies: [...byKey.values()], relationships: relList, holdings: holdList };
}

export function companyKey(name) {
  const k = String(name || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\.(com|ai|io|co|net)\b/g, "")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|ag|sa|gmbh|holdings?|group|technologies|labs?)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");
  return ALIASES[k] || k;
}
