// Cloudflare Pages Function — proxies /api/* to the backend VPS with proper
// CORS handling. Replaces _redirects because Pages _redirects do not handle
// CORS preflight (OPTIONS) requests.
//
// Run on the edge: the function receives the request from the browser,
// forwards it to the backend over Cloudflare's internal network, then
// streams the response back. CORS headers are added in all responses so the
// browser lets the cross-origin XHR through.
//
// Backend URL: configurable via BACKEND_ORIGIN env, defaults to plain HTTP
// VPS (mixed-content is fine because the call happens on Cloudflare's
// network, not the browser).
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // ===== CORS preflight (OPTIONS) =====
  // Browsers send OPTIONS before POST with custom Content-Type to confirm
  // the server allows it. Pages' static _redirects cannot answer OPTIONS
  // because the request never reaches the backend, so we do it ourselves.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  // ===== Build the upstream URL =====
  // Strip the /api prefix and forward everything else (path + query) to the
  // VPS. The backend's own routes already include /api/* (e.g. /api/auth/...
  // -> http://185.192.22.193/api/auth/...).
  const backend = context.env.BACKEND_ORIGIN || 'http://185.192.22.193';
  const upstreamUrl = backend + url.pathname + url.search;

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