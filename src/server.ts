import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleAuthApi } from "./api/auth/index";
import { handleAdminApi } from "./api/admin";
import { handlePaymentApi } from "./api/payment";
import { handleDocumentsApi } from "./api/documents";
import { handleOrgsApi } from "./api/orgs";
import { handleExtractApi } from "./api/extract";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

// Generate a cryptographically random base64 nonce for each request.
// Used in Content-Security-Policy and injected into every <script> tag so
// inline scripts inserted by TanStack Start's SSR hydration are allowed while
// attacker-injected inline scripts (XSS) are blocked.
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function buildSecurityHeaders(nonce: string): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Expanded Permissions-Policy: deny every sensor and payment API the app
    // does not use.  Add entries here only if a feature genuinely needs them.
    "Permissions-Policy": [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=(self)",
      "usb=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "ambient-light-sensor=()",
      "autoplay=()",
      "battery=()",
      "display-capture=()",
      "document-domain=()",
      "encrypted-media=()",
      "execution-while-not-rendered=()",
      "execution-while-out-of-viewport=()",
      "fullscreen=(self)",
    ].join(", "),
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "Content-Security-Policy": [
      "default-src 'self'",
      // Supabase API + realtime websocket (covers cloud and custom-domain deployments).
      // PostHog ingestion endpoint + Sentry DSN endpoint.
      "connect-src 'self'" +
        " https://*.supabase.co wss://*.supabase.co" +
        " https://*.supabase.in wss://*.supabase.in" +
        " https://monitor.dninfo.online wss://monitor.dninfo.online" +
        " https://*.posthog.com wss://*.posthog.com" +
        " https://*.sentry.io" +
        " https://api.razorpay.com https://lumberjack.razorpay.com",
      // Nonce-based for TanStack Start's SSR hydration inline scripts.
      // PostHog and Sentry load their SDKs from their own CDNs as external
      // scripts (src=), so they are covered by the origin allowlist below —
      // no 'unsafe-inline' needed.
      // The hash covers a fixed inline script injected by the asset loader
      // (sha256 is stable because the script content never changes at runtime).
      `script-src 'self' 'nonce-${nonce}' 'sha256-o14v1zTDl6buZIbwwpagHdIZZbJyjZ+L7AWYqYEBDB4=' https://*.posthog.com https://*.sentry.io https://checkout.razorpay.com`,
      // Styles: 'unsafe-inline' retained — Tailwind injects utilities via
      // style attributes; nonce-based styles require deeper framework changes.
      "style-src 'self' 'unsafe-inline'",
      // Vite HMR dev worker
      "worker-src 'self' blob:",
      "img-src 'self' data: blob: https:",
      // blob: required for <object>/<embed> PDF preview via URL.createObjectURL()
      "object-src 'self' blob:",
      // blob: required for <iframe> PDF preview via URL.createObjectURL()
      "frame-src 'self' blob: https://*.supabase.co https://*.supabase.in https://*.razorpay.com",
      "font-src 'self' https://fonts.gstatic.com",
      "frame-ancestors 'none'",
    ].join("; "),
  };
}

