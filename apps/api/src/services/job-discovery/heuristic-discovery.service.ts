import {
  getNormalizedHostname,
  getRootDomainLabel,
  isFileLikeUrl,
  isSameRootDomain,
  normalizeStoredUrl,
  resolveAbsoluteUrl,
} from './domain.utils';
import {
  fetchHtmlPage,
  resolveReachableUrl,
  testLightweightUrl,
} from './http-client';
import { logDiscovery } from './discovery-logger';
import {
  discoverFromSitemap,
  type SitemapClusterConfidence,
} from './sitemap-discovery.service';

export type DiscoveryStatus = 'found' | 'not_found' | 'error';
export type DiscoveryMethod = 'crawl' | 'sitemap' | 'path_guess';

export type DiscoveryAttempt = {
  method: DiscoveryMethod;
  status: DiscoveryStatus;
  foundUrl: string | null;
  durationMs: number;
  message: string;
};

export type JobPageDiscoveryResult = {
  status: DiscoveryStatus;
  jobsUrl: string | null;
  method: DiscoveryMethod | null;
  platform: string | null;
  attempts: DiscoveryAttempt[];
};

export type Candidate = {
  url: string;
  source: 'subdomain' | 'path' | 'crawl' | 'sitemap' | 'html';
  clusterCount?: number;
  clusterConfidence?: SitemapClusterConfidence;
  clusterKeywordStrength?: number;
  clusterPathDepth?: number;
  clusterSameRootDomain?: boolean;
  isSitemapClusterWinner?: boolean;
};

type CandidateSourceGroup =
  | 'on_site_link_discovery'
  | 'sitemap_discovery'
  | 'synthetic_guess';

type CandidateEvidence = {
  sources: Set<Candidate['source']>;
  groups: Set<CandidateSourceGroup>;
  sightings: number;
};

type QueueItem = {
  url: string;
  depth: number;
  signalStrength: 'none' | 'weak' | 'strong';
};

type ExtractedLink = {
  url: string;
  text: string;
  strongSignal: boolean;
  weakSignal: boolean;
  aboutSignal: boolean;
  atsProvider: string | null;
  recruitmentDomainSignal: boolean;
};

type FinalizedCandidate = {
  jobsUrl: string;
  platform: string | null;
};

type CandidateCollectionResult = {
  attempt: DiscoveryAttempt;
  candidates: Candidate[];
};

type ScoredCandidate = Candidate & {
  score: number;
  reasons: string[];
};

type CandidateSelection = {
  finalized: FinalizedCandidate | null;
  selected: ScoredCandidate | null;
  scoredCandidates: ScoredCandidate[];
};

export const STRONG_JOB_KEYWORDS = [
  'vacatures',
  'vacature',
  'vacancy',
  'jobs',
  'job',
  'career',
  'careers',
  'carriere',
  'join us',
  'join our team',
  'open positions',
  'werken bij',
  'werkenbij',
  'working at',
  'kom werken',
];

export const WEAK_JOB_KEYWORDS = [
  'work',
  'werken',
  'positions',
  'opportunities',
];

const FALSE_POSITIVE_PATTERNS = [
  // content pages
  'blog',
  'news',
  'nieuws',
  'privacy',
  'terms',
  'policy',
  'voorwaarden',

  // business / marketing
  'product',
  'producten',
  'diensten',
  'service',
  'solutions',
  'oplossingen',

  // ❗ NEW: company pages (VERY IMPORTANT)
  'about',
  'about-us',
  'over-ons',
  'company',
  'organisatie',

  // ❗ NEW: people pages
  'team',
  'people',
  'medewerker',
  'medewerkers',
  'employee',
  'ons-team',

  // ❗ NEW: portfolio / projects
  'project',
  'projecten',
  'cases',
  'portfolio',
  'ons-werk',
  'our-work',
  'completed',
  'recent-work',
  'case-study',
];

const ATS_PATTERNS = [
  { provider: 'greenhouse', pattern: /(^|\.)greenhouse\.io$/i },
  { provider: 'lever', pattern: /(^|\.)lever\.co$/i },
  { provider: 'ashby', pattern: /(^|\.)ashbyhq\.com$/i },
  { provider: 'teamtailor', pattern: /(^|\.)teamtailor\.com$/i },
  { provider: 'recruitee', pattern: /(^|\.)recruitee\.com$/i },
  { provider: 'workable', pattern: /(^|\.)workable\.com$/i },
  { provider: 'homerun', pattern: /(^|\.)homerun\.co$/i },
];

