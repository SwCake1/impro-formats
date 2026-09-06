import './styles.css';
import { FEATURE_TAGS, FORM_TAGS, SHEET_ID, SHEET_URL } from './config';
import { fetchFormats, readCache, writeCache } from './data';
import { countActiveFilters, DEFAULT_FILTERS, filterFormats } from './filters';
import type { FilterState, FormatRecord, FurnitureFilter, OptionalBoolean, TriState } from './types';
import { readFiltersFromUrl, writeFiltersToUrl } from './url-state';

function element<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Не найден элемент ${selector}`);
  return node;
}

const searchInput = element<HTMLInputElement>('#searchInput');
const clearSearch = element<HTMLButtonElement>('#clearSearch');
const catalog = element<HTMLElement>('#catalog');
const filtersPanel = element<HTMLElement>('#filtersPanel');
const filtersToggle = element<HTMLButtonElement>('#filtersToggle');
const showFilterResults = element<HTMLButtonElement>('#showFilterResults');
const filtersResizeHandle = element<HTMLElement>('#filtersResizeHandle');
const detailResizeHandle = element<HTMLElement>('#detailResizeHandle');
const activeFiltersCount = element<HTMLElement>('#activeFiltersCount');
const formFilters = element<HTMLElement>('#formFilters');
const featureFilters = element<HTMLElement>('#featureFilters');
const moderatorFilter = element<HTMLSelectElement>('#moderatorFilter');
const audienceFilter = element<HTMLSelectElement>('#audienceFilter');
const propsFilter = element<HTMLSelectElement>('#propsFilter');
const furnitureFilter = element<HTMLSelectElement>('#furnitureFilter');
const resultsCount = element<HTMLElement>('#resultsCount');
const resultsHeading = element<HTMLElement>('#resultsHeading');
const formatsList = element<HTMLElement>('#formatsList');
const emptyState = element<HTMLElement>('#emptyState');
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
const detailRequirements = element<HTMLElement>('#detailRequirements');
const detailNoteSection = element<HTMLElement>('#detailNoteSection');
const detailNote = element<HTMLElement>('#detailNote');
const closeDetail = element<HTMLButtonElement>('#closeDetail');
const copyLink = element<HTMLButtonElement>('#copyLink');
const sourceRowLink = element<HTMLAnchorElement>('#sourceRowLink');
const toast = element<HTMLElement>('#toast');

const mobileQuery = window.matchMedia('(max-width: 1220px)');
const resizablePanelsQuery = window.matchMedia('(min-width: 901px)');
const threePanelsQuery = window.matchMedia('(min-width: 1221px)');
let records: FormatRecord[] = [];
let filters: FilterState = readFiltersFromUrl(new URL(window.location.href));
let selectedTriggerId: string | null = null;
let toastTimer: number | undefined;
let loadController: AbortController | null = null;

type ResizablePanel = 'filters' | 'detail';

const PANEL_WIDTHS: Record<ResizablePanel, { cssProperty: string; defaultValue: number; storageKey: string }> = {
  filters: {
    cssProperty: '--filter-width',
    defaultValue: 280,
    storageKey: 'impro-formats:filters-width',
  },
  detail: {
    cssProperty: '--detail-width',
    defaultValue: 500,
    storageKey: 'impro-formats:detail-width',
  },
};

const PANEL_HANDLES: Record<ResizablePanel, HTMLElement> = {
  filters: filtersResizeHandle,
  detail: detailResizeHandle,
};

function currentPanelWidth(panel: ResizablePanel): number {
  const value = Number.parseFloat(getComputedStyle(catalog).getPropertyValue(PANEL_WIDTHS[panel].cssProperty));
  return Number.isFinite(value) ? value : PANEL_WIDTHS[panel].defaultValue;
}

function panelWidthLimits(panel: ResizablePanel): { min: number; max: number } {
  const catalogWidth = catalog.getBoundingClientRect().width;
  if (panel === 'filters') {
    const detailWidth = threePanelsQuery.matches ? currentPanelWidth('detail') : 0;
    const gaps = threePanelsQuery.matches ? 36 : 18;
    return {
      min: 220,
      max: Math.max(220, Math.min(480, catalogWidth - detailWidth - gaps - 380)),
    };
  }

  return {
    min: 360,
    max: Math.max(360, Math.min(720, catalogWidth - (currentPanelWidth('filters') + 36) - 380)),
  };
}

function setPanelWidth(panel: ResizablePanel, value: number, persist = false): void {
  const limits = panelWidthLimits(panel);
  const width = Math.round(Math.min(limits.max, Math.max(limits.min, value)));
  const handle = PANEL_HANDLES[panel];
  catalog.style.setProperty(PANEL_WIDTHS[panel].cssProperty, `${width}px`);
  handle.setAttribute('aria-valuemin', String(Math.round(limits.min)));
  handle.setAttribute('aria-valuemax', String(Math.round(limits.max)));
  handle.setAttribute('aria-valuenow', String(width));
  handle.setAttribute('aria-valuetext', `${width} пикселей`);
  if (!persist) return;
  try {
    localStorage.setItem(PANEL_WIDTHS[panel].storageKey, String(width));
  } catch {
    // The layout still works when storage is unavailable.
  }
}

function storedPanelWidth(panel: ResizablePanel): number {
  try {
    const value = Number.parseFloat(localStorage.getItem(PANEL_WIDTHS[panel].storageKey) ?? '');
    if (Number.isFinite(value)) return value;
  } catch {
    // Fall back to the default width.
  }
  return PANEL_WIDTHS[panel].defaultValue;
}

function syncPanelWidths(): void {
  if (!resizablePanelsQuery.matches) return;
  if (threePanelsQuery.matches) setPanelWidth('detail', currentPanelWidth('detail'));
  setPanelWidth('filters', currentPanelWidth('filters'));
}

function enablePanelResize(panel: ResizablePanel): void {
  const handle = PANEL_HANDLES[panel];
  let dragStartX = 0;
  let dragStartWidth = 0;
  let activePointer: number | null = null;

  handle.addEventListener('pointerdown', (event) => {
    if (!resizablePanelsQuery.matches || (panel === 'detail' && !threePanelsQuery.matches)) return;
    event.preventDefault();
    dragStartX = event.clientX;
    dragStartWidth = currentPanelWidth(panel);
    activePointer = event.pointerId;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('is-dragging');
    document.body.classList.add('is-resizing-panels');
  });

  handle.addEventListener('pointermove', (event) => {
    if (event.pointerId !== activePointer) return;
    const direction = panel === 'filters' ? 1 : -1;
    setPanelWidth(panel, dragStartWidth + ((event.clientX - dragStartX) * direction));
  });

  const finishResize = (event: PointerEvent): void => {
    if (event.pointerId !== activePointer) return;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    activePointer = null;
    handle.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing-panels');
    setPanelWidth(panel, currentPanelWidth(panel), true);
  };

  handle.addEventListener('pointerup', finishResize);
  handle.addEventListener('pointercancel', finishResize);
  handle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const separatorDelta = event.key === 'ArrowRight' ? 16 : -16;
    const panelDelta = panel === 'filters' ? separatorDelta : -separatorDelta;
    setPanelWidth(panel, currentPanelWidth(panel) + panelDelta, true);
  });
}

function initializePanelResize(): void {
  if (resizablePanelsQuery.matches) {
    if (threePanelsQuery.matches) setPanelWidth('detail', storedPanelWidth('detail'));
    setPanelWidth('filters', storedPanelWidth('filters'));
  }
  enablePanelResize('filters');
  enablePanelResize('detail');
  window.addEventListener('resize', syncPanelWidths);
  resizablePanelsQuery.addEventListener('change', ({ matches }) => {
    if (!matches) return;
    setPanelWidth('filters', storedPanelWidth('filters'));
    syncPanelWidths();
  });
  threePanelsQuery.addEventListener('change', ({ matches }) => {
    if (!matches) return;
    setPanelWidth('detail', storedPanelWidth('detail'));
    syncPanelWidths();
  });
}

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

function createTapeButton(tag: string, selected: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tape-filter';
  button.dataset.filterKey = tag;
  button.setAttribute('aria-pressed', String(selected));
  button.addEventListener('click', onClick);

  button.textContent = tag;
  return button;
}

function renderFilterButtons(): void {
  formFilters.replaceChildren();
  formFilters.append(createTapeButton('Все формы', !filters.formTag, () => {
    filters.formTag = null;
    filters.selectedId = null;
    syncUrl();
    render();
  }));
  FORM_TAGS.forEach((tag) => {
    formFilters.append(createTapeButton(tag, filters.formTag === tag, () => {
      filters.formTag = filters.formTag === tag ? null : tag;
      filters.selectedId = null;
      syncUrl();
      render();
    }));
  });

  featureFilters.replaceChildren();
  FEATURE_TAGS.forEach((tag) => {
    featureFilters.append(createTapeButton(tag, filters.featureTags.includes(tag), () => {
      filters.featureTags = filters.featureTags.includes(tag)
        ? filters.featureTags.filter((value) => value !== tag)
        : [...filters.featureTags, tag];
      filters.selectedId = null;
      syncUrl();
      render();
    }));
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
    button.textContent = `${label} ×`;
    button.setAttribute('aria-label', `Убрать фильтр: ${label}`);
    button.addEventListener('click', () => {
      remove();
      filters.selectedId = null;
      syncUrl();
      render();
      (container.querySelector<HTMLButtonElement>('button') ?? searchInput).focus();
    });
    container.append(button);
  }
  if (filters.query.trim()) add(`Поиск: ${filters.query}`, 'query', () => { filters.query = ''; });
  if (filters.formTag) add(filters.formTag, 'form', () => { filters.formTag = null; });
  filters.featureTags.forEach((tag) => add(tag, `feature:${tag}`, () => {
    filters.featureTags = filters.featureTags.filter((value) => value !== tag);
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
  const visibleTags = record.tags.slice(0, 2);
  visibleTags.forEach((tag) => appendTag(metadata, tag));
  const conditions = briefConditions(record);
  if (conditions.length > 0) {
    const needs = document.createElement('span');
    needs.className = 'format-row__needs';
    needs.textContent = conditions.join(' · ');
    metadata.append(needs);
  }
  button.append(header, description, metadata);
  button.addEventListener('click', () => selectFormat(record.id, button));
  return button;
}

function booleanLabel(value: OptionalBoolean, positive: string, negative: string): string {
  if (value === true) return positive;
  if (value === false) return negative;
  return 'Не указано';
}

function addRequirement(term: string, value: string, unknown = false): void {
  const wrapper = document.createElement('div');
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value;
  if (unknown) dd.classList.add('is-unknown');
  wrapper.append(dt, dd);
  detailRequirements.append(wrapper);
}

function findRecordById(id: string | null): FormatRecord | undefined {
  if (!id) return undefined;
  const exact = records.find((record) => record.id === id);
  if (exact) return exact;
  const requestedSlug = id.replace(/-[a-z0-9]+(?:-r\d+)?$/i, '');
  return records.find((record) => record.id.replace(/-[a-z0-9]+(?:-r\d+)?$/i, '') === requestedSlug);
}

function renderDetail(): void {
  const record = findRecordById(filters.selectedId);
  if (!record) {
    detailEmpty.hidden = false;
    detailContent.hidden = true;
    detailPanel.classList.remove('is-open');
    detailBackdrop.hidden = true;
    document.body.classList.remove('detail-open');
    detailPanel.setAttribute('aria-hidden', mobileQuery.matches ? 'true' : 'false');
    return;
  }

  if (filters.selectedId !== record.id) {
    filters.selectedId = record.id;
    syncUrl();
  }
  detailEmpty.hidden = true;
  detailContent.hidden = false;
  detailTitle.textContent = record.title;
  detailDescription.textContent = record.description || 'Описание пока не добавлено.';
  detailTags.replaceChildren();
  record.tags.forEach((tag) => appendTag(detailTags, tag));

  detailRequirements.replaceChildren();
  addRequirement('Модератор', booleanLabel(record.moderator, 'Нужен', 'Не нужен'), record.moderator === null);
  addRequirement('Зритель на сцене', booleanLabel(record.audienceOnStage, 'Нужен', 'Не нужен'), record.audienceOnStage === null);
  addRequirement('Реквизит', booleanLabel(record.props, 'Нужен', 'Не нужен'), record.props === null);
  addRequirement('Мебель', record.furniture || 'Не указано', !record.furniture);

  detailNoteSection.hidden = !record.note;
  detailNote.textContent = record.note;
  sourceRowLink.href = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=0&range=A${record.sourceRow}:H${record.sourceRow}`;

  detailPanel.classList.add('is-open');
  detailPanel.setAttribute('aria-hidden', 'false');
  if (mobileQuery.matches) {
    detailBackdrop.hidden = false;
    document.body.classList.add('detail-open');
  }
}

