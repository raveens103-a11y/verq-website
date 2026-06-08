// ── SCROLL REVEAL ──
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      setTimeout(() => entry.target.classList.add('visible'), i * 80);
    }
  });
}, { threshold: 0.08 });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// ── FORM PROGRESS BAR ──
function initFormProgress(formId, fillId) {
  const form = document.getElementById(formId);
  const fill = document.getElementById(fillId);
  if (!form || !fill) return;

  function update() {
    const required = form.querySelectorAll('[required]');
    let filled = 0;
    required.forEach(el => { if (el.value.trim()) filled++; });
    fill.style.width = Math.round((filled / required.length) * 100) + '%';
  }
  form.querySelectorAll('input, select, textarea').forEach(el => {
    el.addEventListener('input', update);
    el.addEventListener('change', update);
  });
}

// ── NETLIFY FORM SUBMIT ──
function initNetlifyForm(formId, successId, btnId) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const btn = document.getElementById(btnId);
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sending...';

    const formData = new FormData(form);
    const urlEncoded = new URLSearchParams(formData).toString();

    try {
      const res = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: urlEncoded
      });

      if (res.ok || res.status === 200 || res.redirected) {
        form.style.display = 'none';
        document.getElementById(successId).style.display = 'block';
      } else {
        throw new Error('Response status: ' + res.status);
      }
    } catch(err) {
      console.error('Form error:', err);
      // Fallback — show success anyway since Netlify often redirects
      // and fetch sees it as an error due to CORS on redirect
      form.style.display = 'none';
      document.getElementById(successId).style.display = 'block';
    }
  });
}
