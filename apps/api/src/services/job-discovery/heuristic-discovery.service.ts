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
import { logDiscovery } from "./discovery-logger";
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

export type Candidate = {
  url: string;
  source: "subdomain" | "path" | "crawl" | "sitemap" | "html";
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
  "kom-werken",
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

const SCORE_WEIGHTS = {
  strongKeyword: 10,
  weakKeyword: 3,
  falsePositiveWithoutJobKeyword: -15,
  overviewBonus: 5,
  businessNameBonus: 3,
  atsBonus: 5,
  detailPenalty: -5,
  source: {
    subdomain: 8,
    path: 6,
    sitemap: 5,
    html: 4,
    crawl: 2,
  } satisfies Record<Candidate["source"], number>,
  minimumAcceptedScore: 5,
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

function getKeywordMatches(value: string, keywords: readonly string[]): string[] {
  const normalized = value.toLowerCase();
  return keywords.filter((keyword) => normalized.includes(keyword));
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
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase().replace(/\/+$/, "");
    const segment = LISTING_SEGMENTS.find((item) => pathname.startsWith(`${item}/`) && pathname !== item);

    if (segment) {
      return true;
    }

    const pathSegments = pathname.split("/").filter(Boolean);
    const lastSegment = pathSegments.at(-1) ?? "";
    const parentSegment = pathSegments.length > 1 ? `/${pathSegments[pathSegments.length - 2]}` : "";
    const slugLike = lastSegment.split("-").length >= 3;

    return slugLike && LISTING_SEGMENTS.includes(parentSegment);
  } catch {
    return false;
  }
}

function isLikelyJobOverviewPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase().replace(/\/+$/, "");
    const pathSegments = pathname.split("/").filter(Boolean);
    const lastSegment = pathSegments.at(-1) ?? "";

    if (!lastSegment || hasJobDetailPattern(url)) {
      return false;
    }

    return STRONG_JOB_KEYWORDS.includes(lastSegment) || LISTING_SEGMENTS.includes(`/${lastSegment}`);
  } catch {
    return false;
  }
}

function normalizeBusinessNameTokens(businessName: string): string[] {
  const lower = businessName.toLowerCase();
  const splitTokens = lower.split(/[^a-z0-9]+/i).filter((token) => token.length >= 3);
  const compact = lower.replace(/[^a-z0-9]/gi, "");

  return compact.length >= 3 ? [...new Set([...splitTokens, compact])] : [...new Set(splitTokens)];
}

export function scoreCandidate(candidate: Candidate, businessName: string): number {
  const normalizedUrl = candidate.url.toLowerCase();
  const strongMatches = getKeywordMatches(normalizedUrl, STRONG_JOB_KEYWORDS);
  const weakMatches = getKeywordMatches(normalizedUrl, WEAK_JOB_KEYWORDS);
  const falsePositiveMatches = getKeywordMatches(normalizedUrl, FALSE_POSITIVE_PATTERNS);
  const businessTokens = normalizeBusinessNameTokens(businessName);

  let score = 0;

  score += strongMatches.length * SCORE_WEIGHTS.strongKeyword;
  score += weakMatches.length * SCORE_WEIGHTS.weakKeyword;

  if (strongMatches.length === 0 && weakMatches.length === 0 && falsePositiveMatches.length > 0) {
    score += SCORE_WEIGHTS.falsePositiveWithoutJobKeyword;
  }

  if (isLikelyJobOverviewPage(candidate.url)) {
    score += SCORE_WEIGHTS.overviewBonus;
  }

  if (businessTokens.some((token) => normalizedUrl.includes(token))) {
    score += SCORE_WEIGHTS.businessNameBonus;
  }

  if (detectAtsProvider(candidate.url)) {
    score += SCORE_WEIGHTS.atsBonus;
  }

  if (hasJobDetailPattern(candidate.url)) {
    score += SCORE_WEIGHTS.detailPenalty;
  }

  score += SCORE_WEIGHTS.source[candidate.source];

  return score;
}