function renderResults(): void {
  const filtered = filterFormats(records, filters);
  if (filters.selectedId && !filtered.some((record) => record.id === findRecordById(filters.selectedId)?.id)) {
    filters.selectedId = null;
    syncUrl();
  }

  resultsCount.textContent = String(filtered.length);
  element('#resultsUnit').textContent = pluralizeFormats(filtered.length);
  showFilterResults.textContent = filtered.length > 0
    ? `Показать ${filtered.length} ${pluralizeFormats(filtered.length)}`
    : 'К результатам';
  resultsHeading.setAttribute('aria-label', `${filtered.length} ${pluralizeFormats(filtered.length)}`);
  formatsList.replaceChildren(...filtered.map(createFormatRow));

  const showError = records.length === 0;
  emptyState.hidden = filtered.length > 0;
  emptyStateTitle.textContent = showError ? 'Не удалось загрузить форматы' : 'Такого сочетания пока нет';
  emptyStateText.textContent = showError
    ? 'Проверьте соединение и попробуйте ещё раз.'
    : 'Уберите один из фильтров или измените запрос.';
  emptyReset.textContent = showError ? 'Повторить загрузку' : 'Показать все';
}

function render(): void {
  const active = document.activeElement as HTMLElement | null;
  const filterKey = active?.dataset.filterKey;
  syncControls();
  renderFilterButtons();
  renderSelectedFilters();
  renderResults();
  renderDetail();
  if (filterKey && active && !active.isConnected) {
    document.querySelector<HTMLElement>(`[data-filter-key="${CSS.escape(filterKey)}"]`)?.focus();
  }
}

