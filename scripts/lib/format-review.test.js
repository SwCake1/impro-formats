import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createReviewSelection, parseReviewBatch, reviewCandidatesByRecommendation, reviewClassificationOptions, reviewDuplicateComparison, reviewFieldTransfer, reviewInitialState, reviewSelectionToTsv, reviewUpdateBase } from './format-review.mjs';

function sampleBatch() {
  return {
    schemaVersion: 1, kind: 'format-review-batch', batchId: 'test-batch',
    candidates: [{
      candidateId: 'one',
      format: {
        title: 'Тестовый формат', description: 'Правила\nигры', moderator: null,
        audienceOnStage: false, props: true, furniture: '', note: '',
        forms: ['Короткая форма'], features: [], collections: [], video: '',
      },
      source: { label: 'Вымышленный источник', url: 'https://example.com/format', text: 'Исходное описание' },
      similarFormats: [{ id: 'existing', title: 'Похожий', description: 'Описание', reason: 'Общая механика' }],
    }],
  };
}

describe('review batch schema', () => {
  it('accepts the documented fictional example', async () => {
    const example = JSON.parse(await readFile(new URL('../../tools/format-review/example-batch.json', import.meta.url), 'utf8'));
    const batch = parseReviewBatch(example);
    expect(batch.candidates).toHaveLength(3);
    expect(batch.candidates.every(candidate => !Object.hasOwn(candidate.format, 'id'))).toBe(true);
    expect(batch.candidates[1].similarFormats[0].id).toBe('press-konferentsiya');
    expect(batch.candidates.every(candidate => candidate.format.description === candidate.source.text)).toBe(true);
  });
  it('keeps text, flags, sources and similarities while making an independent copy', () => {
    const input = sampleBatch();
    const parsed = parseReviewBatch(input);
    expect(parsed).toEqual(input);
    parsed.candidates[0].format.forms.push('Ещё одна форма');
    expect(input.candidates[0].format.forms).toEqual(['Короткая форма']);
    expect(parsed.candidates[0].format).not.toHaveProperty('id');
    expect(parsed.candidates[0].format.moderator).toBeNull();
    expect(parsed.candidates[0].format.audienceOnStage).toBe(false);
  });

  it('accepts empty batches and optional metadata', () => {
    const input = { ...sampleBatch(), candidates: [] };
    expect(parseReviewBatch(input).candidates).toEqual([]);
    const candidate = sampleBatch().candidates[0];
    delete candidate.similarFormats;
    candidate.source = { label: 'Вручную' };
    expect(parseReviewBatch({ ...input, candidates: [candidate] }).candidates[0]).toEqual(candidate);
  });

  it('keeps old batches usable with an empty video field and retains complete match snapshots', () => {
    const input = sampleBatch();
    delete input.candidates[0].format.video;
    Object.assign(input.candidates[0].similarFormats[0], {
      moderator: false, audienceOnStage: null, props: true, furniture: 'Стул', note: 'Примечание',
      forms: ['Короткая форма'], features: ['Угадайки'], collections: [],
      url: 'https://example.com/?format=existing', video: 'https://example.com/existing.mp4',
    });
    const batch = parseReviewBatch(input);
    expect(batch.candidates[0].format.video).toBe('');
    expect(batch.candidates[0].similarFormats).toEqual(input.candidates[0].similarFormats);
    const missing = parseReviewBatch(sampleBatch()).candidates[0].similarFormats[0];
    expect(missing).not.toHaveProperty('props');
    expect(missing).not.toHaveProperty('video');
  });

  it.each([
    ['schemaVersion', batch => { batch.schemaVersion = 3; }],
    ['kind', batch => { batch.kind = 'format-review-selection'; }],
    ['batchId', batch => { batch.batchId = ' '; }],
    ['candidates', batch => { batch.candidates = {}; }],
    ['candidates[1].candidateId', batch => { batch.candidates.push(batch.candidates[0]); }],
    ['format.title', batch => { delete batch.candidates[0].format.title; }],
    ['format.moderator', batch => { batch.candidates[0].format.moderator = ''; }],
    ['format.props', batch => { delete batch.candidates[0].format.props; }],
    ['format.forms', batch => { batch.candidates[0].format.forms = 'Короткая'; }],
    ['format.features[0]', batch => { batch.candidates[0].format.features = ['']; }],
    ['format.id', batch => { batch.candidates[0].format.id = 'invented-id'; }],
    ['source.label', batch => { batch.candidates[0].source.label = null; }],
    ['similarFormats[0].reason', batch => { batch.candidates[0].similarFormats[0].reason = ''; }],
  ])('rejects invalid %s with a field path', (path, change) => {
    const batch = sampleBatch();
    change(batch);
    expect(() => parseReviewBatch(batch)).toThrow(path);
  });
});

