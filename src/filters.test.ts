import { describe, expect, it } from 'vitest';
import { parseFormatsCsv, EXPECTED_HEADERS } from './data';
import { DEFAULT_FILTERS, filterFormats } from './filters';
import type { FilterState } from './types';

const header = EXPECTED_HEADERS.map((value) => `"${value}"`).join(',');
const records = parseFormatsCsv(`${header}
Ёлка,"Музыкальная сцена",FALSE,FALSE,FALSE,Нет,,"Короткая форма, Музыкальные"
Стол,"Угадай историю",TRUE,TRUE,TRUE,"Столы, Стулья",Принести таймер,"Короткая форма, Угадайки"
Армандо,Монологи,FALSE,FALSE,,Нет,,Длинная форма`);

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
