const reviewBatch = parseReviewBatch(JSON.parse(document.querySelector('#review-data').textContent));
document.querySelector('#batch-title').textContent = reviewBatch.title || 'Находки для каталога';
document.querySelector('#batch-size').textContent = String(reviewBatch.candidates.length);
document.querySelector('#empty').hidden = reviewBatch.candidates.length > 0;
document.title = `${reviewBatch.title || 'Ревью форматов'} · Что сыграем?`;

const initialStates = new Map(reviewBatch.candidates.map(candidate => [candidate.candidateId, reviewInitialState(candidate)]));
const selected = new Set([...initialStates].filter(([, state]) => state.selected).map(([id]) => id));
const drafts = new Map([...initialStates].map(([id, state]) => [id, state.format]));
const views = new Map();
const reviewModes = new Map([...initialStates].map(([id, state]) => [id, state.mode]));
const classificationOptions = reviewClassificationOptions(reviewBatch);
const tagPickers = { forms: [], features: [], collections: [] };
const status = document.querySelector('#status');
const agentButton = document.querySelector('#copy-agent');
const sheetButton = document.querySelector('#copy-sheet');
const manualDialog = document.querySelector('#manual-copy');
let copying = false;
let lastCopyButton;
let pointerPosition;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function reviewErrorText(error) {
  return error instanceof ReviewDataError ? error.message.slice(error.path.length + 2) : error.message;
}

function updateSelection() {
  const newCount = [...selected].filter(id => reviewModes.get(id)?.action !== 'update').length;
  document.querySelector('#selection-count').textContent = `Выбрано: ${selected.size} из ${reviewBatch.candidates.length}`;
  agentButton.disabled = copying || selected.size === 0;
  sheetButton.disabled = copying || newCount === 0;
  sheetButton.textContent = `Скопировать новые для таблицы (${newCount})`;
  document.querySelector('#select-all').disabled = selected.size === reviewBatch.candidates.length;
  document.querySelector('#clear-selection').disabled = selected.size === 0;
}

function setCandidateSelected(id, value) {
  const view = views.get(id);
  if (value) selected.add(id);
  else selected.delete(id);
  view.checkbox.checked = value;
  view.card.classList.toggle('is-selected', value);
  view.error.hidden = true;
  view.titleControl.removeAttribute('aria-invalid');
  status.textContent = '';
}

