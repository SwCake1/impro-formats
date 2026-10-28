import { expect, test } from '@playwright/test';

const record = {
  id: 'test-format', title: 'Тестовый формат', description: 'Правила игры',
  moderator: null, audienceOnStage: false, props: true, furniture: 'Стулья', note: '',
  forms: ['Короткая форма'], features: [], collections: [],
};
const catalog = { schemaVersion: 3, generatedAt: '2026-10-28T00:00:00Z', records: [record] };

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort());
  await page.route('**/data/formats.json', route => route.fulfill({ json: catalog }));
});

for (const resource of ['styles.css', 'main.ts'] as const) {
  test(`shows the real page layout while ${resource} is pending`, async ({ page }, info) => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/src/${resource}`, async route => {
      await pending;
      await route.continue();
    });
    await page.goto('/?format=test-format', { waitUntil: 'commit' });
    try {
      await expect(page.locator('.hero')).toBeVisible();
      await expect(page.locator('.hero')).toHaveCSS('background-color', 'rgb(253, 251, 246)');
      await expect(page.locator('.hero h1')).toHaveText('Форматы для импровизации');
      await expect(page.locator('.cue-search')).toBeVisible();
      await expect(page.locator('.cue-search')).toHaveAttribute('inert', '');
      await expect(page.locator('#catalogLoading')).toBeVisible();
      await expect(page.locator('.format-skeleton')).toHaveCount(3);
      await expect(page.locator('#resultsHeading')).toHaveText('Загружаем форматы…');
      await expect(page.locator('#filtersToggle')).toBeDisabled();
      await expect(page.locator('#filtersContent')).toBeHidden();
      await expect(page.locator('#filtersPanel')).toHaveAttribute('aria-busy', 'true');
      if (info.project.name === 'desktop') {
        await expect(page.locator('#filtersLoading')).toBeVisible();
      } else {
        await expect(page.locator('#filtersPanel')).toBeHidden();
      }
      await expect(page.locator('.catalog-loading__retry a')).toBeHidden();
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(hasOverflow).toBe(false);
      const iconWidth = await page.locator('.cue-search__field svg').evaluate(node => node.getBoundingClientRect().width);
      expect(iconWidth).toBeLessThanOrEqual(24);
    } finally {
      release();
    }
    await expect(page.locator('#catalogLoading')).toBeHidden();
    await expect(page.locator('.format-row').first()).toBeVisible();
    await expect(page.locator('#appStyles')).toHaveAttribute('media', 'all');
    await expect(page.locator('.cue-search')).not.toHaveAttribute('inert');
    await expect(page.locator('#filtersToggle')).toBeEnabled();
    await expect(page.locator('#filtersLoading')).toBeHidden();
    await expect(page.locator('#filtersContent')).not.toHaveAttribute('hidden');
    await expect(page.locator('#filtersPanel')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#detailContent')).toBeVisible();
    if (info.project.name === 'mobile') await expect(page.locator('#detailPanel')).toBeFocused();
  });
}

test('enables search while the first catalog is still loading', async ({ page }, info) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/data/formats.json', async route => {
    await pending;
    await route.fulfill({ json: catalog });
  });
  await page.goto('/');
  try {
    await expect(page.locator('.cue-search')).not.toHaveAttribute('inert');
    await page.locator('#searchInput').fill('Тестовый');
    await expect(page.locator('#catalogLoading')).toBeVisible();
    await expect(page.locator('#emptyState')).toBeHidden();
    await expect(page.locator('#formatsList')).toHaveAttribute('aria-busy', 'true');
    if (info.project.name === 'mobile') await page.locator('#filtersToggle').click();
    await expect(page.locator('#filtersLoading')).toBeVisible();
    await expect(page.locator('#filtersContent')).toBeHidden();
  } finally {
    release();
  }
  await expect(page.locator('#catalogLoading')).toBeHidden();
  await expect(page.locator('.format-row')).toHaveCount(1);
  await expect(page.locator('#searchInput')).toHaveValue('Тестовый');
  await expect(page.locator('#filtersLoading')).toBeHidden();
  await expect(page.locator('#formFilters button').first()).toBeVisible();
});

test('shows saved formats immediately while checking the network for updates', async ({ page }) => {
  await page.addInitScript(cached => {
    localStorage.setItem('impro-formats:data:v3', JSON.stringify(cached));
  }, { schemaVersion: 3, fetchedAt: catalog.generatedAt, etag: 'old', records: [record] });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/data/formats.json', async route => {
    await pending;
    await route.fulfill({ json: catalog });
  });
  await page.goto('/');
  try {
    await expect(page.locator('.format-row')).toHaveCount(1);
    await expect(page.locator('#catalogLoading')).toBeHidden();
    await expect(page.locator('#resultsCount')).toHaveText('1');
    await expect(page.locator('#filtersLoading')).toBeHidden();
    await expect(page.locator('#filtersContent')).not.toHaveAttribute('hidden');
  } finally {
    release();
  }
});

test('opens the catalog without waiting for web fonts', async ({ page, baseURL }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let fontRequested = false;
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({
    contentType: 'text/css',
    body: `@font-face {
      font-family: 'Onest';
      font-display: swap;
      src: url('${baseURL}/test-onest.woff2') format('woff2');
    }`,
  }));
  await page.route(/\.(?:woff2?|ttf|otf)(?:\?|$)/, async route => {
    fontRequested = true;
    await pending;
    await route.abort();
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => fontRequested).toBe(true);
    await expect(page.locator('.format-row').first()).toBeVisible();
    await expect(page.locator('#catalogLoading')).toBeHidden();
  } finally {
    release();
  }
});

test('keeps the page readable and offers a retry when JavaScript fails', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/src/main.ts', route => route.abort());
  await page.goto('/');
  await expect(page.locator('.hero')).toBeVisible();
  await expect(page.locator('#catalogLoading')).toBeVisible();
  await page.locator('.catalog-loading__retry').evaluate(node => {
    node.getAnimations().forEach(animation => animation.finish());
  });
  await expect(page.getByRole('link', { name: 'Обновить страницу' })).toBeVisible();
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('keeps the header visible and explains how to enable search', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero')).toBeVisible();
    await expect(page.locator('#catalogLoading noscript p')).toBeVisible();
    await expect(page.locator('.format-skeleton').first()).toBeHidden();
    await expect(page.locator('.results__heading')).toBeHidden();
    await expect(page.locator('#filtersPanel')).toBeHidden();
  });
});
