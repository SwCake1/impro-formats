import { readFile } from 'node:fs/promises';
import { JWT } from 'google-auth-library';

class CheckError extends Error {}

async function main() {
  const [keyPath, spreadsheetId] = process.argv.slice(2);
  if (!keyPath || !spreadsheetId || !/^[a-zA-Z0-9_-]+$/.test(spreadsheetId)) {
    throw new CheckError('Укажи путь к JSON-ключу и ID таблицы: npm run check:sheets -- <key.json> <spreadsheet-id>');
  }

  let credentials;
  try {
    credentials = JSON.parse(await readFile(keyPath, 'utf8'));
  } catch {
    throw new CheckError('Не удалось прочитать JSON-ключ по указанному пути.');
  }
  if (credentials.type !== 'service_account' ||
      typeof credentials.client_email !== 'string' ||
      typeof credentials.private_key !== 'string') {
    throw new CheckError('Нужен JSON-ключ технического аккаунта Google.');
  }

  const client = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const range = encodeURIComponent("'Опубликовано'!A1:I");
  let response;
  try {
    response = await client.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
      method: 'GET',
      params: { valueRenderOption: 'FORMATTED_VALUE' },
      timeout: 15000,
      retry: false,
    });
  } catch (error) {
    // Объект ошибки библиотеки может содержать авторизационные заголовки.
    // Выводим только статус, без самого запроса, ключа и токена.
    const status = error?.response?.status;
    throw new CheckError(status
      ? `Google отклонил запрос (HTTP ${status}). Проверь API и доступ аккаунта к таблице.`
      : 'Не удалось соединиться с Google или получить доступ. Проверь сеть и ключ.');
  }

  const rows = response.data?.values;
  if (!Array.isArray(rows) || rows[0]?.[0] !== 'id' || rows[0]?.[1] !== 'Название формата') {
    throw new CheckError('На листе «Опубликовано» не найдены ожидаемые колонки.');
  }
  const records = rows.slice(1).filter((row) => row.some((value) => String(value).trim() !== ''));
  const ids = new Set();
  for (const row of records) {
    const id = String(row[0] ?? '').trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id) || !String(row[1] ?? '').trim()) {
      throw new CheckError('В снимке есть отсутствующие или повторяющиеся id либо пустые названия.');
    }
    ids.add(id);
  }
  if (records.length === 0) throw new CheckError('Снимок пуст. Сначала выполни Publish в таблице.');

  console.log('Аккаунт: ' + credentials.client_email);
  console.log('Лист: Опубликовано');
  console.log('Найдено форматов: ' + records.length);
  console.log('Уникальных id: ' + ids.size);
  console.log('Доступ на чтение подтверждён.');
}

main().catch((error) => {
  console.error(error instanceof CheckError ? error.message : 'Не удалось выполнить проверку доступа.');
  process.exitCode = 1;
});
