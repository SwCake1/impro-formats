import { describe, expect, it } from 'vitest';
import { readFiltersFromUrl, writeFiltersToUrl } from './url-state';

describe('URL state', () => {
  it('serializes and restores filters and selection', () => {
    const url = writeFiltersToUrl({
      query: 'музыка',
      formTag: 'Короткая форма',
      featureTags: ['Музыкальные', 'Экстремальные'],
      collectionTags: ['JAM', 'Иностранные'],
      moderator: 'no',
      audience: 'any',
      props: 'yes',
      furniture: 'chairs',
      selectedId: '2-komnaty',
    }, new URL('https://example.test/catalog?unused=1'));

    expect(readFiltersFromUrl(url)).toEqual({
      query: 'музыка',
      formTag: 'Короткая форма',
      featureTags: ['Музыкальные', 'Экстремальные'],
      collectionTags: ['JAM', 'Иностранные'],
      moderator: 'no',
      audience: 'any',
      props: 'yes',
      furniture: 'chairs',
      selectedId: '2-komnaty',
    });
    expect(url.searchParams.has('unused')).toBe(false);
  });

  it('falls back for invalid enum values', () => {
    const filters = readFiltersFromUrl(new URL('https://example.test/?moderator=maybe&furniture=sofa'));
    expect(filters.moderator).toBe('any');
    expect(filters.furniture).toBe('any');
  });

  it('restores legacy collection links and removes duplicates without losing the selection', () => {
    const url = new URL('https://example.test/');
    url.searchParams.set('form', 'JAM');
    url.searchParams.append('feature', 'Музыкальные');
    url.searchParams.append('feature', 'Иностранные');
    url.searchParams.append('collection', 'JAM');
    url.searchParams.append('collection', '');
    const filters = readFiltersFromUrl(url);
    expect(filters.formTag).toBeNull();
    expect(filters.featureTags).toEqual(['Музыкальные']);
    expect(filters.collectionTags).toEqual(['JAM', 'Иностранные']);
    expect(readFiltersFromUrl(writeFiltersToUrl(filters, url))).toEqual(filters);
  });

  it('does not move labels between independent fields in new links', () => {
    const filters = { ...readFiltersFromUrl(new URL('https://example.test/')), formTag: 'JAM', featureTags: ['Иностранные'], collectionTags: ['Музыкальные'] };
    const url = writeFiltersToUrl(filters, new URL('https://example.test/'));
    expect(readFiltersFromUrl(url)).toEqual(filters);
  });
});
