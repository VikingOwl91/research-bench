import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BenchStorage, DB_NAME, StorageConflict, type StoredChunk } from '../../src/lib/storage';
import { EMBEDDING_VERSION } from '../../src/lib/constants';
import type { Artifact, ChatMessage, Notebook, Source } from '../../src/lib/types';

let storage: BenchStorage;
function ready(notebook: Notebook, id = crypto.randomUUID()): { source: Source; chunks: StoredChunk[] } {
  const text = 'Belegter Quellentext.';
  const source: Source = { id, notebookId: notebook.id, name: 'Quelle.txt', kind: 'txt', size: text.length, createdAt: 1, parser: 'test', original: new Blob([text]), pages: [{ page: 1, text }], chunkCount: 1 };
  const vector = new Float32Array(384); vector[0] = 1;
  return { source, chunks: [{ id: `chunk-${id}`, sourceId: id, notebookId: notebook.id, page: 1, start: 0, end: text.length, text, vector, embeddingVersion: EMBEDDING_VERSION }] };
}
function message(n: Notebook, revision: number): ChatMessage {
  return { id: crypto.randomUUID(), notebookId: n.id, revision, createdAt: 10, role: 'user', text: 'Eine Frage', citations: [] };
}
function artifact(n: Notebook, revision: number): Artifact {
  return { id: crypto.randomUUID(), notebookId: n.id, revision, createdAt: 20, kind: 'summary', answer: { title: 'Zusammenfassung', blocks: [{ text: 'Text', citationIds: [] }] }, citations: [], coverage: { selectedCharacters: 0, totalCharacters: 0, selectedSources: 0, totalSources: 0, limited: false }, provider: 'mistral', model: 'test' };
}
beforeEach(async () => { storage = new BenchStorage(); await storage.clear(); });
afterEach(async () => { await storage.clear(); await storage.close(); });