describe('review exports', () => {
  it('exports only selected candidates in batch order with current edits and context', () => {
    const input = sampleBatch();
    input.candidates.push({ ...structuredClone(input.candidates[0]), candidateId: 'two' });
    input.candidates.push({ ...structuredClone(input.candidates[0]), candidateId: 'three' });
    const batch = parseReviewBatch(input);
    const changed = { ...batch.candidates[0].format, title: 'Новое название', features: ['Музыкальные'], props: null };
    const selection = createReviewSelection(batch, new Set(['three', 'one']), new Map([['one', changed]]));
    const json = JSON.parse(JSON.stringify(selection));
    expect(json.kind).toBe('format-review-selection');
    expect(json.batchId).toBe('test-batch');
    expect(json.candidates.map(candidate => candidate.candidateId)).toEqual(['one', 'three']);
    expect(json.candidates[0].format).toEqual(changed);
    expect(json.candidates[0].source).toEqual(input.candidates[0].source);
    expect(json.candidates[0].similarFormats).toEqual(input.candidates[0].similarFormats);
    expect(json.candidates[0].format).not.toHaveProperty('id');
    expect(batch.candidates[0].format.title).toBe('Тестовый формат');
  });

  it('writes A–L with a blank permanent id and preserves multiline cells and videos', () => {
    const batch = sampleBatch();
    batch.candidates[0].format.description = 'Первая "реплика"\nВторая\tреплика';
    batch.candidates[0].format.forms = ['Короткая форма', 'Длинная форма'];
    const tsv = reviewSelectionToTsv(createReviewSelection(batch, new Set(['one'])));
    expect(tsv).toBe('\tТестовый формат\t"Первая ""реплика""\nВторая\tреплика"\t\tFALSE\tTRUE\t\t\tКороткая форма, Длинная форма\t\t\t');
    expect(tsv).not.toContain('existing');
    batch.candidates[0].format.video = 'https://example.com/one.mp4\nhttps://example.com/two.mp4';
    const selection = createReviewSelection(batch, new Set(['one']));
    expect(selection.candidates[0].format.video).toBe(batch.candidates[0].format.video);
    expect(reviewSelectionToTsv(selection).endsWith('"https://example.com/one.mp4\nhttps://example.com/two.mp4"')).toBe(true);
  });

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', ' \t=IMPORTXML("url")', "'буквальная кавычка"])(
    'keeps formula-like text literal only in the spreadsheet transport: %s', value => {
      const batch = sampleBatch();
      batch.candidates[0].format.title = value;
      const selection = createReviewSelection(batch, new Set(['one']));
      expect(reviewSelectionToTsv(selection)).toContain("'" + value.replaceAll('"', '""'));
      expect(JSON.parse(JSON.stringify(selection)).candidates[0].format.title).toBe(value);
    },
  );

  it('rejects empty selections and blank selected titles, but ignores unselected invalid drafts', () => {
    const batch = sampleBatch();
    expect(() => createReviewSelection(batch, new Set())).toThrow('выберите');
    const drafts = new Map([['one', { ...batch.candidates[0].format, title: ' ' }]]);
    expect(() => createReviewSelection(batch, new Set(['one']), drafts)).toThrow('format.title');
    batch.candidates.push({ ...structuredClone(batch.candidates[0]), candidateId: 'two' });
    expect(createReviewSelection(batch, new Set(['two']), drafts).candidates).toHaveLength(1);
  });
});

