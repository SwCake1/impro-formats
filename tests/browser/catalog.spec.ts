import { expect, test } from '@playwright/test';

const record = {
  id: 'test-format', title: 'Тестовый формат', description: 'Правила игры',
  moderator: null, audienceOnStage: false, props: true, furniture: 'Стулья', note: '',
  forms: ['Короткая форма'], features: ['Музыкальные'], collections: ['JAM'],
};
const catalog = {
  schemaVersion: 3, generatedAt: '2026-10-28T00:00:00Z',
  records: [record, { ...record, id: 'second-format', title: 'Другой формат', features: [] }],
};

test.beforeEach(async ({ page }) => {
  // Keep tests local, including fonts and analytics.
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort());
  await page.route('**/data/formats.json', route => route.fulfill({ json: catalog }));
});

test('shows a complete format below the mobile results toolbar', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile');
  await page.setViewportSize({ width: 390, height: 664 });
  await page.route('**/data/formats.json', route => route.fulfill({
    json: {
      ...catalog,
      records: [{
        ...record,
        description: 'Модератор берёт у зрителей несколько жанров. Актёры начинают сцену, '
          + 'а по сигналу продолжают историю в другом жанре. Игра заканчивается, '
          + 'когда актёры использовали все жанры из списка.',
      }],
    },
  }));
  await page.goto('/');

  const toolbar = page.locator('.results__heading');
  const toggle = toolbar.getByRole('button', { name: 'Фильтры', exact: true });
  const panel = page.locator('#filtersPanel');
  await expect(toolbar.getByRole('heading')).toHaveText('1 формат');
  await expect(toggle).toBeInViewport();
  await expect(page.locator('.format-row').first()).toBeInViewport({ ratio: 1 });

  await toggle.press('Enter');
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await panel.getByRole('button', { name: 'Показать 1 формат', exact: true }).click();
  await expect(toolbar.getByRole('heading')).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('keeps mobile stage conditions collapsed until requested', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile');
  await page.setViewportSize({ width: 400, height: 741 });
  await page.goto('/');
  await expect(page.locator('.format-row')).toHaveCount(2);
  await page.locator('#filtersToggle').click();

  const panel = page.locator('#filtersPanel');
  const conditions = panel.getByRole('button', { name: 'Условия на сцене', exact: true });
  const props = panel.locator('#propsFilter');
  await expect(conditions).toHaveAttribute('aria-expanded', 'false');
  await expect(props).toBeHidden();
  await expect(panel.getByRole('button', { name: 'Показать 2 формата' })).toBeInViewport({ ratio: 1 });

  await conditions.press('Enter');
  await props.selectOption('yes');
  await expect(page.locator('#conditionsCount')).toHaveText('· 1');
  await conditions.press('Space');
  await expect(props).toBeHidden();
  await expect(page).toHaveURL(/props=yes/);
  await expect(page.getByRole('button', { name: 'Убрать фильтр: С реквизитом' })).toBeVisible();
});

test('keeps a direct link during first load and opens the requested format', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/data/formats.json', async route => {
    await pending;
    await route.fulfill({ json: catalog });
  });
  await page.goto('/?format=test-format');
  try {
    await expect(page.locator('#resultsHeading')).toHaveText('Загружаем форматы…');
    await expect(page.locator('#catalogLoading')).toBeVisible();
    await expect(page).toHaveURL(/format=test-format/);
    await expect(page.locator('#emptyReset')).toBeHidden();
  } finally {
    release();
  }
  await expect(page.locator('#detailTitle')).toHaveText(record.title);
  await expect(page.locator('#detailContent')).toBeVisible();
  await expect(page).toHaveURL(/format=test-format/);
});

test('shows only explicit requirements with decorative icons', async ({ page }) => {
  await page.goto('/?format=test-format');
  const requirements = page.locator('#detailRequirements');
  await expect(page.getByRole('heading', { name: 'Что понадобится' })).toBeVisible();
  await expect(requirements.locator('.requirements__label')).toHaveText(['Реквизит', 'Мебель']);
  await expect(requirements.locator('.requirements__detail')).toHaveText('Стулья');
  await expect(requirements.locator('svg[aria-hidden="true"]')).toHaveCount(2);
  await expect(requirements).not.toContainText(/Не нужен|Не указано/);
});

