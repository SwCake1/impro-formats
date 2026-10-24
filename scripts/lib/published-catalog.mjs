import { readFile } from 'node:fs/promises';
import { JWT } from 'google-auth-library';

export class CatalogImportError extends Error {}

const HEADERS = [
  'id', 'Название формата', 'Описание формата', 'Наличие модератора',
  'Наличие зрителя на сцене', 'Наличие реквизита', 'Наличие мебели',
  'Дополнительно', 'Форма', 'Особенности', 'Подборки',
];
const LEGACY_HEADERS = [...HEADERS.slice(0, 8), 'Тип формата (тег)'];

function parseCredentials(json) {
  let credentials;
  try {
    credentials = JSON.parse(json);
  } catch {
    throw new CatalogImportError('Не удалось прочитать JSON учётных данных Google.');
  }
  if (credentials?.type !== 'service_account' ||
      typeof credentials.client_email !== 'string' || !credentials.client_email ||
      typeof credentials.private_key !== 'string' || !credentials.private_key) {
    throw new CatalogImportError('Нужен JSON-ключ технического аккаунта Google.');
  }
  return credentials;
}

export async function readServiceAccountFile(path) {
  if (!path) throw new CatalogImportError('Укажи путь к JSON-ключу Google.');
  let json;
  try {
    json = await readFile(path, 'utf8');
  } catch {
    throw new CatalogImportError('Не удалось прочитать файл JSON-ключа Google.');
  }
  return parseCredentials(json);
}

export async function credentialsFromEnvironment(env) {
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) return parseCredentials(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (env.GOOGLE_APPLICATION_CREDENTIALS) return readServiceAccountFile(env.GOOGLE_APPLICATION_CREDENTIALS);
  throw new CatalogImportError('Задай GOOGLE_SERVICE_ACCOUNT_JSON или GOOGLE_APPLICATION_CREDENTIALS.');
}

export function parsePublishedRows(rows) {
  const matches = (headers) => Array.isArray(rows) && Array.isArray(rows[0]) &&
    headers.every((header, index) => String(rows[0][index] ?? '').trim() === header);
  const legacy = !matches(HEADERS) && matches(LEGACY_HEADERS);
  const headers = legacy ? LEGACY_HEADERS : HEADERS;
  if (!matches(headers)) {
    throw new CatalogImportError('На листе «Опубликовано» изменились колонки A–K.');
  }

  const ids = new Set();
  const records = [];
  rows.slice(1).forEach((row, index) => {
    if (!Array.isArray(row)) throw new CatalogImportError('Некорректная строка снимка.');
    const cells = headers.map((_, column) => String(row[column] ?? '').trim());
    if (cells.every(value => value === '')) return;
    const [id, title, description, moderator, audience, props, furniture, note, forms, features, collections] = cells;
    const rowNumber = index + 2;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id) || !title) {
      throw new CatalogImportError(`Строка ${rowNumber}: проверь уникальный id и название.`);
    }
    ids.add(id);

    const flag = (value) => {
      const normalized = value.toLowerCase();
      if (normalized === '') return null;
      if (['true', 'да', 'истина'].includes(normalized)) return true;
      if (['false', 'нет', 'ложь'].includes(normalized)) return false;
      throw new CatalogImportError(`Строка ${rowNumber}: непонятное значение признака.`);
    };
    const list = (value) => [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
    records.push({
      id, title, description,
      moderator: flag(moderator),
      audienceOnStage: flag(audience),
      props: flag(props),
      furniture, note,
      ...(legacy ? { tags: list(forms) } : {
        forms: list(forms), features: list(features), collections: list(collections),
      }),
    });
  });
  if (records.length === 0) throw new CatalogImportError('Снимок пуст. Сначала выполни Publish в таблице.');
  return { schemaVersion: legacy ? 2 : 3, generatedAt: new Date().toISOString(), records };
}

export async function fetchPublishedCatalog({ credentials, spreadsheetId }) {
  if (typeof spreadsheetId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(spreadsheetId)) {
    throw new CatalogImportError('Укажи корректный GOOGLE_SHEET_ID.');
  }
  let response;
  try {
    const client = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const range = encodeURIComponent("'Опубликовано'!A1:K");
    response = await client.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
      method: 'GET',
      params: { valueRenderOption: 'FORMATTED_VALUE' },
      timeout: 15000,
      retry: false,
    });
  } catch (error) {
    // Ошибка SDK может содержать ключи и заголовки. Не передаём её в журнал.
    const status = error?.response?.status;
    throw new CatalogImportError(status
      ? `Google отклонил запрос (HTTP ${status}). Проверь API и доступ аккаунта к таблице.`
      : 'Не удалось соединиться с Google или получить доступ. Проверь сеть и ключ.');
  }
  return parsePublishedRows(response.data?.values);
}

export async function loadPublishedCatalog(env) {
  const credentials = await credentialsFromEnvironment(env);
  return fetchPublishedCatalog({ credentials, spreadsheetId: env.GOOGLE_SHEET_ID });
}
