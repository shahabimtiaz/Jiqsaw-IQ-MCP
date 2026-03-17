// ============================================================
// HTTP helper – wraps native fetch with retries, rate-limit
// back-off, and optional caching via node-cache
// ============================================================

import NodeCache from "node-cache";

// Simple in-memory cache (TTL in seconds)
const cache = new NodeCache({ stdTTL: 120, checkperiod: 60 });

interface FetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  cacheTTL?: number; // seconds, 0 = no cache
  cacheKey?: string;
  maxRetries?: number;
  timeoutMs?: number; // request timeout in ms (default 30000)
}

interface FetchResult<T> {
  data: T;
  /** Next-page URL parsed from a Link header, or null if this is the last page. */
  nextUrl: string | null;
}

// ── Internal implementation ────────────────────────────────────────────────────

async function apiFetchRaw<T = unknown>(
  url: string,
  opts: FetchOptions = {}
): Promise<FetchResult<T>> {
  const {
    method = "GET",
    headers = {},
    body,
    cacheTTL = 0,
    cacheKey,
    maxRetries = 2,
    timeoutMs = 30_000,
  } = opts;

  const key = cacheKey || `${method}:${url}:${JSON.stringify(body || "")}`;
  if (cacheTTL > 0) {
    const cached = cache.get<FetchResult<T>>(key);
    if (cached !== undefined) return cached;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const fetchOpts: RequestInit = {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        signal: controller.signal,
      };
      if (body && method !== "GET") {
        fetchOpts.body = JSON.stringify(body);
      }

      const res = await fetch(url, fetchOpts);
      clearTimeout(timer);

      // Rate-limit: back off and retry
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
        console.warn(`[apiFetch] 429 rate-limited, retrying after ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(buildErrorMessage(res.status, res.statusText, url, text));
      }

      const data = (await res.json()) as T;

      // Parse Shopify-style Link header for cursor-based pagination.
      // Format: <https://store.myshopify.com/...?page_info=abc>; rel="next"
      const linkHeader = res.headers.get("Link") ?? "";
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      const nextUrl = nextMatch ? nextMatch[1] : null;

      const result: FetchResult<T> = { data, nextUrl };
      if (cacheTTL > 0) {
        cache.set(key, result, cacheTTL);
      }

      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // 4xx errors are client errors — the same request won't succeed on retry.
      // Re-throw immediately so callers (e.g. withTokenRefresh) can act without
      // waiting through exponential back-off delays.
      // 429 is already handled above with its own Retry-After loop.
      if (/^HTTP 4\d\d /.test(lastError.message) && !lastError.message.startsWith("HTTP 429")) {
        throw lastError;
      }
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s, … (for network errors and 5xx only)
        await sleep(1000 * Math.pow(2, attempt));
      }
    }
  }

  throw lastError ?? new Error("Unknown fetch error");
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Standard fetch – returns the response body only.
 * Use this for all non-paginated requests.
 */
export async function apiFetch<T = unknown>(
  url: string,
  opts: FetchOptions = {}
): Promise<T> {
  return (await apiFetchRaw<T>(url, opts)).data;
}

/**
 * Paginated fetch – returns the response body AND the next-page URL parsed
 * from the Link header. Use this when iterating through Shopify REST pages.
 *
 * Example:
 *   let url: string | null = "https://store.myshopify.com/.../orders.json?limit=250";
 *   while (url) {
 *     const { data, nextUrl } = await apiFetchPaginated(url, opts);
 *     // process data.orders …
 *     url = nextUrl;
 *   }
 */
export async function apiFetchPaginated<T = unknown>(
  url: string,
  opts: FetchOptions = {}
): Promise<FetchResult<T>> {
  return apiFetchRaw<T>(url, opts);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build a human-readable error message. For 401 errors, includes service-specific
 * instructions so Claude can tell the user exactly what to fix.
 */
function buildErrorMessage(
  status: number,
  statusText: string,
  url: string,
  body: string
): string {
  let message = `HTTP ${status} ${statusText} – ${url}`;

  if (status === 401) {
    if (url.includes("myshopify.com")) {
      message +=
        "\nShopify access token is expired or invalid. " +
        "If SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are set, the server will auto-refresh. " +
        "Otherwise regenerate the token manually in Shopify Admin → Settings → Apps → your private app.";
    } else if (url.includes("klaviyo.com")) {
      message +=
        "\nKlaviyo API key is invalid or revoked. Check it in Klaviyo → Settings → API Keys.";
    } else if (url.includes("triplewhale.com")) {
      message +=
        "\nTriple Whale API key is invalid. Check it in Triple Whale → Settings → API Keys.";
    } else {
      message += "\nAuthentication failed – check your API credentials in the server environment variables.";
    }
  } else if (body) {
    message += `\n${body.slice(0, 500)}`;
  }

  return message;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