test('puts rules before requirements and keeps the original text', async ({ page }) => {
  const sentence = 'Модератор собирает у зала жанры, а актёры меняют стиль сцены по его сигналу.';
  const longParagraph = Array.from({ length: 7 }, () => sentence).join(' ');
  const authoredParagraph = 'Первый вариант: переиграть сцену.\nВторой вариант: продолжить историю.';
  await page.route('**/data/formats.json', route => route.fulfill({
    json: {
      ...catalog,
      records: [{ ...record, description: `${longParagraph}\n\n${authoredParagraph}` }],
    },
  }));
  await page.goto('/?format=test-format');

  const paragraphs = page.locator('#detailDescription p');
  await expect(paragraphs.last()).toHaveJSProperty('textContent', authoredParagraph);
  const text = await paragraphs.allTextContents();
  expect(text.length).toBeGreaterThan(2);
  expect(text.slice(0, -1).join(' ')).toBe(longParagraph);
  const requirements = await page.locator('#detailRequirementsSection').boundingBox();
  const rules = await page.locator('#detailDescription').boundingBox();
  expect(rules!.y + rules!.height).toBeLessThan(requirements!.y);
});

test('uses video captions as link labels and opens correct URLs by keyboard', async ({ page, context }) => {
  const video = 'Показ: https://example.test/watch?v=1&lang=ru.\nРепетиция (https://example.test/clip_(part)).\nwww.example.test/video';
  await context.route('https://example.test/**', route => route.fulfill({
    contentType: 'text/html', body: '<title>Видео</title>',
  }));
  await page.route('**/data/formats.json', route => route.fulfill({
    json: { ...catalog, records: [{ ...record, video }] },
  }));
  await page.goto('/?format=test-format');
  const section = page.locator('#detailVideoSection');
  const text = page.locator('#detailVideo');
  const links = section.getByRole('link');
  await expect(section).toBeVisible();
  await expect(section.getByRole('heading', { name: 'Видео' })).toBeVisible();
  await expect(links).toHaveText(['Показ', 'Репетиция', 'www.example.test/video']);
  await expect(links.nth(0)).toHaveAttribute('href', 'https://example.test/watch?v=1&lang=ru');
  await expect(links.nth(1)).toHaveAttribute('href', 'https://example.test/clip_(part)');
  await expect(links.nth(2)).toHaveAttribute('href', 'https://www.example.test/video');
  await expect(section.locator('.detail-video__toggle')).toBeHidden();
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  expect(await text.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await links.first().focus();
  const opened = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  const popup = await opened;
  await expect(popup).toHaveURL('https://example.test/watch?v=1&lang=ru');
  await popup.close();
  await expect(page).toHaveURL(/format=test-format/);
});

test('loads video covers and expands a long list without losing captions or links', async ({ page }) => {
  const youtubeCover = 'https://i.ytimg.com/vi/Hc7WJ_MwofA/mqdefault.jpg';
  const rutubeCover = 'https://rutube.ru/api/video/286bdfe7e3b4253c4e48fff651274be9/thumbnail/?redirect=1';
  const missingCover = 'https://i.ytimg.com/vi/ztYiOiLoFJo/mqdefault.jpg';
  const caption = 'Shoot From The Hip, Tom и Sam, соперники-маслоделы';
  const video = [
    caption + ': https://www.youtube.com/watch?v=Hc7WJ_MwofA',
    'Эпизод из шоу: https://rutube.ru/video/286bdfe7e3b4253c4e48fff651274be9/',
    'Репетиция: https://vkvideo.ru/video-216021785_456239183',
    'Восьмой Arts & Improv Night: https://youtu.be/ztYiOiLoFJo',
  ].join('\n');
  const pixel = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>';
  for (const cover of [youtubeCover, rutubeCover]) {
    await page.route(url => url.href === cover, route => route.fulfill({ contentType: 'image/svg+xml', body: pixel }));
  }
  await page.route(url => url.href === missingCover, route => route.fulfill({ status: 404 }));
  await page.route('**/data/formats.json', route => route.fulfill({
    json: { ...catalog, records: [{ ...record, video }] },
  }));
  await page.goto('/?format=test-format');

  const section = page.locator('#detailVideoSection');
  const links = section.getByRole('link');
  const toggle = section.locator('.detail-video__toggle');
  await expect(section.getByRole('heading', { name: 'Видео 4' })).toBeVisible();
  await expect(links).toHaveText([caption, 'Эпизод из шоу']);
  await expect(toggle).toHaveText('Ещё 2 видео');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.scrollIntoViewIfNeeded();
  await expect(links.nth(0).locator('img')).toHaveAttribute('src', youtubeCover);
  await expect(links.nth(0).locator('img')).toHaveJSProperty('naturalWidth', 1);
  await expect(links.nth(1).locator('img')).toHaveAttribute('src', rutubeCover);
  await expect(links.nth(1).locator('img')).toHaveJSProperty('naturalWidth', 1);

  await toggle.press('Enter');
  await expect(links).toHaveText([caption, 'Эпизод из шоу', 'Репетиция', 'Восьмой Arts & Improv Night']);
  await expect(toggle).toHaveText('Свернуть');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toBeFocused();
  const last = links.last();
  await last.scrollIntoViewIfNeeded();
  await expect(last.locator('img')).toHaveCount(0);
  await expect(last.locator('.detail-video__play')).toBeVisible();
  await expect(links.nth(2).locator('img')).toHaveCount(0);
  await expect(last).toHaveAttribute('href', 'https://youtu.be/ztYiOiLoFJo');
  await expect.poll(async () => {
    const lastBox = (await last.boundingBox())!;
    const toggleBox = (await toggle.boundingBox())!;
    return toggleBox.y >= lastBox.y + lastBox.height;
  }).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Space');
  await expect(links).toHaveCount(2);
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('hides empty video fields and clears links when selecting another format', async ({ page }) => {
  await page.route('**/data/formats.json', route => route.fulfill({
    json: { ...catalog, records: [{ ...record, video: 'https://example.test/video' }, catalog.records[1]] },
  }));
  await page.goto('/?format=test-format');
  await expect(page.locator('#detailVideoSection')).toBeVisible();
  await page.locator('#closeDetail').click();
  await page.locator('[data-id="second-format"]').click();
  await expect(page.locator('#detailVideoSection')).toBeHidden();
  await expect(page.locator('#detailVideo a')).toHaveCount(0);
  await page.locator('#closeDetail').click();
  await page.locator('[data-id="test-format"]').click();
  await expect(page.locator('#detailVideo a')).toHaveCount(1);
});

test('scrolls with the additional videos while keeping the toggle in view', async ({ page }) => {
  const video = Array.from({ length: 12 }, (_, index) => `Пример ${index + 1}: https://example.test/${index}`).join('\n');
  const description = 'Сначала игроки просят зрителей предложить тему для сцены.\n\n'.repeat(30);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/data/formats.json', route => route.fulfill({
    json: { ...catalog, records: [{ ...record, description, video }] },
  }));
  await page.goto('/?format=test-format');

  const toggle = page.getByRole('button', { name: 'Ещё 10 видео' });
  const panel = page.locator('#detailPanel');
  const extra = page.locator('#detailVideoExtra');
  await toggle.scrollIntoViewIfNeeded();
  const before = await toggle.boundingBox();
  const scrollTop = await panel.evaluate(node => node.scrollTop);
  await toggle.click();

  const collapse = page.getByRole('button', { name: 'Свернуть' });
  await expect(collapse).toBeInViewport();
  const after = await collapse.boundingBox();
  const addedHeight = (await extra.boundingBox())!.height;
  const scrollDelta = await panel.evaluate(node => node.scrollTop) - scrollTop;
  expect(addedHeight).toBeGreaterThan(0);
  expect(Math.abs(scrollDelta - addedHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
  expect(await extra.evaluate(node => node.getAnimations().length)).toBe(0);
});

test('renders video notes, markup and unsupported URLs as plain text', async ({ page }) => {
  const video = 'Видео ещё в монтаже\n<img src=x onerror="alert(1)">\njavascript:alert(1)\ndata:text/html,<script>alert(1)</script>\nhttps://';
  await page.route('**/data/formats.json', route => route.fulfill({
    json: { ...catalog, records: [{ ...record, video }] },
  }));
  await page.goto('/?format=test-format');
  await expect(page.locator('#detailVideoSection')).toBeVisible();
  await expect(page.locator('.detail-video__note')).toHaveJSProperty('textContent', video);
  await expect(page.locator('#detailVideo').locator('a, img, script')).toHaveCount(0);
});

for (const [name, requirements] of Object.entries({
  negative: { moderator: false, audienceOnStage: false, props: false, furniture: '  нЕТ  ' },
  unknown: { moderator: null, audienceOnStage: null, props: null, furniture: '' },
})) {
  test(`hides the whole requirements section when all values are ${name}`, async ({ page }) => {
    await page.route('**/data/formats.json', route => route.fulfill({
      json: { ...catalog, records: [{ ...record, ...requirements }] },
    }));
    await page.goto('/?format=test-format');
    await expect(page.locator('#detailContent')).toBeVisible();
    await expect(page.locator('#detailRequirementsSection')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Что понадобится' })).toBeHidden();
    await expect(page.locator('#detailRequirements li')).toHaveCount(0);
  });
}

test('updates requirements when switching between formats with and without them', async ({ page }) => {
  await page.route('**/data/formats.json', route => route.fulfill({
    json: { ...catalog, records: [
      { ...record, moderator: true, audienceOnStage: true, furniture: 'Столы, Стулья' },
      { ...catalog.records[1], props: false, furniture: 'Нет' },
    ] },
  }));
  await page.goto('/?format=test-format');
  const requirements = page.locator('#detailRequirements .requirements__label');
  await expect(requirements).toHaveText(['Модератор', 'Зритель на сцене', 'Реквизит', 'Мебель']);
  await expect(page.locator('#detailRequirements .requirements__detail')).toHaveText('Столы, Стулья');
  await page.locator('#closeDetail').click();
  await page.locator('[data-id="second-format"]').click();
  await expect(page.locator('#detailTitle')).toHaveText('Другой формат');
  await expect(page.locator('#detailRequirementsSection')).toBeHidden();
  await page.locator('#closeDetail').click();
  await page.locator('[data-id="test-format"]').click();
  await expect(page.locator('#detailRequirementsSection')).toBeVisible();
  await expect(requirements).toHaveCount(4);
});

test('waits for fresh data when a direct link is missing from the old cache', async ({ page }) => {
  await page.addInitScript(cached => {
    localStorage.setItem('impro-formats:data:v3', JSON.stringify(cached));
  }, { schemaVersion: 3, fetchedAt: catalog.generatedAt, etag: 'old', records: [catalog.records[1]] });
  await page.goto('/?format=test-format');
  await expect(page.locator('#detailTitle')).toHaveText(record.title);
  await expect(page.locator('#detailContent')).toBeVisible();
  await expect(page).toHaveURL(/format=test-format/);
});

test('keeps the requested format after a failed load and retry', async ({ page }) => {
  let attempt = 0;
  await page.route('**/data/formats.json', route => ++attempt === 1
    ? route.fulfill({ status: 503 }) : route.fulfill({ json: catalog }));
  await page.goto('/?format=test-format');
  await expect(page.locator('#emptyState h3')).toHaveText('Не удалось загрузить форматы');
  await expect(page.locator('#filtersLoading')).toBeHidden();
  await expect(page).toHaveURL(/format=test-format/);
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(page.locator('#detailTitle')).toHaveText(record.title);
  await expect(page.locator('#detailContent')).toBeVisible();
});

test('clears a missing format only after a successful load', async ({ page }) => {
  await page.goto('/?format=missing-format');
  await expect(page.locator('.format-row')).toHaveCount(2);
  await expect(page).not.toHaveURL(/format=/);
  await expect(page.locator('#detailContent')).toBeHidden();
});

test('keeps rows and keyboard focus when selecting a format on desktop', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/');
  const row = page.locator('[data-id="test-format"]');
  await row.focus();
  const original = await row.elementHandle();
  await page.keyboard.press('Enter');
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: record.title })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute('aria-pressed', 'false');
});

