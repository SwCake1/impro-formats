import { describe, expect, it } from 'vitest';
import { parseFormatsJson } from './data';
import { classificationOptions, countActiveFilters, DEFAULT_FILTERS, filterFormats } from './filters';
import type { FilterState } from './types';

const records = parseFormatsJson({
  schemaVersion: 2,
  generatedAt: '2026-10-24T10:00:00.000Z',
  records: [
    { id: 'elka', title: 'Ёлка', description: 'Музыкальная сцена', moderator: false, audienceOnStage: false, props: false, furniture: 'Нет', note: '', tags: ['Короткая форма', 'Музыкальные'] },
    { id: 'stol', title: 'Стол', description: 'Угадай историю', moderator: true, audienceOnStage: true, props: true, furniture: 'Столы, Стулья', note: 'Принести таймер', tags: ['Короткая форма', 'Угадайки'] },
    { id: 'armando', title: 'Армандо', description: 'Монологи', moderator: false, audienceOnStage: false, props: null, furniture: 'Нет', note: '', tags: ['Длинная форма'] },
  ],
});

function withFilters(patch: Partial<FilterState>): FilterState {
  return { ...DEFAULT_FILTERS, featureTags: [], collectionTags: [], ...patch };
}

describe('filterFormats', () => {
  const classified = parseFormatsJson({ schemaVersion: 3, generatedAt: '2026-10-24T10:00:00Z', records: [
    { id: 'a', title: 'А', description: '', moderator: null, audienceOnStage: null, props: null, furniture: '', note: '', forms: ['Короткая форма', 'Длинная форма'], features: ['Музыкальные'], collections: ['JAM'] },
    { id: 'b', title: 'Б', description: '', moderator: null, audienceOnStage: null, props: null, furniture: '', note: '', forms: ['Короткая форма'], features: ['Музыкальные', 'Угадайки'], collections: ['Иностранные', 'JAM'] },
    { id: 'c', title: 'В', description: '', moderator: null, audienceOnStage: null, props: null, furniture: '', note: '', forms: [], features: [], collections: ['Иностранные'] },
    { id: 'd', title: 'Г', description: '', moderator: null, audienceOnStage: null, props: null, furniture: '', note: '', forms: ['Короткая форма'], features: [], collections: [] },
  ] });

  it('combines collections with OR and intersects them with form and features', () => {
    const collections = { collectionTags: ['JAM', 'Иностранные'] };
    expect(filterFormats(classified, withFilters(collections)).map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(filterFormats(classified, withFilters({ ...collections, formTag: 'Короткая форма', featureTags: ['Музыкальные', 'Угадайки'] })).map(item => item.id)).toEqual(['b']);
  });

  it('matches either form of a record and does not require a form for collections', () => {
    expect(filterFormats(classified, withFilters({ formTag: 'Длинная форма' })).map(item => item.id)).toEqual(['a']);
    expect(filterFormats(classified, withFilters({ collectionTags: ['Иностранные'] })).map(item => item.id)).toEqual(['b', 'c']);
    expect(filterFormats(classified, withFilters({ featureTags: ['Иностранные'] }))).toEqual([]);
  });

  it('derives filter choices from their own columns, retaining selected missing values', () => {
    expect(classificationOptions(classified, 'features')).toEqual(['Музыкальные', 'Угадайки']);
    expect(classificationOptions(classified, 'collections', ['Новая подборка'])).toEqual(['Иностранные', 'JAM', 'Новая подборка'].sort(new Intl.Collator('ru').compare));
    expect(countActiveFilters(withFilters({ formTag: 'Короткая форма', featureTags: ['Музыкальные'], collectionTags: ['JAM', 'Иностранные'] }))).toBe(4);
  });
  it('searches all terms and treats ё as е', () => {
    expect(filterFormats(records, withFilters({ query: 'елка музыкальная' })).map((item) => item.title)).toEqual(['Ёлка']);
  });

  it('combines form and feature tags with AND', () => {
    expect(filterFormats(records, withFilters({ formTag: 'Короткая форма', featureTags: ['Угадайки'] })).map((item) => item.title)).toEqual(['Стол']);
    expect(filterFormats(records, withFilters({ featureTags: ['Угадайки', 'Музыкальные'] }))).toHaveLength(0);
  });

  it('does not treat unknown booleans as false', () => {
    expect(filterFormats(records, withFilters({ props: 'no' })).map((item) => item.title)).toEqual(['Ёлка']);
  });

  it('filters furniture and sorts using Russian collation', () => {
    expect(filterFormats(records, withFilters({ furniture: 'chairs' })).map((item) => item.title)).toEqual(['Стол']);
    expect(filterFormats(records, withFilters({ furniture: 'none' })).map((item) => item.title)).toEqual(['Армандо', 'Ёлка']);
  });
});
