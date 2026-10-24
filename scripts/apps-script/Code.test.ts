import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import snapshot from '../../public/data/formats.json';
import { parseFormatsJson } from '../../src/data';

const headers = [
  'id', 'Название формата', 'Описание формата', 'Наличие модератора',
  'Наличие зрителя на сцене', 'Наличие реквизита', 'Наличие мебели',
  'Дополнительно', 'Форма', 'Особенности', 'Подборки',
];
const source = readFileSync(new URL('./Code.js', import.meta.url), 'utf8');
const script = new Script(source + '\nJSON.stringify(parseFormatRows_(inputRows));');
const fromRows = (rows: string[][]) => ({
  schemaVersion: 3,
  generatedAt: '2026-10-24T00:00:00.000Z',
  records: JSON.parse(script.runInNewContext({ inputRows: rows })),
});
const row = ['2-komnaty', '2 комнаты', 'Первая строка\nВторая строка', 'TRUE', 'FALSE', '', 'Стулья', '', 'Короткая форма', 'Угадайки', 'JAM, Иностранные'];

describe('readable IDs', () => {
  const idScript = new Script(source + '\nformatIdBase_(inputTitle);');
  it.each([
    { title: 'Тест', id: 'test' },
    { title: 'Новый формат', id: 'novyy-format' },
    { title: 'Ёжик, щука и чай', id: 'ezhik-shchuka-i-chay' },
    { title: 'Съешь ещё этих мягких французских булок', id: 'sesh-eshche-etikh-myagkikh-frantsuzskikh-bulok' },
    { title: '10 жанров / Scene 3 Ways', id: '10-zhanrov-scene-3-ways' },
    { title: '  Café — déjà vu! ', id: 'cafe-deja-vu' },
    { title: 'Новый__формат... (ещё один)', id: 'novyy-format-eshche-odin' },
    { title: 'ROCK & ROLL', id: 'rock-roll' },
  ])('transliterates $title to $id', ({ title, id }) => {
    expect(idScript.runInNewContext({ inputTitle: title })).toBe(id);
  });
});

