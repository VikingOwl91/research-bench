import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchBenchController } from '../../src/lib/controller';
import { EMBEDDING_VERSION, LIMITS } from '../../src/lib/constants';
import { BenchStorage, DB_NAME, StorageConflict, type StoredChunk } from '../../src/lib/storage';
import { LocalPipeline, type IndexResult } from '../../src/lib/pipeline';
import { translateMessage } from '../../src/lib/i18n';
import { runtimeErrorDescriptor } from '../../src/lib/i18n/runtime-errors';
import type { AppSnapshot, Notebook, Source } from '../../src/lib/types';

class MemoryStorage implements Storage {
  private entries = new Map<string, string>();
  get length() { return this.entries.size; }
  clear() { this.entries.clear(); }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
  removeItem(key: string) { this.entries.delete(key); }
  setItem(key: string, value: string) { this.entries.set(key, String(value)); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function indexed(payload: Parameters<LocalPipeline['index']>[0]): IndexResult {
  const text = 'A small supported source.';
  return { parser: 'test', pages: [{ page: 1, text }], chunks: [{ id: `${payload.sourceId}:1`, notebookId: payload.notebookId, sourceId: payload.sourceId,
    page: 1, start: 0, end: text.length, text, vector: new Float32Array(384).fill(0.01), embeddingVersion: EMBEDDING_VERSION }] };
}
class TestPipeline extends LocalPipeline {
  override cancel = vi.fn();
  override index = vi.fn<LocalPipeline['index']>().mockImplementation(async payload => indexed(payload));
}
function sourceData(notebook: Notebook, text = 'A small supported source.') {
  const id = crypto.randomUUID();
  const payload = { notebookId: notebook.id, sourceId: id, kind: 'txt' as const, bytes: new ArrayBuffer(1), remainingChunks: 1000, remainingCharacters: 500000 };
  const result = indexed(payload);
  const source: Source = { id, notebookId: notebook.id, name: `${id}.txt`, kind: 'txt', size: text.length, createdAt: Date.now(), original: new Blob([text]), pages: [{ page: 1, text }], parser: 'test', chunkCount: 1 };
  return { source, chunks: result.chunks };
}
const file = (name = 'source.txt') => new File(['A small supported source.'], name);
function observedFile(name: string) {
  const value = file(name);
  const read = vi.spyOn(value, 'arrayBuffer');
  return { value, read };
}
let storage: BenchStorage;
let pipeline: TestPipeline;
let controller: ResearchBenchController;
let state: AppSnapshot;
beforeEach(async () => {
  vi.stubGlobal('sessionStorage', new MemoryStorage()); vi.stubGlobal('localStorage', new MemoryStorage());
  storage = new BenchStorage(); await storage.clear(); pipeline = new TestPipeline();
  controller = new ResearchBenchController(storage, pipeline); controller.subscribe(value => { state = value; });
  await controller.initialize();
});
afterEach(async () => { controller.cancel(); await storage.clear(); await storage.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function seed(count: number) {
  const notebook = state.activeNotebook!;
  for (let i = 0; i < count; i++) {
    const data = sourceData(notebook); await storage.saveSource(data.source, data.chunks, i);
  }
  await controller.refreshSources();
}
function statuses() { return state.importBatch?.files.map(value => value.status); }

describe('source capacity and unchanged notebook limits', () => {
  it('changes only the source count limit', () => {
    expect(LIMITS).toEqual({ sources: 50, fileBytes: 10 * 1024 * 1024, characters: 500000, chunks: 1000, contextCharacters: 24000 });
  });
  it.each([0, 1, 49, 50])('reopens %i existing sources without a schema or embedding change', async count => {
    await seed(count);
    const other = new BenchStorage();
    try {
      const original = await other.loadNotebook(state.activeNotebook!.id);
      const reopened = new ResearchBenchController(other, new TestPipeline());
      let next!: AppSnapshot; reopened.subscribe(value => { next = value; });
      await reopened.initialize();
      expect(next.sources).toEqual(original.sources); expect(next.activeNotebook).toEqual(original.notebook);
      expect(next.sources).toHaveLength(count); expect(await other.chunks(next.activeNotebook!.id)).toHaveLength(count);
      const db = await openDB(DB_NAME); expect(db.version).toBe(2); db.close(); reopened.cancel();
    } finally { await other.close(); }
  });
  it('imports only the final available file in a batch and never reads or indexes its excess prefix remainder', async () => {
    await seed(49);
    const final = observedFile('50.txt'), excess = observedFile('51.txt'), trailing = observedFile('52.txt');
    await controller.importFiles([final.value, excess.value, trailing.value]);
    expect(state.sources).toHaveLength(50); expect(pipeline.index).toHaveBeenCalledTimes(1);
    expect(final.read).toHaveBeenCalledTimes(1); expect(excess.read).not.toHaveBeenCalled(); expect(trailing.read).not.toHaveBeenCalled();
    expect(statuses()).toEqual(['imported', 'not-attempted', 'not-attempted']); expect(state.importBatch?.status).toBe('capacity');
    expect(state.errorMessage).toEqual({ key: 'runtime.sourceLimit', params: { limit: 50 } });
    const next = observedFile('another-51.txt'); await controller.importFiles([next.value]);
    expect(next.read).not.toHaveBeenCalled(); expect(pipeline.index).toHaveBeenCalledTimes(1); expect(statuses()).toEqual(['not-attempted']);
  });
  it('checks actual persisted capacity even when this tab still displays 49', async () => {
    await seed(49);
    const other = new BenchStorage();
    try { const data = sourceData(state.activeNotebook!); await other.saveSource(data.source, data.chunks, 49); }
    finally { await other.close(); }
    const excess = observedFile('51.txt'); await controller.importFiles([excess.value]);
    expect(excess.read).not.toHaveBeenCalled(); expect(pipeline.index).not.toHaveBeenCalled();
    expect(state.importBatch?.status).toBe('capacity');
    await controller.refreshSources(); expect(state.sources).toHaveLength(50);
  });
  it('allows only one competing tab to commit at 49, without orphan chunks', async () => {
    await seed(49);
    const other = new BenchStorage();
    try {
      const a = sourceData(state.activeNotebook!), b = sourceData(state.activeNotebook!);
      const results = await Promise.allSettled([storage.saveSource(a.source, a.chunks, 49), other.saveSource(b.source, b.chunks, 49)]);
      expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
      expect((results.find(value => value.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(StorageConflict);
      expect((await storage.loadNotebook(state.activeNotebook!.id)).sources).toHaveLength(50);
      expect(await storage.chunks(state.activeNotebook!.id)).toHaveLength(50);
      const excess = sourceData(state.activeNotebook!);
      await expect(other.saveSource(excess.source, excess.chunks, 50)).rejects.toMatchObject({ messageRef: { key: 'runtime.sourceLimit', params: { limit: 50 } } });
    } finally { await other.close(); }
  });
  it('refreshes a stale full notebook after other-tab deletion, then imports the available slot', async () => {
    await seed(50); const removed = state.sources[0];
    await controller.importFiles([file('blocked.txt')]); expect(state.errorMessage?.key).toBe('runtime.sourceLimit');
    const other = new BenchStorage();
    try { await other.deleteSource(removed.id, removed.notebookId); } finally { await other.close(); }
    expect(state.sources).toHaveLength(50);
    await controller.refreshSources(); expect(state.sources).toHaveLength(49); expect(state.error).toBeNull();
    await controller.importFiles([file('replacement.txt')]); expect(state.sources).toHaveLength(50);
    expect(state.sources.some(source => source.id === removed.id)).toBe(false);
    expect((await storage.chunks(removed.notebookId)).some(chunk => chunk.sourceId === removed.id)).toBe(false);
    expect(state.importBatch?.status).toBe('complete');
  });
  it('deletes and reimports locally at capacity', async () => {
    await seed(50); await controller.deleteSource(state.sources[0].id); expect(state.sources).toHaveLength(49);
    await controller.importFiles([file()]); expect(state.sources).toHaveLength(50); expect(statuses()).toEqual(['imported']);
  });
  it.each(['characters', 'chunks'] as const)('still rejects exceeding the existing %s limit transactionally', async kind => {
    const data = sourceData(state.activeNotebook!, kind === 'characters' ? 'a'.repeat(500001) : 'a');
    if (kind === 'chunks') data.chunks = Array.from({ length: 1001 }, (_, i): StoredChunk => ({ ...data.chunks[0], id: `${data.source.id}:${i}` }));
    await expect(storage.saveSource(data.source, data.chunks, 0)).rejects.toMatchObject({ messageRef: { key: 'runtime.storageNotebookLimit', params: { sources: 50 } } });
    expect((await storage.loadNotebook(state.activeNotebook!.id)).sources).toEqual([]); expect(await storage.chunks(state.activeNotebook!.id)).toEqual([]);
  });
  it.each(['characters', 'chunks'] as const)('accepts the exact existing %s boundary and rejects one more', async kind => {
    const data = sourceData(state.activeNotebook!, kind === 'characters' ? 'a'.repeat(500000) : 'a');
    if (kind === 'chunks') data.chunks = Array.from({ length: 1000 }, (_, i): StoredChunk => ({ ...data.chunks[0], id: `${data.source.id}:${i}` }));
    await storage.saveSource(data.source, data.chunks, 0);
    const extra = sourceData(state.activeNotebook!, 'a');
    await expect(storage.saveSource(extra.source, extra.chunks, 1)).rejects.toMatchObject({ messageRef: { key: 'runtime.storageNotebookLimit' } });
    expect((await storage.loadNotebook(state.activeNotebook!.id)).sources).toHaveLength(1);
    expect(await storage.chunks(state.activeNotebook!.id)).toHaveLength(kind === 'chunks' ? 1000 : 1);
  });
  it('accepts an actual file at exactly ten MiB', async () => {
    await controller.importFiles([new File([new Uint8Array(LIMITS.fileBytes)], 'exact-limit.txt')]);
    expect(state.sources[0].original.size).toBe(LIMITS.fileBytes); expect(statuses()).toEqual(['imported']);
  });
  it('keeps the ten-MiB check before any file read', async () => {
    const oversized = observedFile('large.txt'); Object.defineProperty(oversized.value, 'size', { value: LIMITS.fileBytes + 1 });
    await controller.importFiles([oversized.value]); expect(oversized.read).not.toHaveBeenCalled(); expect(pipeline.index).not.toHaveBeenCalled();
    expect(state.errorMessage?.key).toBe('runtime.fileTooLarge'); expect(statuses()).toEqual(['failed']);
  });
  it('preserves existing embedding compatibility checks before reading an additional file', async () => {
    const data = sourceData(state.activeNotebook!); data.chunks[0].embeddingVersion = 'obsolete-index';
    await storage.saveSource(data.source, data.chunks, 0); await controller.refreshSources();
    const additional = observedFile('additional.txt'); await controller.importFiles([additional.value]);
    expect(additional.read).not.toHaveBeenCalled(); expect(pipeline.index).not.toHaveBeenCalled();
    expect(state.errorMessage?.key).toBe('runtime.storageModelMismatch'); expect(state.sources).toHaveLength(1);
  });
  it('localizes capacity diagnostics with the real numeric limit', () => {
    const descriptor = { key: 'runtime.sourceLimit', params: { limit: 50 } } as const;
    expect(translateMessage('en', descriptor)).toContain('50 sources'); expect(translateMessage('de', descriptor)).toContain('50 Quellen');
  });
});

describe('sequential import accounting and cancellation', () => {
  it('stops at the first invalid file, preserving saved imports and reporting every remaining file', async () => {
    const later = observedFile('later.txt');
    await controller.importFiles([file('first.txt'), file('invalid.exe'), later.value]);
    expect(state.sources.map(source => source.name)).toEqual(['first.txt']); expect(later.read).not.toHaveBeenCalled();
    expect(statuses()).toEqual(['imported', 'failed', 'not-attempted']); expect(state.importBatch?.status).toBe('failed');
    expect(state.importBatch?.files[1].errorMessage?.key).toBe('runtime.fileKinds');
  });
  it('rolls back a quota-failed transaction while retaining the earlier committed prefix', async () => {
    const original = IDBObjectStore.prototype.add; let chunkWrites = 0;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'chunks' && ++chunkWrites === 2) { this.transaction.abort(); throw new DOMException('quota', 'QuotaExceededError'); }
      return original.call(this, value, key);
    });
    const later = observedFile('later.txt'); await controller.importFiles([file('saved.txt'), file('quota.txt'), later.value]);
    expect(state.sources.map(source => source.name)).toEqual(['saved.txt']); expect(await storage.chunks(state.activeNotebook!.id)).toHaveLength(1);
    expect(statuses()).toEqual(['imported', 'failed', 'not-attempted']); expect(later.read).not.toHaveBeenCalled();
    expect(state.importBatch?.files[1].errorMessage).toEqual(runtimeErrorDescriptor(new DOMException('quota', 'QuotaExceededError')));
  });
  it('distinguishes cancellation of an active file from files never attempted', async () => {
    const gate = deferred<IndexResult>(); pipeline.index.mockReturnValueOnce(gate.promise);
    const later = observedFile('later.txt'); const importing = controller.importFiles([file('active.txt'), later.value]);
    await vi.waitFor(() => expect(pipeline.index).toHaveBeenCalledTimes(1)); controller.cancel();
    gate.resolve(indexed(pipeline.index.mock.calls[0][0])); await importing;
    expect(statuses()).toEqual(['canceled', 'not-attempted']); expect(state.sources).toEqual([]); expect(later.read).not.toHaveBeenCalled();
  });
  it('does not start indexing when cancellation occurs during the file read', async () => {
    const gate = deferred<ArrayBuffer>(), active = file(); vi.spyOn(active, 'arrayBuffer').mockReturnValueOnce(gate.promise);
    const importing = controller.importFiles([active]); await vi.waitFor(() => expect(active.arrayBuffer).toHaveBeenCalled());
    controller.cancel(); gate.resolve(new ArrayBuffer(1)); await importing;
    expect(pipeline.index).not.toHaveBeenCalled(); expect(statuses()).toEqual(['canceled']); expect(state.sources).toEqual([]);
  });
  it('counts a committed source as imported when cancellation happens before saveSource returns', async () => {
    const committed = deferred<void>(), finish = deferred<void>(); const save = storage.saveSource.bind(storage);
    vi.spyOn(storage, 'saveSource').mockImplementationOnce(async (...args) => { await save(...args); committed.resolve(); await finish.promise; });
    const later = observedFile('later.txt'); const importing = controller.importFiles([file('saved.txt'), later.value]);
    await committed.promise; controller.cancel(); finish.resolve(); await importing;
    expect(statuses()).toEqual(['imported', 'not-attempted']); expect(state.importBatch?.status).toBe('canceled');
    expect(state.sources.map(source => source.name)).toEqual(['saved.txt']); expect(later.read).not.toHaveBeenCalled();
    expect((await storage.loadNotebook(state.activeNotebook!.id)).sources).toHaveLength(1);
  });
  it('does not let an old committed import overwrite a newer batch report', async () => {
    const committed = deferred<void>(), finish = deferred<void>(); const save = storage.saveSource.bind(storage);
    vi.spyOn(storage, 'saveSource').mockImplementationOnce(async (...args) => { await save(...args); committed.resolve(); await finish.promise; });
    const old = controller.importFiles([file('old.txt')]); await committed.promise; controller.cancel();
    await controller.refreshSources(); await controller.importFiles([file('new.txt')]); const report = state.importBatch;
    finish.resolve(); await old;
    expect(state.importBatch).toBe(report); expect(state.importBatch?.files[0].name).toBe('new.txt'); expect(state.sources).toHaveLength(2);
  });
  it('does not refresh a different notebook after an old import commits', async () => {
    const committed = deferred<void>(), finish = deferred<void>(); const save = storage.saveSource.bind(storage);
    vi.spyOn(storage, 'saveSource').mockImplementationOnce(async (...args) => { await save(...args); committed.resolve(); await finish.promise; });
    const original = state.activeNotebook!.id, importing = controller.importFiles([file()]); await committed.promise;
    await controller.createNotebook('Other'); const selected = state.activeNotebook!.id;
    finish.resolve(); await importing;
    expect(state.activeNotebook!.id).toBe(selected); expect(state.sources).toEqual([]); expect(state.importBatch).toBeNull();
    expect((await storage.loadNotebook(original)).sources).toHaveLength(1);
  });
  it('does not publish a delayed manual refresh into a newer notebook view', async () => {
    await seed(1); const loaded = deferred<void>(), finish = deferred<void>(); const load = storage.loadNotebook.bind(storage);
    vi.spyOn(storage, 'loadNotebook').mockImplementationOnce(async (...args) => { const data = await load(...args); loaded.resolve(); await finish.promise; return data; });
    const refreshing = controller.refreshSources(); await loaded.promise; await controller.createNotebook('New selection');
    const selected = state.activeNotebook!.id; finish.resolve(); await refreshing;
    expect(state.activeNotebook!.id).toBe(selected); expect(state.sources).toEqual([]);
  });
  it('clears outdated search results after explicit source refresh', async () => {
    await seed(1); const removed = state.sources[0];
    vi.spyOn(pipeline, 'search').mockResolvedValueOnce([{ index: 0, score: 1 }]); await controller.search('source'); expect(state.searchHits).toHaveLength(1);
    const other = new BenchStorage(); try { await other.deleteSource(removed.id, removed.notebookId); } finally { await other.close(); }
    await controller.refreshSources(); expect(state.sources).toEqual([]); expect(state.searchHits).toEqual([]);
  });
  it('manual source refresh preserves an unrelated configuration error', async () => {
    controller.setKey('invalid whitespace'); const error = state.errorMessage;
    await controller.refreshSources(); expect(state.errorMessage).toBe(error);
  });
  it('manual refresh does not abort a running import', async () => {
    const gate = deferred<IndexResult>(); pipeline.index.mockReturnValueOnce(gate.promise);
    const importing = controller.importFiles([file()]); await vi.waitFor(() => expect(pipeline.index).toHaveBeenCalledTimes(1));
    const cancelCount = pipeline.cancel.mock.calls.length; await controller.refreshSources(); expect(state.busy).toBe(true); expect(pipeline.cancel).toHaveBeenCalledTimes(cancelCount);
    gate.resolve(indexed(pipeline.index.mock.calls[0][0])); await importing; expect(statuses()).toEqual(['imported']);
  });
});
