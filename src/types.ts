export type OptionalBoolean = boolean | null;
export type TriState = 'any' | 'yes' | 'no';
export type FurnitureFilter = 'any' | 'none' | 'chairs' | 'tables';

export interface FormatRecord {
  id: string;
  title: string;
  description: string;
  moderator: OptionalBoolean;
  audienceOnStage: OptionalBoolean;
  props: OptionalBoolean;
  furniture: string;
  furnitureKinds: Array<'chairs' | 'tables'>;
  note: string;
  forms: string[];
  features: string[];
  collections: string[];
  searchText: string;
}

export interface FilterState {
  query: string;
  formTag: string | null;
  featureTags: string[];
  collectionTags: string[];
  moderator: TriState;
  audience: TriState;
  props: TriState;
  furniture: FurnitureFilter;
  selectedId: string | null;
}

export interface CachedFormats {
  schemaVersion: 3;
  fetchedAt: string;
  etag: string | null;
  records: FormatRecord[];
}