describe('Apps Script format validation', () => {
  it('keeps empty and multiple classifications independent, deduplicating within each column', () => {
    const classified = [...row.slice(0, 8), 'Короткая форма, Длинная форма', 'JAM', 'JAM, Иностранные, JAM'];
    expect(fromRows([headers, classified]).records[0]).toMatchObject({
      forms: ['Короткая форма', 'Длинная форма'], features: ['JAM'], collections: ['JAM', 'Иностранные'],
    });
    expect(fromRows([headers, [...row.slice(0, 8), '', '', 'JAM']]).records[0]).toMatchObject({ forms: [], features: [], collections: ['JAM'] });
  });
  it('preserves all public fields needed by the site', () => {
    const flag = (value: boolean | null) => value === null ? '' : String(value).toUpperCase();
    const records = parseFormatsJson(snapshot);
    const rows = records.map((record) => [
      record.id, record.title, record.description,
      flag(record.moderator), flag(record.audienceOnStage), flag(record.props),
      record.furniture, record.note, record.forms.join(', '), record.features.join(', '), record.collections.join(', '),
    ]);
    const catalog = fromRows([headers, ...rows]);

    expect(parseFormatsJson(catalog)).toEqual(records);
  });

  it('preserves unknown flags and multiline text, and excludes extra columns', () => {
    const catalog = fromRows([headers, [...row, 'Служебные данные'], Array(11).fill('')]);

    expect(catalog.records).toHaveLength(1);
    expect(catalog.records[0]).toMatchObject({
      id: '2-komnaty', moderator: true, audienceOnStage: false, props: null,
      description: 'Первая строка\nВторая строка', forms: ['Короткая форма'], features: ['Угадайки'], collections: ['JAM', 'Иностранные'],
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
    expect(() => fromRows([headers, Array(11).fill('')])).toThrow('нет форматов');
  });
});

describe('Apps Script Publish', () => {
  const hookUrl = 'https://api.vercel.com/v1/integrations/deploy/prj_test/test-hook';
  function environment(draft: string[][], initialPublished?: string[][], configuredHook = hookUrl) {
    let published = initialPublished?.map((row) => [...row]) ?? [];
    let exists = initialPublished !== undefined;
    let maxRows = Math.max(1, published.length);
    let maxColumns = 1;
    let failWrite = false;
    let deployStatus = 200;
    let deployError: Error | null = null;
    let failIdWrite = false;
    const events: string[] = [];
    const idWrite = vi.fn((rowNumber: number, value: string) => {
      if (failIdWrite) throw new Error('Ошибка записи id');
      events.push('id');
      draft[rowNumber - 1][0] = value;
    });
    const lock = { waitLock: vi.fn(), releaseLock: vi.fn() };
    const write = vi.fn((values: Array<Array<{ text: string }>>) => {
      if (failWrite) throw new Error('Ошибка записи');
      events.push('write');
      published = values.map((row) => row.map((cell) => cell.text));
    });
    const deploy = vi.fn(() => {
      events.push('deploy');
      if (deployError) throw deployError;
      return { getResponseCode: () => deployStatus };
    });
    const getProperty = vi.fn(() => configuredHook);
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
      getRange: (rowNumber: number) => ({
        getDisplayValues: () => draft.map((row) => [...row]),
        isBlank: () => draft[rowNumber - 1][0] === '',
        setValue: (value: string) => idWrite(rowNumber, value),
      }),
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
        flush: vi.fn(() => events.push('flush')),
      },
      PropertiesService: { getScriptProperties: () => ({ getProperty }) },
      UrlFetchApp: { fetch: deploy },
      LockService: { getDocumentLock: () => lock },
      console: { log: vi.fn() },
    };
    return {
      run: () => new Script(source + '\npublishCatalog();').runInNewContext({ ...context }),
      values: () => published,
      failWrite: () => { failWrite = true; },
      allowWrite: () => { failWrite = false; },
      failIdWrite: () => { failIdWrite = true; },
      rejectDeploy: (status: number) => { deployStatus = status; },
      failDeploy: () => { deployError = new Error('Request failed: ' + configuredHook); },
      document, work, write, lock, deploy, getProperty, events, idWrite,
    };
  }

  it('assigns readable IDs only to new named rows, persisting them before publishing', () => {
    const first = ['', 'Новый формат', ...row.slice(2), 'Видео остаётся в рабочем листе'];
    const second = ['', 'Другой формат', ...row.slice(2)];
    const empty = Array(11).fill('');
    const draft = [headers, [...row], empty, first, second];
    const original = draft.map(value => [...value]);
    const state = environment(draft);

    expect(state.run()).toBe(3);
    expect(first[0]).toBe('novyy-format');
    expect(second[0]).toBe('drugoy-format');
    expect(state.idWrite.mock.calls).toEqual([[4, first[0]], [5, second[0]]]);
    expect(draft[1]).toEqual(original[1]);
    expect(empty).toEqual(original[2]);
    expect(first.slice(1)).toEqual(original[3].slice(1));
    expect(second.slice(1)).toEqual(original[4].slice(1));
    expect(state.events).toEqual(['id', 'id', 'flush', 'write', 'flush', 'deploy']);
    expect(parseFormatsJson(fromRows(state.values())).map(record => record.id)).toEqual([row[0], first[0], second[0]]);
    expect(state.document.toast).toHaveBeenCalledWith(expect.stringContaining('Создано id: 2'), 'Publish', 8);
  });

  it('keeps an automatically assigned ID after renaming and publishing again', () => {
    const record = ['', 'Первое название', ...row.slice(2)];
    const state = environment([headers, record]);
    state.run();
    const id = record[0];
    record[1] = 'Совсем другое название';
    state.run();
    expect(record[0]).toBe(id);
    expect(state.values()[1][0]).toBe(id);
    expect(state.values()[1][1]).toBe(record[1]);
    expect(state.idWrite).toHaveBeenCalledTimes(1);
  });

  it('never rewrites existing IDs or assigns IDs to blank rows', () => {
    const empty = Array(11).fill('');
    const state = environment([headers, [...row], empty]);
    state.run();
    expect(state.idWrite).not.toHaveBeenCalled();
    expect(state.values()[1][0]).toBe(row[0]);
    expect(empty[0]).toBe('');
  });

  it('reserves IDs from later existing rows when resolving a generated collision', () => {
    const newRecord = ['', 'Новый формат', ...row.slice(2)];
    const existingId = 'novyy-format';
    const existing = [existingId, ...row.slice(1)];
    const state = environment([headers, newRecord, existing]);
    state.run();
    expect(newRecord[0]).toBe('novyy-format-2');
    expect(existing[0]).toBe(existingId);
    expect(new Set(state.values().slice(1).map(record => record[0])).size).toBe(2);
  });

  it('assigns the first available suffix when new and existing names collide', () => {
    const first = ['', 'Первый', ...row.slice(2)];
    const second = ['', 'Первый', ...row.slice(2)];
    const existing = ['pervyy-2', ...row.slice(1)];
    const state = environment([headers, first, second, existing]);
    state.run();
    expect(first[0]).toBe('pervyy');
    expect(second[0]).toBe('pervyy-3');
    expect(existing[0]).toBe('pervyy-2');
  });

  it('handles titles in different scripts that produce the same readable ID', () => {
    const draft = [headers, ...['Тест', 'Test', 'Тест!'].map(title => ['', title, ...row.slice(2)])];
    const state = environment(draft);
    state.run();
    expect(draft.slice(1).map(record => record[0])).toEqual(['test', 'test-2', 'test-3']);
  });

  it('preserves a previously assigned ID even when it differs from the title transliteration', () => {
    const id = 'format-00000000-0000-4000-8000-000000000001';
    const state = environment([headers, [id, 'Тест', ...row.slice(2)]]);
    state.run();
    expect(state.values()[1][0]).toBe(id);
    expect(state.idWrite).not.toHaveBeenCalled();
  });

  it('stops without writing when the title cannot produce a readable ID', () => {
    const record = ['', '🐱 !!!', ...row.slice(2)];
    const state = environment([headers, record]);
    expect(state.run).toThrow('Укажите id латиницей в колонке A');
    expect(record[0]).toBe('');
    expect(state.idWrite).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
    expect(state.deploy).not.toHaveBeenCalled();
  });

  it.each([
    { invalid: ['', '', ...row.slice(2)] },
    { invalid: ['', 'Новый', ...row.slice(2, 3), 'возможно', ...row.slice(4)] },
    { invalid: ['INVALID', ...row.slice(1)] },
    { invalid: [...row] },
  ])('does not persist generated IDs or publish when another row is invalid: $invalid', ({ invalid }) => {
    const newRecord = ['', 'Новый формат', ...row.slice(2)];
    const approved = [headers, [...row]];
    const draft = [headers, [...row], newRecord, [...invalid]];
    const before = draft.map(record => [...record]);
    const state = environment(draft, approved);
    expect(state.run).toThrow();
    expect(draft).toEqual(before);
    expect(state.idWrite).not.toHaveBeenCalled();
    expect(state.values()).toEqual(approved);
    expect(state.deploy).not.toHaveBeenCalled();
  });

  it('does not write new IDs when the deploy hook is missing', () => {
    const record = ['', 'Новый', ...row.slice(2)];
    const state = environment([headers, record], undefined, '');
    expect(state.run).toThrow('VERCEL_DEPLOY_HOOK_URL');
    expect(record[0]).toBe('');
    expect(state.idWrite).not.toHaveBeenCalled();
    expect(state.document.insertSheet).not.toHaveBeenCalled();
  });

  it('keeps the published snapshot when writing an ID fails', () => {
    const approved = [headers, [...row]];
    const record = ['', 'Новый', ...row.slice(2)];
    const state = environment([headers, record], approved);
    state.failIdWrite();
    expect(state.run).toThrow('Ошибка записи id');
    expect(record[0]).toBe('');
    expect(state.values()).toEqual(approved);
    expect(state.write).not.toHaveBeenCalled();
    expect(state.deploy).not.toHaveBeenCalled();
    expect(state.lock.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('keeps already written IDs if a later ID write fails, then completes publication on retry', () => {
    const first = ['', 'Первый', ...row.slice(2)];
    const second = ['', 'Второй', ...row.slice(2)];
    const approved = [headers, [...row]];
    const draft = [headers, first, second];
    const state = environment(draft, approved);
    state.idWrite.mockImplementationOnce((rowNumber, value) => { draft[rowNumber - 1][0] = value; });
    state.idWrite.mockImplementationOnce(() => { throw new Error('Ошибка второго id'); });
    expect(state.run).toThrow('Ошибка второго id');
    const firstId = first[0];
    expect(firstId).toBe('pervyy');
    expect(second[0]).toBe('');
    expect(state.values()).toEqual(approved);
    expect(state.deploy).not.toHaveBeenCalled();
    state.run();
    expect(first[0]).toBe(firstId);
    expect(second[0]).toBe('vtoroy');
    expect(state.values().slice(1).map(record => record[0])).toEqual([first[0], second[0]]);
  });

  it('does not overwrite an ID filled in after reading the draft', () => {
    const record = ['', 'Новый', ...row.slice(2)];
    const state = environment([headers, record]);
    const getRange = state.work.getRange;
    vi.spyOn(state.work, 'getRange').mockImplementation(rowNumber => {
      if (rowNumber === 2) record[0] = 'manually-added';
      return getRange(rowNumber);
    });
    expect(state.run).toThrow('ячейка id уже заполнена');
    expect(record[0]).toBe('manually-added');
    expect(state.idWrite).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
    expect(state.deploy).not.toHaveBeenCalled();
  });

  it('reuses the persisted ID when retrying a failed snapshot write', () => {
    const record = ['', 'Новый', ...row.slice(2)];
    const approved = [headers, [...row]];
    const state = environment([headers, record], approved);
    state.failWrite();
    expect(state.run).toThrow('Ошибка записи');
    const id = record[0];
    expect(id).toBe('novyy');
    expect(state.values()).toEqual(approved);
    state.allowWrite();
    state.run();
    expect(record[0]).toBe(id);
    expect(state.values()[1][0]).toBe(id);
    expect(state.idWrite).toHaveBeenCalledTimes(1);
  });

  it('keeps the ID and snapshot when Vercel rejects the request, then reuses them on retry', () => {
    const record = ['', 'Новый', ...row.slice(2)];
    const state = environment([headers, record]);
    state.rejectDeploy(500);
    expect(state.run).toThrow('HTTP 500');
    const id = record[0];
    expect(state.values()[1][0]).toBe(id);
    state.rejectDeploy(200);
    state.run();
    expect(state.values()[1][0]).toBe(id);
    expect(state.idWrite).toHaveBeenCalledTimes(1);
  });

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

  it('posts the saved snapshot to the configured hook only after flushing Sheets', () => {
    const state = environment([headers, row]);
    state.rejectDeploy(201);
    expect(state.run()).toBe(1);
    expect(state.events).toEqual(['write', 'flush', 'deploy']);
    expect(state.getProperty).toHaveBeenCalledWith('VERCEL_DEPLOY_HOOK_URL');
    expect(state.deploy).toHaveBeenCalledExactlyOnceWith(hookUrl, {
      method: 'post', muteHttpExceptions: true, followRedirects: false,
    });
    expect(state.document.toast).toHaveBeenCalledWith(expect.stringContaining('Запрос на сборку сайта отправлен'), 'Publish', 8);
  });

  it.each(['', 'https://impro-formats.vercel.app/', 'https://api.vercel.com.evil.test/v1/integrations/deploy/p/t', 'http://api.vercel.com/v1/integrations/deploy/p/t'])
    ('rejects a missing or incorrect hook before changing the snapshot: %s', (url) => {
      const approved = [headers, row];
      const state = environment([headers, [...row.slice(0, 1), 'Новый снимок', ...row.slice(2)]], approved, url);
      expect(state.run).toThrow('VERCEL_DEPLOY_HOOK_URL');
      expect(state.values()).toEqual(approved);
      expect(state.write).not.toHaveBeenCalled();
      expect(state.deploy).not.toHaveBeenCalled();
      expect(state.lock.releaseLock).toHaveBeenCalledTimes(1);
    });

  it.each([302, 403, 429, 500])('keeps the saved snapshot and reports HTTP %s without claiming success', (status) => {
    const state = environment([headers, row]);
    state.rejectDeploy(status);
    expect(state.run).toThrow('HTTP ' + status);
    expect(state.values()[1]).toEqual(row);
    expect(state.document.toast).not.toHaveBeenCalled();
    expect(state.lock.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('hides the hook URL when a network error occurs after saving the snapshot', () => {
    const state = environment([headers, row]);
    state.failDeploy();
    let message = '';
    try { state.run(); } catch (error) { message = (error as Error).message; }
    expect(message).toContain('Снимок сохранён, но запуск сборки не подтверждён');
    expect(message).not.toContain(hookUrl);
    expect(state.values()[1]).toEqual(row);
    expect(state.document.toast).not.toHaveBeenCalled();
    expect(state.deploy).toHaveBeenCalledTimes(1);
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
    expect(state.values()[2]).toEqual(Array(11).fill(''));
    expect(fromRows(state.values()).records).toHaveLength(1);
  });

  it('keeps the previous snapshot when draft validation fails', () => {
    const approved = [headers, [...row]];
    const state = environment([headers, [...row], [...row]], approved);
    expect(state.run).toThrow('повторяющийся id');
    expect(state.values()).toEqual(approved);
    expect(state.write).not.toHaveBeenCalled();
    expect(state.document.insertSheet).not.toHaveBeenCalled();
    expect(state.deploy).not.toHaveBeenCalled();
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
    expect(state.deploy).not.toHaveBeenCalled();
    expect(state.lock.releaseLock).toHaveBeenCalledTimes(1);
  });
});

