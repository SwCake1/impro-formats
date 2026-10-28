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

const cachedCatalog = (etag: string | null = '"catalog-v1"') => ({
  schemaVersion: 3 as const,
  fetchedAt: '2026-10-24T10:00:00.000Z',
  etag,
  records: parseFormatsJson(catalog()),
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('parseFormatsJson', () => {
  it('keeps the three classifications independent in schema v3', () => {
    const { tags: _tags, ...base } = rawRecord;
    const [record] = parseFormatsJson({ ...catalog(), schemaVersion: 3, records: [{
      ...base, forms: ['Короткая форма', 'Длинная форма'],
      features: ['JAM'], collections: ['Музыкальные', 'JAM', 'JAM', ' '],
    }] });
    expect(record.forms).toEqual(['Короткая форма', 'Длинная форма']);
    expect(record.features).toEqual(['JAM']);
    expect(record.collections).toEqual(['Музыкальные', 'JAM']);
  });

  it('accepts empty classification cells without inventing a form', () => {
    const [record] = parseFormatsJson({ ...catalog(), schemaVersion: 3, records: [{
      ...rawRecord, forms: [], features: [], collections: ['JAM'],
    }] });
    expect(record.forms).toEqual([]);
    expect(record.features).toEqual([]);
    expect(record.collections).toEqual(['JAM']);
  });

  it.each(['forms', 'features', 'collections'])('rejects malformed v3 classification: %s', (field) => {
    expect(() => parseFormatsJson({ ...catalog(), schemaVersion: 3, records: [{
      ...rawRecord, forms: [], features: [], collections: [], [field]: 'JAM',
    }] })).toThrow(CatalogFormatError);
  });

  it('moves legacy collections out of form and feature groups', () => {
    const [record] = parseFormatsJson(catalog([{ ...rawRecord,
      tags: ['Короткая форма', 'JAM', 'Импровизация.Команды', 'Иностранные', 'Музыкальные'],
    }]));
    expect(record.forms).toEqual(['Короткая форма']);
    expect(record.features).toEqual(['Музыкальные']);
    expect(record.collections).toEqual(['JAM', 'Импровизация.Команды', 'Иностранные']);
  });
  it('preserves sheet IDs, text, unknown flags and tags, and prepares search and furniture filters', () => {
    const [record] = parseFormatsJson(catalog());

    expect(record.id).toBe('2-komnaty');
    expect(record.title).toBe('Формат, один');
    expect(record.description).toContain('\n');
    expect(record.moderator).toBe(true);
    expect(record.audienceOnStage).toBe(false);
    expect(record.props).toBeNull();
    expect(record.furnitureKinds).toEqual(['chairs', 'tables']);
    expect(record.forms).toEqual(['Короткая форма']);
    expect(record.features).toEqual(['Музыкальные']);
    expect(record.collections).toEqual([]);
    expect(record).not.toHaveProperty('tags');
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
  it('revalidates the HTTP cache and keeps the ETag for later loads', async () => {
    const signal = new AbortController().signal;
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(catalog()), { headers: { ETag: '"catalog-v1"' } }));
    vi.stubGlobal('fetch', fetch);

    const fresh = await fetchFormats(signal);
    expect(fresh.records[0]?.id).toBe('2-komnaty');
    expect(fresh.etag).toBe('"catalog-v1"');
    expect(fetch).toHaveBeenCalledWith(DATA_URL, { cache: 'no-cache', signal });
    expect(DATA_URL).toBe(import.meta.env.BASE_URL + 'data/formats.json');
  });

  it('reuses cached records without parsing the response when the ETag is unchanged', async () => {
    const cached = cachedCatalog();
    const response = new Response('Тело не требуется', { headers: { ETag: cached.etag! } });
    const json = vi.spyOn(response, 'json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    expect(await fetchFormats(undefined, cached)).toBe(cached);
    expect(json).not.toHaveBeenCalled();
    expect(response.bodyUsed).toBe(false);
  });

  it('loads and caches a new publication when its ETag changes', async () => {
    const cached = cachedCatalog();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(catalog([
      { ...rawRecord, title: 'Новое название' },
    ])), { headers: { ETag: '"catalog-v2"' } })));

    const fresh = await fetchFormats(undefined, cached);
    expect(fresh).not.toBe(cached);
    expect(fresh.etag).toBe('"catalog-v2"');
    expect(fresh.records[0].title).toBe('Новое название');
    expect(cached.records[0].title).toBe(rawRecord.title);
  });

  it('parses the response when the server does not provide an ETag', async () => {
    const cached = cachedCatalog();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(catalog()))));
    const fresh = await fetchFormats(undefined, cached);
    expect(fresh).not.toBe(cached);
    expect(fresh.etag).toBeNull();
    expect(fresh.records).toEqual(cached.records);
  });

  it('keeps the previous cache when the new publication is malformed', async () => {
    const cached = cachedCatalog();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(catalog([])), {
      headers: { ETag: '"broken-publication"' },
    })));
    await expect(fetchFormats(undefined, cached)).rejects.toThrow(CatalogFormatError);
    expect(cached.etag).toBe('"catalog-v1"');
    expect(cached.records[0].id).toBe(rawRecord.id);
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
    const cached = cachedCatalog();
    writeCache(cached, target);
    expect(readCache(target)).toEqual(cached);
  });

  it('stores only source fields and rebuilds derived fields when reading old and compact caches', () => {
    const target = storage();
    const cached = cachedCatalog();
    target.setItem('impro-formats:data:v3', JSON.stringify(cached));
    expect(readCache(target)).toEqual(cached);
    writeCache(cached, target);
    const stored = JSON.parse(target.getItem('impro-formats:data:v3')!);
    expect(stored.records[0]).not.toHaveProperty('searchText');
    expect(stored.records[0]).not.toHaveProperty('furnitureKinds');
    expect(readCache(target)).toEqual(cached);
  });

  it('reuses a persisted ETag after a simulated page reload', async () => {
    const target = storage();
    writeCache(cachedCatalog(), target);
    const restored = readCache(target)!;
    const response = new Response('', { headers: { ETag: restored.etag! } });
    const json = vi.spyOn(response, 'json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    expect(await fetchFormats(undefined, restored)).toBe(restored);
    expect(json).not.toHaveBeenCalled();
  });

  it('accepts an existing v2 cache without an ETag', () => {
    const target = storage();
    const oldCache = { schemaVersion: 2, fetchedAt: cachedCatalog().fetchedAt, records: [rawRecord] };
    target.setItem('impro-formats:data:v2', JSON.stringify(oldCache));
    expect(readCache(target)?.records).toEqual(parseFormatsJson(catalog()));
    expect(readCache(target)?.schemaVersion).toBe(3);
    expect(readCache(target)?.etag).toBeNull();
  });

  it('migrates a v2 cache with its ETag and persists independent classifications in v3', () => {
    const target = storage();
    target.setItem('impro-formats:data:v2', JSON.stringify({
      schemaVersion: 2, fetchedAt: cachedCatalog().fetchedAt, etag: '"old"',
      records: [{ ...rawRecord, tags: ['Короткая форма', 'Иностранные'] }],
    }));
    const restored = readCache(target)!;
    expect(restored.etag).toBe('"old"');
    expect(restored.records[0].collections).toEqual(['Иностранные']);
    expect(restored.records[0].features).toEqual([]);
    writeCache(restored, target);
    expect(JSON.parse(target.getItem('impro-formats:data:v3')!).schemaVersion).toBe(3);
    expect(readCache(target)).toEqual(restored);
  });

  it('handles unavailable storage, including a denied localStorage getter', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Storage denied', 'SecurityError'); },
    });
    try {
      expect(readCache()).toBeNull();
      expect(writeCache(cachedCatalog())).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('handles quota errors without losing the in-memory catalog', () => {
    const cached = cachedCatalog();
    const target = { setItem() { throw new DOMException('Quota exceeded', 'QuotaExceededError'); } };
    expect(writeCache(cached, target)).toBeNull();
    expect(cached.records[0].id).toBe(rawRecord.id);
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
