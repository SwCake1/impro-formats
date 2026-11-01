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
        await use(async (batch = example, { compact = false } = {}) => {
            await writeFile(file, await renderReviewHtml(batch));
            await page.goto(pathToFileURL(file).href);
            await expect(page.locator('#batch-size')).toHaveText(String(batch.candidates.length));
            if (!compact) {
                const expand = page.locator('#expand-all');
                if (await expand.isEnabled()) await expand.click();
                for (const summary of await page.locator('.context > summary').all()) await summary.click();
                for (const summary of await page.locator('.match > summary').all()) await summary.click();
                for (const button of await page.locator('.edit-finding').all()) {
                    if (await button.isVisible()) await button.click();
                }
                for (const card of await page.locator('.candidate').all()) await showAllFields(card);
            }
        });
        expect(errors).toEqual([]);
    },
});
async function showAllFields(scope) {
    const card = scope.locator('xpath=ancestor-or-self::article[1]');
    const button = card.locator('.show-all-fields');
    if (await button.isVisible() && await button.getAttribute('aria-expanded') !== 'true') await button.click();
}
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
function recommendedBatch() {
    const batch = structuredClone(example);
    const [radio, interview] = batch.candidates;
    radio.recommendation = { action: 'create', reason: 'Новая механика, совпадений не найдено.' };
    interview.similarFormats[0].video = 'https://example.com/old.mp4';
    interview.recommendation = { action: 'update', targetId: 'press-konferentsiya',
        reason: 'Добавить новое видео и примечание, сохранив поля каталога.',
        changes: { video: 'https://example.com/old.mp4\nhttps://example.com/new.mp4', note: 'Полезное дополнение' } };
    const duplicate = { ...structuredClone(interview), candidateId: 'duplicate',
        recommendation: { action: 'duplicate', targetId: 'press-konferentsiya', reason: 'Та же механика, новых данных нет. Поля каталога заполнены полнее.' } };
    const skipped = { ...structuredClone(radio), candidateId: 'skipped', recommendation: { action: 'skip', reason: 'В источнике только анонс, без правил.' } };
    const uncertain = { ...structuredClone(radio), candidateId: 'uncertain', recommendation: { action: 'review', reason: 'Недостаточно данных для решения.' } };
    batch.candidates = [radio, interview, duplicate, skipped, uncertain];
    return batch;
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
    await radio.getByLabel('Описание', { exact: true }).fill('Первая строка\nВторая строка');
    await page.locator('[data-candidate-id="speed"]').getByLabel('Мебель', { exact: true }).fill('Стул');
    await radio.getByText('Исходник', { exact: true }).click();
    await expect(radio.locator('.source-text')).toContainText('Ведём радио');
    await expect(radio.getByLabel('Описание', { exact: true })).toHaveValue('Первая строка\nВторая строка');
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
    await expect(radio.getByLabel('Описание', { exact: true })).toHaveValue(payload);
    await radio.getByText('Исходник', { exact: true }).click();
    await expect(radio.locator('.source-label')).toHaveText('<b>Источник</b>');
    await expect(radio.locator('a')).toHaveCount(0);
    await expect(radio.locator('.source-text')).toHaveText(payload);
    await expect(radio).toContainText('Агент не передал похожие форматы.');
    const interview = page.locator('[data-candidate-id="interview"]');
    await expect(interview.locator('.match')).toHaveCount(2);
    await expect(interview.locator('.editor-tools')).toContainText('Черновик для каталога');
    await expect(interview.locator('.context > summary')).toHaveText('Похожие форматы (2)');
    await expect(interview.locator('.match-reason h5').nth(1)).toHaveText('Агент: почему похоже');
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
    await radio.getByLabel('Название', { exact: true }).fill('Новая радиоигра');
    await radio.getByLabel('Особенности', { exact: true }).selectOption('new');
    await radio.getByLabel('Новый тег: Особенности', { exact: true }).fill('Музыка');
    await radio.getByLabel('Новый тег: Особенности', { exact: true }).press('Enter');
    await radio.getByLabel('Особенности', { exact: true }).selectOption({ label: 'Угадайки' });
    await radio.getByLabel('Реквизит', { exact: true }).selectOption('false');
    await radio.getByLabel('Зритель на сцене', { exact: true }).selectOption('false');
    await page.locator('[data-candidate-id="speed"]').getByLabel('Название', { exact: true }).fill('');
    await page.locator('[data-candidate-id="speed"]').getByRole('checkbox').uncheck();
    await radio.getByLabel('Описание', { exact: true }).fill('Последняя правка\nБез потери строк');
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
    const title = card.getByLabel('Название', { exact: true });
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
        await radio.getByLabel('Название', { exact: true }).fill('Радио после ревью');
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
        await expect(radio.getByLabel('Название', { exact: true })).toHaveValue('Радио после ревью');
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
    for (let step = 0; step < 10; step++) {
        await page.keyboard.press('Tab');
        if (await radio.getByLabel('Название', { exact: true }).evaluate(node => node === document.activeElement)) break;
    }
    await expect(radio.getByLabel('Название', { exact: true })).toBeFocused();
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
    await radio.getByLabel('Описание', { exact: true }).fill('Правки до массового выбора');
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
    await expect(radio.getByLabel('Описание', { exact: true })).toHaveValue('Правки до массового выбора');
});

