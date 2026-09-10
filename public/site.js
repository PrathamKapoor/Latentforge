/**
 * Shared page chrome for / and /lab: header scroll state, dropdown menus,
 * mobile drawer, scroll-reveal, tabs, card pointer highlight, and lab
 * section scroll-spy. No server data is rendered here.
 */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
if (!reduceMotion) document.documentElement.classList.add('js-motion');

const header = document.querySelector('.site-header');

/* Header gains its backdrop once the page scrolls. */
if (header) {
  const update = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  update();
  window.addEventListener('scroll', update, { passive: true });
}

/* Dropdown menus: hover on desktop, click/keyboard everywhere. */
const dropdownItems = [...document.querySelectorAll('[data-dropdown]')];
function setOpen(item, open) {
  item.dataset.open = String(open);
  item.querySelector('.nav-trigger')?.setAttribute('aria-expanded', String(open));
}
function closeAll(except = null) {
  for (const item of dropdownItems) if (item !== except) setOpen(item, false);
}
for (const item of dropdownItems) {
  const trigger = item.querySelector('.nav-trigger');
  let closeTimer;
  trigger.addEventListener('click', () => {
    const open = item.dataset.open !== 'true';
    closeAll(item);
    setOpen(item, open);
  });
  if (finePointer) {
    item.addEventListener('pointerenter', () => { clearTimeout(closeTimer); closeAll(item); setOpen(item, true); });
    item.addEventListener('pointerleave', () => { closeTimer = setTimeout(() => setOpen(item, false), 140); });
  }
  item.addEventListener('focusout', (event) => { if (!item.contains(event.relatedTarget)) setOpen(item, false); });
}
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const open = dropdownItems.find((item) => item.dataset.open === 'true');
  if (open) { setOpen(open, false); open.querySelector('.nav-trigger').focus(); }
  if (header?.dataset.menuOpen === 'true') setMenu(false);
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-dropdown]')) closeAll();
});

/* Mobile drawer. */
const toggle = document.querySelector('.nav-toggle');
function setMenu(open) {
  if (!header || !toggle) return;
  header.dataset.menuOpen = String(open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}
toggle?.addEventListener('click', () => setMenu(header.dataset.menuOpen !== 'true'));
for (const link of document.querySelectorAll('.nav-panel a')) link.addEventListener('click', () => { setMenu(false); closeAll(); });
window.matchMedia('(min-width: 961px)').addEventListener('change', (event) => { if (event.matches) setMenu(false); });

/* Scroll reveal with stagger. Content stays visible without JS or with reduced motion. */
const revealTargets = document.querySelectorAll('[data-reveal]');
if (!reduceMotion && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  for (const group of document.querySelectorAll('[data-reveal-group]')) {
    [...group.querySelectorAll('[data-reveal]')].forEach((node, index) => node.style.setProperty('--reveal-delay', `${index * 80}ms`));
  }
  revealTargets.forEach((node) => observer.observe(node));
} else {
  revealTargets.forEach((node) => node.classList.add('is-visible'));
}

/* Tabs: [data-tabs] > [role=tablist] > [role=tab][aria-controls]. Arrow keys move focus. */
for (const tabs of document.querySelectorAll('[data-tabs]')) {
  const list = [...tabs.querySelectorAll('[role="tab"]')];
  const select = (tab, focus = false) => {
    for (const other of list) {
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      other.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(other.getAttribute('aria-controls'));
      if (panel) panel.hidden = !selected;
    }
    if (focus) tab.focus();
  };
  list.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (event.key === 'Home') { event.preventDefault(); select(list[0], true); }
      else if (event.key === 'End') { event.preventDefault(); select(list.at(-1), true); }
      else if (step) { event.preventDefault(); select(list[(index + step + list.length) % list.length], true); }
    });
  });
}

/* Pointer-follow highlight on bento cards. */
if (finePointer && !reduceMotion) {
  document.addEventListener('pointermove', (event) => {
    const card = event.target.closest?.('.card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    card.style.setProperty('--my', `${event.clientY - rect.top}px`);
  }, { passive: true });
}

/* Scroll-spy for in-page section tabs (lab subnav). */
const spyLinks = [...document.querySelectorAll('[data-spy] a[href^="#"]')];
if (spyLinks.length && 'IntersectionObserver' in window) {
  const byId = new Map(spyLinks.map((link) => [link.getAttribute('href').slice(1), link]));
  const visible = new Set();
  const spy = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.isIntersecting ? visible.add(entry.target.id) : visible.delete(entry.target.id);
    const current = [...byId.keys()].find((id) => visible.has(id));
    if (!current) return;
    for (const [id, link] of byId) {
      if (id === current) {
        link.setAttribute('aria-current', 'true');
        // Keep the active tab in view on narrow screens without moving the page.
        const strip = link.closest('[data-spy]');
        if (strip && strip.scrollWidth > strip.clientWidth) strip.scrollTo({ left: link.offsetLeft - 16, behavior: reduceMotion ? 'auto' : 'smooth' });
      } else link.removeAttribute('aria-current');
    }
  }, { rootMargin: '-35% 0px -55% 0px' });
  for (const id of byId.keys()) {
    const section = document.getElementById(id);
    if (section) spy.observe(section);
  }
}
