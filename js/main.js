/* ── verQ Main JavaScript ── */

// ════════════════════════════════════════════════════════════════════════════
// MOBILE HAMBURGER MENU
// ════════════════════════════════════════════════════════════════════════════

function toggleMenu() {
  const links = document.querySelector('.nav-links');
  const burger = document.getElementById('hamburger');
  
  if (!links || !burger) return;
  
  const isOpen = links.classList.contains('open');
  
  if (isOpen) {
    links.classList.remove('open');
    burger.classList.remove('open');
    document.body.style.overflow = '';
  } else {
    links.classList.add('open');
    burger.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

// Close menu when clicking a link
function setupMenuLinkClosers() {
  const navLinks = document.querySelectorAll('.nav-links a');
  const burger = document.getElementById('hamburger');
  const links = document.querySelector('.nav-links');
  
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (links && burger) {
        links.classList.remove('open');
        burger.classList.remove('open');
        document.body.style.overflow = '';
      }
    });
  });
}

// Close menu when clicking outside nav
function setupOutsideClickClose() {
  document.addEventListener('click', (e) => {
    const nav = document.querySelector('nav');
    const links = document.querySelector('.nav-links');
    const burger = document.getElementById('hamburger');
    
    if (nav && !nav.contains(e.target) && links && links.classList.contains('open')) {
      links.classList.remove('open');
      burger?.classList.remove('open');
      document.body.style.overflow = '';
    }
  });
}

// Close menu on escape key
function setupEscapeKeyClose() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const links = document.querySelector('.nav-links');
      const burger = document.getElementById('hamburger');
      
      if (links && links.classList.contains('open')) {
        links.classList.remove('open');
        burger?.classList.remove('open');
        document.body.style.overflow = '';
      }
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// FORM PROGRESS BAR
// ════════════════════════════════════════════════════════════════════════════

function initFormProgress(formId, fillId) {
  const form = document.getElementById(formId);
  const fill = document.getElementById(fillId);
  
  if (!form || !fill) return;
  
  function updateProgress() {
    const inputs = form.querySelectorAll('input[required], textarea[required], select[required]');
    let filled = 0;
    
    inputs.forEach(input => {
      if (input.type === 'radio') {
        const radioGroup = form.querySelectorAll(`input[name="${input.name}"]`);
        if (Array.from(radioGroup).some(r => r.checked)) {
          filled++;
        }
      } else if (input.type === 'checkbox') {
        // Skip individual checkboxes from progress
      } else if (input.value.trim()) {
        filled++;
      }
    });
    
    const progress = inputs.length > 0 ? (filled / inputs.length) * 100 : 0;
    fill.style.width = progress + '%';
  }
  
  // Listen to all form inputs
  form.addEventListener('input', updateProgress);
  form.addEventListener('change', updateProgress);
  
  // Initial call
  updateProgress();
}

// ════════════════════════════════════════════════════════════════════════════
// NETLIFY FORM HANDLING
// ════════════════════════════════════════════════════════════════════════════

function initNetlifyForm(formId, successId, submitBtnId) {
  const form = document.getElementById(formId);
  const successState = document.getElementById(successId);
  const submitBtn = document.getElementById(submitBtnId);
  
  if (!form) return;
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';
    }
    
    // Encode form data
    const formData = new FormData(form);
    const encoded = new URLSearchParams(formData);
    
    try {
      const response = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: encoded
      });
      
      if (response.ok) {
        // Hide form, show success
        if (successState) {
          form.style.display = 'none';
          successState.style.display = 'block';
          
          // Scroll to top of card
          const card = form.closest('.contact-form-card') || form.closest('.form-card');
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      } else {
        alert('Failed to submit. Please try again.');
      }
    } catch (error) {
      console.error('Form submission error:', error);
      alert('Network error. Please try again.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Message →';
      }
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// REVEAL ANIMATION ON SCROLL
// ════════════════════════════════════════════════════════════════════════════

function setupRevealAnimation() {
  const reveals = document.querySelectorAll('.reveal');
  
  if (!reveals.length) return;
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  
  reveals.forEach(reveal => observer.observe(reveal));
}

// ════════════════════════════════════════════════════════════════════════════
// INIT ON DOM READY
// ════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  setupMenuLinkClosers();
  setupOutsideClickClose();
  setupEscapeKeyClose();
  setupRevealAnimation();
});
