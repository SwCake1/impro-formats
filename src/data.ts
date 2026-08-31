import Papa from 'papaparse';
import { DATA_URL } from './config';
import type { CachedFormats, FormatRecord, OptionalBoolean } from './types';

export const EXPECTED_HEADERS = [
  'Название формата',
  'Описание формата',
  'Наличие модератора',
  'Наличие зрителя на сцене',
  'Наличие реквизита',
  'Наличие мебели',
  'Дополнительно',
  'Тип формата (тег)',
] as const;

const CACHE_KEY = 'impro-formats:data:v1';

export class SheetFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetFormatError';
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

function parseBoolean(value: string): OptionalBoolean {
  const normalized = normalizeText(value);
  if (normalized === 'true' || normalized === 'да') return true;
  if (normalized === 'false' || normalized === 'нет') return false;
  return null;
}

function parseFurnitureKinds(value: string): Array<'chairs' | 'tables'> {
  const normalized = normalizeText(value);
  const kinds: Array<'chairs' | 'tables'> = [];
  if (normalized.includes('стул')) kinds.push('chairs');
  if (normalized.includes('стол')) kinds.push('tables');
  return kinds;
}

function slugify(value: string): string {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'format';
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function buildRecord(row: string[], sourceRow: number): FormatRecord | null {
  const [title = '', description = '', moderator = '', audience = '', props = '', furniture = '', note = '', tags = ''] = row;
  const cleanTitle = title.trim();
  if (!cleanTitle) return null;

  const cleanDescription = description.trim();
  const cleanNote = note.trim();
  const parsedTags = tags.split(',').map((tag) => tag.trim()).filter(Boolean);

  return {
    id: `${slugify(cleanTitle)}-${fnv1a(`${normalizeText(cleanTitle)}\u0000${normalizeText(cleanDescription)}`)}`,
    sourceRow,
    title: cleanTitle,
    description: cleanDescription,
    moderator: parseBoolean(moderator),
    audienceOnStage: parseBoolean(audience),
    props: parseBoolean(props),
    furniture: furniture.trim(),
    furnitureKinds: parseFurnitureKinds(furniture),
    note: cleanNote,
    tags: parsedTags,
    searchText: normalizeText([cleanTitle, cleanDescription, cleanNote].join(' ')),
  };
}

export function parseFormatsCsv(csv: string): FormatRecord[] {
  const parsed = Papa.parse<string[]>(csv, {
    skipEmptyLines: 'greedy',
  });

  if (parsed.errors.length > 0) {
    throw new SheetFormatError(`Не удалось прочитать CSV: ${parsed.errors[0]?.message ?? 'неизвестная ошибка'}`);
  }

  const rows = parsed.data;
  const headers = rows[0]?.slice(0, EXPECTED_HEADERS.length).map((header) => header.trim()) ?? [];
  const headersMatch = EXPECTED_HEADERS.every((header, index) => headers[index] === header);
  if (!headersMatch) {
    throw new SheetFormatError('Структура таблицы изменилась: ожидаются колонки A–H с прежними заголовками.');
  }

  const seenIds = new Set<string>();
  const records = rows.slice(1).flatMap((row, index) => {
    const record = buildRecord(row, index + 2);
    if (!record) return [];

    if (seenIds.has(record.id)) {
      record.id = `${record.id}-r${record.sourceRow}`;
    }
    seenIds.add(record.id);
    return [record];
  });

  if (records.length === 0) {
    throw new SheetFormatError('В таблице не найдено ни одного формата.');
  }

  return records;
}

export async function fetchFormats(signal?: AbortSignal): Promise<FormatRecord[]> {
  const response = await fetch(DATA_URL, {
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Google Sheets вернул ошибку ${response.status}.`);
  }

  return parseFormatsCsv(await response.text());
}

export function readCache(storage: Pick<Storage, 'getItem'> = localStorage): CachedFormats | null {
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedFormats>;
    if (parsed.schemaVersion !== 1 || !parsed.fetchedAt || !Array.isArray(parsed.records) || parsed.records.length === 0) {
      return null;
    }
    return parsed as CachedFormats;
  } catch {
    return null;
  }
}

export function writeCache(
  records: FormatRecord[],
  fetchedAt = new Date().toISOString(),
  storage: Pick<Storage, 'setItem'> = localStorage,
): CachedFormats | null {
  const payload: CachedFormats = { schemaVersion: 1, fetchedAt, records };
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(payload));
    return payload;
  } catch {
    return null;
  }
}
