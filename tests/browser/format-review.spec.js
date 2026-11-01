import { test as base, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderReviewHtml } from '../../scripts/generate-format-review.mjs';
const example = JSON.parse(await readFile(new URL('../../tools/format-review/example-batch.json', import.meta.url), 'utf8'));
const test = base.extend({
    openReview: async ({ page }, use, info) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const file = info.outputPath('review.html');
        await mkdir(dirname(file), { recursive: true });
        await use(async (batch = example) => {
            await writeFile(file, await renderReviewHtml(batch));
            await page.goto(pathToFileURL(file).href);
            await expect(page.locator('#batch-size')).toHaveText(String(batch.candidates.length));
        });
        expect(errors).toEqual([]);
    },
});
async function clipboard(page, mode = 'success') {
    await page.addInitScript(mode => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'missing' ? undefined : {
                writeText: async (text) => {
                    if (mode === 'denied')
                        throw new Error('Permission denied');
                    window.reviewCopied = text;
                },
            } });
    }, mode);
}
async function copied(page) {
    return page.evaluate(() => window.reviewCopied);
}
test('opens the generated file offline with editable fields and no preselection', async ({ page, openReview }) => {
    const requests = [];
    page.on('request', request => { if (/^https?:/.test(request.url()))
        requests.push(request.url()); });
    await page.route(/^https?:/, route => route.abort());
    await openReview();
    expect(page.url()).toMatch(/^file:/);
    await expect(page.locator('.candidate')).toHaveCount(3);
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 0 из 3');
    await expect(page.locator('#copy-agent')).toBeDisabled();
    await expect(page.locator('#copy-sheet')).toBeDisabled();
    const radio = page.locator('[data-candidate-id="radio"]');
    await expect(radio.getByLabel('Модератор', { exact: true })).toHaveValue('');
    await expect(radio.getByLabel('Зритель на сцене', { exact: true })).toHaveValue('');
    await expect(radio.getByLabel('Реквизит', { exact: true })).toHaveValue('');
    await radio.getByLabel('Описание для каталога', { exact: true }).fill('Первая строка\nВторая строка');
    await page.locator('[data-candidate-id="speed"]').getByLabel('Мебель', { exact: true }).fill('Стул');
    await radio.getByText('Исходный текст и источник', { exact: true }).click();
    await expect(radio.locator('.source-text')).toContainText('Ведём радио');
    await expect(radio.getByLabel('Описание для каталога', { exact: true })).toHaveValue('Первая строка\nВторая строка');
    expect(requests).toEqual([]);
});
test('shows supplied similarities as text and keeps script payloads and unsafe URLs inert', async ({ page, openReview }) => {
    const batch = structuredClone(example);
    const payload = '</script><script>window.reviewInjected=true</script><img src=x onerror=alert(1)>';
    batch.candidates[0].format.description = payload;
    batch.candidates[0].source = { label: '<b>Источник</b>', url: 'javascript:alert(1)', text: payload };
    batch.candidates[1].similarFormats.push({ id: 'second-match', title: 'Второе совпадение', description: payload, reason: payload, url: 'javascript:alert(1)' });
    await openReview(batch);
    const radio = page.locator('[data-candidate-id="radio"]');
    await expect(radio.getByLabel('Описание для каталога', { exact: true })).toHaveValue(payload);
    await radio.getByText('Исходный текст и источник', { exact: true }).click();
    await expect(radio.locator('.source-label')).toHaveText('<b>Источник</b>');
    await expect(radio.locator('a')).toHaveCount(0);
    await expect(radio.locator('.source-text')).toHaveText(payload);
    await expect(radio).toContainText('Агент не передал похожие форматы.');
    const interview = page.locator('[data-candidate-id="interview"]');
    await expect(interview.locator('.match')).toHaveCount(2);
    await expect(interview.locator('.editor-heading')).toContainText('Черновик для каталога');
    await expect(interview.locator('.context > h3')).toHaveText('В каталоге');
    await expect(interview.locator('.match-reason h5').nth(1)).toHaveText('Почему может совпадать');
    await expect(interview.locator('.match-description').nth(1)).toHaveText(payload);
    await expect(interview.locator('.match').nth(1).locator('.format-link')).toHaveCount(0);
    await expect(interview.locator('.match').nth(1).locator('[data-field="props"] .catalog-value')).toHaveText('Не передано');
    await expect(interview.locator('.match').nth(1).getByRole('button', { name: '← Обновить этот формат' })).toBeDisabled();
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.reviewInjected)).toBeUndefined();
    await expect(page.locator('.candidate img, .candidate script')).toHaveCount(0);
});
test('copies only selected records in batch order with latest edits and original context', async ({ page, openReview }) => {
    await clipboard(page);
    await openReview();
    const radio = page.locator('[data-candidate-id="radio"]');
    const interview = page.locator('[data-candidate-id="interview"]');
    await interview.getByRole('checkbox').check();
    await radio.getByRole('checkbox').check();
    await radio.getByLabel('Название формата', { exact: true }).fill('Новая радиоигра');
    await radio.getByLabel('Особенности', { exact: true }).selectOption('new');
    await radio.getByLabel('Новый тег: Особенности', { exact: true }).fill('Музыка');
    await radio.getByLabel('Новый тег: Особенности', { exact: true }).press('Enter');
    await radio.getByLabel('Особенности', { exact: true }).selectOption({ label: 'Угадайки' });
    await radio.getByLabel('Реквизит', { exact: true }).selectOption('false');
    await radio.getByLabel('Зритель на сцене', { exact: true }).selectOption('false');
    await page.locator('[data-candidate-id="speed"]').getByLabel('Название формата', { exact: true }).fill('');
    await radio.getByLabel('Описание для каталога', { exact: true }).fill('Последняя правка\nБез потери строк');
    await page.locator('#copy-agent').click();
    const selection = JSON.parse((await copied(page)));
    expect(selection.kind).toBe('format-review-selection');
    expect(selection.batchId).toBe('demo-formats');
    expect(selection.candidates.map((candidate) => candidate.candidateId)).toEqual(['radio', 'interview']);
    expect(selection.candidates[0].format).toMatchObject({
        title: 'Новая радиоигра', description: 'Последняя правка\nБез потери строк', props: false,
        features: ['Музыка', 'Угадайки'], audienceOnStage: false,
    });
    expect(selection.candidates[0].source).toEqual(example.candidates[0].source);
    expect(selection.candidates[1].similarFormats).toEqual(example.candidates[1].similarFormats);
    expect(selection.candidates[0].format).not.toHaveProperty('id');
    await interview.getByRole('checkbox').uncheck();
    await page.locator('#copy-agent').click();
    expect(JSON.parse((await copied(page))).candidates).toHaveLength(1);
    await radio.getByRole('checkbox').uncheck();
    await expect(page.locator('#copy-agent')).toBeDisabled();
});
test('blocks a selected blank title without changing the clipboard and allows correction', async ({ page, openReview }) => {
    await clipboard(page);
    await openReview();
    const card = page.locator('[data-candidate-id="radio"]');
    const title = card.getByLabel('Название формата', { exact: true });
    await card.getByRole('checkbox').check();
    await title.fill(' ');
    await page.locator('#copy-sheet').click();
    await expect(title).toBeFocused();
    await expect(title).toHaveAttribute('aria-invalid', 'true');
    await expect(card.locator('.field-error')).toBeVisible();
    expect(await copied(page)).toBeUndefined();
    await title.fill('Исправлено');
    await page.locator('#copy-agent').click();
    expect(JSON.parse((await copied(page))).candidates[0].format.title).toBe('Исправлено');
});
test('copies twelve spreadsheet columns with blank id and literal multiline text', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = structuredClone(example);
    batch.candidates = [batch.candidates[0]];
    batch.candidates[0].format = {
        title: '=1+1', description: 'Реплика "А"\nОтвет\tБ', moderator: null,
        audienceOnStage: false, props: true, furniture: '', note: '', forms: ['Короткая форма'], features: [], collections: [],
    };
    await openReview(batch);
    await page.getByRole('checkbox').check();
    await page.locator('#copy-sheet').click();
    expect(await copied(page)).toBe('\t\'=1+1\t"Реплика ""А""\nОтвет\tБ"\t\tFALSE\tTRUE\t\t\tКороткая форма\t\t\t');
    await expect(page.locator('#status')).toContainText('Скопировано.');
});
for (const mode of ['denied', 'missing']) {
    test(`offers exact manual text when clipboard is ${mode}, preserving edits and focus`, async ({ page, openReview }) => {
        await clipboard(page, mode);
        await openReview();
        const radio = page.locator('[data-candidate-id="radio"]');
        await radio.getByRole('checkbox').check();
        await radio.getByLabel('Название формата', { exact: true }).fill('Радио после ревью');
        await page.locator('#copy-agent').click();
        const field = page.getByLabel('Данные для ручного копирования');
        await expect(page.getByRole('dialog')).toBeVisible();
        const text = await field.inputValue();
        expect(JSON.parse(text).candidates[0].format.title).toBe('Радио после ревью');
        expect(await field.evaluate((node) => node.selectionEnd - node.selectionStart)).toBe(text.length);
        await expect(page.locator('#status')).not.toContainText('Скопировано.');
        await page.keyboard.press('Escape');
        await expect(page.locator('#copy-agent')).toBeFocused();
        await expect(radio.getByRole('checkbox')).toBeChecked();
        await expect(radio.getByLabel('Название формата', { exact: true })).toHaveValue('Радио после ревью');
        await page.locator('#copy-sheet').click();
        await expect(field).toHaveValue(/^\tРадио после ревью\t/);
    });
}
test('supports review by keyboard and fits the configured viewport', async ({ page, openReview }) => {
    await clipboard(page);
    await openReview();
    const radio = page.locator('[data-candidate-id="radio"]');
    await radio.getByRole('checkbox').focus();
    await page.keyboard.press('Space');
    await expect(radio.getByRole('checkbox')).toBeChecked();
    await page.keyboard.press('Shift+Tab');
    await expect(radio.getByLabel('Название формата', { exact: true })).toBeFocused();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText('Название с клавиатуры');
    for (let step = 0; step < 80; step++) {
        if (await page.locator('#copy-agent').evaluate(node => node === document.activeElement))
            break;
        await page.keyboard.press('Tab');
    }
    await expect(page.locator('#copy-agent')).toBeFocused();
    await page.keyboard.press('Enter');
    expect(JSON.parse((await copied(page))).candidates[0].format.title).toBe('Название с клавиатуры');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('shows a useful empty state', async ({ page, openReview }) => {
    await openReview({ ...example, candidates: [] });
    await expect(page.locator('#empty')).toBeVisible();
    await expect(page.locator('.candidate')).toHaveCount(0);
    await expect(page.locator('#copy-agent')).toBeDisabled();
    await expect(page.locator('#copy-sheet')).toBeDisabled();
    for (const id of ['select-all', 'clear-selection', 'expand-all', 'collapse-all']) {
        await expect(page.locator(`#${id}`)).toBeDisabled();
    }
});

test('selects catalog tags, creates and shares new choices, and exports only chosen tags', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = structuredClone(example);
    batch.classificationOptions = {
        forms: ['Короткая форма', 'Длинная форма'], features: ['Музыкальные', 'Угадайки'], collections: ['JAM'],
    };
    await openReview(batch);
    const radio = page.locator('[data-candidate-id="radio"]');
    await radio.getByLabel('Форма', { exact: true }).selectOption({ label: 'Длинная форма' });
    await radio.getByRole('button', { name: 'Убрать Форма: Короткая форма', exact: true }).click();
    await radio.getByLabel('Особенности', { exact: true }).selectOption({ label: 'Музыкальные' });
    await radio.getByLabel('Подборки', { exact: true }).selectOption({ label: 'JAM' });
    await radio.getByLabel('Особенности', { exact: true }).selectOption('new');
    const newTag = radio.getByLabel('Новый тег: Особенности', { exact: true });
    await newTag.fill('Новая особенность');
    await newTag.press('Enter');
    await expect(radio.getByRole('button', { name: 'Убрать Особенности: Новая особенность', exact: true })).toBeVisible();
    const interview = page.locator('[data-candidate-id="interview"]');
    await expect(interview.getByLabel('Особенности', { exact: true }).locator('option')).toContainText(['Добавить…', 'Музыкальные', 'Новая особенность']);
    await expect(interview.getByLabel('Подборки', { exact: true }).locator('option')).not.toContainText(['Новая особенность']);
    await radio.getByLabel('Особенности', { exact: true }).selectOption('new');
    await newTag.fill('Отменённый тег');
    await newTag.press('Escape');
    await expect(newTag).toBeHidden();
    await radio.getByRole('checkbox').check();
    await page.locator('#copy-agent').click();
    const format = JSON.parse(await copied(page)).candidates[0].format;
    expect(format.forms).toEqual(['Длинная форма']);
    expect(format.features).toEqual(['Музыкальные', 'Новая особенность']);
    expect(format.collections).toEqual(['JAM']);
});

test('selects and clears all candidates while preserving edited fields', async ({ page, openReview }) => {
    await clipboard(page);
    await openReview();
    const radio = page.locator('[data-candidate-id="radio"]');
    await radio.getByLabel('Описание для каталога', { exact: true }).fill('Правки до массового выбора');
    await page.getByRole('button', { name: 'Выделить все', exact: true }).click();
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(3);
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 3 из 3');
    await expect(page.locator('#select-all')).toBeDisabled();
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates).toHaveLength(3);
    expect(selection.candidates[0].format.description).toBe('Правки до массового выбора');
    await radio.getByRole('checkbox').uncheck();
    await expect(page.locator('#select-all')).toBeEnabled();
    await page.getByRole('button', { name: 'Убрать все выделения', exact: true }).click();
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
    await expect(page.locator('#copy-agent')).toBeDisabled();
    await expect(page.locator('#clear-selection')).toBeDisabled();
    await expect(radio.getByLabel('Описание для каталога', { exact: true })).toHaveValue('Правки до массового выбора');
});

