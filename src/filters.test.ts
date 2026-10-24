import { describe, expect, it } from 'vitest';
import { parseFormatsJson } from './data';
import { DEFAULT_FILTERS, filterFormats } from './filters';
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
  return { ...DEFAULT_FILTERS, featureTags: [], ...patch };
}

describe('filterFormats', () => {
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