function updateExpansionActions() {
  const bodies = [...views.values()].map(view => view.body);
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

function tagField(key, label, format, index, onEdit) {
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
  const cancelCreation = () => {
    creator.hidden = true;
    select.hidden = false;
    input.value = '';
    select.value = '';
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

function renderSource(candidate) {
  const source = element('details', 'source-details');
  source.append(element('summary', '', 'Исходник'));
  const content = element('div', 'source-content');
  content.append(element('p', 'source-label', candidate.source.label));
  if (candidate.source.url) {
    content.append(safeLink(candidate.source.url, 'Открыть источник ↗', 'source-link')
      ?? element('p', 'muted', candidate.source.url));
  }
  if (candidate.source.text) {
    content.append(element('p', 'source-text', candidate.source.text));
  }
  source.append(content);
  return source;
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

function formatLink(match) {
  const url = new URL('https://impro-formats.vercel.app/');
  url.searchParams.set('format', match.id);
  return safeLink(match.url || url.href, 'Открыть формат ↗', 'format-link');
}

function renderContext(candidate, onUpdate) {
  if (!candidate.similarFormats?.length) {
    return { node: element('p', 'match-empty muted', 'Агент не передал похожие форматы.'), refresh() {} };
  }
  const context = element('details', 'context');
  context.setAttribute('aria-label', 'Существующие форматы в каталоге');
  const summary = element('summary');
  context.append(summary);
  const refreshers = [];
  for (const match of candidate.similarFormats) {
    const box = element('details', 'match');
    box.dataset.formatId = match.id;
    const matchSummary = element('summary', 'match-summary');
    matchSummary.append(element('span', 'match-title', match.title), element('span', 'match-excerpt', match.description));
    const matchBody = element('div', 'match-body');
    box.append(matchSummary, matchBody);
    const actions = element('div', 'match-actions');
    const update = element('button', 'update-format', '← Обновить этот формат');
    update.type = 'button';
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
    matchBody.append(actions, element('p', 'match-id', `ID: ${match.id}`));
    const reason = element('div', 'match-reason');
    reason.append(element('h5', '', 'Агент: почему похоже'), element('p', 'reason', match.reason));
    matchBody.append(reason);
    const snapshot = element('div', 'snapshot');
    for (const group of fieldGroups) {
      const section = renderFieldGroup(group, true);
      for (const [key, label] of group.fields) {
        const field = element('div', 'snapshot-field');
        field.dataset.field = key;
        const value = element('dd', 'catalog-value readonly-value');
        if (key === 'description') value.classList.add('match-description');
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
    matchBody.append(snapshot);
    context.append(box);
    refreshers.push(() => {
      const active = reviewModes.get(candidate.candidateId)?.targetId === match.id;
      box.classList.toggle('is-update-target', active);
      update.setAttribute('aria-pressed', String(active));
    });
  }
  return { node: context, refresh() {
    const mode = reviewModes.get(candidate.candidateId);
    summary.textContent = mode.action === 'update'
      ? `Полный формат в каталоге${candidate.similarFormats.length > 1 ? ' / сменить цель' : ''}`
      : `Похожие форматы (${candidate.similarFormats.length})`;
    for (const refresh of refreshers) refresh();
  } };
}

for (const [index, candidate] of reviewCandidatesByRecommendation(reviewBatch.candidates).entries()) {
  const format = drafts.get(candidate.candidateId);
  const savedDrafts = new Map([['create', structuredClone(candidate.format)]]);
  const initialMode = reviewModes.get(candidate.candidateId);
  let activeDraftKey = initialMode.action === 'update' ? `update:${initialMode.targetId}` : 'create';
  let showAll = false;
  let editFinding = !['duplicate', 'skip'].includes(candidate.recommendation?.action);
  const revealed = new Map();
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
    ? `Агент: ${candidate.recommendation.reason}` : candidate.format.description);
  titleGroup.append(heading, cardSummary);
  const body = element('div', 'card-body');
  body.id = `format-body-${index}`;
  body.hidden = true;
  const disclosure = element('button', 'card-toggle', '▾');
  disclosure.type = 'button';
  disclosure.setAttribute('aria-keyshortcuts', 'C');
  disclosure.setAttribute('aria-controls', body.id);
  const headerTitle = () => reviewModes.get(candidate.candidateId).action === 'update' ? savedDrafts.get('create').title : format.title;
  const updateDisclosure = () => {
    const title = headerTitle() || 'Формат без названия';
    heading.textContent = title;
    checkbox.setAttribute('aria-label', `Выбрать формат ${title}`);
    disclosure.setAttribute('aria-expanded', String(!body.hidden));
    disclosure.setAttribute('aria-label', `${body.hidden ? 'Развернуть' : 'Свернуть'} формат ${title}`);
    disclosure.title = `${body.hidden ? 'Развернуть' : 'Свернуть'} формат (C)`;
  };
  const setExpanded = expanded => {
    if (!expanded && body.contains(document.activeElement)) disclosure.focus({ preventScroll: true });
    body.hidden = !expanded;
    card.classList.toggle('is-collapsed', !expanded);
    updateDisclosure();
    resizeEditors();
    updateExpansionActions();
  };
  disclosure.addEventListener('click', () => setExpanded(body.hidden));
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

  const actionPanel = element('div', 'review-action');
  const actionLine = element('div', 'action-line');
  const actionTitle = element('strong');
  const changeCount = element('span', 'update-change-count');
  const targetLink = element('span', 'target-link');
  const returnToCreate = element('button', 'return-to-create', 'Добавить как новый');
  returnToCreate.type = 'button';
  returnToCreate.addEventListener('click', () => switchMode(null));
  actionLine.append(actionTitle, changeCount, targetLink, returnToCreate);
  actionPanel.append(actionLine);
  if (candidate.recommendation) {
    const reason = element('p', 'recommendation-reason');
    reason.append(element('strong', '', 'Агент: '), document.createTextNode(candidate.recommendation.reason));
    actionPanel.append(reason);
  }
  const context = renderContext(candidate, match => switchMode(match));
  const preview = element('div', 'finding-preview');
  preview.append(element('p', 'readonly-label', 'Описание находки'), element('p', 'finding-description', candidate.format.description));
  const editButton = element('button', 'edit-finding', 'Показать поля находки');
  editButton.type = 'button';
  editButton.addEventListener('click', () => { editFinding = true; refreshView(); });
  preview.append(editButton);

  const editor = element('div', 'editor');
  const editorTools = element('div', 'editor-tools');
  const editorLabel = element('h3', 'comparison-label');
  const showAllButton = element('button', 'show-all-fields', 'Показать все поля');
  showAllButton.type = 'button';
  showAllButton.setAttribute('aria-controls', `fields-${index}`);
  showAllButton.addEventListener('click', () => {
    showAll = !showAll;
    if (!showAll) revealed.set(activeDraftKey, new Set());
    refreshView();
  });
  editorTools.append(editorLabel, showAllButton);
  const columns = element('div', 'field-columns');
  columns.setAttribute('aria-hidden', 'true');
  for (const label of ['Находка', 'В каталоге', 'Итог']) columns.append(element('span', '', label));
  const emptyChanges = element('p', 'empty-changes', 'Пока нет изменений. Покажите все поля, чтобы дополнить формат.');
  const fields = element('div', 'fields-list');
  fields.id = `fields-${index}`;
  const groups = fieldGroups.map(group => ({ ...group, ...renderFieldGroup(group) }));
  for (const group of groups) fields.append(group.node);
  const fieldRows = new Map();
  let titleControl, error;
  const onEdit = key => {
    if (reviewModes.get(candidate.candidateId).action === 'update') revealedFields().add(key);
    if (!selected.has(candidate.candidateId)) {
      setCandidateSelected(candidate.candidateId, true);
      updateSelection();
    }
    if (key === 'title') { titleControl.removeAttribute('aria-invalid'); error.hidden = true; }
    refreshView();
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
      ? { wrapper: tagField(key, label, format, index, onEdit) }
      : field(key, label, format, index, onEdit, options);
    result.wrapper.classList.add('result-field');
    const caption = result.wrapper.querySelector('label');
    caption.classList.add('field-label');
    row.append(caption);
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
    const catalogValue = element('div', 'catalog-value');
    catalogValue.dataset.label = 'В каталоге';
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
    cells.append(findingCell, catalogValue, result.wrapper);
    row.append(cells);
    groups.find(group => group.fields.some(([field]) => field === key)).content.append(row);
    fieldRows.set(key, { row, refresh(updating, base, changed) {
      row.hidden = updating && !showAll && !changed && !revealedFields().has(key);
      row.classList.toggle('is-different', updating && changed);
      findingCell.hidden = catalogValue.hidden = !updating;
      if (updating) {
        const finding = savedDrafts.get('create');
        if (key === 'video' && finding.video) renderVideoText(findingValue, finding.video);
        else findingValue.textContent = comparisonText(finding, key);
        if (key === 'video' && base.video) renderVideoText(catalogValue, base.video);
        else catalogValue.textContent = comparisonText(base, key);
        transfer.disabled = JSON.stringify(reviewFieldTransfer(format, finding, key)) === JSON.stringify(format[key]);
      }
      if (videoPreview) renderVideoText(videoPreview, format.video);
    } });
  }
  editor.append(editorTools, columns, emptyChanges, fields);
  body.append(actionPanel, renderSource(candidate), context.node, preview, editor);
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
    card.classList.toggle('is-update', updating);
    card.classList.toggle('is-create', !updating);
    actionTitle.textContent = updating ? `🔄 Обновить «${target.title}»` : '';
    actionTitle.hidden = !updating;
    changeCount.hidden = returnToCreate.hidden = !updating;
    changeCount.textContent = `Изменено полей: ${Object.keys(changes).length}`;
    targetLink.replaceChildren();
    const linkedTarget = target ?? candidate.similarFormats?.find(match => match.id === candidate.recommendation?.targetId);
    const link = linkedTarget ? formatLink(linkedTarget) : null;
    if (link) targetLink.append(link);
    actionLine.hidden = !updating && !link;
    actionPanel.hidden = actionLine.hidden && !candidate.recommendation;
    editorLabel.textContent = updating ? 'Изменения формата' : 'Черновик для каталога';
    showAllButton.hidden = columns.hidden = !updating;
    showAllButton.textContent = showAll ? 'Только изменения' : 'Показать все поля';
    showAllButton.setAttribute('aria-expanded', String(showAll));
    const editing = updating || editFinding;
    editor.hidden = !editing;
    preview.hidden = editing;
    for (const [key, field] of fieldRows) field.refresh(updating, base, Object.hasOwn(changes, key));
    for (const group of groups) group.node.hidden = group.fields.every(([key]) => fieldRows.get(key).row.hidden);
    emptyChanges.hidden = !updating || [...fieldRows.values()].some(field => !field.row.hidden);
    updateDisclosure();
    context.refresh();
    resizeEditors();
  }
  function switchMode(match) {
    const key = match ? `update:${match.id}` : 'create';
    if (key === activeDraftKey) return;
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
  views.set(candidate.candidateId, { titleControl, error, card, checkbox, body, setExpanded, resizeEditors,
    showField(key) {
      editFinding = true;
      revealedFields().add(key);
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
}

document.querySelector('#select-all').addEventListener('click', () => {
  for (const candidate of reviewBatch.candidates) setCandidateSelected(candidate.candidateId, true);
  updateSelection();
});
document.querySelector('#clear-selection').addEventListener('click', () => {
  for (const candidate of reviewBatch.candidates) setCandidateSelected(candidate.candidateId, false);
  updateSelection();
});
document.querySelector('#expand-all').addEventListener('click', () => {
  for (const view of views.values()) view.setExpanded(true);
});
document.querySelector('#collapse-all').addEventListener('click', () => {
  for (const view of views.values()) view.setExpanded(false);
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
    || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || manualDialog.open || widthDrag) return;
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
updateSelection();
updateExpansionActions();