describe('review classification choices', () => {
  it('merges existing v3 values, optional choices and candidate tags without mixing groups', () => {
    const batch = sampleBatch();
    batch.classificationOptions = { forms: ['Длинная форма'], features: ['Музыкальные'], collections: [] };
    const parsed = parseReviewBatch(batch);
    const options = reviewClassificationOptions(parsed, { schemaVersion: 3, records: [
      { forms: ['Короткая форма'], features: ['Музыкальные', 'Угадайки'], collections: ['Музыкальные', 'JAM'] },
    ] });
    expect(options.forms).toEqual(['Длинная форма', 'Короткая форма']);
    expect(options.features).toEqual(['Музыкальные', 'Угадайки']);
    expect(options.collections).toEqual(['Музыкальные', 'JAM']);
    expect(parsed.classificationOptions).toEqual(batch.classificationOptions);
  });

  it('supports the legacy catalog snapshot and rejects malformed classification data', () => {
    const options = reviewClassificationOptions(sampleBatch(), { schemaVersion: 2, records: [
      { tags: ['Длинная форма', 'Иностранные', 'Музыкальные'] },
    ] });
    expect(options).toEqual({ forms: ['Длинная форма', 'Короткая форма'], features: ['Музыкальные'], collections: ['Иностранные'] });
    expect(() => reviewClassificationOptions(sampleBatch(), { schemaVersion: 3, records: [{ forms: [] }] }))
      .toThrow('catalog.records[0].features');
    expect(() => parseReviewBatch({ ...sampleBatch(), classificationOptions: { forms: 'text' } }))
      .toThrow('batch.classificationOptions.forms');
  });
});

function updateBatch() {
  const batch = sampleBatch();
  batch.candidates[0].similarFormats = [{
    ...structuredClone(batch.candidates[0].format), id: 'existing', title: 'Существующий формат',
    description: 'Описание из каталога', moderator: false, props: false, furniture: 'Стул',
    note: 'Сохранить примечание', video: 'https://example.com/old.mp4', reason: 'Сходство правил',
  }];
  return parseReviewBatch(batch);
}

