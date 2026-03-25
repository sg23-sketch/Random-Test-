// Subscribe form handler
function handleSubscribe(e) {
  e.preventDefault();
  const form = e.target;
  const success = document.getElementById('formSuccess');
  form.querySelector('.form-row').style.display = 'none';
  form.querySelector('.form-note').style.display = 'none';
  success.hidden = false;
}

// Mobile nav toggle
const burger = document.querySelector('.nav__burger');
const navLinks = document.querySelector('.nav__links');

if (burger && navLinks) {
  burger.addEventListener('click', () => {
    const isOpen = navLinks.style.display === 'flex';
    navLinks.style.cssText = isOpen
      ? ''
      : 'display:flex;flex-direction:column;position:absolute;top:100%;left:0;right:0;background:rgba(26,26,46,0.98);padding:1.5rem;gap:1.25rem;border-top:1px solid rgba(255,255,255,0.06)';
  });

  // Close nav on link click (mobile)
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth < 641) navLinks.style.cssText = '';
    });
  });
}

// Nav scroll effect
const nav = document.querySelector('.nav');
window.addEventListener('scroll', () => {
  nav.style.boxShadow = window.scrollY > 20
    ? '0 2px 20px rgba(0,0,0,0.3)'
    : 'none';
}, { passive: true });

// Animate stats on scroll
const stats = document.querySelectorAll('.stat__number');
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('animated');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });
stats.forEach(s => observer.observe(s));

// Animate cards on scroll
const cards = document.querySelectorAll('.episode-card, .testimonial');
const cardObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      entry.target.style.animation = `fadeUp 0.5s ease ${i * 0.07}s both`;
      cardObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });
cards.forEach(c => cardObserver.observe(c));

// Inject keyframes
const style = document.createElement('style');
style.textContent = `
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`;
document.head.appendChild(style);

// Play button toggle (decorative)
const playBtn = document.querySelector('.play-btn');
let playing = false;
if (playBtn) {
  playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.innerHTML = playing
      ? `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  });
}