const RECRUITMENT_HOST_KEYWORDS = [
  'werkenbij',
  'vacatures',
  'vacature',
  'vacancy',
  'jobs',
  'job',
  'careers',
  'career',
  'carriere',
  'vacancies',
];
const ABOUT_PAGE_PATTERNS = ['/about', '/over-ons', '/company'];
const PIVOT_PATHS = [
  '/',
  '/about',
  '/about-us',
  '/over-ons',
  '/company',
  '/team',
];
const OBVIOUS_NON_JOBS_FINAL_PATHS = [
  '/404',
  '/about',
  '/about-us',
  '/article',
  '/articles',
  '/blog',
  '/company',
  '/contact',
  '/login',
  '/over-ons',
  '/partner',
  '/partners',
  '/team',
  '/workflow',
  '/workshops',
];
const DEEPER_EXPLORATION_PATHS = [
  '/about',
  '/careers',
  '/carriere',
  '/company',
  '/join',
  '/over-ons',
  '/werken',
  '/werken-bij',
];
const FALLBACK_PATHS = [
  '/jobs',
  '/careers',
  '/vacatures',
  '/werken-bij',
  '/career',
  '/join-us',
  '/work-with-us',
  '/open-positions',
];
const RECRUITMENT_STYLE_LISTING_PATHS = [
  '/vacatures',
  '/vacature',
  '/jobs',
  '/job',
  '/careers',
  '/career',
  '/carriere',
  '/vacancies',
];
const LISTING_SEGMENTS = [
  '/vacatures',
  '/jobs',
  '/careers',
  '/werken-bij',
  '/werkenbij',
];
const LISTING_SEGMENT_TOKENS = new Set(
  [
    ...LISTING_SEGMENTS.map((segment) => segment.replace(/^\//, '')),
    'vacature',
    'vacancies',
    'job',
    'career',
    'carriere',
  ].map((segment) => segment.toLowerCase()),
);
const MAX_CRAWL_DEPTH = 2;
const MAX_LINKS_PER_PAGE = 25;

const SCORE_WEIGHTS = {
  strongKeyword: 10,
  weakKeyword: 3,
  recruitmentStyleHostnameBonus: 8,
  falsePositivePenalty: -40,
  portfolioContextPenalty: -50,
  overviewBonus: 18,
  listingPreferredBonus: 10,
  genericEmployerBrandingPenalty: -16,
  businessNameBonus: 3,
  atsBonus: 5,
  detailPenalty: -18,
  pivotPenalty: -8,
  sameDomainBonus: 10,
  externalDomainPenalty: -2,
  sitemapClusterCountWeight: 8,
  sitemapConfidence: {
    LOW: 2,
    MEDIUM: 6,
    HIGH: 10,
  } satisfies Record<SitemapClusterConfidence, number>,
  sitemapClusterWinnerBonus: 8,
  sitemapStructure: {
    keywordStrengthWeight: 2,
    shallowerPathBonus: 4,
    sameRootDomainBonus: 3,
  },
  source: {
    subdomain: 8,
    path: 6,
    sitemap: 12,
    html: 4,
    crawl: 2,
  } satisfies Record<Candidate['source'], number>,
  consensus: {
    rawSource: {
      twoPlus: 1,
      threePlus: 2,
    },
    sourceGroup: {
      twoPlus: 2,
      threePlus: 3,
    },
  },
  minimumAcceptedScore: 15,
} as const;

function containsStrongKeyword(value: string): boolean {
  return getKeywordMatches(value, STRONG_JOB_KEYWORDS).length > 0;
}

function containsWeakKeyword(value: string): boolean {
  return getKeywordMatches(value, WEAK_JOB_KEYWORDS).length > 0;
}

function hasFalsePositiveHint(value: string): boolean {
  return getKeywordMatches(value, FALSE_POSITIVE_PATTERNS).length > 0;
}

export function getKeywordMatches(
  value: string,
  keywords: readonly string[],
): string[] {
  const normalized = value.toLowerCase();
  return keywords.filter((keyword) => normalized.includes(keyword));
}

export function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasStrongUrlSignal(url: string): boolean {
  const normalized = normalizeForMatch(url);

  return STRONG_JOB_KEYWORDS.some((keyword) =>
    normalized.includes(normalizeForMatch(keyword)),
  );
}

function hasStrongRecruitmentPrefix(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, '');

  return (
    normalized.startsWith('werkenbij') ||
    normalized.startsWith('vacatures') ||
    normalized.startsWith('vacature') ||
    normalized.startsWith('jobs') ||
    normalized.startsWith('job') ||
    normalized.startsWith('careers') ||
    normalized.startsWith('career') ||
    normalized.startsWith('carriere') ||
    normalized.startsWith('vacancies')
  );
}

function getRecruitmentStyleHostnameMatch(
  hostname: string,
): { label: string; prefixMatched: boolean } | null {
  const labels = hostname
    .toLowerCase()
    .split('.')
    .flatMap((label) => label.split('-'))
    .map((part) => part.trim())
    .filter(Boolean);

  for (const label of labels) {
    if (STRONG_JOB_KEYWORDS.includes(label)) {
      return { label, prefixMatched: false };
    }

    if (hasStrongRecruitmentPrefix(label)) {
      return { label, prefixMatched: true };
    }
  }

  return null;
}

function isRecruitmentStyleHostname(hostname: string): boolean {
  return Boolean(getRecruitmentStyleHostnameMatch(hostname));
}

function detectAtsProvider(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const match = ATS_PATTERNS.find((entry) => entry.pattern.test(hostname));
    return match?.provider ?? null;
  } catch {
    return null;
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMainContent(html: string): string {
  const withoutHeader = html.replace(/<header[\s\S]*?<\/header>/gi, '');
  const withoutFooter = withoutHeader.replace(
    /<footer[\s\S]*?<\/footer>/gi,
    '',
  );

  return withoutFooter;
}

function validateFinalPage(html: string): boolean {
  const mainContent = extractMainContent(html);
  const text = stripHtml(mainContent).toLowerCase();

  const hasJobKeywords =
    STRONG_JOB_KEYWORDS.some((keyword) => text.includes(keyword)) ||
    text.includes('vacature') ||
    text.includes('job');

  const hasJobContext =
    text.includes('solliciteer') ||
    text.includes('apply') ||
    text.includes('functie') ||
    text.includes('rol') ||
    text.includes('requirements') ||
    text.includes('verantwoordelijkheden');

  return hasJobKeywords && hasJobContext;
}

export function extractTitle(html: string): string {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);

  if (!match?.[1]) {
    return '';
  }

  return stripHtml(match[1]);
}

export function isSoft404Title(title: string): boolean {
  const normalizedTitle = title.toLowerCase().trim();

  if (!normalizedTitle) {
    return false;
  }

  return (
    ['pagina niet gevonden', 'page not found', 'not found'].some((phrase) =>
      normalizedTitle.includes(phrase),
    ) || /\b404\b/.test(normalizedTitle)
  );
}

function assertNotSoft404(html: string): void {
  const title = extractTitle(html);

  if (isSoft404Title(title)) {
    throw new Error('Soft 404 detected via title');
  }
}

function getCompanyTokens(startUrl: string): string[] {
  const rootLabel = getRootDomainLabel(startUrl).toLowerCase();
  const splitTokens = rootLabel
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3);
  const compactToken = rootLabel.replace(/[^a-z0-9]/gi, '');
  const tokens =
    compactToken.length >= 3 ? [...splitTokens, compactToken] : splitTokens;

  return [...new Set(tokens)];
}