describe('agent recommendations', () => {
  it('groups the view by recommendation stably without rearranging the source batch', () => {
    const input = [
      ['duplicate-1', 'duplicate'], ['review-1', 'review'], ['update', 'update'], ['create-1', 'create'],
      ['unclassified', undefined], ['skip', 'skip'], ['create-2', 'create'], ['duplicate-2', 'duplicate'], ['review-2', 'review'],
    ].map(([candidateId, action]) => ({ candidateId, ...(action ? { recommendation: { action } } : {}) }));
    const before = structuredClone(input);
    const sorted = reviewCandidatesByRecommendation(input);
    expect(sorted.map(candidate => candidate.candidateId)).toEqual([
      'create-1', 'create-2', 'update', 'review-1', 'unclassified', 'review-2', 'skip', 'duplicate-1', 'duplicate-2',
    ]);
    expect(input).toEqual(before);
    expect(sorted[0]).toBe(input[3]);
  });

  it('accepts the recommended example without mutating its finding or catalog snapshots', async () => {
    const input = JSON.parse(await readFile(new URL('../../tools/format-review/example-recommendations.json', import.meta.url), 'utf8'));
    const original = structuredClone(input);
    const batch = parseReviewBatch(input);
    const states = batch.candidates.map(reviewInitialState);
    expect(states.filter(state => state.selected)).toHaveLength(2);
    expect(batch.candidates.map(candidate => candidate.recommendation.action)).toEqual(['create', 'update', 'duplicate', 'review']);
    expect(states[1].format.description).toBe(batch.candidates[1].similarFormats[0].description);
    expect(states[1].format.moderator).toBe(false);
    expect(input).toEqual(original);
  });

  it.each([
    ['create', true], ['duplicate', false], ['skip', false], ['review', false],
  ])('starts %s with the recommended selection while keeping finding data', (action, selected) => {
    const input = updateBatch();
    const row = input.candidates[0];
    row.recommendation = { action, reason: 'Объяснение рекомендации', ...(action === 'duplicate' ? { targetId: 'existing' } : {}) };
    const candidate = parseReviewBatch(input).candidates[0];
    const state = reviewInitialState(candidate);
    expect(state).toEqual({ selected, mode: { action: 'create' }, format: row.format });
    state.format.features.push('Правка');
    expect(candidate.format.features).toEqual([]);
    expect(reviewInitialState(parseReviewBatch(sampleBatch()).candidates[0]).selected).toBe(false);
  });

  it('prepares only proposed update fields, preserves catalog data and exports the actual decision', () => {
    const input = updateBatch();
    const original = structuredClone(input);
    input.candidates[0].recommendation = { action: 'update', reason: 'Есть новое видео и тег', targetId: 'existing',
      changes: { video: 'https://example.com/old.mp4\nhttps://example.com/new.mp4', features: ['Музыкальные'] } };
    const batch = parseReviewBatch(input);
    const state = reviewInitialState(batch.candidates[0]);
    expect(state.mode).toEqual({ action: 'update', targetId: 'existing' });
    expect(state.selected).toBe(true);
    expect(state.format).toMatchObject({ title: 'Существующий формат', props: false, moderator: false,
      furniture: 'Стул', note: 'Сохранить примечание', features: ['Музыкальные'] });
    expect(batch.candidates[0].format).toEqual(original.candidates[0].format);
    expect(batch.candidates[0].similarFormats).toEqual(original.candidates[0].similarFormats);
    expect(reviewClassificationOptions(batch).features).toContain('Музыкальные');
    const selection = createReviewSelection(batch, new Set(['one']), new Map([['one', state.format]]), new Map([['one', state.mode]]));
    expect(Object.keys(selection.candidates[0].changes)).toEqual(['video', 'features']);
    expect(selection.candidates[0].recommendation).toEqual(input.candidates[0].recommendation);
    // The recommendation is context; a user can instead choose creation.
    const override = createReviewSelection(batch, new Set(['one']));
    expect(override.candidates[0].action).toBe('create');
    expect(override.candidates[0].recommendation.action).toBe('update');
  });

  it('keeps a less complete duplicate unselected without treating unknown fields as updates', () => {
    const input = updateBatch();
    input.candidates[0].format = { ...input.candidates[0].format, props: null, furniture: '', features: [], video: '' };
    input.candidates[0].recommendation = { action: 'duplicate', reason: 'В каталоге уже больше данных', targetId: 'existing' };
    const candidate = parseReviewBatch(input).candidates[0];
    expect(reviewInitialState(candidate).selected).toBe(false);
    expect(reviewUpdateBase(candidate.similarFormats[0])).toMatchObject({ props: false, furniture: 'Стул', video: 'https://example.com/old.mp4' });
  });

  it.each([
    ['action', rec => { rec.action = 'random-emoji'; }],
    ['reason', rec => { rec.reason = ''; }],
    ['targetId', rec => { rec.targetId = 'missing'; }],
    ['changes', rec => { rec.changes = {}; }],
    ['changes.id', rec => { rec.changes = { id: 'renamed' }; }],
    ['changes.props', rec => { rec.changes = { props: null }; }],
    ['changes.props', rec => { rec.changes = { props: true }; }],
    ['changes.note', rec => { rec.changes = { note: ' ' }; }],
    ['changes.features', rec => { rec.changes = { features: [] }; }],
    ['changes.features', rec => { rec.changes = { features: ['Другой'] }; }],
    ['changes.forms', rec => { rec.changes = { forms: ['Короткая форма', 'Короткая форма'] }; }],
    ['changes.video', rec => { rec.changes = { video: 'https://example.com/new.mp4' }; }],
    ['changes.video', rec => { rec.changes = { video: ' https://example.com/old.mp4\n' }; }],
    ['changes.furniture', rec => { rec.changes = { furniture: 'Стул' }; }],
  ])('rejects an invalid or destructive recommendation at %s', (path, alter) => {
    const input = updateBatch();
    input.candidates[0].similarFormats[0].features = ['Существующий'];
    const rec = { action: 'update', reason: 'Дополнение', targetId: 'existing', changes: { note: 'Новая заметка' } };
    alter(rec);
    input.candidates[0].recommendation = rec;
    expect(() => parseReviewBatch(input)).toThrow(`recommendation.${path}`);
  });

  it('rejects incomplete update targets and does not silently ignore changes on a duplicate', () => {
    const input = sampleBatch();
    input.candidates[0].recommendation = { action: 'update', reason: 'Дополнение', targetId: 'existing', changes: { note: 'Заметка' } };
    expect(() => parseReviewBatch(input)).toThrow('полный снимок');
    input.candidates[0].recommendation.action = 'duplicate';
    expect(() => parseReviewBatch(input)).toThrow('у дубля нет изменений');
    input.candidates[0].recommendation = { action: 'skip', reason: 'Не формат', targetId: 'existing' };
    expect(() => parseReviewBatch(input)).toThrow('recommendation');
  });
});

