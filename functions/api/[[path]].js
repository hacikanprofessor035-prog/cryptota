// Cloudflare Pages Function — proxies /api/* to the backend VPS with proper
// CORS handling. Replaces _redirects because Pages _redirects do not handle
// CORS preflight (OPTIONS) requests.
//
// Run on the edge: the function receives the request from the browser,
// forwards it to the backend, then streams the response back. CORS headers
// are added in all responses so the browser lets the cross-origin XHR
// through.
//
// BACKEND_ORIGIN env var controls where requests are proxied:
//   - Production default: http://cryptota-app.duckdns.org (Cloudflare
//     resolves DuckDNS domains on the edge, so DNS works here even if
//     your local resolver doesn't.)
//   - For a fresh env override: BACKEND_ORIGIN=http://185.192.22.193:80
//     (Caddy is on :80 publicly — direct IP works for Cloudflare but the
//     page can't reach it directly because Caddy is reverse-proxied to
//     Node on :3001 locally.)
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // ===== CORS preflight (OPTIONS) =====
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  // ===== Build the upstream URL =====
  // Strip the /api prefix; backend exposes the same /api/* routes.
  // Prefer the env var so you can point at staging without redeploying.
  // Falls back to the DuckDNS hostname (HTTPS via Caddy + Let's Encrypt),
  // then to direct VPS IP as last resort.
  // NOTE: Cloudflare Pages Functions returned error 1003 for the DuckDNS
  // hostname at one point — if that recurs, set BACKEND_ORIGIN to a
  // Cloudflare-fronted hostname (e.g. a Cloudflare Tunnel).
  const backend =
    env.BACKEND_ORIGIN ||
    env.API_BASE ||
    'https://cryptota-app.duckdns.org';
  const upstreamUrl = backend + url.pathname + url.search;

  // [DEBUG] log what we're about to do — uncomment to troubleshoot
  console.log('[proxy] backend =', backend, 'path =', url.pathname);

  // ===== Build the upstream request =====
  // Forward method, body, and most headers. Strip Host (the backend is on a
  // different host) and CF-Connecting-IP (the backend already sees the
  // client's IP via X-Forwarded-For, which we set below).
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('cf-connecting-ip');
  // Inject the real client IP so the backend can rate-limit + log correctly.
  const clientIp = request.headers.get('cf-connecting-ip') || '';
  if (clientIp) headers.set('X-Forwarded-For', clientIp);

  const upstreamRequest = new Request(upstreamUrl, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    // Don't follow redirects — backend shouldn't issue any, and we want to
    // surface them to the client for transparency.
    redirect: 'manual',
  });

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamRequest);
  } catch (err) {
    // Backend unreachable — return a structured JSON error so the UI's
    // "Network error — try again" path still works (it'll show our message
    // rather than a generic "TypeError: Failed to fetch").
    return new Response(
      JSON.stringify({ error: 'Backend unreachable', detail: String(err) }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      }
    );
  }

  // ===== Build the response with CORS headers =====
  const responseHeaders = new Headers(upstreamResponse.headers);
  // Re-apply CORS so the browser lets the (cross-origin) response through.
  // The backend's own CORS middleware is also on, but we re-apply here so
  // even non-CORS-aware backend routes (e.g. a 502) work transparently.
  for (const [k, v] of Object.entries(corsHeaders(request))) {
    responseHeaders.set(k, v);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

function corsHeaders(request) {
  // Echo the Origin if present (so credentials work), fall back to * for
  // server-to-server. The site is public (no cookies set on the API), so *
  // is fine; we still echo the Origin for paranoia.
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}