function isAboutPage(url: string): boolean {
  const normalized = url.toLowerCase();
  return ABOUT_PAGE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function getNormalizedPathname(url: string): string | null {
  try {
    const pathname = new URL(url).pathname.toLowerCase().replace(/\/+$/, '');
    return pathname || '/';
  } catch {
    return null;
  }
}

function isPivotLikeCandidate(url: string, companyTokens?: string[]): boolean {
  const pathname = getNormalizedPathname(url);

  if (!pathname) {
    return false;
  }

  if (PIVOT_PATHS.includes(pathname)) {
    return true;
  }

  return (
    pathname === '/' &&
    Boolean(companyTokens?.length) &&
    (isRecruitmentDomain(url, companyTokens ?? []) ||
      isRecruitmentStyleUrl(url))
  );
}

function isObviouslyNotJobsFinalPath(url: string): boolean {
  const pathname = getNormalizedPathname(url);

  if (!pathname) {
    return false;
  }

  return OBVIOUS_NON_JOBS_FINAL_PATHS.includes(pathname);
}

function isRootUrl(url: string): boolean {
  return getNormalizedPathname(url) === '/';
}

function isRecruitmentDomain(url: string, companyTokens: string[]): boolean {
  try {
    const hostname = getNormalizedHostname(url);
    const hasRecruitmentKeyword = RECRUITMENT_HOST_KEYWORDS.some((keyword) =>
      hostname.includes(keyword),
    );
    const hasCompanyToken = companyTokens.some((token) =>
      hostname.includes(token),
    );

    return hasRecruitmentKeyword && hasCompanyToken;
  } catch {
    return false;
  }
}

function isRecruitmentStyleUrl(url: string): boolean {
  try {
    return isRecruitmentStyleHostname(getNormalizedHostname(url));
  } catch {
    return false;
  }
}

function getPathSegments(url: string): string[] {
  try {
    return new URL(url).pathname
      .toLowerCase()
      .replace(/\/+$/, '')
      .split('/')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isListingSegment(segment: string): boolean {
  return LISTING_SEGMENT_TOKENS.has(segment.toLowerCase());
}

type ListingAnchorMatch = {
  startIndex: number;
  endIndex: number;
};

function getDeepestListingAnchorMatch(url: string): ListingAnchorMatch | null {
  const pathSegments = getPathSegments(url);
  let deepestMatch: ListingAnchorMatch | null = null;

  for (let index = 0; index < pathSegments.length; index += 1) {
    if (!isListingSegment(pathSegments[index] ?? '')) {
      continue;
    }

    let endIndex = index;

    while (isListingSegment(pathSegments[endIndex + 1] ?? '')) {
      endIndex += 1;
    }

    deepestMatch = { startIndex: index, endIndex };
  }

  return deepestMatch;
}

function getParentListingPathname(url: string): string | null {
  const pathSegments = getPathSegments(url);
  const anchorMatch = getDeepestListingAnchorMatch(url);

  if (!anchorMatch || anchorMatch.endIndex >= pathSegments.length - 1) {
    return null;
  }

  return `/${pathSegments.slice(0, anchorMatch.endIndex + 1).join('/')}`;
}

function hasJobDetailPattern(url: string): boolean {
  return getParentListingPathname(url) !== null;
}

function getParentListingUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parentPathname = getParentListingPathname(url);

    if (!parentPathname) {
      return null;
    }

    parsed.pathname = parentPathname;
    parsed.search = '';
    parsed.hash = '';

    return normalizeStoredUrl(parsed.toString());
  } catch {
    return null;
  }
}

function isLikelyJobOverviewPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    const pathSegments = pathname.split('/').filter(Boolean);
    const lastSegment = pathSegments.at(-1) ?? '';
    const normalizedLastSegment = normalizeForMatch(lastSegment);

    if (!lastSegment || hasJobDetailPattern(url)) {
      return false;
    }

    return (
      STRONG_JOB_KEYWORDS.includes(lastSegment) ||
      LISTING_SEGMENTS.includes(`/${lastSegment}`) ||
      isListingSegment(lastSegment) ||
      STRONG_JOB_KEYWORDS.some((keyword) => {
        const normalizedKeyword = normalizeForMatch(keyword);
        return (
          normalizedLastSegment.startsWith(`${normalizedKeyword} `) ||
          normalizedLastSegment.endsWith(` ${normalizedKeyword}`)
        );
      })
    );
  } catch {
    return false;
  }
}

function isGenericEmployerBrandingPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    const pathSegments = pathname.split('/').filter(Boolean);
    const lastSegment = pathSegments.at(-1) ?? '';
    const normalizedLastSegment = normalizeForMatch(lastSegment);
    const normalizedPath = normalizeForMatch(pathname);

    if (
      !lastSegment ||
      isLikelyJobOverviewPage(url) ||
      hasJobDetailPattern(url)
    ) {
      return false;
    }

    const hasEmployerBrandingPhrase =
      normalizedPath.includes('werken bij') ||
      normalizedPath.includes('working at') ||
      normalizedPath.includes('join us') ||
      normalizedPath.includes('join our team') ||
      normalizedPath.includes('work with us');

    if (!hasEmployerBrandingPhrase) {
      return false;
    }

    return (
      !isListingSegment(lastSegment) &&
      !STRONG_JOB_KEYWORDS.includes(lastSegment) &&
      !LISTING_SEGMENTS.includes(`/${lastSegment}`) &&
      !normalizedLastSegment.startsWith('vacatures') &&
      !normalizedLastSegment.startsWith('jobs') &&
      !normalizedLastSegment.startsWith('careers')
    );
  } catch {
    return false;
  }
}

function normalizeBusinessNameTokens(businessName: string): string[] {
  const lower = businessName.toLowerCase();
  const splitTokens = lower
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3);
  const compact = lower.replace(/[^a-z0-9]/gi, '');

  return compact.length >= 3
    ? [...new Set([...splitTokens, compact])]
    : [...new Set(splitTokens)];
}

function getCandidateSourceGroup(
  source: Candidate['source'],
): CandidateSourceGroup {
  switch (source) {
    case 'crawl':
    case 'html':
      return 'on_site_link_discovery';
    case 'sitemap':
      return 'sitemap_discovery';
    case 'path':
    case 'subdomain':
      return 'synthetic_guess';
  }
}

function buildCandidateEvidenceMap(
  candidates: Candidate[],
): Map<string, CandidateEvidence> {
  const evidenceByUrl = new Map<string, CandidateEvidence>();

  for (const candidate of candidates) {
    const normalizedUrl = normalizeStoredUrl(candidate.url);
    const existing = evidenceByUrl.get(normalizedUrl);

    if (existing) {
      existing.sources.add(candidate.source);
      existing.groups.add(getCandidateSourceGroup(candidate.source));
      existing.sightings += 1;
      continue;
    }

    evidenceByUrl.set(normalizedUrl, {
      sources: new Set([candidate.source]),
      groups: new Set([getCandidateSourceGroup(candidate.source)]),
      sightings: 1,
    });
  }

  return evidenceByUrl;
}