test('opens a selected desktop format on a second list click', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/');
  const row = page.locator('[data-id="test-format"]');
  const dialog = page.getByRole('dialog', { name: record.title });
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog).toBeHidden();
  await row.click();
  await expect(dialog).toBeFocused();
  await dialog.getByRole('button', { name: 'Свернуть карточку' }).click();
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-id="second-format"]').dblclick();
  await expect(page.getByRole('dialog', { name: 'Другой формат' })).toBeFocused();
  await expect(page).toHaveURL('/?format=second-format');
});

test('centers a shared format on desktop and closes it back to the catalog', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/?format=test-format');
  const dialog = page.getByRole('dialog', { name: record.title });
  await expect(dialog).toBeFocused();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByRole('heading', { name: record.title })).toBeVisible();
  await expect(dialog.getByRole('button', { name: record.title })).toHaveCount(0);
  await expect(page.locator('#detailBackdrop')).toBeVisible();
  await expect.poll(() => dialog.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return Math.round(Math.max(
      Math.abs(bounds.left + bounds.width / 2 - innerWidth / 2),
      Math.abs(bounds.top + bounds.height / 2 - innerHeight / 2),
    ));
  })).toBeLessThanOrEqual(1);

  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Закрыть карточку' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL('/');
  await expect(page.locator('[data-id="test-format"]')).toBeFocused();
  await expect(page.locator('#detailBackdrop')).toBeHidden();
  await page.goBack();
  await expect(dialog).toBeFocused();
  await page.mouse.click(1, 1);
  await expect(dialog).toBeHidden();
});