test('collapses individual and all cards without losing drafts, source state or selected exports', async ({ page, openReview }) => {
    await clipboard(page);
    await openReview();
    const radio = page.locator('[data-candidate-id="radio"]');
    await radio.getByLabel('Описание для каталога', { exact: true }).fill('Сохраняется после сворачивания');
    await radio.getByText('Исходный текст и источник', { exact: true }).click();
    await radio.getByRole('button', { name: /^Свернуть формат/ }).click();
    await expect(radio.locator('.card-body')).toBeHidden();
    await radio.getByRole('checkbox').check();
    await radio.getByLabel('Название формата', { exact: true }).fill('Заголовок свёрнутой карточки');
    await page.getByRole('button', { name: 'Свернуть всё', exact: true }).click();
    for (const body of await page.locator('.card-body').all()) await expect(body).toBeHidden();
    await expect(page.locator('#collapse-all')).toBeDisabled();
    await page.locator('#select-all').click();
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates).toHaveLength(3);
    expect(selection.candidates[0].format).toMatchObject({ title: 'Заголовок свёрнутой карточки', description: 'Сохраняется после сворачивания' });
    await radio.getByRole('button', { name: /^Развернуть формат/ }).click();
    await expect(radio.locator('.card-body')).toBeVisible();
    await expect(radio.locator('.source-text')).toBeVisible();
    await expect(page.locator('[data-candidate-id="interview"] .card-body')).toBeHidden();
    await page.getByRole('button', { name: 'Развернуть всё', exact: true }).click();
    for (const body of await page.locator('.card-body').all()) await expect(body).toBeVisible();
    await expect(page.locator('#expand-all')).toBeDisabled();
    await expect(radio.getByLabel('Описание для каталога', { exact: true })).toHaveValue('Сохраняется после сворачивания');
});

