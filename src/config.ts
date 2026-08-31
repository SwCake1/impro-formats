export const SHEET_ID = '1AfoTVt6XzkpTk8UZAfBpzQlpSSKTyRkziyt4cglOMKU';
export const SHEET_GID = '0';
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${SHEET_GID}#gid=${SHEET_GID}`;
export const DATA_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}&range=A:H`;

export const FORM_TAGS = [
  'Короткая форма',
  'Длинная форма',
  'JAM',
  'Импровизация.Команды',
] as const;

export const FEATURE_TAGS = [
  'Музыкальные',
  'Угадайки',
  'Иностранные',
  'Экстремальные',
  'Чёрный юмор',
] as const;
