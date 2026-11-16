(() => {
  'use strict';

  const tools = [
    ['bell', 'Звонок', 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4'],
    ['word', 'Слова', 'M4 4h16v16H4zM8 9h8M8 14h5'],
    ['letters', 'Буквы', 'm3 19 5-14 5 14M5 14h6M16 5v14h2a3.5 3.5 0 0 0 0-7h-2M16 5h5'],
    ['emotion', 'Эмоции', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 14s1.5 2 4 2 4-2 4-2M8 8h.01M16 8h.01'],
    ['rap-battle', 'Темы батлов', 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8'],
    ['locations', 'Локации', 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
    ['relationship', 'Отношения', 'M8 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0M22 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0M8 8h8M1 20v-2a4 4 0 0 1 8 0v2M15 20v-2a4 4 0 0 1 8 0v2'],
    ['first-line', 'Первая реплика', 'M21 15a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3zM7 8h10M7 13h6'],
    ['genres', 'Жанры', 'M3 9h18v12H3zM3 9 2 4l18-3 1 5zM7 3l3 5M14 2l3 5'],
    ['professions', 'Профессии', 'M9 6V3h6v3M3 6h18v15H3zM3 11l9 3 9-3M12 12v4'],
    ['characters', 'Персонажи', 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2'],
  ];
  const header = document.querySelector('[data-portal-root]');
  const root = new URL(header.dataset.portalRoot, location.href);
  const picker = header.querySelector('.portal-picker');
  const summary = picker.querySelector('summary');
  const links = header.querySelector('.portal-menu-links');
  const storageKey = `improformats.catalog-return:${root.pathname}`;
  const isCatalog = location.pathname === root.pathname || location.pathname === `${root.pathname}index.html`;

  function createIcon(pathData) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('class', 'portal-icon');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    icon.append(path);
    return icon;
  }

  for (const [slug, title, iconPath] of tools) {
    const link = document.createElement('a');
    link.href = new URL(`tools/${slug}/`, root).href;
    link.dataset.tool = slug;
    const label = document.createElement('span');
    label.textContent = title;
    link.append(createIcon(iconPath), label);
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
  document.addEventListener('pointerdown', event => {
    // Keep focus in the menu until its outside click is consumed below.
    if (!picker.open || header.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true });
  document.addEventListener('click', event => {
    if (!picker.open || header.contains(event.target)) return;
    picker.open = false;
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true });
  window.addEventListener('pageshow', () => {
    picker.open = false;
    if (!isCatalog) restoreCatalogLinks();
  });
})();