test('expands from the desktop title and returns to the same part of the rules', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const description = Array.from({ length: 25 }, (_, index) =>
    `Раунд ${index + 1}. ${'Игроки продолжают сцену по сигналу ведущего. '.repeat(5)}`).join('\n\n');
  await page.route('**/data/formats.json', route => route.fulfill({
    json: { ...catalog, records: [{ ...record, description }] },
  }));
  await page.goto('/');
  const row = page.locator('[data-id="test-format"]');
  await row.click();
  const panel = page.locator('#detailPanel');
  const title = panel.getByRole('button', { name: record.title });
  const dialog = page.getByRole('dialog', { name: record.title });
  await expect(dialog).toBeHidden();
  await expect(title).toHaveCSS('text-decoration-line', 'none');
  await title.hover();
  await expect(title).toHaveCSS('text-decoration-line', 'underline');
  await title.click();
  await expect(dialog).toBeFocused();
  await expect(title).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(title).toBeFocused();
  await expect(dialog).toBeHidden();

  await title.press('Enter');
  await expect(dialog).toBeFocused();
  await panel.evaluate(node => {
    const edge = node.querySelector('.detail-panel__edge--top')!;
    const paragraph = node.querySelectorAll('#detailDescription p')[8];
    node.scrollTop += paragraph.getBoundingClientRect().top - edge.getBoundingClientRect().bottom + 10;
  });
  const visibleParagraph = () => panel.evaluate(node => {
    const edgeBottom = node.querySelector('.detail-panel__edge--top')!.getBoundingClientRect().bottom;
    return [...node.querySelectorAll('#detailDescription p')]
      .findIndex(paragraph => paragraph.getBoundingClientRect().bottom > edgeBottom);
  });
  await expect.poll(visibleParagraph).toBe(8);
  const bounds = (await panel.boundingBox())!;
  const topEdge = dialog.locator('.detail-panel__edge--top');
  const bottomEdge = dialog.locator('.detail-panel__edge--bottom');
  await expect.poll(async () => (await topEdge.boundingBox())?.y).toBe(bounds.y);
  await expect(bottomEdge).toHaveCSS('height', '14px');
  await expect.poll(async () => {
    const edge = (await bottomEdge.boundingBox())!;
    return edge.y + edge.height;
  }).toBe(bounds.y + bounds.height);
  await expect(page).toHaveURL('/?format=test-format');

  await dialog.getByRole('button', { name: 'Свернуть карточку' }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByRole('button', { name: 'Закрыть карточку' })).toBeFocused();
  await expect.poll(visibleParagraph).toBe(8);
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL('/?format=test-format');
  await page.goBack();
  await page.goForward();
  await expect(title).toBeVisible();
});

