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
                for (const summary of await page.locator('.match:not([open]) > summary').all()) await summary.click();
                for (const summary of await page.locator('.snapshot-details > summary').all()) await summary.click();
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
async function chooseUpdate(match) {
    if (!await match.evaluate(node => node.open)) await match.locator(':scope > summary').click();
    await match.locator('.update-format').click();
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
test('shows duplicate agreement in collapsed headers and preserves its original context after editing', async ({ page, openReview }) => {
    const batch = JSON.parse(await readFile(new URL('../../tools/format-review/example-recommendations.json', import.meta.url), 'utf8'));
    await clipboard(page);
    await openReview(batch, { compact: true });
    const duplicate = page.locator('[data-candidate-id="press-duplicate"]');
    const marks = duplicate.locator('.duplicate-comparison');
    await expect(marks).toBeVisible();
    await expect(marks.locator('.comparison-mark')).toHaveText(['Название ≠', 'Описание ✓', 'Параметры ?']);
    await expect(marks).toHaveAttribute('aria-label', 'Сравнение исходной находки с «Пресс-конференция»');
    await expect(marks.locator('.comparison-mark').last()).toHaveAttribute('title', /Модератор: нет данных/);
    await expect(duplicate.getByRole('checkbox')).not.toBeChecked();
    await expect(page.locator('.duplicate-comparison')).toHaveCount(1);
    await duplicate.locator('.card-toggle').click();
    await expect(marks).toBeVisible();
    await duplicate.getByRole('button', { name: 'Редактировать', exact: true }).click();
    await duplicate.getByLabel('Название', { exact: true }).fill('Пресс-конференция');
    await expect(duplicate.getByRole('checkbox')).toBeChecked();
    await expect(marks.locator('.comparison-mark').first()).toHaveText('Название ≠');
    await page.locator('#clear-selection').click();
    await duplicate.getByRole('checkbox').check();
    await duplicate.locator('.card-toggle').click();
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates).toHaveLength(1);
    expect(selection.candidates[0]).toMatchObject({ format: { title: 'Пресс-конференция' }, recommendation: { descriptionMatch: 'equivalent' } });
    await page.locator('#copy-sheet').click();
    expect((await copied(page)).split('\t')).toHaveLength(12);
});

test('does not infer semantic agreement just from a legacy duplicate label', async ({ page, openReview }) => {
    await openReview(recommendedBatch(), { compact: true });
    const marks = page.locator('[data-candidate-id="duplicate"] .duplicate-comparison');
    await expect(marks).toContainText('Описание ?');
    await expect(marks.locator('.comparison-mark').nth(1)).toHaveAccessibleName(/Описание: не оценено/);
    await expect(marks).toBeVisible();
});

test('counts only known parameter differences in compact comparison marks', async ({ page, openReview }) => {
    const batch = recommendedBatch();
    const duplicate = batch.candidates.find(candidate => candidate.candidateId === 'duplicate');
    const target = duplicate.similarFormats[0];
    duplicate.format = structuredClone(target);
    delete duplicate.format.id;
    delete duplicate.format.url;
    delete duplicate.format.reason;
    duplicate.format.moderator = !target.moderator;
    duplicate.format.props = !target.props;
    duplicate.format.features = [];
    await openReview(batch, { compact: true });
    const marks = page.locator('[data-candidate-id="duplicate"] .comparison-mark');
    await expect(marks).toHaveText(['Название ✓', 'Описание ✓', 'Параметры ≠ 2']);
    await expect(marks.last()).toHaveAttribute('data-status', 'different');
    await expect(marks.last()).toHaveAccessibleName(/Особенности: нет данных/);
    const tooltip = page.locator(`#${await marks.last().getAttribute('aria-describedby')}`);
    await marks.last().hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('tbody th')).toHaveText(['Модератор', 'Реквизит']);
    await expect(tooltip.locator('tbody tr').first().locator('td')).toHaveText([target.moderator ? 'Нет' : 'Да', target.moderator ? 'Да' : 'Нет']);
    await tooltip.hover();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    await marks.last().focus();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('Tab');
    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();
    await expect(page.locator('[data-candidate-id="duplicate"]').getByRole('checkbox')).not.toBeChecked();
});

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
    await expect(radio.locator('.source-details')).toHaveCount(0);
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
    await expect(radio.locator('.source-details')).toHaveCount(0);
    await expect(radio.locator('a')).toHaveCount(0);
    expect(await page.locator('#review-data').textContent()).toContain('source');
    await expect(radio.locator('.context')).toBeHidden();
    const interview = page.locator('[data-candidate-id="interview"]');
    await expect(interview.locator('.match')).toHaveCount(2);
    await expect(interview.locator('.editor-tools')).toContainText('Редактирование');
    await expect(interview.locator('.context')).toHaveAttribute('aria-label', 'Похожие форматы в каталоге');
    await expect(interview.locator('.match-reason').nth(1)).toContainText(payload);
    await expect(interview.locator('.match-description').nth(1)).toHaveText(payload);
    await expect(interview.locator('.match').nth(1).locator('.format-link')).toHaveCount(0);
    await expect(interview.locator('.match').nth(1).locator('[data-field="props"] .catalog-value')).toHaveText('Не передано');
    await expect(interview.locator('.match').nth(1).getByRole('button', { name: 'Подготовить обновление' })).toBeDisabled();
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
    await page.getByRole('button', { name: 'Выбрать видимые', exact: true }).click();
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(3);
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 3 из 3');
    await expect(page.locator('#select-all')).toBeDisabled();
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates).toHaveLength(3);
    expect(selection.candidates[0].format.description).toBe('Правки до массового выбора');
    await radio.getByRole('checkbox').uncheck();
    await expect(page.locator('#select-all')).toBeEnabled();
    await page.locator('#clear-selection').click();
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
    await expect(radio.locator('.source-details')).toHaveCount(0);
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
    await expect(match.locator('.snapshot-field')).toHaveCount(9);
    await expect(match.locator('.match-id')).toHaveText('ID: press-konferentsiya');
    await expect(match.locator('.snapshot > .field-group')).toHaveCount(3);
    await expect(match.locator('.match-title')).toHaveText('Пресс-конференция');
    await expect(match.locator('.match-description')).toHaveText(batch.candidates[1].similarFormats[0].description);
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
    await card.getByRole('button', { name: 'Подготовить обновление', exact: true }).click();
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