function getCandidateScoreBreakdown(
  candidate: Candidate,
  businessName: string,
  startUrl: string,
  evidence?: CandidateEvidence,
): { score: number; reasons: string[] } {
  const normalizedUrl = normalizeForMatch(candidate.url);
  const recruitmentStyleHostname = isRecruitmentStyleUrl(candidate.url);
  const strongMatches = getKeywordMatches(normalizedUrl, STRONG_JOB_KEYWORDS);
  const weakMatches = getKeywordMatches(normalizedUrl, WEAK_JOB_KEYWORDS);
  const falsePositiveMatches = getKeywordMatches(
    normalizedUrl,
    FALSE_POSITIVE_PATTERNS,
  );
  const businessTokens = normalizeBusinessNameTokens(businessName);
  let score = 0;
  const reasons: string[] = [];

  if (strongMatches.length > 0) {
    score += strongMatches.length * SCORE_WEIGHTS.strongKeyword;
    reasons.push(`strong=${strongMatches.join(',')}`);
  }

  if (recruitmentStyleHostname) {
    score += SCORE_WEIGHTS.recruitmentStyleHostnameBonus;
    reasons.push('recruitment-style-host');
  }

  if (weakMatches.length > 0) {
    score += weakMatches.length * SCORE_WEIGHTS.weakKeyword;
    reasons.push(`weak=${weakMatches.join(',')}`);
  }

  if (falsePositiveMatches.length > 0) {
    score += SCORE_WEIGHTS.falsePositivePenalty;
    reasons.push(`negative=${falsePositiveMatches.join(',')}`);
  }

  if (
    normalizedUrl.includes('jobs') &&
    falsePositiveMatches.some((pattern) =>
      ['completed', 'project', 'case', 'portfolio'].includes(pattern),
    )
  ) {
    score += SCORE_WEIGHTS.portfolioContextPenalty;
    reasons.push('negative=jobs-with-portfolio-context');
  }

  if (isLikelyJobOverviewPage(candidate.url)) {
    score += SCORE_WEIGHTS.overviewBonus;
    reasons.push('overview');
    reasons.push('listing-preferred');
    score += SCORE_WEIGHTS.listingPreferredBonus;
  }

  if (isGenericEmployerBrandingPage(candidate.url)) {
    score += SCORE_WEIGHTS.genericEmployerBrandingPenalty;
    reasons.push('negative=generic-employer-branding');
  }

  if (businessTokens.some((token) => normalizedUrl.includes(token))) {
    score += SCORE_WEIGHTS.businessNameBonus;
    reasons.push('business-name');
  }

  if (isPivotLikeCandidate(candidate.url)) {
    score += SCORE_WEIGHTS.pivotPenalty;
    reasons.push('pivot');
  }

  if (isSameRootDomain(candidate.url, startUrl)) {
    score += SCORE_WEIGHTS.sameDomainBonus;
    reasons.push('same-domain');
  } else {
    score += SCORE_WEIGHTS.externalDomainPenalty;
    reasons.push('external-domain');
  }

  const atsProvider = detectAtsProvider(candidate.url);
  if (atsProvider) {
    score += SCORE_WEIGHTS.atsBonus;
    reasons.push(`ats=${atsProvider}`);
  }

  if (hasJobDetailPattern(candidate.url)) {
    score += SCORE_WEIGHTS.detailPenalty;
    reasons.push('detail-page');
  }

  score += SCORE_WEIGHTS.source[candidate.source];
  reasons.push(`source=${candidate.source}`);

  if (candidate.source === 'sitemap' && candidate.isSitemapClusterWinner) {
    score += SCORE_WEIGHTS.sitemapClusterWinnerBonus;
    reasons.push('sitemap-cluster-winner');
  }

  if (candidate.source === 'sitemap' && candidate.clusterCount) {
    score += candidate.clusterCount * SCORE_WEIGHTS.sitemapClusterCountWeight;
    reasons.push(`sitemap-cluster-count=${candidate.clusterCount}`);
  }

  if (candidate.source === 'sitemap' && candidate.clusterConfidence) {
    score += SCORE_WEIGHTS.sitemapConfidence[candidate.clusterConfidence];
    reasons.push(`sitemap-confidence=${candidate.clusterConfidence}`);
  }

  if (candidate.source === 'sitemap') {
    if (typeof candidate.clusterKeywordStrength === 'number') {
      score +=
        candidate.clusterKeywordStrength *
        SCORE_WEIGHTS.sitemapStructure.keywordStrengthWeight;
      reasons.push(
        `sitemap-keyword-strength=${candidate.clusterKeywordStrength}`,
      );
    }

    if (typeof candidate.clusterPathDepth === 'number') {
      const shallowerPathBonus = Math.max(
        0,
        SCORE_WEIGHTS.sitemapStructure.shallowerPathBonus -
          Math.max(candidate.clusterPathDepth - 1, 0),
      );

      score += shallowerPathBonus;
      reasons.push(`sitemap-path-depth=${candidate.clusterPathDepth}`);
    }

    if (candidate.clusterSameRootDomain) {
      score += SCORE_WEIGHTS.sitemapStructure.sameRootDomainBonus;
      reasons.push('sitemap-same-root-domain');
    }
  }

  if (evidence) {
    const sourceCount = evidence.sources.size;
    const groupCount = evidence.groups.size;
    const groupList = [...evidence.groups].sort();

    if (groupCount > 1) {
      score +=
        groupCount >= 3
          ? SCORE_WEIGHTS.consensus.sourceGroup.threePlus
          : SCORE_WEIGHTS.consensus.sourceGroup.twoPlus;
      reasons.push('multi-group');
      reasons.push(`groups=${groupList.join(',')}`);
    }

    if (groupCount > 1 && sourceCount > 1) {
      score +=
        sourceCount >= 3
          ? SCORE_WEIGHTS.consensus.rawSource.threePlus
          : SCORE_WEIGHTS.consensus.rawSource.twoPlus;
      reasons.push('multi-source');
    }
  }

  return { score, reasons };
}

export function scoreCandidate(
  candidate: Candidate,
  businessName: string,
  startUrl: string,
  evidence?: CandidateEvidence,
): number {
  return getCandidateScoreBreakdown(candidate, businessName, startUrl, evidence)
    .score;
}

function hasJobIntent(candidate: Pick<ScoredCandidate, 'reasons'>): boolean {
  return candidate.reasons.some(
    (reason) =>
      reason.includes('strong=') ||
      reason.includes('ats=') ||
      reason.includes('overview'),
  );
}

function getCandidateDedupeKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function expandCandidateFinalizationTargets(candidateUrl: string): string[] {
  const normalizedCandidateUrl = normalizeStoredUrl(candidateUrl);
  const parentListingUrl = hasJobDetailPattern(normalizedCandidateUrl)
    ? getParentListingUrl(normalizedCandidateUrl)
    : null;

  return [
    ...new Set(
      [parentListingUrl, normalizedCandidateUrl].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ];
}

function getRecruitmentStyleListingTargets(url: string): string[] {
  try {
    const parsed = new URL(url);

    return RECRUITMENT_STYLE_LISTING_PATHS.map((pathname) => {
      const candidate = new URL(parsed.origin);
      candidate.pathname = pathname;
      candidate.search = '';
      candidate.hash = '';
      return candidate.toString();
    });
  } catch {
    return [];
  }
}

function shouldAllowDeeperExploration(
  url: string,
  companyTokens: string[],
): boolean {
  const pathname = getNormalizedPathname(url);

  if (!pathname) {
    return false;
  }

  return (
    DEEPER_EXPLORATION_PATHS.includes(pathname) ||
    hasStrongUrlSignal(url) ||
    isPivotLikeCandidate(url, companyTokens)
  );
}

async function finalizeCandidateUrl(
  candidateUrl: string,
  startUrl: string,
  companyTokens: string[],
  options?: { checkSoft404Title?: boolean },
): Promise<FinalizedCandidate | null> {
  if (isFileLikeUrl(candidateUrl)) {
    return null;
  }

  const atsProvider = detectAtsProvider(candidateUrl);
  const recruitmentDomainSignal = isRecruitmentDomain(
    candidateUrl,
    companyTokens,
  );
  const sameRoot = isSameRootDomain(candidateUrl, startUrl);

  if (!sameRoot && !atsProvider && !recruitmentDomainSignal) {
    return null;
  }

  const probe = await testLightweightUrl(candidateUrl);

  if (!probe.ok) {
    return null;
  }

  const finalUrl = normalizeStoredUrl(probe.finalUrl);
  const finalRecruitmentStyleHostname = isRecruitmentStyleUrl(finalUrl);
  const recruitmentStyleMatch = finalRecruitmentStyleHostname
    ? getRecruitmentStyleHostnameMatch(getNormalizedHostname(finalUrl))
    : null;

  const candidatePathname = getNormalizedPathname(candidateUrl);
  const finalPathname = getNormalizedPathname(finalUrl);

  const redirectedToRootPivot =
    candidatePathname !== null &&
    finalPathname !== null &&
    candidatePathname !== '/' &&
    finalPathname === '/' &&
    candidateUrl !== finalUrl &&
    !finalRecruitmentStyleHostname;

  if (redirectedToRootPivot) {
    logDiscovery('finalize-reject', {
      website: startUrl,
      candidateUrl,
      finalUrl,
      reason: 'redirected-to-root-pivot',
    });

    return null;
  }

  if (recruitmentStyleMatch?.prefixMatched) {
    logDiscovery('recruitment-style-host', {
      website: startUrl,
      candidateUrl,
      finalUrl,
      hostname: getNormalizedHostname(finalUrl),
      label: recruitmentStyleMatch.label,
      reason: 'prefix-match',
    });
  }

  if (finalRecruitmentStyleHostname && finalPathname === '/' && !atsProvider) {
    logDiscovery('decision', {
      website: startUrl,
      candidateUrl,
      selectedUrl: finalUrl,
      reason: 'root-recruitment-domain-pivot',
    });

    const deeperRecruitmentPaths = [
      '/vacatures',
      '/vacature',
      '/jobs',
      '/job',
      '/careers',
      '/career',
      '/carriere',
      '/vacancies',
    ];

    for (const path of deeperRecruitmentPaths) {
      const resolved = resolveAbsoluteUrl(path, finalUrl);

      if (!resolved) {
        continue;
      }

      const reachable = await testLightweightUrl(resolved);

      if (!reachable.ok) {
        continue;
      }

      const reachableFinalUrl = normalizeStoredUrl(reachable.finalUrl);

      if (reachableFinalUrl === finalUrl) {
        continue;
      }

      logDiscovery('decision', {
        website: startUrl,
        candidateUrl,
        selectedUrl: reachableFinalUrl,
        reason: 'preferred-deeper-recruitment-path',
      });

      return {
        jobsUrl: reachableFinalUrl,
        platform: detectAtsProvider(reachableFinalUrl),
      };
    }
  }

  if (
    hasStrongUrlSignal(finalUrl) &&
    probe.finalUrl === candidateUrl &&
    !isPivotLikeCandidate(finalUrl, companyTokens)
  ) {
    return {
      jobsUrl: finalUrl,
      platform: atsProvider ?? detectAtsProvider(finalUrl),
    };
  }

  try {
    const page = await fetchHtmlPage(finalUrl);

    if (options?.checkSoft404Title && !atsProvider) {
      assertNotSoft404(page.html);
    }

    const isListing = isLikelyJobOverviewPage(finalUrl);

    if (!isListing) {
      const isValid = validateFinalPage(page.html);

      if (!isValid) {
        return null;
      }
    }
  } catch {
    return null;
  }

  return {
    jobsUrl: finalUrl,
    platform: atsProvider ?? detectAtsProvider(finalUrl),
  };
}

async function normalizeSelectedDetailPageToParentListing(
  selected: ScoredCandidate,
  finalized: FinalizedCandidate,
  startUrl: string,
  companyTokens: string[],
): Promise<FinalizedCandidate> {
  if (!hasJobDetailPattern(finalized.jobsUrl)) {
    return finalized;
  }

  logDiscovery('decision', {
    website: startUrl,
    candidateUrl: selected.url,
    selectedUrl: finalized.jobsUrl,
    score: selected.score,
    reason: 'detail-page-detected',
  });

  const parentListingUrl = getParentListingUrl(finalized.jobsUrl);

  if (!parentListingUrl || parentListingUrl === finalized.jobsUrl) {
    return finalized;
  }

  logDiscovery('decision', {
    website: startUrl,
    candidateUrl: selected.url,
    selectedUrl: finalized.jobsUrl,
    parentListingUrl,
    score: selected.score,
    reason: 'parent-listing-derived',
  });

  const promoted = await finalizeCandidateUrl(
    parentListingUrl,
    startUrl,
    companyTokens,
    { checkSoft404Title: shouldCheckSoft404(selected) },
  );

  if (!promoted) {
    logDiscovery('decision', {
      website: startUrl,
      candidateUrl: selected.url,
      selectedUrl: finalized.jobsUrl,
      parentListingUrl,
      score: selected.score,
      reason: 'parent-listing-invalid-kept-detail',
    });

    return finalized;
  }

  logDiscovery('decision', {
    website: startUrl,
    candidateUrl: selected.url,
    finalizedTargetUrl: finalized.jobsUrl,
    parentListingUrl,
    selectedUrl: promoted.jobsUrl,
    score: selected.score,
    reason: 'selected-after-parent-promotion',
  });

  return promoted;
}

function extractLinks(
  html: string,
  baseUrl: string,
  companyTokens: string[],
): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();
  const anchorRegex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;

  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1] ?? '';
    const text = stripHtml(match[2] ?? '');
    const absoluteUrl = resolveAbsoluteUrl(href, baseUrl);

    if (!absoluteUrl || isFileLikeUrl(absoluteUrl)) {
      continue;
    }

    const normalizedUrl = normalizeStoredUrl(absoluteUrl);

    if (seen.has(normalizedUrl)) {
      continue;
    }

    seen.add(normalizedUrl);

    links.push({
      url: normalizedUrl,
      text,
      strongSignal: containsStrongKeyword(`${normalizedUrl} ${text}`),
      weakSignal: containsWeakKeyword(`${normalizedUrl} ${text}`),
      aboutSignal: isAboutPage(normalizedUrl),
      atsProvider: detectAtsProvider(normalizedUrl),
      recruitmentDomainSignal: isRecruitmentDomain(
        normalizedUrl,
        companyTokens,
      ),
    });
  }

  return links;
}

function extractFooterHtml(html: string): string {
  const lower = html.toLowerCase();
  const start = lower.indexOf('<footer');

  if (start === -1) {
    return '';
  }

  const end = lower.indexOf('</footer>', start);

  if (end === -1) {
    return '';
  }

  return html.slice(start, end + '</footer>'.length);
}

function prioritizeSameDomainLinks(
  links: ExtractedLink[],
  rootUrl: string,
  currentUrl: string,
  companyTokens: string[],
): ExtractedLink[] {
  const extraExplorationBudget = shouldAllowDeeperExploration(
    currentUrl,
    companyTokens,
  )
    ? 10
    : 0;

  return links
    .filter((link) => isSameRootDomain(link.url, rootUrl))
    .sort((left, right) => {
      const leftScore =
        Number(left.strongSignal) * 4 +
        Number(left.aboutSignal) * 2 +
        Number(left.weakSignal);
      const rightScore =
        Number(right.strongSignal) * 4 +
        Number(right.aboutSignal) * 2 +
        Number(right.weakSignal);
      return rightScore - leftScore;
    })
    .slice(0, MAX_LINKS_PER_PAGE + extraExplorationBudget);
}