test('traps focus in the mobile dialog and restores it when closed', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile');
  await page.goto('/');
  const row = page.locator('[data-id="test-format"]');
  await row.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeFocused();
  await expect(dialog.getByRole('button', { name: record.title })).toHaveCount(0);
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#copyLink')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#closeDetail')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#copyLink')).toBeFocused();
  await page.locator('#searchInput').evaluate((node: HTMLInputElement) => node.focus());
  await expect(page.locator('#copyLink')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  await expect(dialog).toBeHidden();
});

test('keeps the format dialog scrollable after rotating a phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile');
  await page.route('**/data/formats.json', route => route.fulfill({
    json: { ...catalog, records: [{ ...record, description: `${record.description}. `.repeat(80) }] },
  }));
  await page.goto('/?format=test-format');
  const dialog = page.getByRole('dialog', { name: record.title });
  await expect(dialog).toBeInViewport({ ratio: 1 });

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(dialog).toBeInViewport({ ratio: 1 });
  const copyLink = dialog.getByRole('button', { name: 'Копировать ссылку' });
  await expect(copyLink).not.toBeInViewport();
  await dialog.evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
  await expect(copyLink).toBeInViewport({ ratio: 1 });
  const copyBounds = (await copyLink.boundingBox())!;
  const fade = (await dialog.locator('.detail-panel__edge--bottom').boundingBox())!;
  expect(copyBounds.y + copyBounds.height).toBeLessThanOrEqual(fade.y);
  const close = dialog.getByRole('button', { name: 'Закрыть карточку' });
  await expect(close).toBeInViewport({ ratio: 1 });
  const closeBounds = (await close.boundingBox())!;
  const descriptionBounds = (await dialog.locator('#detailDescription').boundingBox())!;
  expect(closeBounds.x).toBeGreaterThanOrEqual(descriptionBounds.x + descriptionBounds.width);
});

