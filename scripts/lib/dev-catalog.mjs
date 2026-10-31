import { CatalogImportError, loadSheetCatalog } from './published-catalog.mjs';

export function devCatalogPlugin({ env, sheetName }) {
  return {
    name: 'dev-sheet-catalog',
    apply: 'serve',
    configureServer(server) {
      server.config.logger.info(`Каталог: Google-таблица, лист «${sheetName}». Обнови страницу, чтобы прочитать свежие данные.`);
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/data/formats.json') return next();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (!['GET', 'HEAD'].includes(req.method)) {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD');
          res.end();
          return;
        }
        try {
          const catalog = await loadSheetCatalog(env, sheetName);
          res.statusCode = 200;
          res.end(req.method === 'HEAD' ? undefined : JSON.stringify(catalog));
        } catch (error) {
          const message = error instanceof CatalogImportError ? error.message : 'Не удалось прочитать каталог из Google-таблицы.';
          server.config.logger.error(message);
          res.statusCode = 502;
          res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: message }));
        }
      });
    },
  };
}
