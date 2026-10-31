import { initializeAnalytics } from './analytics';
import { initializePanelResize } from './panel-resize';
import { createDetailDialog } from './detail-dialog';
import { fetchFormats, normalizeText, readCache, writeCache } from './data';
import { classificationOptions, countActiveFilters, DEFAULT_FILTERS, filterFormats } from './filters';
import type { FilterState, FormatRecord, FurnitureFilter, TriState } from './types';
import { readFiltersFromUrl, writeFiltersToUrl } from './url-state';

initializeAnalytics();

function element<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Не найден элемент ${selector}`);
  return node;
}

const searchInput = element<HTMLInputElement>('#searchInput');
const clearSearch = element<HTMLButtonElement>('#clearSearch');
const catalog = element<HTMLElement>('#catalog');
const filtersPanel = element<HTMLElement>('#filtersPanel');
const filtersLoading = element<HTMLElement>('#filtersLoading');
const filtersContent = element<HTMLElement>('#filtersContent');
const filtersToggle = element<HTMLButtonElement>('#filtersToggle');
const showFilterResults = element<HTMLButtonElement>('#showFilterResults');
const filtersResizeHandle = element<HTMLElement>('#filtersResizeHandle');
const detailResizeHandle = element<HTMLElement>('#detailResizeHandle');
const activeFiltersCount = element<HTMLElement>('#activeFiltersCount');
const formFilters = element<HTMLElement>('#formFilters');
const featureFilters = element<HTMLElement>('#featureFilters');
const collectionFilters = element<HTMLElement>('#collectionFilters');
const moderatorFilter = element<HTMLSelectElement>('#moderatorFilter');
const audienceFilter = element<HTMLSelectElement>('#audienceFilter');
const propsFilter = element<HTMLSelectElement>('#propsFilter');
const furnitureFilter = element<HTMLSelectElement>('#furnitureFilter');
const resultsCount = element<HTMLElement>('#resultsCount');
const resultsHeading = element<HTMLElement>('#resultsHeading');
const formatsList = element<HTMLElement>('#formatsList');
const catalogLoading = element<HTMLElement>('#catalogLoading');
const emptyState = element<HTMLElement>('#emptyState');
const emptyStateIllustration = element<HTMLImageElement>('#emptyState .empty-state__illustration');
const emptyStateMark = element<HTMLElement>('#emptyState .empty-state__mark');
const emptyStateTitle = element<HTMLElement>('#emptyState h3');
const emptyStateText = element<HTMLElement>('#emptyState p');
const resetFilters = element<HTMLButtonElement>('#resetFilters');
const resetFiltersTop = element<HTMLButtonElement>('#resetFiltersTop');
const emptyReset = element<HTMLButtonElement>('#emptyReset');
const detailPanel = element<HTMLElement>('#detailPanel');
const detailBackdrop = element<HTMLElement>('#detailBackdrop');
const detailEmpty = element<HTMLElement>('#detailEmpty');
const detailContent = element<HTMLElement>('#detailContent');
const detailTitle = element<HTMLElement>('#detailTitle');
const detailTags = element<HTMLElement>('#detailTags');
const detailDescription = element<HTMLElement>('#detailDescription');
const detailRequirementsSection = element<HTMLElement>('#detailRequirementsSection');
const detailRequirements = element<HTMLElement>('#detailRequirements');
const detailNoteSection = element<HTMLElement>('#detailNoteSection');
const detailNote = element<HTMLElement>('#detailNote');
const closeDetail = element<HTMLButtonElement>('#closeDetail');
const copyLink = element<HTMLButtonElement>('#copyLink');
const toast = element<HTMLElement>('#toast');

const resizablePanelsQuery = window.matchMedia('(min-width: 901px)');
let records: FormatRecord[] = [];
let filters: FilterState = readFiltersFromUrl(new URL(window.location.href));
let toastTimer: number | undefined;
let loadController: AbortController | null = null;
let loadState: 'loading' | 'ready' | 'error' = 'loading';

const detailDialog = createDetailDialog({
  panel: detailPanel,
  backdrop: detailBackdrop,
  fallbackFocus: searchInput,
  background: [
    element('.hero'), element('.footer'),
    ...Array.from(catalog.children).filter((node): node is HTMLElement =>
      node instanceof HTMLElement && node !== detailPanel && node !== detailBackdrop),
  ],
  onClose: closeSelectedFormat,
});

function pluralizeFormats(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 19) return 'форматов';
  if (mod10 === 1) return 'формат';
  if (mod10 >= 2 && mod10 <= 4) return 'формата';
  return 'форматов';
}

function showToast(message: string): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  toastTimer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => { toast.hidden = true; }, 180);
  }, 2200);
}

function syncUrl(mode: 'replace' | 'push' = 'replace'): void {
  const url = writeFiltersToUrl(filters, new URL(window.location.href));
  window.history[mode === 'push' ? 'pushState' : 'replaceState']({}, '', url);
}

function createTapeButton(tag: string, selected: boolean, onClick: () => void, key: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tape-filter';
  button.dataset.filterKey = key;
  button.setAttribute('aria-pressed', String(selected));
  button.addEventListener('click', onClick);

  button.textContent = tag;
  return button;
}

function syncFilterGroup(
  container: HTMLElement,
  options: Array<{ label: string; key: string; selected: boolean; onClick: () => void }>,
): void {
  const previous = [...container.querySelectorAll<HTMLButtonElement>('button')];
  const byKey = new Map(previous.map(button => [button.dataset.filterKey, button]));
  const buttons = options.map(({ label, key, selected, onClick }) => {
    const button = byKey.get(key) ?? createTapeButton(label, selected, onClick, key);
    button.setAttribute('aria-pressed', String(selected));
    return button;
  });
  if (previous.length !== buttons.length || previous.some((button, index) => button !== buttons[index])) {
    container.replaceChildren(...buttons);
  }
}

function applyFilterChange(): void {
  filters.selectedId = null;
  syncUrl();
  render();
}

function renderFilterButtons(): void {
  syncFilterGroup(formFilters, [
    { label: 'Все формы', key: 'all-forms', selected: !filters.formTag, onClick: () => {
      filters.formTag = null;
      applyFilterChange();
    } },
    ...classificationOptions(records, 'forms', filters.formTag ? [filters.formTag] : []).map(tag => ({
      label: tag, key: `form:${tag}`, selected: filters.formTag === tag, onClick: () => {
        filters.formTag = filters.formTag === tag ? null : tag;
        applyFilterChange();
      },
    })),
  ]);
  const groups = [
    { container: featureFilters, field: 'features', state: 'featureTags', prefix: 'feature' },
    { container: collectionFilters, field: 'collections', state: 'collectionTags', prefix: 'collection' },
  ] as const;
  groups.forEach(({ container, field, state, prefix }) => {
    syncFilterGroup(container, classificationOptions(records, field, filters[state]).map(tag => ({
      label: tag, key: `${prefix}:${tag}`, selected: filters[state].includes(tag), onClick: () => {
        filters[state] = filters[state].includes(tag)
          ? filters[state].filter(value => value !== tag) : [...filters[state], tag];
        applyFilterChange();
      },
    })));
  });
}

function syncControls(): void {
  searchInput.value = filters.query;
  clearSearch.hidden = !filters.query;
  moderatorFilter.value = filters.moderator;
  audienceFilter.value = filters.audience;
  propsFilter.value = filters.props;
  furnitureFilter.value = filters.furniture;

  const activeCount = countActiveFilters(filters);
  activeFiltersCount.textContent = String(activeCount);
  activeFiltersCount.hidden = activeCount === 0;
  resetFilters.hidden = activeCount === 0;
  resetFiltersTop.hidden = activeCount === 0;
  element('#featuresCount').textContent = filters.featureTags.length ? `· ${filters.featureTags.length}` : '';
  element('#collectionsCount').textContent = filters.collectionTags.length ? `· ${filters.collectionTags.length}` : '';
  const conditionsCount = [filters.moderator, filters.audience, filters.props, filters.furniture].filter((value) => value !== 'any').length;
  element('#conditionsCount').textContent = conditionsCount ? `· ${conditionsCount}` : '';
}

function renderSelectedFilters(): void {
  const container = element('#selectedFilters');
  container.replaceChildren();
  function add(label: string, key: string, remove: () => void): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'selected-filter';
    button.dataset.filterKey = key;
    button.dataset.filterType = key === 'query'
      ? 'query'
      : key === 'form'
        ? 'form'
        : key.startsWith('feature:')
          ? 'feature'
          : key.startsWith('collection:')
            ? 'collection'
            : 'condition';
    button.textContent = `${label} ×`;
    button.setAttribute('aria-label', `Убрать фильтр: ${label}`);
    button.addEventListener('click', () => {
      remove();
      applyFilterChange();
      (container.querySelector<HTMLButtonElement>('button') ?? searchInput).focus();
    });
    container.append(button);
  }
  if (filters.query.trim()) add(`Поиск: ${filters.query}`, 'query', () => { filters.query = ''; });
  if (filters.formTag) add(filters.formTag, 'form', () => { filters.formTag = null; });
  filters.featureTags.forEach((tag) => add(tag, `feature:${tag}`, () => {
    filters.featureTags = filters.featureTags.filter((value) => value !== tag);
  }));
  filters.collectionTags.forEach((tag) => add(`Подборка: ${tag}`, `collection:${tag}`, () => {
    filters.collectionTags = filters.collectionTags.filter((value) => value !== tag);
  }));
  const conditions = [
    ['moderator', 'С модератором', 'Без модератора'],
    ['audience', 'Со зрителем на сцене', 'Без зрителя на сцене'],
    ['props', 'С реквизитом', 'Без реквизита'],
  ] as const;
  conditions.forEach(([key, yes, no]) => {
    if (filters[key] !== 'any') add(filters[key] === 'yes' ? yes : no, key, () => { filters[key] = 'any'; });
  });
  if (filters.furniture !== 'any') {
    const labels = { none: 'Без мебели', chairs: 'Нужны стулья', tables: 'Нужен стол' };
    add(labels[filters.furniture], 'furniture', () => { filters.furniture = 'any'; });
  }
  container.hidden = !container.childElementCount;
}

function appendTag(container: HTMLElement, tag: string): void {
  const badge = document.createElement('span');
  badge.className = 'tag';
  badge.textContent = tag;
  container.append(badge);
}

function briefConditions(record: FormatRecord): string[] {
  const values: string[] = [];
  if (record.moderator === true) values.push('модератор');
  if (record.audienceOnStage === true) values.push('зритель');
  if (record.props === true) values.push('реквизит');
  if (record.furnitureKinds.includes('chairs')) values.push('стулья');
  if (record.furnitureKinds.includes('tables')) values.push('стол');
  return values;
}

function createFormatRow(record: FormatRecord): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'format-row';
  button.dataset.id = record.id;
  button.setAttribute('aria-pressed', String(filters.selectedId === record.id));
  button.setAttribute('aria-label', `Открыть формат «${record.title}»`);

  const header = document.createElement('span');
  header.className = 'format-row__header';
  const title = document.createElement('span');
  title.className = 'format-row__title';
  title.textContent = record.title;
  const arrow = document.createElement('span');
  arrow.className = 'format-row__arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '→';
  header.append(title, arrow);

  const description = document.createElement('span');
  description.className = 'format-row__description';
  description.textContent = record.description || 'Описание пока не добавлено.';

  const metadata = document.createElement('span');
  metadata.className = 'format-row__metadata';
  const visibleTags = [...record.forms, ...record.features, ...record.collections].slice(0, 2);
  visibleTags.forEach((tag) => appendTag(metadata, tag));
  const conditions = briefConditions(record);
  if (conditions.length > 0) {
    const needs = document.createElement('span');
    needs.className = 'format-row__needs';
    needs.textContent = conditions.join(' · ');
    metadata.append(needs);
  }
  button.append(header, description, metadata);
  button.addEventListener('click', () => selectFormat(record.id));
  return button;
}

const requirementIcons = {
  moderator: [
    'M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z',
    'M5 10v1a7 7 0 0 0 14 0v-1M12 18v3M9 21h6',
  ],
  audience: [
    'M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    'M6 18v-1a6 6 0 0 1 12 0v1M3 21h18',
  ],
  props: [
    'm12 3 9 5-9 5-9-5 9-5Z',
    'M3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5',
  ],
  furniture: [
    'M7 12V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v7',
    'M5 12h14v5H5zM7 17v4M17 17v4',
  ],
};

function addRequirement(kind: keyof typeof requirementIcons, label: string, detail?: string): void {
  const item = document.createElement('li');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.classList.add('requirements__icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '34');
  icon.setAttribute('height', '34');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.6');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  requirementIcons[kind].forEach(d => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    icon.append(path);
  });

  const content = document.createElement('span');
  content.className = 'requirements__content';
  const title = document.createElement('span');
  title.className = 'requirements__label';
  title.textContent = label;
  content.append(title);
  if (detail) {
    const description = document.createElement('span');
    description.className = 'requirements__detail';
    description.textContent = detail;
    content.append(description);
  }
  item.append(icon, content);
  detailRequirements.append(item);
}

function findRecordById(id: string | null): FormatRecord | undefined {
  return records.find((record) => record.id === id);
}

function renderDetail(): void {
  const record = findRecordById(filters.selectedId);
  if (!record) {
    detailEmpty.hidden = false;
    detailContent.hidden = true;
    detailDialog.sync(false);
    return;
  }

  detailEmpty.hidden = true;
  detailContent.hidden = false;
  detailTitle.textContent = record.title;
  detailDescription.textContent = record.description || 'Описание пока не добавлено.';
  detailTags.replaceChildren();
  [...record.forms, ...record.features].forEach((tag) => appendTag(detailTags, tag));
  record.collections.forEach((tag) => appendTag(detailTags, `Подборка: ${tag}`));

  detailRequirements.replaceChildren();
  if (record.moderator === true) addRequirement('moderator', 'Модератор');
  if (record.audienceOnStage === true) addRequirement('audience', 'Зритель на сцене');
  if (record.props === true) addRequirement('props', 'Реквизит');
  if (record.furniture && normalizeText(record.furniture) !== 'нет') {
    addRequirement('furniture', 'Мебель', record.furniture);
  }
  detailRequirementsSection.hidden = detailRequirements.childElementCount === 0;

  detailNoteSection.hidden = !record.note;
  detailNote.textContent = record.note;

  detailDialog.sync(true, () => formatButton(record.id));
}

function clearUnavailableSelection(visible: FormatRecord[]): boolean {
  // A missing record in an old cache is not proof that a shared link is invalid.
  if (loadState === 'ready' && filters.selectedId && !visible.some(record => record.id === filters.selectedId)) {
    filters.selectedId = null;
    syncUrl();
    return true;
  }
  return false;
}

function renderResults(): void {
  const filtered = filterFormats(records, filters);
  clearUnavailableSelection(filtered);
  const loading = records.length === 0 && loadState === 'loading';

  resultsCount.textContent = loading ? 'Загружаем' : String(filtered.length);
  element('#resultsUnit').textContent = loading ? 'форматы…' : pluralizeFormats(filtered.length);
  showFilterResults.textContent = filtered.length > 0
    ? `Показать ${filtered.length} ${pluralizeFormats(filtered.length)}`
    : 'К результатам';
  resultsHeading.setAttribute('aria-label', loading ? 'Загружаем форматы…'
    : `${filtered.length} ${pluralizeFormats(filtered.length)}`);
  formatsList.replaceChildren(...filtered.map(createFormatRow));

  const showError = records.length === 0 && loadState === 'error';
  formatsList.setAttribute('aria-busy', String(loading));
  catalogLoading.hidden = !loading;
  filtersLoading.hidden = !loading;
  filtersContent.hidden = loading;
  filtersPanel.setAttribute('aria-busy', String(loading));
  emptyState.hidden = loading || filtered.length > 0;
  emptyStateIllustration.hidden = showError;
  emptyStateMark.hidden = !showError;
  emptyStateTitle.textContent = showError ? 'Не удалось загрузить форматы' : 'Такого сочетания пока нет';
  emptyStateText.textContent = showError
    ? 'Проверьте соединение и попробуйте ещё раз.'
    : 'Уберите один из фильтров или измените запрос.';
  emptyReset.hidden = loading;
  emptyReset.textContent = showError ? 'Повторить загрузку' : 'Показать все';
}

function render(): void {
  const active = document.activeElement as HTMLElement | null;
  const filterKey = active?.dataset.filterKey;
  const recordId = active?.dataset.id;
  syncControls();
  renderFilterButtons();
  renderSelectedFilters();
  renderResults();
  renderDetail();
  if (active && !active.isConnected) {
    if (filterKey) document.querySelector<HTMLElement>(`[data-filter-key="${CSS.escape(filterKey)}"]`)?.focus();
    else if (recordId) (formatButton(recordId) ?? resultsHeading).focus();
  }
}

function formatButton(id: string): HTMLButtonElement | null {
  return formatsList.querySelector<HTMLButtonElement>(`.format-row[data-id="${CSS.escape(id)}"]`);
}

function renderSelection(): void {
  formatsList.querySelectorAll<HTMLButtonElement>('.format-row').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.id === filters.selectedId));
  });
  renderDetail();
}

function selectFormat(id: string): void {
  filters.selectedId = id;
  syncUrl('push');
  renderSelection();
}

function closeSelectedFormat(): void {
  if (!filters.selectedId) return;
  const trigger = formatButton(filters.selectedId);
  filters.selectedId = null;
  syncUrl('push');
  renderSelection();
  (trigger ?? searchInput).focus({ preventScroll: true });
}

function resetAll(): void {
  filters = { ...DEFAULT_FILTERS, featureTags: [], collectionTags: [] };
  syncUrl();
  render();
  searchInput.focus();
}

function updateSelectFilters(): void {
  filters.moderator = moderatorFilter.value as TriState;
  filters.audience = audienceFilter.value as TriState;
  filters.props = propsFilter.value as TriState;
  filters.furniture = furnitureFilter.value as FurnitureFilter;
  applyFilterChange();
}

async function copyCurrentLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast('Ссылка скопирована');
  } catch {
    const previousFocus = document.activeElement as HTMLElement | null;
    const input = document.createElement('textarea');
    input.value = window.location.href;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    // Keep the fallback inside the dialog so it remains usable while the background is inert.
    detailPanel.append(input);
    let copied = false;
    try {
      input.select();
      copied = document.execCommand('copy');
    } catch {
      // Some browsers disable both clipboard mechanisms.
    } finally {
      input.remove();
      previousFocus?.focus({ preventScroll: true });
    }
    showToast(copied ? 'Ссылка скопирована'
      : 'Не удалось скопировать ссылку. Скопируйте адрес из строки браузера.');
  }
}

async function loadFreshData(): Promise<void> {
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  loadState = 'loading';
  if (records.length === 0) renderResults();
  try {
    const fresh = await fetchFormats(controller.signal, cached);
    if (loadController !== controller) return;
    loadState = 'ready';
    if (fresh === cached) {
      if (clearUnavailableSelection(filterFormats(records, filters))) renderSelection();
      return;
    }
    cached = fresh;
    records = fresh.records;
    writeCache(fresh);
    render();
  } catch (error) {
    if (loadController !== controller) return;
    if (error instanceof DOMException && error.name === 'AbortError') return;
    loadState = 'error';
    const reason = error instanceof Error ? error.message : 'Неизвестная ошибка.';
    if (records.length > 0) {
      showToast('Не удалось обновить данные — показываем сохранённые');
    } else {
      render();
      showToast(`Не удалось загрузить данные: ${reason}`);
    }
  }
}

searchInput.addEventListener('input', () => {
  filters.query = searchInput.value;
  applyFilterChange();
});
clearSearch.addEventListener('click', () => {
  filters.query = '';
  applyFilterChange();
  searchInput.focus();
});
[moderatorFilter, audienceFilter, propsFilter, furnitureFilter].forEach((select) => {
  select.addEventListener('change', updateSelectFilters);
});
[resetFilters, resetFiltersTop].forEach((button) => button.addEventListener('click', resetAll));
emptyReset.addEventListener('click', () => records.length > 0 ? resetAll() : void loadFreshData());
function collapseFilters(onComplete?: () => void): void {
  const wasOpen = filtersPanel.classList.contains('is-open');
  filtersPanel.classList.remove('is-open');
  filtersToggle.setAttribute('aria-expanded', 'false');
  if (!onComplete) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!wasOpen || resizablePanelsQuery.matches || reducedMotion) {
    requestAnimationFrame(onComplete);
    return;
  }

  let settled = false;
  let fallbackId = 0;
  const finish = (): void => {
    if (settled) return;
    settled = true;
    filtersPanel.removeEventListener('transitionend', handleTransitionEnd);
    window.clearTimeout(fallbackId);
    onComplete();
  };
  const handleTransitionEnd = (event: TransitionEvent): void => {
    if (event.target === filtersPanel && event.propertyName === 'max-height') finish();
  };
  filtersPanel.addEventListener('transitionend', handleTransitionEnd);
  fallbackId = window.setTimeout(finish, 420);
}
function scrollToResultsSummary(): void {
  const resultsSummary = resultsHeading.closest<HTMLElement>('.results__heading') ?? resultsHeading;
  resultsHeading.focus({ preventScroll: true });
  resultsSummary.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function scrollToCatalogTop(): void {
  element<HTMLElement>('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
filtersToggle.addEventListener('click', () => {
  const open = filtersPanel.classList.toggle('is-open');
  filtersToggle.setAttribute('aria-expanded', String(open));
});
showFilterResults.addEventListener('click', () => {
  collapseFilters(scrollToResultsSummary);
});
resultsHeading.closest<HTMLElement>('.results__heading')?.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).closest('button')) return;
  scrollToCatalogTop();
});
filtersPanel.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && filtersPanel.classList.contains('is-open') && !resizablePanelsQuery.matches) {
    collapseFilters();
    filtersToggle.focus();
  }
});
resizablePanelsQuery.addEventListener('change', ({ matches }) => {
  if (!matches && filtersPanel.contains(document.activeElement) && !filtersPanel.classList.contains('is-open')) {
    filtersToggle.focus();
  }
});
closeDetail.addEventListener('click', closeSelectedFormat);
detailBackdrop.addEventListener('click', closeSelectedFormat);
copyLink.addEventListener('click', () => void copyCurrentLink());
window.addEventListener('popstate', () => {
  filters = readFiltersFromUrl(new URL(window.location.href));
  render();
});

let cached = readCache();
if (cached) {
  records = cached.records;
}

function startApp(): void {
  appStyles.media = 'all';
  document.documentElement.classList.remove('app-starting');
  element('.cue-search').inert = false;
  filtersToggle.disabled = false;
  initializePanelResize(catalog, { filters: filtersResizeHandle, detail: detailResizeHandle });
  render();
  void loadFreshData();
}

const appStyles = element<HTMLLinkElement>('#appStyles');
if (appStyles.sheet) startApp();
else appStyles.addEventListener('load', startApp, { once: true });