function assessPageSignals(
  current: QueueItem,
  finalPageUrl: string,
  pageText: string,
  links: ExtractedLink[],
): { isJobPage: boolean; hasAdditionalSignals: boolean } {
  const weakOnUrl = containsWeakKeyword(finalPageUrl);
  const weakOnPage = containsWeakKeyword(pageText);
  const strongLinkCount = links.filter((link) => link.strongSignal).length;
  const jobPatternLinkCount = links.filter(
    (link) => link.strongSignal || hasJobDetailPattern(link.url),
  ).length;
  const strongSignalsOnPage =
    containsStrongKeyword(pageText) || strongLinkCount > 0;
  const hasAdditionalSignals = strongSignalsOnPage || jobPatternLinkCount >= 2;
  const weakSignal =
    current.signalStrength === 'weak' || weakOnUrl || weakOnPage;
  const directStrongSignal =
    current.signalStrength === 'strong' || containsStrongKeyword(finalPageUrl);
  const falsePositive =
    hasFalsePositiveHint(finalPageUrl) && !directStrongSignal;
  const hasJobDetailLinks = links.some((link) => hasJobDetailPattern(link.url));

  if (!hasJobDetailLinks && current.depth === 0) {
    return {
      isJobPage: false,
      hasAdditionalSignals,
    };
  }

  return {
    isJobPage:
      !falsePositive &&
      (directStrongSignal || (weakSignal && hasAdditionalSignals)),
    hasAdditionalSignals,
  };
}

function addCandidate(
  store: Map<string, Candidate>,
  candidate: Candidate,
): void {
  try {
    if (isFileLikeUrl(candidate.url)) {
      return;
    }

    const normalizedUrl = normalizeStoredUrl(candidate.url);
    const key = `${candidate.source}:${normalizedUrl}`;

    if (!store.has(key)) {
      store.set(key, {
        url: normalizedUrl,
        source: candidate.source,
      });
    }
  } catch {
    return;
  }
}

function addCandidatesFromLinks(
  store: Map<string, Candidate>,
  links: ExtractedLink[],
  source: Candidate['source'],
  startUrl: string,
): void {
  for (const link of links) {
    const combined = `${link.url} ${link.text}`;
    const isExternalRecruitment =
      !isSameRootDomain(link.url, startUrl) &&
      (link.atsProvider || link.recruitmentDomainSignal);
    const hasJobSignal =
      link.strongSignal || link.weakSignal || hasJobDetailPattern(link.url);
    const hasUsefulAboutSignal =
      link.aboutSignal && (link.strongSignal || link.weakSignal);

    if (isExternalRecruitment || hasJobSignal || hasUsefulAboutSignal) {
      addCandidate(store, { url: link.url, source });
    } else if (
      hasFalsePositiveHint(combined) &&
      (link.atsProvider || link.recruitmentDomainSignal)
    ) {
      addCandidate(store, { url: link.url, source });
    }
  }
}

async function inspectFooterForJobPage(
  startUrl: string,
): Promise<CandidateCollectionResult> {
  const startedAt = Date.now();
  const companyTokens = getCompanyTokens(startUrl);
  const candidates = new Map<string, Candidate>();

  try {
    const page = await fetchHtmlPage(startUrl);
    const finalPageUrl = normalizeStoredUrl(page.finalUrl);
    const footerHtml = extractFooterHtml(page.html);
    const footerLinks = footerHtml
      ? extractLinks(footerHtml, finalPageUrl, companyTokens)
      : [];
    const allLinks = extractLinks(page.html, finalPageUrl, companyTokens);

    addCandidatesFromLinks(candidates, footerLinks, 'html', startUrl);
    addCandidatesFromLinks(candidates, allLinks, 'html', startUrl);

    return {
      attempt: {
        method: 'crawl',
        status: 'not_found',
        foundUrl: null,
        durationMs: Date.now() - startedAt,
        message: `Collected ${candidates.size} HTML candidate(s)`,
      },
      candidates: [...candidates.values()],
    };
  } catch {
    return {
      attempt: {
        method: 'crawl',
        status: 'error',
        foundUrl: null,
        durationMs: Date.now() - startedAt,
        message: 'Footer inspection failed',
      },
      candidates: [],
    };
  }
}

async function crawlForJobPage(
  startUrl: string,
): Promise<CandidateCollectionResult> {
  const startedAt = Date.now();
  const companyTokens = getCompanyTokens(startUrl);
  const queue: QueueItem[] = [
    {
      url: normalizeStoredUrl(startUrl),
      depth: 0,
      signalStrength: containsStrongKeyword(startUrl)
        ? 'strong'
        : containsWeakKeyword(startUrl)
          ? 'weak'
          : 'none',
    },
  ];
  const visited = new Set<string>();
  const candidates = new Map<string, Candidate>();
  let visitedPages = 0;
  let fetchErrors = 0;

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      break;
    }

    const normalizedCurrentUrl = normalizeStoredUrl(current.url);

    if (
      visited.has(normalizedCurrentUrl) ||
      isFileLikeUrl(normalizedCurrentUrl)
    ) {
      continue;
    }

    visited.add(normalizedCurrentUrl);
    visitedPages += 1;

    try {
      const directAtsProvider = detectAtsProvider(normalizedCurrentUrl);

      if (directAtsProvider) {
        addCandidate(candidates, {
          url: normalizedCurrentUrl,
          source: 'crawl',
        });
      }

      const page = await fetchHtmlPage(normalizedCurrentUrl);
      const finalPageUrl = normalizeStoredUrl(page.finalUrl);
      const pageText = stripHtml(page.html);
      const links = extractLinks(page.html, finalPageUrl, companyTokens);
      const pageAssessment = assessPageSignals(
        current,
        finalPageUrl,
        pageText,
        links,
      );

      visited.add(finalPageUrl);

      if (
        detectAtsProvider(finalPageUrl) ||
        pageAssessment.isJobPage ||
        containsStrongKeyword(finalPageUrl) ||
        containsWeakKeyword(finalPageUrl) ||
        hasJobDetailPattern(finalPageUrl)
      ) {
        addCandidate(candidates, { url: finalPageUrl, source: 'crawl' });
      }

      addCandidatesFromLinks(candidates, links, 'crawl', startUrl);

      const allowExtraDepth = shouldAllowDeeperExploration(
        finalPageUrl,
        companyTokens,
      );
      const depthLimit = MAX_CRAWL_DEPTH + Number(allowExtraDepth);

      if (allowExtraDepth && current.depth >= MAX_CRAWL_DEPTH) {
        logDiscovery('crawl-deeper', {
          website: startUrl,
          url: finalPageUrl,
          depth: current.depth,
          depthLimit,
          reason: 'career-or-pivot-signal',
        });
      }

      if (current.depth >= depthLimit) {
        continue;
      }

      const nextLinks = prioritizeSameDomainLinks(
        links,
        startUrl,
        finalPageUrl,
        companyTokens,
      );

      for (const link of nextLinks) {
        if (visited.has(link.url)) {
          continue;
        }

        queue.push({
          url: link.url,
          depth: current.depth + 1,
          signalStrength: link.strongSignal
            ? 'strong'
            : link.weakSignal
              ? 'weak'
              : 'none',
        });
      }
    } catch {
      fetchErrors += 1;
    }
  }

  return {
    attempt: {
      method: 'crawl',
      status:
        visitedPages > 0 && fetchErrors < visitedPages ? 'not_found' : 'error',
      foundUrl: null,
      durationMs: Date.now() - startedAt,
      message:
        visitedPages === 0
          ? 'No pages were crawled'
          : `Visited ${visitedPages} page(s), fetch errors: ${fetchErrors}, candidates: ${candidates.size}`,
    },
    candidates: [...candidates.values()],
  };
}