test('compares every field, links to the existing format and keeps video in column L and agent JSON', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = structuredClone(example);
    batch.candidates[1].similarFormats[0].video = 'https://example.com/existing.mp4';
    await openReview(batch);
    const card = page.locator('[data-candidate-id="interview"]');
    const match = card.locator('.match');
    await expect(match.getByRole('link', { name: 'Открыть формат ↗' })).toHaveAttribute('href', 'https://impro-formats.vercel.app/?format=press-konferentsiya');
    await expect(match.locator('.comparison-table tbody tr')).toHaveCount(10);
    const moderator = match.locator('[data-field="moderator"]');
    await expect(moderator.locator('.draft-value')).toHaveText('Неизвестно');
    await expect(moderator.locator('.catalog-value')).toHaveText('Нет');
    await expect(moderator).toHaveClass(/is-different/);
    await card.getByLabel('Модератор', { exact: true }).selectOption('false');
    await expect(moderator).not.toHaveClass(/is-different/);
    await expect(match.locator('[data-field="forms"] .catalog-value')).toHaveText('Короткая форма');
    await expect(match.locator('[data-field="features"] .catalog-value')).toHaveText('Угадайки');
    await expect(match.locator('[data-field="video"] .catalog-value a')).toHaveAttribute('href', 'https://example.com/existing.mp4');
    const videos = 'https://example.com/one.mp4\nhttps://example.com/two.mp4';
    await card.getByLabel('Видео', { exact: true }).fill(videos);
    await expect(card.locator('.video-preview a')).toHaveCount(2);
    await expect(match.locator('[data-field="video"] .draft-value a')).toHaveCount(2);
    await card.getByRole('checkbox').check();
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates[0].format.video).toBe(videos);
    expect(selection.candidates[0].similarFormats).toEqual(batch.candidates[1].similarFormats);
    await page.locator('#copy-sheet').click();
    const tsv = await copied(page);
    expect(tsv.split('\t')).toHaveLength(12);
    expect(tsv.endsWith('"https://example.com/one.mp4\nhttps://example.com/two.mp4"')).toBe(true);
});

