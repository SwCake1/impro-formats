// Pure data model: used by Node and embedded unchanged in the standalone HTML.
export class ReviewDataError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'ReviewDataError';
    this.path = path;
  }
}

function object(value, path, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReviewDataError(path, 'ожидается объект');
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new ReviewDataError(`${path}.${key}`, 'неизвестное поле');
  }
  return value;
}

function text(value, path, nonempty = false) {
  if (typeof value !== 'string' || (nonempty && !value.trim())) {
    throw new ReviewDataError(path, nonempty ? 'ожидается непустая строка' : 'ожидается строка');
  }
  return value;
}

function flag(value, path) {
  if (value !== null && typeof value !== 'boolean') {
    throw new ReviewDataError(path, 'ожидается true, false или null');
  }
  return value;
}

const TEXT_FIELDS = ['title', 'description', 'furniture', 'note', 'video'];
const FLAG_FIELDS = ['moderator', 'audienceOnStage', 'props'];
const LIST_FIELDS = ['forms', 'features', 'collections'];

function textList(value, path) {
  if (!Array.isArray(value)) throw new ReviewDataError(path, 'ожидается массив строк');
  return value.map((item, index) => text(item, `${path}[${index}]`, true));
}

export function parseReviewFormat(value, path = 'format') {
  const row = object(value, path, [...TEXT_FIELDS, ...FLAG_FIELDS, ...LIST_FIELDS]);
  const format = {};
  for (const key of TEXT_FIELDS) format[key] = key === 'video' && row[key] === undefined ? '' : text(row[key], `${path}.${key}`);
  for (const key of FLAG_FIELDS) format[key] = flag(row[key], `${path}.${key}`);
  for (const key of LIST_FIELDS) {
    format[key] = textList(row[key], `${path}.${key}`);
  }
  return format;
}

export function parseReviewBatch(value) {
  const row = object(value, 'batch', ['schemaVersion', 'kind', 'batchId', 'title', 'candidates', 'classificationOptions']);
  if (row.schemaVersion !== 1) throw new ReviewDataError('batch.schemaVersion', 'поддерживается только версия 1');
  if (row.kind !== 'format-review-batch') throw new ReviewDataError('batch.kind', 'ожидается format-review-batch');
  const batch = {
    schemaVersion: 1,
    kind: 'format-review-batch',
    batchId: text(row.batchId, 'batch.batchId', true),
  };
  if (row.title !== undefined) batch.title = text(row.title, 'batch.title');
  if (row.classificationOptions !== undefined) {
    const options = object(row.classificationOptions, 'batch.classificationOptions', LIST_FIELDS);
    batch.classificationOptions = Object.fromEntries(LIST_FIELDS.map(key => [key,
      textList(options[key], `batch.classificationOptions.${key}`),
    ]));
  }
  if (!Array.isArray(row.candidates)) throw new ReviewDataError('batch.candidates', 'ожидается массив');
  const seen = new Set();
  batch.candidates = row.candidates.map((value, index) => {
    const path = `batch.candidates[${index}]`;
    const row = object(value, path, ['candidateId', 'format', 'source', 'similarFormats']);
    const candidateId = text(row.candidateId, `${path}.candidateId`, true);
    if (seen.has(candidateId)) throw new ReviewDataError(`${path}.candidateId`, 'идентификатор повторяется');
    seen.add(candidateId);
    const sourceRow = object(row.source, `${path}.source`, ['label', 'url', 'text']);
    const source = { label: text(sourceRow.label, `${path}.source.label`, true) };
    for (const key of ['url', 'text']) {
      if (sourceRow[key] !== undefined) source[key] = text(sourceRow[key], `${path}.source.${key}`);
    }
    const candidate = { candidateId, format: parseReviewFormat(row.format, `${path}.format`), source };
    if (row.similarFormats !== undefined) {
      if (!Array.isArray(row.similarFormats)) throw new ReviewDataError(`${path}.similarFormats`, 'ожидается массив');
      candidate.similarFormats = row.similarFormats.map((value, index) => {
        const matchPath = `${path}.similarFormats[${index}]`;
        const row = object(value, matchPath, ['id', 'reason', 'url', ...TEXT_FIELDS, ...FLAG_FIELDS, ...LIST_FIELDS]);
        const match = {
          id: text(row.id, `${matchPath}.id`, true),
          title: text(row.title, `${matchPath}.title`, true),
          description: text(row.description, `${matchPath}.description`),
          reason: text(row.reason, `${matchPath}.reason`, true),
        };
        for (const key of ['url', 'furniture', 'note', 'video']) {
          if (row[key] !== undefined) match[key] = text(row[key], `${matchPath}.${key}`);
        }
        for (const key of FLAG_FIELDS) {
          if (row[key] !== undefined) match[key] = flag(row[key], `${matchPath}.${key}`);
        }
        for (const key of LIST_FIELDS) {
          if (row[key] !== undefined) match[key] = textList(row[key], `${matchPath}.${key}`);
        }
        return match;
      });
    }
    return candidate;
  });
  return batch;
}

