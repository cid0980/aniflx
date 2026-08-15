/**
 * Safe fetch wrapper for client-side API calls.
 * Always returns a structured response with proper error handling,
 * even when the server returns non-JSON (HTML error pages, empty body, etc.)
 */

export interface ApiError {
  type: string;
  message: string;
  technical: string;
  statusCode?: number;
  raw?: string;
}

export interface SafeResult<T> {
  ok: boolean;
  data?: T;
  error?: ApiError;
}

export async function safeFetch<T>(
  url: string,
  options?: RequestInit
): Promise<SafeResult<T>> {
  let res: Response;

  try {
    res = await fetch(url, options);
  } catch (e) {
    // Network-level failure (DNS, connection refused, CORS, offline, etc.)
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: {
        type: 'NETWORK_ERROR',
        message: 'Network request failed',
        technical: `fetch() threw: ${msg}. URL: ${url}. This could be a DNS failure, the server being down, a CORS issue, or the client being offline.`,
      },
    };
  }

  // Read body as text first — never call res.json() directly
  let bodyText: string;
  try {
    bodyText = await res.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: {
        type: 'NETWORK_ERROR',
        message: 'Failed to read response body',
        technical: `res.text() threw: ${msg}. HTTP status: ${res.status}. URL: ${url}`,
        statusCode: res.status,
      },
    };
  }

  // Try to parse as JSON
  let data: T;
  try {
    data = JSON.parse(bodyText);
  } catch {
    // Non-JSON response — could be HTML error page, Cloudflare challenge, empty, etc.
    const isHtml = bodyText.trim().startsWith('<') || bodyText.includes('<!DOCTYPE');
    const isCloudflare =
      bodyText.includes('cf-challenge') ||
      bodyText.includes('challenge-platform') ||
      bodyText.includes('Just a moment') ||
      bodyText.includes('Cloudflare');

    if (isCloudflare) {
      return {
        ok: false,
        error: {
          type: 'CLOUDFLARE_CHALLENGE',
          message: 'Cloudflare verification required',
          technical: `The server returned a Cloudflare challenge page instead of JSON. HTTP ${res.status}. URL: ${url}. This typically means the upstream API needs a cf_clearance cookie.`,
          statusCode: res.status,
          raw: bodyText.slice(0, 500),
        },
      };
    }

    if (isHtml) {
      // Next.js error page or server crash
      // Try to extract useful info from the HTML
      const titleMatch = bodyText.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch?.[1] || 'Unknown Error';

      return {
        ok: false,
        error: {
          type: 'SERVER_ERROR',
          message: `Server error: ${title}`,
          technical: `The API returned HTML instead of JSON (likely an unhandled server error). HTTP ${res.status}. URL: ${url}. Page title: "${title}". Body preview: ${bodyText.slice(0, 300)}`,
          statusCode: res.status,
          raw: bodyText.slice(0, 500),
        },
      };
    }

    return {
      ok: false,
      error: {
        type: 'PARSE_ERROR',
        message: 'Invalid server response',
        technical: `Failed to parse response as JSON. HTTP ${res.status}. URL: ${url}. Body preview: ${bodyText.slice(0, 300)}`,
        statusCode: res.status,
        raw: bodyText.slice(0, 500),
      },
    };
  }

  // Parsed JSON successfully — now check if the API returned an error
  if (!res.ok) {
    // The server returned a JSON error
    const serverError = (data as Record<string, unknown>)?.error;
    if (serverError && typeof serverError === 'object') {
      return {
        ok: false,
        error: serverError as ApiError,
      };
    }
    // Generic error
    return {
      ok: false,
      error: {
        type: 'API_ERROR',
        message: `API error (HTTP ${res.status})`,
        technical: `Server returned HTTP ${res.status}. URL: ${url}. Response: ${bodyText.slice(0, 500)}`,
        statusCode: res.status,
        raw: bodyText.slice(0, 500),
      },
    };
  }

  return { ok: true, data };
}
