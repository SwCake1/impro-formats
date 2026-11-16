import { configDefaults, defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { devCatalogPlugin } from './scripts/lib/dev-catalog.mjs';

export default defineConfig(({ mode, command, isPreview }) => {
  const source = command !== 'serve' || isPreview || mode === 'test' || mode === 'cached'
    ? 'file' : mode === 'published' ? 'published' : 'working';
  return {
    base: './',
    plugins: [{
      name: 'tool-directory-pages',
      configureServer(server) {
        // Match the directory indexes served by Vercel and GitHub Pages.
        server.middlewares.use((request: { url?: string }, _response, next) => {
          const url = new URL(request.url ?? '/', 'http://localhost');
          if (/^\/tools\/(?:[a-z-]+\/)?$/.test(url.pathname)) {
            request.url = `${url.pathname}index.html${url.search}`;
          }
          next();
        });
      },
    }, ...(source === 'file' ? [] : [devCatalogPlugin({
      env: loadEnv(mode, '.', 'GOOGLE_'),
      sheetName: source === 'published' ? 'Опубликовано' : 'Все форматы',
    })])],
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
