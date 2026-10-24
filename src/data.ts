import { DATA_URL, LEGACY_FORM_TAGS, LEGACY_COLLECTION_TAGS } from './config';
import type { CachedFormats, FormatRecord, OptionalBoolean } from './types';

const CACHE_KEY = 'impro-formats:data:v3';

export class CatalogFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogFormatError';
  }
}

export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru')
    .replaceAll('ё', 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CatalogFormatError('Некорректная структура каталога.');
  }
  return value as Record<string, unknown>;
}

function parseRecords(value: unknown, legacy = false): FormatRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CatalogFormatError('В каталоге не найдено ни одного формата.');
  }

  const seenIds = new Set<string>();
  return value.map((value) => {
    const row = object(value);
    const text = (key: string): string => {
      const value = row[key];
      if (typeof value !== 'string') throw new CatalogFormatError('Некорректное поле ' + key + '.');
      return value.trim();
    };
    const flag = (key: string): OptionalBoolean => {
      const value = row[key];
      if (value !== null && typeof value !== 'boolean') {
        throw new CatalogFormatError('Некорректный признак ' + key + '.');
      }
      return value;
    };

    const id = text('id');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new CatalogFormatError('id должен содержать строчные латинские буквы, цифры и дефисы.');
    }
    if (seenIds.has(id)) throw new CatalogFormatError('Повторяющийся id формата: ' + id + '.');
    seenIds.add(id);

    const title = text('title');
    if (!title) throw new CatalogFormatError('У формата должно быть название.');
    const list = (key: string): string[] => {
      const values = row[key];
      if (!Array.isArray(values) || !values.every((item) => typeof item === 'string')) {
        throw new CatalogFormatError('Некорректное поле ' + key + '.');
      }
      return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
    };
    const tags = legacy ? list('tags') : [];
    const isForm = (tag: string) => (LEGACY_FORM_TAGS as readonly string[]).includes(tag);
    const isCollection = (tag: string) => (LEGACY_COLLECTION_TAGS as readonly string[]).includes(tag);

    const description = text('description');
    const note = text('note');
    const furniture = text('furniture');
    const normalizedFurniture = normalizeText(furniture);
    const furnitureKinds: FormatRecord['furnitureKinds'] = [];
    if (normalizedFurniture.includes('стул')) furnitureKinds.push('chairs');
    if (normalizedFurniture.includes('стол')) furnitureKinds.push('tables');

    return {
      id,
      title,
      description,
      moderator: flag('moderator'),
      audienceOnStage: flag('audienceOnStage'),
      props: flag('props'),
      furniture,
      furnitureKinds,
      note,
      forms: legacy ? tags.filter(isForm) : list('forms'),
      features: legacy ? tags.filter((tag) => !isForm(tag) && !isCollection(tag)) : list('features'),
      collections: legacy ? tags.filter(isCollection) : list('collections'),
      searchText: normalizeText([title, description, note].join(' ')),
    };
  });
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function parseFormatsJson(value: unknown): FormatRecord[] {
  const catalog = object(value);
  if (![2, 3].includes(catalog.schemaVersion as number) || !isTimestamp(catalog.generatedAt)) {
    throw new CatalogFormatError('Некорректная версия или дата каталога.');
  }
  return parseRecords(catalog.records, catalog.schemaVersion === 2);
}

export async function fetchFormats(
  signal?: AbortSignal,
  cached?: CachedFormats | null,
): Promise<CachedFormats> {
  // Браузер проверяет HTTP-кэш у сервера и сам обрабатывает ответы 304.
  const response = await fetch(DATA_URL, { cache: 'no-cache', signal });
  if (!response.ok) throw new Error('Не удалось загрузить каталог (HTTP ' + response.status + ').');
  const etag = response.headers.get('ETag') || null;
  if (cached && etag && cached.etag === etag) return cached;
  return {
    schemaVersion: 3,
    fetchedAt: new Date().toISOString(),
    etag,
    records: parseFormatsJson(await response.json()),
  };
}

export function readCache(storage?: Pick<Storage, 'getItem'>): CachedFormats | null {
  try {
    const target = storage ?? localStorage;
    const raw = target.getItem(CACHE_KEY) ?? target.getItem('impro-formats:data:v2');
    if (!raw) return null;
    const parsed = object(JSON.parse(raw));
    if (![2, 3].includes(parsed.schemaVersion as number) || !isTimestamp(parsed.fetchedAt)) return null;
    return {
      schemaVersion: 3,
      fetchedAt: parsed.fetchedAt,
      etag: typeof parsed.etag === 'string' ? parsed.etag : null,
      records: parseRecords(parsed.records, parsed.schemaVersion === 2),
    };
  } catch {
    return null;
  }
}

export function writeCache(
  cached: CachedFormats,
  storage?: Pick<Storage, 'setItem'>,
): CachedFormats | null {
  try {
    (storage ?? localStorage).setItem(CACHE_KEY, JSON.stringify(cached));
    return cached;
  } catch {
    return null;
  }
}
