import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import snapshot from '../../public/data/formats.json';
import { parseFormatsJson } from '../../src/data';

const headers = [
  'id', 'Название формата', 'Описание формата', 'Наличие модератора',
  'Наличие зрителя на сцене', 'Наличие реквизита', 'Наличие мебели',
  'Дополнительно', 'Тип формата (тег)',
];
const source = readFileSync(new URL('./Code.js', import.meta.url), 'utf8');
const script = new Script(source + '\nJSON.stringify(parseFormatRows_(inputRows));');
const fromRows = (rows: string[][]) => ({
  schemaVersion: 2,
  generatedAt: '2026-10-24T00:00:00.000Z',
  records: JSON.parse(script.runInNewContext({ inputRows: rows })),
});
const row = ['2-komnaty', '2 комнаты', 'Первая строка\nВторая строка', 'TRUE', 'FALSE', '', 'Стулья', '', 'Короткая форма, Угадайки'];

describe('Apps Script format validation', () => {
  it('preserves all public fields needed by the site', () => {
    const flag = (value: boolean | null) => value === null ? '' : String(value).toUpperCase();
    const rows = snapshot.records.map((record) => [
      record.id, record.title, record.description,
      flag(record.moderator), flag(record.audienceOnStage), flag(record.props),
      record.furniture, record.note, record.tags.join(', '),
    ]);
    const catalog = fromRows([headers, ...rows]);

    expect(catalog.records).toEqual(snapshot.records);
    expect(parseFormatsJson(catalog)).toHaveLength(snapshot.records.length);
  });

  it('preserves unknown flags and multiline text, and excludes extra columns', () => {
    const catalog = fromRows([headers, [...row, 'Служебные данные'], Array(9).fill('')]);

    expect(catalog.records).toHaveLength(1);
    expect(catalog.records[0]).toMatchObject({
      id: '2-komnaty', moderator: true, audienceOnStage: false, props: null,
      description: 'Первая строка\nВторая строка', tags: ['Короткая форма', 'Угадайки'],
    });
    expect(JSON.stringify(catalog)).not.toContain('Служебные данные');
  });

  it('accepts Russian boolean labels', () => {
    const translated = [...row];
    translated.splice(3, 3, ' Да ', 'ЛОЖЬ', 'истина');
    expect(fromRows([headers, translated]).records[0]).toMatchObject({
      moderator: true, audienceOnStage: false, props: true,
    });
  });

  it('rejects changed column order', () => {
    expect(() => fromRows([[headers[1], headers[0], ...headers.slice(2)], row]))
      .toThrow('заголовки');
  });

  it('rejects duplicate IDs without changing them', () => {
    expect(() => fromRows([headers, row, row])).toThrow('повторяющийся id');
  });

  it.each([
    { column: 0, value: '', message: 'некорректен id' },
    { column: 1, value: '', message: 'отсутствует название' },
    { column: 3, value: 'может быть', message: 'непонятное значение' },
  ])('rejects malformed data: $message', ({ column, value, message }) => {
    const malformed = [...row];
    malformed[column] = value;
    expect(() => fromRows([headers, malformed])).toThrow(message);
  });

  it('rejects an empty catalog', () => {
    expect(() => fromRows([headers, Array(9).fill('')])).toThrow('нет форматов');
  });
});

describe('Apps Script Publish', () => {
  function environment(draft: string[][], initialPublished?: string[][]) {
    let published = initialPublished?.map((row) => [...row]) ?? [];
    let exists = initialPublished !== undefined;
    let maxRows = Math.max(1, published.length);
    let maxColumns = 1;
    let failWrite = false;
    const lock = { waitLock: vi.fn(), releaseLock: vi.fn() };
    const write = vi.fn((values: Array<Array<{ text: string }>>) => {
      if (failWrite) throw new Error('Ошибка записи');
      published = values.map((row) => row.map((cell) => cell.text));
    });
    const target = {
      getLastRow: () => published.findLastIndex((row) => row.some((cell) => cell !== '')) + 1,
      getMaxRows: () => maxRows,
      getMaxColumns: () => maxColumns,
      insertRowsAfter: (_after: number, count: number) => { maxRows += count; },
      insertColumnsAfter: (_after: number, count: number) => { maxColumns += count; },
      setFrozenRows: vi.fn(),
      getRange: () => ({ setRichTextValues: write }),
    };
    const work = {
      getLastRow: () => draft.length,
      getRange: () => ({ getDisplayValues: () => draft.map((row) => [...row]) }),
    };
    const document = {
      getSheetByName: (name: string) => name === 'Все форматы' ? work : exists ? target : null,
      insertSheet: vi.fn(() => { exists = true; return target; }),
      toast: vi.fn(),
    };
    const context = {
      SpreadsheetApp: {
        getActiveSpreadsheet: () => document,
        newRichTextValue: () => ({
          setText: (text: string) => ({ build: () => ({ text }) }),
        }),
        flush: vi.fn(),
      },
      LockService: { getDocumentLock: () => lock },
      console: { log: vi.fn() },
    };
    return {
      run: () => new Script(source + '\npublishCatalog();').runInNewContext({ ...context }),
      values: () => published,
      failWrite: () => { failWrite = true; },
      document, write, lock,
    };
  }

  it('creates a snapshot accepted by the site, preserving text without live formulas', () => {
    const draftRow = [...row];
    draftRow[2] = '=A1\nОписание как текст';
    const draft = [headers, draftRow];
    const state = environment(draft);

    expect(state.run()).toBe(1);
    expect(state.document.insertSheet).toHaveBeenCalledWith('Опубликовано');
    expect(state.values()[1][2]).toBe('=A1\nОписание как текст');
    expect(parseFormatsJson(fromRows(state.values()))).toHaveLength(1);

    draftRow[1] = 'Новый черновик';
    draftRow[2] = 'Изменённое описание';
    expect(state.values()[1][1]).toBe('2 комнаты');
    expect(state.values()[1][2]).toBe('=A1\nОписание как текст');
    expect(state.lock.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('removes stale records when the next approved catalog is shorter', () => {
    const secondRow = [...row];
    secondRow[0] = 'other-format';
    const draft = [headers, [...row], secondRow];
    const state = environment(draft);
    expect(state.run()).toBe(2);

    draft.pop();
    expect(state.run()).toBe(1);
    expect(state.values()[2]).toEqual(Array(9).fill(''));
    expect(fromRows(state.values()).records).toHaveLength(1);
  });

  it('keeps the previous snapshot when draft validation fails', () => {
    const approved = [headers, [...row]];
    const state = environment([headers, [...row], [...row]], approved);
    expect(state.run).toThrow('повторяющийся id');
    expect(state.values()).toEqual(approved);
    expect(state.write).not.toHaveBeenCalled();
    expect(state.document.insertSheet).not.toHaveBeenCalled();
    expect(state.lock.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('does not clear the old snapshot before attempting the replacement', () => {
    const approved = [headers, [...row]];
    const updated = [...row];
    updated[1] = 'Одобренное изменение';
    const state = environment([headers, updated], approved);
    state.failWrite();

    expect(state.run).toThrow('Ошибка записи');
    expect(state.values()).toEqual(approved);
    expect(state.document.toast).not.toHaveBeenCalled();
    expect(state.lock.releaseLock).toHaveBeenCalledTimes(1);
  });
});