test('handles dialog focus on direct links, history and viewport changes', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile');
  await page.goto('/?format=test-format');
  await expect(page.locator('#detailPanel')).toBeFocused();
  await page.locator('#closeDetail').click();
  await expect(page.locator('[data-id="test-format"]')).toBeFocused();
  await page.goBack();
  await expect(page.locator('#detailPanel')).toBeFocused();
  await page.goForward();
  await expect(page.locator('[data-id="test-format"]')).toBeFocused();
  await page.goBack();
  await expect(page.locator('#detailPanel')).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#detailPanel')).toHaveAttribute('aria-modal', 'true');
  await page.locator('#closeDetail').click();
  await page.locator('[data-id="test-format"]').click();
  await expect(page.locator('#detailPanel')).not.toHaveAttribute('aria-modal');
  await page.locator('#searchInput').focus();
  await expect(page.locator('#searchInput')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#detailPanel')).toBeFocused();
});

test('does not rebuild the cached catalog when the ETag is unchanged', async ({ page }) => {
  await page.addInitScript(cached => {
    localStorage.setItem('impro-formats:data:v3', JSON.stringify(cached));
  }, { schemaVersion: 3, fetchedAt: catalog.generatedAt, etag: 'same', records: catalog.records });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/data/formats.json', async route => {
    await pending;
    await route.fulfill({ body: 'Must not be parsed', headers: { ETag: 'same' } });
  });
  await page.goto('/?format=missing-format');
  await expect(page.locator('.format-row')).toHaveCount(2);
  const original = await page.locator('.format-row').first().elementHandle();
  release();
  await expect(page).not.toHaveURL(/format=/);
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.locator('#toast')).toBeHidden();
});

test('preserves the cached catalog when fresh data is invalid', async ({ page }) => {
  await page.addInitScript(cached => {
    localStorage.setItem('impro-formats:data:v3', JSON.stringify(cached));
  }, { schemaVersion: 3, fetchedAt: catalog.generatedAt, etag: 'old', records: catalog.records });
  await page.route('**/data/formats.json', route => route.fulfill({ json: { ...catalog, records: [] } }));
  await page.goto('/?format=test-format');
  await expect(page.locator('#toast')).toHaveText('Не удалось обновить данные — показываем сохранённые');
  await expect(page.locator('.format-row')).toHaveCount(2);
  await expect(page.locator('#detailTitle')).toHaveText(record.title);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('impro-formats:data:v3')!));
  expect(stored.records).toEqual(catalog.records);
});

