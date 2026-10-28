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

test('keeps a direct link during first load and opens the requested format', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/data/formats.json', async route => {
    await pending;
    await route.fulfill({ json: catalog });
  });
  await page.goto('/?format=test-format');
  try {
    await expect(page.locator('#emptyState h3')).toHaveText('Загружаем форматы…');
    await expect(page).toHaveURL(/format=test-format/);
    await expect(page.locator('#emptyReset')).toBeHidden();
  } finally {
    release();
  }
  await expect(page.locator('#detailTitle')).toHaveText(record.title);
  await expect(page.locator('#detailContent')).toBeVisible();
  await expect(page).toHaveURL(/format=test-format/);
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
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute('aria-pressed', 'false');
});

test('traps focus in the mobile dialog and restores it when closed', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile');
  await page.goto('/');
  const row = page.locator('[data-id="test-format"]');
  await row.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeFocused();
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

test('copies the current link with the primary clipboard API', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => {
        (window as Window & { copiedLink?: string }).copiedLink = text;
      } },
    });
  });
  await page.goto('/?format=test-format');
  await page.locator('#copyLink').click();
  await expect(page.locator('#toast')).toHaveText('Ссылка скопирована');
  expect(await page.evaluate(() => (window as Window & { copiedLink?: string }).copiedLink)).toBe(page.url());
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

test('does not load analytics in development', async ({ page }) => {
  const analytics: string[] = [];
  page.on('request', request => {
    if (/mc\.yandex\.ru|vercel-scripts|_vercel\/insights/.test(request.url())) analytics.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('.format-row')).toHaveCount(2);
  expect(analytics).toEqual([]);
});
