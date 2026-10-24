import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import snapshot from '../../public/data/formats.json';
import { parseFormatsJson } from '../../src/data';

const { request, constructor } = vi.hoisted(() => ({ request: vi.fn(), constructor: vi.fn() }));
vi.mock('google-auth-library', () => ({
  JWT: class {
    constructor(options) { constructor(options); }
    request(options) { return request(options); }
  },
}));

import {
  CatalogImportError, credentialsFromEnvironment, fetchPublishedCatalog,
  loadPublishedCatalog, parsePublishedRows,
} from './published-catalog.mjs';

const headers = [
  'id', 'Название формата', 'Описание формата', 'Наличие модератора',
  'Наличие зрителя на сцене', 'Наличие реквизита', 'Наличие мебели',
  'Дополнительно', 'Тип формата (тег)',
];
const row = ['2-komnaty', '2 комнаты', 'Описание\nВторая строка', 'TRUE', 'FALSE', '', 'Стулья', '', 'Короткая форма, Угадайки'];
const credentials = { type: 'service_account', client_email: 'reader@example.test', private_key: 'test-private-key' };
const temporaryDirectories = [];

afterEach(async () => {
  vi.clearAllMocks();
  request.mockReset();
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('published catalog validation', () => {
  it('imports separate A–K classifications as schema v3 and excludes videos', () => {
    const currentHeaders = [...headers.slice(0, 8), 'Форма', 'Особенности', 'Подборки', 'Видео'];
    const currentRow = [...row.slice(0, 8), 'Короткая форма, Длинная форма', 'Музыкальные', 'JAM, Иностранные, JAM', 'private-video'];
    const catalog = parsePublishedRows([currentHeaders, currentRow]);
    expect(catalog.schemaVersion).toBe(3);
    expect(catalog.records[0]).toMatchObject({ forms: ['Короткая форма', 'Длинная форма'], features: ['Музыкальные'], collections: ['JAM', 'Иностранные'] });
    expect(catalog.records[0]).not.toHaveProperty('tags');
    expect(JSON.stringify(catalog)).not.toContain('private-video');
    expect(parseFormatsJson(catalog)[0].collections).toEqual(['JAM', 'Иностранные']);
  });

  it('preserves blank form and feature cells as empty lists', () => {
    const catalog = parsePublishedRows([[...headers.slice(0, 8), 'Форма', 'Особенности', 'Подборки'], [...row.slice(0, 8), '', '', 'JAM']]);
    expect(catalog.records[0]).toMatchObject({ forms: [], features: [], collections: ['JAM'] });
  });
  it('creates exactly the public schema consumed by the site for all snapshot records', () => {
    const flag = value => value === null ? '' : String(value).toUpperCase();
    const rows = snapshot.records.map(record => [
      record.id, record.title, record.description, flag(record.moderator),
      flag(record.audienceOnStage), flag(record.props), record.furniture, record.note, record.tags.join(', '),
    ]);
    const catalog = parsePublishedRows([headers, ...rows]);
    expect(catalog.records).toEqual(snapshot.records);
    expect(parseFormatsJson(catalog)).toHaveLength(snapshot.records.length);
  });

  it('preserves false, unknown flags and multiline text while excluding other columns', () => {
    const mixed = [...row];
    mixed.splice(3, 3, false, 'Да', '');
    const catalog = parsePublishedRows([headers, [...mixed, 'Служебные данные'], Array(9).fill('')]);
    expect(catalog.records).toHaveLength(1);
    expect(catalog.records[0]).toMatchObject({ moderator: false, audienceOnStage: true, props: null, description: row[2] });
    expect(JSON.stringify(catalog)).not.toContain('Служебные данные');
  });

  it('keeps IDs when names change', () => {
    expect(parsePublishedRows([headers, [row[0], 'Новое имя', ...row.slice(2)]]).records[0].id).toBe(row[0]);
  });

  it('rejects duplicate IDs', () => {
    expect(() => parsePublishedRows([headers, row, row])).toThrow(CatalogImportError);
  });

  it.each([
    [],
    [headers],
    [[headers[1], headers[0], ...headers.slice(2)], row],
    [headers, ['', ...row.slice(1)]],
    [headers, [row[0], '', ...row.slice(2)]],
    [headers, [...row.slice(0, 3), 'неизвестное значение', ...row.slice(4)]],
  ])('rejects malformed or empty input', (...rows) => {
    expect(() => parsePublishedRows(rows)).toThrow(CatalogImportError);
  });
});

describe('Google credentials and published sheet access', () => {
  it('reads only the approved sheet with a read-only scope', async () => {
    request.mockResolvedValue({ data: { values: [headers, row] } });
    const catalog = await fetchPublishedCatalog({ credentials, spreadsheetId: 'sheet-id' });
    expect(constructor).toHaveBeenCalledWith({
      email: credentials.client_email, key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values/' + encodeURIComponent("'Опубликовано'!A1:K"),
      method: 'GET', params: { valueRenderOption: 'FORMATTED_VALUE' },
    }));
    expect(JSON.stringify(catalog)).not.toContain(credentials.private_key);
  });

  it('removes sensitive SDK error details', async () => {
    request.mockRejectedValue({ response: { status: 403 }, message: 'secret-token', config: { private_key: credentials.private_key } });
    const error = await fetchPublishedCatalog({ credentials, spreadsheetId: 'sheet-id' }).catch(error => error);
    expect(error).toBeInstanceOf(CatalogImportError);
    expect(error.message).toContain('HTTP 403');
    expect(error.message).not.toContain('secret-token');
    expect(error.message).not.toContain(credentials.private_key);
  });

  it('rejects a malformed spreadsheet ID before any API call', async () => {
    await expect(fetchPublishedCatalog({ credentials, spreadsheetId: '../wrong' })).rejects.toThrow('GOOGLE_SHEET_ID');
    expect(request).not.toHaveBeenCalled();
  });

  it('loads credentials from a local file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'impro-credentials-test-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'key.json');
    await writeFile(path, JSON.stringify(credentials));
    expect(await credentialsFromEnvironment({ GOOGLE_APPLICATION_CREDENTIALS: path })).toEqual(credentials);
  });

  it('uses Vercel JSON credentials instead of a local path', async () => {
    expect(await credentialsFromEnvironment({
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials),
      GOOGLE_APPLICATION_CREDENTIALS: '/missing/local-file.json',
    })).toEqual(credentials);
  });

  it('rejects missing or invalid credentials without leaking their contents', async () => {
    await expect(credentialsFromEnvironment({})).rejects.toThrow('GOOGLE_SERVICE_ACCOUNT_JSON');
    await expect(credentialsFromEnvironment({ GOOGLE_SERVICE_ACCOUNT_JSON: 'test-private-key' }))
      .rejects.toThrow('Не удалось прочитать JSON');
    expect(request).not.toHaveBeenCalled();
  });

  it('stops on missing configuration', async () => {
    await expect(loadPublishedCatalog({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials) }))
      .rejects.toThrow('GOOGLE_SHEET_ID');
    expect(request).not.toHaveBeenCalled();
  });
});
