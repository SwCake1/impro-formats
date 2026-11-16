(() => {
  'use strict';

  const tools = [
    ['bell', 'Звонок'],
    ['word', 'Слова'],
    ['letters', 'Буквы'],
    ['emotion', 'Эмоции'],
    ['rap-battle', 'Темы батлов'],
    ['locations', 'Локации'],
    ['relationship', 'Отношения'],
    ['first-line', 'Первая реплика'],
    ['genres', 'Жанры'],
    ['professions', 'Профессии'],
    ['characters', 'Персонажи'],
  ];
  const header = document.querySelector('[data-portal-root]');
  const root = new URL(header.dataset.portalRoot, location.href);
  const picker = header.querySelector('.portal-picker');
  const summary = picker.querySelector('summary');
  const links = header.querySelector('.portal-menu-links');
  const storageKey = `improformats.catalog-return:${root.pathname}`;
  const isCatalog = location.pathname === root.pathname || location.pathname === `${root.pathname}index.html`;

  for (const [slug, title] of tools) {
    const link = document.createElement('a');
    link.href = new URL(`tools/${slug}/`, root).href;
    link.textContent = title;
    if (header.dataset.portalTool === slug) link.setAttribute('aria-current', 'page');
    links.append(link);
  }

  function rememberCatalog() {
    try {
      sessionStorage.setItem(storageKey, location.href);
    } catch {
      // Returning to a saved search is optional when browser storage is blocked.
    }
  }

  function restoreCatalogLinks() {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (!saved) return;
      const url = new URL(saved);
      if (url.origin !== root.origin ||
          (url.pathname !== root.pathname && url.pathname !== `${root.pathname}index.html`)) return;
      header.querySelectorAll('[data-formats-link]').forEach(link => { link.href = url.href; });
    } catch {
      // An unavailable session store must not prevent navigation.
    }
  }

  if (isCatalog) {
    window.addEventListener('pagehide', rememberCatalog);
    document.addEventListener('click', event => {
      if (event.target.closest('a[href]')) rememberCatalog();
    }, { capture: true });
  } else {
    restoreCatalogLinks();
  }

  // Tool shortcuts and whole-screen actions belong to the tool, outside this navigation.
  header.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape' && picker.open) {
      event.preventDefault();
      picker.open = false;
      summary.focus();
    }
  });
  header.addEventListener('click', event => {
    event.stopPropagation();
    if (event.target.closest('a[href]')) picker.open = false;
  });
  header.addEventListener('focusout', event => {
    if (!header.contains(event.relatedTarget)) picker.open = false;
  });
  document.addEventListener('click', () => { picker.open = false; });
  window.addEventListener('pageshow', () => {
    picker.open = false;
    if (!isCatalog) restoreCatalogLinks();
  });
})();