// Inject nonce attribute onto every <script tag in the HTML body so that
// TanStack Start's hydration inline scripts pass the nonce-based CSP check.
// Uses Cloudflare's HTMLRewriter when available; falls back to a simple regex
// replacement in Node.js dev environments.
function injectNonce(response: Response, nonce: string): Response {
  const ct = response.headers.get("content-type") ?? "";
  if (!ct.includes("text/html")) return response;

  // HTMLRewriter is only available in the Cloudflare Workers runtime.
  type HtmlRewriterConstructor = new () => {
    on: (
      selector: string,
      handlers: {
        element: (el: {
          getAttribute: (n: string) => string | null;
          setAttribute: (n: string, v: string) => void;
        }) => void;
      },
    ) => HtmlRewriterInstance;
    transform: (res: Response) => Response;
  };
  type HtmlRewriterInstance = InstanceType<HtmlRewriterConstructor>;

  const HTMLRewriter = (globalThis as { HTMLRewriter?: HtmlRewriterConstructor }).HTMLRewriter;
  if (typeof HTMLRewriter !== "undefined") {
    const rewriter = new HTMLRewriter()
      .on("script", {
        element(el: {
          getAttribute: (n: string) => string | null;
          setAttribute: (n: string, v: string) => void;
        }) {
          // Only add nonce to inline scripts (no src).
          // External bundle scripts are covered by 'self' in script-src.
          if (!el.getAttribute("src") && !el.getAttribute("nonce")) {
            el.setAttribute("nonce", nonce);
          }
        },
      })
      .on('meta[name="csp-nonce"]', {
        element(el: { setAttribute: (n: string, v: string) => void }) {
          // Stamp the nonce into the <meta name="csp-nonce"> placeholder so
          // PostHog / Sentry can read it at runtime for their dynamic scripts.
          el.setAttribute("content", nonce);
        },
      });
    return rewriter.transform(response);
  }

  // Node.js fallback: string-replace inline <script> tags.
  // This is synchronous and only runs in local dev, never in production.
  // Regex explanation:
  //   <script             — opening tag
  //   (?![^>]*\bsrc=)    — negative lookahead: no src= attribute (external scripts
  //                         are allowed by origin, they don't need a nonce)
  //   (?![^>]*\bnonce=)  — skip tags that already carry a nonce (idempotent)
  return new Response(
    response.body
      ? response.body.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              const text = new TextDecoder().decode(chunk);
              const patched = text
                .replace(/<script(?![^>]*\bsrc=)(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`)
                // Fill the <meta name="csp-nonce" content=""> placeholder so
                // PostHog/Sentry can read the nonce for their dynamic scripts.
                .replace(/(<meta\s[^>]*name="csp-nonce"[^>]*content=")(")/g, `$1${nonce}$2`);
              controller.enqueue(new TextEncoder().encode(patched));
            },
          }),
        )
      : null,
    { status: response.status, statusText: response.statusText, headers: response.headers },
  );
}

function addSecurityHeaders(response: Response, nonce: string): Response {
  const headers = new Headers(response.headers);
  const secHeaders = buildSecurityHeaders(nonce);
  for (const [k, v] of Object.entries(secHeaders)) {
    headers.set(k, v);
  }
  const patched = injectNonce(
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
    nonce,
  );
  return patched;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // ── LOW-5 · HTTP → HTTPS redirect ──────────────────────────────────────
    // Redirect plain-HTTP requests before doing anything else.  Browsers that
    // haven't yet seen the HSTS header for this domain (first visit, cleared
    // cache) would otherwise receive a response over an unencrypted connection.
    const url = new URL(request.url);
    if (
      url.protocol === "http:" &&
      url.hostname !== "localhost" &&
      !url.hostname.startsWith("127.")
    ) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    // Expose Cloudflare Worker env bindings (runtime secrets) to server-side
    // modules that cannot access them via import.meta.env or process.env.
    const g = globalThis as { __cf_env__?: unknown };
    if (!g.__cf_env__) g.__cf_env__ = env;

    // Generate a per-request nonce shared between the CSP header and the HTML.
    const nonce = generateNonce();

    try {
      // Auth API routes are handled before TanStack Start so they never go
      // through SSR rendering and always return plain JSON / redirects.
      const authResponse = await handleAuthApi(request, env as never);
      if (authResponse) return authResponse;

      const adminResponse = await handleAdminApi(request, env as never);
      if (adminResponse) return adminResponse;

      const paymentResponse = await handlePaymentApi(request, env as never);
      if (paymentResponse) return paymentResponse;

      const documentsResponse = await handleDocumentsApi(request, env as never);
      if (documentsResponse) return documentsResponse;

      const orgsResponse = await handleOrgsApi(request, env as never);
      if (orgsResponse) return orgsResponse;

      const extractResponse = await handleExtractApi(request, env as never);
      if (extractResponse) return extractResponse;

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      return addSecurityHeaders(normalized, nonce);
    } catch (error) {
      console.error(error);
      return addSecurityHeaders(brandedErrorResponse(), nonce);
    }
  },
};
