import {
  CatalogImportError, fetchPublishedCatalog, readServiceAccountFile,
} from './lib/published-catalog.mjs';

async function main() {
  const [keyPath, spreadsheetId] = process.argv.slice(2);
  if (!keyPath || !spreadsheetId) {
    throw new CatalogImportError('Укажи путь к JSON-ключу и ID таблицы: npm run check:sheets -- <key.json> <spreadsheet-id>');
  }
  const credentials = await readServiceAccountFile(keyPath);
  const catalog = await fetchPublishedCatalog({ credentials, spreadsheetId });
  console.log('Аккаунт: ' + credentials.client_email);
  console.log('Лист: Опубликовано');
  console.log('Найдено форматов: ' + catalog.records.length);
  console.log('Уникальных id: ' + new Set(catalog.records.map(record => record.id)).size);
  console.log('Доступ на чтение подтверждён.');
}

main().catch((error) => {
  console.error(error instanceof CatalogImportError ? error.message : 'Не удалось выполнить проверку доступа.');
  process.exitCode = 1;
});
