import { configDefaults, defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { devCatalogPlugin } from './scripts/lib/dev-catalog.mjs';

export default defineConfig(({ mode, command, isPreview }) => {
  const source = command !== 'serve' || isPreview || mode === 'test' || mode === 'cached'
    ? 'file' : mode === 'published' ? 'published' : 'working';
  return {
    base: './',
    plugins: source === 'file' ? [] : [devCatalogPlugin({
      env: loadEnv(mode, '.', 'GOOGLE_'),
      sheetName: source === 'published' ? 'Опубликовано' : 'Все форматы',
    })],
    define: {
      'import.meta.env.VERCEL': JSON.stringify(loadEnv(mode, '.', 'VERCEL').VERCEL === '1'),
      'import.meta.env.CATALOG_SOURCE': JSON.stringify(source),
    },
    server: {
      fs: {
        deny: [
          '.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}',
          '.npmrc', '.yarnrc.yml', '**/.git/**', '**/ignore/**',
        ],
      },
    },
    build: {
      target: 'es2022',
    },
    test: {
      environment: 'node',
      exclude: [...configDefaults.exclude, 'tests/browser/**'],
    },
  };
});