describe('duplicate agreement', () => {
  function duplicateBatch() {
    const batch = sampleBatch();
    const row = batch.candidates[0];
    Object.assign(row.format, { moderator: false, furniture: 'Нет', features: ['Первый', 'Второй'], collections: ['JAM'] });
    row.similarFormats = [{ ...structuredClone(row.format), id: 'existing', reason: 'Те же правила' }];
    row.recommendation = { action: 'duplicate', targetId: 'existing', reason: 'Дополнений нет', descriptionMatch: 'equivalent' };
    return batch;
  }

  it('compares false flags, names and unordered tag sets without mutating input', () => {
    const batch = duplicateBatch();
    const row = batch.candidates[0];
    row.similarFormats[0].title = '  ТЕСТОВЫЙ   ФОРМАТ  ';
    row.similarFormats[0].features = ['второй', 'Первый', 'Первый'];
    const original = structuredClone(batch);
    const comparison = reviewDuplicateComparison(parseReviewBatch(batch).candidates[0]);
    expect(comparison).toMatchObject({ title: { status: 'same' }, description: { text: 'дословно' }, parameters: { status: 'same' } });
    expect(comparison.parameters.fields).toHaveLength(7);
    expect(batch).toEqual(original);
  });

  it('uses agent semantics only for nonidentical known descriptions, and keeps legacy uncertainty', () => {
    const batch = duplicateBatch();
    const row = batch.candidates[0];
    row.format.title = 'Другое название';
    row.format.description = 'Другая формулировка тех же правил';
    let comparison = reviewDuplicateComparison(parseReviewBatch(batch).candidates[0]);
    expect(comparison.title.status).toBe('different');
    expect(comparison.description).toEqual({ status: 'same', text: 'по смыслу' });
    delete row.recommendation.descriptionMatch;
    expect(reviewDuplicateComparison(parseReviewBatch(batch).candidates[0]).description.status).toBe('unknown');
    row.recommendation.descriptionMatch = 'different';
    expect(reviewDuplicateComparison(parseReviewBatch(batch).candidates[0]).description.status).toBe('different');
    row.format.description = '';
    row.recommendation.descriptionMatch = 'equivalent';
    expect(reviewDuplicateComparison(parseReviewBatch(batch).candidates[0]).description.status).toBe('unknown');
  });

  it('does not count missing, null or empty parameters as agreement, and exposes known conflicts', () => {
    const batch = duplicateBatch();
    const row = batch.candidates[0];
    row.format.moderator = null;
    row.format.furniture = '';
    row.format.features = [];
    row.format.collections = [];
    delete row.similarFormats[0].props;
    let comparison = reviewDuplicateComparison(parseReviewBatch(batch).candidates[0]);
    expect(comparison.parameters).toMatchObject({ status: 'partial', text: 'частично (2/7)' });
    expect(comparison.parameters.fields.filter(field => field.status === 'unknown')).toHaveLength(5);
    row.format.audienceOnStage = true;
    comparison = reviewDuplicateComparison(parseReviewBatch(batch).candidates[0]);
    expect(comparison.parameters).toMatchObject({ status: 'different', text: 'есть отличия (1)' });
    row.format.audienceOnStage = null;
    row.format.forms = [];
    expect(reviewDuplicateComparison(parseReviewBatch(batch).candidates[0]).parameters.status).toBe('unknown');
  });

  it('keeps agreement as context after manual edits and excludes it from spreadsheet columns', () => {
    const batch = parseReviewBatch(duplicateBatch());
    const draft = { ...batch.candidates[0].format, title: 'Ручное новое название' };
    const selection = createReviewSelection(batch, new Set(['one']), new Map([['one', draft]]));
    expect(selection.candidates[0].recommendation.descriptionMatch).toBe('equivalent');
    expect(reviewDuplicateComparison(batch.candidates[0]).title.status).toBe('same');
    expect(reviewSelectionToTsv(selection).split('\t')).toHaveLength(12);
    expect(reviewSelectionToTsv(selection)).not.toContain('equivalent');
  });

  it('validates the semantic assessment and limits it to duplicate recommendations', () => {
    const batch = duplicateBatch();
    batch.candidates[0].recommendation.descriptionMatch = 'same';
    expect(() => parseReviewBatch(batch)).toThrow('recommendation.descriptionMatch');
    batch.candidates[0].recommendation = { action: 'create', reason: 'Новый', descriptionMatch: 'equivalent' };
    expect(() => parseReviewBatch(batch)).toThrow('recommendation.descriptionMatch');
    delete batch.candidates[0].recommendation.descriptionMatch;
    expect(reviewDuplicateComparison(parseReviewBatch(batch).candidates[0])).toBeNull();
  });
});

