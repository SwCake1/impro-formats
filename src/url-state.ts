import { DEFAULT_FILTERS } from './filters';
import { LEGACY_COLLECTION_TAGS } from './config';
import type { FilterState, FurnitureFilter, TriState } from './types';

const TRI_STATES = new Set<TriState>(['any', 'yes', 'no']);
const FURNITURE_FILTERS = new Set<FurnitureFilter>(['any', 'none', 'chairs', 'tables']);

export function readFiltersFromUrl(url: URL): FilterState {
  const triState = (name: string): TriState => {
    const value = url.searchParams.get(name) as TriState | null;
    return value && TRI_STATES.has(value) ? value : 'any';
  };
  const furniture = url.searchParams.get('furniture') as FurnitureFilter | null;
  // Новые ссылки сохраняют независимость полей даже при одинаковых названиях.
  const moved = new Set<string>(url.searchParams.get('filters') === '3' ? [] : LEGACY_COLLECTION_TAGS);
  const form = url.searchParams.get('form');
  const features = url.searchParams.getAll('feature').filter(Boolean);
  const collectionTags = [...new Set([
    ...url.searchParams.getAll('collection').filter(Boolean),
    ...(form && moved.has(form) ? [form] : []),
    ...features.filter((tag) => moved.has(tag)),
  ])];

  return {
    ...DEFAULT_FILTERS,
    query: url.searchParams.get('q') ?? '',
    formTag: form && !moved.has(form) ? form : null,
    featureTags: [...new Set(features.filter((tag) => !moved.has(tag)))],
    collectionTags,
    moderator: triState('moderator'),
    audience: triState('audience'),
    props: triState('props'),
    furniture: furniture && FURNITURE_FILTERS.has(furniture) ? furniture : 'any',
    selectedId: url.searchParams.get('format'),
  };
}

export function writeFiltersToUrl(filters: FilterState, currentUrl: URL): URL {
  const url = new URL(currentUrl);
  url.search = '';
  if (filters.formTag || filters.featureTags.length || filters.collectionTags.length) url.searchParams.set('filters', '3');
  if (filters.query.trim()) url.searchParams.set('q', filters.query.trim());
  if (filters.formTag) url.searchParams.set('form', filters.formTag);
  filters.featureTags.forEach((tag) => url.searchParams.append('feature', tag));
  filters.collectionTags.forEach((tag) => url.searchParams.append('collection', tag));
  if (filters.moderator !== 'any') url.searchParams.set('moderator', filters.moderator);
  if (filters.audience !== 'any') url.searchParams.set('audience', filters.audience);
  if (filters.props !== 'any') url.searchParams.set('props', filters.props);
  if (filters.furniture !== 'any') url.searchParams.set('furniture', filters.furniture);
  if (filters.selectedId) url.searchParams.set('format', filters.selectedId);
  return url;
}
