const reviewBatch = parseReviewBatch(JSON.parse(document.querySelector('#review-data').textContent));
document.querySelector('#batch-title').textContent = reviewBatch.title || 'Находки для каталога';
document.querySelector('#batch-size').textContent = String(reviewBatch.candidates.length);
document.querySelector('#empty').hidden = reviewBatch.candidates.length > 0;
document.title = `${reviewBatch.title || 'Ревью форматов'} · Что сыграем?`;

const initialStates = new Map(reviewBatch.candidates.map(candidate => [candidate.candidateId, reviewInitialState(candidate)]));
const selected = new Set([...initialStates].filter(([, state]) => state.selected).map(([id]) => id));
const drafts = new Map([...initialStates].map(([id, state]) => [id, structuredClone(state.format)]));
const views = new Map();
const reviewModes = new Map([...initialStates].map(([id, state]) => [id, state.mode]));
const classificationOptions = reviewClassificationOptions(reviewBatch);
const tagPickers = { forms: [], features: [], collections: [] };
const status = document.querySelector('#status');
const agentButton = document.querySelector('#copy-agent');
const sheetButton = document.querySelector('#copy-sheet');
const manualDialog = document.querySelector('#manual-copy');
const resetDialog = document.querySelector('#reset-dialog');
const saveStatus = document.querySelector('#save-status');
const draftStorageKey = `format-review-draft:v1:${encodeURIComponent(reviewBatch.batchId)}`;
const batchSignature = JSON.stringify(reviewBatch.candidates);
let persistenceReady = false;
let storageBlocked = false;
let unsavedChanges = false;
let lastStoredValue = null;
let copying = false;
let lastCopyButton;
let pointerPosition;
let activeCategory = 'all';
let pendingReset;
const visibleViews = () => [...views.values()].filter(view => !view.card.hidden);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function reviewErrorText(error) {
  return error instanceof ReviewDataError ? error.message.slice(error.path.length + 2) : error.message;
}

function showSaveStatus(message, failed = false) {
  saveStatus.textContent = message;
  saveStatus.dataset.state = failed ? 'error' : 'saved';
}

function validateSavedReview(value) {
  const require = condition => { if (!condition) throw new Error('Invalid saved review'); };
  require(value?.schemaVersion === 1 && value.batchId === reviewBatch.batchId);
  require(value.baseline === batchSignature);
  require(['all', 'create', 'update', 'review', 'duplicate', 'skip'].includes(value.category));
  require(Array.isArray(value.candidates) && value.candidates.length === reviewBatch.candidates.length);
  const records = new Map();
  for (const record of value.candidates) {
    const candidate = reviewBatch.candidates.find(candidate => candidate.candidateId === record?.candidateId);
    require(candidate && !records.has(candidate.candidateId) && typeof record.selected === 'boolean');
    const validateKey = key => {
      require(typeof key === 'string');
      if (key === 'create') return;
      require(key.startsWith('update:'));
      const matches = candidate.similarFormats?.filter(match => match.id === key.slice(7)) ?? [];
      require(matches.length === 1);
      reviewUpdateBase(matches[0]);
    };
    require(Array.isArray(record.drafts));
    const savedDrafts = new Map();
    for (const entry of record.drafts) {
      require(Array.isArray(entry) && entry.length === 2);
      const [key, format] = entry;
      validateKey(key);
      require(!savedDrafts.has(key));
      savedDrafts.set(key, parseReviewFormat(format));
    }
    require(savedDrafts.has('create') && savedDrafts.has(record.activeKey));
    const parseFields = entries => {
      require(Array.isArray(entries));
      const result = new Map();
      for (const entry of entries) {
        require(Array.isArray(entry) && entry.length === 2);
        const [key, fields] = entry;
        validateKey(key);
        require(!result.has(key) && Array.isArray(fields) && fields.every(field => Object.hasOwn(candidate.format, field)));
        result.set(key, new Set(fields));
      }
      return result;
    };
    const edited = parseFields(record.edited);
    const revealed = parseFields(record.revealed);
    require(['expanded', 'editFinding', 'showAll'].every(key => typeof record[key] === 'boolean'));
    records.set(candidate.candidateId, { ...record, savedDrafts, edited, revealed });
  }
  const options = {};
  for (const key of ['forms', 'features', 'collections']) {
    require(Array.isArray(value.options?.[key]) && value.options[key].every(tag => typeof tag === 'string' && tag.trim()));
    options[key] = [...new Set([...classificationOptions[key], ...value.options[key]])];
  }
  return { records, options, category: value.category };
}

function loadSavedReview() {
  try { lastStoredValue = localStorage.getItem(draftStorageKey); }
  catch {
    showSaveStatus('Автосохранение недоступно. Перед закрытием скопируйте результат.', true);
    return null;
  }
  if (lastStoredValue === null) {
    showSaveStatus('Автосохранение включено');
    return null;
  }
  try {
    const restored = validateSavedReview(JSON.parse(lastStoredValue));
    showSaveStatus('✓ Правки восстановлены');
    return restored;
  } catch {
    storageBlocked = true;
    showSaveStatus('Сохранение повреждено или исходная подборка изменилась. Для нового сохранения сбросьте правки.', true);
    return null;
  }
}

function saveReview() {
  if (!persistenceReady) return;
  unsavedChanges = true;
  if (storageBlocked) return;
  try {
    if (localStorage.getItem(draftStorageKey) !== lastStoredValue) {
      storageBlocked = true;
      showSaveStatus('Правки изменены в другой вкладке. Скопируйте текущий результат перед перезагрузкой.', true);
      return;
    }
    const value = JSON.stringify({ schemaVersion: 1, batchId: reviewBatch.batchId, baseline: batchSignature,
      category: activeCategory, options: classificationOptions,
      candidates: reviewBatch.candidates.map(candidate => views.get(candidate.candidateId).savedState()),
    });
    if (value !== lastStoredValue) localStorage.setItem(draftStorageKey, value);
    lastStoredValue = value;
    unsavedChanges = false;
    showSaveStatus('✓ Сохранено в этом браузере');
  } catch {
    showSaveStatus('Не удалось сохранить. Перед закрытием скопируйте результат.', true);
  }
}

const restoredReview = loadSavedReview();
if (restoredReview) {
  for (const [id, record] of restoredReview.records) {
    if (record.selected) selected.add(id); else selected.delete(id);
    drafts.set(id, structuredClone(record.savedDrafts.get(record.activeKey)));
    reviewModes.set(id, record.activeKey === 'create' ? { action: 'create' } : { action: 'update', targetId: record.activeKey.slice(7) });
  }
  for (const key of Object.keys(classificationOptions)) classificationOptions[key] = restoredReview.options[key];
}

