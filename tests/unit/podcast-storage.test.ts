import 'fake-indexeddb/auto';
import { deleteDB, openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BenchStorage, DB_NAME, StorageConflict } from '../../src/lib/storage';
import type { Notebook, PodcastArtifact, PodcastAudioSegment, PodcastFence, PodcastRenderedAudio, TextArtifact } from '../../src/lib/types';

let storage: BenchStorage;
beforeEach(async () => { storage = new BenchStorage(); await storage.clear(); });
afterEach(async () => { vi.restoreAllMocks(); await storage.clear(); await storage.close(); });
function draft(n: Notebook, language: 'de' | 'en' = 'de'): PodcastArtifact {
  return { id: crypto.randomUUID(), notebookId: n.id, revision: n.revision, kind: 'podcast', createdAt: Date.now(),
    script: { title: 'Gespräch', language, turns: [
      { id: 'T1', speaker: 'A', text: 'Eine Frage.', citationIds: [] }, { id: 'T2', speaker: 'B', text: 'Eine Antwort.', citationIds: [] }
    ] }, citations: [], coverage: { selectedCharacters: 0, totalCharacters: 0, selectedSources: 0, totalSources: 0, limited: false },
    provider: 'mistral', model: 'script-model', audioConfig: { provider: 'mistral', model: 'tts-model',
      voices: { A: { id: 'a', slug: 'a' }, B: { id: 'b', slug: 'b' } }, format: 'wav', encoderVersion: 'test', pauseMs: 200 },
    status: 'rendering', renderId: crypto.randomUUID(), completedTurnIds: [] };
}
function segment(turnId = 'T1'): PodcastAudioSegment {
  return { turnId, blob: new Blob(['fictional WAV test bytes'], { type: 'audio/wav' }), mimeType: 'audio/wav', durationSeconds: 1, sampleRate: 24000, sampleCount: 24000 };
}
function result(): PodcastRenderedAudio {
  return { blob: new Blob(['fictional MP3 test bytes'], { type: 'audio/mpeg' }), durationSeconds: 2.2,
    timeline: [{ turnId: 'T1', start: 0, end: 1 }, { turnId: 'T2', start: 1.2, end: 2.2 }], encodingMs: 20, peakBufferBytes: 192000 };
}
async function candidate(n?: Notebook) {
  const notebook = n ?? await storage.createNotebook('Podcast');
  return storage.createPodcastCandidate(draft(notebook), await storage.getDataEpoch());
}
async function finish(fence: PodcastFence) {
  await storage.savePodcastSegment(fence, segment('T1')); await storage.savePodcastSegment(fence, segment('T2'));
  return storage.completePodcast(fence, result());
}

describe('podcast database migration and lazy audio', () => {
  it('migrates version 1 without losing existing notebooks or text artifacts', async () => {
    await storage.close(); await deleteDB(DB_NAME);
    const db = await openDB(DB_NAME, 1, { upgrade(db) {
      db.createObjectStore('notebooks', { keyPath: 'id' });
      for (const name of ['sources', 'chunks', 'messages', 'artifacts']) {
        const store = db.createObjectStore(name, { keyPath: 'id' }); store.createIndex('notebook', 'notebookId');
        if (name === 'chunks') store.createIndex('source', 'sourceId');
      }
    } });
    const n: Notebook = { id: 'legacy', name: 'Bestehend', revision: 0, createdAt: 1 };
    const text: TextArtifact = { id: 'legacy-text', notebookId: n.id, revision: 0, createdAt: 2, kind: 'faq',
      answer: { title: 'FAQ', blocks: [] }, citations: [], coverage: draft(n).coverage, provider: 'mistral', model: 'legacy' };
    await db.put('notebooks', n); await db.put('artifacts', text); db.close();
    storage = new BenchStorage();
    expect((await storage.loadNotebook(n.id)).artifacts).toEqual([text]);
    expect(await storage.getDataEpoch()).toBe(0);
    const { fence } = await candidate(n); await finish(fence);
    expect((await storage.loadNotebook(n.id)).artifacts).toHaveLength(2);
    expect(await storage.getPodcastAudio(fence.episodeId)).toBeInstanceOf(Blob);
  });
  it('loads metadata without audio blobs and reads final audio separately', async () => {
    const { episode, fence } = await candidate(); await finish(fence);
    const loaded = await storage.loadNotebook(episode.notebookId);
    expect(loaded.artifacts[0]).not.toHaveProperty('blob');
    expect(loaded.artifacts[0]).not.toHaveProperty('audio');
    expect(await (await storage.getPodcastAudio(episode.id))!.text()).toBe('fictional MP3 test bytes');
    expect(await storage.loadPodcastSegments(episode.id)).toEqual([]);
  });
  it('rejects podcast records through the legacy text-artifact path', async () => {
    const n = await storage.createNotebook('A');
    await expect(storage.saveArtifact(draft(n) as unknown as TextArtifact)).rejects.toBeInstanceOf(StorageConflict);
    expect((await storage.loadNotebook(n.id)).artifacts).toEqual([]);
  });
});

