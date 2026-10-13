import { describe, expect, it } from 'vitest';
import manifest from '../../scripts/assets-manifest.json';
import { modelAssetSet, modelAssetVersion, modelBasePath, physicalAssetPath } from '../../scripts/model-assets.mjs';

describe('model asset-set identity', () => {
  it('includes five model files and both notices, but excludes unrelated runtime pins', () => {
    const set = modelAssetSet(manifest);
    expect(set.files).toHaveLength(7);
    expect(set.basePath).toMatch(/^\/models\/[a-f0-9]{64}\/$/);
    for (const file of set.files) expect(physicalAssetPath(file, manifest)).toContain(`${set.basePath}multilingual-e5-small/`);
    expect(physicalAssetPath(manifest.pdfium.files[0], manifest)).toBe(manifest.pdfium.files[0].path);
  });
  it('is independent of manifest order, and changes for each model file or notice change', () => {
    const reordered = structuredClone(manifest);
    reordered.embedding.files.reverse(); reordered.notices.reverse();
    expect(modelAssetVersion(reordered)).toBe(modelAssetVersion(manifest));
    for (const file of modelAssetSet(manifest).files) {
      const changed = structuredClone(manifest);
      const pin = [...changed.embedding.files, ...changed.notices].find(entry => entry.path === file.path)!;
      pin.sha256 = 'a'.repeat(64);
      expect(modelAssetVersion(changed)).not.toBe(modelAssetVersion(manifest));
      pin.sha256 = file.sha256; pin.bytes += 1;
      expect(modelAssetVersion(changed)).not.toBe(modelAssetVersion(manifest));
    }
    const unrelated = structuredClone(manifest); unrelated.pdfium.files[0].sha256 = 'a'.repeat(64);
    expect(modelBasePath(unrelated)).toBe(modelBasePath(manifest));
  });
  it('rejects duplicate, unsafe, or already physical model pins', () => {
    const duplicate = structuredClone(manifest); duplicate.embedding.files.push(duplicate.embedding.files[0]);
    expect(() => modelAssetSet(duplicate)).toThrow('duplicate');
    const unsafe = structuredClone(manifest); unsafe.embedding.files[0].path = 'static/models/multilingual-e5-small/../secret';
    expect(() => modelAssetSet(unsafe)).toThrow('Invalid model asset pin');
    const physical = structuredClone(manifest); physical.embedding.files[0].path = physicalAssetPath(physical.embedding.files[0], physical);
    expect(() => modelAssetSet(physical)).toThrow('logical model directory');
  });
});
