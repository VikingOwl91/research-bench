import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchBenchController } from '../../src/lib/controller';
import { EMBEDDING_VERSION, MODEL_CACHE } from '../../src/lib/constants';
import { LocalPipeline, type IndexResult } from '../../src/lib/pipeline';
import { generateAnswer } from '../../src/lib/providers';
import { BenchStorage } from '../../src/lib/storage';
import type { AppSnapshot, GroundedAnswer } from '../../src/lib/types';

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
  const text = 'Belegter Text für die Frage.';
  const vector = new Float32Array(384); vector[0] = 1;
  return { parser: 'test-parser', pages: [{ page: 1, text }], chunks: [{ id: `${payload.sourceId}:1`, notebookId: payload.notebookId, sourceId: payload.sourceId, page: 1, start: 0, end: text.length, text, vector, embeddingVersion: EMBEDDING_VERSION }] };
}
class TestPipeline extends LocalPipeline {
  override cancel = vi.fn();
  override index = vi.fn<LocalPipeline['index']>().mockImplementation(async payload => indexed(payload));
  override search = vi.fn<LocalPipeline['search']>().mockResolvedValue([{ index: 0, score: 1 }]);
}
const answer: GroundedAnswer = { title: 'Belegt', blocks: [{ text: 'Antwort mit Quelle.', citationIds: ['C1'] }] };
const file = () => new File(['Belegter Text'], 'quelle.txt', { type: 'text/plain' });
let storage: BenchStorage;
let pipeline: TestPipeline;
let generate: ReturnType<typeof vi.fn<typeof generateAnswer>>;
let controller: ResearchBenchController;
let state: AppSnapshot;
let snapshots: AppSnapshot[];

beforeEach(async () => {
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('caches', { delete: vi.fn().mockResolvedValue(true) });
  storage = new BenchStorage(); await storage.clear();
  pipeline = new TestPipeline();
  generate = vi.fn<typeof generateAnswer>().mockResolvedValue(answer);
  controller = new ResearchBenchController(storage, pipeline, generate);
  snapshots = [];
  controller.subscribe(value => { state = value; snapshots.push(value); });
  await controller.initialize();
});
afterEach(async () => {
  controller.cancel();
  await storage.clear(); await storage.close();
  vi.unstubAllGlobals();
});
async function readySource() {
  await controller.importFiles([file()]);
  expect(state.error).toBeNull();
  expect(state.sources).toHaveLength(1);
  controller.setKey('dummy-mistral-key');
}