function explainCandidateScore(candidate: Candidate, businessName: string): string[] {
  const normalizedUrl = candidate.url.toLowerCase();
  const strongMatches = getKeywordMatches(normalizedUrl, STRONG_JOB_KEYWORDS);
  const weakMatches = getKeywordMatches(normalizedUrl, WEAK_JOB_KEYWORDS);
  const falsePositiveMatches = getKeywordMatches(normalizedUrl, FALSE_POSITIVE_PATTERNS);
  const businessTokens = normalizeBusinessNameTokens(businessName);
  const reasons: string[] = [];

  if (strongMatches.length > 0) {
    reasons.push(`strong=${strongMatches.join(",")}`);
  }

  if (weakMatches.length > 0) {
    reasons.push(`weak=${weakMatches.join(",")}`);
  }

  if (strongMatches.length === 0 && weakMatches.length === 0 && falsePositiveMatches.length > 0) {
    reasons.push(`false-positive=${falsePositiveMatches.join(",")}`);
  }

  if (isLikelyJobOverviewPage(candidate.url)) {
    reasons.push("overview");
  }

  if (businessTokens.some((token) => normalizedUrl.includes(token))) {
    reasons.push("business-name");
  }

  const atsProvider = detectAtsProvider(candidate.url);
  if (atsProvider) {
    reasons.push(`ats=${atsProvider}`);
  }

  if (hasJobDetailPattern(candidate.url)) {
    reasons.push("detail-page");
  }

  reasons.push(`source=${candidate.source}`);

  return reasons;
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

  if (start === -1) {
    return "";
  }

  const end = lower.indexOf("</footer>", start);

  if (end === -1) {
    return "";
  }

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
  const hasJobDetailLinks = links.some((link) => hasJobDetailPattern(link.url));

  if (!hasJobDetailLinks && current.depth === 0) {
    return {
      isJobPage: false,
      hasAdditionalSignals,
    };
  }

  return {
    isJobPage: !falsePositive && (directStrongSignal || (weakSignal && hasAdditionalSignals)),
    hasAdditionalSignals,
  };
}

function addCandidate(store: Map<string, Candidate>, candidate: Candidate): void {
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
  source: Candidate["source"],
  startUrl: string
): void {
  for (const link of links) {
    const combined = `${link.url} ${link.text}`;
    const isExternalRecruitment = !isSameRootDomain(link.url, startUrl) && (link.atsProvider || link.recruitmentDomainSignal);
    const hasJobSignal = link.strongSignal || link.weakSignal || hasJobDetailPattern(link.url);
    const hasUsefulAboutSignal = link.aboutSignal && (link.strongSignal || link.weakSignal);

    if (isExternalRecruitment || hasJobSignal || hasUsefulAboutSignal) {
      addCandidate(store, { url: link.url, source });
    } else if (hasFalsePositiveHint(combined) && (link.atsProvider || link.recruitmentDomainSignal)) {
      addCandidate(store, { url: link.url, source });
    }
  }
}

async function inspectFooterForJobPage(startUrl: string): Promise<CandidateCollectionResult> {
  const startedAt = Date.now();
  const companyTokens = getCompanyTokens(startUrl);
  const candidates = new Map<string, Candidate>();

  try {
    const page = await fetchHtmlPage(startUrl);
    const finalPageUrl = normalizeStoredUrl(page.finalUrl);
    const footerHtml = extractFooterHtml(page.html);
    const footerLinks = footerHtml ? extractLinks(footerHtml, finalPageUrl, companyTokens) : [];
    const allLinks = extractLinks(page.html, finalPageUrl, companyTokens);

    addCandidatesFromLinks(candidates, footerLinks, "html", startUrl);
    addCandidatesFromLinks(candidates, allLinks, "html", startUrl);

    return {
      attempt: {
        method: "crawl",
        status: "not_found",
        foundUrl: null,
        durationMs: Date.now() - startedAt,
        message: `Collected ${candidates.size} HTML candidate(s)`,
      },
      candidates: [...candidates.values()],
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
      candidates: [],
    };
  }
}

async function crawlForJobPage(startUrl: string): Promise<CandidateCollectionResult> {
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
  const candidates = new Map<string, Candidate>();
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
        addCandidate(candidates, { url: normalizedCurrentUrl, source: "crawl" });
      }

      const page = await fetchHtmlPage(normalizedCurrentUrl);
      const finalPageUrl = normalizeStoredUrl(page.finalUrl);
      const pageText = stripHtml(page.html);
      const links = extractLinks(page.html, finalPageUrl, companyTokens);
      const pageAssessment = assessPageSignals(current, finalPageUrl, pageText, links);

      visited.add(finalPageUrl);

      if (
        detectAtsProvider(finalPageUrl) ||
        pageAssessment.isJobPage ||
        containsStrongKeyword(finalPageUrl) ||
        containsWeakKeyword(finalPageUrl) ||
        hasJobDetailPattern(finalPageUrl)
      ) {
        addCandidate(candidates, { url: finalPageUrl, source: "crawl" });
      }

      addCandidatesFromLinks(candidates, links, "crawl", startUrl);

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
          : `Visited ${visitedPages} page(s), fetch errors: ${fetchErrors}, candidates: ${candidates.size}`,
    },
    candidates: [...candidates.values()],
  };
}