test('shows the original text verbatim and marks an edited draft without altering the source', async ({ page, openReview }) => {
    await openReview();
    const radio = page.locator('[data-candidate-id="radio"]');
    await radio.getByText('Исходный текст и источник', { exact: true }).click();
    const original = example.candidates[0].source.text;
    await expect(radio.locator('.source-text')).toHaveText(original);
    await expect(radio.getByLabel('Описание для каталога', { exact: true })).toHaveValue(original);
    await expect(radio.locator('.description-note')).toBeHidden();
    await radio.getByLabel('Описание для каталога', { exact: true }).fill('Правка пользователя');
    await expect(radio.locator('.description-note')).toBeVisible();
    await expect(radio.locator('.source-text')).toHaveText(original);
    await radio.getByLabel('Описание для каталога', { exact: true }).fill(original);
    await expect(radio.locator('.description-note')).toBeHidden();
});

test('updates from catalog values, exports a patch and restores each mode draft', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = structuredClone(example);
    const originalVideo = 'https://example.com/existing.mp4';
    batch.candidates[1].similarFormats[0].video = originalVideo;
    await openReview(batch);
    const card = page.locator('[data-candidate-id="interview"]');
    await card.getByLabel('Название формата', { exact: true }).fill('Название нового формата');
    await card.getByLabel('Видео', { exact: true }).fill('https://example.com/proposal.mp4');
    await card.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    await expect(card.getByRole('checkbox')).not.toBeChecked();
    await expect(card.locator('.update-mode-panel')).toBeVisible();
    await expect(card.getByLabel('Название формата', { exact: true })).toHaveValue('Пресс-конференция');
    await expect(card.getByLabel('Модератор', { exact: true })).toHaveValue('false');
    await expect(card.getByLabel('Мебель', { exact: true })).toHaveValue('Нет');
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue(originalVideo);
    await expect(card.locator('.update-change-count')).toHaveText('Изменено полей: 0');
    await card.getByRole('checkbox').check();
    await expect(page.locator('#copy-sheet')).toBeDisabled();
    await page.locator('#copy-agent').click();
    await expect(page.locator('#status')).toContainText('нет изменений');
    expect(await copied(page)).toBeUndefined();
    const editedVideo = originalVideo + '\nhttps://example.com/added.mp4';
    await card.getByLabel('Видео', { exact: true }).fill(editedVideo);
    await expect(card.locator('.update-change-count')).toHaveText('Изменено полей: 1');
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.schemaVersion).toBe(2);
    expect(selection.candidates[0]).toMatchObject({
        action: 'update', targetId: 'press-konferentsiya',
        changes: { video: { before: originalVideo, after: editedVideo } },
    });
    expect(Object.keys(selection.candidates[0].changes)).toEqual(['video']);
    expect(selection.candidates[0]).not.toHaveProperty('format');
    await card.getByRole('button', { name: 'Вернуться к новому формату', exact: true }).click();
    await expect(card.getByLabel('Название формата', { exact: true })).toHaveValue('Название нового формата');
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/proposal.mp4');
    await expect(page.locator('#copy-sheet')).toBeEnabled();
    await card.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue(editedVideo);
    await expect(card.locator('.update-change-count')).toHaveText('Изменено полей: 1');
});

