// ── Config ──────────────────────────────────────────────────────────────────
// Only these origins may call this function from a browser.
const ALLOWED_ORIGINS = new Set([
  'https://verq.in',
  'https://www.verq.in',
]);

// Only these models may be requested — prevents this proxy being used to
// run arbitrary/expensive models on your API key.
const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
]);

const MAX_TOKENS_CAP = 1024;
const MAX_BODY_BYTES = 20_000; // guards against oversized/abusive payloads

// ── Best-effort in-memory rate limit ─────────────────────────────────────
// Netlify Functions run in ephemeral, possibly-parallel containers, so this
// only limits repeat requests within a single warm container — it is not a
// substitute for real rate limiting. For production-grade limits, back this
// with Netlify Blobs, Upstash Redis, or a similar shared store.
const requestLog = new Map(); // ip -> [timestamps]
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

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
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'null',
    'Vary': 'Origin',
  };
}

exports.handler = async function (event) {
  const origin = event.headers.origin || event.headers.Origin || '';

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...corsHeaders(origin),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Reject requests from anywhere but our own site
  if (!ALLOWED_ORIGINS.has(origin)) {
    return { statusCode: 403, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Forbidden origin' }) };
  }

  // Reject oversized payloads before parsing
  if (event.body && Buffer.byteLength(event.body, 'utf8') > MAX_BODY_BYTES) {
    return { statusCode: 413, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Payload too large' }) };
  }

  // Best-effort per-IP rate limit
  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown';
  if (isRateLimited(ip)) {
    return { statusCode: 429, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Too many requests, please slow down.' }) };
  }

  let input;
  try {
    input = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // Validate the request shape — only forward exactly what we expect,
  // ignoring/rejecting anything else (e.g. tools, mcp_servers, other models).
  const { model, max_tokens, messages } = input || {};

  if (!ALLOWED_MODELS.has(model)) {
    return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Invalid model' }) };
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ error: 'Invalid messages' }) };
  }

  const safeBody = {
    model,
    max_tokens: Math.min(Number(max_tokens) || MAX_TOKENS_CAP, MAX_TOKENS_CAP),
    messages,
  };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(safeBody),
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      headers: corsHeaders(origin),
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({ error: 'Upstream request failed' }),
    };
  }
};
