/** Logical pins stay stable; URLs change whenever any model file or notice changes. */
import { createHash } from 'node:crypto';

const logicalRoot = 'static/models/multilingual-e5-small/';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function modelAssetSet(manifest) {
  const files = [...manifest.embedding.files, ...(manifest.notices ?? []).filter(file => file.path.startsWith(logicalRoot))];
  const records = files.map(file => {
    if (!file.path.startsWith(logicalRoot)) throw new Error('Model asset is outside its logical model directory');
    const path = file.path.slice(logicalRoot.length);
    if (!/^[A-Za-z0-9_.\/-]+$/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..') ||
      !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new Error('Invalid model asset pin');
    return { path, sha256: file.sha256, bytes: file.bytes };
  }).sort((a, b) => compare(a.path, b.path));
  if (!records.length || new Set(records.map(file => file.path)).size !== records.length) throw new Error('Empty or duplicate model asset set');
  const digest = createHash('sha256').update(`${JSON.stringify(records)}\n`).digest('hex');
  return { digest, basePath: `/models/${digest}/`, files };
}

export const modelAssetVersion = manifest => modelAssetSet(manifest).digest;
export const modelBasePath = manifest => modelAssetSet(manifest).basePath;

export function physicalAssetPath(file, manifest) {
  if (!file.path.startsWith(logicalRoot)) return file.path;
  return `static${modelBasePath(manifest)}multilingual-e5-small/${file.path.slice(logicalRoot.length)}`;
}
export const versionedModelPath = physicalAssetPath;
