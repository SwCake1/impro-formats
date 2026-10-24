import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    'import.meta.env.VERCEL': JSON.stringify(loadEnv(mode, '.', 'VERCEL').VERCEL === '1'),
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
  },
}));