function updateSelection() {
  const newCount = [...selected].filter(id => reviewModes.get(id)?.action !== 'update').length;
  document.querySelector('#selection-count').textContent = `Выбрано: ${selected.size} из ${reviewBatch.candidates.length}`;
  document.querySelector('#selection-breakdown').textContent = selected.size ? `Новых: ${newCount} · Обновлений: ${selected.size - newCount}` : 'Выберите форматы в списке';
  for (const view of views.values()) view.refreshDecision();
  agentButton.disabled = copying || selected.size === 0;
  sheetButton.disabled = copying || newCount === 0;
  sheetButton.textContent = `Скопировать новые для таблицы (${newCount})`;
  document.querySelector('#select-all').disabled = visibleViews().every(view => view.checkbox.checked);
  document.querySelector('#clear-selection').disabled = visibleViews().every(view => !view.checkbox.checked);
  saveReview();
}

function setCandidateSelected(id, value) {
  const view = views.get(id);
  if (value) selected.add(id);
  else selected.delete(id);
  view.checkbox.checked = value;
  view.card.classList.toggle('is-selected', value);
  view.error.hidden = true;
  view.titleControl.removeAttribute('aria-invalid');
  view.refreshDecision();
  status.textContent = '';
}

function updateExpansionActions() {
  const bodies = visibleViews().map(view => view.body);
  document.querySelector('#expand-all').disabled = bodies.every(body => !body.hidden);
  document.querySelector('#collapse-all').disabled = bodies.every(body => body.hidden);
}

function field(key, label, format, index, onEdit, options = {}) {
  const wrapper = element('div', 'field');
  const id = `format-${index}-${key}`;
  const caption = element('label', '', label);
  caption.htmlFor = id;
  let control;
  if (options.flag) {
    control = element('select');
    for (const [value, label] of [['', 'Неизвестно'], ['true', 'Да'], ['false', 'Нет']]) {
      const option = element('option', '', label);
      option.value = value;
      control.append(option);
    }
    control.value = format[key] === null ? '' : String(format[key]);
  } else {
    control = element(options.multiline ? 'textarea' : 'input', key);
    if (!options.multiline) control.type = 'text';
    control.value = format[key];
    if (options.multiline) control.rows = key === 'description' ? 5 : 2;
    if (key === 'title') control.setAttribute('aria-required', 'true');
  }
  control.id = id;
  control.name = key;
  control.addEventListener('input', () => {
    format[key] = options.flag ? (control.value === '' ? null : control.value === 'true')
      : control.value;
    status.textContent = '';
    onEdit(key);
  });
  wrapper.append(caption, control);
  return { wrapper, control };
}

function tagField(key, label, format, index, onEdit, resetEditors) {
  const wrapper = element('div', 'field tag-field');
  const caption = element('label', '', label);
  const select = element('select');
  select.id = `format-${index}-${key}`;
  caption.htmlFor = select.id;
  const values = element('div', 'tag-values');
  const creator = element('div', 'tag-creator');
  creator.hidden = true;
  const input = element('input');
  input.type = 'text';
  input.setAttribute('aria-label', `Новый тег: ${label}`);
  const add = element('button', 'tag-add', 'Добавить');
  add.type = 'button';
  add.setAttribute('aria-label', `Добавить новый тег: ${label}`);
  const cancel = element('button', 'tag-cancel', '×');
  cancel.type = 'button';
  cancel.setAttribute('aria-label', `Отменить новый тег: ${label}`);
  creator.append(input, add, cancel);
  let available = [];

  const refresh = () => {
    values.replaceChildren();
    values.hidden = !format[key].length;
    for (const tag of format[key]) {
      const remove = element('button', 'tag-chip', `${tag} ×`);
      remove.type = 'button';
      remove.setAttribute('aria-label', `Убрать ${label}: ${tag}`);
      remove.addEventListener('click', () => {
        format[key] = format[key].filter(value => value !== tag);
        changed();
        select.focus();
      });
      values.append(remove);
    }
    available = classificationOptions[key].filter(tag => !format[key].includes(tag));
    select.replaceChildren();
    const placeholder = element('option', '', 'Добавить…');
    placeholder.value = '';
    select.append(placeholder);
    for (const [index, tag] of available.entries()) {
      const option = element('option', '', tag);
      option.value = String(index);
      select.append(option);
    }
    const custom = element('option', '', 'Новый тег…');
    custom.value = 'new';
    select.append(custom);
    select.value = '';
  };
  const changed = () => {
    status.textContent = '';
    for (const refresh of tagPickers[key]) refresh();
    onEdit(key);
  };
  const addTag = tag => {
    if (!format[key].includes(tag)) format[key].push(tag);
    if (!classificationOptions[key].includes(tag)) {
      classificationOptions[key].push(tag);
      classificationOptions[key].sort((a, b) => a.localeCompare(b, 'ru'));
    }
    creator.hidden = true;
    select.hidden = false;
    input.value = '';
    changed();
    select.focus();
  };
  const resetCreation = () => {
    creator.hidden = true;
    select.hidden = false;
    input.value = '';
    select.value = '';
  };
  resetEditors.push(resetCreation);
  const cancelCreation = () => {
    resetCreation();
    select.focus();
  };
  select.addEventListener('change', () => {
    if (select.value === 'new') {
      creator.hidden = false;
      select.hidden = true;
      input.focus();
    } else if (select.value !== '') addTag(available[Number(select.value)]);
  });
  const create = () => {
    const tag = input.value.trim();
    if (tag) addTag(tag);
  };
  add.addEventListener('click', create);
  cancel.addEventListener('click', cancelCreation);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); create(); }
    if (event.key === 'Escape') { event.preventDefault(); cancelCreation(); }
  });
  tagPickers[key].push(refresh);
  refresh();
  wrapper.append(caption, values, select, creator);
  return wrapper;
}

function safeLink(url, label, className = '') {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    const link = element('a', className, label);
    link.href = parsed.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  } catch { return null; }
}

function renderVideoText(container, value) {
  container.replaceChildren();
  let offset = 0;
  for (const match of value.matchAll(/https?:\/\/[^\s<>]+/g)) {
    container.append(document.createTextNode(value.slice(offset, match.index)));
    container.append(safeLink(match[0], match[0]) ?? document.createTextNode(match[0]));
    offset = match.index + match[0].length;
  }
  container.append(document.createTextNode(value.slice(offset)));
}

const fieldGroups = [
  { id: 'main', label: 'Основное', fields: [['title', 'Название'], ['description', 'Описание']] },
  { id: 'requirements', label: 'Требования', fields: [
    ['moderator', 'Модератор'], ['audienceOnStage', 'Зритель на сцене'], ['props', 'Реквизит'], ['furniture', 'Мебель'],
  ] },
  { id: 'classification', label: 'Классификация', fields: [['forms', 'Форма'], ['features', 'Особенности'], ['collections', 'Подборки']] },
  { id: 'extra', label: 'Заметки и видео', fields: [['note', 'Дополнительно'], ['video', 'Видео']] },
];
const formatFields = fieldGroups.flatMap(group => group.fields);

