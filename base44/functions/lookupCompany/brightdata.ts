// Bright Data access for one research round: Google through the SERP API, pages through
// Web Unlocker (as markdown), Crunchbase through the Web Scraper API. Every request is
// counted for the log, and whatever is still running when the round ends is aborted
// instead of being left running (and billed) after the response is sent.

import { companyKey } from "../../shared/seed.js";

export type Doc = { id: number; url: string; title: string; text: string };
// read: false keeps only a query's snippets (cheap), e.g. for valuations.
export type Query = { q: string; read?: boolean };

const ARTICLE_CHARS = 10000;
// Passages worth keeping when an article is longer than ARTICLE_CHARS: investor lists and
// supplier or customer mentions often sit deep in a page (e.g. Wikipedia, long features).
// Only words that name a relationship: topic words ("cloud", "chips") match nearly every
// paragraph of a tech article, which would keep only the page's start.
const RELEVANT = /(invest|led by|co-led|participat|funding|raised|raises|round|backer|valuation|valued|market cap|owner|owned|subsidiary|parent|stake|acqui|partner|customer|client|suppl|vendor|purchas|procur|manufactur|foundry|licens|contract|agreement|deal)/gi;
const SKIP_HOSTS = /(youtube\.com|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|reddit\.com|linkedin\.com\/in\/|glassdoor\.|indeed\.)/i;

// Google searches at once per request: more than this and the SERP zone starts timing out
// (seen with 32 at once while grounding values).
const MAX_SEARCHES = 8;

export class BrightData {
  calls = { search: 0, read: 0, dataset: 0 };
  private round = new AbortController();
  private searching = 0;
  private waiting: (() => void)[] = [];

  constructor(private apiKey: string, private serpZone: string, private unlockerZone: string) {}

  // Abort everything still in flight; call when the round is done.
  close() {
    this.round.abort();
  }

  summary() {
    const { search, read, dataset } = this.calls;
    return `bright data: ${search + read + dataset} calls (${search} search, ${read} read, ${dataset} dataset)`;
  }

