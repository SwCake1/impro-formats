import { readFile, writeFile, mkdir, rename, rm, realpath, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, dirname, basename, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseReviewBatch, reviewClassificationOptions } from './lib/format-review.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const toolRoot = new URL('../tools/format-review/', import.meta.url);

async function canonicalPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // A dangling symlink cannot be resolved safely; do not guess its target.
    const entry = await lstat(path).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (entry?.isSymbolicLink()) throw new Error('Выходной путь содержит неразрешимую символическую ссылку.');
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonicalPath(parent), basename(path));
  }
}

function inside(path, root) {
  const rel = relative(root, path);
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'));
}

async function checkOutput(path) {
  const canonical = await canonicalPath(path);
  for (const name of ['public', 'dist']) {
    const forbidden = resolve(projectRoot, name);
    const canonicalForbidden = await canonicalPath(forbidden);
    if (inside(path, forbidden) || inside(canonical, canonicalForbidden)) {
      throw new Error('Сохраните HTML вне public/ и dist/, например в ignore/format-review/.');
    }
  }
}

export async function renderReviewHtml(input, { catalog } = {}) {
  const batch = parseReviewBatch(input);
  if (catalog === undefined && !batch.classificationOptions) {
    catalog = JSON.parse(await readFile(new URL('../public/data/formats.json', import.meta.url), 'utf8'));
  }
  batch.classificationOptions = reviewClassificationOptions(batch, catalog);
  const [template, styles, model, app] = await Promise.all([
    readFile(new URL('template.html', toolRoot), 'utf8'),
    readFile(new URL('styles.css', toolRoot), 'utf8'),
    readFile(new URL('lib/format-review.mjs', import.meta.url), 'utf8'),
    readFile(new URL('app.js', toolRoot), 'utf8'),
  ]);
  const data = JSON.stringify(batch).replace(/[<>&\u2028\u2029]/g,
    char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const replacements = { STYLES: styles, DATA: data, CODE: `${model}\n${app}` };
  // One pass: neither replacement tokens nor $ sequences inside input are evaluated.
  return template.replace(/(?:\/\*\s*)?@@REVIEW_(STYLES|DATA|CODE)@@(?:\s*\*\/)?/g, (_, key) => replacements[key]);
}

export async function generateReview({ inputPath, outputPath = resolve(projectRoot, 'ignore/format-review/review.html'), catalogPath }) {
  if (!inputPath) throw new Error('Укажите --input <batch.json>.');
  const destination = resolve(outputPath);
  await checkOutput(destination);
  if (await canonicalPath(resolve(inputPath)) === await canonicalPath(destination)) {
    throw new Error('Входной JSON и выходной HTML должны быть разными файлами.');
  }
  let input;
  try {
    input = JSON.parse(await readFile(inputPath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Входной файл содержит некорректный JSON.');
    throw error;
  }
  const catalog = catalogPath ? JSON.parse(await readFile(catalogPath, 'utf8')) : undefined;
  const html = await renderReviewHtml(input, { catalog });
  await mkdir(dirname(destination), { recursive: true });
  // Recheck after creating parent directories, before writing any data.
  await checkOutput(destination);
  const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, html, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  return destination;
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('npm run review:generate -- --input <batch.json> [--output <review.html>] [--catalog <catalog.json>]');
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = { '--input': 'inputPath', '--output': 'outputPath', '--catalog': 'catalogPath' }[args[index]];
    if (!key || !args[index + 1] || args[index + 1].startsWith('--') || options[key]) {
      throw new Error('Используйте --input <batch.json> [--output <review.html>] [--catalog <catalog.json>].');
    }
    options[key] = args[index + 1];
  }
  console.log(`Готово: ${await generateReview(options)}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`Не удалось создать HTML: ${error.message}`);
    process.exitCode = 1;
  });
}
