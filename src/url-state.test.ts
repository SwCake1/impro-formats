import { describe, expect, it } from 'vitest';
import { readFiltersFromUrl, writeFiltersToUrl } from './url-state';

describe('URL state', () => {
  it('serializes and restores filters and selection', () => {
    const url = writeFiltersToUrl({
      query: 'музыка',
      formTag: 'Короткая форма',
      featureTags: ['Музыкальные', 'Иностранные'],
      moderator: 'no',
      audience: 'any',
      props: 'yes',
      furniture: 'chairs',
      selectedId: 'тест-abc',
    }, new URL('https://example.test/catalog?unused=1'));

    expect(readFiltersFromUrl(url)).toEqual({
      query: 'музыка',
      formTag: 'Короткая форма',
      featureTags: ['Музыкальные', 'Иностранные'],
      moderator: 'no',
      audience: 'any',
      props: 'yes',
      furniture: 'chairs',
      selectedId: 'тест-abc',
    });
    expect(url.searchParams.has('unused')).toBe(false);
  });

  it('falls back for invalid enum values', () => {
    const filters = readFiltersFromUrl(new URL('https://example.test/?moderator=maybe&furniture=sofa'));
    expect(filters.moderator).toBe('any');
    expect(filters.furniture).toBe('any');
  });
});
