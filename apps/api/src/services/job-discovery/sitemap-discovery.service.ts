import { discoveryHttpClient } from './http-client';
import { normalizeStoredUrl } from './domain.utils';

const JOB_URL_PATTERNS = [
  'vacature',
  'vacatures',
  'job',
  'jobs',
  'career',
  'careers',
  'werken-bij',
  'werkenbij',
  'join-us',
  'open-positions',
];

const MAX_SITEMAP_DEPTH = 3;

function extractLocValues(xml: string): string[] {
  const matches = xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi);
  const values: string[] = [];

  for (const match of matches) {
    const rawValue = match[1]?.trim();
    if (!rawValue) {
      continue;
    }

    values.push(rawValue.replace(/<!\[CDATA\[|\]\]>/g, '').trim());
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

async function fetchSitemapXml(url: string): Promise<string | null> {
  try {
    const response = await discoveryHttpClient.get<string>(url, {
      responseType: 'text',
      headers: {
        accept: 'application/xml,text/xml,text/plain;q=0.9,*/*;q=0.8',
      },
    });

    if (response.status < 200 || response.status >= 400) {
      return null;
    }

    return typeof response.data === 'string' ? response.data : null;
  } catch {
    return null;
  }
}

async function crawlSitemap(
  sitemapUrl: string,
  startUrl: string,
  depth: number,
  visitedSitemaps: Set<string>,
  discoveredUrls: Set<string>,
): Promise<void> {
  if (depth > MAX_SITEMAP_DEPTH) {
    return;
  }

  const normalizedSitemapUrl = normalizeStoredUrl(sitemapUrl);

  if (visitedSitemaps.has(normalizedSitemapUrl)) {
    return;
  }

  visitedSitemaps.add(normalizedSitemapUrl);

  const xml = await fetchSitemapXml(normalizedSitemapUrl);
  if (!xml) {
    return;
  }

  const locValues = extractLocValues(xml);
  if (locValues.length === 0) {
    return;
  }

  if (isSitemapIndex(xml)) {
    for (const locValue of locValues) {
      const nestedSitemapUrl = toAbsoluteUrl(locValue, startUrl);
      if (!nestedSitemapUrl) {
        continue;
      }

      await crawlSitemap(
        nestedSitemapUrl,
        startUrl,
        depth + 1,
        visitedSitemaps,
        discoveredUrls,
      );
    }

    return;
  }

  for (const locValue of locValues) {
    const candidateUrl = toAbsoluteUrl(locValue, startUrl);

    if (!candidateUrl || !isJobRelatedUrl(candidateUrl)) {
      continue;
    }

    discoveredUrls.add(candidateUrl);
  }
}

export async function discoverFromSitemap(startUrl: string): Promise<string[]> {
  const sitemapUrl = new URL('/sitemap.xml', startUrl).toString();
  const visitedSitemaps = new Set<string>();
  const discoveredUrls = new Set<string>();

  await crawlSitemap(sitemapUrl, startUrl, 0, visitedSitemaps, discoveredUrls);

  return [...discoveredUrls];
}