test('keeps updates out of table copying, including invalid or unchanged update drafts', async ({ page, openReview }) => {
    await clipboard(page);
    await openReview();
    const radio = page.locator('[data-candidate-id="radio"]');
    const update = page.locator('[data-candidate-id="interview"]');
    await radio.getByRole('checkbox').check();
    await update.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    await update.getByRole('checkbox').check();
    await update.getByLabel('Дополнительно', { exact: true }).fill('Дополнение к существующему формату');
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates.map(candidate => candidate.action)).toEqual(['create', 'update']);
    await update.getByLabel('Название формата', { exact: true }).fill('');
    await expect(page.locator('#copy-sheet')).toContainText('(1)');
    await page.locator('#copy-sheet').click();
    const tsv = await copied(page);
    expect(tsv).toContain('\tРадио из будущего\t');
    expect(tsv).not.toContain('Дополнение к существующему формату');
    await page.locator('#copy-agent').click();
    await expect(update.getByLabel('Название формата', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    expect(await copied(page)).toBe(tsv);
});

test('keeps independent edits when choosing between two catalog targets', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = structuredClone(example);
    batch.candidates[1].similarFormats.push({
        ...structuredClone(batch.candidates[1].similarFormats[0]),
        id: 'other-format', title: 'Другой формат', note: 'Исходная заметка второго', video: 'https://example.com/other.mp4',
    });
    await openReview(batch);
    const card = page.locator('[data-candidate-id="interview"]');
    const first = card.locator('.match').nth(0);
    const second = card.locator('.match').nth(1);
    await first.getByRole('button', { name: '← Обновить этот формат' }).click();
    await card.getByLabel('Дополнительно', { exact: true }).fill('Правка первого');
    await second.getByRole('button', { name: '← Обновить этот формат' }).click();
    await expect(card.getByLabel('Название формата', { exact: true })).toHaveValue('Другой формат');
    await expect(card.getByLabel('Дополнительно', { exact: true })).toHaveValue('Исходная заметка второго');
    await card.getByLabel('Видео', { exact: true }).fill('https://example.com/changed-other.mp4');
    await first.getByRole('button', { name: '← Обновить этот формат' }).click();
    await expect(card.getByLabel('Дополнительно', { exact: true })).toHaveValue('Правка первого');
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('');
    await card.getByRole('checkbox').check();
    await page.locator('#copy-agent').click();
    const record = JSON.parse(await copied(page)).candidates[0];
    expect(record.targetId).toBe('press-konferentsiya');
    expect(Object.keys(record.changes)).toEqual(['note']);
});