async function discoverFromSitemapCandidates(
  startUrl: string,
): Promise<CandidateCollectionResult> {
  const startedAt = Date.now();

  try {
    const sitemapDiscovery = await discoverFromSitemap(startUrl);
    const candidates = sitemapDiscovery.bestParent
      ? [
          {
            url: sitemapDiscovery.bestParent,
            source: 'sitemap' as const,
            clusterCount: sitemapDiscovery.cluster?.count,
            clusterConfidence: sitemapDiscovery.cluster?.confidence,
            clusterKeywordStrength: sitemapDiscovery.cluster?.keywordStrength,
            clusterPathDepth: sitemapDiscovery.cluster?.pathDepth,
            clusterSameRootDomain: sitemapDiscovery.cluster?.sameRootDomain,
            isSitemapClusterWinner: true,
          },
        ]
      : [];

    return {
      attempt: {
        method: 'sitemap',
        status: 'not_found',
        foundUrl: null,
        durationMs: Date.now() - startedAt,
        message:
          candidates.length > 0
            ? `Collected ${candidates.length} sitemap candidate(s)`
            : 'No job-related sitemap URLs found',
      },
      candidates,
    };
  } catch {
    return {
      attempt: {
        method: 'sitemap',
        status: 'error',
        foundUrl: null,
        durationMs: Date.now() - startedAt,
        message: 'Sitemap discovery failed',
      },
      candidates: [],
    };
  }
}

async function guessCommonPaths(
  startUrl: string,
): Promise<CandidateCollectionResult> {
  const startedAt = Date.now();
  const origin = new URL(startUrl).origin;
  const fallbackPaths = isRecruitmentStyleUrl(origin)
    ? [...new Set([...FALLBACK_PATHS, ...RECRUITMENT_STYLE_LISTING_PATHS])]
    : FALLBACK_PATHS;
  const candidates = fallbackPaths.map((path) => ({
    url: new URL(path, origin).toString(),
    source: 'path' as const,
  }));

  return {
    attempt: {
      method: 'path_guess',
      status: 'not_found',
      foundUrl: null,
      durationMs: Date.now() - startedAt,
      message: `Generated ${candidates.length} fallback path candidate(s)`,
    },
    candidates,
  };
}

async function guessDutchRecruitmentDomains(
  startUrl: string,
): Promise<CandidateCollectionResult> {
  const startedAt = Date.now();
  const companyLabel = getRootDomainLabel(startUrl).toLowerCase();
  const compactLabel = companyLabel.replace(/[^a-z0-9]/gi, '');
  const dashedLabel = companyLabel
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  const candidateBases = [
    `https://werkenbij${compactLabel}.nl`,
    `https://werkenbij-${compactLabel}.nl`,
    dashedLabel ? `https://werkenbij-${dashedLabel}.nl` : null,
  ].filter((value): value is string => Boolean(value));
  const candidates = new Map<string, Candidate>();

  for (const baseUrl of candidateBases) {
    addCandidate(candidates, { url: baseUrl, source: 'subdomain' });

    for (const path of [
      '/vacatures',
      '/jobs',
      '/careers',
      '/werken-bij',
      '/werkenbij',
    ]) {
      addCandidate(candidates, {
        url: new URL(path, `${baseUrl}/`).toString(),
        source: 'subdomain',
      });
    }
  }

  return {
    attempt: {
      method: 'path_guess',
      status: 'not_found',
      foundUrl: null,
      durationMs: Date.now() - startedAt,
      message: `Generated ${candidates.size} recruitment subdomain candidate(s)`,
    },
    candidates: [...candidates.values()],
  };
}

function shouldCheckSoft404(candidate: Candidate): boolean {
  return candidate.source === 'path' || candidate.source === 'subdomain';
}

function mapSourceToMethod(source: Candidate['source']): DiscoveryMethod {
  if (source === 'sitemap') {
    return 'sitemap';
  }

  if (source === 'path' || source === 'subdomain') {
    return 'path_guess';
  }

  return 'crawl';
}

