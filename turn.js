/**
 * GET /api/turn  —  optional TURN relay credentials (Cloudflare Pages Function)
 *
 * Why: ~10–20% of real-world networks (mobile carriers, strict corporate/campus Wi-Fi) cannot make a direct
 * peer-to-peer connection. A TURN relay gives those viewers a fallback path. Direct P2P is always tried first,
 * so the relay is only used when it is actually needed.
 *
 * It is OFF until you add two secrets in Pages → Settings → Variables and Secrets:
 *   TURN_KEY_ID         (Cloudflare dashboard → Realtime → TURN Server → create key)
 *   TURN_KEY_API_TOKEN
 * Optional: TURN_TTL (seconds, default 14400), ALLOWED_ORIGINS (comma separated extra origins).
 *
 * Without the secrets this returns an empty list and the app silently stays on STUN-only.
 * Cloudflare bills relayed traffic after a free monthly allowance — see README.md before enabling.
 */

const cache = { payload: null, validUntil: 0 };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });

export async function onRequestGet({ request, env }) {
  /* Only our own pages may ask for credentials (stops other sites from spending your relay allowance). */
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return json({ error: 'forbidden' }, 403);
  }
  const origin = request.headers.get('origin');
  if (origin) {
    const allowed = [new URL(request.url).origin]
      .concat((env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean));
    if (!allowed.includes(origin)) return json({ error: 'forbidden' }, 403);
  }

  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    return json({ configured: false, iceServers: [] });
  }

  const now = Date.now();
  if (cache.payload && now < cache.validUntil) return json(cache.payload);

  const ttl = Math.min(86400, Math.max(1800, Number(env.TURN_TTL) || 14400));

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ ttl })
      }
    );
    if (!res.ok) return json({ configured: true, iceServers: [], error: 'upstream' });

    const data = await res.json();
    let servers = data.iceServers;
    if (servers && !Array.isArray(servers)) servers = [servers];
    servers = (servers || [])
      .map((s) => ({
        ...s,
        /* Port 53 is blocked by browsers and only produces console warnings. */
        urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => typeof u === 'string' && !/:53(\?|$)/.test(u))
      }))
      .filter((s) => s.urls.length > 0);

    const payload = { configured: true, iceServers: servers, expiresAt: now + ttl * 1000 };
    cache.payload = payload;
    cache.validUntil = now + (ttl * 1000) / 2; /* hand out credentials that still have at least half their life left */
    return json(payload);
  } catch (e) {
    return json({ configured: true, iceServers: [], error: 'network' });
  }
}