function selectFormat(id: string, trigger?: HTMLElement): void {
  selectedTriggerId = trigger?.dataset.id ?? id;
  filters.selectedId = id;
  syncUrl('push');
  render();
  if (mobileQuery.matches) {
    window.setTimeout(() => detailPanel.focus(), 0);
  }
}

function closeSelectedFormat(): void {
  if (!filters.selectedId) return;
  const triggerId = selectedTriggerId ?? filters.selectedId;
  filters.selectedId = null;
  syncUrl('push');
  render();
  formatsList.querySelector<HTMLButtonElement>(`.format-row[data-id="${CSS.escape(triggerId)}"]`)?.focus();
  selectedTriggerId = null;
}

function resetAll(): void {
  filters = { ...DEFAULT_FILTERS, featureTags: [] };
  syncUrl();
  render();
  searchInput.focus();
}

function updateSelectFilters(): void {
  filters.moderator = moderatorFilter.value as TriState;
  filters.audience = audienceFilter.value as TriState;
  filters.props = propsFilter.value as TriState;
  filters.furniture = furnitureFilter.value as FurnitureFilter;
  filters.selectedId = null;
  syncUrl();
  render();
}

function syncDetailMode(): void {
  if (mobileQuery.matches) {
    detailPanel.setAttribute('role', 'dialog');
    detailPanel.setAttribute('aria-modal', 'true');
    detailPanel.setAttribute('aria-hidden', filters.selectedId ? 'false' : 'true');
    detailBackdrop.hidden = !filters.selectedId;
    document.body.classList.toggle('detail-open', Boolean(filters.selectedId));
  } else {
    detailPanel.removeAttribute('role');
    detailPanel.removeAttribute('aria-modal');
    detailPanel.removeAttribute('aria-hidden');
    detailBackdrop.hidden = true;
    document.body.classList.remove('detail-open');
  }
}

