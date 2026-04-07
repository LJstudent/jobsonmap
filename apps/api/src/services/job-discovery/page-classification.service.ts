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
  'job description',
  'requirements',
  'responsibilities',
  'solliciteer',
  'solliciteer direct',
  'vereisten',
  'verantwoordelijkheden',
  'vacature',
  'what we offer',
  'wie ben jij',
  'functieomschrijving',
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

function stripHtml(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
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
      .replace(/\/+$/, '')
      .split('/')
      .filter(Boolean);
  } catch {
    return [];
  }
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

export function getMixedIntentSlugPenalty(slug: string): number {
  const normalized = normalizeForMatch(slug);

  if (!normalized) {
    return 0;
  }

  let penalty = 0;

  if (MIXED_INTENT_PHRASES.some((phrase) => normalized.includes(phrase))) {
    penalty -= 25;
  }

  if (
    /\b(job|career|careers|working|join us)\b/.test(normalized) &&
    normalized.split(' ').length >= 5
  ) {
    penalty -= 20;
  }

  if (
    /\b(flow|conference|building|house|manager app|guidance)\b/.test(normalized)
  ) {
    penalty -= 15;
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
  const sameRootDomain = isSameRootDomain(normalizedUrl, startUrl);
  const hasArticlePath = pathSegments.some((segment) =>
    ARTICLE_SEGMENTS.has(segment),
  );
  const articleKeywordCount = countAny(combinedText, ARTICLE_KEYWORDS);
  const internalJobLinks = anchors
    .filter(
      (anchor) =>
        isSameRootDomain(anchor.url, startUrl) &&
        hasAny(`${anchor.url} ${anchor.text}`, [
          ...JOB_URL_KEYWORDS,
          ...OVERVIEW_KEYWORDS,
        ]),
    )
    .map((anchor) => anchor.url);
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
  const detectedPageTypeHints: string[] = [];

  if (hasArticlePath) detectedPageTypeHints.push('article-path');
  if (hasDateInPath(pathSegments)) detectedPageTypeHints.push('date-path');
  if (isAtsUrl(normalizedUrl)) detectedPageTypeHints.push('ats-host');
  if (internalJobLinks.length >= 3)
    detectedPageTypeHints.push('many-internal-job-links');
  if (externalAtsLinks.length > 0)
    detectedPageTypeHints.push('external-ats-links');
  if (applyButtonCount > 0) detectedPageTypeHints.push('apply-cta');
  if (listingCardCount > 0) detectedPageTypeHints.push('listing-cards');
  if (articleKeywordCount >= 2) detectedPageTypeHints.push('article-markers');
  if (isSoft404Title(title)) detectedPageTypeHints.push('soft-404-title');

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
    vacancyLinkCount: internalJobLinks.length,
    applyButtonCount,
    listingCardCount,
    externalAtsLinks: [...new Set(externalAtsLinks)],
    internalJobLinks: [...new Set(internalJobLinks)],
    detectedPageTypeHints,
  };
}

export function classifyPageType(features: PageFeatures): PageClassification {
  const reasons: string[] = [];
  const lastSlug = features.pathSegments.at(-1) ?? '';
  const mixedIntentPenalty = getMixedIntentSlugPenalty(lastSlug);
  const heading = `${features.title} ${features.h1 ?? ''}`;
  const overviewSignalCount =
    Number(features.hasOverviewKeywords) +
    Number(features.vacancyLinkCount >= 3) +
    Number(features.listingCardCount >= 2) +
    Number(
      hasAny(
        `${features.navLabels.join(' ')} ${features.visibleTextSnippet}`,
        FILTER_KEYWORDS,
      ),
    );
  const detailSignalCount =
    Number(features.hasDetailKeywords) +
    Number(features.applyButtonCount > 0) +
    Number(features.depth >= 2 && features.hasJobKeywordsInUrl) +
    Number(countAny(features.visibleTextSnippet, DETAIL_KEYWORDS) >= 2);
  const articleSignalCount =
    Number(features.hasArticlePath) +
    Number(features.hasDateInPath) +
    Number(features.hasArticleKeywords) +
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

  if (
    features.hasCareerLandingKeywords &&
    (features.externalAtsLinks.length > 0 ||
      features.internalJobLinks.length > 0 ||
      features.hasOverviewKeywords)
  ) {
    return {
      pageType: 'career_landing',
      confidence:
        features.externalAtsLinks.length > 0 ||
        features.internalJobLinks.length > 0
          ? 0.78
          : 0.62,
      reasons: [
        'career-landing-keywords',
        `internal-job-links=${features.internalJobLinks.length}`,
        `external-ats-links=${features.externalAtsLinks.length}`,
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
    features.internalJobLinks.find((url) => hasAny(url, OVERVIEW_KEYWORDS)) ??
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
    case 'job_detail':
      return {
        canonicalUrl: jobsOverviewUrl,
        pageType: classification.pageType,
        confidence: classification.confidence,
        reasons: [
          jobsOverviewUrl
            ? 'job-detail-links-to-overview'
            : 'job-detail-needs-parent-normalization',
          ...classification.reasons,
        ],
        jobsOverviewUrl,
        employerBrandUrl: null,
        externalAtsUrl,
      };
    case 'article_or_news':
      return {
        canonicalUrl: jobsOverviewUrl ?? externalAtsUrl,
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
