import {
  getNormalizedHostname,
  getRootDomainLabel,
  isFileLikeUrl,
  isSameRootDomain,
  normalizeStoredUrl,
  resolveAbsoluteUrl,
} from "./domain.utils";
import {
  fetchHtmlPage,
  resolveReachableUrl,
  testLightweightUrl,
} from "./http-client";
import { discoverFromSitemap } from "./sitemap-discovery.service";

export type DiscoveryStatus = "found" | "not_found" | "error";
export type DiscoveryMethod = "crawl" | "sitemap" | "path_guess";

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

type QueueItem = {
  url: string;
  depth: number;
  signalStrength: "none" | "weak" | "strong";
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

const STRONG_JOB_KEYWORDS = [
  "vacatures",
  "vacature",
  "jobs",
  "careers",
  "join-us",
  "join-our-team",
  "open-positions",
  "werken-bij",
  "werkenbij",
  "job",
  "career",
  "working-at",
  "kom-werken"
];

const WEAK_JOB_KEYWORDS = [
  "work",
  "werken",
  "positions",
  "opportunities",
];

const FALSE_POSITIVE_PATTERNS = [
  "blog",
  "news",
  "nieuws",
  "privacy",
  "terms",
  "policy",
  "voorwaarden",
  "product",
  "diensten",
  "service",
];

const ATS_PATTERNS = [
  { provider: "greenhouse", pattern: /(^|\.)greenhouse\.io$/i },
  { provider: "lever", pattern: /(^|\.)lever\.co$/i },
  { provider: "ashby", pattern: /(^|\.)ashbyhq\.com$/i },
  { provider: "teamtailor", pattern: /(^|\.)teamtailor\.com$/i },
  { provider: "recruitee", pattern: /(^|\.)recruitee\.com$/i },
  { provider: "workable", pattern: /(^|\.)workable\.com$/i },
  { provider: "homerun", pattern: /(^|\.)homerun\.co$/i },
];

const RECRUITMENT_HOST_KEYWORDS = ["werkenbij", "jobs", "careers"];
const ABOUT_PAGE_PATTERNS = ["/about", "/over-ons", "/company"];
const FALLBACK_PATHS = [
  "/jobs",
  "/careers",
  "/vacatures",
  "/werken-bij",
  "/career",
  "/join-us",
  "/work-with-us",
  "/open-positions",
];
const LISTING_SEGMENTS = ["/vacatures", "/jobs", "/careers", "/werken-bij", "/werkenbij"];
const MAX_CRAWL_DEPTH = 2;
const MAX_LINKS_PER_PAGE = 25;

function containsStrongKeyword(value: string): boolean {
  const normalized = value.toLowerCase();
  return STRONG_JOB_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function containsWeakKeyword(value: string): boolean {
  const normalized = value.toLowerCase();
  return WEAK_JOB_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function hasFalsePositiveHint(value: string): boolean {
  const normalized = value.toLowerCase();
  return FALSE_POSITIVE_PATTERNS.some((pattern) => normalized.includes(pattern));
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
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function extractTitle(html: string): string {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);

  if (!match?.[1]) {
    return "";
  }

  return stripHtml(match[1]);
}

export function isSoft404Title(title: string): boolean {
  const normalizedTitle = title.toLowerCase().trim();

  if (!normalizedTitle) {
    return false;
  }

  return [
    "pagina niet gevonden",
    "page not found",
    "not found",
  ].some((phrase) => normalizedTitle.includes(phrase)) || /\b404\b/.test(normalizedTitle);
}

function assertNotSoft404(html: string): void {
  const title = extractTitle(html);

  if (isSoft404Title(title)) {
    throw new Error("Soft 404 detected via title");
  }
}

function getCompanyTokens(startUrl: string): string[] {
  const rootLabel = getRootDomainLabel(startUrl).toLowerCase();
  const splitTokens = rootLabel.split(/[^a-z0-9]+/i).filter((token) => token.length >= 3);
  const compactToken = rootLabel.replace(/[^a-z0-9]/gi, "");
  const tokens = compactToken.length >= 3 ? [...splitTokens, compactToken] : splitTokens;

  return [...new Set(tokens)];
}

function isAboutPage(url: string): boolean {
  const normalized = url.toLowerCase();
  return ABOUT_PAGE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function isRecruitmentDomain(url: string, companyTokens: string[]): boolean {
  try {
    const hostname = getNormalizedHostname(url);
    const hasRecruitmentKeyword = RECRUITMENT_HOST_KEYWORDS.some((keyword) => hostname.includes(keyword));
    const hasCompanyToken = companyTokens.some((token) => hostname.includes(token));

    return hasRecruitmentKeyword && hasCompanyToken;
  } catch {
    return false;
  }
}

function hasJobDetailPattern(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase().replace(/\/+$/, "");
    return LISTING_SEGMENTS.some((segment) => pathname.startsWith(`${segment}/`) && pathname !== segment);
  } catch {
    return false;
  }
}

function getParentListingUrl(url: string): string | null {
  const parsed = new URL(url);
  const pathname = parsed.pathname.toLowerCase().replace(/\/+$/, "");
  const segment = LISTING_SEGMENTS.find((item) => pathname.startsWith(`${item}/`) && pathname !== item);

  if (!segment) {
    return null;
  }

  parsed.pathname = segment;
  parsed.search = "";
  parsed.hash = "";

  return parsed.toString();
}

async function normalizeDiscoveredUrl(url: string): Promise<string> {
  const normalizedUrl = normalizeStoredUrl(url);
  const parentListingUrl = getParentListingUrl(normalizedUrl);

  if (!parentListingUrl) {
    return normalizedUrl;
  }

  const parentResult = await testLightweightUrl(parentListingUrl);

  if (!parentResult.ok) {
    return normalizedUrl;
  }

  return normalizeStoredUrl(parentResult.finalUrl);
}

async function finalizeCandidateUrl(
  candidateUrl: string,
  startUrl: string,
  companyTokens: string[],
  options?: { checkSoft404Title?: boolean }
): Promise<FinalizedCandidate | null> {
  if (isFileLikeUrl(candidateUrl)) {
    return null;
  }

  const atsProvider = detectAtsProvider(candidateUrl);
  const recruitmentDomainSignal = isRecruitmentDomain(candidateUrl, companyTokens);
  const sameRoot = isSameRootDomain(candidateUrl, startUrl);

  if (!sameRoot && !atsProvider && !recruitmentDomainSignal) {
    return null;
  }

  const probe = await testLightweightUrl(candidateUrl);

  if (!probe.ok) {
    return null;
  }

  const finalUrl = normalizeStoredUrl(probe.finalUrl);

  if (options?.checkSoft404Title && !atsProvider) {
    try {
      const page = await fetchHtmlPage(finalUrl);
      assertNotSoft404(page.html);
    } catch {
      return null;
    }
  }

  const normalizedJobsUrl = atsProvider ? finalUrl : await normalizeDiscoveredUrl(finalUrl);

  return {
    jobsUrl: normalizedJobsUrl,
    platform: atsProvider ?? detectAtsProvider(normalizedJobsUrl),
  };
}

function extractLinks(html: string, baseUrl: string, companyTokens: string[]): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();
  const anchorRegex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;

  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1] ?? "";
    const text = stripHtml(match[2] ?? "");
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
      recruitmentDomainSignal: isRecruitmentDomain(normalizedUrl, companyTokens),
    });
  }

  return links;
}

