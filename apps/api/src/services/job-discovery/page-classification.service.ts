import {
  isSameRootDomain,
  normalizeStoredUrl,
  resolveAbsoluteUrl,
} from './domain.utils';

export type PageType =
  | 'job_overview'
  | 'career_landing'
  | 'job_detail'
  | 'article_or_news'
  | 'external_ats'
  | 'other';

export type PageFeatures = {
  url: string;
  normalizedUrl: string;
  title: string;
  h1: string | null;
  metaDescription: string | null;
  breadcrumbs: string[];
  navLabels: string[];
  ctaTexts: string[];
  visibleTextSnippet: string;
  sameRootDomain: boolean;
  pathSegments: string[];
  depth: number;
  hasArticlePath: boolean;
  hasDateInPath: boolean;
  hasJobKeywordsInUrl: boolean;
  hasCareerLandingKeywords: boolean;
  hasOverviewKeywords: boolean;
  hasDetailKeywords: boolean;
  hasArticleKeywords: boolean;
  vacancyLinkCount: number;
  applyButtonCount: number;
  listingCardCount: number;
  externalAtsLinks: string[];
  internalJobLinks: string[];
  rankedInternalJobLinks: string[];
  parentOverviewCandidates: string[];
  articleKeywordCount: number;
  detectedPageTypeHints: string[];
};

export type PageClassification = {
  pageType: PageType;
  confidence: number;
  reasons: string[];
};

export type CanonicalSelection = {
  canonicalUrl: string | null;
  pageType: PageType;
  confidence: number;
  reasons: string[];
  jobsOverviewUrl: string | null;
  employerBrandUrl: string | null;
  externalAtsUrl: string | null;
};

type ExtractedAnchor = {
  url: string;
  text: string;
};

const ATS_HOST_PATTERNS = [
  /(^|\.)greenhouse\.io$/i,
  /(^|\.)lever\.co$/i,
  /(^|\.)ashbyhq\.com$/i,
  /(^|\.)workable\.com$/i,
  /(^|\.)recruitee\.com$/i,
  /(^|\.)teamtailor\.com$/i,
  /(^|\.)homerun\.co$/i,
  /(^|\.)smartrecruiters\.com$/i,
  /(^|\.)jobs\.smartrecruiters\.com$/i,
  /(^|\.)breezy\.hr$/i,
  /(^|\.)personio\.de$/i,
  /(^|\.)personio\.com$/i,
  /(^|\.)myworkdayjobs\.com$/i,
  /(^|\.)jobvite\.com$/i,
  /(^|\.)onlyfy\.jobs$/i,
  /(^|\.)rexx-systems\.com$/i,
  /(^|\.)bamboohr\.com$/i,
];

const ARTICLE_SEGMENTS = new Set([
  'article',
  'articles',
  'blog',
  'blogs',
  'event',
  'events',
  'insight',
  'insights',
  'news',
  'nieuws',
  'onderwerp',
  'press',
  'stories',
  'story',
  'verhalen',
]);

const ARTICLE_KEYWORDS = [
  'author',
  'auteur',
  'blog',
  'event',
  'events',
  'news',
  'nieuws',
  'published',
  'posted',
  'related articles',
  'related posts',
  'share this',
  'stories',
];

const DUTCH_QUESTION_ARTICLE_SLUG_PREFIXES = [
  'hoe',
  'waar',
  'waarom',
  'wanneer',
  'wat',
  'welke',
  'wie',
];

const CAREER_LANDING_KEYWORDS = [
  'careers at',
  'join our team',
  'join us',
  'kom werken',
  'werken bij',
  'werkenbij',
  'working at',
  'work with us',
];

const OVERVIEW_KEYWORDS = [
  'all jobs',
  'alle vacatures',
  'bekijk vacatures',
  'careers',
  'jobs',
  'open positions',
  'open roles',
  'vacancies',
  'vacatures',
];

const DETAIL_KEYWORDS = [
  'apply',
  'apply now',
  'functieomschrijving',
  'job description',
  'requirements',
  'responsibilities',
  'solliciteer',
  'solliciteer direct',
  'vacature',
  'vereisten',
  'verantwoordelijkheden',
  'what we offer',
  'wie ben jij',
];

