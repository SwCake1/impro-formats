import { DEFAULT_FILTERS } from './filters';
import type { FilterState, FurnitureFilter, TriState } from './types';

const TRI_STATES = new Set<TriState>(['any', 'yes', 'no']);
const FURNITURE_FILTERS = new Set<FurnitureFilter>(['any', 'none', 'chairs', 'tables']);

export function readFiltersFromUrl(url: URL): FilterState {
  const triState = (name: string): TriState => {
    const value = url.searchParams.get(name) as TriState | null;
    return value && TRI_STATES.has(value) ? value : 'any';
  };
  const furniture = url.searchParams.get('furniture') as FurnitureFilter | null;

  return {
    ...DEFAULT_FILTERS,
    query: url.searchParams.get('q') ?? '',
    formTag: url.searchParams.get('form'),
    featureTags: [...new Set(url.searchParams.getAll('feature').filter(Boolean))],
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
  if (filters.query.trim()) url.searchParams.set('q', filters.query.trim());
  if (filters.formTag) url.searchParams.set('form', filters.formTag);
  filters.featureTags.forEach((tag) => url.searchParams.append('feature', tag));
  if (filters.moderator !== 'any') url.searchParams.set('moderator', filters.moderator);
  if (filters.audience !== 'any') url.searchParams.set('audience', filters.audience);
  if (filters.props !== 'any') url.searchParams.set('props', filters.props);
  if (filters.furniture !== 'any') url.searchParams.set('furniture', filters.furniture);
  if (filters.selectedId) url.searchParams.set('format', filters.selectedId);
  return url;
}