export function reviewClassificationOptions(batch, catalog) {
  const options = Object.fromEntries(LIST_FIELDS.map(key => [key, new Set(batch.classificationOptions?.[key] ?? [])]));
  if (catalog !== undefined) {
    if (!catalog || ![2, 3].includes(catalog.schemaVersion) || !Array.isArray(catalog.records)) {
      throw new ReviewDataError('catalog', 'ожидается снимок каталога версии 2 или 3');
    }
    // Same legacy categories as src/config.ts; v3 reads each independent column.
    const legacyForms = ['Короткая форма', 'Длинная форма'];
    const legacyCollections = ['JAM', 'Импровизация.Команды', 'Иностранные'];
    catalog.records.forEach((record, index) => {
      if (!record || typeof record !== 'object') throw new ReviewDataError(`catalog.records[${index}]`, 'ожидается объект');
      if (catalog.schemaVersion === 2) {
        for (const tag of textList(record.tags, `catalog.records[${index}].tags`)) {
          options[legacyForms.includes(tag) ? 'forms' : legacyCollections.includes(tag) ? 'collections' : 'features'].add(tag);
        }
      } else {
        for (const key of LIST_FIELDS) {
          for (const tag of textList(record[key], `catalog.records[${index}].${key}`)) options[key].add(tag);
        }
      }
    });
  }
  for (const candidate of batch.candidates) {
    for (const record of [candidate.format, ...(candidate.similarFormats ?? [])]) {
      for (const key of LIST_FIELDS) {
        for (const tag of record[key] ?? []) options[key].add(tag);
      }
    }
  }
  return Object.fromEntries(LIST_FIELDS.map(key => [key, [...options[key]].sort((a, b) => a.localeCompare(b, 'ru'))]));
}

export function reviewUpdateBase(match) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(match.id)) {
    throw new ReviewDataError('targetId', 'для обновления нужен корректный постоянный id');
  }
  const keys = [...TEXT_FIELDS, ...FLAG_FIELDS, ...LIST_FIELDS];
  const missing = keys.filter(key => match[key] === undefined);
  if (missing.length) {
    throw new ReviewDataError(`match.${match.id}`, `для обновления нужен полный снимок, не переданы: ${missing.join(', ')}`);
  }
  return parseReviewFormat(Object.fromEntries(keys.map(key => [key, match[key]])), `match.${match.id}`);
}

export function reviewFormatChanges(before, after) {
  const changes = {};
  for (const key of [...TEXT_FIELDS, ...FLAG_FIELDS, ...LIST_FIELDS]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { before: structuredClone(before[key]), after: structuredClone(after[key]) };
    }
  }
  return changes;
}