describe('controller job identity and cancellation', () => {
  it('passes cancellation into storage when provider changes between response validation and commit', async () => {
    await readySource();
    const gate = deferred<void>();
    const commit = storage.saveMessages.bind(storage);
    const spy = vi.spyOn(storage, 'saveMessages').mockImplementationOnce(async (...args) => {
      await gate.promise;
      return commit(...args);
    });
    const asking = controller.ask('Frage');
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    controller.setProvider('openrouter');
    const signal = spy.mock.calls[0][2];
    expect(signal?.aborted).toBe(true);
    gate.resolve(); await asking;
    expect((await storage.loadNotebook(state.activeNotebook!.id)).messages).toEqual([]);
    expect(state.messages).toEqual([]); expect(state.error).toBeNull();
  });
  it.each(['cancel', 'delete', 'switch', 'provider', 'clear'] as const)('does not resurrect a pending import after %s', async action => {
    const pending = deferred<IndexResult>();
    pipeline.index.mockReturnValueOnce(pending.promise);
    const id = state.activeNotebook!.id;
    const importing = controller.importFiles([file()]);
    await vi.waitFor(() => expect(pipeline.index).toHaveBeenCalledTimes(1));
    const payload = pipeline.index.mock.calls[0][0];
    const signal = pipeline.index.mock.calls[0][1];
    if (action === 'cancel') controller.cancel();
    if (action === 'delete') await controller.deleteNotebook(id);
    if (action === 'switch') await controller.createNotebook('Anderes Notebook');
    if (action === 'provider') controller.setProvider('openrouter');
    if (action === 'clear') await controller.clearAll();
    expect(signal.aborted).toBe(true);
    // A late worker completion deliberately ignores abort. Controller identity
    // must protect storage even if a callback or worker has already completed.
    pending.resolve(indexed(payload)); await importing;
    expect((await storage.loadNotebook(id)).sources).toEqual([]);
    expect(await storage.chunks(id)).toEqual([]);
    expect(state.sources).toEqual([]);
    expect(state.busy).toBe(false);
    expect(state.error).toBeNull();
    if (action === 'delete' || action === 'clear') expect((await storage.loadNotebook(id)).notebook).toBeNull();
  });
  it.each(['cancel', 'delete-source', 'delete-notebook', 'provider', 'key', 'clear'] as const)('does not save a late chat response after %s', async action => {
    await readySource();
    const pending = deferred<GroundedAnswer>(); generate.mockReturnValueOnce(pending.promise);
    const id = state.activeNotebook!.id;
    const asking = controller.ask('Was steht in der Quelle?');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const request = generate.mock.calls[0][0];
    if (action === 'cancel') controller.cancel();
    if (action === 'delete-source') await controller.deleteSource(state.sources[0].id);
    if (action === 'delete-notebook') await controller.deleteNotebook(id);
    if (action === 'provider') controller.setProvider('openrouter');
    if (action === 'key') controller.setKey('replacement-dummy-key');
    if (action === 'clear') await controller.clearAll();
    expect(request.signal.aborted).toBe(true);
    pending.resolve(answer); await asking;
    expect((await storage.loadNotebook(id)).messages).toEqual([]);
    expect(state.messages).toEqual([]); expect(state.busy).toBe(false); expect(state.error).toBeNull();
  });
  it('does not save a late Studio result after notebook switch', async () => {
    await readySource();
    const original = state.activeNotebook!.id;
    const pending = deferred<GroundedAnswer>(); generate.mockReturnValueOnce(pending.promise);
    const generating = controller.generate('study');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await controller.createNotebook('Zweites');
    pending.resolve(answer); await generating;
    expect((await storage.loadNotebook(original)).artifacts).toEqual([]);
    expect(state.artifacts).toEqual([]);
    expect(state.activeNotebook!.id).not.toBe(original);
  });
});