function renderFieldGroup(group, snapshot = false) {
  const node = element('section', 'field-group');
  node.dataset.fieldGroup = group.id;
  node.setAttribute('aria-label', group.label);
  node.append(element(snapshot ? 'h5' : 'h4', 'group-label', group.label));
  const content = element(snapshot ? 'dl' : 'div', 'group-fields');
  node.append(content);
  return { node, content };
}

function comparisonText(record, key) {
  if (key === 'id' && record.id === undefined) return '—';
  if (record[key] === undefined) return 'Не передано';
  if (record[key] === null) return 'Неизвестно';
  if (typeof record[key] === 'boolean') return record[key] ? 'Да' : 'Нет';
  if (Array.isArray(record[key])) return record[key].join(', ') || 'Не указано';
  return record[key] || 'Не указано';
}

function attachTooltip(trigger, tooltip) {
  tooltip.hidden = true;
  tooltip.setAttribute('role', 'tooltip');
  trigger.tabIndex = 0;
  trigger.removeAttribute('title');
  trigger.setAttribute('aria-describedby', tooltip.id);
  trigger.classList.add('has-tooltip');
  document.body.append(tooltip);
  let closeTimer;
  const hide = () => { clearTimeout(closeTimer); tooltip.hidden = true; };
  const show = () => {
    clearTimeout(closeTimer);
    tooltip.hidden = false;
    const rect = trigger.getBoundingClientRect();
    const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
    tooltip.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    tooltip.style.top = `${Math.max(12, rect.bottom + height + 20 <= innerHeight ? rect.bottom + 8 : rect.top - height - 8)}px`;
  };
  const scheduleHide = () => {
    closeTimer = setTimeout(() => {
      if (!trigger.matches(':hover, :focus') && !tooltip.matches(':hover')) hide();
    }, 120);
  };
  trigger.addEventListener('pointerenter', show);
  trigger.addEventListener('focus', show);
  trigger.addEventListener('pointerleave', scheduleHide);
  trigger.addEventListener('blur', scheduleHide);
  tooltip.addEventListener('pointerenter', () => clearTimeout(closeTimer));
  tooltip.addEventListener('pointerleave', scheduleHide);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('resize', hide);
}

function formatLink(match) {
  const url = new URL('https://impro-formats.vercel.app/');
  url.searchParams.set('format', match.id);
  return safeLink(match.url || url.href, 'Открыть формат ↗', 'format-link');
}

function renderContext(candidate, onUpdate) {
  const context = element('section', 'context');
  context.setAttribute('aria-label', 'Похожие форматы в каталоге');
  if (!candidate.similarFormats?.length) {
    context.hidden = true;
    return { node: context, refresh() {} };
  }
  const matches = [...candidate.similarFormats].sort((a, b) =>
    Number(b.id === candidate.recommendation?.targetId) - Number(a.id === candidate.recommendation?.targetId));
  const heading = element('h3', 'context-heading', 'Похожие форматы в каталоге');
  heading.append(element('span', 'category-count', String(matches.length)));
  context.append(heading);
  const entries = [];
  for (const [index, match] of matches.entries()) {
    const box = element('details', 'match');
    box.open = index === 0;
    box.dataset.formatId = match.id;
    const matchSummary = element('summary', 'match-summary');
    const title = element('span', 'match-title', match.title);
    matchSummary.append(title);
    const matchBody = element('div', 'match-body');
    box.append(matchSummary, matchBody);
    const description = element('p', 'match-description', match.description);
    const reason = element('p', 'match-reason');
    reason.append(element('span', 'reason-label', 'Сходство: '), document.createTextNode(match.reason));
    const details = element('details', 'snapshot-details');
    details.append(element('summary', '', 'Параметры и ссылки'));
    const snapshot = element('div', 'snapshot');
    for (const group of fieldGroups.filter(group => group.id !== 'main')) {
      const section = renderFieldGroup(group, true);
      for (const [key, label] of group.fields) {
        const field = element('div', 'snapshot-field');
        field.dataset.field = key;
        const value = element('dd', 'catalog-value readonly-value');
        if (key === 'video' && match.video) renderVideoText(value, match.video);
        else if (Array.isArray(match[key]) && match[key].length) {
          value.classList.add('tag-values');
          for (const tag of match[key]) value.append(element('span', 'tag-chip', tag));
        } else value.textContent = comparisonText(match, key);
        value.classList.toggle('missing-value', match[key] === undefined);
        field.append(element('dt', 'field-label', label), value);
        section.content.append(field);
      }
      snapshot.append(section.node);
    }
    details.append(snapshot, element('p', 'match-id', `ID: ${match.id}`));
    const actions = element('div', 'match-actions');
    const update = element('button', 'update-format', 'Подготовить обновление');
    update.type = 'button';
    update.title = 'Открыть поля для обновления этой записи. Каталог пока не изменится.';
    try {
      reviewUpdateBase(match);
      if (candidate.similarFormats.filter(other => other.id === match.id).length !== 1) throw new Error('Для обновления нужен один снимок записи с этим id.');
    } catch (error) {
      update.disabled = true;
      update.title = reviewErrorText(error);
    }
    update.addEventListener('click', () => onUpdate(match));
    actions.append(update);
    const link = formatLink(match);
    if (link) actions.append(link);
    matchBody.append(description, reason, details, actions);
    context.append(box);
    entries.push({ match, box, update });
  }
  let previousTarget;
  return { node: context, refresh(selectTarget = false) {
    const targetId = reviewModes.get(candidate.candidateId)?.targetId ?? null;
    const reordered = targetId !== previousTarget;
    const ordered = [...entries].sort((a, b) => Number(b.match.id === targetId) - Number(a.match.id === targetId));
    for (const [index, { match, box, update }] of ordered.entries()) {
      const active = targetId === match.id;
      box.classList.toggle('is-update-target', active);
      update.setAttribute('aria-pressed', String(active));
      if (reordered) context.append(box);
      if (reordered || selectTarget) box.open = targetId ? active : index === 0;
    }
    previousTarget = targetId;
  } };
}

