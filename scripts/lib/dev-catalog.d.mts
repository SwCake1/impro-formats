import type { Plugin } from 'vite';

export function devCatalogPlugin(options: {
  env: Record<string, string>;
  sheetName: 'Все форматы' | 'Опубликовано';
}): Plugin;