describe('history, source revisions and private session keys', () => {
  it('reloads persisted history and artifacts, excludes stale conversation after a source revision change', async () => {
    await readySource();
    const original = state.activeNotebook!.id;
    await controller.ask('Erste Frage');
    await controller.generate('summary');
    expect(state.messages).toHaveLength(2); expect(state.artifacts).toHaveLength(1);
    const frozenCitation = state.messages[1].citations[0];
    await controller.deleteSource(state.sources[0].id);
    const currentRevision = state.activeNotebook!.revision;
    const reloaded = new ResearchBenchController(storage, pipeline, generate);
    reloaded.subscribe(value => { state = value; });
    await reloaded.initialize();
    expect(state.activeNotebook!.id).toBe(original);
    expect(state.activeNotebook!.revision).toBe(currentRevision);
    expect(state.messages).toHaveLength(2); expect(state.artifacts).toHaveLength(1);
    expect(state.messages[1].citations[0]).toEqual(frozenCitation);
    expect(state.messages[1].revision).toBeLessThan(currentRevision);
    expect(state.artifacts[0].revision).toBeLessThan(currentRevision);
    await reloaded.importFiles([file()]);
    await reloaded.ask('Frage zur neuen Quelle');
    expect(generate.mock.calls.at(-1)![0].history).toEqual([]);
    expect(pipeline.search.mock.calls.at(-1)![2]).toBeUndefined();
    expect(state.messages.at(-1)!.revision).toBe(state.activeNotebook!.revision);
    reloaded.cancel();
  });
  it('uses only revision-current history and persists frozen provider and citations', async () => {
    await readySource();
    await controller.ask('Erste Frage');
    await controller.ask('Folgefrage');
    const secondRequest = generate.mock.calls[1][0];
    expect(secondRequest.history?.map(m => m.text)).toEqual(['Erste Frage', 'Antwort mit Quelle.']);
    expect(pipeline.search.mock.calls[1][2]).toBe('Erste Frage');
    const result = state.messages.at(-1)!;
    expect(result.provider).toBe('mistral'); expect(result.model).toBe('mistral-small-2603');
    expect(result.citations[0].sourceId).toBe(state.sources[0].id);
    expect(result.citations[0].text).toBe(state.sources[0].pages[0].text);
  });
  it('isolates provider keys in sessionStorage and never publishes or persists their values', async () => {
    await readySource();
    controller.setProvider('openrouter'); expect(state.hasKey).toBe(false);
    controller.setKey('dummy-openrouter-key'); await controller.ask('OpenRouter Frage');
    expect(generate.mock.calls[0][0]).toMatchObject({ provider: 'openrouter', key: 'dummy-openrouter-key' });
    controller.setProvider('mistral'); await controller.ask('Mistral Frage');
    expect(generate.mock.calls[1][0]).toMatchObject({ provider: 'mistral', key: 'dummy-mistral-key' });
    expect(sessionStorage.getItem('researchbench:key:mistral')).toBe('dummy-mistral-key');
    expect(sessionStorage.getItem('researchbench:key:openrouter')).toBe('dummy-openrouter-key');
    for (const value of [JSON.stringify(snapshots), JSON.stringify(await storage.loadNotebook(state.activeNotebook!.id))]) {
      expect(value).not.toContain('dummy-mistral-key'); expect(value).not.toContain('dummy-openrouter-key');
    }
    expect(localStorage.getItem('researchbench:key:mistral')).toBeNull();
    expect(localStorage.getItem('researchbench:key:openrouter')).toBeNull();
  });
  it('clears session keys, remembered notebook, application cache and persisted data', async () => {
    await readySource(); await controller.ask('Frage'); await controller.generate('faq');
    const id = state.activeNotebook!.id;
    controller.setProvider('openrouter'); controller.setKey('dummy-openrouter-key');
    localStorage.setItem('unrelated-setting', 'preserve'); sessionStorage.setItem('unrelated-setting', 'preserve');
    await controller.clearAll();
    expect(state).toMatchObject({ notebooks: [], activeNotebook: null, sources: [], messages: [], artifacts: [], hasKey: false, provider: 'mistral', busy: false });
    expect(await storage.chunks(id)).toEqual([]); expect(await storage.listNotebooks()).toEqual([]);
    expect(sessionStorage.getItem('researchbench:key:mistral')).toBeNull();
    expect(sessionStorage.getItem('researchbench:key:openrouter')).toBeNull();
    expect(localStorage.getItem('researchbench:active-notebook')).toBeNull();
    expect(caches.delete).toHaveBeenCalledWith(MODEL_CACHE);
    expect(localStorage.getItem('unrelated-setting')).toBe('preserve'); expect(sessionStorage.getItem('unrelated-setting')).toBe('preserve');
  });
  it('clears documents and keys even when CacheStorage deletion throws SecurityError', async () => {
    await readySource(); await controller.ask('Frage'); await controller.generate('study');
    const id = state.activeNotebook!.id;
    controller.setProvider('openrouter'); controller.setKey('dummy-openrouter-key');
    sessionStorage.setItem('unrelated-session-key', 'preserve');
    localStorage.setItem('unrelated-setting', 'preserve');
    const remainingCaches = new Set([MODEL_CACHE, 'another-app-cache']);
    const deleteCache = vi.fn<(key: string) => Promise<boolean>>().mockImplementation(key => {
      if (key === MODEL_CACHE) throw new DOMException('CacheStorage denied', 'SecurityError');
      return Promise.resolve(remainingCaches.delete(key));
    });
    vi.stubGlobal('caches', { delete: deleteCache });
    const clearing = controller.clearAll();
    // State is released synchronously, before any storage cleanup settles.
    expect(state).toMatchObject({ notebooks: [], activeNotebook: null, sources: [], messages: [], artifacts: [], hasKey: false, busy: false });
    await clearing;
    expect(await storage.listNotebooks()).toEqual([]);
    expect(await storage.loadNotebook(id)).toEqual({ notebook: null, sources: [], messages: [], artifacts: [] });
    expect(await storage.chunks(id)).toEqual([]);
    expect(sessionStorage.getItem('researchbench:key:mistral')).toBeNull();
    expect(sessionStorage.getItem('researchbench:key:openrouter')).toBeNull();
    expect(sessionStorage.getItem('researchbench:provider')).toBeNull();
    expect(localStorage.getItem('researchbench:active-notebook')).toBeNull();
    expect(state.error).toMatch(/Nicht vollständig gelöscht: Modell-Cache/);
    expect(deleteCache).toHaveBeenCalledExactlyOnceWith(MODEL_CACHE);
    expect(remainingCaches.has('another-app-cache')).toBe(true);
    expect(sessionStorage.getItem('unrelated-session-key')).toBe('preserve');
    expect(localStorage.getItem('unrelated-setting')).toBe('preserve');
  });
  it('releases visible state and session keys while explicitly reporting IndexedDB cleanup failure', async () => {
    await readySource(); await controller.ask('Frage'); await controller.generate('summary');
    const id = state.activeNotebook!.id;
    controller.setProvider('openrouter'); controller.setKey('dummy-openrouter-key');
    sessionStorage.setItem('unrelated-session-key', 'preserve');
    const clear = vi.spyOn(storage, 'clear').mockRejectedValueOnce(new DOMException('Storage denied', 'SecurityError'));
    try {
      await controller.clearAll();
      expect(state).toMatchObject({ notebooks: [], activeNotebook: null, sources: [], messages: [], artifacts: [], searchHits: [], hasKey: false, busy: false });
      expect(state.error).toMatch(/Nicht vollständig gelöscht: lokale Notebook-Daten/);
      expect(state.error).toMatch(/Browser-Einstellungen/);
      expect(sessionStorage.getItem('researchbench:key:mistral')).toBeNull();
      expect(sessionStorage.getItem('researchbench:key:openrouter')).toBeNull();
      expect(sessionStorage.getItem('researchbench:provider')).toBeNull();
      expect(localStorage.getItem('researchbench:active-notebook')).toBeNull();
      expect(caches.delete).toHaveBeenCalledExactlyOnceWith(MODEL_CACHE);
      expect(sessionStorage.getItem('unrelated-session-key')).toBe('preserve');
      // Failure reporting must remain honest: persistence was blocked, not wiped.
      expect((await storage.loadNotebook(id)).sources).toHaveLength(1);
      expect((await storage.loadNotebook(id)).messages).toHaveLength(2);
      expect((await storage.loadNotebook(id)).artifacts).toHaveLength(1);
    } finally { clear.mockRestore(); }
  });
  it('rejects unsupported and empty files before local indexing and exposes errors in snapshot', async () => {
    await controller.importFiles([new File(['data'], 'bad.zip')]);
    expect(state.error).toMatch(/PDF.*Markdown.*TXT/); expect(pipeline.index).not.toHaveBeenCalled();
    controller.clearError();
    await controller.importFiles([new File([], 'empty.txt')]);
    expect(state.error).toMatch(/leer/); expect(pipeline.index).not.toHaveBeenCalled();
    expect(state.busy).toBe(false);
  });
});