test('keeps finding values visible and transfers fields individually into an update', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = structuredClone(example);
    const candidate = batch.candidates[1];
    Object.assign(candidate.format, {
        video: 'https://example.com/old.mp4\nhttps://example.com/new.mp4\nhttps://example.com/new.mp4',
        forms: ['Форма из находки'], features: ['Угадайки', 'Новая особенность'], collections: ['Новая подборка'],
        furniture: 'Два стула', moderator: null, audienceOnStage: false, props: true,
        note: '<img src=x onerror=alert(1)>',
    });
    const target = candidate.similarFormats[0];
    Object.assign(target, { video: 'https://example.com/old.mp4', forms: ['Короткая форма'],
        features: ['Угадайки'], collections: ['JAM'], note: 'Сохранить исходную заметку' });
    await openReview(batch);
    const card = page.locator('[data-candidate-id="interview"]');
    const finding = key => card.locator(`[data-finding-field="${key}"]`);
    await expect(finding('video')).toBeHidden();
    await card.getByLabel('Описание для каталога', { exact: true }).fill('Отредактированное описание находки');
    await card.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    await expect(finding('description').locator('.finding-value')).toHaveText('Отредактированное описание находки');
    await expect(finding('title').locator('.finding-value')).toHaveText(candidate.format.title);
    await expect(finding('video').locator('a')).toHaveCount(3);
    await expect(card.getByLabel('Описание для каталога', { exact: true })).toHaveValue(target.description);
    await expect(card.getByRole('checkbox')).not.toBeChecked();
    await card.getByRole('button', { name: 'Добавить из находки: Видео', exact: true }).click();
    const videos = 'https://example.com/old.mp4\nhttps://example.com/new.mp4';
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue(videos);
    await expect(finding('video').getByRole('button')).toBeDisabled();
    for (const label of ['Форма', 'Особенности', 'Подборки']) {
        await card.getByRole('button', { name: `Добавить из находки: ${label}`, exact: true }).click();
    }
    for (const key of ['forms', 'features', 'collections']) await expect(finding(key).getByRole('button')).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Убрать Форма: Короткая форма', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Убрать Форма: Форма из находки', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Убрать Особенности: Угадайки', exact: true })).toHaveCount(1);
    // Copying one field preserves every other field, including the original catalog description.
    await expect(card.getByLabel('Описание для каталога', { exact: true })).toHaveValue(target.description);
    await expect(card.getByLabel('Дополнительно', { exact: true })).toHaveValue(target.note);
    await expect(card.locator('.comparison-table [data-field="video"] .catalog-value')).toHaveText(target.video);
    await card.getByRole('button', { name: 'Заменить из находки: Описание для каталога', exact: true }).click();
    await expect(card.getByLabel('Описание для каталога', { exact: true })).toHaveValue('Отредактированное описание находки');
    await expect(finding('description').getByRole('button')).toBeDisabled();
    await card.getByLabel('Описание для каталога', { exact: true }).fill('Итоговая ручная правка');
    await expect(finding('description').getByRole('button')).toBeEnabled();
    await expect(finding('description').locator('.finding-value')).toHaveText('Отредактированное описание находки');
    await expect(card.getByRole('button', { name: 'Заменить из находки: Зритель на сцене', exact: true })).toBeDisabled();
    for (const label of ['Название формата', 'Мебель', 'Модератор', 'Реквизит', 'Дополнительно']) {
        await card.getByRole('button', { name: `Заменить из находки: ${label}`, exact: true }).click();
    }
    await expect(card.getByLabel('Модератор', { exact: true })).toHaveValue('');
    await expect(card.getByLabel('Реквизит', { exact: true })).toHaveValue('true');
    await expect(card.locator('img')).toHaveCount(0);
    await card.getByRole('checkbox').check();
    await page.locator('#copy-agent').click();
    const result = JSON.parse(await copied(page)).candidates[0];
    expect(result).toMatchObject({ action: 'update', targetId: target.id, changes: {
        title: { before: target.title, after: candidate.format.title },
        description: { before: target.description, after: 'Итоговая ручная правка' },
        video: { before: target.video, after: videos },
        forms: { before: ['Короткая форма'], after: ['Короткая форма', 'Форма из находки'] },
        features: { before: ['Угадайки'], after: ['Угадайки', 'Новая особенность'] },
        collections: { before: ['JAM'], after: ['JAM', 'Новая подборка'] },
        moderator: { before: false, after: null },
        props: { before: false, after: true },
        furniture: { before: target.furniture, after: 'Два стула' },
        note: { before: target.note, after: candidate.format.note },
    } });
    expect(result.similarFormats).toEqual(candidate.similarFormats);
    await card.getByRole('button', { name: 'Вернуться к новому формату', exact: true }).click();
    await expect(finding('description')).toBeHidden();
    await expect(card.getByLabel('Описание для каталога', { exact: true })).toHaveValue('Отредактированное описание находки');
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue(candidate.format.video);
    await card.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    await expect(card.getByLabel('Описание для каталога', { exact: true })).toHaveValue('Итоговая ручная правка');
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue(videos);
});