test('collapses individual and all cards without losing drafts, source state or selected exports', async ({ page, openReview }) => {
    await clipboard(page);
    await openReview();
    const radio = page.locator('[data-candidate-id="radio"]');
    await radio.getByLabel('Описание', { exact: true }).fill('Сохраняется после сворачивания');
    await radio.getByLabel('Название', { exact: true }).fill('Заголовок свёрнутой карточки');
    await radio.getByText('Исходник', { exact: true }).click();
    await radio.getByRole('button', { name: /^Свернуть формат/ }).click();
    await expect(radio.locator('.card-body')).toBeHidden();
    await radio.getByRole('checkbox').check();
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
    await expect(radio.getByLabel('Описание', { exact: true })).toHaveValue('Сохраняется после сворачивания');
});

test('compares every field, links to the existing format and keeps video in column L and agent JSON', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = structuredClone(example);
    batch.candidates[1].similarFormats[0].video = 'https://example.com/existing.mp4';
    await openReview(batch);
    const card = page.locator('[data-candidate-id="interview"]');
    const match = card.locator('.match');
    await expect(match.getByRole('link', { name: 'Открыть формат ↗' })).toHaveAttribute('href', 'https://impro-formats.vercel.app/?format=press-konferentsiya');
    await expect(match.locator('.snapshot-field')).toHaveCount(11);
    await expect(match.locator('.match-id')).toHaveText('ID: press-konferentsiya');
    await expect(match.locator('.snapshot > .field-group')).toHaveCount(4);
    await expect(match.locator('[data-field="title"] .catalog-value')).toHaveText('Пресс-конференция');
    await expect(match.locator('[data-field="description"] .catalog-value')).toHaveText(batch.candidates[1].similarFormats[0].description);
    await expect(match.locator('[data-field="forms"] .catalog-value')).toHaveText('Короткая форма');
    await expect(match.locator('[data-field="features"] .catalog-value')).toHaveText('Угадайки');
    await expect(match.locator('[data-field="video"] .catalog-value a')).toHaveAttribute('href', 'https://example.com/existing.mp4');
    const videos = 'https://example.com/one.mp4\nhttps://example.com/two.mp4';
    await card.getByLabel('Видео', { exact: true }).fill(videos);
    await expect(card.locator('.video-preview a')).toHaveCount(2);
    await card.getByRole('checkbox').check();
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates[0].format.video).toBe(videos);
    expect(selection.candidates[0].similarFormats).toEqual(batch.candidates[1].similarFormats);
    await page.locator('#copy-sheet').click();
    const tsv = await copied(page);
    expect(tsv.split('\t')).toHaveLength(12);
    expect(tsv.endsWith('"https://example.com/one.mp4\nhttps://example.com/two.mp4"')).toBe(true);
    await card.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    await showAllFields(card);
    const moderator = card.locator('.review-field[data-field="moderator"]');
    await expect(moderator.locator('.finding-value')).toHaveText('Неизвестно');
    await expect(moderator.locator('.catalog-value')).toHaveText('Нет');
    await expect(card.getByLabel('Модератор', { exact: true })).toHaveValue('false');
    await expect(moderator).not.toHaveClass(/is-different/);
    await card.getByLabel('Модератор', { exact: true }).selectOption('true');
    await expect(moderator).toHaveClass(/is-different/);
    await expect(match.locator('[data-field="moderator"] .catalog-value')).toHaveText('Нет');
    await expect(card.locator('.review-field[data-field="video"] .finding-value a')).toHaveCount(2);
});

test('keeps the source verbatim while editing the description without difference warnings', async ({ page, openReview }) => {
    await openReview();
    const radio = page.locator('[data-candidate-id="radio"]');
    await radio.getByText('Исходник', { exact: true }).click();
    const original = example.candidates[0].source.text;
    await expect(radio.locator('.source-text')).toHaveText(original);
    await expect(radio.getByLabel('Описание', { exact: true })).toHaveValue(original);
    await expect(radio.locator('.description-note')).toHaveCount(0);
    await radio.getByLabel('Описание', { exact: true }).fill('Правка пользователя');
    await expect(radio.locator('.description-note')).toHaveCount(0);
    await expect(radio.locator('.source-text')).toHaveText(original);
    await radio.getByLabel('Описание', { exact: true }).fill(original);
    await expect(radio.locator('.description-note')).toHaveCount(0);
});

