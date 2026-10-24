import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
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
});
