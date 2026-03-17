import axios, { AxiosError } from "axios";

export const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

const USER_AGENT = "jobsonmap-discovery-bot/1.0 (+https://jobsonmap.local)";
const MAX_REDIRECTS = 5;
const HEAD_UNSUPPORTED_STATUSES = new Set([403, 405, 501]);

export const discoveryHttpClient = axios.create({
  timeout: 10000,
  maxRedirects: 5,
  validateStatus: () => true,
  headers: {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9,nl;q=0.8",
    "accept-encoding": "gzip, deflate, br",
    "connection": "keep-alive",
  },
});

type LightweightCheckResult = {
  ok: boolean;
  statusCode: number | null;
  finalUrl: string;
  message: string;
};

type ReachabilityResult = {
  reachable: boolean;
  statusCode: number | null;
  finalUrl: string | null;
  message: string;
};

type HtmlPageResult = {
  statusCode: number;
  finalUrl: string;
  html: string;
};

function getFinalUrl(responseUrl: string | undefined, fallbackUrl: string): string {
  return responseUrl ?? fallbackUrl;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.code === "ECONNABORTED") {
      return "Request timed out";
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

async function performHeadRequest(url: string): Promise<LightweightCheckResult> {
  const response = await discoveryHttpClient.head(url);

  return {
    ok: response.status >= 200 && response.status < 400,
    statusCode: response.status,
    finalUrl: getFinalUrl(response.request?.res?.responseUrl, url),
    message: `HEAD ${response.status}`,
  };
}

async function performStreamingGet(url: string): Promise<LightweightCheckResult> {
  const response = await discoveryHttpClient.get(url, {
    responseType: "stream",
  });

  const stream = response.data as { destroy?: () => void } | undefined;
  stream?.destroy?.();

  return {
    ok: response.status >= 200 && response.status < 400,
    statusCode: response.status,
    finalUrl: getFinalUrl(response.request?.res?.responseUrl, url),
    message: `GET ${response.status}`,
  };
}

export async function testLightweightUrl(url: string): Promise<LightweightCheckResult> {
  try {
    const headResult = await performHeadRequest(url);

    if (headResult.ok || !HEAD_UNSUPPORTED_STATUSES.has(headResult.statusCode ?? 0)) {
      return headResult;
    }
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      finalUrl: url,
      message: toErrorMessage(error),
    };
  }

  try {
    return await performStreamingGet(url);
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      finalUrl: url,
      message: toErrorMessage(error),
    };
  }
}

export async function resolveReachableUrl(url: string): Promise<ReachabilityResult> {
  const result = await testLightweightUrl(url);

  return {
    reachable: result.ok,
    statusCode: result.statusCode,
    finalUrl: result.ok ? result.finalUrl : null,
    message: result.message,
  };
}

export async function fetchHtmlPage(url: string): Promise<HtmlPageResult> {
  const response = await discoveryHttpClient.get<string>(url, {
    responseType: "text",
  });

  const html = typeof response.data === "string" ? response.data : "";

  if (response.status < 200 || response.status >= 400) {
    throw new Error(`GET ${response.status}`);
  }

  return {
    statusCode: response.status,
    finalUrl: getFinalUrl(response.request?.res?.responseUrl, url),
    html,
  };
}