test('copies only the direct format URL from a filtered catalog', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => {
        (window as Window & { copiedLink?: string }).copiedLink = text;
      } },
    });
  });
  await page.goto('/?props=yes');
  await page.locator('#searchInput').fill('Тестовый');
  await page.locator('.format-row[data-id="test-format"]').click();
  await expect(page).toHaveURL(/\?q=[^&]+&props=yes&format=test-format$/);
  await page.locator('#copyLink').click();
  await expect(page.locator('#toast')).toHaveText('Ссылка скопирована');
  const copiedLink = await page.evaluate(() => (window as Window & { copiedLink?: string }).copiedLink);
  expect(copiedLink).toBe(new URL('/?format=test-format', page.url()).href);
  await expect(page).toHaveURL(/\?q=[^&]+&props=yes&format=test-format$/);

  const recipient = await page.context().newPage();
  await recipient.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort());
  await recipient.route('**/data/formats.json', route => route.fulfill({ json: catalog }));
  await recipient.goto(copiedLink!);
  await expect(recipient.locator('#detailContent')).toBeVisible();
  await expect(recipient.locator('#detailTitle')).toHaveText(record.title);
  await expect(recipient.locator('.format-row')).toHaveCount(2);
});

test('resizes panels with the keyboard and restores their saved width', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/');
  const handle = page.locator('#filtersResizeHandle');
  await handle.focus();
  const width = Number(await handle.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', String(width + 16));
  await page.reload();
  await expect(handle).toHaveAttribute('aria-valuenow', String(width + 16));
});

for (const fallback of ['success', 'false', 'throw'] as const) {
  test(`reports clipboard fallback ${fallback} accurately`, async ({ page }) => {
    await page.addInitScript(result => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => { throw new Error('Permission denied'); } },
      });
      document.execCommand = () => {
        if (result === 'throw') throw new Error('Copy unavailable');
        return result === 'success';
      };
    }, fallback);
    await page.goto('/?format=test-format');
    await page.locator('#copyLink').click();
    await expect(page.locator('#toast')).toHaveText(fallback === 'success'
      ? 'Ссылка скопирована' : 'Не удалось скопировать ссылку. Скопируйте адрес из строки браузера.');
    await expect(page.locator('#copyLink')).toBeFocused();
    await expect(page.locator('textarea')).toHaveCount(0);
  });
}

test('reuses filter buttons during search and preserves their selection', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('.format-row')).toHaveCount(2);
  if (info.project.name === 'mobile') await page.locator('#filtersToggle').click();
  const button = page.getByRole('button', { name: 'Музыкальные', exact: true });
  const original = await button.elementHandle();
  await page.locator('#searchInput').fill('Тестовый');
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  await button.click();
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.format-row')).toHaveCount(1);
  await page.locator('#clearSearch').click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
});

test('filters formats with videos by keyboard, restores the URL and resets the filter', async ({ page }, info) => {
  await page.route('**/data/formats.json', route => route.fulfill({
    json: { ...catalog, records: [{ ...record, video: 'https://example.test/video' }, catalog.records[1]] },
  }));
  await page.goto('/');
  await expect(page.locator('.format-row')).toHaveCount(2);
  if (info.project.name === 'mobile') await page.locator('#filtersToggle').click();
  const checkbox = page.getByRole('checkbox', { name: 'Есть видео' });
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeFocused();
  await expect(page.locator('.format-row')).toHaveCount(1);
  await expect(page.locator('.format-row')).toHaveAttribute('data-id', record.id);
  await expect(page.locator('#activeFiltersCount')).toHaveText('1');
  await expect(page).toHaveURL(/video=yes/);
  await page.reload();
  await expect(page.locator('.format-row')).toHaveCount(1);
  if (info.project.name === 'mobile') await page.locator('#filtersToggle').click();
  await expect(checkbox).toBeChecked();
  await page.getByRole('button', { name: 'Убрать фильтр: Есть видео', exact: true }).click();
  await expect(checkbox).not.toBeChecked();
  await expect(page.locator('.format-row')).toHaveCount(2);
  await expect(page).not.toHaveURL(/video=/);
  await checkbox.check();
  await page.locator(info.project.name === 'mobile' ? '#resetFilters' : '#resetFiltersTop').click();
  await expect(checkbox).not.toBeChecked();
  await expect(page.locator('.format-row')).toHaveCount(2);
  await expect(page.locator('#activeFiltersCount')).toBeHidden();
  await expect(page).not.toHaveURL(/video=/);
});

