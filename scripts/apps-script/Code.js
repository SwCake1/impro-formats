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
  'Форма',
  'Особенности',
  'Подборки',
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Каталог')
    .addItem('Publish — обновить сайт', 'publishCatalog')
    .addToUi();
}

function publishCatalog() {
  const lock = LockService.getDocumentLock();
  if (!lock) throw new Error('Запустите Publish из своей таблицы.');
  lock.waitLock(30000);

  try {
    // Проверяем весь каталог до любых изменений листа «Опубликовано».
    const { sheet, records, newIds } = readFormats_();
    const deployHookUrl = readDeployHookUrl_();
    // Сначала закрепляем новые id в рабочем листе. При повторном Publish они сохранятся.
    newIds.forEach(({ row, id }) => {
      const cell = sheet.getRange(row, 1);
      if (!cell.isBlank()) {
        throw new Error('Строка ' + row + ': ячейка id уже заполнена. Проверьте её и повторите Publish.');
      }
      cell.setValue(id);
    });
    if (newIds.length) SpreadsheetApp.flush();
    const rows = snapshotRows_(records);
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
    // Сборка читает уже сохранённые значения, а не рабочие ячейки.
    triggerDeployment_(deployHookUrl);
    const message = 'Снимок «Опубликовано» сохранён. Форматов: ' + records.length
      + (newIds.length ? '. Создано id: ' + newIds.length : '')
      + '. Запрос на сборку сайта отправлен.';
    console.log(message);
    spreadsheet.toast(message, 'Publish', 8);
    return records.length;
  } finally {
    lock.releaseLock();
  }
}

function readDeployHookUrl_() {
  const url = (PropertiesService.getScriptProperties().getProperty('VERCEL_DEPLOY_HOOK_URL') || '').trim();
  if (!url) {
    throw new Error('Добавьте VERCEL_DEPLOY_HOOK_URL в свойства скрипта.');
  }
  if (!/^https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+(?:\?buildCache=(?:true|false))?$/.test(url)) {
    throw new Error('Проверьте VERCEL_DEPLOY_HOOK_URL: нужен адрес Deploy Hook из настроек Vercel.');
  }
  return url;
}

function triggerDeployment_(url) {
  let status;
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      muteHttpExceptions: true,
      followRedirects: false,
    });
    status = response.getResponseCode();
  } catch {
    // Исключение UrlFetchApp может содержать секретный URL. Не выводим его.
    throw new Error('Снимок сохранён, но запуск сборки не подтверждён. Проверьте Deployments в Vercel.');
  }
  if (status < 200 || status >= 300) {
    throw new Error('Снимок сохранён, но Vercel не принял запуск сборки (HTTP ' + status + '). Проверьте Deploy Hook.');
  }
}

function snapshotRows_(records) {
  const flag = (value) => value === null ? '' : value ? 'TRUE' : 'FALSE';
  return [CATALOG_HEADERS.slice(), ...records.map((record) => [
    record.id, record.title, record.description,
    flag(record.moderator), flag(record.audienceOnStage), flag(record.props),
    record.furniture, record.note,
    record.forms.join(', '), record.features.join(', '), record.collections.join(', '),
  ])];
}

function readFormats_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Все форматы');
  if (!sheet) throw new Error('Не найден лист «Все форматы».');
  if (sheet.getLastRow() < 2) throw new Error('На листе нет форматов.');

  const rows = sheet.getRange(1, 1, sheet.getLastRow(), CATALOG_HEADERS.length)
    .getDisplayValues();
  // Резервируем все существующие id, включая строки ниже новой записи.
  const usedIds = new Set(rows.slice(1).map((row) => String(row[0] || '').trim()).filter(Boolean));
  const newIds = [];
  rows.slice(1).forEach((row, index) => {
    if (String(row[0] || '').trim() || !String(row[1] || '').trim()) return;
    const base = formatIdBase_(String(row[1]).trim());
    if (!base) {
      throw new Error('Строка ' + (index + 2) + ': не удалось получить id из названия. Укажите id латиницей в колонке A.');
    }
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) id = base + '-' + suffix++;
    usedIds.add(id);
    row[0] = id;
    newIds.push({ row: index + 2, id });
  });
  // Проверка всего каталога происходит до записи любых значений в таблицу.
  return { sheet, records: parseFormatRows_(rows), newIds };
}

function formatIdBase_(title) {
  const letters = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  return title.normalize('NFKC').toLowerCase()
    .replace(/[а-яё]/g, (letter) => letters[letter])
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function parseFormatRows_(rows) {
  const headers = rows[0] || [];
  if (!CATALOG_HEADERS.every((header, index) => String(headers[index] || '').trim() === header)) {
    throw new Error('Изменились заголовки или порядок колонок A–K.');
  }

  const seenIds = new Set();
  const records = [];
  rows.slice(1).forEach((row, index) => {
    const cells = CATALOG_HEADERS.map((_, column) => String(row[column] || '').trim());
    if (cells.every((cell) => cell === '')) return;

    const rowNumber = index + 2;
    const [id, title, description, moderator, audience, props, furniture, note, forms, features, collections] = cells;
    if (!title) throw new Error('Строка ' + rowNumber + ': отсутствует название.');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error('Строка ' + rowNumber + ': отсутствует или некорректен id.');
    }
    if (seenIds.has(id)) throw new Error('Строка ' + rowNumber + ': повторяющийся id ' + id + '.');
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
      forms: parseCatalogList_(forms),
      features: parseCatalogList_(features),
      collections: parseCatalogList_(collections),
    });
  });

  if (records.length === 0) throw new Error('В таблице нет форматов.');
  return records;
}

function parseCatalogList_(value) {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function parseCatalogFlag_(value, rowNumber, field) {
  const normalized = value.toLowerCase();
  if (normalized === '') return null;
  if (['true', 'да', 'истина'].includes(normalized)) return true;
  if (['false', 'нет', 'ложь'].includes(normalized)) return false;
  throw new Error('Строка ' + rowNumber + ': непонятное значение признака «' + field + '»: ' + value);
}