function extractFooterHtml(html: string): string {
  const lower = html.toLowerCase();

  const start = lower.indexOf("<footer");
  if (start === -1) return "";

  const end = lower.indexOf("</footer>", start);
  if (end === -1) return "";

  return html.slice(start, end + "</footer>".length);
}

function prioritizeSameDomainLinks(links: ExtractedLink[], rootUrl: string): ExtractedLink[] {
  return links
    .filter((link) => isSameRootDomain(link.url, rootUrl))
    .sort((left, right) => {
      const leftScore = Number(left.strongSignal) * 4 + Number(left.aboutSignal) * 2 + Number(left.weakSignal);
      const rightScore = Number(right.strongSignal) * 4 + Number(right.aboutSignal) * 2 + Number(right.weakSignal);
      return rightScore - leftScore;
    })
    .slice(0, MAX_LINKS_PER_PAGE);
}

function assessPageSignals(
  current: QueueItem,
  finalPageUrl: string,
  pageText: string,
  links: ExtractedLink[]
): { isJobPage: boolean; hasAdditionalSignals: boolean } {
  const weakOnUrl = containsWeakKeyword(finalPageUrl);
  const weakOnPage = containsWeakKeyword(pageText);
  const strongLinkCount = links.filter((link) => link.strongSignal).length;
  const jobPatternLinkCount = links.filter((link) => link.strongSignal || hasJobDetailPattern(link.url)).length;
  const strongSignalsOnPage = containsStrongKeyword(pageText) || strongLinkCount > 0;
  const hasAdditionalSignals = strongSignalsOnPage || jobPatternLinkCount >= 2;
  const weakSignal = current.signalStrength === "weak" || weakOnUrl || weakOnPage;
  const directStrongSignal = current.signalStrength === "strong" || containsStrongKeyword(finalPageUrl);
  const falsePositive = hasFalsePositiveHint(finalPageUrl) && !directStrongSignal;
  const hasJobDetailLinks = links.some(link => hasJobDetailPattern(link.url));

  if (!hasJobDetailLinks && current.depth === 0) {
    return {
      isJobPage: false,
      hasAdditionalSignals
    };
  }

  return {
    isJobPage: !falsePositive && (directStrongSignal || (weakSignal && hasAdditionalSignals)),
    hasAdditionalSignals,
  };
}

