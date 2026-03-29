import { discoveryHttpClient } from './http-client';
import { logDiscovery } from './discovery-logger';
import { normalizeStoredUrl } from './domain.utils';
import {
  getKeywordMatches,
  normalizeForMatch,
  STRONG_JOB_KEYWORDS,
  WEAK_JOB_KEYWORDS,
} from './heuristic-discovery.service';

const JOB_URL_PATTERNS = [
  'vacature',
  'vacatures',
  'vacancies',
  'vacancy',
  'job',
  'jobs',
  'career',
  'careers',
  'carriere',
  'join',
  'join-our-team',
  'work-with-us',
  'werken-bij',
  'werkenbij',
  'join-us',
  'open-positions',
];

const LISTING_SEGMENTS = [
  'vacatures',
  'vacature',
  'vacancies',
  'jobs',
  'job',
  'careers',
  'career',
  'carriere',
  'werken-bij',
  'werkenbij',
  'join-us',
  'join-our-team',
  'work-with-us',
  'open-positions',
];

const MAX_SITEMAP_DEPTH = 3;

export type SitemapClusterConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export type SitemapCluster = {
  parent: string;
  count: number;
  keywordStrength: number;
  pathDepth: number;
  sameRootDomain: boolean;
  confidence: SitemapClusterConfidence;
};

export type SitemapDiscoveryResult = {
  bestParent: string | null;
  cluster: SitemapCluster | null;
};

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

function getPathSegments(url: string): string[] {
  try {
    return new URL(url).pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  } catch {
    return [];
  }
}

function isListingSegment(segment: string): boolean {
  return LISTING_SEGMENTS.includes(segment.toLowerCase());
}

function getKeywordStrength(url: string): number {
  const normalized = normalizeForMatch(url);

  let score = 0;

  const strongMatches = getKeywordMatches(normalized, STRONG_JOB_KEYWORDS);
  const weakMatches = getKeywordMatches(normalized, WEAK_JOB_KEYWORDS);

  // Strong keywords → primary signal
  if (strongMatches.length > 0) {
    score += strongMatches.length * 3;
  }

  // Weak keywords → secondary signal
  if (weakMatches.length > 0) {
    score += weakMatches.length * 1;
  }

  // Listing segments → very important for sitemap reconstruction
  const segments = getPathSegments(url);

  if (segments.some((segment) => isListingSegment(segment))) {
    score += 5;
  }

  return score;
}

function getPathDepth(url: string): number {
  return getPathSegments(url).length;
}

function isSameRootDomain(candidateUrl: string, startUrl: string): boolean {
  try {
    return new URL(candidateUrl).hostname === new URL(startUrl).hostname;
  } catch {
    return false;
  }
}

function compareParentClusters(
  left: SitemapCluster,
  right: SitemapCluster,
): number {
  if (left.count !== right.count) {
    return right.count - left.count;
  }

  if (left.keywordStrength !== right.keywordStrength) {
    return right.keywordStrength - left.keywordStrength;
  }

  if (left.pathDepth !== right.pathDepth) {
    return left.pathDepth - right.pathDepth;
  }

  if (left.sameRootDomain !== right.sameRootDomain) {
    return Number(right.sameRootDomain) - Number(left.sameRootDomain);
  }

  return left.parent.localeCompare(right.parent);
}

export function deriveParentPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    const pathSegments = getPathSegments(url);

    if (pathSegments.length === 0) {
      parsed.pathname = '/';
      parsed.search = '';
      parsed.hash = '';
      return normalizeStoredUrl(parsed.toString());
    }

    let parentSegments: string[] | null = null;

    for (let index = pathSegments.length - 1; index >= 0; index -= 1) {
      if (!isListingSegment(pathSegments[index] ?? '')) {
        continue;
      }

      parentSegments = pathSegments.slice(0, index + 1);
      break;
    }

    if (!parentSegments) {
      parentSegments =
        pathSegments.length > 1 ? pathSegments.slice(0, -1) : pathSegments;
    }

    parsed.pathname = `/${parentSegments.join('/')}`.replace(/\/+$/, '') || '/';
    parsed.search = '';
    parsed.hash = '';

    return normalizeStoredUrl(parsed.toString());
  } catch {
    return null;
  }
}

export function getSitemapClusterConfidence(
  count: number,
): SitemapClusterConfidence {
  if (count >= 3) {
    return 'HIGH';
  }

  if (count === 2) {
    return 'MEDIUM';
  }

  return 'LOW';
}

export function selectBestSitemapParent(
  urls: string[],
  startUrl: string,
): SitemapDiscoveryResult {
  const parentCounts = new Map<string, number>();

  for (const url of urls) {
    const parent = deriveParentPath(url);

    if (!parent) {
      continue;
    }

    parentCounts.set(parent, (parentCounts.get(parent) ?? 0) + 1);
  }

  const parentGroups = [...parentCounts.entries()]
    .map(([parent, count]) => ({
      parent,
      count,
      keywordStrength: getKeywordStrength(parent),
      pathDepth: getPathDepth(parent),
      sameRootDomain: isSameRootDomain(parent, startUrl),
      confidence: getSitemapClusterConfidence(count),
    }))
    .sort(compareParentClusters);

  const selected = parentGroups[0] ?? null;

  logDiscovery('sitemap-cluster', {
    website: startUrl,
    totalSitemapUrls: urls.length,
    parentGroups: parentGroups.map((group) => ({
      parent: group.parent,
      count: group.count,
      keywordStrength: group.keywordStrength,
      pathDepth: group.pathDepth,
      sameRootDomain: group.sameRootDomain,
      confidence: group.confidence,
    })),
    selectedParent: selected?.parent ?? null,
    confidence: selected?.confidence ?? null,
  });

  return {
    bestParent: selected?.parent ?? null,
    cluster: selected,
  };
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

export async function discoverFromSitemap(
  startUrl: string,
): Promise<SitemapDiscoveryResult> {
  const sitemapUrl = new URL('/sitemap.xml', startUrl).toString();
  const visitedSitemaps = new Set<string>();
  const discoveredUrls = new Set<string>();

  await crawlSitemap(sitemapUrl, startUrl, 0, visitedSitemaps, discoveredUrls);

  return selectBestSitemapParent([...discoveredUrls], startUrl);
}