test('preserves the source in export while showing only a source link', async ({ page, openReview }) => {
    await clipboard(page);
    await openReview();
    const radio = page.locator('[data-candidate-id="radio"]');
    await expect(radio.locator('.source-details')).toHaveCount(0);
    await radio.getByLabel('Описание', { exact: true }).fill('Правка пользователя');
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates[0].format.description).toBe('Правка пользователя');
    expect(selection.candidates[0].source).toEqual(example.candidates[0].source);
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
    await card.getByRole('button', { name: 'Подготовить обновление', exact: true }).click();
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
    await card.getByRole('button', { name: 'Подготовить обновление', exact: true }).click();
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
    await update.getByRole('button', { name: 'Подготовить обновление', exact: true }).click();
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
    const first = card.locator('[data-format-id="press-konferentsiya"]');
    const second = card.locator('[data-format-id="other-format"]');
    await chooseUpdate(first);
    await expect(second.locator('.match-body')).toBeHidden();
    await expect(card.locator('.finding-preview + .context + .editor')).toHaveCount(1);
    await showAllFields(first);
    await card.getByLabel('Дополнительно', { exact: true }).fill('Правка первого');
    await chooseUpdate(second);
    await expect(first.locator('.match-body')).toBeHidden();
    await expect(card.locator('.context > .match').first()).toHaveAttribute('data-format-id', 'other-format');
    await expect(second.locator('.match-body')).toBeVisible();
    await expect(card.locator('.finding-preview + .context + .editor')).toHaveCount(1);
    await showAllFields(second);
    await expect(card.getByLabel('Название', { exact: true })).toHaveValue('Другой формат');
    await expect(card.getByLabel('Дополнительно', { exact: true })).toHaveValue('Исходная заметка второго');
    await card.getByLabel('Видео', { exact: true }).fill('https://example.com/changed-other.mp4');
    await chooseUpdate(first);
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
    await card.getByRole('button', { name: 'Подготовить обновление', exact: true }).click();
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
    await expect(finding('audienceOnStage').locator('button')).toBeHidden();
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
    await card.getByRole('button', { name: 'Подготовить обновление', exact: true }).click();
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
    const addVideo = card.getByRole('button', { name: 'Добавить из находки: Видео', exact: true });
    await chooseUpdate(card.locator('[data-format-id="press-konferentsiya"]'));
    await showAllFields(card);
    await addVideo.focus();
    await page.keyboard.press('Enter');
    await expect(addVideo).toBeDisabled();
    await card.getByLabel('Видео', { exact: true }).fill('');
    await expect(addVideo).toBeEnabled();
    await addVideo.click();
    await chooseUpdate(card.locator('[data-format-id="another-target"]'));
    await showAllFields(card);
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/another.mp4');
    await addVideo.click();
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/another.mp4\nhttps://example.com/finding.mp4');
    await card.getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    await card.getByLabel('Видео', { exact: true }).fill('https://example.com/updated-finding.mp4');
    await chooseUpdate(card.locator('[data-format-id="press-konferentsiya"]'));
    await showAllFields(card);
    await expect(card.locator('[data-finding-field="video"] .finding-value')).toHaveText('https://example.com/updated-finding.mp4');
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/finding.mp4');
    await addVideo.click();
    await expect(card.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/finding.mp4\nhttps://example.com/updated-finding.mp4');
    await chooseUpdate(card.locator('[data-format-id="another-target"]'));
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
    await expect(radio.locator('.recommendation-reason')).toHaveText(batch.candidates[0].recommendation.reason);
    await expect(radio.locator('.decision-summary')).toHaveText('✓ Добавление выбрано');
    await expect(page.locator('.recommendation-badge')).toHaveText(['➕ Добавить', '🔄 Обновить', '❓ Проверить', '⏭️ Пропустить', '🟰 Дубль']);
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 2 из 5');
    await expect(radio.getByRole('checkbox')).toBeChecked();
    await expect(update.getByRole('checkbox')).toBeChecked();
    for (const id of ['duplicate', 'skipped', 'uncertain']) await expect(page.locator(`[data-candidate-id="${id}"]`).getByRole('checkbox')).not.toBeChecked();
    await expect(duplicate.locator('.recommendation-badge')).toHaveText('🟰 Дубль');
    const duplicateColor = await duplicate.locator('.recommendation-badge').evaluate(node => getComputedStyle(node).backgroundColor);
    expect(duplicateColor).not.toBe(await radio.locator('.recommendation-badge').evaluate(node => getComputedStyle(node).backgroundColor));
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
    await expect(duplicate.locator('.recommendation-reason')).toHaveText(payload);
    await expect(duplicate.locator('img')).toHaveCount(0);
    const manualVideo = 'https://example.com/old.mp4\nhttps://example.com/manual.mp4';
    await update.getByLabel('Видео', { exact: true }).fill(manualVideo);
    await update.getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    await expect(update.getByLabel('Название', { exact: true })).toHaveValue('Зеркальное интервью');
    await expect(update.getByLabel('Видео', { exact: true })).toHaveValue('');
    await update.getByRole('button', { name: 'Подготовить обновление', exact: true }).click();
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
    await page.locator('#collapse-all').click();
    await page.locator('#expand-all').click();
    await interview.getByRole('button', { name: 'Подготовить обновление', exact: true }).click();
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
    await interview.getByRole('button', { name: 'Подготовить обновление', exact: true }).click();
    await showAllFields(interview);
    await expect(interview.getByRole('checkbox')).toBeChecked();
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 1 из 3');
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

test('opens as a compact list and shows source differences and proposed edits without changing the export', async ({ page, openReview }) => {
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
    const differingFields = ['title', 'description', 'moderator', 'audienceOnStage', 'props', 'furniture', 'note', 'video'];
    expect(await visibleFields()).toEqual(differingFields);
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
    await update.getByRole('button', { name: 'Только различия', exact: true }).click();
    expect(await visibleFields()).toEqual(differingFields);
    await expect(update.getByLabel('Мебель', { exact: true })).toHaveValue('Два стула');
    await update.locator('.snapshot-details > summary').click();
    await expect(update.locator('.snapshot [data-field="furniture"] .catalog-value')).toHaveText('Нет');
    await expect(update.locator('.match-description')).toHaveText(batch.candidates[1].similarFormats[0].description);
    await expect(update.locator('.match .format-link')).toHaveAttribute('href', 'https://impro-formats.vercel.app/?format=press-konferentsiya');
    await expect(update.locator('.source-details')).toHaveCount(0);
    await update.getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    await expect(update.getByLabel('Название', { exact: true })).toHaveValue('Зеркальное интервью');
    await update.getByRole('button', { name: 'Подготовить обновление', exact: true }).click();
    expect(await visibleFields()).toEqual(differingFields);
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
    await expect(radio.locator('.context')).toBeHidden();
    await expect(radio.locator('.finding-description')).toBeVisible();
    const duplicate = page.locator('[data-candidate-id="duplicate"]');
    await duplicate.locator('.card-toggle').click();
    await expect(duplicate.locator('.finding-preview')).toBeVisible();
    await expect(duplicate.locator('.finding-title')).toHaveText(recommendedBatch().candidates[2].format.title);
    expect(await duplicate.locator('.card-body').evaluate(body => body.firstElementChild.classList.contains('finding-preview'))).toBe(true);
    await expect(duplicate.locator('.match-description')).toBeVisible();
    await expect(duplicate.locator('.source-details')).toHaveCount(0);
    const descriptionBottom = (await duplicate.locator('.finding-preview').boundingBox()).y + (await duplicate.locator('.finding-preview').boundingBox()).height;
    expect(descriptionBottom).toBeLessThan((await duplicate.locator('.context').boundingBox()).y);
    await expect(duplicate.locator('.finding-description')).toHaveText(recommendedBatch().candidates[2].format.description);
    await expect(duplicate.locator('.editor')).toBeHidden();
    await expect(duplicate.locator('.match .format-link')).toHaveAttribute('href', 'https://impro-formats.vercel.app/?format=press-konferentsiya');
    await duplicate.getByRole('button', { name: 'Редактировать', exact: true }).click();
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

    await card.getByRole('button', { name: 'Подготовить обновление', exact: true }).click();
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
    await radio.getByRole('button', { name: 'Редактировать', exact: true }).click();
    await radio.getByLabel('Описание', { exact: true }).fill('Сохранённая правка');
    await radio.locator('.done-editing').click();
    await radio.locator('.card-title-group').hover();
    await page.keyboard.press('c');
    await expect(radio.locator('.card-body')).toBeHidden();
    await expect(radio.locator('.card-toggle')).toBeFocused();
    await page.keyboard.press('s');
    await expect(radio.getByRole('checkbox')).not.toBeChecked();
    await page.keyboard.press('s');
    await page.keyboard.press('c');
    await expect(radio.locator('.finding-description')).toHaveText('Сохранённая правка');
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
    await radio.getByRole('button', { name: 'Редактировать', exact: true }).click();
    const title = radio.getByLabel('Название', { exact: true });
    await title.press('End');
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
    await radio.getByRole('button', { name: 'Редактировать', exact: true }).click();
    await radio.getByLabel('Дополнительно', { exact: true }).fill('Правка при изменении ширины');
    const handle = page.getByRole('separator', { name: 'Ширина панелей' });
    await page.evaluate(() => window.scrollTo(0, 0));
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
    await expect(radio.locator('.card-body')).toBeVisible();
    await expect(radio.getByLabel('Дополнительно', { exact: true })).toHaveValue('Правка при изменении ширины');
    await page.setViewportSize({ width: 900, height: 1000 });
    await expect.poll(width).toBe(868);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect.poll(width).toBe(1094);
    const shells = await page.locator('.masthead, main.shell, .export-inner').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
    expect(shells).toEqual([1094, 1094, 1094]);
});

test('resizes when local storage is unavailable', async ({ page, openReview }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
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
    const { id, url, reason, ...sameFormat } = batch.candidates[1].similarFormats[0];
    batch.candidates[1].format = structuredClone(sameFormat);
    await openReview(batch, { compact: true });
    const radio = page.locator('[data-candidate-id="radio"]');
    const update = page.locator('[data-candidate-id="interview"]');
    const groupIds = scope => scope.locator('.field-group:visible').evaluateAll(nodes => nodes.map(node => node.dataset.fieldGroup));
    await radio.locator('.card-toggle').click();
    await radio.getByRole('button', { name: 'Редактировать', exact: true }).click();
    expect(await groupIds(radio.locator('.editor'))).toEqual(['main', 'requirements', 'classification', 'extra']);
    await update.locator('.card-toggle').click();
    expect(await groupIds(update.locator('.editor'))).toEqual(['extra']);
    await update.locator('.snapshot-details > summary').click();
    const snapshot = update.locator('.snapshot');
    expect(await groupIds(snapshot)).toEqual(['requirements', 'classification', 'extra']);
    await expect(snapshot.locator('input, textarea, select, button')).toHaveCount(0);
    await expect(snapshot.locator('.snapshot-field')).toHaveCount(9);
    await expect(update.locator('.match-description')).toHaveText(batch.candidates[1].similarFormats[0].description);
    await update.getByLabel('Дополнительно', { exact: true }).fill('');
    await update.getByLabel('Видео', { exact: true }).fill('https://example.com/old.mp4');
    await update.getByRole('button', { name: 'Показать все поля', exact: true }).click();
    await update.getByRole('button', { name: 'Только различия', exact: true }).click();
    expect(await groupIds(update.locator('.editor'))).toEqual([]);
    await expect(update.locator('.empty-changes')).toBeVisible();
    await expect(update.locator('.empty-changes')).toContainText('Все поля совпадают');
    await update.getByRole('button', { name: 'Показать все поля', exact: true }).click();
    await update.getByLabel('Мебель', { exact: true }).fill('Два стула');
    await update.getByRole('button', { name: 'Только различия', exact: true }).click();
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
    await update.getByRole('button', { name: 'Подготовить обновление', exact: true }).click();
    expect(await groupIds(update.locator('.editor'))).toEqual(['requirements']);
    await expect(update.getByLabel('Мебель', { exact: true })).toHaveValue('Два стула');
});

test('shows the first match immediately and keeps edits while opening other matches', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = structuredClone(example);
    const interview = batch.candidates[1];
    interview.similarFormats.push({ ...structuredClone(interview.similarFormats[0]), id: 'second-match', title: 'Второе совпадение' });
    batch.candidates = [interview];
    await openReview(batch, { compact: true });
    const card = page.locator('.candidate');
    await card.locator('.card-title-button').click();
    const first = card.locator('.match').first();
    const second = card.locator('.match').nth(1);
    await expect(first.locator('.match-description')).toBeVisible();
    await expect(second.locator('.match-body')).toBeHidden();
    await expect(first.locator('.snapshot')).toBeHidden();
    await first.getByRole('button', { name: 'Подготовить обновление', exact: true }).click();
    await expect(card.locator('.empty-changes')).toBeHidden();
    await expect(card.locator('.review-field:visible').locator('.field-label')).toHaveText([
        'Название', 'Описание', 'Модератор', 'Зритель на сцене', 'Реквизит', 'Мебель', 'Дополнительно',
    ]);
    await expect(card.locator('.review-field.is-different')).toHaveCount(0);
    await expect(card.getByLabel('Название', { exact: true })).toHaveValue(interview.similarFormats[0].title);
    await expect(card.getByRole('checkbox')).not.toBeChecked();
    await expect(card.locator('.reset-format')).toBeHidden();
    await showAllFields(card);
    await card.getByLabel('Дополнительно', { exact: true }).fill('Правка после раскрытия совпадения');
    await first.locator(':scope > summary').click();
    await second.locator(':scope > summary').focus();
    await page.keyboard.press('Space');
    await expect(first.locator('.match-body')).toBeHidden();
    await expect(second.locator('.match-body')).toBeVisible();
    await expect(card.getByLabel('Дополнительно', { exact: true })).toHaveValue('Правка после раскрытия совпадения');
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates[0]).toMatchObject({ targetId: 'press-konferentsiya', changes: { note: { before: '', after: 'Правка после раскрытия совпадения' } } });
    expect(selection.candidates[0].similarFormats).toEqual(interview.similarFormats);
});

