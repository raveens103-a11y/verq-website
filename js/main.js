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

    const data = new FormData(form);

    try {
      const res = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(data).toString()
      });

      if (res.ok) {
        form.style.display = 'none';
        document.getElementById(successId).style.display = 'block';
      } else {
        btn.disabled = false;
        btn.textContent = originalText;
        alert('Something went wrong. Please email info@verq.in');
      }
    } catch {
      btn.disabled = false;
      btn.textContent = originalText;
      alert('Something went wrong. Please email info@verq.in');
    }
  });
}