test('updates from catalog values, exports a patch and restores each mode draft', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = structuredClone(example);
    const originalVideo = 'https://example.com/existing.mp4';
    batch.candidates[1].similarFormats[0].video = originalVideo;
    await openReview(batch);
    const card = page.locator('[data-candidate-id="interview"]');
    await card.getByLabel('Название', { exact: true }).fill('Название нового формата');
    await card.getByLabel('Видео', { exact: true }).fill('https://example.com/proposal.mp4');
    await card.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    await showAllFields(card);
    await expect(card.getByRole('checkbox')).toBeChecked();
    await expect(card.locator('.review-action')).toBeVisible();
    await expect(card.getByLabel('Название', { exact: true })).toHaveValue('Пресс-конференция');
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
    await card.getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    await expect(card.getByLabel('Название', { exact: true })).toHaveValue('Название нового формата');
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/proposal.mp4');
    await expect(page.locator('#copy-sheet')).toBeEnabled();
    await card.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    await showAllFields(card);
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
    await showAllFields(update);
    await update.getByRole('checkbox').check();
    await update.getByLabel('Дополнительно', { exact: true }).fill('Дополнение к существующему формату');
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates.map(candidate => candidate.action)).toEqual(['create', 'update']);
    await update.getByLabel('Название', { exact: true }).fill('');
    await expect(page.locator('#copy-sheet')).toContainText('(1)');
    await page.locator('#copy-sheet').click();
    const tsv = await copied(page);
    expect(tsv).toContain('\tРадио из будущего\t');
    expect(tsv).not.toContain('Дополнение к существующему формату');
    await page.locator('#copy-agent').click();
    await expect(update.getByLabel('Название', { exact: true })).toHaveAttribute('aria-invalid', 'true');
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
    await showAllFields(first);
    await card.getByLabel('Дополнительно', { exact: true }).fill('Правка первого');
    await second.getByRole('button', { name: '← Обновить этот формат' }).click();
    await showAllFields(second);
    await expect(card.getByLabel('Название', { exact: true })).toHaveValue('Другой формат');
    await expect(card.getByLabel('Дополнительно', { exact: true })).toHaveValue('Исходная заметка второго');
    await card.getByLabel('Видео', { exact: true }).fill('https://example.com/changed-other.mp4');
    await first.getByRole('button', { name: '← Обновить этот формат' }).click();
    await showAllFields(first);
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
    await card.getByLabel('Описание', { exact: true }).fill('Отредактированное описание находки');
    await card.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    await showAllFields(card);
    await expect(finding('description').locator('.finding-value')).toHaveText('Отредактированное описание находки');
    await expect(finding('title').locator('.finding-value')).toHaveText(candidate.format.title);
    await expect(finding('video').locator('a')).toHaveCount(3);
    await expect(card.getByLabel('Описание', { exact: true })).toHaveValue(target.description);
    await expect(card.getByRole('checkbox')).toBeChecked();
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
    await expect(card.getByLabel('Описание', { exact: true })).toHaveValue(target.description);
    await expect(card.getByLabel('Дополнительно', { exact: true })).toHaveValue(target.note);
    await expect(card.locator('.review-field[data-field="video"] .catalog-value')).toHaveText(target.video);
    await card.getByRole('button', { name: 'Заменить из находки: Описание', exact: true }).click();
    await expect(card.getByLabel('Описание', { exact: true })).toHaveValue('Отредактированное описание находки');
    await expect(finding('description').getByRole('button')).toBeDisabled();
    await card.getByLabel('Описание', { exact: true }).fill('Итоговая ручная правка');
    await expect(finding('description').getByRole('button')).toBeEnabled();
    await expect(finding('description').locator('.finding-value')).toHaveText('Отредактированное описание находки');
    await expect(card.getByRole('button', { name: 'Заменить из находки: Зритель на сцене', exact: true })).toBeDisabled();
    for (const label of ['Название', 'Мебель', 'Модератор', 'Реквизит', 'Дополнительно']) {
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
    await card.getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    await expect(finding('description')).toBeHidden();
    await expect(card.getByLabel('Описание', { exact: true })).toHaveValue('Отредактированное описание находки');
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue(candidate.format.video);
    await card.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    await showAllFields(card);
    await expect(card.getByLabel('Описание', { exact: true })).toHaveValue('Итоговая ручная правка');
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
    await showAllFields(card);
    await addVideo.focus();
    await page.keyboard.press('Enter');
    await expect(addVideo).toBeDisabled();
    await card.getByLabel('Видео', { exact: true }).fill('');
    await expect(addVideo).toBeEnabled();
    await addVideo.click();
    await buttons.nth(1).click();
    await showAllFields(card);
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/another.mp4');
    await addVideo.click();
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/another.mp4\nhttps://example.com/finding.mp4');
    await card.getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    await card.getByLabel('Видео', { exact: true }).fill('https://example.com/updated-finding.mp4');
    await buttons.nth(0).click();
    await showAllFields(card);
    await expect(card.locator('[data-finding-field="video"] .finding-value')).toHaveText('https://example.com/updated-finding.mp4');
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/finding.mp4');
    await addVideo.click();
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/finding.mp4\nhttps://example.com/updated-finding.mp4');
    await buttons.nth(1).click();
    await showAllFields(card);
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/another.mp4\nhttps://example.com/finding.mp4');
    await expect(addVideo).toBeEnabled();
});