async function findExternalCandidate(
  links: ExtractedLink[],
  startUrl: string,
  companyTokens: string[],
  allowWeakMatch: boolean
): Promise<FinalizedCandidate | null> {
  const prioritizedCandidates = links
    .filter(
      (link) =>
        !isSameRootDomain(link.url, startUrl) &&
        (link.atsProvider || link.recruitmentDomainSignal) &&
        (link.strongSignal || (allowWeakMatch && link.weakSignal))
    )
    .sort((left, right) => Number(right.strongSignal) - Number(left.strongSignal));

  for (const link of prioritizedCandidates) {
    const finalized = await finalizeCandidateUrl(link.url, startUrl, companyTokens);

    if (finalized) {
      return finalized;
    }
  }

  return null;
}

async function inspectFooterForJobPage(startUrl: string): Promise<{
  attempt: DiscoveryAttempt;
  jobsUrl: string | null;
  platform: string | null;
}> {
  const startedAt = Date.now();
  const companyTokens = getCompanyTokens(startUrl);

  try {
    const page = await fetchHtmlPage(startUrl);
    const finalPageUrl = normalizeStoredUrl(page.finalUrl);

    const footerHtml = extractFooterHtml(page.html);

    const footerLinks = footerHtml
      ? extractLinks(footerHtml, finalPageUrl, companyTokens)
      : [];

    const allLinks = extractLinks(page.html, finalPageUrl, companyTokens);

    const links = [
      ...footerLinks.map((l) => ({ ...l, source: "footer" as const })),
      ...allLinks.map((l) => ({ ...l, source: "html" as const })),
    ];

    // 🔥 1. External candidates (ATS etc.)
    const externalCandidate = await findExternalCandidate(
      links,
      startUrl,
      companyTokens,
      true
    );

    console.log(externalCandidate)

    if (
      externalCandidate &&
      !hasFalsePositiveHint(externalCandidate.jobsUrl)
    ) {
      return {
        attempt: {
          method: "crawl",
          status: "found",
          foundUrl: externalCandidate.jobsUrl,
          durationMs: Date.now() - startedAt,
          message: "Found external jobs candidate (footer/html)",
        },
        jobsUrl: externalCandidate.jobsUrl,
        platform: externalCandidate.platform,
      };
    }
    console.log(externalCandidate)

    // 🔥 2. Same-domain candidates (FIXED FILTER)
    const sameDomainCandidates = prioritizeSameDomainLinks(
      links,
      startUrl
    ).filter((link) => {
      const combined = `${link.url} ${link.text}`;

      // ❌ Remove blog/news/etc
      if (hasFalsePositiveHint(combined)) return false;

      return (
        link.strongSignal ||
        link.atsProvider || // ATS always allowed
        (link.weakSignal && !link.aboutSignal)
      );
    });

    console.log("Filtered candidates:", sameDomainCandidates);

    // 🔥 3. Finalize candidates safely
    for (const link of sameDomainCandidates) {
      const finalized = await finalizeCandidateUrl(
        link.url,
        startUrl,
        companyTokens
      );

      if (
        finalized &&
        !hasFalsePositiveHint(finalized.jobsUrl)
      ) {
        return {
          attempt: {
            method: "crawl",
            status: "found",
            foundUrl: finalized.jobsUrl,
            durationMs: Date.now() - startedAt,
            message: "Found same-domain jobs candidate",
          },
          jobsUrl: finalized.jobsUrl,
          platform: finalized.platform,
        };
      }
    }

    return {
      attempt: {
        method: "crawl",
        status: "not_found",
        foundUrl: null,
        durationMs: Date.now() - startedAt,
        message: "No job links found",
      },
      jobsUrl: null,
      platform: null,
    };
  } catch {
    return {
      attempt: {
        method: "crawl",
        status: "error",
        foundUrl: null,
        durationMs: Date.now() - startedAt,
        message: "Footer inspection failed",
      },
      jobsUrl: null,
      platform: null,
    };
  }
}
async function crawlForJobPage(startUrl: string): Promise<{
  attempt: DiscoveryAttempt;
  jobsUrl: string | null;
  platform: string | null;
}> {
  const startedAt = Date.now();
  const companyTokens = getCompanyTokens(startUrl);
  const queue: QueueItem[] = [
    {
      url: normalizeStoredUrl(startUrl),
      depth: 0,
      signalStrength: containsStrongKeyword(startUrl)
        ? "strong"
        : containsWeakKeyword(startUrl)
          ? "weak"
          : "none",
    },
  ];
  const visited = new Set<string>();
  let visitedPages = 0;
  let fetchErrors = 0;

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      break;
    }

    const normalizedCurrentUrl = normalizeStoredUrl(current.url);

    if (visited.has(normalizedCurrentUrl) || isFileLikeUrl(normalizedCurrentUrl)) {
      continue;
    }

    visited.add(normalizedCurrentUrl);
    visitedPages += 1;

    try {
      const directAtsProvider = detectAtsProvider(normalizedCurrentUrl);

      if (directAtsProvider) {
        return {
          attempt: {
            method: "crawl",
            status: "found",
            foundUrl: normalizedCurrentUrl,
            durationMs: Date.now() - startedAt,
            message: `Resolved directly to ${directAtsProvider}`,
          },
          jobsUrl: normalizedCurrentUrl,
          platform: directAtsProvider,
        };
      }

      const page = await fetchHtmlPage(normalizedCurrentUrl);
      const finalPageUrl = normalizeStoredUrl(page.finalUrl);
      const pageText = stripHtml(page.html);
      const links = extractLinks(page.html, finalPageUrl, companyTokens);
      const pageAssessment = assessPageSignals(current, finalPageUrl, pageText, links);
      const strongJobLink = links.find(link => link.strongSignal);

      if (strongJobLink) {
        const finalized = await finalizeCandidateUrl(
          strongJobLink.url,
          startUrl,
          companyTokens
        );

        if (finalized) {
          return {
            attempt: {
              method: "crawl",
              status: "found",
              foundUrl: finalized.jobsUrl,
              durationMs: Date.now() - startedAt,
              message: "Found jobs page via strong link",
            },
            jobsUrl: finalized.jobsUrl,
            platform: finalized.platform,
          };
        }
      }

      visited.add(finalPageUrl);

      const redirectedAtsProvider = detectAtsProvider(finalPageUrl);

      if (redirectedAtsProvider) {
        return {
          attempt: {
            method: "crawl",
            status: "found",
            foundUrl: finalPageUrl,
            durationMs: Date.now() - startedAt,
            message: `Redirected to ${redirectedAtsProvider}`,
          },
          jobsUrl: finalPageUrl,
          platform: redirectedAtsProvider,
        };
      }

      const externalCandidate = await findExternalCandidate(
        links,
        startUrl,
        companyTokens,
        pageAssessment.hasAdditionalSignals || isAboutPage(finalPageUrl)
      );

      if (externalCandidate) {
        return {
          attempt: {
            method: "crawl",
            status: "found",
            foundUrl: externalCandidate.jobsUrl,
            durationMs: Date.now() - startedAt,
            message: "Found external recruitment candidate during crawl",
          },
          jobsUrl: externalCandidate.jobsUrl,
          platform: externalCandidate.platform,
        };
      }

      if (pageAssessment.isJobPage) {
        const normalizedJobsUrl = await normalizeDiscoveredUrl(finalPageUrl);
        const atsLink = links.find((link) => Boolean(link.atsProvider) && (link.strongSignal || link.weakSignal));

        if (atsLink?.atsProvider) {
          const finalizedAtsLink = await finalizeCandidateUrl(atsLink.url, startUrl, companyTokens);

          if (finalizedAtsLink) {
            return {
              attempt: {
                method: "crawl",
                status: "found",
                foundUrl: finalizedAtsLink.jobsUrl,
                durationMs: Date.now() - startedAt,
                message: `Found ATS link on jobs page: ${atsLink.atsProvider}`,
              },
              jobsUrl: finalizedAtsLink.jobsUrl,
              platform: finalizedAtsLink.platform,
            };
          }
        }

        return {
          attempt: {
            method: "crawl",
            status: "found",
            foundUrl: normalizedJobsUrl,
            durationMs: Date.now() - startedAt,
            message: `Found jobs page during crawl at depth ${current.depth}`,
          },
          jobsUrl: normalizedJobsUrl,
          platform: null,
        };
      }

      if (current.depth >= MAX_CRAWL_DEPTH) {
        continue;
      }

      const nextLinks = prioritizeSameDomainLinks(links, startUrl);

      for (const link of nextLinks) {
        if (visited.has(link.url)) {
          continue;
        }

        queue.push({
          url: link.url,
          depth: current.depth + 1,
          signalStrength: link.strongSignal ? "strong" : link.weakSignal ? "weak" : "none",
        });
      }
    } catch {
      fetchErrors += 1;
    }
  }

  return {
    attempt: {
      method: "crawl",
      status: visitedPages > 0 && fetchErrors < visitedPages ? "not_found" : "error",
      foundUrl: null,
      durationMs: Date.now() - startedAt,
      message:
        visitedPages === 0
          ? "No pages were crawled"
          : `Visited ${visitedPages} page(s), fetch errors: ${fetchErrors}`,
    },
    jobsUrl: null,
    platform: null,
  };
}

