import './guide.css';
import { BRAND } from './config.js';

// Feedback link (built in JS, same as the terminal footer)
const mail = document.getElementById('gMail');
if (BRAND.contact) mail.href = `mailto:${BRAND.contact}?subject=${encodeURIComponent(`${BRAND.name} — feedback / bug`)}`;
else mail.remove();

// Highlight the section being read in the side nav
const links = [...document.querySelectorAll('.g-nav a')];
const byId = Object.fromEntries(links.map((a) => [a.hash.slice(1), a]));
const obs = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) {
    links.forEach((a) => a.classList.remove('on'));
    byId[e.target.id]?.classList.add('on');
  }
}, { rootMargin: '-20% 0px -70% 0px' });
document.querySelectorAll('.card[id]').forEach((c) => obs.observe(c));