describe('transferring finding fields into an update', () => {
  it('appends video lines without changing existing text or repeating equivalent lines', () => {
    const current = { video: '  https://example.com/old  \r\nЗаметка к видео\r\n' };
    const finding = { video: 'https://example.com/old\n\nhttps://example.com/new\n  https://example.com/new \nЗаметка к видео' };
    const result = reviewFieldTransfer(current, finding, 'video');
    expect(result).toBe(current.video + 'https://example.com/new');
    expect(reviewFieldTransfer({ video: result }, finding, 'video')).toBe(result);
    expect(reviewFieldTransfer({ video: '' }, finding, 'video')).toBe('https://example.com/old\nhttps://example.com/new\nЗаметка к видео');
    expect(reviewFieldTransfer(current, { video: ' \n' }, 'video')).toBe(current.video);
    expect(current.video).toBe('  https://example.com/old  \r\nЗаметка к видео\r\n');
  });

  it.each(['forms', 'features', 'collections'])('adds missing %s tags in order, preserving both inputs', key => {
    const current = { [key]: ['Существующий', 'Общий'] };
    const finding = { [key]: ['Общий', 'Новый', 'Новый'] };
    const result = reviewFieldTransfer(current, finding, key);
    expect(result).toEqual(['Существующий', 'Общий', 'Новый']);
    expect(reviewFieldTransfer({ [key]: result }, finding, key)).toEqual(result);
    result.push('Правка результата');
    expect(current[key]).toEqual(['Существующий', 'Общий']);
    expect(finding[key]).toEqual(['Общий', 'Новый', 'Новый']);
  });

  it('replaces explicit fields including empty, unknown and negative values, and exports only the transferred fields', () => {
    const batch = updateBatch();
    const finding = batch.candidates[0].format;
    const match = batch.candidates[0].similarFormats[0];
    const original = structuredClone(batch);
    const edited = reviewUpdateBase(match);
    for (const key of ['title', 'description', 'moderator', 'audienceOnStage', 'props', 'furniture', 'note']) {
      expect(reviewFieldTransfer(edited, finding, key)).toEqual(finding[key]);
    }
    edited.description = reviewFieldTransfer(edited, finding, 'description');
    edited.moderator = reviewFieldTransfer(edited, finding, 'moderator');
    edited.furniture = reviewFieldTransfer(edited, finding, 'furniture');
    const result = createReviewSelection(batch, new Set(['one']), new Map([['one', edited]]),
      new Map([['one', { action: 'update', targetId: 'existing' }]]));
    expect(result.candidates[0].changes).toEqual({
      description: { before: match.description, after: finding.description },
      furniture: { before: 'Стул', after: '' },
      moderator: { before: false, after: null },
    });
    expect(edited.note).toBe('Сохранить примечание');
    expect(batch).toEqual(original);
    expect(() => reviewFieldTransfer(edited, finding, 'id')).toThrow('неизвестное поле');
  });
});

