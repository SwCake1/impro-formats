import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogImportError, loadSheetCatalog } from './published-catalog.mjs';
import { devCatalogPlugin } from './dev-catalog.mjs';

vi.mock('./published-catalog.mjs', async (importOriginal) => ({
  ...await importOriginal(),
  loadSheetCatalog: vi.fn(),
}));

const env = { GOOGLE_SHEET_ID: 'test-sheet', GOOGLE_SERVICE_ACCOUNT_JSON: 'private-credentials' };

function serverFor(sheetName = 'Все форматы') {
  const logger = { info: vi.fn(), error: vi.fn() };
  let middleware;
  devCatalogPlugin({ env, sheetName }).configureServer({
    config: { logger },
    middlewares: { use(handler) { middleware = handler; } },
  });
  return {
    logger,
    async request(url = '/data/formats.json', method = 'GET') {
      const response = { setHeader: vi.fn(), end: vi.fn() };
      const next = vi.fn();
      await middleware({ url, method }, response, next);
      return { response, next };
    },
  };
}

beforeEach(() => vi.resetAllMocks());

describe('local sheet catalog', () => {
  it('reads the sheet again for each request, including cache-busting URLs', async () => {
    const server = serverFor();
    loadSheetCatalog.mockResolvedValueOnce({ records: [{ id: 'same-id', title: 'Before' }] })
      .mockResolvedValueOnce({ records: [{ id: 'same-id', title: 'After' }] });
    const first = await server.request();
    const second = await server.request('/data/formats.json?fresh=1');
    expect(loadSheetCatalog).toHaveBeenCalledTimes(2);
    expect(loadSheetCatalog).toHaveBeenCalledWith(env, 'Все форматы');
    expect(JSON.parse(first.response.end.mock.calls[0][0]).records[0].title).toBe('Before');
    expect(JSON.parse(second.response.end.mock.calls[0][0]).records[0].title).toBe('After');
    expect(second.response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(second.response.statusCode).toBe(200);
    expect(second.next).not.toHaveBeenCalled();
  });

  it('can read the published sheet explicitly', async () => {
    loadSheetCatalog.mockResolvedValue({ records: [] });
    await serverFor('Опубликовано').request();
    expect(loadSheetCatalog).toHaveBeenCalledWith(env, 'Опубликовано');
  });

  it.each([
    [new CatalogImportError('Строка 2: отсутствует постоянный id.'), 'Строка 2: отсутствует постоянный id.'],
    [new Error('private-credentials'), 'Не удалось прочитать каталог из Google-таблицы.'],
  ])('reports failures without falling back to the repository file or exposing secrets', async (error, message) => {
    const server = serverFor();
    loadSheetCatalog.mockRejectedValue(error);
    const { response, next } = await server.request();
    expect(response.statusCode).toBe(502);
    expect(JSON.parse(response.end.mock.calls[0][0])).toEqual({ error: message });
    expect(server.logger.error).toHaveBeenCalledWith(message);
    expect(JSON.stringify(response.end.mock.calls)).not.toContain('private-credentials');
    expect(next).not.toHaveBeenCalled();
  });

  it('leaves unrelated files to Vite', async () => {
    const { next } = await serverFor().request('/src/main.ts');
    expect(next).toHaveBeenCalledOnce();
    expect(loadSheetCatalog).not.toHaveBeenCalled();
  });

  it('does not write to Sheets for unsupported HTTP methods', async () => {
    const { response, next } = await serverFor().request('/data/formats.json', 'POST');
    expect(response.statusCode).toBe(405);
    expect(loadSheetCatalog).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