describe('podcast candidates, segments and resume fences', () => {
  it('replaces only the partial candidate of the same language and preserves ready audio', async () => {
    const n = await storage.createNotebook('A'); const ready = await candidate(n); await finish(ready.fence);
    const partial = await candidate(n); await storage.savePodcastSegment(partial.fence, segment());
    const english = await storage.createPodcastCandidate(draft(n, 'en'), await storage.getDataEpoch());
    const latest = await candidate(n);
    expect(await storage.loadPodcastSegments(partial.episode.id)).toEqual([]);
    await expect(storage.savePodcastSegment(partial.fence, segment('T2'))).rejects.toBeInstanceOf(StorageConflict);
    expect((await storage.loadNotebook(n.id)).artifacts.map(a => a.id).sort()).toEqual([ready.episode.id, english.episode.id, latest.episode.id].sort());
    expect(await storage.getPodcastAudio(ready.episode.id)).toBeInstanceOf(Blob);
  });
  it('validates the persisted fence without mutation before another billable step', async () => {
    const { episode, fence } = await candidate();
    expect(await storage.getNotebookRevision(episode.notebookId)).toBe(0);
    expect(await storage.getNotebookRevision('missing')).toBeNull();
    await storage.assertPodcastFence(fence);
    await storage.releasePodcastRender(fence);
    await expect(storage.assertPodcastFence(fence)).rejects.toBeInstanceOf(StorageConflict);
    expect((await storage.loadNotebook(episode.notebookId)).artifacts[0]).toMatchObject({ status: 'paused', completedTurnIds: [] });
  });
  it('returns segments in script order and atomically updates the completed manifest', async () => {
    const { episode, fence } = await candidate();
    await storage.savePodcastSegment(fence, segment('T2')); await storage.savePodcastSegment(fence, segment('T1'));
    expect((await storage.loadPodcastSegments(episode.id)).map(s => s.turnId)).toEqual(['T1', 'T2']);
    expect((await storage.loadNotebook(episode.notebookId)).artifacts[0]).toMatchObject({ completedTurnIds: ['T2', 'T1'] });
  });
  it.each(['duplicate', 'unknown', 'mime', 'duration', 'sample-count', 'empty'] as const)('rejects %s segments without orphan records', async kind => {
    const { episode, fence } = await candidate(); const s = segment();
    if (kind === 'duplicate') await storage.savePodcastSegment(fence, s);
    if (kind === 'unknown') s.turnId = 'foreign';
    if (kind === 'mime') s.blob = new Blob(['bytes'], { type: 'audio/mpeg' });
    if (kind === 'duration') s.durationSeconds = NaN;
    if (kind === 'sample-count') s.sampleCount = 0;
    if (kind === 'empty') s.blob = new Blob([], { type: 'audio/wav' });
    await expect(storage.savePodcastSegment(fence, s)).rejects.toBeInstanceOf(StorageConflict);
    expect(await storage.loadPodcastSegments(episode.id)).toHaveLength(kind === 'duplicate' ? 1 : 0);
  });
  it('requires known matching PCM metadata before persisting raw audio', async () => {
    const n = await storage.createNotebook('PCM'); const pcm = draft(n);
    pcm.audioConfig.format = 'pcm'; pcm.audioConfig.pcmFormat = { sampleRate: 24000, channels: 1, encoding: 's16le' };
    const { fence } = await storage.createPodcastCandidate(pcm, await storage.getDataEpoch());
    const raw: PodcastAudioSegment = { ...segment(), blob: new Blob(['pcm bytes'], { type: 'audio/pcm' }), mimeType: 'audio/pcm' };
    await expect(storage.savePodcastSegment(fence, raw)).rejects.toBeInstanceOf(StorageConflict);
    raw.pcmFormat = { sampleRate: 24000, channels: 1, encoding: 'f32le' };
    await expect(storage.savePodcastSegment(fence, raw)).rejects.toBeInstanceOf(StorageConflict);
    raw.pcmFormat = pcm.audioConfig.pcmFormat; await storage.savePodcastSegment(fence, raw);
    expect(await storage.loadPodcastSegments(pcm.id)).toHaveLength(1);
  });
  it('rolls segment bytes back when manifest storage fails synchronously', async () => {
    const { episode, fence } = await candidate(); const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'artifacts') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return put.call(this, value, key);
    });
    await expect(storage.savePodcastSegment(fence, segment())).rejects.toMatchObject({ name: 'QuotaExceededError' }); spy.mockRestore();
    expect(await storage.loadPodcastSegments(episode.id)).toEqual([]);
    expect((await storage.loadNotebook(episode.notebookId)).artifacts[0]).toMatchObject({ completedTurnIds: [] });
  });
  it('requires original provider for resume and rejects every result from the old render', async () => {
    const { episode, fence } = await candidate(); await storage.savePodcastSegment(fence, segment());
    await storage.releasePodcastRender(fence);
    await expect(storage.claimPodcastResume(episode.id, 'openrouter', 'new', await storage.getDataEpoch())).rejects.toBeInstanceOf(StorageConflict);
    const resumed = await storage.claimPodcastResume(episode.id, 'mistral', 'new', await storage.getDataEpoch());
    await expect(storage.savePodcastSegment(fence, segment('T2'))).rejects.toBeInstanceOf(StorageConflict);
    await storage.releasePodcastRender(fence);
    expect((await storage.loadNotebook(episode.notebookId)).artifacts[0]).toMatchObject({ status: 'rendering', renderId: 'new' });
    await storage.savePodcastSegment(resumed.fence, segment('T2')); await storage.completePodcast(resumed.fence, result());
  });
  it('checks frozen script/config integrity before accepting a segment', async () => {
    const { episode, fence } = await candidate(); const db = await openDB(DB_NAME, 2);
    const changed = { ...episode, script: { ...episode.script, title: 'Changed' } };
    await db.put('artifacts', changed); db.close();
    await expect(storage.savePodcastSegment(fence, segment())).rejects.toBeInstanceOf(StorageConflict);
    expect(await storage.loadPodcastSegments(episode.id)).toEqual([]);
  });
  it('blocks resume and segment writes after a source revision change', async () => {
    const { episode, fence } = await candidate(); await storage.releasePodcastRender(fence);
    const db = await openDB(DB_NAME, 2); const n = await db.get('notebooks', episode.notebookId);
    await db.put('notebooks', { ...n, revision: 1 }); db.close();
    await expect(storage.claimPodcastResume(episode.id, 'mistral', 'new', await storage.getDataEpoch())).rejects.toBeInstanceOf(StorageConflict);
    await expect(storage.savePodcastSegment(fence, segment())).rejects.toBeInstanceOf(StorageConflict);
  });
  it('rejects cancellation before and during a segment transaction', async () => {
    const { episode, fence } = await candidate(); const abort = new AbortController(); abort.abort();
    await expect(storage.savePodcastSegment(fence, segment(), abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const running = new AbortController(); const original = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const request = original.call(this, value, key); if (this.name === 'audio') queueMicrotask(() => running.abort()); return request;
    });
    await expect(storage.savePodcastSegment(fence, segment(), running.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(await storage.loadPodcastSegments(episode.id)).toEqual([]);
    expect((await storage.loadNotebook(episode.notebookId)).artifacts[0]).toMatchObject({ completedTurnIds: [] });
  });
});

