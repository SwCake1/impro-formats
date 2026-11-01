const reviewBatch = parseReviewBatch(JSON.parse(document.querySelector('#review-data').textContent));
document.querySelector('#batch-title').textContent = reviewBatch.title || 'Находки для каталога';
document.querySelector('#batch-size').textContent = String(reviewBatch.candidates.length);
document.querySelector('#empty').hidden = reviewBatch.candidates.length > 0;
document.title = `${reviewBatch.title || 'Ревью форматов'} · Что сыграем?`;

const selected = new Set();
const drafts = new Map(reviewBatch.candidates.map(candidate => [candidate.candidateId, structuredClone(candidate.format)]));
const views = new Map();
const reviewModes = new Map();
const classificationOptions = reviewClassificationOptions(reviewBatch);
const tagPickers = { forms: [], features: [], collections: [] };
const status = document.querySelector('#status');
const agentButton = document.querySelector('#copy-agent');
const sheetButton = document.querySelector('#copy-sheet');
const manualDialog = document.querySelector('#manual-copy');
let copying = false;
let lastCopyButton;

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
  view.pickText.textContent = value ? 'Выбран' : 'Выбрать';
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
  source.append(element('summary', '', 'Исходный текст и источник'));
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

const comparisonFields = [
  ['id', 'ID'], ['moderator', 'Модератор'], ['audienceOnStage', 'Зритель на сцене'], ['props', 'Реквизит'],
  ['furniture', 'Мебель'], ['forms', 'Форма'], ['features', 'Особенности'], ['collections', 'Подборки'],
  ['note', 'Дополнительно'], ['video', 'Видео'],
];

function comparisonText(record, key) {
  if (key === 'id' && record.id === undefined) return '—';
  if (record[key] === undefined) return 'Не передано';
  if (record[key] === null) return 'Неизвестно';
  if (typeof record[key] === 'boolean') return record[key] ? 'Да' : 'Нет';
  if (Array.isArray(record[key])) return record[key].join(', ') || 'Не указано';
  return record[key] || 'Не указано';
}

function comparable(value) {
  return JSON.stringify(Array.isArray(value) ? [...value].sort() : typeof value === 'string' ? value.trim() : value);
}

function renderContext(candidate, draft, onUpdate) {
  const context = element('aside', 'context');
  const refreshers = [];
  context.setAttribute('aria-label', 'Существующие форматы в каталоге');
  context.append(element('h3', 'comparison-label', 'В каталоге'));
  if (!candidate.similarFormats?.length) {
    context.append(element('p', 'muted', 'Агент не передал похожие форматы.'));
  } else {
    for (const match of candidate.similarFormats) {
      const box = element('section', 'match');
      box.dataset.formatId = match.id;
      const url = new URL('https://impro-formats.vercel.app/');
      url.searchParams.set('format', match.id);
      const link = safeLink(match.url || url.href, 'Открыть формат ↗', 'format-link');
      const reason = element('div', 'match-reason');
      reason.append(element('h5', '', 'Почему может совпадать'), element('p', 'reason', match.reason));
      box.append(element('h4', '', match.title));
      const update = element('button', 'update-format', '← Обновить этот формат');
      update.type = 'button';
      try {
        reviewUpdateBase(match);
        if (candidate.similarFormats.filter(other => other.id === match.id).length !== 1) {
          throw new Error('Для обновления нужен один снимок записи с этим id.');
        }
      } catch (error) {
        update.disabled = true;
        update.title = reviewErrorText(error);
        box.append(element('p', 'missing-value update-unavailable', 'Для обновления нужен полный снимок полей.'));
      }
      update.addEventListener('click', () => onUpdate(match));
      box.append(update);
      if (link) box.append(link);
      const refreshMode = () => {
        const mode = reviewModes.get(candidate.candidateId);
        const active = mode?.action === 'update' && mode.targetId === match.id;
        box.classList.toggle('is-update-target', active);
        update.setAttribute('aria-pressed', String(active));
      };
      refreshers.push(refreshMode);
      refreshMode();
      box.append(element('p', 'readonly-label', 'Описание в каталоге'), element('p', 'match-description', match.description), reason);
      const table = element('table', 'comparison-table');
      table.append(element('caption', '', 'Сравнение полей'));
      const head = element('thead');
      const labels = element('tr');
      for (const label of ['Поле', 'Черновик', 'В каталоге']) labels.append(element('th', '', label));
      head.append(labels);
      const rows = element('tbody');
      for (const [key, label] of comparisonFields) {
        const row = element('tr');
        row.dataset.field = key;
        const caption = element('th', '', label);
        caption.scope = 'row';
        const incoming = element('td', 'draft-value');
        const existing = element('td', 'catalog-value');
        if (key === 'video' && match.video) renderVideoText(existing, match.video);
        else existing.textContent = comparisonText(match, key);
        existing.classList.toggle('missing-value', match[key] === undefined && key !== 'id');
        const refresh = () => {
          if (key === 'id') incoming.textContent = reviewModes.get(candidate.candidateId)?.targetId ?? '—';
          else if (key === 'video' && draft.video) renderVideoText(incoming, draft.video);
          else incoming.textContent = comparisonText(draft, key);
          const different = key !== 'id' && match[key] !== undefined && comparable(draft[key]) !== comparable(match[key]);
          row.classList.toggle('is-different', different);
          row.title = different ? 'Значения отличаются' : '';
        };
        refreshers.push(refresh);
        refresh();
        row.append(caption, incoming, existing);
        rows.append(row);
      }
      table.append(head, rows);
      box.append(table);
      context.append(box);
    }
  }
  return { node: context, refresh: () => refreshers.forEach(refresh => refresh()) };
}