async function discoverFromSitemapCandidates(startUrl: string): Promise<CandidateCollectionResult> {
  const startedAt = Date.now();

  try {
    const sitemapCandidates = await discoverFromSitemap(startUrl);
    const candidates = sitemapCandidates.map((url) => ({ url, source: "sitemap" as const }));

    return {
      attempt: {
        method: "sitemap",
        status: "not_found",
        foundUrl: null,
        durationMs: Date.now() - startedAt,
        message:
          candidates.length > 0
            ? `Collected ${candidates.length} sitemap candidate(s)`
            : "No job-related sitemap URLs found",
      },
      candidates,
    };
  } catch {
    return {
      attempt: {
        method: "sitemap",
        status: "error",
        foundUrl: null,
        durationMs: Date.now() - startedAt,
        message: "Sitemap discovery failed",
      },
      candidates: [],
    };
  }
}

async function guessCommonPaths(startUrl: string): Promise<CandidateCollectionResult> {
  const startedAt = Date.now();
  const origin = new URL(startUrl).origin;
  const candidates = FALLBACK_PATHS.map((path) => ({
    url: new URL(path, origin).toString(),
    source: "path" as const,
  }));

  return {
    attempt: {
      method: "path_guess",
      status: "not_found",
      foundUrl: null,
      durationMs: Date.now() - startedAt,
      message: `Generated ${candidates.length} fallback path candidate(s)`,
    },
    candidates,
  };
}

async function guessDutchRecruitmentDomains(startUrl: string): Promise<CandidateCollectionResult> {
  const startedAt = Date.now();
  const companyLabel = getRootDomainLabel(startUrl).toLowerCase();
  const compactLabel = companyLabel.replace(/[^a-z0-9]/gi, "");
  const dashedLabel = companyLabel.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  const candidateBases = [
    `https://werkenbij${compactLabel}.nl`,
    `https://werkenbij-${compactLabel}.nl`,
    dashedLabel ? `https://werkenbij-${dashedLabel}.nl` : null,
  ].filter((value): value is string => Boolean(value));
  const candidates = new Map<string, Candidate>();

  for (const baseUrl of candidateBases) {
    addCandidate(candidates, { url: baseUrl, source: "subdomain" });

    for (const path of ["/vacatures", "/jobs", "/careers", "/werken-bij", "/werkenbij"]) {
      addCandidate(candidates, {
        url: new URL(path, `${baseUrl}/`).toString(),
        source: "subdomain",
      });
    }
  }

  return {
    attempt: {
      method: "path_guess",
      status: "not_found",
      foundUrl: null,
      durationMs: Date.now() - startedAt,
      message: `Generated ${candidates.size} recruitment subdomain candidate(s)`,
    },
    candidates: [...candidates.values()],
  };
}

function shouldCheckSoft404(candidate: Candidate): boolean {
  return candidate.source === "path" || candidate.source === "subdomain";
}

function mapSourceToMethod(source: Candidate["source"]): DiscoveryMethod {
  if (source === "sitemap") {
    return "sitemap";
  }

  if (source === "path" || source === "subdomain") {
    return "path_guess";
  }

  return "crawl";
}

async function selectBestCandidate(startUrl: string, candidates: Candidate[]): Promise<CandidateSelection> {
  const companyTokens = getCompanyTokens(startUrl);
  const businessName = getRootDomainLabel(startUrl);
  const scoredCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate, businessName),
      reasons: explainCandidateScore(candidate, businessName),
    }))
    .sort((left, right) => right.score - left.score);

  const topCandidates = scoredCandidates.slice(0, 5).map((candidate) => ({
    url: candidate.url,
    source: candidate.source,
    score: candidate.score,
    reasons: candidate.reasons,
  }));

  console.log("Job discovery top candidates:", topCandidates);
  logDiscovery("results", {
    website: startUrl,
    candidateCount: scoredCandidates.length,
    topCandidates,
  });

  const bestCandidate = scoredCandidates[0] ?? null;

  if (!bestCandidate || bestCandidate.score < SCORE_WEIGHTS.minimumAcceptedScore) {
    logDiscovery("low-confidence", {
      website: startUrl,
      minimumAcceptedScore: SCORE_WEIGHTS.minimumAcceptedScore,
      bestCandidate,
      topCandidates,
      reason: !bestCandidate ? "no-candidates" : "score-below-threshold",
    });

    return {
      finalized: null,
      selected: bestCandidate,
      scoredCandidates,
    };
  }

  const seenUrls = new Set<string>();

  for (const candidate of scoredCandidates) {
    if (candidate.score < SCORE_WEIGHTS.minimumAcceptedScore) {
      break;
    }

    const normalizedUrl = normalizeStoredUrl(candidate.url);

    if (seenUrls.has(normalizedUrl)) {
      continue;
    }

    seenUrls.add(normalizedUrl);

    const finalized = await finalizeCandidateUrl(
      candidate.url,
      startUrl,
      companyTokens,
      { checkSoft404Title: shouldCheckSoft404(candidate) }
    );

    if (finalized) {
      return {
        finalized,
        selected: candidate,
        scoredCandidates,
      };
    }
  }

  logDiscovery("low-confidence", {
    website: startUrl,
    minimumAcceptedScore: SCORE_WEIGHTS.minimumAcceptedScore,
    bestCandidate,
    topCandidates,
    reason: "candidate-finalization-failed",
  });

  return {
    finalized: null,
    selected: bestCandidate,
    scoredCandidates,
  };
}

