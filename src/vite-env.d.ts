/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VERCEL: boolean;
  readonly CATALOG_SOURCE: 'file' | 'working' | 'published';
}