for (const [index, candidate] of reviewBatch.candidates.entries()) {
  const format = drafts.get(candidate.candidateId);
  const savedDrafts = new Map([['create', structuredClone(format)]]);
  let activeDraftKey = 'create';
  const card = element('article', 'candidate');
  card.dataset.candidateId = candidate.candidateId;
  const top = element('div', 'card-top');
  const heading = element('h2', 'sr-only', format.title || 'Формат без названия');
  heading.id = `heading-${index}`;
  card.setAttribute('aria-labelledby', heading.id);
  const pick = element('label', 'pick');
  const checkbox = element('input');
  checkbox.type = 'checkbox';
  checkbox.setAttribute('aria-label', `Выбрать формат ${format.title || index + 1}`);
  const pickText = element('span', '', 'Выбрать');
  pick.append(checkbox, pickText);

  const body = element('div', 'card-body');
  body.id = `format-body-${index}`;
  const disclosure = element('button', 'card-toggle', '▾');
  disclosure.type = 'button';
  disclosure.setAttribute('aria-controls', body.id);
  const updateDisclosure = () => {
    disclosure.setAttribute('aria-expanded', String(!body.hidden));
    disclosure.setAttribute('aria-label', `${body.hidden ? 'Развернуть' : 'Свернуть'} формат ${format.title || index + 1}`);
    disclosure.title = body.hidden ? 'Развернуть формат' : 'Свернуть формат';
  };
  const setExpanded = expanded => {
    body.hidden = !expanded;
    card.classList.toggle('is-collapsed', !expanded);
    updateDisclosure();
    updateExpansionActions();
  };
  disclosure.addEventListener('click', () => setExpanded(body.hidden));
  updateDisclosure();
  const editor = element('div', 'editor');
  const comparison = renderContext(candidate, format, match => switchMode(match));
  const modeBadge = element('span', 'mode-badge', 'Обновление');
  modeBadge.hidden = true;
  const modePanel = element('div', 'update-mode-panel');
  modePanel.hidden = true;
  const targetLabel = element('strong');
  const changeCount = element('span', 'update-change-count');
  const returnToCreate = element('button', 'return-to-create', 'Вернуться к новому формату');
  returnToCreate.type = 'button';
  returnToCreate.addEventListener('click', () => switchMode(null));
  modePanel.append(targetLabel, changeCount,
    element('p', 'update-instruction', 'Ниже — итог обновления. Данные находки видны у каждого поля: переносите нужное кнопками или правьте итог вручную.'), returnToCreate);
  const editorLabel = element('h3', 'comparison-label', 'Черновик для каталога');
  const transfers = [];
  const refreshModePanel = () => {
    const mode = reviewModes.get(candidate.candidateId);
    const updating = mode?.action === 'update';
    modePanel.hidden = modeBadge.hidden = !updating;
    card.classList.toggle('is-update', updating);
    editorLabel.textContent = updating ? 'Итог обновления' : 'Черновик для каталога';
    for (const refresh of transfers) refresh(updating);
    if (updating) {
      const match = candidate.similarFormats.find(match => match.id === mode.targetId);
      targetLabel.textContent = `Обновление «${match.title}»`;
      changeCount.textContent = `Изменено полей: ${Object.keys(reviewFormatChanges(reviewUpdateBase(match), format)).length}`;
    }
  };
  const descriptionNote = element('p', 'description-note', 'Черновик отличается от исходного текста.');
  const videoPreview = element('div', 'video-preview');
  const refreshDescriptionNote = () => {
    descriptionNote.hidden = !candidate.source.text || format.description.trim() === candidate.source.text.trim();
  };
  let titleControl;
  const error = element('p', 'field-error', 'Укажите название формата');
  error.hidden = true;
  error.id = `title-error-${index}`;
  const onEdit = key => {
    if (key === 'title') {
      heading.textContent = format.title || 'Формат без названия';
      updateDisclosure();
      checkbox.setAttribute('aria-label', `Выбрать формат ${format.title || index + 1}`);
      titleControl.removeAttribute('aria-invalid');
      error.hidden = true;
    }
    if (key === 'description') refreshDescriptionNote();
    if (key === 'video') renderVideoText(videoPreview, format.video);
    refreshModePanel();
    comparison.refresh();
  };
  const syncField = key => {
    const control = card.querySelector(`[name="${key}"]`);
    if (control) control.value = format[key] === null ? '' : String(format[key]);
    for (const refresh of tagPickers[key] ?? []) refresh();
  };
  const findingField = (key, label) => {
    const wrapper = element('div', 'finding-field');
    wrapper.dataset.findingField = key;
    wrapper.hidden = true;
    const header = element('div', 'finding-field-heading');
    const caption = element('span', '', key === 'title' ? 'Название в находке' : 'В находке');
    const append = ['video', 'forms', 'features', 'collections'].includes(key);
    const action = append ? 'Добавить' : 'Заменить';
    const button = element('button', 'transfer-field', action);
    button.type = 'button';
    button.setAttribute('aria-label', `${action} из находки: ${label}`);
    button.title = append ? 'Добавить отсутствующие значения к итогу' : 'Заменить это поле итога значением находки';
    const value = element('div', 'finding-value');
    header.append(caption, button);
    wrapper.append(header, value);
    transfers.push(updating => {
      wrapper.hidden = !updating;
      if (!updating) return;
      const finding = savedDrafts.get('create');
      if (key === 'video') renderVideoText(value, finding[key]);
      else value.textContent = comparisonText(finding, key);
      if (key === 'video' && !finding[key]) value.textContent = 'Не указано';
      button.disabled = JSON.stringify(reviewFieldTransfer(format, finding, key)) === JSON.stringify(format[key]);
    });
    button.addEventListener('click', () => {
      if (reviewModes.get(candidate.candidateId)?.action !== 'update') return;
      format[key] = reviewFieldTransfer(format, savedDrafts.get('create'), key);
      syncField(key);
      onEdit(key);
      status.textContent = `${label}: ${append ? 'данные находки добавлены к итогу' : 'итог заменён значением находки'}.`;
    });
    return wrapper;
  };
  const editableField = (key, label, options) => {
    const result = field(key, label, format, index, onEdit, options);
    result.wrapper.append(findingField(key, label));
    return result;
  };
  const title = field('title', 'Название формата', format, index, onEdit);
  title.wrapper.classList.add('title-field');
  title.wrapper.querySelector('label').classList.add('sr-only');
  titleControl = title.control;
  titleControl.setAttribute('aria-describedby', error.id);
  title.wrapper.append(error);
  top.append(disclosure, element('span', 'card-number', String(index + 1).padStart(2, '0')), heading, title.wrapper, modeBadge, pick);
  const editorHeading = element('div', 'editor-heading');
  editorHeading.append(editorLabel, renderSource(candidate));
  editor.append(modePanel, editorHeading, findingField('title', 'Название формата'));
  const description = editableField('description', 'Описание для каталога', { multiline: true });
  description.wrapper.append(descriptionNote);
  refreshDescriptionNote();
  editor.append(description.wrapper);
  const requirements = element('div', 'requirements-grid');
  const flags = element('div', 'flags');
  for (const [key, label] of [['moderator', 'Модератор'], ['audienceOnStage', 'Зритель на сцене'], ['props', 'Реквизит']]) {
    flags.append(editableField(key, label, { flag: true }).wrapper);
  }
  requirements.append(flags, editableField('furniture', 'Мебель').wrapper);
  const tags = element('div', 'tags');
  for (const [key, label] of [['forms', 'Форма'], ['features', 'Особенности'], ['collections', 'Подборки']]) {
    const tag = tagField(key, label, format, index, onEdit);
    tag.append(findingField(key, label));
    tags.append(tag);
  }
  editor.append(requirements, tags, editableField('note', 'Дополнительно', { multiline: true }).wrapper);
  const video = editableField('video', 'Видео', { multiline: true });
  video.control.placeholder = 'Ссылка или ссылки на видео';
  video.wrapper.append(videoPreview);
  renderVideoText(videoPreview, format.video);
  editor.append(video.wrapper);
  body.append(editor, comparison.node);
  card.append(top, body);
  document.querySelector('#candidates').append(card);
  views.set(candidate.candidateId, { titleControl, error, card, checkbox, pickText, body, setExpanded });
  const switchMode = match => {
    const key = match ? `update:${match.id}` : 'create';
    if (key === activeDraftKey) return;
    let base;
    try { base = match ? reviewUpdateBase(match) : candidate.format; }
    catch (problem) { status.textContent = reviewErrorText(problem); return; }
    savedDrafts.set(activeDraftKey, structuredClone(format));
    Object.assign(format, structuredClone(savedDrafts.get(key) ?? base));
    activeDraftKey = key;
    reviewModes.set(candidate.candidateId, match ? { action: 'update', targetId: match.id } : { action: 'create' });
    for (const key of Object.keys(format)) syncField(key);
    onEdit('title');
    refreshDescriptionNote();
    renderVideoText(videoPreview, format.video);
    status.textContent = '';
    updateSelection();
  };
  checkbox.addEventListener('change', () => {
    setCandidateSelected(candidate.candidateId, checkbox.checked);
    updateSelection();
  });
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
      firstInvalid ??= view.titleControl;
    } else view.titleControl.removeAttribute('aria-invalid');
  }
  if (firstInvalid) {
    status.textContent = 'Заполните название у выбранных форматов.';
    firstInvalid.focus();
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