test('filters categories without losing drafts or exporting only the visible selection', async ({ page, openReview }) => {
    await clipboard(page);
    await openReview(recommendedBatch(), { compact: true });
    const filters = page.getByRole('navigation', { name: 'Категории форматов' });
    await filters.locator('[data-category="duplicate"]').click();
    await expect(page.locator('.candidate:visible')).toHaveCount(1);
    const duplicate = page.locator('[data-candidate-id="duplicate"]');
    await duplicate.locator('.card-title-button').focus();
    await page.keyboard.press('Enter');
    await expect(duplicate.locator('.finding-title')).toBeVisible();
    await expect(duplicate.locator('.match-description')).toBeVisible();
    await expect(duplicate.locator('.snapshot')).toBeHidden();
    await expect(duplicate.locator('.editor')).toBeHidden();
    await duplicate.getByRole('button', { name: 'Редактировать', exact: true }).click();
    await duplicate.getByLabel('Описание', { exact: true }).fill('Изменено в категории дублей');
    await duplicate.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(duplicate.locator('.finding-description')).toHaveText('Изменено в категории дублей');
    await filters.locator('[data-category="review"]').click();
    await expect(page.locator('.candidate:visible')).toHaveCount(1);
    await page.locator('#select-all').click();
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 4 из 5');
    await page.locator('#clear-selection').click();
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 3 из 5');
    await page.locator('#copy-agent').click();
    const selection = JSON.parse(await copied(page));
    expect(selection.candidates.map(candidate => candidate.candidateId)).toEqual(['radio', 'interview', 'duplicate']);
    expect(selection.candidates[2].format.description).toBe('Изменено в категории дублей');
    await filters.locator('[data-category="duplicate"]').click();
    await expect(duplicate.locator('.finding-description')).toBeVisible();
    await expect(duplicate.getByRole('checkbox')).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reveals a selected invalid draft hidden by a category filter', async ({ page, openReview }) => {
    await clipboard(page);
    await openReview(recommendedBatch(), { compact: true });
    const radio = page.locator('[data-candidate-id="radio"]');
    await radio.locator('.card-title-button').click();
    await radio.getByRole('button', { name: 'Редактировать', exact: true }).click();
    await radio.getByLabel('Название', { exact: true }).fill('');
    await page.locator('[data-category="duplicate"]').click();
    await page.locator('#copy-agent').click();
    await expect(page.locator('[data-category="all"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(radio.getByLabel('Название', { exact: true })).toBeFocused();
    await expect(radio.locator('.field-error')).toBeVisible();
    expect(await copied(page)).toBeUndefined();
});

test('adds directly from the preview and can remove the explicit selection', async ({ page, openReview }) => {
    await clipboard(page);
    await openReview(recommendedBatch(), { compact: true });
    const uncertain = page.locator('[data-candidate-id="uncertain"]');
    await uncertain.locator('.card-title-button').click();
    await uncertain.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(uncertain.getByRole('checkbox')).toBeChecked();
    await expect(uncertain.locator('.decision-summary')).toHaveText('✓ Добавление выбрано');
    await expect(uncertain.locator('.editor')).toBeHidden();
    await uncertain.getByRole('button', { name: 'Снять выбор', exact: true }).click();
    await expect(uncertain.getByRole('checkbox')).not.toBeChecked();
    await expect(uncertain.locator('.decision-summary')).toHaveText('Не выбрано');
});

test('shows differences and where each result comes from while preserving the exported patch', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = recommendedBatch();
    const candidate = batch.candidates[1];
    candidate.format.forms = ['Новая форма'];
    candidate.format.note = '';
    candidate.similarFormats[0].forms = ['Короткая форма'];
    candidate.format.moderator = candidate.similarFormats[0].moderator = true;
    batch.candidates = [candidate];
    await openReview(batch);
    const card = page.locator('.candidate');
    const row = key => card.locator(`.review-field[data-field="${key}"]`);
    await expect(card.locator('.card-summary')).toHaveText(candidate.recommendation.reason);
    await expect(card.locator('.recommendation-reason')).toHaveText(candidate.recommendation.reason);
    await expect(row('moderator').locator('.is-used-source')).toHaveCount(2);
    await expect(row('moderator').locator('.transfer-field:visible')).toHaveCount(0);
    await expect(row('moderator').locator('.field-origin')).toBeHidden();
    await expect(row('moderator').locator('.field-difference')).toBeHidden();
    await card.getByLabel('Модератор', { exact: true }).selectOption('false');
    await expect(row('moderator').locator('.is-used-source')).toHaveCount(0);
    await expect(row('moderator').locator('.field-origin')).toHaveText('✎ Ручная правка');
    await expect(row('moderator').locator('.field-difference')).toBeVisible();
    await card.getByRole('button', { name: 'Взять из каталога: Модератор', exact: true }).click();
    await expect(row('moderator').locator('.is-used-source')).toHaveCount(2);
    await expect(row('moderator').locator('.transfer-field:visible')).toHaveCount(0);
    await expect(row('moderator').locator('.field-origin')).toBeHidden();
    await expect(row('title')).toHaveClass(/has-source-difference/);
    await expect(row('title')).not.toHaveClass(/is-different/);
    await expect(row('title').locator('.field-origin')).toBeHidden();
    await expect(row('title').locator('.catalog-field')).toHaveClass(/is-used-source/);
    await expect(row('note').locator('.field-origin')).toHaveText('✦ Предложение');
    const originalColor = await row('title').evaluate(node => getComputedStyle(node).backgroundColor);
    await card.getByRole('button', { name: 'Заменить из находки: Название', exact: true }).click();
    await expect(row('title').locator('.field-origin')).toBeHidden();
    await expect(row('title').locator('.finding-field')).toHaveClass(/is-used-source/);
    await expect(row('title').locator('.catalog-field')).not.toHaveClass(/is-used-source/);
    await card.getByLabel('Название', { exact: true }).fill('Ручное название');
    await expect(row('title').locator('.field-origin')).toHaveText('✎ Ручная правка');
    await expect(row('title').locator('.is-used-source')).toHaveCount(0);
    await card.getByRole('button', { name: 'Взять из каталога: Название', exact: true }).click();
    await expect(row('title').locator('.field-origin')).toBeHidden();
    await expect(row('title')).not.toHaveClass(/is-different/);
    await card.getByRole('button', { name: 'Добавить из находки: Форма', exact: true }).click();
    await expect(row('forms').locator('.field-origin')).toBeHidden();
    await expect(row('forms').locator('.is-used-source')).toHaveCount(2);
    await card.getByLabel('Дополнительно', { exact: true }).fill('Ручная заметка');
    await expect(row('note').locator('.field-origin')).toHaveText('✎ Ручная правка');
    await card.getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    await expect(card.locator('.field-origin:visible')).toHaveCount(0);
    await card.getByRole('button', { name: 'Подготовить обновление', exact: true }).click();
    await showAllFields(card);
    await expect(row('note').locator('.field-origin')).toHaveText('✎ Ручная правка');
    await expect(row('forms').locator('.field-origin')).toBeHidden();
    await page.locator('#copy-agent').click();
    const changes = JSON.parse(await copied(page)).candidates[0].changes;
    expect(changes).not.toHaveProperty('title');
    expect(changes.forms).toEqual({ before: ['Короткая форма'], after: ['Короткая форма', 'Новая форма'] });
    expect(changes.note.after).toBe('Ручная заметка');
    await card.getByRole('button', { name: 'Взять из каталога: Дополнительно', exact: true }).click();
    await expect(row('note')).not.toHaveClass(/has-source-difference/);
    expect(await row('note').evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(originalColor);
});

const draftKey = batch => `format-review-draft:v1:${encodeURIComponent(batch.batchId)}`;

test('autosaves edits, tags and unselected drafts immediately and restores them after closing the page', async ({ page, context, openReview }) => {
    await clipboard(page);
    await openReview(example);
    const radio = page.locator('[data-candidate-id="radio"]');
    await radio.getByLabel('Название', { exact: true }).fill('Сохранённое название');
    await radio.getByLabel('Описание', { exact: true }).fill('Первая строка\nВторая строка');
    await radio.getByLabel('Реквизит', { exact: true }).selectOption('false');
    await radio.getByLabel('Видео', { exact: true }).fill('https://example.com/saved.mp4');
    await radio.getByLabel('Особенности', { exact: true }).selectOption('new');
    await radio.getByLabel('Новый тег: Особенности', { exact: true }).fill('Мой тег');
    await radio.getByLabel('Новый тег: Особенности', { exact: true }).press('Enter');
    await radio.getByRole('checkbox').uncheck();
    await page.locator('[data-candidate-id="interview"]').getByRole('checkbox').check();
    await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
    const url = page.url();
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(url);
    const restored = reopened.locator('[data-candidate-id="radio"]');
    await expect(restored.getByLabel('Название', { exact: true })).toHaveValue('Сохранённое название');
    await expect(restored.getByLabel('Описание', { exact: true })).toHaveValue('Первая строка\nВторая строка');
    await expect(restored.getByLabel('Реквизит', { exact: true })).toHaveValue('false');
    await expect(restored.getByLabel('Видео', { exact: true })).toHaveValue('https://example.com/saved.mp4');
    await expect(restored.getByRole('button', { name: 'Убрать Особенности: Мой тег' })).toBeVisible();
    await expect(restored.getByRole('checkbox')).not.toBeChecked();
    await expect(reopened.locator('[data-candidate-id="interview"]').getByRole('checkbox')).toBeChecked();
    await expect(reopened.locator('#save-status')).toContainText('восстановлены');
    await reopened.close();
});

test('autosaves independent create and update target drafts including manual origins and category', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = recommendedBatch();
    const candidate = batch.candidates[1];
    candidate.similarFormats.push({ ...structuredClone(candidate.similarFormats[0]), id: 'second-target', title: 'Вторая цель' });
    batch.candidates = [candidate];
    await openReview(batch);
    const card = page.locator('.candidate');
    await card.getByLabel('Дополнительно', { exact: true }).fill('Правка первой цели');
    await card.getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    await card.getByLabel('Название', { exact: true }).fill('Свой новый формат');
    await chooseUpdate(card.locator('[data-format-id="second-target"]'));
    await showAllFields(card);
    await card.getByLabel('Дополнительно', { exact: true }).fill('Правка второй цели');
    await page.locator('[data-category="update"]').click();
    await page.reload();
    await expect(page.locator('[data-category="update"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(card.getByLabel('Дополнительно', { exact: true })).toHaveValue('Правка второй цели');
    await expect(card.locator('.review-field[data-field="note"] .field-origin')).toHaveText('✎ Ручная правка');
    await chooseUpdate(card.locator('[data-format-id="press-konferentsiya"]'));
    await expect(card.getByLabel('Дополнительно', { exact: true })).toHaveValue('Правка первой цели');
    await page.locator('#copy-agent').click();
    const patch = JSON.parse(await copied(page)).candidates[0];
    expect(patch.targetId).toBe('press-konferentsiya');
    expect(patch.changes.note.after).toBe('Правка первой цели');
    await card.getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    await expect(card.getByLabel('Название', { exact: true })).toHaveValue('Свой новый формат');
});

test('reset requires confirmation and restores original fields, recommendations and selection only for this batch', async ({ page, openReview }) => {
    const batch = recommendedBatch();
    await openReview(batch);
    await page.evaluate(() => {
        localStorage.setItem('format-review-draft:v1:another-batch', 'keep');
        localStorage.setItem('format-review-width', '1094');
    });
    const radio = page.locator('[data-candidate-id="radio"]');
    const update = page.locator('[data-candidate-id="interview"]');
    await radio.getByLabel('Название', { exact: true }).fill('Удаляемая правка');
    await radio.getByLabel('Особенности', { exact: true }).selectOption('new');
    await radio.getByLabel('Новый тег: Особенности', { exact: true }).fill('Не добавленный тег');
    await update.getByLabel('Дополнительно', { exact: true }).fill('Удаляемое обновление');
    await page.locator('#select-all').click();
    await page.locator('#reset-review').click();
    await expect(page.locator('#cancel-reset')).toBeFocused();
    await page.locator('#cancel-reset').click();
    await expect(radio.getByLabel('Название', { exact: true })).toHaveValue('Удаляемая правка');
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 5 из 5');
    await expect(radio.getByLabel('Новый тег: Особенности', { exact: true })).toHaveValue('Не добавленный тег');
    await page.locator('#reset-review').click();
    await page.locator('#confirm-reset').click();
    await expect(page.locator('#reset-review')).toBeFocused();
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 2 из 5');
    await page.reload();
    await radio.locator('.card-title-button').click();
    await expect(radio.locator('.finding-title')).toHaveText(batch.candidates[0].format.title);
    await update.locator('.card-title-button').click();
    await expect(update.getByLabel('Дополнительно', { exact: true })).toHaveValue(batch.candidates[1].recommendation.changes.note);
    await expect(update.locator('.review-field[data-field="note"] .field-origin')).toHaveText('✦ Предложение');
    expect(await page.evaluate(() => localStorage.getItem('format-review-draft:v1:another-batch'))).toBe('keep');
    expect(await page.evaluate(() => localStorage.getItem('format-review-width'))).toBe('1094');
});

test('resets only one format and its target drafts, preserving other work and autosaving the reset', async ({ page, openReview }) => {
    await clipboard(page);
    const batch = recommendedBatch();
    const candidate = batch.candidates[1];
    candidate.similarFormats.push({ ...structuredClone(candidate.similarFormats[0]), id: 'second-target', title: 'Вторая цель' });
    await openReview(batch);
    const radio = page.locator('[data-candidate-id="radio"]');
    const card = page.locator('[data-candidate-id="interview"]');
    await expect(page.locator('.reset-format:visible')).toHaveCount(0);
    await card.getByRole('checkbox').uncheck();
    await expect(card.locator('.reset-format')).toBeHidden();
    await card.getByRole('checkbox').check();
    await chooseUpdate(card.locator('[data-format-id="second-target"]'));
    await expect(card.locator('.reset-format')).toBeHidden();
    await chooseUpdate(card.locator('[data-format-id="press-konferentsiya"]'));
    await showAllFields(card);
    await expect(card.locator('.reset-format')).toBeHidden();
    await radio.getByLabel('Название', { exact: true }).fill('Сохранить другую карточку');
    await radio.getByLabel('Особенности', { exact: true }).selectOption('new');
    await radio.getByLabel('Новый тег: Особенности', { exact: true }).fill('Тег другой карточки');
    await radio.getByLabel('Новый тег: Особенности', { exact: true }).press('Enter');
    await radio.getByLabel('Особенности', { exact: true }).selectOption('new');
    await radio.getByLabel('Новый тег: Особенности', { exact: true }).fill('Ещё не добавленный тег');
    await radio.getByRole('checkbox').uncheck();
    await card.getByLabel('Дополнительно', { exact: true }).fill('Правка первой цели');
    await card.getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    await card.getByLabel('Название', { exact: true }).fill('Правка создания');
    await chooseUpdate(card.locator('[data-format-id="second-target"]'));
    await expect(card.locator('.reset-format')).toBeVisible();
    await showAllFields(card);
    await card.getByLabel('Дополнительно', { exact: true }).fill('Правка второй цели');
    await card.getByRole('checkbox').uncheck();
    await page.locator('[data-category="update"]').click();
    const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), draftKey(batch));
    const before = await saved();
    await card.locator('.reset-format').click();
    await expect(page.locator('#reset-help')).toContainText(candidate.format.title);
    await expect(page.locator('#cancel-reset')).toBeFocused();
    await page.locator('#cancel-reset').click();
    expect(await saved()).toEqual(before);
    await card.locator('.reset-format').click();
    await page.keyboard.press('Escape');
    await expect(card.locator('.reset-format')).toBeFocused();
    expect(await saved()).toEqual(before);
    await card.locator('.reset-format').click();
    await page.locator('#confirm-reset').click();
    await expect(card.locator('.reset-format')).toBeHidden();
    await expect(card.locator('.card-title-button')).toBeFocused();
    await expect(card.locator('.card-body')).toBeVisible();
    await expect(card.getByRole('checkbox')).toBeChecked();
    await expect(card.getByLabel('Дополнительно', { exact: true })).toHaveValue(candidate.recommendation.changes.note);
    await expect(card.locator('.review-field[data-field="note"] .field-origin')).toHaveText('✦ Предложение');
    await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
    const after = await saved();
    expect(after.category).toBe('update');
    expect(after.options).toEqual(before.options);
    expect(after.candidates.filter(item => item.candidateId !== candidate.candidateId))
        .toEqual(before.candidates.filter(item => item.candidateId !== candidate.candidateId));
    await page.locator('[data-category="all"]').click();
    await expect(radio.getByLabel('Новый тег: Особенности', { exact: true })).toHaveValue('Ещё не добавленный тег');
    await page.reload();
    await expect(radio.getByLabel('Название', { exact: true })).toHaveValue('Сохранить другую карточку');
    await expect(radio.getByRole('checkbox')).not.toBeChecked();
    await expect(radio.getByRole('button', { name: 'Убрать Особенности: Тег другой карточки' })).toBeVisible();
    await expect(card.getByLabel('Дополнительно', { exact: true })).toHaveValue(candidate.recommendation.changes.note);
    await expect(card.locator('.reset-format')).toBeHidden();
    await expect(radio.locator('.reset-format')).toBeVisible();
    await page.locator('#copy-agent').click();
    expect(JSON.parse(await copied(page)).candidates[0].changes.note.after).toBe(candidate.recommendation.changes.note);
    await card.getByRole('button', { name: 'Добавить как новый', exact: true }).click();
    await expect(card.getByLabel('Название', { exact: true })).toHaveValue(candidate.format.title);
    await card.locator('[data-format-id="second-target"] > summary').click();
    await chooseUpdate(card.locator('[data-format-id="second-target"]'));
    await showAllFields(card);
    await expect(card.getByLabel('Дополнительно', { exact: true })).toHaveValue(candidate.similarFormats[1].note);
});

test('individual reset restores original create selection and clears unfinished tag input', async ({ page, openReview }) => {
    const batch = recommendedBatch();
    await openReview(batch);
    for (const id of ['radio', 'uncertain']) {
        const card = page.locator(`[data-candidate-id="${id}"]`);
        const candidate = batch.candidates.find(item => item.candidateId === id);
        await expect(card.locator('.reset-format')).toBeHidden();
        await card.getByRole('checkbox').check();
        await expect(card.locator('.reset-format')).toBeHidden();
        await card.getByRole('checkbox').uncheck();
        await expect(card.locator('.reset-format')).toBeHidden();
        await card.getByLabel('Название', { exact: true }).fill('Отменяемая вручную правка');
        await expect(card.locator('.reset-format')).toBeVisible();
        await card.getByLabel('Название', { exact: true }).fill(candidate.format.title);
        await expect(card.locator('.reset-format')).toBeHidden();
        await card.getByLabel('Название', { exact: true }).fill('Временное название');
        await card.getByLabel('Особенности', { exact: true }).selectOption('new');
        await card.getByLabel('Новый тег: Особенности', { exact: true }).fill('Незавершённый тег');
        await card.locator('.reset-format').click();
        await page.locator('#confirm-reset').click();
        await expect(card.locator('.reset-format')).toBeHidden();
        await expect(card.locator('.finding-title')).toHaveText(candidate.format.title);
        await expect(card.getByRole('checkbox')).toBeChecked({ checked: id === 'radio' });
        await card.getByRole('button', { name: 'Редактировать', exact: true }).click();
        await expect(card.getByLabel('Новый тег: Особенности', { exact: true })).toHaveValue('');
        await expect(card.getByLabel('Особенности', { exact: true })).toBeVisible();
    }
    await page.reload();
    await expect(page.locator('[data-candidate-id="radio"]').getByRole('checkbox')).toBeChecked();
    await expect(page.locator('[data-candidate-id="uncertain"]').getByRole('checkbox')).not.toBeChecked();
    await page.locator('#reset-review').click();
    await expect(page.locator('#reset-title')).toHaveText('Сбросить правки?');
    await expect(page.locator('#reset-help')).toContainText('Все поля и выбор форматов в этой подборке');
});

test('keeps saves separate by batch id and rejects changed source snapshots without overwriting the save', async ({ page, openReview }) => {
    await openReview(example);
    const radio = page.locator('[data-candidate-id="radio"]');
    await radio.getByLabel('Название', { exact: true }).fill('Сохранение первой партии');
    const firstSave = await page.evaluate(key => localStorage.getItem(key), draftKey(example));
    const second = { ...structuredClone(example), batchId: 'another-review' };
    await openReview(second, { compact: true });
    await expect(radio.locator('.card-title-button')).toHaveText(example.candidates[0].format.title);
    await expect(radio.getByRole('checkbox')).not.toBeChecked();
    await openReview(example, { compact: true });
    await expect(radio.getByLabel('Название', { exact: true })).toHaveValue('Сохранение первой партии');
    const changed = structuredClone(example);
    changed.candidates[0].format.description = 'Другие исходные данные';
    await openReview(changed, { compact: true });
    await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'error');
    await expect(radio.locator('.card-title-button')).toHaveText(example.candidates[0].format.title);
    expect(await page.evaluate(key => localStorage.getItem(key), draftKey(example))).toBe(firstSave);
    await page.locator('#reset-review').click();
    await page.locator('#confirm-reset').click();
    await radio.locator('.card-title-button').click();
    await expect(radio.locator('.finding-description')).toHaveText('Другие исходные данные');
    await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
});

