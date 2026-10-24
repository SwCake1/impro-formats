import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { CatalogImportError, loadPublishedCatalog } from './lib/published-catalog.mjs';

async function main() {
  // Получаем и проверяем снимок до запуска сборки и изменения dist.
  const env = loadEnv('production', process.cwd(), '');
  const catalog = await loadPublishedCatalog(env);
  console.log('Получен снимок «Опубликовано». Форматов: ' + catalog.records.length);

  const build = spawnSync('npm', ['run', 'build'], {
    stdio: 'inherit',
    shell: false,
  });
  if (build.error || build.status !== 0) {
    throw new CatalogImportError('Сборка сайта завершилась ошибкой.');
  }

  // В публикацию попадают только проверенные публичные поля каталога.
  // Сохранённый public/data/formats.json в репозитории остаётся прежним.
  await mkdir('dist/data', { recursive: true });
  await writeFile('dist/data/formats.json', JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  console.log('Сайт собран с одобренным снимком: ' + catalog.records.length + ' форматов.');
}

main().catch((error) => {
  console.error(error instanceof CatalogImportError ? error.message : 'Не удалось собрать сайт с опубликованным каталогом.');
  process.exitCode = 1;
});