for (const [index, candidate] of reviewCandidatesByRecommendation(reviewBatch.candidates).entries()) {
  const format = drafts.get(candidate.candidateId);
  const restored = restoredReview?.records.get(candidate.candidateId);
  const savedDrafts = restored?.savedDrafts ?? new Map([['create', structuredClone(candidate.format)]]);
  const initialMode = reviewModes.get(candidate.candidateId);
  let activeDraftKey = initialMode.action === 'update' ? `update:${initialMode.targetId}` : 'create';
  let showAll = restored?.showAll ?? false;
  let editFinding = restored?.editFinding ?? false;
  const revealed = restored?.revealed ?? new Map();
  const edited = restored?.edited ?? new Map();
  const resetTagEditors = [];
  const revealedFields = () => {
    if (!revealed.has(activeDraftKey)) revealed.set(activeDraftKey, new Set());
    return revealed.get(activeDraftKey);
  };
  const card = element('article', 'candidate is-collapsed');
  card.dataset.candidateId = candidate.candidateId;
  if (candidate.recommendation) card.dataset.recommendation = candidate.recommendation.action;
  const top = element('div', 'card-top');
  const heading = element('h2');
  heading.id = `heading-${index}`;
  card.setAttribute('aria-labelledby', heading.id);
  const titleGroup = element('div', 'card-title-group');
  const cardSummary = element('p', 'card-summary', candidate.recommendation
    ? candidate.recommendation.reason : candidate.format.description);
  const titleButton = element('button', 'card-title-button');
  titleButton.type = 'button';
  heading.append(titleButton);
  titleGroup.append(heading, cardSummary);
  const comparison = reviewDuplicateComparison(candidate);
  if (comparison) {
    const evidence = element('div', 'duplicate-comparison');
    evidence.setAttribute('role', 'group');
    evidence.setAttribute('aria-label', `Сравнение исходной находки с «${comparison.targetTitle}»`);
    const states = { same: 'совпало', different: 'отличается', unknown: 'нет данных' };
    for (const [key, label] of [['title', 'Название'], ['description', 'Описание'], ['parameters', 'Параметры']]) {
      const { status, text } = comparison[key];
      const symbol = status === 'same' ? '✓' : status === 'different' ? '≠' : '?';
      const differences = key === 'parameters' && status === 'different'
        ? ` ${comparison.parameters.fields.filter(field => field.status === 'different').length}` : '';
      const item = element('span', 'comparison-mark', `${label} ${symbol}${differences}`);
      item.dataset.status = status;
      item.title = `${label}: ${text}`;
      if (key === 'description') item.title += '. По смыслу оценивает агент; дословное совпадение — сравнение текстов.';
      if (key === 'parameters') {
        item.title += '\n' + comparison.parameters.fields.map(field => `${field.label}: ${states[field.status]}`).join('\n');
      }
      item.setAttribute('aria-label', item.title.replaceAll('\n', '. '));
      if (key === 'parameters' && status === 'different') {
        const target = candidate.similarFormats.find(match => match.id === comparison.targetId);
        const tooltip = element('div', 'comparison-tooltip');
        tooltip.id = `parameter-differences-${index}`;
        const table = element('table');
        const head = element('thead');
        const headings = element('tr');
        for (const caption of ['Параметр', 'Находка', 'В каталоге']) headings.append(element('th', '', caption));
        head.append(headings);
        const content = element('tbody');
        for (const field of comparison.parameters.fields.filter(field => field.status === 'different')) {
          const row = element('tr');
          row.append(element('th', '', field.label), element('td', '', comparisonText(candidate.format, field.key)),
            element('td', '', comparisonText(target, field.key)));
          content.append(row);
        }
        table.append(head, content);
        tooltip.append(table);
        attachTooltip(item, tooltip);
      }
      evidence.append(item);
    }
    titleGroup.append(evidence);
  }
  const body = element('div', 'card-body');
  body.id = `format-body-${index}`;
  body.hidden = true;
  const disclosure = element('button', 'card-toggle', '▾');
  disclosure.type = 'button';
  disclosure.setAttribute('aria-keyshortcuts', 'C');
  disclosure.setAttribute('aria-controls', body.id);
  const resetButton = element('button', 'batch-action reset-format', '↺ Сбросить');
  resetButton.type = 'button';
  resetButton.setAttribute('aria-label', `Сбросить правки формата ${candidate.format.title || 'без названия'}`);
  resetButton.addEventListener('click', () => openResetDialog(resetButton, candidate));
  const hasFieldEdits = () => {
    const initial = initialStates.get(candidate.candidateId);
    const allDrafts = new Map(savedDrafts);
    allDrafts.set(activeDraftKey, format);
    return [...allDrafts].some(([key, draft]) => {
      const base = key === 'create' ? candidate.format
        : initial.mode.action === 'update' && key === `update:${initial.mode.targetId}` ? initial.format
        : reviewUpdateBase(candidate.similarFormats.find(match => `update:${match.id}` === key));
      return Object.keys(reviewFormatChanges(base, draft)).length > 0;
    });
  };
  const headerTitle = () => reviewModes.get(candidate.candidateId).action === 'update' ? savedDrafts.get('create').title : format.title;
  const updateDisclosure = () => {
    const title = headerTitle() || 'Формат без названия';
    titleButton.textContent = title;
    titleButton.setAttribute('aria-expanded', String(!body.hidden));
    titleButton.setAttribute('aria-controls', body.id);
    checkbox.setAttribute('aria-label', `Выбрать формат ${title}`);
    disclosure.setAttribute('aria-expanded', String(!body.hidden));
    disclosure.setAttribute('aria-label', `${body.hidden ? 'Развернуть' : 'Свернуть'} формат ${title}`);
    disclosure.title = `${body.hidden ? 'Развернуть' : 'Свернуть'} формат (C)`;
    resetButton.hidden = body.hidden || !hasFieldEdits();
  };
  const setExpanded = expanded => {
    if (!expanded && (body.contains(document.activeElement) || document.activeElement === resetButton)) disclosure.focus({ preventScroll: true });
    body.hidden = !expanded;
    card.classList.toggle('is-collapsed', !expanded);
    updateDisclosure();
    resizeEditors();
    updateExpansionActions();
    saveReview();
  };
  disclosure.addEventListener('click', () => setExpanded(body.hidden));
  titleButton.addEventListener('click', () => setExpanded(body.hidden));
  const pick = element('label', 'pick');
  const checkbox = element('input');
  checkbox.type = 'checkbox';
  checkbox.setAttribute('aria-keyshortcuts', 'S');
  pick.title = 'Выбрать / снять выбор (S)';
  pick.append(checkbox);
  top.append(pick, disclosure, element('span', 'card-number', String(index + 1).padStart(2, '0')), titleGroup);
  if (candidate.recommendation) {
    const { emoji, label } = REVIEW_RECOMMENDATIONS[candidate.recommendation.action];
    const badge = element('span', 'recommendation-badge', `${emoji} ${label}`);
    badge.title = `Рекомендация агента: ${candidate.recommendation.reason}`;
    top.append(badge);
  }
  top.append(resetButton);

  const actionPanel = element('div', 'review-action');
  const actionLine = element('div', 'action-line');
  const actionTitle = element('strong');
  const changeCount = element('span', 'update-change-count');
  const returnToCreate = element('button', 'return-to-create', 'Добавить как новый');
  returnToCreate.type = 'button';
  returnToCreate.addEventListener('click', () => {
    if (reviewModes.get(candidate.candidateId).action === 'update') switchMode(null);
    setCandidateSelected(candidate.candidateId, true);
    updateSelection();
  });
  const skipButton = element('button', 'skip-format', 'Пропустить');
  skipButton.type = 'button';
  skipButton.addEventListener('click', () => {
    setCandidateSelected(candidate.candidateId, false);
    updateSelection();
  });
  const decisionSummary = element('span', 'decision-summary');
  actionLine.append(actionTitle, changeCount, decisionSummary, returnToCreate, skipButton);
  if (candidate.recommendation) {
    const reason = element('p', 'recommendation-reason', candidate.recommendation.reason);
    actionPanel.append(reason);
  }
  actionPanel.append(actionLine);
  const context = renderContext(candidate, match => {
    switchMode(match);
    context.refresh(true);
    context.node.querySelector('.is-update-target .update-format')?.focus({ preventScroll: true });
    preview.scrollIntoView({ block: 'start' });
  });
  const preview = element('section', 'finding-preview');
  const previewTop = element('div', 'preview-top');
  previewTop.append(element('span', 'eyebrow', 'Импортируемый формат'));
  if (candidate.source.url) {
    const link = safeLink(candidate.source.url, 'Источник ↗', 'source-link');
    if (link) { link.title = candidate.source.label; previewTop.append(link); }
  }
  const previewTitle = element('h3', 'finding-title');
  const previewDescription = element('p', 'finding-description');
  const previewTags = element('div', 'preview-tags');
  const editButton = element('button', 'edit-finding', 'Редактировать');
  editButton.type = 'button';
  editButton.addEventListener('click', () => {
    editFinding = !editFinding;
    refreshView();
    if (editFinding) titleControl.focus();
    saveReview();
  });
  preview.append(previewTop, previewTitle, previewDescription, previewTags, editButton);

  const editor = element('div', 'editor');
  const editorTools = element('div', 'editor-tools');
  const editorLabel = element('h3', 'comparison-label');
  editorLabel.tabIndex = -1;
  const showAllButton = element('button', 'show-all-fields', 'Показать все поля');
  showAllButton.type = 'button';
  showAllButton.setAttribute('aria-controls', `fields-${index}`);
  showAllButton.addEventListener('click', () => {
    showAll = !showAll;
    if (!showAll) revealed.set(activeDraftKey, new Set());
    refreshView();
    saveReview();
  });
  const doneEditing = element('button', 'done-editing', 'Готово');
  doneEditing.type = 'button';
  doneEditing.addEventListener('click', () => { editFinding = false; refreshView(); editButton.focus(); saveReview(); });
  editorTools.append(editorLabel, showAllButton, doneEditing);
  const columns = element('div', 'field-columns');
  columns.setAttribute('aria-hidden', 'true');
  for (const label of ['Находка', 'В каталоге', 'Итог']) columns.append(element('span', '', label));
  const emptyChanges = element('p', 'empty-changes', 'Все поля совпадают. Покажите все поля, чтобы отредактировать формат.');
  const fields = element('div', 'fields-list');
  fields.id = `fields-${index}`;
  const groups = fieldGroups.map(group => ({ ...group, ...renderFieldGroup(group) }));
  for (const group of groups) fields.append(group.node);
  const fieldRows = new Map();
  let titleControl, error;
  const onEdit = key => {
    if (reviewModes.get(candidate.candidateId).action === 'update') {
      revealedFields().add(key);
      if (!edited.has(activeDraftKey)) edited.set(activeDraftKey, new Set());
      edited.get(activeDraftKey).add(key);
    }
    if (!selected.has(candidate.candidateId)) {
      setCandidateSelected(candidate.candidateId, true);
      updateSelection();
    }
    if (key === 'title') { titleControl.removeAttribute('aria-invalid'); error.hidden = true; }
    refreshView();
    saveReview();
  };
  const syncField = key => {
    const control = card.querySelector(`[name="${key}"]`);
    if (control) control.value = format[key] === null ? '' : String(format[key]);
    for (const refresh of tagPickers[key] ?? []) refresh();
  };
  for (const [key, label] of formatFields) {
    const row = element('section', 'review-field');
    row.dataset.field = key;
    const options = { flag: ['moderator', 'audienceOnStage', 'props'].includes(key), multiline: ['description', 'note', 'video'].includes(key) };
    const result = ['forms', 'features', 'collections'].includes(key)
      ? { wrapper: tagField(key, label, format, index, onEdit, resetTagEditors) }
      : field(key, label, format, index, onEdit, options);
    result.wrapper.classList.add('result-field');
    const caption = result.wrapper.querySelector('label');
    caption.classList.add('field-label');
    const fieldHeading = element('div', 'field-heading');
    const difference = element('span', 'field-difference', '≠ Различается');
    fieldHeading.append(caption, difference);
    row.append(fieldHeading);
    const origin = element('span', 'field-origin');
    result.wrapper.prepend(origin);
    const cells = element('div', 'field-comparison');
    const findingCell = element('div', 'finding-field');
    findingCell.dataset.findingField = key;
    findingCell.dataset.label = 'Находка';
    const findingValue = element('div', 'finding-value');
    const adding = ['forms', 'features', 'collections', 'video'].includes(key);
    const action = adding ? 'Добавить' : 'Заменить';
    const transfer = element('button', 'transfer-field', action);
    transfer.type = 'button';
    transfer.setAttribute('aria-label', `${action} из находки: ${label}`);
    transfer.title = adding ? 'Добавить отсутствующие значения к итогу' : 'Заменить это поле итога значением находки';
    transfer.addEventListener('click', () => {
      if (reviewModes.get(candidate.candidateId).action !== 'update') return;
      format[key] = reviewFieldTransfer(format, savedDrafts.get('create'), key);
      syncField(key);
      onEdit(key);
      status.textContent = `${label}: ${adding ? 'данные находки добавлены к итогу' : 'итог заменён значением находки'}.`;
    });
    findingCell.append(findingValue, transfer);
    const catalogCell = element('div', 'catalog-field');
    catalogCell.dataset.label = 'В каталоге';
    const catalogValue = element('div', 'catalog-value');
    const restore = element('button', 'transfer-field', 'Взять →');
    restore.type = 'button';
    restore.setAttribute('aria-label', `Взять из каталога: ${label}`);
    restore.addEventListener('click', () => {
      const mode = reviewModes.get(candidate.candidateId);
      if (mode.action !== 'update') return;
      const base = reviewUpdateBase(candidate.similarFormats.find(match => match.id === mode.targetId));
      format[key] = structuredClone(base[key]);
      syncField(key);
      onEdit(key);
    });
    catalogCell.append(catalogValue, restore);
    let videoPreview;
    if (key === 'video') {
      result.control.placeholder = 'Ссылка или ссылки на видео';
      videoPreview = element('div', 'video-preview');
      result.wrapper.append(videoPreview);
    }
    if (key === 'title') {
      titleControl = result.control;
      error = element('p', 'field-error', 'Укажите название формата');
      error.hidden = true;
      error.id = `title-error-${index}`;
      titleControl.setAttribute('aria-describedby', error.id);
      result.wrapper.append(error);
    }
    cells.append(findingCell, catalogCell, result.wrapper);
    row.append(cells);
    groups.find(group => group.fields.some(([field]) => field === key)).content.append(row);
    fieldRows.set(key, { row, refresh(updating, base, changed) {
      const finding = savedDrafts.get('create');
      const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
      const sameSources = !updating || equal(finding[key], base[key]);
      row.hidden = updating && !showAll && sameSources && !changed && !revealedFields().has(key);
      row.classList.toggle('is-different', updating && changed);
      findingCell.hidden = catalogCell.hidden = !updating;
      origin.hidden = true;
      difference.hidden = true;
      row.classList.remove('has-source-difference');
      if (updating) {
        const fromCatalog = equal(format[key], base[key]);
        const fromFinding = equal(format[key], finding[key]);
        const unchangedSources = sameSources && fromCatalog;
        const combined = adding && equal(format[key], reviewFieldTransfer(base, finding, key));
        const source = unchangedSources ? 'both' : fromCatalog ? 'catalog' : fromFinding ? 'finding' : combined ? 'combined'
          : edited.get(activeDraftKey)?.has(key) ? 'manual' : 'proposal';
        const origins = { manual: '✎ Ручная правка', proposal: '✦ Предложение' };
        row.dataset.resultSource = source;
        origin.textContent = origins[source] ?? '';
        origin.hidden = !Object.hasOwn(origins, source);
        origin.dataset.source = source;
        origin.title = source === 'proposal' ? 'Предложенное дополнение: отличается от обоих исходных значений' : origins[source] ?? '';
        findingCell.classList.toggle('is-used-source', fromFinding || source === 'combined');
        catalogCell.classList.toggle('is-used-source', fromCatalog || source === 'combined');
        difference.hidden = !changed && sameSources;
        row.classList.toggle('has-source-difference', !difference.hidden);
        if (key === 'video' && finding.video) renderVideoText(findingValue, finding.video);
        else findingValue.textContent = comparisonText(finding, key);
        if (key === 'video' && base.video) renderVideoText(catalogValue, base.video);
        else catalogValue.textContent = comparisonText(base, key);
        transfer.disabled = JSON.stringify(reviewFieldTransfer(format, finding, key)) === JSON.stringify(format[key]);
        transfer.hidden = unchangedSources;
        transfer.textContent = transfer.disabled && source === 'finding' ? '✓ В итоге'
          : transfer.disabled && source === 'combined' ? '✓ Добавлено' : `${action} →`;
        restore.disabled = fromCatalog;
        restore.hidden = unchangedSources;
        restore.textContent = fromCatalog ? '✓ В итоге' : 'Взять →';
      }
      if (videoPreview) renderVideoText(videoPreview, format.video);
    } });
  }
  editor.append(editorTools, columns, emptyChanges, fields);
  body.append(preview, editor, context.node, actionPanel);
  card.append(top, body);
  document.querySelector('#candidates').append(card);

  function resizeEditors() {
    if (body.hidden || editor.hidden) return;
    for (const textarea of fields.querySelectorAll('textarea')) {
      if (textarea.closest('.review-field').hidden) continue;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight + 2, 480)}px`;
    }
  }

  function refreshView() {
    const mode = reviewModes.get(candidate.candidateId);
    const updating = mode.action === 'update';
    const target = updating ? candidate.similarFormats.find(match => match.id === mode.targetId) : null;
    const base = target ? reviewUpdateBase(target) : null;
    const changes = base ? reviewFormatChanges(base, format) : {};
    if (updating && context.node.nextElementSibling !== editor) body.insertBefore(context.node, editor);
    if (!updating && editor.nextElementSibling !== context.node) body.insertBefore(editor, context.node);
    card.classList.toggle('is-update', updating);
    card.classList.toggle('is-create', !updating);
    actionTitle.textContent = updating ? `Обновить «${target.title}»` : '';
    actionTitle.hidden = !updating;
    changeCount.hidden = !updating;
    changeCount.textContent = `Изменено полей: ${Object.keys(changes).length}`;
    actionPanel.hidden = false;
    editorLabel.textContent = updating ? 'Сравнение полей' : 'Редактирование';
    showAllButton.hidden = columns.hidden = !updating;
    doneEditing.hidden = updating;
    showAllButton.textContent = showAll ? 'Только различия' : 'Показать все поля';
    showAllButton.setAttribute('aria-expanded', String(showAll));
    const editing = updating || editFinding;
    editor.hidden = !editing;
    preview.hidden = editFinding && !updating;
    editButton.hidden = updating || editFinding;
    editButton.setAttribute('aria-expanded', String(editFinding));
    const finding = updating ? savedDrafts.get('create') : format;
    previewTitle.textContent = finding.title || 'Формат без названия';
    previewDescription.textContent = finding.description || 'Описания пока нет';
    previewTags.replaceChildren();
    for (const key of ['forms', 'features', 'collections']) {
      for (const tag of finding[key]) previewTags.append(element('span', 'preview-tag', tag));
    }
    refreshDecision();
    for (const [key, field] of fieldRows) field.refresh(updating, base, Object.hasOwn(changes, key));
    for (const group of groups) group.node.hidden = group.fields.every(([key]) => fieldRows.get(key).row.hidden);
    emptyChanges.hidden = !updating || [...fieldRows.values()].some(field => !field.row.hidden);
    updateDisclosure();
    context.refresh();
    resizeEditors();
  }
  function refreshDecision() {
    const isSelected = selected.has(candidate.candidateId);
    const updating = reviewModes.get(candidate.candidateId).action === 'update';
    returnToCreate.hidden = isSelected && !updating;
    returnToCreate.textContent = candidate.similarFormats?.length ? 'Добавить как новый' : 'Добавить';
    skipButton.hidden = !isSelected;
    skipButton.textContent = 'Снять выбор';
    decisionSummary.textContent = isSelected ? (updating ? '✓ Обновление выбрано' : '✓ Добавление выбрано') : 'Не выбрано';
    decisionSummary.classList.toggle('is-included', isSelected);
    card.dataset.decision = isSelected ? (updating ? 'update' : 'create') : 'skip';
    checkbox.title = isSelected ? (updating ? 'Выбрано обновление' : 'Выбрано добавление') : 'Не выбрано';
  }
  function switchMode(match) {
    const key = match ? `update:${match.id}` : 'create';
    if (key === activeDraftKey) { editFinding = true; refreshView(); saveReview(); return; }
    let base;
    try { base = match ? reviewUpdateBase(match) : candidate.format; }
    catch (problem) { status.textContent = reviewErrorText(problem); return; }
    savedDrafts.set(activeDraftKey, structuredClone(format));
    Object.assign(format, structuredClone(savedDrafts.get(key) ?? base));
    activeDraftKey = key;
    showAll = false;
    editFinding = true;
    reviewModes.set(candidate.candidateId, match ? { action: 'update', targetId: match.id } : { action: 'create' });
    for (const key of Object.keys(format)) syncField(key);
    titleControl.removeAttribute('aria-invalid');
    error.hidden = true;
    refreshView();
    status.textContent = '';
    updateSelection();
  }
  views.set(candidate.candidateId, { titleControl, error, card, checkbox, body, setExpanded, resizeEditors, refreshDecision,
    savedState() {
      const allDrafts = new Map(savedDrafts);
      allDrafts.set(activeDraftKey, format);
      return { candidateId: candidate.candidateId, selected: selected.has(candidate.candidateId), activeKey: activeDraftKey,
        drafts: [...allDrafts], edited: [...edited].map(([key, fields]) => [key, [...fields]]),
        revealed: [...revealed].map(([key, fields]) => [key, [...fields]]),
        expanded: !body.hidden, editFinding, showAll,
      };
    },
    reset({ keepExpanded = false } = {}) {
      const expanded = keepExpanded && !body.hidden;
      const initial = initialStates.get(candidate.candidateId);
      reviewModes.set(candidate.candidateId, structuredClone(initial.mode));
      activeDraftKey = initial.mode.action === 'update' ? `update:${initial.mode.targetId}` : 'create';
      savedDrafts.clear();
      savedDrafts.set('create', structuredClone(candidate.format));
      Object.assign(format, structuredClone(initial.format));
      edited.clear();
      revealed.clear();
      showAll = editFinding = false;
      for (const reset of resetTagEditors) reset();
      for (const key of Object.keys(format)) syncField(key);
      for (const [index, match] of [...context.node.querySelectorAll('.match')].entries()) {
        match.open = index === 0;
        match.querySelector('.snapshot-details').open = false;
      }
      setCandidateSelected(candidate.candidateId, initial.selected);
      setExpanded(expanded);
      refreshView();
    },
    showField(key) {
      editFinding = true;
      revealedFields().add(key);
      if (card.hidden) setCategory('all');
      setExpanded(true);
      refreshView();
    },
  });
  checkbox.addEventListener('change', () => {
    setCandidateSelected(candidate.candidateId, checkbox.checked);
    updateSelection();
  });
  setCandidateSelected(candidate.candidateId, selected.has(candidate.candidateId));
  refreshView();
  if (restored?.expanded) setExpanded(true);
}

const categories = [
  ['all', 'Все', ''], ['create', 'Добавить', '+'], ['update', 'Обновить', '↻'],
  ['review', 'Проверить', '?'], ['duplicate', 'Дубли', '='], ['skip', 'Пропустить', '−'],
];
function setCategory(category) {
  activeCategory = category;
  for (const candidate of reviewBatch.candidates) {
    views.get(candidate.candidateId).card.hidden = category !== 'all' && (candidate.recommendation?.action ?? 'review') !== category;
  }
  for (const button of document.querySelectorAll('.category-filter')) button.setAttribute('aria-pressed', String(button.dataset.category === category));
  updateSelection();
  updateExpansionActions();
}
for (const [category, label, icon] of categories) {
  const count = category === 'all' ? reviewBatch.candidates.length
    : reviewBatch.candidates.filter(candidate => (candidate.recommendation?.action ?? 'review') === category).length;
  if (!count && category !== 'all') continue;
  const button = element('button', 'category-filter');
  button.type = 'button';
  button.dataset.category = category;
  button.setAttribute('aria-pressed', String(category === activeCategory));
  if (icon) { const mark = element('span', 'category-icon', icon); mark.setAttribute('aria-hidden', 'true'); button.append(mark); }
  button.append(document.createTextNode(label), element('span', 'category-count', String(count)));
  button.addEventListener('click', () => setCategory(category));
  document.querySelector('#category-filters').append(button);
}

document.querySelector('#select-all').addEventListener('click', () => {
  for (const view of visibleViews()) setCandidateSelected(view.card.dataset.candidateId, true);
  updateSelection();
});
document.querySelector('#clear-selection').addEventListener('click', () => {
  for (const view of visibleViews()) setCandidateSelected(view.card.dataset.candidateId, false);
  updateSelection();
});
document.querySelector('#expand-all').addEventListener('click', () => {
  for (const view of visibleViews()) view.setExpanded(true);
});
document.querySelector('#collapse-all').addEventListener('click', () => {
  for (const view of visibleViews()) view.setExpanded(false);
});

const widthHandle = document.querySelector('#review-width-handle');
const reviewShell = document.querySelector('main.shell');
const widthStorageKey = 'format-review-width';
let preferredWidth = 1054;
let widthDrag;
try {
  const saved = Number(localStorage.getItem(widthStorageKey));
  if (Number.isFinite(saved) && saved > 0) preferredWidth = saved;
} catch { /* File previews can disable local storage. */ }
const widthLimits = () => {
  const max = Math.max(0, document.documentElement.clientWidth - 32);
  return { min: Math.min(760, max), max };
};
function applyReviewWidth() {
  const { min, max } = widthLimits();
  const width = Math.max(min, Math.min(max, preferredWidth));
  document.documentElement.style.setProperty('--review-width', `${width}px`);
  widthHandle.setAttribute('aria-valuemin', String(min));
  widthHandle.setAttribute('aria-valuemax', String(max));
  widthHandle.setAttribute('aria-valuenow', String(width));
  widthHandle.setAttribute('aria-valuetext', `${Math.round(width)} пикселей`);
  for (const view of views.values()) view.resizeEditors();
}
function saveReviewWidth() {
  try { localStorage.setItem(widthStorageKey, String(preferredWidth)); }
  catch { /* Resizing still works without persistent storage. */ }
}
widthHandle.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  widthDrag = { x: event.clientX, width: reviewShell.getBoundingClientRect().width };
  widthHandle.setPointerCapture(event.pointerId);
  widthHandle.focus({ preventScroll: true });
  document.body.classList.add('is-resizing');
  event.preventDefault();
});
widthHandle.addEventListener('pointermove', event => {
  if (!widthDrag) return;
  const { min, max } = widthLimits();
  preferredWidth = Math.max(min, Math.min(max, widthDrag.width + 2 * (event.clientX - widthDrag.x)));
  applyReviewWidth();
});
widthHandle.addEventListener('lostpointercapture', () => {
  widthDrag = undefined;
  document.body.classList.remove('is-resizing');
  saveReviewWidth();
});
widthHandle.addEventListener('dblclick', () => {
  preferredWidth = 1054;
  applyReviewWidth();
  saveReviewWidth();
});
widthHandle.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const { min, max } = widthLimits();
  const current = reviewShell.getBoundingClientRect().width;
  preferredWidth = event.key === 'Home' ? min : event.key === 'End' ? max
    : Math.max(min, Math.min(max, current + (event.key === 'ArrowLeft' ? -20 : 20)));
  applyReviewWidth();
  saveReviewWidth();
  event.preventDefault();
});
window.addEventListener('resize', applyReviewWidth);
applyReviewWidth();

function rememberPointer(event) {
  pointerPosition = event.pointerType === 'mouse' || event.pointerType === 'pen'
    ? { x: event.clientX, y: event.clientY } : undefined;
}
document.addEventListener('pointermove', rememberPointer, { passive: true });
document.addEventListener('pointerdown', rememberPointer, { passive: true });
document.documentElement.addEventListener('pointerleave', () => { pointerPosition = undefined; });
window.addEventListener('blur', () => { pointerPosition = undefined; });
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || event.isComposing
    || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || manualDialog.open || resetDialog.open || widthDrag) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && (active.isContentEditable
    || active.matches('textarea, select, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset])'))) return;
  const key = event.code || `Key${event.key.toUpperCase()}`;
  if (!['KeyC', 'KeyS'].includes(key) || !pointerPosition) return;
  const card = document.elementFromPoint(pointerPosition.x, pointerPosition.y)?.closest('.candidate');
  const view = card ? views.get(card.dataset.candidateId) : null;
  if (!view) return;
  event.preventDefault();
  if (key === 'KeyC') view.setExpanded(view.body.hidden);
  else {
    setCandidateSelected(card.dataset.candidateId, !selected.has(card.dataset.candidateId));
    updateSelection();
  }
});

async function copySelection(kind, button) {
  const exportIds = kind === 'sheet'
    ? new Set([...selected].filter(id => reviewModes.get(id)?.action !== 'update')) : selected;
  let firstInvalid;
  for (const id of exportIds) {
    const view = views.get(id);
    const invalid = !drafts.get(id).title.trim();
    view.error.hidden = !invalid;
    if (invalid) {
      view.titleControl.setAttribute('aria-invalid', 'true');
      firstInvalid ??= view;
    } else view.titleControl.removeAttribute('aria-invalid');
  }
  if (firstInvalid) {
    status.textContent = 'Заполните название у выбранных форматов.';
    firstInvalid.showField('title');
    firstInvalid.titleControl.focus();
    return;
  }
  let selection;
  try { selection = createReviewSelection(reviewBatch, exportIds, drafts, reviewModes); }
  catch (error) { status.textContent = reviewErrorText(error); return; }
  const text = kind === 'sheet' ? reviewSelectionToTsv(selection) : JSON.stringify(selection, null, 2);
  copying = true;
  updateSelection();
  status.textContent = '';
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    status.textContent = kind === 'sheet' ? 'Скопировано. Вставьте строки в таблицу начиная с колонки A.'
      : 'Скопировано. Передайте выбранные форматы агенту.';
  } catch {
    lastCopyButton = button;
    document.querySelector('#manual-title').textContent = kind === 'sheet' ? 'Новые форматы для таблицы' : 'Форматы для агента';
    document.querySelector('#manual-tip').textContent = kind === 'sheet'
      ? 'Вставляйте в первую пустую строку, начиная с колонки A. Без заголовка.'
      : 'Вставьте этот JSON в сообщение агенту вместе с вашим поручением.';
    const field = document.querySelector('#manual-text');
    field.value = text;
    manualDialog.showModal();
    field.focus();
    field.select();
  } finally {
    copying = false;
    updateSelection();
  }
}

document.querySelector('#close-manual').addEventListener('click', () => manualDialog.close());
manualDialog.addEventListener('close', () => lastCopyButton?.focus());
agentButton.addEventListener('click', () => copySelection('agent', agentButton));
sheetButton.addEventListener('click', () => copySelection('sheet', sheetButton));
document.querySelector('#reset-review').disabled = reviewBatch.candidates.length === 0;
function openResetDialog(trigger, candidate = null) {
  pendingReset = { trigger, candidate };
  document.querySelector('#reset-title').textContent = candidate ? 'Сбросить правки формата?' : 'Сбросить правки?';
  document.querySelector('#reset-help').textContent = candidate
    ? `«${candidate.format.title || 'Формат без названия'}»: поля, все черновики и выбор вернутся к исходным значениям. Остальные форматы сохранят свои правки.`
    : 'Все поля и выбор форматов в этой подборке вернутся к исходным значениям. Сохранённые правки будут удалены.';
  resetDialog.showModal();
}
document.querySelector('#reset-review').addEventListener('click', event => openResetDialog(event.currentTarget));
document.querySelector('#cancel-reset').addEventListener('click', () => resetDialog.close());
resetDialog.addEventListener('close', () => {
  const trigger = pendingReset?.trigger;
  const focusTarget = trigger?.hidden ? trigger.closest('.candidate')?.querySelector('.card-title-button') : trigger;
  focusTarget?.focus({ preventScroll: true });
});
document.querySelector('#confirm-reset').addEventListener('click', () => {
  if (pendingReset?.candidate) {
    persistenceReady = false;
    views.get(pendingReset.candidate.candidateId).reset({ keepExpanded: true });
    persistenceReady = true;
    updateSelection();
    resetDialog.close();
    return;
  }
  try { localStorage.removeItem(draftStorageKey); }
  catch {
    showSaveStatus('Не удалось удалить сохранённые правки. Сброс не выполнен.', true);
    resetDialog.close();
    return;
  }
  persistenceReady = false;
  storageBlocked = unsavedChanges = false;
  lastStoredValue = null;
  const originalOptions = reviewClassificationOptions(reviewBatch);
  for (const key of Object.keys(classificationOptions)) classificationOptions[key] = originalOptions[key];
  for (const view of views.values()) view.reset();
  setCategory('all');
  persistenceReady = true;
  showSaveStatus('✓ Исходные значения восстановлены');
  resetDialog.close();
});
window.addEventListener('beforeunload', event => {
  if (!unsavedChanges) return;
  event.preventDefault();
  event.returnValue = '';
});
window.addEventListener('storage', event => {
  if (event.key !== draftStorageKey && event.key !== null) return;
  if (event.newValue === lastStoredValue && event.key !== null) return;
  storageBlocked = true;
  showSaveStatus('Правки изменены в другой вкладке. Перезагрузите страницу, чтобы восстановить их.', true);
});
if (restoredReview) setCategory(restoredReview.category);
updateSelection();
updateExpansionActions();
persistenceReady = true;
