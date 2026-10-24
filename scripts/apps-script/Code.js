/** @OnlyCurrentDoc */

const CATALOG_HEADERS = [
  'id',
  'Название формата',
  'Описание формата',
  'Наличие модератора',
  'Наличие зрителя на сцене',
  'Наличие реквизита',
  'Наличие мебели',
  'Дополнительно',
  'Тип формата (тег)',
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Каталог')
    .addItem('Publish — сохранить снимок', 'publishCatalog')
    .addToUi();
}

function checkCatalog() {
  const catalog = readCatalog_();
  console.log('Найдено форматов: ' + catalog.records.length);
}

function previewCatalog() {
  const catalog = readCatalog_();
  console.log('JSON готов. Форматов: ' + catalog.records.length);
  console.log('Версия схемы: ' + catalog.schemaVersion);
  console.log('Пример записи:\n' + JSON.stringify(catalog.records[0], null, 2));
}

function publishCatalog() {
  const lock = LockService.getDocumentLock();
  if (!lock) throw new Error('Запустите Publish из своей таблицы.');
  lock.waitLock(30000);

  try {
    // Проверяем весь каталог до любых изменений листа «Опубликовано».
    const catalog = readCatalog_();
    const rows = catalogSnapshotRows_(catalog);
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let published = spreadsheet.getSheetByName('Опубликовано');
    if (!published) {
      published = spreadsheet.insertSheet('Опубликовано');
      published.setFrozenRows(1);
    }

    // Пустые строки в конце удаляют остатки более длинного прежнего снимка.
    // Новый снимок и очистку хвоста отправляем одной записью, без clear().
    const height = Math.max(rows.length, published.getLastRow());
    const values = Array.from({ length: height }, (_, index) => {
      const row = rows[index] || Array(CATALOG_HEADERS.length).fill('');
      // RichText записывает текст, в том числе начинающийся с «=», без формул.
      return row.map((text) => SpreadsheetApp.newRichTextValue().setText(text).build());
    });

    if (published.getMaxRows() < height) {
      published.insertRowsAfter(published.getMaxRows(), height - published.getMaxRows());
    }
    if (published.getMaxColumns() < CATALOG_HEADERS.length) {
      published.insertColumnsAfter(
        published.getMaxColumns(), CATALOG_HEADERS.length - published.getMaxColumns(),
      );
    }

    published.getRange(1, 1, height, CATALOG_HEADERS.length).setRichTextValues(values);
    SpreadsheetApp.flush();
    const message = 'Снимок «Опубликовано» сохранён. Форматов: ' + catalog.records.length;
    console.log(message);
    spreadsheet.toast(message, 'Publish', 8);
    return catalog.records.length;
  } finally {
    lock.releaseLock();
  }
}

function catalogSnapshotRows_(catalog) {
  const flag = (value) => value === null ? '' : value ? 'TRUE' : 'FALSE';
  return [CATALOG_HEADERS.slice(), ...catalog.records.map((record) => [
    record.id, record.title, record.description,
    flag(record.moderator), flag(record.audienceOnStage), flag(record.props),
    record.furniture, record.note, record.tags.join(', '),
  ])];
}

function readCatalog_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Все форматы');
  if (!sheet) throw new Error('Не найден лист «Все форматы».');
  if (sheet.getLastRow() < 2) throw new Error('На листе нет форматов.');

  const rows = sheet.getRange(1, 1, sheet.getLastRow(), CATALOG_HEADERS.length)
    .getDisplayValues();
  return parseCatalogRows_(rows);
}

function parseCatalogRows_(rows) {
  const headers = rows[0] || [];
  if (!CATALOG_HEADERS.every((header, index) => String(headers[index] || '').trim() === header)) {
    throw new Error('Изменились заголовки или порядок колонок A–I.');
  }

  const seenIds = new Set();
  const records = [];
  rows.slice(1).forEach((row, index) => {
    const cells = CATALOG_HEADERS.map((_, column) => String(row[column] || '').trim());
    if (cells.every((cell) => cell === '')) return;

    const rowNumber = index + 2;
    const [id, title, description, moderator, audience, props, furniture, note, tags] = cells;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error('Строка ' + rowNumber + ': отсутствует или некорректен id.');
    }
    if (seenIds.has(id)) throw new Error('Строка ' + rowNumber + ': повторяющийся id ' + id + '.');
    if (!title) throw new Error('Строка ' + rowNumber + ': отсутствует название.');
    seenIds.add(id);

    records.push({
      id,
      title,
      description,
      moderator: parseCatalogFlag_(moderator, rowNumber, 'модератор'),
      audienceOnStage: parseCatalogFlag_(audience, rowNumber, 'зритель на сцене'),
      props: parseCatalogFlag_(props, rowNumber, 'реквизит'),
      furniture,
      note,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    });
  });

  if (records.length === 0) throw new Error('В таблице нет форматов.');
  return { schemaVersion: 2, generatedAt: new Date().toISOString(), records };
}

function parseCatalogFlag_(value, rowNumber, field) {
  const normalized = value.toLowerCase();
  if (normalized === '') return null;
  if (['true', 'да', 'истина'].includes(normalized)) return true;
  if (['false', 'нет', 'ложь'].includes(normalized)) return false;
  throw new Error('Строка ' + rowNumber + ': непонятное значение признака «' + field + '»: ' + value);
}