export function reviewFieldTransfer(current, finding, key) {
  if (LIST_FIELDS.includes(key)) {
    const result = [...current[key]];
    const seen = new Set(result);
    for (const value of finding[key]) {
      if (!seen.has(value)) result.push(value);
      seen.add(value);
    }
    return result;
  }
  if (key === 'video') {
    const lines = value => value.split(/\r\n|\r|\n/);
    const seen = new Set(lines(current.video).map(line => line.trim()).filter(Boolean));
    const added = lines(finding.video).filter(line => {
      const value = line.trim();
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
    if (!added.length) return current.video;
    const separator = current.video && !/[\r\n]$/.test(current.video) ? '\n' : '';
    return current.video + separator + added.join('\n');
  }
  if (![...TEXT_FIELDS, ...FLAG_FIELDS].includes(key)) {
    throw new ReviewDataError('field', 'неизвестное поле переноса');
  }
  return structuredClone(finding[key]);
}

export function createReviewSelection(batch, selectedIds, drafts = new Map(), modes = new Map()) {
  const updateTargets = new Set();
  const candidates = batch.candidates.filter(candidate => selectedIds.has(candidate.candidateId))
    .map(candidate => {
      const format = parseReviewFormat(drafts.get(candidate.candidateId) ?? candidate.format,
        `candidate.${candidate.candidateId}.format`);
      if (!format.title.trim()) {
        throw new ReviewDataError(`candidate.${candidate.candidateId}.format.title`, 'укажите название формата');
      }
      const mode = modes.get(candidate.candidateId) ?? { action: 'create' };
      if (mode.action === 'create') return { ...candidate, action: 'create', format };
      if (mode.action !== 'update') throw new ReviewDataError('action', 'ожидается create или update');
      const matches = (candidate.similarFormats ?? []).filter(match => match.id === mode.targetId);
      if (matches.length !== 1) throw new ReviewDataError('targetId', 'нужно выбрать одно из найденных совпадений');
      const target = matches[0];
      const before = reviewUpdateBase(target);
      const changes = reviewFormatChanges(before, format);
      if (!Object.keys(changes).length) {
        throw new ReviewDataError('changes', `в обновлении «${target.title}» нет изменений. Измените поля или снимите выделение`);
      }
      if (updateTargets.has(target.id)) {
        throw new ReviewDataError('targetId', `для «${target.title}» выбрано несколько обновлений. Оставьте одну карточку с нужными правками`);
      }
      updateTargets.add(target.id);
      return {
        candidateId: candidate.candidateId, action: 'update', targetId: target.id, targetTitle: target.title,
        changes, source: structuredClone(candidate.source), similarFormats: structuredClone(candidate.similarFormats),
      };
    });
  if (!candidates.length) throw new ReviewDataError('selection', 'выберите хотя бы один формат');
  return { schemaVersion: 2, kind: 'format-review-selection', batchId: batch.batchId, candidates };
}

function spreadsheetCell(value) {
  // Escape spreadsheet formula interpretation without changing the editable source.
  const literal = /^[\s\uFEFF]*[=+\-@']/u.test(value) ? `'${value}` : value;
  return /[\t\r\n"]/.test(literal) ? `"${literal.replaceAll('"', '""')}"` : literal;
}

export function reviewSelectionToTsv(selection) {
  const records = selection.candidates.filter(candidate => !candidate.action || candidate.action === 'create');
  if (!records.length) throw new ReviewDataError('selection', 'для таблицы выберите новые форматы. Обновления передаются агенту');
  const flag = value => value === null ? '' : value ? 'TRUE' : 'FALSE';
  return records.map(({ format: f }) => [
    '', f.title, f.description, flag(f.moderator), flag(f.audienceOnStage), flag(f.props),
    f.furniture, f.note, f.forms.join(', '), f.features.join(', '), f.collections.join(', '), f.video ?? '',
  ].map(spreadsheetCell).join('\t')).join('\n');
}
