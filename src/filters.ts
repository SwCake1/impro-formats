import { normalizeText } from './data';
import type { FilterState, FormatRecord, OptionalBoolean, TriState } from './types';

const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });

export const DEFAULT_FILTERS: FilterState = {
  query: '',
  formTag: null,
  featureTags: [],
  moderator: 'any',
  audience: 'any',
  props: 'any',
  furniture: 'any',
  selectedId: null,
};

function matchesTriState(value: OptionalBoolean, filter: TriState): boolean {
  if (filter === 'any') return true;
  if (value === null) return false;
  return filter === 'yes' ? value : !value;
}

export function filterFormats(records: FormatRecord[], filters: FilterState): FormatRecord[] {
  const terms = normalizeText(filters.query).split(' ').filter(Boolean);

  return records
    .filter((record) => terms.every((term) => record.searchText.includes(term)))
    .filter((record) => !filters.formTag || record.tags.includes(filters.formTag))
    .filter((record) => filters.featureTags.every((tag) => record.tags.includes(tag)))
    .filter((record) => matchesTriState(record.moderator, filters.moderator))
    .filter((record) => matchesTriState(record.audienceOnStage, filters.audience))
    .filter((record) => matchesTriState(record.props, filters.props))
    .filter((record) => {
      if (filters.furniture === 'any') return true;
      if (filters.furniture === 'none') return normalizeText(record.furniture) === 'нет';
      return record.furnitureKinds.includes(filters.furniture);
    })
    .sort((left, right) => collator.compare(left.title, right.title));
}

export function countActiveFilters(filters: FilterState): number {
  return Number(Boolean(filters.query.trim()))
    + Number(Boolean(filters.formTag))
    + filters.featureTags.length
    + Number(filters.moderator !== 'any')
    + Number(filters.audience !== 'any')
    + Number(filters.props !== 'any')
    + Number(filters.furniture !== 'any');
}

export function countTag(records: FormatRecord[], tag: string): number {
  return records.filter((record) => record.tags.includes(tag)).length;
}