async function copyCurrentLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast('Ссылка скопирована');
  } catch {
    const input = document.createElement('textarea');
    input.value = window.location.href;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    showToast('Ссылка скопирована');
  }
}

async function loadFreshData(): Promise<void> {
  loadController?.abort();
  loadController = new AbortController();
  try {
    const freshRecords = await fetchFormats(loadController.signal);
    records = freshRecords;
    writeCache(records);
    render();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    const reason = error instanceof Error ? error.message : 'Неизвестная ошибка.';
    if (records.length > 0) {
      showToast('Не удалось обновить данные — показываем сохранённые');
    } else {
      render();
      showToast(`Не удалось загрузить данные: ${reason}`);
    }
  }
}

function trapDetailFocus(event: KeyboardEvent): void {
  if (event.key === 'Escape' && filters.selectedId) {
    closeSelectedFormat();
    return;
  }
  if (event.key !== 'Tab' || !mobileQuery.matches || !filters.selectedId) return;
  const focusable = [...detailPanel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.hidden);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

searchInput.addEventListener('input', () => {
  filters.query = searchInput.value;
  filters.selectedId = null;
  syncUrl();
  render();
});
clearSearch.addEventListener('click', () => {
  filters.query = '';
  filters.selectedId = null;
  syncUrl();
  render();
  searchInput.focus();
});
[moderatorFilter, audienceFilter, propsFilter, furnitureFilter].forEach((select) => {
  select.addEventListener('change', updateSelectFilters);
});
[resetFilters, resetFiltersTop].forEach((button) => button.addEventListener('click', resetAll));
emptyReset.addEventListener('click', () => records.length > 0 ? resetAll() : void loadFreshData());
function collapseFilters(): void {
  filtersPanel.classList.remove('is-open');
  filtersToggle.setAttribute('aria-expanded', 'false');
}
filtersToggle.addEventListener('click', () => {
  const open = filtersPanel.classList.toggle('is-open');
  filtersToggle.setAttribute('aria-expanded', String(open));
});
showFilterResults.addEventListener('click', () => {
  collapseFilters();
  resultsHeading.focus({ preventScroll: true });
  resultsHeading.scrollIntoView({ block: 'start' });
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
document.addEventListener('keydown', trapDetailFocus);
mobileQuery.addEventListener('change', syncDetailMode);
window.addEventListener('popstate', () => {
  filters = readFiltersFromUrl(new URL(window.location.href));
  render();
  syncDetailMode();
});

const cached = readCache();
if (cached) {
  records = cached.records;
}
initializePanelResize();
render();
syncDetailMode();
void loadFreshData();

// Keep the canonical source available for browser extensions and diagnostics.
document.documentElement.dataset.source = SHEET_URL;
