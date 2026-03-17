const DEFAULT_PROTOCOL = "https://";
const FILE_URL_PATTERN = /\.(png|jpg|jpeg|svg|pdf)(?:[?#].*)?$/i;

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

function getApexDomain(hostname: string): string {
  const normalized = normalizeHostname(hostname);
  const parts = normalized.split(".").filter(Boolean);

  if (parts.length <= 2) {
    return normalized;
  }

  const topLevel = parts.at(-1) ?? "";
  const secondLevel = parts.at(-2) ?? "";
  const isCountryCode = topLevel.length === 2;
  const isCompoundSecondLevel = secondLevel.length <= 3;

  if (isCountryCode && isCompoundSecondLevel && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }

  return parts.slice(-2).join(".");
}

export function ensureWebsiteProtocol(website: string): string {
  const trimmed = website.trim();

  if (!trimmed) {
    throw new Error("Website is empty");
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `${DEFAULT_PROTOCOL}${trimmed}`;
}

export function parseWebsiteUrl(website: string): URL {
  return new URL(ensureWebsiteProtocol(website));
}

export function getRootDomain(urlOrWebsite: string): string {
  return getApexDomain(parseWebsiteUrl(urlOrWebsite).hostname);
}

export function getRootDomainLabel(urlOrWebsite: string): string {
  const apexDomain = getRootDomain(urlOrWebsite);
  return apexDomain.split(".")[0] ?? apexDomain;
}

export function getNormalizedHostname(urlOrWebsite: string): string {
  return normalizeHostname(parseWebsiteUrl(urlOrWebsite).hostname);
}

export function isSameRootDomain(candidateUrl: string, baseUrl: string): boolean {
  try {
    return getRootDomain(candidateUrl) === getRootDomain(baseUrl);
  } catch {
    return false;
  }
}

export function resolveAbsoluteUrl(href: string, baseUrl: string): string | null {
  const trimmed = href.trim();

  if (!trimmed || /^(mailto:|tel:|javascript:|#)/i.test(trimmed)) {
    return null;
  }

  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

export function isFileLikeUrl(url: string): boolean {
  try {
    const normalized = new URL(url).toString();
    return FILE_URL_PATTERN.test(normalized);
  } catch {
    return FILE_URL_PATTERN.test(url);
  }
}

export function normalizeStoredUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";

  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  }

  return parsed.toString();
}