test('starts from agent recommendations, marks duplicates and exports proposed updates separately from new rows', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = recommendedBatch();
    await openReview(batch);
    const radio = page.locator('[data-candidate-id="radio"]');
    const update = page.locator('[data-candidate-id="interview"]');
    const duplicate = page.locator('[data-candidate-id="duplicate"]');
    await expect(page.locator('#recommendation-legend, .shortcut-hint')).toHaveCount(0);
    await expect(radio.locator('.recommendation-reason')).toHaveText(`Агент: ${batch.candidates[0].recommendation.reason}`);
    await expect(radio.locator('.action-line')).toBeHidden();
    await expect(page.locator('.recommendation-badge')).toHaveText(['➕ Добавить', '🔄 Обновить', '❓ Проверить', '⏭️ Пропустить', '🟰 Дубль']);
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 2 из 5');
    await expect(radio.getByRole('checkbox')).toBeChecked();
    await expect(update.getByRole('checkbox')).toBeChecked();
    for (const id of ['duplicate', 'skipped', 'uncertain']) await expect(page.locator(`[data-candidate-id="${id}"]`).getByRole('checkbox')).not.toBeChecked();
    await expect(duplicate.locator('.recommendation-badge')).toHaveText('🟰 Дубль');
    const duplicateColor = await duplicate.evaluate(node => getComputedStyle(node).backgroundColor);
    expect(duplicateColor).not.toBe(await radio.evaluate(node => getComputedStyle(node).backgroundColor));
    await expect(duplicate.locator('.recommendation-reason')).toContainText('Поля каталога заполнены полнее');
    await duplicate.locator('.card-toggle').click();
    await expect(duplicate.locator('.card-body')).toBeHidden();
    await expect(duplicate.locator('.recommendation-badge')).toBeVisible();
    await expect(update.locator('.review-action')).toContainText('Обновить «Пресс-конференция»');
    await expect(update.getByLabel('Название', { exact: true })).toHaveValue('Пресс-конференция');
    await expect(update.getByLabel('Модератор', { exact: true })).toHaveValue('false');
    await expect(update.getByLabel('Мебель', { exact: true })).toHaveValue('Нет');
    await expect(update.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/old.mp4\nhttps://example.com/new.mp4');
    await expect(update.locator('.review-field.is-different')).toHaveCount(2);
    await expect(update.locator('.update-change-count')).toHaveText('Изменено полей: 2');
    await expect(update.locator('[data-finding-field="title"] .finding-value')).toHaveText('Зеркальное интервью');
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates.map(candidate => candidate.action)).toEqual(['create', 'update']);
    expect(selection.candidates[1].changes).toEqual({
        note: { before: '', after: 'Полезное дополнение' },
        video: { before: 'https://example.com/old.mp4', after: 'https://example.com/old.mp4\nhttps://example.com/new.mp4' },
    });
    expect(selection.candidates[1].recommendation).toEqual(batch.candidates[1].recommendation);
    await page.locator('#copy-sheet').click();
    const tsv = await copied(page);
    expect(tsv).toContain('Радио из будущего');
    expect(tsv).not.toContain('Полезное дополнение');
    expect(tsv).not.toContain('Пресс-конференция');
});

test('lets the user override recommendations without resetting edits or executing reason text', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = recommendedBatch();
    const payload = '</script><img src=x onerror=alert(1)>';
    batch.candidates[2].recommendation.reason = payload;
    await openReview(batch);
    const update = page.locator('[data-candidate-id="interview"]');
    const duplicate = page.locator('[data-candidate-id="duplicate"]');
    await expect(duplicate.locator('.recommendation-reason')).toHaveText(`Агент: ${payload}`);
    await expect(duplicate.locator('img')).toHaveCount(0);
    const manualVideo = 'https://example.com/old.mp4\nhttps://example.com/manual.mp4';
    await update.getByLabel('Видео', { exact: true }).fill(manualVideo);
    await update.getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    await expect(update.getByLabel('Название', { exact: true })).toHaveValue('Зеркальное интервью');
    await expect(update.getByLabel('Видео', { exact: true })).toHaveValue('');
    await update.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    await showAllFields(update);
    await expect(update.getByLabel('Видео', { exact: true })).toHaveValue(manualVideo);
    await page.locator('#clear-selection').click();
    await duplicate.getByRole('checkbox').check();
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates).toHaveLength(1);
    expect(selection.candidates[0]).toMatchObject({ candidateId: 'duplicate', action: 'create', recommendation: { action: 'duplicate', reason: payload } });
    await page.locator('#collapse-all').click();
    await page.locator('#expand-all').click();
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 1 из 5');
    await expect(update.getByRole('checkbox')).not.toBeChecked();
});