async function discoverFromSitemapCandidates(startUrl: string): Promise<{
  attempt: DiscoveryAttempt;
  jobsUrl: string | null;
  platform: string | null;
}> {
  const startedAt = Date.now();
  const companyTokens = getCompanyTokens(startUrl);
  const sitemapCandidates = await discoverFromSitemap(startUrl);

  for (const candidateUrl of sitemapCandidates) {
    const finalized = await finalizeCandidateUrl(candidateUrl, startUrl, companyTokens);

    if (finalized) {
      return {
        attempt: {
          method: "sitemap",
          status: "found",
          foundUrl: finalized.jobsUrl,
          durationMs: Date.now() - startedAt,
          message: "Matched job URL from sitemap.xml",
        },
        jobsUrl: finalized.jobsUrl,
        platform: finalized.platform,
      };
    }
  }

  return {
    attempt: {
      method: "sitemap",
      status: "not_found",
      foundUrl: null,
      durationMs: Date.now() - startedAt,
      message:
        sitemapCandidates.length > 0
          ? `Sitemap returned ${sitemapCandidates.length} candidate URL(s) but none validated`
          : "No job-related sitemap URLs found",
    },
    jobsUrl: null,
    platform: null,
  };
}
async function guessCommonPaths(startUrl: string): Promise<{
  attempt: DiscoveryAttempt;
  jobsUrl: string | null;
  platform: string | null;
}> {
  const startedAt = Date.now();
  const companyTokens = getCompanyTokens(startUrl);
  const origin = new URL(startUrl).origin;
  const failures: string[] = [];

  for (const path of FALLBACK_PATHS) {
    const candidateUrl = new URL(path, origin).toString();
    const finalized = await finalizeCandidateUrl(candidateUrl, startUrl, companyTokens, { checkSoft404Title: true });

    if (finalized) {
      return {
        attempt: {
          method: "path_guess",
          status: "found",
          foundUrl: finalized.jobsUrl,
          durationMs: Date.now() - startedAt,
          message: `Matched fallback path ${path}`,
        },
        jobsUrl: finalized.jobsUrl,
        platform: finalized.platform,
      };
    }

    failures.push(`${path}: miss`);
  }

  return {
    attempt: {
      method: "path_guess",
      status: "not_found",
      foundUrl: null,
      durationMs: Date.now() - startedAt,
      message:
        failures.length > 0
          ? failures.join(" | ")
          : "No fallback paths matched",
    },
    jobsUrl: null,
    platform: null,
  };
}