describe('atomic podcast publication and deletion', () => {
  it('publishes final metadata/audio together and removes previous same-language audio', async () => {
    const n = await storage.createNotebook('A'); const old = await candidate(n); await finish(old.fence);
    const next = await candidate(n); const completed = await finish(next.fence);
    expect(completed).toMatchObject({ status: 'ready', renderId: null, timeline: result().timeline });
    expect(await storage.getPodcastAudio(old.episode.id)).toBeNull();
    expect((await storage.loadNotebook(n.id)).artifacts.map(a => a.id)).toEqual([next.episode.id]);
  });
  it('rolls finalization back on quota failure and preserves old ready episode and partial segments', async () => {
    const n = await storage.createNotebook('A'); const old = await candidate(n); await finish(old.fence);
    const next = await candidate(n); await storage.savePodcastSegment(next.fence, segment('T1')); await storage.savePodcastSegment(next.fence, segment('T2'));
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'artifacts' && (value as PodcastArtifact).status === 'ready') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return put.call(this, value, key);
    });
    await expect(storage.completePodcast(next.fence, result())).rejects.toMatchObject({ name: 'QuotaExceededError' }); spy.mockRestore();
    expect(await storage.getPodcastAudio(old.episode.id)).toBeInstanceOf(Blob);
    expect(await storage.getPodcastAudio(next.episode.id)).toBeNull();
    expect(await storage.loadPodcastSegments(next.episode.id)).toHaveLength(2);
    expect((await storage.loadNotebook(n.id)).artifacts.find(a => a.id === next.episode.id)).toMatchObject({ status: 'rendering' });
  });
  it.each(['missing', 'order', 'overlap', 'duration', 'too-large'] as const)('rejects incomplete/invalid %s finalization', async failure => {
    const { episode, fence } = await candidate(); const rendered = result();
    await storage.savePodcastSegment(fence, segment('T1'));
    if (failure !== 'missing') await storage.savePodcastSegment(fence, segment('T2'));
    if (failure === 'order') rendered.timeline.reverse();
    if (failure === 'overlap') rendered.timeline[1].start = 0.5;
    if (failure === 'duration') rendered.durationSeconds = 7;
    if (failure === 'too-large') rendered.blob = new Blob([new Uint8Array(16 * 1024 * 1024 + 1)], { type: 'audio/mpeg' });
    await expect(storage.completePodcast(fence, rendered)).rejects.toBeInstanceOf(StorageConflict);
    expect(await storage.getPodcastAudio(episode.id)).toBeNull();
  });
  it('monotonically advances the wipe epoch and prevents old candidates resurrecting data', async () => {
    const n = await storage.createNotebook('A'); const epoch = await storage.getDataEpoch(); const old = await candidate(n);
    await storage.clear(); expect(await storage.getDataEpoch()).toBe(epoch + 1);
    await expect(storage.createPodcastCandidate(draft(n), epoch)).rejects.toBeInstanceOf(StorageConflict);
    await expect(storage.savePodcastSegment(old.fence, segment())).rejects.toBeInstanceOf(StorageConflict);
    await storage.releasePodcastRender(old.fence);
    expect(await storage.listNotebooks()).toEqual([]); expect(await storage.loadPodcastSegments(old.episode.id)).toEqual([]);
  });
  it('cascades notebook and podcast deletion without removing unrelated audio', async () => {
    const a = await candidate(), b = await candidate(); await finish(a.fence); await finish(b.fence);
    await storage.deleteNotebook(a.episode.notebookId);
    expect(await storage.getPodcastAudio(a.episode.id)).toBeNull(); expect(await storage.getPodcastAudio(b.episode.id)).toBeInstanceOf(Blob);
    await storage.deletePodcast(b.episode.id); await storage.releasePodcastRender(b.fence);
    expect(await storage.getPodcastAudio(b.episode.id)).toBeNull(); expect((await storage.loadNotebook(b.episode.notebookId)).artifacts).toEqual([]);
  });
});