describe('existing format updates', () => {
  it('exports only changed fields with their original values and an explicit target', () => {
    const batch = updateBatch();
    const match = batch.candidates[0].similarFormats[0];
    const base = reviewUpdateBase(match);
    const edited = { ...base, video: `${base.video}\nhttps://example.com/new.mp4` };
    const result = createReviewSelection(batch, new Set(['one']), new Map([['one', edited]]),
      new Map([['one', { action: 'update', targetId: 'existing' }]]));
    expect(result.schemaVersion).toBe(2);
    expect(result.candidates[0]).toMatchObject({
      action: 'update', targetId: 'existing', targetTitle: 'Существующий формат',
      changes: { video: { before: base.video, after: edited.video } },
    });
    expect(Object.keys(result.candidates[0].changes)).toEqual(['video']);
    expect(result.candidates[0]).not.toHaveProperty('format');
    expect(result.candidates[0].source).toEqual(batch.candidates[0].source);
    expect(match.video).toBe('https://example.com/old.mp4');
    expect(base.props).toBe(false);
    expect(edited.note).toBe('Сохранить примечание');
  });

  it('keeps create and update separate and copies only new rows to TSV', () => {
    const batch = updateBatch();
    batch.candidates.push({ ...structuredClone(batch.candidates[0]), candidateId: 'two' });
    const base = reviewUpdateBase(batch.candidates[0].similarFormats[0]);
    const selection = createReviewSelection(batch, new Set(['one', 'two']),
      new Map([['one', { ...base, title: 'Уточнённое название' }]]),
      new Map([['one', { action: 'update', targetId: 'existing' }]]));
    expect(selection.candidates.map(candidate => candidate.action)).toEqual(['update', 'create']);
    expect(selection.candidates[0].changes.title).toEqual({ before: 'Существующий формат', after: 'Уточнённое название' });
    const tsv = reviewSelectionToTsv(selection);
    expect(tsv).toContain('\tТестовый формат\t');
    expect(tsv).not.toContain('Уточнённое название');
    expect(tsv).not.toContain('old.mp4');
    expect(() => reviewSelectionToTsv({ ...selection, candidates: [selection.candidates[0]] })).toThrow('выберите новые');
  });

  it('rejects incomplete snapshots, unchanged edits, unknown targets and duplicate target updates', () => {
    const batch = updateBatch();
    const match = batch.candidates[0].similarFormats[0];
    const base = reviewUpdateBase(match);
    const modes = new Map([['one', { action: 'update', targetId: 'existing' }]]);
    expect(() => createReviewSelection(batch, new Set(['one']), new Map([['one', base]]), modes)).toThrow('нет изменений');
    expect(() => createReviewSelection(batch, new Set(['one']), new Map(), new Map([['one', { action: 'update', targetId: 'missing' }]])))
      .toThrow('выбрать одно');
    const incomplete = { ...match };
    delete incomplete.video;
    expect(() => reviewUpdateBase(incomplete)).toThrow('полный снимок');
    batch.candidates.push({ ...structuredClone(batch.candidates[0]), candidateId: 'two' });
    modes.set('two', { action: 'update', targetId: 'existing' });
    const drafts = new Map(['one', 'two'].map(id => [id, { ...base, note: `Правка ${id}` }]));
    expect(() => createReviewSelection(batch, new Set(['one', 'two']), drafts, modes)).toThrow('несколько обновлений');
  });
});
