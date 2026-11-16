import { expect, test } from '@playwright/test';

const tools = [
  { slug: 'bell', name: 'Звонок', button: '#bellBtn', result: null },
  { slug: 'word', name: 'Слова', button: '#nextButton', result: '#counter' },
  { slug: 'letters', name: 'Буквы', button: '#generateButton', result: '#queueCount' },
  { slug: 'emotion', name: 'Эмоции', button: '#next', result: '#counter' },
  { slug: 'rap-battle', name: 'Темы батлов', button: '#topicButton', result: '#liveTopic' },
  { slug: 'locations', name: 'Локации', button: '#nextButton', result: '#counter' },
  { slug: 'relationship', name: 'Отношения', button: '#newButton', result: '#deckCounter' },
  { slug: 'first-line', name: 'Первая реплика', button: '#newButton', result: '#progress' },
  { slug: 'genres', name: 'Жанры', button: '#draw', result: '#round-progress' },
  { slug: 'professions', name: 'Профессии', button: '#next-button', result: '#counter' },
  { slug: 'characters', name: 'Персонажи', button: '#draw', result: '#played-count' },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort());
});

test('opens the internal catalog and every tool through native links', async ({ page, context }) => {
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
  await navigation.getByRole('link', { name: 'Инструменты', exact: true }).click();
  await expect(page).toHaveURL('/tools/');
  await expect(page.getByRole('heading', { name: 'Инструменты для импровизации', exact: true })).toBeVisible();
  const cards = page.locator('.tool-card');
  await expect(cards).toHaveCount(tools.length);
  for (const tool of tools) {
    await expect(cards.filter({ hasText: tool.name })).toHaveAttribute('href', `./${tool.slug}/`);
  }
  await cards.filter({ hasText: 'Персонажи' }).click();
  await expect(page).toHaveURL('/tools/characters/');
  expect(context.pages()).toHaveLength(1);
});

test('restores the catalog search and filters after using a tool', async ({ page }) => {
  await page.goto('/?q=сцена&form=Короткая+форма&video=yes&filters=3');
  await expect(page.locator('.cue-search')).not.toHaveAttribute('inert');
  const savedUrl = page.url();
  await page.getByRole('navigation', { name: 'Быстрый запуск инструментов' })
    .getByRole('link', { name: 'Слова', exact: true }).click();
  await expect(page).toHaveURL('/tools/word/');
  await page.getByRole('navigation', { name: 'Основная навигация' })
    .getByRole('link', { name: 'Форматы', exact: true }).click();
  await expect(page).toHaveURL(savedUrl);
  await expect(page.locator('#searchInput')).toHaveValue('сцена');
  if (await page.locator('#filtersToggle').isVisible()) await page.locator('#filtersToggle').click();
  await expect(page.locator('#videoFilter')).toBeChecked();
  await expect(page.locator('#formFilters').getByRole('button', { name: 'Короткая форма', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
});

test('supports keyboard navigation without triggering the emotion generator', async ({ page }) => {
  await page.goto('/tools/emotion/');
  const count = await page.locator('#counter').textContent();
  const picker = page.locator('.portal-picker');
  const summary = picker.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(picker).toHaveAttribute('open', '');
  await expect(picker.locator('.portal-menu-links a')).toHaveCount(tools.length);
  await expect(page.locator('#counter')).toHaveText(count!);
  await page.keyboard.press('Tab');
  await expect(picker.getByRole('link', { name: 'Все инструменты', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(picker).not.toHaveAttribute('open');
  await expect(summary).toBeFocused();
  await page.keyboard.press('Space');
  await picker.getByRole('link', { name: 'Слова', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/tools/word/');
});

test('keeps navigation usable when session storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Storage blocked'); } });
  });
  await page.goto('/tools/word/');
  await page.locator('.portal-picker summary').click();
  await page.locator('.portal-menu-links').getByRole('link', { name: 'Локации', exact: true }).click();
  await expect(page).toHaveURL('/tools/locations/');
  await page.getByRole('navigation', { name: 'Основная навигация' })
    .getByRole('link', { name: 'Форматы', exact: true }).click();
  await expect(page).toHaveURL('/');
});

test('fits the navigation and menu on a 320 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const path of ['/', '/tools/', '/tools/emotion/']) {
    await page.goto(path);
    await page.locator('.portal-picker summary').click();
    const fits = await page.locator('.portal-menu').evaluate(menu => {
      const bounds = menu.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight &&
        document.documentElement.scrollWidth <= innerWidth;
    });
    expect(fits).toBe(true);
  }
});

for (const tool of tools) {
  test(`${tool.slug} loads its resources and responds to its primary action`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (new URL(response.url()).hostname === '127.0.0.1' && response.status() >= 400) {
        errors.push(`${response.status()} ${response.url()}`);
      }
    });
    await page.goto(`/tools/${tool.slug}/`);
    await expect(page.locator('.portal-brand')).toBeVisible();
    await expect(page.locator(tool.button)).toBeVisible();
    if (tool.result) {
      const previous = await page.locator(tool.result).textContent();
      await page.locator(tool.button).click();
      await expect(page.locator(tool.result)).not.toHaveText(previous!);
    } else {
      await page.locator(tool.button).click();
      await expect(page.locator(tool.button)).toHaveClass(/ringing/);
    }
    await page.locator('.portal-picker summary').click();
    await expect(page.locator('.portal-menu-links [aria-current="page"]')).toHaveText(tool.name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
