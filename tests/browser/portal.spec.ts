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

test('opens every tool directly through the shared switcher', async ({ page, context }) => {
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
  const picker = navigation.locator('.portal-picker');
  await expect(picker.locator('summary')).toHaveText('Инструменты');
  await picker.locator('summary').click();
  await expect(picker.locator('[aria-current="page"]')).toHaveText('Форматы');
  await expect(picker.locator('.portal-menu-links a')).toHaveText(tools.map(tool => tool.name));
  for (const tool of tools) {
    if (!await picker.evaluate(element => (element as HTMLDetailsElement).open)) {
      await picker.locator('summary').click();
    }
    await picker.getByRole('link', { name: tool.name, exact: true }).click();
    await expect(page).toHaveURL(`/tools/${tool.slug}/`);
    await expect(picker.locator('summary')).toHaveText(tool.name);
    await expect(picker).not.toHaveAttribute('open');
  }
  expect(context.pages()).toHaveLength(1);
});

test('keeps profession navigation and sound controls in one row', async ({ page }) => {
  await page.goto('/tools/professions/');
  const sound = page.locator('.portal-header #sound-button');
  const summary = page.locator('.portal-picker summary');
  await expect(sound).toBeVisible();
  const soundBounds = await sound.boundingBox();
  const summaryBounds = await summary.boundingBox();
  expect(soundBounds!.y + soundBounds!.height / 2).toBe(summaryBounds!.y + summaryBounds!.height / 2);
  expect(soundBounds!.x + soundBounds!.width).toBeLessThan(summaryBounds!.x);
  const count = await page.locator('#counter').textContent();
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await sound.focus();
  await page.keyboard.press('Space');
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#counter')).toHaveText(count!);
});

test('restores the catalog search and filters after using a tool', async ({ page }) => {
  await page.goto('/?q=сцена&form=Короткая+форма&video=yes&filters=3');
  await expect(page.locator('.cue-search')).not.toHaveAttribute('inert');
  const savedUrl = page.url();
  await page.locator('.portal-picker summary').click();
  await page.locator('.portal-menu').getByRole('link', { name: 'Слова', exact: true }).click();
  await expect(page).toHaveURL('/tools/word/');
  await page.locator('.portal-picker summary').click();
  await page.locator('.portal-menu').getByRole('link', { name: 'Форматы', exact: true }).click();
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
  await expect(picker.getByRole('link', { name: 'Форматы', exact: true })).toBeFocused();
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
  await page.locator('.portal-picker summary').click();
  await page.locator('.portal-menu').getByRole('link', { name: 'Форматы', exact: true }).click();
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

test('dismisses the menu without activating the tool underneath', async ({ page }) => {
  await page.goto('/tools/emotion/');
  const counter = page.locator('#counter');
  const count = await counter.textContent();
  const picker = page.locator('.portal-picker');
  await picker.locator('summary').click();
  await page.locator('#next').click();
  await expect(picker).not.toHaveAttribute('open');
  await expect(counter).toHaveText(count!);
  await page.locator('#next').click();
  await expect(counter).not.toHaveText(count!);
});

test('consumes the dismissal pointerdown before a tool can play a sound', async ({ page }) => {
  await page.goto('/tools/genres/');
  const draw = page.locator('#draw');
  await draw.evaluate(element => element.addEventListener('pointerdown', () => {
    element.setAttribute('data-pointer-received', 'true');
  }));
  const count = await page.locator('#round-progress').textContent();
  await page.locator('.portal-picker summary').click();
  await draw.click();
  await expect(draw).not.toHaveAttribute('data-pointer-received');
  await expect(page.locator('#round-progress')).toHaveText(count!);
  await draw.click();
  await expect(draw).toHaveAttribute('data-pointer-received', 'true');
  await expect(page.locator('#round-progress')).not.toHaveText(count!);
});

test('restores the catalog reading position after switching between tools', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.format-row').first()).toBeVisible();
  await page.evaluate(() => scrollTo(0, 800));
  const position = await page.evaluate(() => scrollY);
  await page.locator('.portal-picker summary').click();
  await page.locator('.portal-menu').getByRole('link', { name: 'Слова', exact: true }).click();
  await page.locator('.portal-picker summary').click();
  await page.locator('.portal-menu').getByRole('link', { name: 'Эмоции', exact: true }).click();
  await page.locator('.portal-picker summary').click();
  await page.locator('.portal-menu').getByRole('link', { name: 'Форматы', exact: true }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(position);
});

test('scrolls the menu on short screens and keeps all destinations reachable', async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await page.goto('/tools/bell/');
  await page.locator('.portal-picker summary').click();
  const menu = page.locator('.portal-menu');
  expect(await menu.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.bottom <= innerHeight && element.scrollHeight > element.clientHeight;
  })).toBe(true);
  await menu.getByRole('link', { name: 'Персонажи', exact: true }).click();
  await expect(page).toHaveURL('/tools/characters/');
});

test('keeps the switcher reachable when the catalog is scrolled', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.format-row').first()).toBeVisible();
  await page.evaluate(() => scrollTo(0, 800));
  expect(await page.locator('.portal-header').evaluate(header => {
    const bottom = header.getBoundingClientRect().bottom;
    return [...document.querySelectorAll('.results__heading, .filters, .detail-panel')]
      .filter(panel => getComputedStyle(panel).position === 'sticky')
      .every(panel => panel.getBoundingClientRect().top >= bottom - 1);
  })).toBe(true);
  await page.locator('.portal-picker summary').click();
  await page.locator('.portal-menu').getByRole('link', { name: 'Звонок', exact: true }).click();
  await expect(page).toHaveURL('/tools/bell/');
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
    await expect(page.locator('.portal-current-name')).toHaveText(tool.name);
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