describe('IndexedDB atomic source persistence', () => {
  it('aborts an in-flight source transaction after its source record is staged, rolling it back', async () => {
    const n = await storage.createNotebook('Notebook');
    const data = ready(n);
    const abort = new AbortController();
    const original = IDBObjectStore.prototype.add;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const request = original.call(this, value, key);
      if (this.name === 'chunks') queueMicrotask(() => abort.abort());
      return request;
    });
    try {
      await expect(storage.saveSource(data.source, data.chunks, 0, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
      expect(abort.signal.aborted).toBe(true);
      expect((await storage.loadNotebook(n.id)).sources).toEqual([]);
      expect((await storage.loadNotebook(n.id)).notebook?.revision).toBe(0);
      expect(await storage.chunks(n.id)).toEqual([]);
    } finally { spy.mockRestore(); }
  });
  it('rejects already canceled writes before opening a mutation transaction', async () => {
    const n = await storage.createNotebook('Notebook');
    const data = ready(n);
    const abort = new AbortController(); abort.abort();
    await expect(storage.saveSource(data.source, data.chunks, 0, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(storage.saveMessages([message(n, 0)], 0, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(storage.saveArtifact(artifact(n, 0), abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect((await storage.loadNotebook(n.id)).sources).toEqual([]);
    expect((await storage.loadNotebook(n.id)).messages).toEqual([]);
    expect((await storage.loadNotebook(n.id)).artifacts).toEqual([]);
  });
  it('persists ready source, original bytes and vectors together while increasing revision', async () => {
    const n = await storage.createNotebook('Notebook');
    const { source, chunks } = ready(n);
    await storage.saveSource(source, chunks, n.revision);
    const reopened = new BenchStorage();
    try {
      const data = await reopened.loadNotebook(n.id);
      expect(data.notebook?.revision).toBe(1);
      expect(data.sources).toHaveLength(1);
      expect(await data.sources[0].original.text()).toBe(source.pages[0].text);
      const vectors = await reopened.chunks(n.id);
      expect(vectors).toHaveLength(1);
      expect(vectors[0].vector).toBeInstanceOf(Float32Array);
      expect(vectors[0].vector[0]).toBe(1);
    } finally { await reopened.close(); }
  });
  it.each(['empty', 'dimensions', 'nonfinite', 'source', 'notebook'] as const)('rejects incomplete %s indices without partial records or a revision increment', async failure => {
    const n = await storage.createNotebook('Notebook');
    const { source, chunks } = ready(n);
    if (failure === 'empty') chunks.length = 0;
    if (failure === 'dimensions') chunks[0].vector = new Float32Array(383);
    if (failure === 'nonfinite') chunks[0].vector[0] = NaN;
    if (failure === 'source') chunks[0].sourceId = 'foreign';
    if (failure === 'notebook') chunks[0].notebookId = 'foreign';
    await expect(storage.saveSource(source, chunks, 0)).rejects.toThrow(/unvollständig/);
    expect((await storage.loadNotebook(n.id)).sources).toEqual([]);
    expect((await storage.loadNotebook(n.id)).notebook?.revision).toBe(0);
    expect(await storage.chunks(n.id)).toEqual([]);
  });
  it('allows only one concurrent source import for the same frozen revision', async () => {
    const n = await storage.createNotebook('Notebook');
    const a = ready(n), b = ready(n);
    const results = await Promise.allSettled([storage.saveSource(a.source, a.chunks, 0), storage.saveSource(b.source, b.chunks, 0)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(StorageConflict);
    expect((await storage.loadNotebook(n.id)).sources).toHaveLength(1);
    expect(await storage.chunks(n.id)).toHaveLength(1);
    expect((await storage.loadNotebook(n.id)).notebook?.revision).toBe(1);
  });
  it('rolls back every record if a duplicate chunk key fails midway through import', async () => {
    const n = await storage.createNotebook('Notebook');
    const { source, chunks } = ready(n);
    await expect(storage.saveSource(source, [chunks[0], { ...chunks[0] }], 0)).rejects.toMatchObject({ name: 'ConstraintError' });
    expect((await storage.loadNotebook(n.id)).sources).toEqual([]);
    expect((await storage.loadNotebook(n.id)).notebook?.revision).toBe(0);
    expect(await storage.chunks(n.id)).toEqual([]);
  });
  it('rejects writes to an already deleted notebook', async () => {
    const n = await storage.createNotebook('Notebook');
    const data = ready(n);
    await storage.deleteNotebook(n.id);
    await expect(storage.saveSource(data.source, data.chunks, 0)).rejects.toBeInstanceOf(StorageConflict);
    expect((await storage.loadNotebook(n.id)).notebook).toBeNull();
    expect(await storage.chunks(n.id)).toEqual([]);
  });
});

describe('source revisions, isolation and deletion', () => {
  it.each(['messages', 'artifacts'] as const)('rolls back %s when canceled before commit', async kind => {
    const n = await storage.createNotebook('Notebook');
    const abort = new AbortController();
    const original = IDBObjectStore.prototype.put;
    let writes = 0;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const request = original.call(this, value, key);
      if (this.name === kind && ++writes === (kind === 'messages' ? 2 : 1)) queueMicrotask(() => abort.abort());
      return request;
    });
    try {
      const writing = kind === 'messages' ? storage.saveMessages([message(n, 0), message(n, 0)], 0, abort.signal) : storage.saveArtifact(artifact(n, 0), abort.signal);
      await expect(writing).rejects.toMatchObject({ name: 'AbortError' });
      expect(abort.signal.aborted).toBe(true);
      expect((await storage.loadNotebook(n.id))[kind]).toEqual([]);
    } finally { spy.mockRestore(); }
  });
  it('keeps notebooks separate and cascades notebook deletion without touching another notebook', async () => {
    const a = await storage.createNotebook('A'), b = await storage.createNotebook('B');
    const sa = ready(a), sb = ready(b);
    await storage.saveSource(sa.source, sa.chunks, 0); await storage.saveSource(sb.source, sb.chunks, 0);
    await storage.saveMessages([message(a, 1)], 1); await storage.saveMessages([message(b, 1)], 1);
    await storage.saveArtifact(artifact(a, 1)); await storage.saveArtifact(artifact(b, 1));
    await storage.deleteNotebook(a.id);
    expect(await storage.loadNotebook(a.id)).toEqual({ notebook: null, sources: [], messages: [], artifacts: [] });
    expect(await storage.chunks(a.id)).toEqual([]);
    const remaining = await storage.loadNotebook(b.id);
    expect(remaining.sources.map(s => s.id)).toEqual([sb.source.id]);
    expect(remaining.messages).toHaveLength(1);
    expect(remaining.artifacts).toHaveLength(1);
    expect(await storage.chunks(b.id)).toHaveLength(1);
  });
  it('removes source chunks and bumps revision, retaining historical messages/artifacts as stale', async () => {
    const n = await storage.createNotebook('Notebook');
    const data = ready(n);
    await storage.saveSource(data.source, data.chunks, 0);
    await storage.saveMessages([message(n, 1)], 1); await storage.saveArtifact(artifact(n, 1));
    await storage.deleteSource(data.source.id, n.id);
    const remaining = await storage.loadNotebook(n.id);
    expect(remaining.notebook?.revision).toBe(2);
    expect(remaining.sources).toEqual([]); expect(await storage.chunks(n.id)).toEqual([]);
    expect(remaining.messages[0].revision).toBe(1); expect(remaining.artifacts[0].revision).toBe(1);
    await expect(storage.saveMessages([message(n, 1)], 1)).rejects.toBeInstanceOf(StorageConflict);
    await expect(storage.saveArtifact(artifact(n, 1))).rejects.toBeInstanceOf(StorageConflict);
  });
  it('rejects cross-notebook deletion without changing either revision', async () => {
    const a = await storage.createNotebook('A'), b = await storage.createNotebook('B');
    const data = ready(a); await storage.saveSource(data.source, data.chunks, 0);
    await expect(storage.deleteSource(data.source.id, b.id)).rejects.toBeInstanceOf(StorageConflict);
    expect((await storage.loadNotebook(a.id)).notebook?.revision).toBe(1);
    expect((await storage.loadNotebook(a.id)).sources).toHaveLength(1);
    expect((await storage.loadNotebook(b.id)).notebook?.revision).toBe(0);
  });
  it('rejects an old embedding version and wrong vector dimension at retrieval after reload', async () => {
    const n = await storage.createNotebook('Notebook');
    const data = ready(n); await storage.saveSource(data.source, data.chunks, 0);
    const db = await openDB(DB_NAME, 1);
    await db.put('chunks', { ...data.chunks[0], embeddingVersion: 'obsolete-model' });
    await expect(storage.chunks(n.id)).rejects.toThrow(/Modellversion/);
    await db.put('chunks', { ...data.chunks[0], vector: new Float32Array(100) });
    await expect(storage.chunks(n.id)).rejects.toThrow(/Modellversion/);
    db.close();
  });
  it('clears original documents, vectors, history, artifacts and notebooks', async () => {
    const n = await storage.createNotebook('Notebook');
    const data = ready(n); await storage.saveSource(data.source, data.chunks, 0);
    await storage.saveMessages([message(n, 1)], 1); await storage.saveArtifact(artifact(n, 1));
    await storage.clear();
    expect(await storage.listNotebooks()).toEqual([]);
    expect(await storage.loadNotebook(n.id)).toEqual({ notebook: null, sources: [], messages: [], artifacts: [] });
    expect(await storage.chunks(n.id)).toEqual([]);
  });
});
