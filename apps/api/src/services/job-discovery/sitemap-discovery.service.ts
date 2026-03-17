import { discoveryHttpClient } from "./http-client";
import { normalizeStoredUrl } from "./domain.utils";

const JOB_URL_PATTERNS = [
  "vacature",
  "vacatures",
  "job",
  "jobs",
  "career",
  "careers",
  "werken-bij",
  "werkenbij",
  "join-us",
  "open-positions",
];

const MAX_SITEMAP_DEPTH = 3;

function extractLocValues(xml: string): string[] {
  const matches = xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi);
  const values: string[] = [];

  for (const match of matches) {
    const rawValue = match[1]?.trim();
    if (!rawValue) continue;

    values.push(rawValue.replace(/<!\[CDATA\[|\]\]>/g, "").trim());
  }

  return values;
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex\b/i.test(xml);
}

function toAbsoluteUrl(value: string, startUrl: string): string | null {
  try {
    return normalizeStoredUrl(new URL(value, startUrl).toString());
  } catch {
    return null;
  }
}

function isJobRelatedUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  return JOB_URL_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function isLikelyDetailPage(url: string): boolean {
  const lastSegment = url.split("/").pop() ?? "";

  return (
    lastSegment.includes("vacature") &&
    lastSegment.split("-").length >= 3
  );
}

function scoreJobUrl(url: string): number {
  const lower = url.toLowerCase();
  let score = 0;

  // 🔥 Strong signals (listing pages)
  if (lower.includes("werken-bij")) score += 10;
  if (lower.includes("careers")) score += 10;
  if (lower.includes("jobs")) score += 10;
  if (lower.includes("vacatures")) score += 10;

  // ⚠️ Weak signals
  if (lower.includes("job")) score += 3;

  // ❌ Penalize detail pages
  if (lower.includes("vacature")) score -= 5;

  // ❌ Penalize long slugs (likely detail pages)
  const lastSegment = lower.split("/").pop() ?? "";
  if (lastSegment.split("-").length > 3) score -= 3;

  return score;
}

async function fetchSitemapXml(url: string): Promise<string | null> {
  try {
    const response = await discoveryHttpClient.get<string>(url, {
      responseType: "text",
      headers: {
        accept: "application/xml,text/xml,text/plain;q=0.9,*/*;q=0.8",
      },
    });

    if (response.status < 200 || response.status >= 400) {
      return null;
    }

    return typeof response.data === "string" ? response.data : null;
  } catch {
    return null;
  }
}

async function crawlSitemap(
  sitemapUrl: string,
  startUrl: string,
  depth: number,
  visitedSitemaps: Set<string>,
  discoveredUrls: Set<string>
): Promise<void> {
  if (depth > MAX_SITEMAP_DEPTH) return;

  const normalizedSitemapUrl = normalizeStoredUrl(sitemapUrl);

  if (visitedSitemaps.has(normalizedSitemapUrl)) return;

  visitedSitemaps.add(normalizedSitemapUrl);

  const xml = await fetchSitemapXml(normalizedSitemapUrl);
  if (!xml) return;

  const locValues = extractLocValues(xml);
  if (locValues.length === 0) return;

  // Handle sitemap index
  if (isSitemapIndex(xml)) {
    for (const locValue of locValues) {
      const nestedSitemapUrl = toAbsoluteUrl(locValue, startUrl);
      if (!nestedSitemapUrl) continue;

      await crawlSitemap(
        nestedSitemapUrl,
        startUrl,
        depth + 1,
        visitedSitemaps,
        discoveredUrls
      );
    }
    return;
  }

  // Handle normal sitemap
  for (const locValue of locValues) {
    const candidateUrl = toAbsoluteUrl(locValue, startUrl);

    if (!candidateUrl || !isJobRelatedUrl(candidateUrl)) continue;

    discoveredUrls.add(candidateUrl);
  }
}

export async function discoverFromSitemap(startUrl: string): Promise<string[]> {
  const sitemapUrl = new URL("/sitemap.xml", startUrl).toString();
  const visitedSitemaps = new Set<string>();
  const discoveredUrls = new Set<string>();

  await crawlSitemap(
    sitemapUrl,
    startUrl,
    0,
    visitedSitemaps,
    discoveredUrls
  );

  const candidates = [...discoveredUrls];

  if (candidates.length === 0) {
    return [];
  }

  // 🔥 Step 1 — filter out detail pages if possible
  const filtered = candidates.filter((url) => !isLikelyDetailPage(url));
  const finalCandidates = filtered.length > 0 ? filtered : candidates;

  // 🔥 Step 2 — score & sort
  const scored = finalCandidates
    .map((url) => ({
      url,
      score: scoreJobUrl(url),
    }))
    .sort((a, b) => b.score - a.score);

  // 🔥 Step 3 — return best candidate FIRST
  return scored.map((entry) => entry.url);
}