test('rejects corrupted saved drafts and recovers through reset', async ({ page, openReview }) => {
    await openReview(example);
    const key = draftKey(example);
    await page.evaluate(key => localStorage.setItem(key, '{broken'), key);
    await page.reload();
    await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('.candidate')).toHaveCount(3);
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('{broken');
    await page.locator('#reset-review').click();
    await page.locator('#confirm-reset').click();
    await page.locator('#select-all').click();
    await page.reload();
    await expect(page.locator('#selection-count')).toHaveText('Выбрано: 3 из 3');
    await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
});

test('keeps the last saved version when storage writes fail and recovers on a later edit', async ({ page, openReview }) => {
    await clipboard(page);
    await openReview(example);
    const radio = page.locator('[data-candidate-id="radio"]');
    await radio.getByLabel('Название', { exact: true }).fill('Успешно сохранено');
    const previous = await page.evaluate(key => localStorage.getItem(key), draftKey(example));
    await page.evaluate(() => {
        window.originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
            if (key.startsWith('format-review-draft:')) throw new DOMException('Full', 'QuotaExceededError');
            return window.originalSetItem.call(this, key, value);
        };
    });
    await radio.getByLabel('Название', { exact: true }).fill('Правка при ошибке');
    await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'error');
    expect(await page.evaluate(key => localStorage.getItem(key), draftKey(example))).toBe(previous);
    await page.locator('#copy-agent').click();
    expect(JSON.parse(await copied(page)).candidates[0].format.title).toBe('Правка при ошибке');
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    await radio.getByLabel('Название', { exact: true }).fill('Сохранено после восстановления');
    await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
    await page.reload();
    await expect(radio.getByLabel('Название', { exact: true })).toHaveValue('Сохранено после восстановления');
});

test('does not overwrite newer edits from another open tab', async ({ page, context, openReview }) => {
    await openReview(example);
    const other = await context.newPage();
    await other.goto(page.url());
    const radio = page.locator('[data-candidate-id="radio"]');
    await radio.getByLabel('Название', { exact: true }).fill('Новая правка первой вкладки');
    const saved = await page.evaluate(key => localStorage.getItem(key), draftKey(example));
    const otherRadio = other.locator('[data-candidate-id="radio"]');
    await otherRadio.getByLabel('Название', { exact: true }).fill('Устаревшая вкладка');
    await expect(other.locator('#save-status')).toHaveAttribute('data-state', 'error');
    expect(await page.evaluate(key => localStorage.getItem(key), draftKey(example))).toBe(saved);
    await other.close();
});