test('hides the collections section while keeping shared collection filters removable', async ({ page }, info) => {
  await page.goto('/?filters=3&collection=JAM');
  await expect(page.locator('.format-row')).toHaveCount(2);
  if (info.project.name === 'mobile') await page.locator('#filtersToggle').click();
  await expect(page.locator('#collectionsDisclosure')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Подборки' })).toHaveCount(0);
  const selected = page.getByRole('button', { name: 'Убрать фильтр: Подборка: JAM', exact: true });
  await expect(selected).toBeVisible();
  await selected.click();
  await expect(page).not.toHaveURL(/collection=/);
  await expect(page.locator('#activeFiltersCount')).toBeHidden();
});

test('does not load analytics in development', async ({ page }) => {
  const analytics: string[] = [];
  page.on('request', request => {
    if (/mc\.yandex\.ru|vercel-scripts|_vercel\/insights/.test(request.url())) analytics.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('.format-row')).toHaveCount(2);
  expect(analytics).toEqual([]);
});

test('opens sources over the catalog and restores focus and reading position', async ({ page }) => {
  await page.goto('/?q=Тестовый');
  await expect(page.locator('.format-row')).toHaveCount(1);
  const trigger = page.getByRole('button', { name: 'Источники и благодарности', exact: true });
  await trigger.scrollIntoViewIfNeeded();
  const readingPosition = await page.evaluate(() => scrollY);
  const catalogUrl = page.url();
  const dialog = page.getByRole('dialog', { name: 'Источники и благодарности' });
  const close = dialog.getByRole('button', { name: 'Закрыть', exact: true });
  const table = dialog.getByRole('link', { name: 'таблице форматов', exact: true });
  const boris = dialog.getByRole('link', { name: 'Борис Базаров', exact: false });

  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(catalogUrl);
  await expect(close).toBeFocused();
  await expect(dialog.getByRole('link', { name: 'Алла Москвичёва', exact: false })).toBeVisible();
  await expect(table).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/1AfoTVt6XzkpTk8UZAfBpzQlpSSKTyRkziyt4cglOMKU/edit');
  await expect(dialog.getByRole('heading', { level: 3 }).nth(1)).toContainText('Борис Базаров');
  await expect(boris).toHaveAttribute('href', 'https://t.me/britvennik');
  await expect(dialog.getByText('Спасибо за подборку видео', { exact: false })).toBeVisible();
  await expect(dialog).toHaveCSS('font-size', '12px');
  await expect(table).toHaveCSS('font-weight', '400');
  await expect(table).toHaveCSS('display', 'inline');
  const author = dialog.getByRole('link', { name: 'Алла Москвичёва', exact: false });
  await page.locator('#searchInput').evaluate(node => node.focus());
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(author).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(table).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(boris).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(table).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(author).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(readingPosition);

  await trigger.click();
  await close.click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('heading', { name: 'Источники и благодарности', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(1, 1);
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator('#searchInput')).toHaveValue('Тестовый');
});

test('keeps the selected format open when Escape closes sources', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/');
  await page.locator('[data-id="test-format"]').click();
  await expect(page.locator('#detailContent')).toBeVisible();
  await page.getByRole('button', { name: 'Источники и благодарности', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Источники и благодарности' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sourcesDialog')).not.toHaveAttribute('open');
  await expect(page.locator('#detailContent')).toBeVisible();
  await expect(page).toHaveURL(/format=test-format/);
});
