import { DATA_URL } from './config';
import type { CachedFormats, FormatRecord, OptionalBoolean } from './types';

const CACHE_KEY = 'impro-formats:data:v2';

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

function parseRecords(value: unknown): FormatRecord[] {
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
    if (!Array.isArray(row.tags) || !row.tags.every((tag) => typeof tag === 'string')) {
      throw new CatalogFormatError('Некорректные теги формата.');
    }

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
      tags: row.tags.map((tag) => tag.trim()).filter(Boolean),
      searchText: normalizeText([title, description, note].join(' ')),
    };
  });
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function parseFormatsJson(value: unknown): FormatRecord[] {
  const catalog = object(value);
  if (catalog.schemaVersion !== 2 || !isTimestamp(catalog.generatedAt)) {
    throw new CatalogFormatError('Некорректная версия или дата каталога.');
  }
  return parseRecords(catalog.records);
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
    schemaVersion: 2,
    fetchedAt: new Date().toISOString(),
    etag,
    records: parseFormatsJson(await response.json()),
  };
}

export function readCache(storage?: Pick<Storage, 'getItem'>): CachedFormats | null {
  try {
    const raw = (storage ?? localStorage).getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = object(JSON.parse(raw));
    if (parsed.schemaVersion !== 2 || !isTimestamp(parsed.fetchedAt)) return null;
    return {
      schemaVersion: 2,
      fetchedAt: parsed.fetchedAt,
      etag: typeof parsed.etag === 'string' ? parsed.etag : null,
      records: parseRecords(parsed.records),
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