test('selects edited cards automatically while leaving focus, disclosure and mode changes independent', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = structuredClone(example);
    batch.candidates[1].format.video = 'https://example.com/finding.mp4';
    await openReview(batch);
    const radio = page.locator('[data-candidate-id="radio"]');
    const interview = page.locator('[data-candidate-id="interview"]');
    await radio.getByLabel('Описание', { exact: true }).focus();
    await radio.getByText('Исходник', { exact: true }).click();
    await page.locator('#collapse-all').click();
    await page.locator('#expand-all').click();
    await interview.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    await showAllFields(interview);
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 0 из 3');
    for (const edit of [
        () => radio.getByLabel('Название', { exact: true }).fill('Правка названия'),
        () => radio.getByLabel('Описание', { exact: true }).fill('Правка описания'),
        () => radio.getByLabel('Модератор', { exact: true }).selectOption('true'),
        () => radio.getByLabel('Видео', { exact: true }).fill('https://example.com/new.mp4'),
    ]) {
        await edit();
        await expect(radio.getByRole('checkbox')).toBeChecked();
        await expect(interview.getByRole('checkbox')).not.toBeChecked();
        await expect(page.locator('#selection-count')).toHaveText('Выбрано: 1 из 3');
        await expect(page.locator('#copy-sheet')).toBeEnabled();
        await radio.getByRole('checkbox').uncheck();
        await expect(page.locator('#copy-agent')).toBeDisabled();
    }
    await radio.getByLabel('Особенности', { exact: true }).selectOption('new');
    await radio.getByLabel('Новый тег: Особенности', { exact: true }).fill('Пробный тег');
    await radio.getByLabel('Новый тег: Особенности', { exact: true }).press('Escape');
    await expect(radio.getByRole('checkbox')).not.toBeChecked();
    await radio.getByLabel('Особенности', { exact: true }).selectOption('new');
    await radio.getByLabel('Новый тег: Особенности', { exact: true }).fill('Пробный тег');
    await radio.getByLabel('Новый тег: Особенности', { exact: true }).press('Enter');
    await expect(radio.getByRole('checkbox')).toBeChecked();
    await page.locator('#clear-selection').click();
    await radio.getByRole('button', { name: 'Убрать Особенности: Пробный тег', exact: true }).click();
    await expect(radio.getByRole('checkbox')).toBeChecked();
    await page.locator('#clear-selection').click();
    await interview.getByRole('button', { name: 'Добавить из находки: Видео', exact: true }).click();
    await expect(interview.getByRole('checkbox')).toBeChecked();
    await expect(radio.getByRole('checkbox')).not.toBeChecked();
    await expect(page.locator('#copy-sheet')).toBeDisabled();
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates).toHaveLength(1);
    expect(selection.candidates[0]).toMatchObject({ candidateId: 'interview', action: 'update',
        changes: { video: { before: '', after: 'https://example.com/finding.mp4' } } });
    await interview.getByRole('checkbox').uncheck();
    await interview.getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    await interview.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    await showAllFields(interview);
    await expect(interview.getByRole('checkbox')).not.toBeChecked();
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 0 из 3');
});

test('sorts cards by recommendation stably and keeps their positions while editing or switching modes', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = recommendedBatch();
    const [radio, interview, duplicate, skipped, uncertain] = batch.candidates;
    const secondCreate = { ...structuredClone(radio), candidateId: 'create-second' };
    const secondReview = { ...structuredClone(uncertain), candidateId: 'review-second' };
    batch.candidates = [uncertain, interview, duplicate, secondCreate, radio, skipped, secondReview];
    await openReview(batch);
    const ids = () => page.locator('.candidate').evaluateAll(nodes => nodes.map(node => node.dataset.candidateId));
    const expected = ['create-second', 'radio', 'interview', 'uncertain', 'review-second', 'skipped', 'duplicate'];
    expect(await ids()).toEqual(expected);
    await expect(page.locator('.card-number')).toHaveText(['01', '02', '03', '04', '05', '06', '07']);
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates.map(candidate => candidate.candidateId)).toEqual(['interview', 'create-second', 'radio']);
    expect(selection.candidates[0].action).toBe('update');
    await page.locator('[data-candidate-id="radio"]').getByLabel('Название', { exact: true }).fill('Новая правка');
    await page.locator('[data-candidate-id="interview"]').getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    await page.locator('#collapse-all').click();
    await page.locator('#expand-all').click();
    expect(await ids()).toEqual(expected);
    await expect(page.locator('[data-candidate-id="radio"]').getByLabel('Название', { exact: true })).toHaveValue('Новая правка');
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 3 из 7');
});

test('opens as a compact list and reviews only changed fields without losing edits when expanding everything', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = recommendedBatch();
    await openReview(batch, { compact: true });
    for (const body of await page.locator('.card-body').all()) await expect(body).toBeHidden();
    const firstHeader = page.locator('.card-top').first();
    await expect(firstHeader.locator(':scope > .pick:first-child + .card-toggle')).toHaveCount(1);
    await expect(firstHeader.locator('.pick')).toHaveText('');
    await expect(firstHeader.getByRole('checkbox')).toHaveAccessibleName('Выбрать формат Радио из будущего');
    const update = page.locator('[data-candidate-id="interview"]');
    await expect(update.locator('.card-title-group h2')).toHaveText('Зеркальное интервью');
    await expect(update.locator('.card-summary')).toContainText('новое видео');
    await update.locator('.card-toggle').click();
    await expect(update.locator('.mode-badge, .update-mode-panel, .recommendation-panel, .comparison-table')).toHaveCount(0);
    const visibleFields = () => update.locator('.review-field:visible').evaluateAll(rows => rows.map(row => row.dataset.field));
    expect(await visibleFields()).toEqual(['note', 'video']);
    const note = update.locator('.review-field[data-field="note"]');
    await expect(note.locator('.finding-value')).toHaveText(batch.candidates[1].format.note);
    await expect(note.locator('.catalog-value')).toHaveText('Не указано');
    await expect(update.getByLabel('Дополнительно', { exact: true })).toHaveValue('Полезное дополнение');
    await update.getByLabel('Дополнительно', { exact: true }).fill('');
    await expect(note).toBeVisible();
    await expect(note).not.toHaveClass(/is-different/);
    await update.getByRole('button', { name: 'Показать все поля', exact: true }).click();
    expect(await visibleFields()).toHaveLength(11);
    await update.getByLabel('Мебель', { exact: true }).fill('Два стула');
    await update.getByRole('button', { name: 'Только изменения', exact: true }).click();
    expect(await visibleFields()).toEqual(['furniture', 'video']);
    await expect(update.getByLabel('Мебель', { exact: true })).toHaveValue('Два стула');
    await update.locator('.context > summary').click();
    await update.locator('.match > summary').click();
    await expect(update.locator('.snapshot [data-field="furniture"] .catalog-value')).toHaveText('Нет');
    await expect(update.locator('.match-description')).toHaveText(batch.candidates[1].similarFormats[0].description);
    await expect(update.locator('.match .format-link')).toHaveAttribute('href', 'https://impro-formats.vercel.app/?format=press-konferentsiya');
    await update.getByText('Исходник', { exact: true }).click();
    await expect(update.locator('.source-text')).toHaveText(batch.candidates[1].source.text);
    await update.getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    await expect(update.getByLabel('Название', { exact: true })).toHaveValue('Зеркальное интервью');
    await update.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    expect(await visibleFields()).toEqual(['furniture', 'video']);
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates[1].changes).toMatchObject({ furniture: { before: 'Нет', after: 'Два стула' } });
    expect(selection.candidates[1].changes).not.toHaveProperty('note');
    expect(selection.candidates[1].targetId).toBe('press-konferentsiya');
});