function updateAttemptWithSelection(
  attempt: DiscoveryAttempt,
  sources: Candidate["source"][],
  selected: ScoredCandidate | null,
  finalized: FinalizedCandidate | null
): DiscoveryAttempt {
  if (!selected || !finalized || !sources.includes(selected.source)) {
    return attempt;
  }

  return {
    ...attempt,
    status: "found",
    foundUrl: finalized.jobsUrl,
    message: `${attempt.message} | selected ${selected.source} candidate with score ${selected.score}`,
  };
}

export async function discoverByHeuristics(website: string): Promise<JobPageDiscoveryResult> {
  const reachability = await resolveReachableUrl(website);
  const unreachableStatus =
    reachability.statusCode && reachability.statusCode < 500 ? "not_found" : "error";

  if (!reachability.reachable || !reachability.finalUrl) {
    if (unreachableStatus === "error") {
      logDiscovery("errors", {
        website,
        statusCode: reachability.statusCode ?? null,
        message: reachability.message,
        reason: "website-unreachable",
      });
    }

    return {
      status: unreachableStatus,
      jobsUrl: null,
      method: null,
      platform: null,
      attempts: [
        {
          method: "crawl",
          status: unreachableStatus,
          foundUrl: null,
          durationMs: 0,
          message: `Website unreachable: ${reachability.message}`,
        },
      ],
    };
  }

  const crawlResult = await crawlForJobPage(reachability.finalUrl);
  const htmlResult = await inspectFooterForJobPage(reachability.finalUrl);
  const sitemapResult = await discoverFromSitemapCandidates(reachability.finalUrl);
  const fallbackResult = await guessCommonPaths(reachability.finalUrl);
  const subdomainResult = await guessDutchRecruitmentDomains(reachability.finalUrl);

  const allCandidates = [
    ...crawlResult.candidates,
    ...htmlResult.candidates,
    ...sitemapResult.candidates,
    ...fallbackResult.candidates,
    ...subdomainResult.candidates,
  ];

  const selection = await selectBestCandidate(reachability.finalUrl, allCandidates);
  const attempts = [
    updateAttemptWithSelection(crawlResult.attempt, ["crawl"], selection.selected, selection.finalized),
    updateAttemptWithSelection(htmlResult.attempt, ["html"], selection.selected, selection.finalized),
    updateAttemptWithSelection(sitemapResult.attempt, ["sitemap"], selection.selected, selection.finalized),
    updateAttemptWithSelection(fallbackResult.attempt, ["path"], selection.selected, selection.finalized),
    updateAttemptWithSelection(subdomainResult.attempt, ["subdomain"], selection.selected, selection.finalized),
  ];

  if (selection.finalized && selection.selected) {
    return {
      status: "found",
      jobsUrl: selection.finalized.jobsUrl,
      method: mapSourceToMethod(selection.selected.source),
      platform: selection.finalized.platform,
      attempts,
    };
  }

  if (allCandidates.length === 0 && attempts.every((attempt) => attempt.status === "error")) {
    logDiscovery("errors", {
      website: reachability.finalUrl,
      attempts,
      reason: "all-discovery-methods-failed",
    });
  }

  return {
    status: allCandidates.length === 0 && attempts.every((attempt) => attempt.status === "error") ? "error" : "not_found",
    jobsUrl: null,
    method: null,
    platform: null,
    attempts,
  };
}