const JOB_URL_KEYWORDS = [
  'baan',
  'career',
  'careers',
  'carriere',
  'job',
  'jobs',
  'open-positions',
  'vacancies',
  'vacancy',
  'vacature',
  'vacatures',
  'werken-bij',
  'werkenbij',
];

const MIXED_INTENT_PHRASES = [
  'career guidance',
  'get the job done',
  'join us at',
  'remote careers us',
  'working at',
];

const FILTER_KEYWORDS = [
  'department',
  'departement',
  'filter',
  'location',
  'locatie',
  'team',
  'vakgebied',
];

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasAny(value: string, needles: readonly string[]): boolean {
  const normalized = normalizeForMatch(value);
  return needles.some((needle) =>
    normalized.includes(normalizeForMatch(needle)),
  );
}

function countAny(value: string, needles: readonly string[]): number {
  const normalized = normalizeForMatch(value);
  return needles.filter((needle) =>
    normalized.includes(normalizeForMatch(needle)),
  ).length;
}

function extractFirstTagText(html: string, tagName: string): string | null {
  const match = html.match(
    new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'),
  );

  return match?.[1] ? stripHtml(match[1]) : null;
}

function extractTitle(html: string): string {
  return extractFirstTagText(html, 'title') ?? '';
}

function extractMetaDescription(html: string): string | null {
  const match = html.match(
    /<meta\b(?=[^>]*(?:name|property)=["'](?:description|og:description)["'])(?=[^>]*content=["']([^"']*)["'])[^>]*>/i,
  );

  return match?.[1] ? decodeHtmlEntities(match[1]).trim() : null;
}

function extractTagTexts(html: string, tagName: string): string[] {
  const regex = new RegExp(
    `<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    'gi',
  );
  const texts: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const text = stripHtml(match[1] ?? '');

    if (text) {
      texts.push(text);
    }
  }

  return texts;
}

function extractAnchors(html: string, baseUrl: string): ExtractedAnchor[] {
  const anchors: ExtractedAnchor[] = [];
  const seen = new Set<string>();
  const regex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const url = resolveAbsoluteUrl(match[1] ?? '', baseUrl);

    if (!url) {
      continue;
    }

    const normalizedUrl = normalizeStoredUrl(url);
    const text = stripHtml(match[2] ?? '');
    const key = `${normalizedUrl} ${text}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    anchors.push({ url: normalizedUrl, text });
  }

  return anchors;
}

function extractNavLabels(html: string): string[] {
  const navHtml = html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi) ?? [];
  return navHtml.flatMap((nav) => extractTagTexts(nav, 'a')).slice(0, 40);
}

function extractBreadcrumbs(html: string): string[] {
  const matches = html.match(
    /<(?:nav|ol|ul|div)\b[^>]*(?:breadcrumb|breadcrumbs)[^>]*>[\s\S]*?<\/(?:nav|ol|ul|div)>/gi,
  );

  return (matches ?? [])
    .flatMap((section) => [
      ...extractTagTexts(section, 'a'),
      ...extractTagTexts(section, 'li'),
    ])
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function extractCtaTexts(html: string): string[] {
  return [
    ...extractTagTexts(html, 'button'),
    ...extractTagTexts(html, 'a').filter((text) =>
      hasAny(text, DETAIL_KEYWORDS),
    ),
  ]
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, 40);
}

function getPathSegments(url: string): string[] {
  try {
    return new URL(url).pathname
      .toLowerCase()
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/')
      .replace(/\/+$/, '')
      .split('/')
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function isLikelyQuestionArticleUrl(url: string): boolean {
  const segments = getPathSegments(url);
  const lastSlug = segments.at(-1) ?? '';

  if (
    !lastSlug ||
    !segments.some((segment) => ARTICLE_SEGMENTS.has(segment))
  ) {
    return false;
  }

  return DUTCH_QUESTION_ARTICLE_SLUG_PREFIXES.some(
    (prefix) =>
      lastSlug === prefix ||
      lastSlug.startsWith(`${prefix}-`) ||
      lastSlug.startsWith(`${prefix}_`),
  );
}

function isAtsUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ATS_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

function hasDateInPath(segments: string[]): boolean {
  return segments.some((segment, index) => {
    if (/^(?:19|20)\d{2}$/.test(segment)) {
      const month = segments[index + 1] ?? '';
      const day = segments[index + 2] ?? '';
      return (
        /^(?:0?[1-9]|1[0-2])$/.test(month) &&
        /^(?:0?[1-9]|[12]\d|3[01])$/.test(day)
      );
    }

    return /^\d{4}-\d{2}-\d{2}$/.test(segment);
  });
}

function countListingCards(html: string): number {
  const cardClassMatches =
    html.match(
      /class=["'][^"']*(?:job|jobs|vacancy|vacature|position|opening)[^"']*(?:card|item|listing|tile|row)|class=["'][^"']*(?:card|item|listing|tile|row)[^"']*(?:job|jobs|vacancy|vacature|position|opening)[^"']*/gi,
    ) ?? [];
  const structuredJobMatches = html.match(/JobPosting/gi) ?? [];

  return cardClassMatches.length + structuredJobMatches.length;
}

function dedupeUrls(urls: string[]): string[] {
  return [...new Set(urls.map((url) => normalizeStoredUrl(url)))];
}

function looksLikePaginationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.has('page');
  } catch {
    return false;
  }
}

function looksLikeDetailUrl(url: string): boolean {
  const segments = getPathSegments(url);
  const depth = segments.length;
  const last = segments.at(-1) ?? '';
  const parent = segments.at(-2) ?? '';

  if (depth < 2) {
    return false;
  }

  const parentLooksJobLike = [
    'vacature',
    'vacatures',
    'vacancy',
    'vacancies',
    'job',
    'jobs',
    'position',
    'positions',
    'careers',
    'werken-bij',
    'werkenbij',
  ].includes(parent);

  const lastLooksOverview = hasAny(last, OVERVIEW_KEYWORDS);
  const lastLooksLongSlug =
    last.includes('-') || last.length >= 12 || /^[a-z0-9]+$/i.test(last);

  return parentLooksJobLike && !lastLooksOverview && lastLooksLongSlug;
}

function isLikelyOverviewUrl(url: string): boolean {
  const segments = getPathSegments(url);

  if (looksLikeDetailUrl(url)) {
    return false;
  }

  if (segments.some((segment) => ARTICLE_SEGMENTS.has(segment))) {
    return false;
  }

  if (hasDateInPath(segments)) {
    return false;
  }

  return hasAny(url, OVERVIEW_KEYWORDS) || segments.length <= 1;
}

function scoreInternalJobLink(url: string, startUrl: string): number {
  let score = 0;
  const segments = getPathSegments(url);
  const last = segments.at(-1) ?? '';
  const depth = segments.length;

  if (isSameRootDomain(url, startUrl)) score += 25;
  if (hasAny(url, OVERVIEW_KEYWORDS)) score += 30;
  if (hasAny(url, CAREER_LANDING_KEYWORDS)) score += 12;
  if (depth <= 2) score += 10;
  if (!looksLikePaginationUrl(url)) score += 5;

  if (looksLikeDetailUrl(url)) score -= 30;
  if (ARTICLE_SEGMENTS.has(last)) score -= 25;
  if (hasDateInPath(segments)) score -= 25;
  if (looksLikePaginationUrl(url)) score -= 8;

  score += getMixedIntentSlugPenalty(last);

  return score;
}

function rankInternalJobLinks(urls: string[], startUrl: string): string[] {
  return dedupeUrls(urls).sort(
    (a, b) =>
      scoreInternalJobLink(b, startUrl) - scoreInternalJobLink(a, startUrl),
  );
}

function buildParentOverviewCandidates(url: string): string[] {
  try {
    const parsed = new URL(url);
    const origin = parsed.origin;
    const segments = getPathSegments(url);
    const candidates = new Set<string>();

    const add = (pathname: string): void => {
      const cleanPath = pathname.replace(/\/+$/, '') || '/';
      candidates.add(normalizeStoredUrl(new URL(cleanPath, origin).toString()));
    };

    const pathname = `/${segments.join('/')}`;

    const directPatterns: Array<[RegExp, string[]]> = [
      [/\/vacature\/[^/]+$/i, ['/vacatures', '/werken-bij', '/jobs']],
      [/\/vacancy\/[^/]+$/i, ['/vacancies', '/careers', '/jobs']],
      [/\/job\/[^/]+$/i, ['/jobs', '/careers']],
      [/\/jobs\/[^/]+$/i, ['/jobs', '/careers']],
      [/\/careers?\/[^/]+$/i, ['/careers', '/jobs']],
      [/\/werken-bij\/[^/]+$/i, ['/werken-bij', '/vacatures']],
      [/\/werkenbij\/[^/]+$/i, ['/werkenbij', '/vacatures']],
      [/\/open-positions\/[^/]+$/i, ['/open-positions', '/careers', '/jobs']],
    ];

    for (const [pattern, replacements] of directPatterns) {
      if (pattern.test(pathname)) {
        for (const replacement of replacements) {
          add(replacement);
        }
      }
    }

    for (let i = segments.length - 1; i > 0; i -= 1) {
      const parentPath = `/${segments.slice(0, i).join('/')}`;
      add(parentPath);
    }

    const knownOverviewPaths = [
      '/vacatures',
      '/vacancies',
      '/jobs',
      '/careers',
      '/werken-bij',
      '/werkenbij',
      '/join-us',
      '/open-positions',
      '/jouw-carriere',
      '/job-openings',
    ];

    for (const candidate of knownOverviewPaths) {
      add(candidate);
    }

    return [...candidates].sort((a, b) => {
      const aScore = scoreInternalJobLink(a, url);
      const bScore = scoreInternalJobLink(b, url);
      return bScore - aScore;
    });
  } catch {
    return [];
  }
}

function getArticleContext(input: {
  normalizedUrl: string;
  title: string;
  h1: string | null;
  metaDescription: string | null;
  breadcrumbs: string[];
}): string {
  return [
    input.normalizedUrl,
    input.title,
    input.h1 ?? '',
    input.metaDescription ?? '',
    input.breadcrumbs.join(' '),
  ]
    .filter(Boolean)
    .join(' ');
}

export function getMixedIntentSlugPenalty(slug: string): number {
  const normalized = normalizeForMatch(slug);

  if (!normalized) {
    return 0;
  }

  let penalty = 0;
  const wordCount = normalized.split(' ').length;

  if (
    MIXED_INTENT_PHRASES.some(
      (phrase) => phrase !== 'working at' && normalized.includes(phrase),
    )
  ) {
    penalty -= 25;
  }

  if (normalized.includes('working at') && wordCount >= 5) {
    penalty -= 10;
  }

  if (
    /\b(flow|conference|building|house|manager app|guidance|story|guide)\b/.test(
      normalized,
    )
  ) {
    penalty -= 15;
  }

  if (
    /\b(job|career|careers|working|join us)\b/.test(normalized) &&
    wordCount >= 5
  ) {
    penalty -= 20;
  }

  return penalty;
}

export function isSoft404Title(title: string): boolean {
  const normalized = title.toLowerCase().trim();

  return (
    Boolean(normalized) &&
    ([
      'pagina niet gevonden',
      'page not found',
      'not found',
      'niet gevonden',
    ].some((phrase) => normalized.includes(phrase)) ||
      /\b404\b/.test(normalized))
  );
}

export function extractPageFeatures(
  html: string,
  url: string,
  startUrl: string,
): PageFeatures {
  const normalizedUrl = normalizeStoredUrl(url);
  const pathSegments = getPathSegments(normalizedUrl);
  const title = extractTitle(html);
  const h1 = extractFirstTagText(html, 'h1');
  const metaDescription = extractMetaDescription(html);
  const breadcrumbs = extractBreadcrumbs(html);
  const navLabels = extractNavLabels(html);
  const ctaTexts = extractCtaTexts(html);
  const anchors = extractAnchors(html, normalizedUrl);
  const visibleTextSnippet = stripHtml(html).slice(0, 2000);

  const combinedText = [
    normalizedUrl,
    title,
    h1,
    metaDescription,
    breadcrumbs.join(' '),
    navLabels.join(' '),
    ctaTexts.join(' '),
    visibleTextSnippet,
  ]
    .filter(Boolean)
    .join(' ');

  const articleContext = getArticleContext({
    normalizedUrl,
    title,
    h1,
    metaDescription,
    breadcrumbs,
  });

  const sameRootDomain = isSameRootDomain(normalizedUrl, startUrl);
  const hasArticlePath = pathSegments.some((segment) =>
    ARTICLE_SEGMENTS.has(segment),
  );
  const articleKeywordCount = countAny(articleContext, ARTICLE_KEYWORDS);

  const internalJobLinks = anchors
    .filter(
      (anchor) =>
        isSameRootDomain(anchor.url, startUrl) &&
        hasAny(`${anchor.url} ${anchor.text}`, [
          ...JOB_URL_KEYWORDS,
          ...OVERVIEW_KEYWORDS,
          ...CAREER_LANDING_KEYWORDS,
        ]),
    )
    .map((anchor) => anchor.url);

  const rankedInternalJobLinks = rankInternalJobLinks(
    internalJobLinks,
    startUrl,
  );

  const externalAtsLinks = anchors
    .filter(
      (anchor) =>
        !isSameRootDomain(anchor.url, startUrl) && isAtsUrl(anchor.url),
    )
    .map((anchor) => anchor.url);

  const applyButtonCount = ctaTexts.filter((text) =>
    hasAny(text, DETAIL_KEYWORDS),
  ).length;

  const listingCardCount = countListingCards(html);
  const parentOverviewCandidates = buildParentOverviewCandidates(normalizedUrl);
  const detectedPageTypeHints: string[] = [];

  if (hasArticlePath) detectedPageTypeHints.push('article-path');
  if (hasDateInPath(pathSegments)) detectedPageTypeHints.push('date-path');
  if (isAtsUrl(normalizedUrl)) detectedPageTypeHints.push('ats-host');
  if (internalJobLinks.length >= 3) {
    detectedPageTypeHints.push('many-internal-job-links');
  }
  if (externalAtsLinks.length > 0) {
    detectedPageTypeHints.push('external-ats-links');
  }
  if (applyButtonCount > 0) {
    detectedPageTypeHints.push('apply-cta');
  }
  if (listingCardCount > 0) {
    detectedPageTypeHints.push('listing-cards');
  }
  if (articleKeywordCount >= 2) {
    detectedPageTypeHints.push('article-markers');
  }
  if (isLikelyQuestionArticleUrl(normalizedUrl)) {
    detectedPageTypeHints.push('article-question-slug');
  }
  if (isSoft404Title(title)) {
    detectedPageTypeHints.push('soft-404-title');
  }

  return {
    url,
    normalizedUrl,
    title,
    h1,
    metaDescription,
    breadcrumbs,
    navLabels,
    ctaTexts,
    visibleTextSnippet,
    sameRootDomain,
    pathSegments,
    depth: pathSegments.length,
    hasArticlePath,
    hasDateInPath: hasDateInPath(pathSegments),
    hasJobKeywordsInUrl: hasAny(normalizedUrl, JOB_URL_KEYWORDS),
    hasCareerLandingKeywords: hasAny(combinedText, CAREER_LANDING_KEYWORDS),
    hasOverviewKeywords: hasAny(combinedText, OVERVIEW_KEYWORDS),
    hasDetailKeywords: hasAny(combinedText, DETAIL_KEYWORDS),
    hasArticleKeywords: articleKeywordCount > 0,
    vacancyLinkCount: dedupeUrls(internalJobLinks).length,
    applyButtonCount,
    listingCardCount,
    externalAtsLinks: dedupeUrls(externalAtsLinks),
    internalJobLinks: dedupeUrls(internalJobLinks),
    rankedInternalJobLinks,
    parentOverviewCandidates,
    articleKeywordCount,
    detectedPageTypeHints,
  };
}

export function classifyPageType(features: PageFeatures): PageClassification {
  const reasons: string[] = [];
  const lastSlug = features.pathSegments.at(-1) ?? '';
  const mixedIntentPenalty = getMixedIntentSlugPenalty(lastSlug);
  const heading = `${features.title} ${features.h1 ?? ''}`;

  const hasFilterSignals = hasAny(
    `${features.navLabels.join(' ')} ${features.visibleTextSnippet}`,
    FILTER_KEYWORDS,
  );

  const overviewSignalCount =
    Number(features.hasOverviewKeywords) +
    Number(features.vacancyLinkCount >= 3) +
    Number(features.listingCardCount >= 2) +
    Number(hasFilterSignals);

  const detailSignalCount =
    Number(features.hasDetailKeywords) +
    Number(features.applyButtonCount > 0) +
    Number(features.depth >= 2 && features.hasJobKeywordsInUrl) +
    Number(countAny(features.visibleTextSnippet, DETAIL_KEYWORDS) >= 2);

  const articleSignalCount =
    Number(features.hasArticlePath) +
    Number(features.hasDateInPath) +
    Number(features.articleKeywordCount >= 2) +
    Number(mixedIntentPenalty <= -20);

  if (features.detectedPageTypeHints.includes('soft-404-title')) {
    return {
      pageType: 'other',
      confidence: 0.95,
      reasons: ['soft-404-title'],
    };
  }

  if (features.detectedPageTypeHints.includes('ats-host')) {
    return {
      pageType: 'external_ats',
      confidence: 0.98,
      reasons: ['ats-host'],
    };
  }

  if (features.detectedPageTypeHints.includes('article-question-slug')) {
    return {
      pageType: 'article_or_news',
      confidence: 0.97,
      reasons: ['article-question-slug'],
    };
  }

  if (articleSignalCount >= 2 && overviewSignalCount < 2) {
    reasons.push('article-or-news-signals');

    if (mixedIntentPenalty < 0) {
      reasons.push(`mixed-intent-slug-penalty=${mixedIntentPenalty}`);
    }

    return {
      pageType: 'article_or_news',
      confidence: Math.min(0.95, 0.65 + articleSignalCount * 0.1),
      reasons,
    };
  }

  if (
    overviewSignalCount >= 3 ||
    features.vacancyLinkCount >= 5 ||
    features.listingCardCount >= 3 ||
    (features.hasOverviewKeywords &&
      (features.vacancyLinkCount >= 2 ||
        features.listingCardCount >= 2 ||
        (features.hasJobKeywordsInUrl && features.depth <= 2)))
  ) {
    return {
      pageType: 'job_overview',
      confidence: Math.min(0.95, 0.6 + overviewSignalCount * 0.1),
      reasons: [
        `overview-signals=${overviewSignalCount}`,
        `vacancy-links=${features.vacancyLinkCount}`,
        `listing-cards=${features.listingCardCount}`,
      ],
    };
  }

  if (
    features.hasCareerLandingKeywords &&
    (features.externalAtsLinks.length > 0 ||
      features.rankedInternalJobLinks.length > 0 ||
      features.hasOverviewKeywords) &&
    detailSignalCount < 4
  ) {
    return {
      pageType: 'career_landing',
      confidence:
        features.externalAtsLinks.length > 0 ||
        features.rankedInternalJobLinks.length > 0
          ? 0.8
          : 0.64,
      reasons: [
        'career-landing-keywords',
        `internal-job-links=${features.rankedInternalJobLinks.length}`,
        `external-ats-links=${features.externalAtsLinks.length}`,
      ],
    };
  }

  if (detailSignalCount >= 3 && features.vacancyLinkCount < 3) {
    return {
      pageType: 'job_detail',
      confidence: Math.min(0.9, 0.55 + detailSignalCount * 0.1),
      reasons: [
        `detail-signals=${detailSignalCount}`,
        `heading=${heading.slice(0, 80)}`,
      ],
    };
  }

  if (articleSignalCount > 0 && mixedIntentPenalty < 0) {
    return {
      pageType: 'article_or_news',
      confidence: 0.7,
      reasons: [
        'weak-article-signal-with-mixed-intent-slug',
        `mixed-intent-slug-penalty=${mixedIntentPenalty}`,
      ],
    };
  }

  return {
    pageType: 'other',
    confidence: features.hasJobKeywordsInUrl ? 0.55 : 0.7,
    reasons: features.hasJobKeywordsInUrl
      ? ['job-keyword-without-page-evidence']
      : ['no-job-page-evidence'],
  };
}

export function buildCanonicalSelection(
  features: PageFeatures,
  classification: PageClassification,
): CanonicalSelection {
  const jobsOverviewUrl =
    features.rankedInternalJobLinks.find((url) => isLikelyOverviewUrl(url)) ??
    features.rankedInternalJobLinks[0] ??
    null;

  const parentOverviewUrl =
    features.parentOverviewCandidates.find((url) => isLikelyOverviewUrl(url)) ??
    features.parentOverviewCandidates[0] ??
    null;

  const externalAtsUrl = features.externalAtsLinks[0] ?? null;
  const employerBrandUrl =
    classification.pageType === 'career_landing'
      ? features.normalizedUrl
      : null;

  switch (classification.pageType) {
    case 'job_overview':
      return {
        canonicalUrl: features.normalizedUrl,
        pageType: classification.pageType,
        confidence: classification.confidence,
        reasons: ['overview-page-is-canonical', ...classification.reasons],
        jobsOverviewUrl: features.normalizedUrl,
        employerBrandUrl: null,
        externalAtsUrl,
      };

    case 'career_landing':
      return {
        canonicalUrl:
          jobsOverviewUrl ?? externalAtsUrl ?? features.normalizedUrl,
        pageType: classification.pageType,
        confidence: classification.confidence,
        reasons: [
          jobsOverviewUrl
            ? 'career-landing-hands-off-to-internal-overview'
            : externalAtsUrl
              ? 'career-landing-hands-off-to-external-ats'
              : 'career-landing-used-as-canonical',
          ...classification.reasons,
        ],
        jobsOverviewUrl,
        employerBrandUrl,
        externalAtsUrl,
      };

    case 'external_ats':
      return {
        canonicalUrl: features.normalizedUrl,
        pageType: classification.pageType,
        confidence: classification.confidence,
        reasons: ['external-ats-is-canonical', ...classification.reasons],
        jobsOverviewUrl: null,
        employerBrandUrl: null,
        externalAtsUrl: features.normalizedUrl,
      };

    case 'job_detail': {
      const canonicalUrl = jobsOverviewUrl ?? parentOverviewUrl ?? null;

      return {
        canonicalUrl,
        pageType: classification.pageType,
        confidence: classification.confidence,
        reasons: [
          jobsOverviewUrl
            ? 'job-detail-links-to-overview'
            : parentOverviewUrl
              ? 'job-detail-normalized-to-parent-overview-candidate'
              : 'job-detail-needs-final-validation',
          ...classification.reasons,
        ],
        jobsOverviewUrl: canonicalUrl,
        employerBrandUrl: null,
        externalAtsUrl,
      };
    }

    case 'article_or_news':
      if (features.detectedPageTypeHints.includes('article-question-slug')) {
        return {
          canonicalUrl: null,
          pageType: classification.pageType,
          confidence: classification.confidence,
          reasons: [
            'hard-rejected-question-article',
            ...classification.reasons,
          ],
          jobsOverviewUrl: null,
          employerBrandUrl: null,
          externalAtsUrl,
        };
      }

      return {
        canonicalUrl: jobsOverviewUrl ?? externalAtsUrl ?? null,
        pageType: classification.pageType,
        confidence: classification.confidence,
        reasons: [
          jobsOverviewUrl || externalAtsUrl
            ? 'article-rejected-but-strong-career-link-found'
            : 'article-rejected',
          ...classification.reasons,
        ],
        jobsOverviewUrl,
        employerBrandUrl: null,
        externalAtsUrl,
      };

    case 'other':
      return {
        canonicalUrl: null,
        pageType: classification.pageType,
        confidence: classification.confidence,
        reasons: classification.reasons,
        jobsOverviewUrl,
        employerBrandUrl: null,
        externalAtsUrl,
      };
  }
}
