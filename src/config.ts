export const DATA_URL = `${import.meta.env.BASE_URL}data/formats.json`;

// Только для чтения прежнего JSON, кэша и старых ссылок.
export const LEGACY_FORM_TAGS = [
  'Короткая форма',
  'Длинная форма',
] as const;

export const LEGACY_COLLECTION_TAGS = ['JAM', 'Импровизация.Команды', 'Иностранные'] as const;