test('keeps new formats free of empty sidebars and duplicates concise until their editor is requested', async ({ page, openReview }) => {
    await openReview(recommendedBatch(), { compact: true });
    const radio = page.locator('[data-candidate-id="radio"]');
    await radio.locator('.card-toggle').click();
    await expect(radio.locator('.context')).toHaveCount(0);
    await expect(radio.getByLabel('Описание', { exact: true })).toBeVisible();
    const duplicate = page.locator('[data-candidate-id="duplicate"]');
    await duplicate.locator('.card-toggle').click();
    await expect(duplicate.locator('.finding-preview')).toBeVisible();
    await expect(duplicate.locator('.editor')).toBeHidden();
    await expect(duplicate.locator('.target-link .format-link')).toHaveAttribute('href', 'https://impro-formats.vercel.app/?format=press-konferentsiya');
    await duplicate.getByRole('button', { name: 'Показать поля находки', exact: true }).click();
    await expect(duplicate.locator('.editor')).toBeVisible();
    await expect(duplicate.getByRole('checkbox')).not.toBeChecked();
    await duplicate.getByLabel('Название', { exact: true }).fill('Уточнённая находка');
    await expect(duplicate.getByRole('checkbox')).toBeChecked();
    await duplicate.locator('.card-toggle').click();
    await duplicate.locator('.card-toggle').click();
    await expect(duplicate.getByLabel('Название', { exact: true })).toHaveValue('Уточнённая находка');
});

test('reveals a hidden invalid title before focusing the copy error', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = structuredClone(example);
    batch.candidates[1].format.title = '';
    await openReview(batch, { compact: true });
    const card = page.locator('[data-candidate-id="interview"]');
    await card.getByRole('checkbox').check();
    await page.locator('#copy-agent').click();
    await expect(card.locator('.card-body')).toBeVisible();
    await expect(card.getByLabel('Название', { exact: true })).toBeFocused();
    await expect(card.locator('.field-error')).toBeVisible();
    expect(await copied(page)).toBeUndefined();
    await card.locator('.context > summary').click();
    await card.locator('.match > summary').click();
    await card.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    await showAllFields(card);
    await expect(card.getByLabel('Название', { exact: true })).toHaveValue('Пресс-конференция');
    await expect(card.getByLabel('Название', { exact: true })).not.toHaveAttribute('aria-invalid', 'true');
    await expect(card.locator('.field-error')).toBeHidden();
});

test('toggles only the hovered card with C and S and exports the retained draft', async ({ page, openReview }) => {
    await clipboard(page);
    await openReview(example, { compact: true });
    const radio = page.locator('[data-candidate-id="radio"]');
    const interview = page.locator('[data-candidate-id="interview"]');
    await radio.locator('.card-title-group').hover();
    await page.keyboard.press('c');
    await expect(radio.locator('.card-body')).toBeVisible();
    await page.keyboard.press('s');
    await expect(radio.getByRole('checkbox')).toBeChecked();
    await radio.getByLabel('Описание', { exact: true }).fill('Сохранённая правка');
    await radio.locator('.source-details > summary').click();
    await radio.locator('.card-title-group').hover();
    await page.keyboard.press('c');
    await expect(radio.locator('.card-body')).toBeHidden();
    await expect(radio.locator('.card-toggle')).toBeFocused();
    await page.keyboard.press('s');
    await expect(radio.getByRole('checkbox')).not.toBeChecked();
    await page.keyboard.press('s');
    await page.keyboard.press('c');
    await expect(radio.getByLabel('Описание', { exact: true })).toHaveValue('Сохранённая правка');
    await interview.locator('.card-title-group').hover();
    await page.keyboard.press('s');
    await expect(interview.getByRole('checkbox')).toBeChecked();
    await page.locator('.masthead').hover();
    await page.keyboard.press('s');
    await page.keyboard.press('c');
    await expect(interview.locator('.card-body')).toBeHidden();
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 2 из 3');
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates.map(candidate => candidate.candidateId)).toEqual(['radio', 'interview']);
    expect(selection.candidates[0].format.description).toBe('Сохранённая правка');
});

