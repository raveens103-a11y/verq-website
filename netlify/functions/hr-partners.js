// ── Config ──────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  'https://verq.in',
  'https://www.verq.in',
]);

const FORM_NAME = 'hr-partner';
const MAX_RESULTS = 8;
const CACHE_TTL_MS = 60_000; // avoid hammering the Netlify API on every page load

// Fields safe to expose publicly. Everything else (email, phone, linkedin,
// earnings, notes, industries) is never returned by this function, even if
// present in the submission.
function toPublicProfile(sub) {
  const d = sub.data || {};
  const skillsRaw = d.skills;
  const skills = Array.isArray(skillsRaw) ? skillsRaw : (skillsRaw ? [skillsRaw] : []);

  return {
    name: (d.name || '').trim(),
    city: (d.city || '').trim(),
    experience: (d.experience || '').trim(),
    role: (d.role || '').trim(),
    skills: skills.slice(0, 3),
    availability: (d.availability || '').trim(),
    submittedAt: sub.created_at || null,
  };
}

function initialsOf(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const PALETTE = ['#F59E0B', '#3B82F6', '#14B8A6', '#00DDF0', '#A855F7', '#EF4444', '#8CC400'];
function colorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

// ── Best-effort in-memory cache + rate limit ────────────────────────────────
// Netlify Functions run in ephemeral, possibly-parallel containers, so these
// only help within a single warm container — not a substitute for a real
// cache/rate-limit store, but enough to reduce redundant upstream calls.
let cache = { data: null, expiresAt: 0 };
const requestLog = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

function corsHeaders(origin) {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : '*',
    'Vary': 'Origin',
    'Cache-Control': 'public, max-age=30',
  };
}

// Same-origin fetch() calls (your own homepage calling this same-domain
// endpoint) often don't send an Origin header at all — browsers mostly only
// send it for genuinely cross-origin requests. So we accept a request if
// EITHER the Origin header matches our allowlist, OR it's missing but the
// Referer header shows the request came from one of our own pages.
function isAllowedRequest(origin, referer) {
  if (origin) return ALLOWED_ORIGINS.has(origin);
  if (referer) {
    return Array.from(ALLOWED_ORIGINS).some(o => referer.startsWith(o));
  }
  // No Origin and no Referer at all — allow it. This data is public,
  // consent-gated read-only content, not a secret, so the worst case is
  // someone else's server also being able to read it.
  return true;
}

exports.handler = async function (event) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const referer = event.headers.referer || event.headers.Referer || '';
  console.log(`[hr-partners] request received. origin="${origin}" referer="${referer}" method=${event.httpMethod}`);

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: { ...corsHeaders(origin), 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
      body: '',
    };
  }

  if (event.httpMethod !== 'GET') {
    console.log('[hr-partners] rejected: method not allowed');
    return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!isAllowedRequest(origin, referer)) {
    console.log(`[hr-partners] rejected: origin "${origin}" / referer "${referer}" not allowed`);
    return { statusCode: 403, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Forbidden origin' }) };
  }

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown';
  if (isRateLimited(ip)) {
    console.log(`[hr-partners] rejected: rate limited (ip=${ip})`);
    return { statusCode: 429, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Too many requests, please slow down.' }) };
  }

  if (cache.data && Date.now() < cache.expiresAt) {
    console.log(`[hr-partners] serving from cache: ${cache.data.profiles.length} profile(s)`);
    return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify(cache.data) };
  }

  const token = process.env.NETLIFY_ACCESS_TOKEN;
  const siteId = process.env.NETLIFY_SITE_ID;
  console.log(`[hr-partners] env check: token=${token ? 'present (' + token.length + ' chars)' : 'MISSING'} siteId=${siteId || 'MISSING'}`);

  if (!token || !siteId) {
    console.log('[hr-partners] aborting: missing required environment variables');
    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({ error: 'Server not configured: missing NETLIFY_ACCESS_TOKEN or NETLIFY_SITE_ID' }),
    };
  }

  try {
    // 1. Find the hr-partner form's ID for this site.
    const formsRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/forms`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[hr-partners] forms lookup status: ${formsRes.status}`);
    if (!formsRes.ok) throw new Error(`forms lookup failed: ${formsRes.status} ${await formsRes.text()}`);
    const forms = await formsRes.json();
    console.log(`[hr-partners] found ${forms.length} form(s) on this site: ${forms.map(f => f.name).join(', ')}`);
    const form = forms.find(f => f.name === FORM_NAME);
    if (!form) {
      console.log(`[hr-partners] no form named "${FORM_NAME}" found — returning empty`);
      const empty = { profiles: [] };
      cache = { data: empty, expiresAt: Date.now() + CACHE_TTL_MS };
      return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify(empty) };
    }

    // 2. Fetch submissions for that form.
    const subsRes = await fetch(`https://api.netlify.com/api/v1/forms/${form.id}/submissions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[hr-partners] submissions lookup status: ${subsRes.status}`);
    if (!subsRes.ok) throw new Error(`submissions lookup failed: ${subsRes.status} ${await subsRes.text()}`);
    const submissions = await subsRes.json();
    console.log(`[hr-partners] total submissions found: ${submissions.length}`);

    // 3. Only include submissions where the person explicitly consented to
    //    being publicly featured. Everything else is silently excluded.
    const consented = submissions.filter(s => {
      const c = s.data && s.data.consent;
      return c === 'yes' || c === 'on' || c === true;
    });
    console.log(`[hr-partners] submissions with consent=yes: ${consented.length}`);

    // 4. Most recent first, capped, mapped to safe public fields only.
    consented.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const profiles = consented.slice(0, MAX_RESULTS).map(sub => {
      const p = toPublicProfile(sub);
      return { ...p, initials: initialsOf(p.name || '??'), color: colorFor(p.name || 'x') };
    }).filter(p => p.name); // never show a profile with no name

    console.log(`[hr-partners] returning ${profiles.length} public profile(s)`);
    const result = { profiles };
    cache = { data: result, expiresAt: Date.now() + CACHE_TTL_MS };

    return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify(result) };
  } catch (err) {
    console.log(`[hr-partners] ERROR: ${err.message || err}`);
    return {
      statusCode: 502,
      headers: corsHeaders(origin),
      body: JSON.stringify({ error: 'Could not load partner data', detail: String(err.message || err) }),
    };
  }
};