async function selectBestCandidate(
  startUrl: string,
  candidates: Candidate[],
): Promise<CandidateSelection> {
  const companyTokens = getCompanyTokens(startUrl);
  const businessName = getRootDomainLabel(startUrl);
  const minimumSkippedLogScore = SCORE_WEIGHTS.minimumAcceptedScore - 5;
  const evidenceByUrl = buildCandidateEvidenceMap(candidates);
  const scoredCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      ...getCandidateScoreBreakdown(
        candidate,
        businessName,
        startUrl,
        evidenceByUrl.get(normalizeStoredUrl(candidate.url)),
      ),
    }))
    .sort((left, right) => right.score - left.score);

  const topCandidates = scoredCandidates.slice(0, 5).map((candidate) => ({
    url: candidate.url,
    source: candidate.source,
    score: candidate.score,
    reasons: candidate.reasons,
  }));

  logDiscovery('scoring', {
    website: startUrl,
    candidateCount: scoredCandidates.length,
    topCandidates,
  });

  const prioritizedCandidates = scoredCandidates;

  logDiscovery('debug-priority', {
    website: startUrl,
    orderedCandidates: prioritizedCandidates.map((candidate) => ({
      url: candidate.url,
      score: candidate.score,
      source: candidate.source,
    })),
  });

  const bestCandidate = scoredCandidates[0] ?? null;

  if (
    !bestCandidate ||
    bestCandidate.score < SCORE_WEIGHTS.minimumAcceptedScore
  ) {
    logDiscovery('low-confidence', {
      website: startUrl,
      minimumAcceptedScore: SCORE_WEIGHTS.minimumAcceptedScore,
      bestCandidate,
      topCandidates,
      reason: !bestCandidate ? 'no-candidates' : 'score-below-threshold',
    });

    return {
      finalized: null,
      selected: null,
      scoredCandidates,
    };
  }

  const seenUrls = new Set<string>();
  let skippedLogCount = 0;

  function logSkippedCandidate(payload: Record<string, unknown>): void {
    const score =
      typeof payload.score === 'number'
        ? payload.score
        : Number.NEGATIVE_INFINITY;

    if (score < minimumSkippedLogScore || skippedLogCount >= 20) {
      return;
    }

    skippedLogCount += 1;
    logDiscovery('skipped', payload);
  }

  for (const candidate of prioritizedCandidates) {
    if (candidate.score < SCORE_WEIGHTS.minimumAcceptedScore) {
      logSkippedCandidate({
        website: startUrl,
        url: candidate.url,
        score: candidate.score,
        reason: 'below-min-score',
      });
      break;
    }

    if (!hasJobIntent(candidate)) {
      logSkippedCandidate({
        website: startUrl,
        url: candidate.url,
        score: candidate.score,
        reasons: candidate.reasons,
        reason: 'no-job-intent',
      });
      continue;
    }

    let triedAnyTarget = false;

    for (const targetUrl of expandCandidateFinalizationTargets(candidate.url)) {
      const dedupeKey = getCandidateDedupeKey(targetUrl);

      if (!dedupeKey || seenUrls.has(dedupeKey)) {
        continue;
      }

      seenUrls.add(dedupeKey);
      triedAnyTarget = true;

      const finalized = await finalizeCandidateUrl(
        targetUrl,
        startUrl,
        companyTokens,
        { checkSoft404Title: shouldCheckSoft404(candidate) },
      );

      if (finalized) {
        const normalizedFinalized =
          await normalizeSelectedDetailPageToParentListing(
            candidate,
            finalized,
            startUrl,
            companyTokens,
          );

        if (targetUrl !== candidate.url) {
          logDiscovery('parent-promotion', {
            website: startUrl,
            candidateUrl: candidate.url,
            promotedUrl: targetUrl,
            selectedUrl: normalizedFinalized.jobsUrl,
            score: candidate.score,
          });
        }

        logDiscovery('decision', {
          website: startUrl,
          candidateUrl: candidate.url,
          finalizedTargetUrl: targetUrl,
          selectedUrl: normalizedFinalized.jobsUrl,
          score: candidate.score,
          reason:
            normalizedFinalized.jobsUrl !== finalized.jobsUrl ||
            targetUrl !== candidate.url
              ? 'selected-after-parent-promotion'
              : targetUrl === candidate.url
                ? 'selected-after-finalize'
                : 'selected-after-parent-promotion',
        });

        return {
          finalized: normalizedFinalized,
          selected: candidate,
          scoredCandidates,
        };
      }
    }

    logSkippedCandidate({
      website: startUrl,
      url: candidate.url,
      score: candidate.score,
      reason: triedAnyTarget ? 'finalize-failed' : 'duplicate',
    });
  }

  logDiscovery('low-confidence', {
    website: startUrl,
    minimumAcceptedScore: SCORE_WEIGHTS.minimumAcceptedScore,
    bestCandidate,
    topCandidates,
    reason: 'candidate-finalization-failed',
  });

  return {
    finalized: null,
    selected: null,
    scoredCandidates,
  };
}

function updateAttemptWithSelection(
  attempt: DiscoveryAttempt,
  sources: Candidate['source'][],
  selected: ScoredCandidate | null,
  finalized: FinalizedCandidate | null,
): DiscoveryAttempt {
  if (!selected || !finalized || !sources.includes(selected.source)) {
    return attempt;
  }

  return {
    ...attempt,
    status: 'found',
    foundUrl: finalized.jobsUrl,
    message: `${attempt.message} | selected ${selected.source} candidate with score ${selected.score}`,
  };
}

export async function discoverByHeuristics(
  website: string,
): Promise<JobPageDiscoveryResult> {
  const reachability = await resolveReachableUrl(website);
  const unreachableStatus =
    reachability.statusCode && reachability.statusCode < 500
      ? 'not_found'
      : 'error';

  if (!reachability.reachable || !reachability.finalUrl) {
    if (unreachableStatus === 'error') {
      logDiscovery('errors', {
        website,
        statusCode: reachability.statusCode ?? null,
        message: reachability.message,
        reason: 'website-unreachable',
      });
    }

    return {
      status: unreachableStatus,
      jobsUrl: null,
      method: null,
      platform: null,
      attempts: [
        {
          method: 'crawl',
          status: unreachableStatus,
          foundUrl: null,
          durationMs: 0,
          message: `Website unreachable: ${reachability.message}`,
        },
      ],
    };
  }

  const crawlResult = await crawlForJobPage(reachability.finalUrl);
  // console.log(`crawl:`);
  // console.log(crawlResult);
  const htmlResult = await inspectFooterForJobPage(reachability.finalUrl);
  // console.log(`footer:`);
  // console.log(htmlResult);
  const sitemapResult = await discoverFromSitemapCandidates(
    reachability.finalUrl,
  );
  // console.log(`sitemap:`);
  // console.log(sitemapResult);
  const fallbackResult = await guessCommonPaths(reachability.finalUrl);
  const subdomainResult = await guessDutchRecruitmentDomains(
    reachability.finalUrl,
  );

  const allCandidates = [
    ...crawlResult.candidates,
    ...htmlResult.candidates,
    ...sitemapResult.candidates,
    ...fallbackResult.candidates,
    ...subdomainResult.candidates,
  ];

  const selection = await selectBestCandidate(
    reachability.finalUrl,
    allCandidates,
  );

  const attempts = [
    updateAttemptWithSelection(
      crawlResult.attempt,
      ['crawl'],
      selection.selected,
      selection.finalized,
    ),
    updateAttemptWithSelection(
      htmlResult.attempt,
      ['html'],
      selection.selected,
      selection.finalized,
    ),
    updateAttemptWithSelection(
      sitemapResult.attempt,
      ['sitemap'],
      selection.selected,
      selection.finalized,
    ),
    updateAttemptWithSelection(
      fallbackResult.attempt,
      ['path'],
      selection.selected,
      selection.finalized,
    ),
    updateAttemptWithSelection(
      subdomainResult.attempt,
      ['subdomain'],
      selection.selected,
      selection.finalized,
    ),
  ];

  if (selection.finalized && selection.selected) {
    return {
      status: 'found',
      jobsUrl: selection.finalized.jobsUrl,
      method: mapSourceToMethod(selection.selected.source),
      platform: selection.finalized.platform,
      attempts,
    };
  }

  if (
    allCandidates.length === 0 &&
    attempts.every((attempt) => attempt.status === 'error')
  ) {
    logDiscovery('errors', {
      website: reachability.finalUrl,
      attempts,
      reason: 'all-discovery-methods-failed',
    });
  }

  return {
    status:
      allCandidates.length === 0 &&
      attempts.every((attempt) => attempt.status === 'error')
        ? 'error'
        : 'not_found',
    jobsUrl: null,
    method: null,
    platform: null,
    attempts,
  };
}