test('protects typing, modifiers and composition while supporting physical keys in Russian', async ({ page, openReview }) => {
    await openReview(example, { compact: true });
    const radio = page.locator('[data-candidate-id="radio"]');
    const interview = page.locator('[data-candidate-id="interview"]');
    await radio.locator('.card-toggle').click();
    const title = radio.getByLabel('Название', { exact: true });
    await title.focus();
    await interview.locator('.card-title-group').hover();
    await page.keyboard.type('cs');
    await expect(title).toHaveValue(`${example.candidates[0].format.title}cs`);
    await expect(interview.getByRole('checkbox')).not.toBeChecked();
    await expect(interview.locator('.card-body')).toBeHidden();
    for (const control of [radio.getByLabel('Описание', { exact: true }), radio.getByLabel('Реквизит', { exact: true })]) {
        await control.focus();
        await interview.locator('.card-title-group').hover();
        await page.keyboard.press('c');
        await page.keyboard.press('s');
        await expect(interview.locator('.card-body')).toBeHidden();
        await expect(interview.getByRole('checkbox')).not.toBeChecked();
    }
    await page.evaluate(() => {
        const editable = document.createElement('div');
        editable.contentEditable = 'true';
        document.body.append(editable);
        editable.focus();
    });
    await interview.locator('.card-title-group').hover();
    await page.keyboard.type('cs');
    await expect(interview.getByRole('checkbox')).not.toBeChecked();
    await expect(interview.locator('.card-body')).toBeHidden();
    await radio.locator('.card-toggle').focus();
    await interview.locator('.card-title-group').hover();
    const protectedEvents = await page.evaluate(() => ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'repeat', 'isComposing'].map(flag =>
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 's', code: 'KeyS', [flag]: true }))));
    expect(protectedEvents).toEqual([true, true, true, true, true, true]);
    await expect(interview.getByRole('checkbox')).not.toBeChecked();
    await page.evaluate(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ы', code: 'KeyS' }));
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'с', code: 'KeyC' }));
    });
    await expect(interview.getByRole('checkbox')).toBeChecked();
    await expect(interview.locator('.card-body')).toBeVisible();
});

test('resizes panels by dragging and keyboard without losing state and remembers a bounded width', async ({ page, openReview }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openReview(example, { compact: true });
    const width = () => page.locator('main.shell').evaluate(node => node.getBoundingClientRect().width);
    expect(await width()).toBe(1054);
    const radio = page.locator('[data-candidate-id="radio"]');
    await radio.locator('.card-toggle').click();
    await radio.getByLabel('Дополнительно', { exact: true }).fill('Правка при изменении ширины');
    const handle = page.getByRole('separator', { name: 'Ширина панелей' });
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 16);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 70, box.y + 16, { steps: 8 });
    await page.mouse.up();
    expect(await width()).toBe(914);
    await expect(radio.locator('.card-body')).toBeVisible();
    await expect(radio.getByRole('checkbox')).toBeChecked();
    await expect(radio.getByLabel('Дополнительно', { exact: true })).toHaveValue('Правка при изменении ширины');
    await expect(page.locator('body')).not.toHaveClass(/is-resizing/);
    await handle.press('End');
    expect(await width()).toBe(1568);
    await handle.press('Home');
    expect(await width()).toBe(760);
    await handle.press('ArrowRight');
    expect(await width()).toBe(780);
    await handle.dblclick({ position: { x: 6, y: 16 } });
    expect(await width()).toBe(1054);
    await handle.press('ArrowRight');
    await handle.press('ArrowRight');
    await page.reload();
    expect(await width()).toBe(1094);
    await expect(radio.locator('.card-body')).toBeHidden();
    await page.setViewportSize({ width: 900, height: 1000 });
    await expect.poll(width).toBe(868);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect.poll(width).toBe(1094);
    const shells = await page.locator('.masthead, main.shell, .export-inner').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
    expect(shells).toEqual([1094, 1094, 1094]);
});

test('resizes when local storage is unavailable', async ({ page, openReview }) => {
    await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('Storage disabled'); } }));
    await openReview(example, { compact: true });
    const handle = page.getByRole('separator', { name: 'Ширина панелей' });
    await handle.press('Home');
    await expect(handle).toHaveAttribute('aria-valuenow', '760');
    await handle.press('ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', '780');
    await page.locator('#select-all').click();
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 3 из 3');
});

