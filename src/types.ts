export type OptionalBoolean = boolean | null;
export type TriState = 'any' | 'yes' | 'no';
export type FurnitureFilter = 'any' | 'none' | 'chairs' | 'tables';

export interface FormatRecord {
  id: string;
  sourceRow: number;
  title: string;
  description: string;
  moderator: OptionalBoolean;
  audienceOnStage: OptionalBoolean;
  props: OptionalBoolean;
  furniture: string;
  furnitureKinds: Array<'chairs' | 'tables'>;
  note: string;
  tags: string[];
  searchText: string;
}

export interface FilterState {
  query: string;
  formTag: string | null;
  featureTags: string[];
  moderator: TriState;
  audience: TriState;
  props: TriState;
  furniture: FurnitureFilter;
  selectedId: string | null;
}

export interface CachedFormats {
  schemaVersion: 1;
  fetchedAt: string;
  records: FormatRecord[];
}