  private async api(path: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal) {
    const res = await fetch(`https://api.brightdata.com${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.any([this.round.signal, AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
    });
    if (!res.ok) throw new Error(`Bright Data ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }

  private async zone(zone: string, url: string, extra: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal) {
    const body = JSON.stringify({ zone, url, format: "raw", ...extra });
    return await (await this.api("/request", { method: "POST", body }, timeoutMs, signal)).text();
  }

  // One Google search: organic results plus news. `params` adds Google URL parameters
  // (e.g. "tbs=qdr:y" for the past year). One retry for quick failures (empty or bad
  // responses); a timeout or an abort is not retried.
  async search(q: string, signal?: AbortSignal, params = ""): Promise<any[]> {
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=us&num=10&brd_json=1${params ? `&${params}` : ""}`;
    const timeoutMs = 35000;
    // Wait for a free slot; the timeout starts once the search is sent.
    if (this.searching >= MAX_SEARCHES) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.searching++;
    try {
      const t0 = Date.now();
      for (let attempt = 1; ; attempt++) {
        this.calls.search++;
        try {
          const parsed = JSON.parse(await this.zone(this.serpZone, url, {}, timeoutMs, signal));
          return [...(parsed.organic || []), ...(parsed.news || [])];
        } catch (err) {
          const name = (err as Error)?.name;
          if (attempt > 1 || name === "TimeoutError" || name === "AbortError" || signal?.aborted || Date.now() - t0 > timeoutMs * 0.6) throw err;
        }
      }
    } finally {
      this.searching--;
      this.waiting.shift()?.();
    }
  }

  async read(url: string): Promise<string> {
    this.calls.read++;
    return await this.zone(this.unlockerZone, url, { data_format: "markdown" }, 22000);
  }

  // Start collecting records; returns the snapshot id to poll.
  async trigger(datasetId: string, inputs: Record<string, string>[]): Promise<string> {
    this.calls.dataset++;
    const qs = new URLSearchParams({ dataset_id: datasetId, format: "json", include_errors: "true" });
    const res = await this.api(`/datasets/v3/trigger?${qs}`, { method: "POST", body: JSON.stringify(inputs) }, 20000);
    const id = (await res.json())?.snapshot_id;
    if (!id) throw new Error("Bright Data trigger returned no snapshot id");
    return id;
  }

  // The snapshot's records once it's ready, null while it's still collecting.
  async snapshot(snapshotId: string): Promise<any[] | null> {
    const progress = await (await this.api(`/datasets/v3/progress/${snapshotId}`, { method: "GET" }, 15000)).json();
    if (progress?.status === "failed") throw new Error(`snapshot failed: ${JSON.stringify(progress).slice(0, 200)}`);
    if (progress?.status !== "ready") return null;
    const records = await (await this.api(`/datasets/v3/snapshot/${snapshotId}?format=json`, { method: "GET" }, 30000)).json();
    return Array.isArray(records) ? records : [];
  }
}

// Run searches in parallel. Google via Bright Data sometimes hangs on one query: once one
// search is back, wait at most 10 s more for the others, then abort them. A failed search
// comes back as null.
async function searchAll(bd: BrightData, queries: string[], log: string[]): Promise<(any[] | null)[]> {
  const late = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const results = await Promise.allSettled(
    queries.map((q) =>
      bd.search(q, late.signal).then((r) => {
        timer ??= setTimeout(() => late.abort(new Error("slow search skipped")), 10000);
        return r;
      }),
    ),
  );
  clearTimeout(timer);
  return results.map((r) => {
    if (r.status === "fulfilled") return r.value;
    log.push(`search failed: ${String((r.reason as Error)?.message || r.reason).slice(0, 120)}`);
    return null;
  });
}

// Keep the start of the article plus the passages around deal and investor language.
function relevantText(text: string, max = ARTICLE_CHARS) {
  text = text.replace(/\n{3,}/g, "\n\n");
  if (text.length <= max) return text;
  const head = 2000;
  const spans: [number, number][] = [];
  for (const m of text.matchAll(RELEVANT)) {
    const a = Math.max(head, (m.index ?? 0) - 600);
    const b = Math.min(text.length, (m.index ?? 0) + 600);
    if (spans.length && a <= spans[spans.length - 1][1]) spans[spans.length - 1][1] = b;
    else spans.push([a, b]);
  }
  let out = text.slice(0, head);
  for (const [a, b] of spans) {
    if (out.length >= max) break;
    out += "\n…\n" + text.slice(a, Math.min(b, a + (max - out.length)));
  }
  return out;
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

// Search, read the top articles in parallel and keep whichever come back in time.
// `extraUrls` are read too (e.g. news links from Crunchbase); `skip` are URLs an earlier
// round already read. The snippets of every result are one more document (id 99): short,
// but cheap and they often name the deal or state a valuation. Also returns the queries
// whose search failed, for a later round to try again.
export async function searchAndRead(
  bd: BrightData,
  name: string,
  queries: Query[],
  log: string[],
  { maxArticles = 6, skip = new Set<string>(), extraUrls = [] as { url: string; title: string }[] } = {},
): Promise<{ docs: Doc[]; failed: Query[] }> {
  const t0 = Date.now();
  const results = await searchAll(bd, queries.map((q) => q.q), log);
  const failed = queries.filter((_, i) => results[i] === null);
  const lists = results.map((r) => r || []);
  const seen = new Set<string>();
  const snippets: string[] = [];
  const candidates: Doc[] = extraUrls.filter((u) => !skip.has(u.url)).map((u) => ({ id: 0, url: u.url, title: u.title, text: "" }));
  candidates.forEach((d) => seen.add(d.url));
  // Interleave the queries' results so each query gets some of the reading budget.
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) {
    lists.forEach((list, qi) => {
      const o = list[i];
      const link = o?.link || o?.url;
      if (!link || seen.has(link) || SKIP_HOSTS.test(link)) return;
      seen.add(link);
      snippets.push(`${o.title || ""} — ${o.description || o.snippet || ""} (${link})`);
      if (queries[qi].read !== false && !skip.has(link)) candidates.push({ id: 0, url: link, title: o.title || link, text: "" });
    });
  }
  const answered = queries.length - failed.length;
  log.push(`search: ${seen.size} results from ${answered}/${queries.length} queries in ${Date.now() - t0}ms`);

  // The company's own site (its newsroom/blog) comes first: funding posts list every
  // investor, and customer, partner and supplier pages name the companies it deals with.
  const own = companyKey(name);
  const isOwn = (u: string) => own.length > 2 && companyKey(host(u).split(".").slice(-2, -1)[0] || "") === own;
  const dealPage = (d: Doc) => /invest|rais|fund|round|backer|customer|partner|supplier|case-stud/i.test(d.url + " " + d.title);
  const ownDocs = candidates.filter((d) => isOwn(d.url)).sort((a, b) => Number(dealPage(b)) - Number(dealPage(a))).slice(0, 3);
  const toRead = [...ownDocs, ...candidates.filter((d) => !isOwn(d.url))].slice(0, maxArticles + 2);

  const t1 = Date.now();
  const pages = await Promise.allSettled(toRead.map((d) => bd.read(d.url)));
  pages.forEach((p, i) => {
    if (p.status === "fulfilled") toRead[i].text = relevantText(p.value);
  });
  const read = toRead.filter((d) => d.text.length > 400).slice(0, maxArticles);
  if (toRead.length) log.push(`read: ${read.length}/${toRead.length} articles in ${Date.now() - t1}ms`);

  const docs = read.map((d, i) => ({ ...d, id: i + 1 }));
  if (snippets.length) docs.push({ id: 99, url: "search-snippets", title: "Search result snippets", text: snippets.join("\n").slice(0, 8000) });
  return { docs, failed };
}
