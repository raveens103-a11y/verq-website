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
// Netlify Forms serializes a group of checkboxes sharing the same field name
// inconsistently depending on submission path — sometimes a real array,
// sometimes a plain comma-separated string, and sometimes (seen in practice)
// a JSON-stringified array packed into a single string value, e.g. the
// literal text '["Recruitment", "Payroll"]' rather than an actual array.
// Handle all three so a real submission never renders as one raw blob.
function parseSkillsField(skillsRaw) {
  if (Array.isArray(skillsRaw)) return skillsRaw.map(s => String(s).trim()).filter(Boolean);
  if (typeof skillsRaw === 'string') {
    const trimmed = skillsRaw.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(s => String(s).trim()).filter(Boolean);
      } catch (e) { /* not valid JSON — fall through to comma-split */ }
    }
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

// Netlify includes a URL to any uploaded file directly in the submission's
// data for that field. We can't fully verify the exact shape without a real
// test submission, so this is defensive: if it's not a plain https URL
// string, we just treat it as no photo — same safe fallback as if nothing
// was uploaded at all, never a broken image or a crash.
function extractPhotoUrl(d) {
  const raw = d.photo;
  if (typeof raw === 'string' && /^https:\/\//.test(raw.trim())) return raw.trim();
  return null;
}

function hasPhotoConsent(d) {
  const c = d['photo-consent'];
  return c === 'yes' || c === 'on' || c === true;
}

function toPublicProfile(sub) {
  const d = sub.data || {};
  const skills = parseSkillsField(d.skills);
  const photo = hasPhotoConsent(d) ? extractPhotoUrl(d) : null;

  return {
    name: (d.name || '').trim(),
    city: (d.city || '').trim(),
    experience: (d.experience || '').trim(),
    role: (d.role || '').trim(),
    skills: skills.slice(0, 3),
    availability: (d.availability || '').trim(),
    photo,
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

    // 2. Fetch submissions for that form. Netlify paginates at 100 items per
    //    page by default and we were never requesting a specific page or
    //    sort order — meaning if a form accumulates more than 100 total
    //    submissions, whichever ones land outside whatever Netlify's default
    //    'page 1' happens to be are silently never even fetched, regardless
    //    of consent or verification status. Fetch multiple pages (capped, so
    //    this can't grow unbounded) and merge them before filtering, so a
    //    real submission can't be missed just because of where it falls in
    //    Netlify's own default ordering.
    const MAX_PAGES = 5; // 5 x 100 = up to 500 submissions considered
    let submissions = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const subsRes = await fetch(`https://api.netlify.com/api/v1/forms/${form.id}/submissions?per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log(`[hr-partners] submissions lookup page ${page} status: ${subsRes.status}`);
      if (!subsRes.ok) throw new Error(`submissions lookup failed: ${subsRes.status} ${await subsRes.text()}`);
      const pageData = await subsRes.json();
      submissions = submissions.concat(pageData);
      if (pageData.length < 100) break; // fewer than a full page — we've reached the end
    }
    console.log(`[hr-partners] total submissions found across all pages: ${submissions.length}`);

    // 3. Only include submissions where the person explicitly consented to
    //    being publicly featured. Everything else is silently excluded.
    const consented = submissions.filter(s => {
      const c = s.data && s.data.consent;
      return c === 'yes' || c === 'on' || c === true;
    });
    console.log(`[hr-partners] submissions with consent=yes: ${consented.length}`);
    consented.forEach(s => {
      const d = s.data || {};
      console.log(`[hr-partners]   consented submission: name="${d.name || '(missing)'}" created_at=${s.created_at} has_photo_field=${!!d.photo} photo_consent="${d['photo-consent'] || '(missing)'}"`);
    });

    // 4. Most recent first, capped, mapped to safe public fields only.
    //    Guard against a missing/malformed created_at (treat it as very old
    //    rather than letting NaN comparisons scatter it unpredictably),
    //    so a real submission's sort position is always sensible.
    consented.sort((a, b) => {
      const at = new Date(a.created_at).getTime() || 0;
      const bt = new Date(b.created_at).getTime() || 0;
      return bt - at;
    });
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
