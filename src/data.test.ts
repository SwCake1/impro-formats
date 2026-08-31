import { describe, expect, it } from 'vitest';
import { EXPECTED_HEADERS, parseFormatsCsv, readCache, SheetFormatError, writeCache } from './data';

const header = EXPECTED_HEADERS.map((value) => `"${value}"`).join(',');

describe('parseFormatsCsv', () => {
  it('parses quoted commas, line breaks, booleans, furniture and tags', () => {
    const csv = `${header}\n"Формат, один","Первая строка\nВторая строка",TRUE,FALSE,,"Стулья, Столы","Заметка, важная","Короткая форма, Музыкальные"`;
    const [record] = parseFormatsCsv(csv);

    expect(record.title).toBe('Формат, один');
    expect(record.description).toContain('\n');
    expect(record.moderator).toBe(true);
    expect(record.audienceOnStage).toBe(false);
    expect(record.props).toBeNull();
    expect(record.furnitureKinds).toEqual(['chairs', 'tables']);
    expect(record.tags).toEqual(['Короткая форма', 'Музыкальные']);
    expect(record.sourceRow).toBe(2);
  });

  it('ignores rows without a title and disambiguates exact duplicates', () => {
    const csv = `${header}\n,Описание,FALSE,FALSE,FALSE,Нет,,\nТест,Описание,FALSE,FALSE,FALSE,Нет,,Короткая форма\nТест,Описание,FALSE,FALSE,FALSE,Нет,,Короткая форма`;
    const records = parseFormatsCsv(csv);

    expect(records).toHaveLength(2);
    expect(records[0]?.id).not.toBe(records[1]?.id);
    expect(records[1]?.id).toMatch(/-r4$/);
  });

  it('rejects changed headers', () => {
    expect(() => parseFormatsCsv('Название,Описание\nТест,Текст')).toThrow(SheetFormatError);
  });
});

describe('cache', () => {
  it('round-trips a valid payload', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const records = parseFormatsCsv(`${header}\nТест,Описание,FALSE,FALSE,FALSE,Нет,,Короткая форма`);

    writeCache(records, '2026-08-31T18:00:00.000Z', storage);
    expect(readCache(storage)?.records[0]?.title).toBe('Тест');
  });
});
