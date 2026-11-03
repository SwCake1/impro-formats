import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateReview, renderReviewHtml } from './generate-format-review.mjs';

const examplePath = fileURLToPath(new URL('../tools/format-review/example-batch.json', import.meta.url));
const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'format-review-'));
  temporaryDirectories.push(path);
  return path;
}

describe('standalone review generator', () => {
  it('generates one HTML with embedded data, styles and code', async () => {
    const outputPath = join(await directory(), 'nested/review.html');
    expect(await generateReview({ inputPath: examplePath, outputPath })).toBe(outputPath);
    const html = await readFile(outputPath, 'utf8');
    expect(html).toContain('Радио из будущего');
    expect(html).toContain('function parseReviewBatch');
    expect(html).toContain('class="export-bar"');
    expect(html).not.toMatch(/@@REVIEW_|<script[^>]+src=|<link[^>]+href=/);
  });

  it.each(['not json', '{"schemaVersion":3}'])('preserves an existing output on invalid input: %s', async content => {
    const root = await directory();
    const inputPath = join(root, 'batch.json');
    const outputPath = join(root, 'review.html');
    await writeFile(inputPath, content);
    await writeFile(outputPath, 'previous output');
    await expect(generateReview({ inputPath, outputPath })).rejects.toThrow();
    expect(await readFile(outputPath, 'utf8')).toBe('previous output');
  });

  it('rejects a recommendation that clears catalog data without replacing the existing HTML', async () => {
    const root = await directory();
    const inputPath = join(root, 'batch.json');
    const outputPath = join(root, 'review.html');
    const batch = JSON.parse(await readFile(examplePath, 'utf8'));
    batch.candidates[1].recommendation = { action: 'update', targetId: 'press-konferentsiya',
      reason: 'Некорректная рекомендация', changes: { moderator: null } };
    await writeFile(inputPath, JSON.stringify(batch));
    await writeFile(outputPath, 'previous output');
    await expect(generateReview({ inputPath, outputPath })).rejects.toThrow('recommendation.changes.moderator');
    expect(await readFile(outputPath, 'utf8')).toBe('previous output');
  });

  it.each(['public', 'dist'])('rejects output in %s, including a symlinked parent', async folder => {
    const root = await directory();
    const forbidden = fileURLToPath(new URL(`../${folder}/`, import.meta.url));
    await expect(generateReview({ inputPath: examplePath, outputPath: join(forbidden, 'must-not-exist.html') }))
      .rejects.toThrow('вне public/ и dist/');
    // The symlink target must exist even when no build has created dist yet.
    await mkdir(forbidden, { recursive: true });
    const linked = join(root, 'alias');
    await symlink(forbidden, linked, 'dir');
    await expect(generateReview({ inputPath: examplePath, outputPath: join(linked, 'must-not-exist.html') }))
      .rejects.toThrow('вне public/ и dist/');
  });

  it('embeds untrusted JSON without interpreting script terminators or replacement tokens', async () => {
    const batch = JSON.parse(await readFile(examplePath, 'utf8'));
    const dangerous = '</script><script>globalThis.injected=true</script> $& @@REVIEW_CODE@@ \u2028';
    batch.candidates[0].format.description = dangerous;
    const html = await renderReviewHtml(batch);
    const json = html.match(/<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
    expect(json).not.toContain('</script>');
    expect(JSON.parse(json).candidates[0].format.description).toBe(dangerous);
    expect(html).not.toContain('<script>globalThis.injected');
  });

  it('uses a supplied catalog snapshot without embedding its records', async () => {
    const root = await directory();
    const catalogPath = join(root, 'catalog.json');
    await writeFile(catalogPath, JSON.stringify({ schemaVersion: 3, records: [{
      title: 'Existing description must not be embedded', forms: ['Длинная форма'], features: ['Только в каталоге'], collections: ['JAM'],
    }] }));
    const outputPath = join(root, 'review.html');
    await generateReview({ inputPath: examplePath, outputPath, catalogPath });
    const html = await readFile(outputPath, 'utf8');
    const data = JSON.parse(html.match(/<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    expect(data.classificationOptions.features).toContain('Только в каталоге');
    expect(data.classificationOptions.forms).toContain('Короткая форма');
    expect(html).not.toContain('Existing description must not be embedded');
  });
});
