// ── SHARED PARTNER DATA LOGIC ──────────────────────────────────────────────
// Used by both partners.html (directory) and explore.html (category browse).
//
// Two sources, merged:
//  1. window.VERQ_PARTNERS (js/partners-data.js) — the real, consented baseline
//     of 68 partners from the onboarding export.
//  2. The live /.netlify/functions/hr-partners feed — real partners who applied
//     via join-hr-partner.html and checked the public-consent box, going forward.
// This is how new partners show up here automatically without a manual re-export:
// as soon as someone consents through the live form, they appear in both.

(function (global) {
  const CATEGORY_MAP = {
    'Recruitment': ['recruitment', 'talent acquisition', 'contract staffing'],
    'Payroll': ['payroll', 'compensation and benefits'],
    'HRBP': ['hr operations', 'hr admin', 'onboarding', 'documentation', 'hrms implementation', 'vendor management', 'hr analytics', 'generalist'],
    'Compliance': ['compliance', 'labour law', 'posh'],
    'Training': ['training', 'performance management', 'employee engagement'],
  };
  const CATEGORIES = Object.keys(CATEGORY_MAP);

  function categorize(text) {
    const t = (text || '').toLowerCase();
    if (t.includes('almost all')) return CATEGORIES.slice();
    const cats = [];
    for (const cat in CATEGORY_MAP) {
      if (CATEGORY_MAP[cat].some(kw => t.includes(kw))) cats.push(cat);
    }
    return cats;
  }

  // Live feed entries (from hr-partners.js) have a different, simpler shape
  // than the static baseline — normalize them to match before merging.
  // Defensive parsing for the same reason the server-side function has it:
  // Netlify Forms can serialize a multi-checkbox field as a JSON-stringified
  // array packed into a single string, rather than a real array. This is a
  // client-side safety net in case that ever slips through unparsed.
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

  function normalizeLive(p) {
    return {
      name: p.name,
      city: p.city,
      experience: p.experience,
      role: p.role,
      skills: parseSkillsField(p.skills),
      workType: p.availability || '',
      workMode: '',
      status: p.availability || '',
      available: p.availability === 'Available Now',
      categories: categorize(p.role),
      initials: p.initials,
      color: p.color,
      photo: p.photo || null,
    };
  }

  function mergeByName(staticList, liveList) {
    const byName = new Map();
    staticList.forEach(p => byName.set(p.name.trim().toLowerCase(), p));
    // Live entries win on name collision — they're the more recent, direct submission.
    liveList.forEach(p => byName.set(p.name.trim().toLowerCase(), normalizeLive(p)));
    return Array.from(byName.values());
  }

  // Fetches the live feed and merges with the static baseline. Never throws —
  // falls back to the static baseline alone if the live feed is unavailable.
  function loadAllPartners() {
    const staticList = global.VERQ_PARTNERS || [];
    return fetch('/.netlify/functions/hr-partners')
      .then(res => res.ok ? res.json() : Promise.reject(new Error('bad response')))
      .then(data => mergeByName(staticList, (data && data.profiles) || []))
      .catch(() => staticList.slice());
  }

  global.VerqPartnersShared = { CATEGORIES, CATEGORY_MAP, categorize, loadAllPartners };
})(window);