test('uses the latest finding draft for each target and enables transfers again after manual removal', async ({ page, openReview }) => {
    const batch = structuredClone(example);
    const candidate = batch.candidates[1];
    candidate.format.video = 'https://example.com/finding.mp4';
    candidate.similarFormats.push({ ...structuredClone(candidate.similarFormats[0]), id: 'another-target', title: 'Вторая цель', video: 'https://example.com/another.mp4' });
    await openReview(batch);
    const card = page.locator('[data-candidate-id="interview"]');
    const buttons = card.getByRole('button', { name: '← Обновить этот формат', exact: true });
    const addVideo = card.getByRole('button', { name: 'Добавить из находки: Видео', exact: true });
    await buttons.nth(0).click();
    await addVideo.focus();
    await page.keyboard.press('Enter');
    await expect(addVideo).toBeDisabled();
    await card.getByLabel('Видео', { exact: true }).fill('');
    await expect(addVideo).toBeEnabled();
    await addVideo.click();
    await buttons.nth(1).click();
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/another.mp4');
    await addVideo.click();
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/another.mp4\nhttps://example.com/finding.mp4');
    await card.getByRole('button', { name: 'Вернуться к новому формату', exact: true }).click();
    await card.getByLabel('Видео', { exact: true }).fill('https://example.com/updated-finding.mp4');
    await buttons.nth(0).click();
    await expect(card.locator('[data-finding-field="video"] .finding-value')).toHaveText('https://example.com/updated-finding.mp4');
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/finding.mp4');
    await addVideo.click();
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/finding.mp4\nhttps://example.com/updated-finding.mp4');
    await buttons.nth(1).click();
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/another.mp4\nhttps://example.com/finding.mp4');
    await expect(addVideo).toBeEnabled();
});