test('keeps matching field groups across creation, catalog snapshots and filtered updates', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = recommendedBatch();
    await openReview(batch, { compact: true });
    const radio = page.locator('[data-candidate-id="radio"]');
    const update = page.locator('[data-candidate-id="interview"]');
    const groupIds = scope => scope.locator('.field-group:visible').evaluateAll(nodes => nodes.map(node => node.dataset.fieldGroup));
    await radio.locator('.card-toggle').click();
    expect(await groupIds(radio.locator('.editor'))).toEqual(['main', 'requirements', 'classification', 'extra']);
    await update.locator('.card-toggle').click();
    expect(await groupIds(update.locator('.editor'))).toEqual(['extra']);
    await update.locator('.context > summary').click();
    await update.locator('.match > summary').click();
    const snapshot = update.locator('.snapshot');
    expect(await groupIds(snapshot)).toEqual(['main', 'requirements', 'classification', 'extra']);
    await expect(snapshot.locator('input, textarea, select, button')).toHaveCount(0);
    await expect(snapshot.locator('.snapshot-field')).toHaveCount(11);
    await expect(snapshot.locator('[data-field="description"] .catalog-value')).toHaveText(batch.candidates[1].similarFormats[0].description);
    await update.getByLabel('Дополнительно', { exact: true }).fill('');
    await update.getByLabel('Видео', { exact: true }).fill('https://example.com/old.mp4');
    await update.getByRole('button', { name: 'Показать все поля', exact: true }).click();
    await update.getByRole('button', { name: 'Только изменения', exact: true }).click();
    expect(await groupIds(update.locator('.editor'))).toEqual([]);
    await expect(update.locator('.empty-changes')).toBeVisible();
    await update.getByRole('button', { name: 'Показать все поля', exact: true }).click();
    await update.getByLabel('Мебель', { exact: true }).fill('Два стула');
    await update.getByRole('button', { name: 'Только изменения', exact: true }).click();
    expect(await groupIds(update.locator('.editor'))).toEqual(['requirements']);
    await expect(update.locator('.field-columns')).toHaveText('НаходкаВ каталогеИтог');
    await expect(update.locator('.review-field:visible')).toHaveCount(1);
    await expect(snapshot.locator('[data-field="furniture"] .catalog-value')).toHaveText('Нет');
    await radio.getByRole('checkbox').uncheck();
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates[0].changes).toEqual({ furniture: { before: 'Нет', after: 'Два стула' } });
    await update.getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    expect(await groupIds(update.locator('.editor'))).toEqual(['main', 'requirements', 'classification', 'extra']);
    await update.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    expect(await groupIds(update.locator('.editor'))).toEqual(['requirements']);
    await expect(update.getByLabel('Мебель', { exact: true })).toHaveValue('Два стула');
});

test('starts single and multiple matches collapsed and keeps drafts while toggling them independently', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = structuredClone(example);
    const interview = batch.candidates[1];
    const single = { ...structuredClone(interview), candidateId: 'single-match' };
    interview.similarFormats[0].description = 'Длинное описание существующего формата. '.repeat(40);
    interview.similarFormats.push({ ...structuredClone(interview.similarFormats[0]), id: 'second-match', title: 'Второе совпадение' });
    batch.candidates = [interview, single];
    await openReview(batch, { compact: true });
    const card = page.locator('[data-candidate-id="interview"]');
    await card.locator('.card-toggle').click();
    await card.locator('.context > summary').click();
    const first = card.locator('.match').first();
    const second = card.locator('.match').nth(1);
    for (const match of [first, second]) {
        await expect(match).not.toHaveAttribute('open', '');
        await expect(match.locator('.match-title')).toBeVisible();
        await expect(match.locator('.match-excerpt')).toBeVisible();
        await expect(match.locator('.match-body')).toBeHidden();
        const dimensions = await match.locator('.match-excerpt').evaluate(node => ({ height: node.clientHeight, lineHeight: parseFloat(getComputedStyle(node).lineHeight), fullHeight: node.scrollHeight }));
        expect(dimensions.height).toBeLessThanOrEqual(dimensions.lineHeight * 2 + 1);
        expect(dimensions.fullHeight).toBeGreaterThan(dimensions.height);
    }
    const one = page.locator('[data-candidate-id="single-match"]');
    await one.locator('.card-toggle').click();
    await one.locator('.context > summary').click();
    await expect(one.locator('.match')).toHaveCount(1);
    await expect(one.locator('.match-body')).toBeHidden();
    await first.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(first.locator('.match-excerpt')).toBeHidden();
    await expect(first.locator('.match-description')).toHaveText(interview.similarFormats[0].description);
    await expect(second.locator('.match-body')).toBeHidden();
    await first.getByRole('button', { name: '← Обновить этот формат', exact: true }).click();
    await showAllFields(card);
    await card.getByLabel('Дополнительно', { exact: true }).fill('Правка после раскрытия совпадения');
    await first.locator('summary').click();
    await second.locator('summary').focus();
    await page.keyboard.press('Space');
    await expect(first.locator('.match-body')).toBeHidden();
    await expect(second.locator('.match-body')).toBeVisible();
    await card.locator('.context > summary').click();
    await card.locator('.context > summary').click();
    await expect(first.locator('.match-body')).toBeHidden();
    await expect(second.locator('.match-body')).toBeVisible();
    await expect(card.getByLabel('Дополнительно', { exact: true })).toHaveValue('Правка после раскрытия совпадения');
    await expect(card.getByRole('checkbox')).toBeChecked();
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates).toHaveLength(1);
    expect(selection.candidates[0]).toMatchObject({ targetId: 'press-konferentsiya', changes: { note: { before: '', after: 'Правка после раскрытия совпадения' } } });
    expect(selection.candidates[0].similarFormats).toEqual(interview.similarFormats);
});