async function guessDutchRecruitmentDomains(startUrl: string): Promise<FinalizedCandidate | null> {
  const companyTokens = getCompanyTokens(startUrl);
  const companyLabel = getRootDomainLabel(startUrl).toLowerCase();
  const compactLabel = companyLabel.replace(/[^a-z0-9]/gi, "");
  const dashedLabel = companyLabel.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  const candidateBases = [
    `https://werkenbij${compactLabel}.nl`,
    `https://werkenbij-${compactLabel}.nl`,
    dashedLabel ? `https://werkenbij-${dashedLabel}.nl` : null,
  ].filter((value): value is string => Boolean(value));
  const candidateUrls = new Set<string>();

  for (const baseUrl of candidateBases) {
    candidateUrls.add(baseUrl);

    for (const path of ["/vacatures", "/jobs", "/careers", "/werken-bij", "/werkenbij"]) {
      candidateUrls.add(new URL(path, `${baseUrl}/`).toString());
    }
  }

  for (const candidateUrl of candidateUrls) {
    const finalized = await finalizeCandidateUrl(candidateUrl, startUrl, companyTokens, { checkSoft404Title: true });

    if (finalized) {
      return finalized;
    }
  }

  return null;
}

export async function discoverByHeuristics(website: string): Promise<JobPageDiscoveryResult> {
  const reachability = await resolveReachableUrl(website);

  if (!reachability.reachable || !reachability.finalUrl) {
    return {
      status: reachability.statusCode && reachability.statusCode < 500 ? "not_found" : "error",
      jobsUrl: null,
      method: null,
      platform: null,
      attempts: [
        {
          method: "crawl",
          status: reachability.statusCode && reachability.statusCode < 500 ? "not_found" : "error",
          foundUrl: null,
          durationMs: 0,
          message: `Website unreachable: ${reachability.message}`,
        },
      ],
    };
  }

  const crawlResult = await crawlForJobPage(reachability.finalUrl);

  if (crawlResult.attempt.status === "found") {
    return {
      status: "found",
      jobsUrl: crawlResult.jobsUrl,
      method: crawlResult.attempt.method,
      platform: crawlResult.platform,
      attempts: [crawlResult.attempt],
    };
  }

  const footerResult = await inspectFooterForJobPage(reachability.finalUrl);

  if (footerResult.attempt.status === "found") {
    return {
      status: "found",
      jobsUrl: footerResult.jobsUrl,
      method: footerResult.attempt.method,
      platform: footerResult.platform,
      attempts: [crawlResult.attempt, footerResult.attempt],
    };
  }

  const sitemapResult = await discoverFromSitemapCandidates(reachability.finalUrl);

  if (sitemapResult.attempt.status === "found") {
    return {
      status: "found",
      jobsUrl: sitemapResult.jobsUrl,
      method: sitemapResult.attempt.method,
      platform: sitemapResult.platform,
      attempts: [crawlResult.attempt, footerResult.attempt, sitemapResult.attempt],
    };
  }

  const fallbackResult = await guessCommonPaths(reachability.finalUrl);

  if (fallbackResult.attempt.status === "found") {
    return {
      status: "found",
      jobsUrl: fallbackResult.jobsUrl,
      method: fallbackResult.attempt.method,
      platform: fallbackResult.platform,
      attempts: [crawlResult.attempt, footerResult.attempt, sitemapResult.attempt, fallbackResult.attempt],
    };
  }

  const dutchRecruitmentResult = await guessDutchRecruitmentDomains(reachability.finalUrl);

  if (dutchRecruitmentResult) {
    return {
      status: "found",
      jobsUrl: dutchRecruitmentResult.jobsUrl,
      method: "path_guess",
      platform: dutchRecruitmentResult.platform,
      attempts: [
        crawlResult.attempt,
        footerResult.attempt,
        sitemapResult.attempt,
        fallbackResult.attempt,
        {
          method: "path_guess",
          status: "found",
          foundUrl: dutchRecruitmentResult.jobsUrl,
          durationMs: 0,
          message: "Matched generated Dutch recruitment domain",
        },
      ],
    };
  }

  return {
    status:
      crawlResult.attempt.status === "error" &&
        fallbackResult.attempt.status === "not_found"
        ? "error"
        : fallbackResult.attempt.status,
    jobsUrl: null,
    method: null,
    platform: null,
    attempts: [crawlResult.attempt, footerResult.attempt, sitemapResult.attempt, fallbackResult.attempt],
  };
}








