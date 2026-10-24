import { afterEach, describe, expect, it, vi } from 'vitest';
import snapshot from '../public/data/formats.json';
import { DATA_URL } from './config';
import { CatalogFormatError, fetchFormats, parseFormatsJson, readCache, writeCache } from './data';

const rawRecord = {
  id: '2-komnaty',
  title: 'Формат, один',
  description: 'Первая строка\nВторая строка',
  moderator: true,
  audienceOnStage: false,
  props: null,
  furniture: 'Стулья, Столы',
  note: 'Заметка, важная',
  tags: ['Короткая форма', 'Музыкальные'],
};

const catalog = (records: unknown = [rawRecord]) => ({
  schemaVersion: 2,
  generatedAt: '2026-10-24T10:00:00.000Z',
  records,
});

afterEach(() => vi.unstubAllGlobals());

describe('parseFormatsJson', () => {
  it('preserves sheet IDs, text, unknown flags and tags, and prepares search and furniture filters', () => {
    const [record] = parseFormatsJson(catalog());

    expect(record.id).toBe('2-komnaty');
    expect(record.title).toBe('Формат, один');
    expect(record.description).toContain('\n');
    expect(record.moderator).toBe(true);
    expect(record.audienceOnStage).toBe(false);
    expect(record.props).toBeNull();
    expect(record.furnitureKinds).toEqual(['chairs', 'tables']);
    expect(record.tags).toEqual(['Короткая форма', 'Музыкальные']);
    expect(record.searchText).toContain('заметка, важная');
  });

  it('keeps IDs when names change and allows equal names with distinct sheet IDs', () => {
    const records = parseFormatsJson(catalog([
      { ...rawRecord, id: '2-komnaty-2' },
      { ...rawRecord, title: 'Новое название' },
    ]));

    expect(records.map((record) => record.id)).toEqual(['2-komnaty-2', '2-komnaty']);
  });

  it('rejects duplicate IDs instead of generating replacements', () => {
    expect(() => parseFormatsJson(catalog([rawRecord, rawRecord]))).toThrow('Повторяющийся id');
  });

  it.each([
    { ...rawRecord, id: '' },
    { ...rawRecord, id: 'Неверный ID' },
    { ...rawRecord, title: '' },
    { ...rawRecord, props: 'FALSE' },
    { ...rawRecord, tags: 'Короткая форма' },
  ])('rejects malformed records: %j', (record) => {
    expect(() => parseFormatsJson(catalog([record]))).toThrow(CatalogFormatError);
  });

  it.each([
    null,
    [],
    { ...catalog(), schemaVersion: 1 },
    { ...catalog(), generatedAt: 'not-a-date' },
    catalog([]),
  ])('rejects malformed or empty catalogs: %j', (value) => {
    expect(() => parseFormatsJson(value)).toThrow(CatalogFormatError);
  });

  it('uses only supported fields and derives search data from the actual text', () => {
    const [record] = parseFormatsJson(catalog([{
      ...rawRecord,
      sourceRow: 100,
      videoUrl: 'https://example.com/video',
      internalNote: 'private',
      searchText: 'stale',
      furnitureKinds: [],
    }]));

    expect(record).not.toHaveProperty('sourceRow');
    expect(record).not.toHaveProperty('videoUrl');
    expect(record).not.toHaveProperty('internalNote');
    expect(record.searchText).not.toBe('stale');
    expect(record.furnitureKinds).toEqual(['chairs', 'tables']);
  });

  it('validates the actual published snapshot', () => {
    const records = parseFormatsJson(snapshot);

    expect(records.length).toBeGreaterThan(0);
    expect(new Set(records.map((record) => record.id)).size).toBe(records.length);
  });
});

describe('fetchFormats', () => {
  it('loads the local JSON snapshot with cancellation and without a stale HTTP cache', async () => {
    const signal = new AbortController().signal;
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(catalog())));
    vi.stubGlobal('fetch', fetch);

    expect((await fetchFormats(signal))[0]?.id).toBe('2-komnaty');
    expect(fetch).toHaveBeenCalledWith(DATA_URL, { cache: 'no-store', signal });
    expect(DATA_URL).toBe(import.meta.env.BASE_URL + 'data/formats.json');
  });

  it('reports failed requests instead of replacing valid data with an error page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not found', { status: 404 })));
    await expect(fetchFormats()).rejects.toThrow('HTTP 404');
  });

  it('rejects a successful response containing an HTML fallback page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Fallback</html>')));
    await expect(fetchFormats()).rejects.toThrow();
  });
});

describe('cache', () => {
  function storage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
  }

  it('round-trips records with the sheet IDs and unknown flags', () => {
    const target = storage();
    const records = parseFormatsJson(catalog());

    writeCache(records, '2026-10-24T10:00:00.000Z', target);
    expect(readCache(target)?.records).toEqual(records);
  });

  it('ignores the legacy cache with generated IDs', () => {
    const target = storage();
    target.setItem('impro-formats:data:v1', JSON.stringify({
      schemaVersion: 1, fetchedAt: '2026-10-24T10:00:00.000Z', records: [rawRecord],
    }));
    expect(readCache(target)).toBeNull();
  });

  it('ignores malformed cached records', () => {
    const target = storage();
    target.setItem('impro-formats:data:v2', JSON.stringify({
      schemaVersion: 2, fetchedAt: '2026-10-24T10:00:00.000Z', records: [{ ...rawRecord, props: 'FALSE' }],
    }));
    expect(readCache(target)).toBeNull();
  });
});
