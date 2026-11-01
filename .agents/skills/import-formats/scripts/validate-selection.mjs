import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

async function projectRoot() {
  for (const start of [process.cwd(), dirname(await realpath(fileURLToPath(import.meta.url)))]) {
    let path = start;
    while (true) {
      try {
        await readFile(join(path, 'scripts/lib/format-review.mjs'));
        return path;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      }
      const parent = dirname(path);
      if (parent === path) break;
      path = parent;
    }
  }
  throw new Error('Impro Formats project not found. Run this command from its root.');
}

const root = await projectRoot();
const { parseReviewBatch, parseReviewFormat, reviewUpdateBase, createReviewSelection } =
  await import(pathToFileURL(join(root, 'scripts/lib/format-review.mjs')).href);

function object(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected an object`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${label}.${key}: unknown field`);
  }
}

export function validateSelection(inputBatch, selection) {
  const batch = parseReviewBatch(inputBatch);
  object(selection, 'selection', ['schemaVersion', 'kind', 'batchId', 'candidates']);
  if (selection.schemaVersion !== 2 || selection.kind !== 'format-review-selection') {
    throw new Error('Expected format-review-selection version 2 from the Copy for agent button');
  }
  if (selection.batchId !== batch.batchId) throw new Error('batchId: the selection belongs to a different batch');
  if (!Array.isArray(selection.candidates)) throw new Error('candidates: expected an array');
  const selected = new Set(), drafts = new Map(), modes = new Map();
  for (const row of selection.candidates) {
    const contextKeys = ['candidateId', 'action', 'source', 'similarFormats', 'recommendation'];
    object(row, 'candidate', [...contextKeys, ...(row?.action === 'create' ? ['format'] : ['targetId', 'targetTitle', 'changes'])]);
    const candidate = batch.candidates.find(candidate => candidate.candidateId === row.candidateId);
    if (!candidate) throw new Error(`candidateId: unknown candidate ${String(row.candidateId)}`);
    if (selected.has(row.candidateId)) throw new Error(`candidateId: duplicate ${row.candidateId}`);
    selected.add(row.candidateId);
    if (row.action === 'create') {
      if (!Object.hasOwn(row, 'format')) throw new Error(`${row.candidateId}: missing format`);
      drafts.set(row.candidateId, parseReviewFormat(row.format, `candidate.${row.candidateId}.format`));
      modes.set(row.candidateId, { action: 'create' });
    } else if (row.action === 'update') {
      const matches = (candidate.similarFormats ?? []).filter(match => match.id === row.targetId);
      if (matches.length !== 1) throw new Error(`${row.candidateId}: target is missing or ambiguous in the original batch`);
      const base = reviewUpdateBase(matches[0]);
      if (row.targetTitle !== matches[0].title) throw new Error(`${row.candidateId}: targetTitle does not match the original snapshot`);
      object(row.changes, 'changes', Object.keys(base));
      const edited = structuredClone(base);
      for (const [key, change] of Object.entries(row.changes)) {
        object(change, `changes.${key}`, ['before', 'after']);
        if (!Object.hasOwn(change, 'before') || !Object.hasOwn(change, 'after')) {
          throw new Error(`changes.${key}: before and after are required`);
        }
        if (!isDeepStrictEqual(change.before, base[key])) throw new Error(`changes.${key}.before: does not match the original snapshot`);
        if (isDeepStrictEqual(change.before, change.after)) throw new Error(`changes.${key}: field is unchanged`);
        edited[key] = change.after;
      }
      drafts.set(row.candidateId, edited);
      modes.set(row.candidateId, { action: 'update', targetId: row.targetId });
    } else {
      throw new Error(`${row.candidateId}: expected action create or update`);
    }
  }
  return createReviewSelection(batch, selected, drafts, modes);
}

async function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = { '--batch': 'batch', '--selection': 'selection' }[args[index]];
    if (!key || !args[index + 1] || args[index + 1].startsWith('--') || options[key]) {
      throw new Error('Use --batch <batch.json> --selection <selection.json>');
    }
    options[key] = args[index + 1];
  }
  if (!options.batch || !options.selection) throw new Error('--batch and --selection are required');
  const batch = JSON.parse(await readFile(options.batch, 'utf8'));
  const selection = JSON.parse(await readFile(options.selection, 'utf8'));
  process.stdout.write(JSON.stringify(validateSelection(batch, selection), null, 2) + '\n');
}

if (process.argv[1] && await realpath(resolve(process.argv[1])) === await realpath(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`Review selection rejected: ${error.message}`);
    process.exitCode = 1;
  });
}
