import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchBenchController, type PodcastServices, type PodcastLockManager } from '../../src/lib/controller';
import { translateMessage } from '../../src/lib/i18n/index';
import { EMBEDDING_VERSION } from '../../src/lib/constants';
import { LocalPipeline } from '../../src/lib/pipeline';
import { BenchStorage, DB_NAME } from '../../src/lib/storage';
import type { PodcastAudioEngine } from '../../src/lib/audio/engine';
import type { AppSnapshot, PodcastArtifact, PodcastAudioConfig, PodcastAudioSegment, PodcastLanguage, PodcastScript, Provider } from '../../src/lib/types';

class MemoryStorage implements Storage {
  private entries = new Map<string, string>();
  get length() { return this.entries.size; }
  clear() { this.entries.clear(); }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
  removeItem(key: string) { this.entries.delete(key); }
  setItem(key: string, value: string) { this.entries.set(key, value); }
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
function script(language: PodcastLanguage = 'de'): PodcastScript {
  return { title: 'Fiktives Quellengespräch', language, turns: Array.from({ length: 4 }, (_, i) => ({ id: `T${i + 1}`, speaker: i % 2 ? 'B' : 'A', text: `Beitrag ${i + 1}`, citationIds: ['C1'] })) };
}
function config(provider: Provider = 'mistral'): PodcastAudioConfig {
  return { provider, model: provider === 'mistral' ? 'voxtral-mini-tts-2603' : 'mistralai/voxtral-mini-tts-2603',
    voices: { A: { id: 'voice-a', slug: 'gb_oliver_curious' }, B: { id: 'voice-b', slug: 'gb_jane_neutral' } }, format: 'wav', encoderVersion: 'test', pauseMs: 180 };
}
function audioInput() { return { blob: new Blob(['fictional WAV bytes'], { type: 'audio/wav' }), mimeType: 'audio/wav' as const }; }
function prepared(turnId: string): PodcastAudioSegment { return { turnId, ...audioInput(), sampleRate: 24000, sampleCount: 24000, durationSeconds: 1 }; }
class TestPipeline extends LocalPipeline {
  override cancel = vi.fn();
  override index = vi.fn<LocalPipeline['index']>().mockImplementation(async payload => {
    const text = 'Fiktives Quellenmaterial für den Podcast.'; const vector = new Float32Array(384); vector[0] = 1;
    return { parser: 'test', pages: [{ page: 1, text }], chunks: [{ id: `${payload.sourceId}:1`, notebookId: payload.notebookId,
      sourceId: payload.sourceId, page: 1, start: 0, end: text.length, text, vector, embeddingVersion: EMBEDDING_VERSION }] };
  });
}
type RequiredServices = Required<Omit<PodcastServices, 'locks' | 'audioEngine'>>;
let storage: BenchStorage;
let controller: ResearchBenchController;
let state: AppSnapshot;
let generateScript: ReturnType<typeof vi.fn<RequiredServices['generateScript']>>;
let resolveAudioConfig: ReturnType<typeof vi.fn<RequiredServices['resolveAudioConfig']>>;
let synthesizeTurn: ReturnType<typeof vi.fn<RequiredServices['synthesizeTurn']>>;
let prepare: ReturnType<typeof vi.fn<PodcastAudioEngine['prepare']>>;
let render: ReturnType<typeof vi.fn<PodcastAudioEngine['render']>>;
let cancelAudio: ReturnType<typeof vi.fn<PodcastAudioEngine['cancel']>>;
let locks: PodcastLockManager;
function createController(lockManager: PodcastLockManager | null = locks) {
  const result = new ResearchBenchController(storage, new TestPipeline(), undefined, {
    generateScript, resolveAudioConfig, synthesizeTurn, audioEngine: { prepare, render, cancel: cancelAudio }, locks: lockManager
  });
  result.subscribe(value => { state = value; }); return result;
}
function podcasts() { return state.artifacts.filter((a): a is PodcastArtifact => a.kind === 'podcast'); }
beforeEach(async () => {
  vi.stubGlobal('sessionStorage', new MemoryStorage()); vi.stubGlobal('localStorage', new MemoryStorage());
  storage = new BenchStorage(); await storage.clear();
  generateScript = vi.fn<RequiredServices['generateScript']>().mockImplementation(async request => script(request.language));
  resolveAudioConfig = vi.fn<RequiredServices['resolveAudioConfig']>().mockImplementation(async provider => config(provider));
  synthesizeTurn = vi.fn<RequiredServices['synthesizeTurn']>().mockImplementation(async () => audioInput());
  prepare = vi.fn<PodcastAudioEngine['prepare']>().mockImplementation(async turnId => prepared(turnId));
  render = vi.fn<PodcastAudioEngine['render']>().mockImplementation(async segments => ({
    blob: new Blob(['fictional final MP3'], { type: 'audio/mpeg' }), durationSeconds: segments.length + (segments.length - 1) * 0.18,
    timeline: segments.map((s, i) => ({ turnId: s.turnId, start: i * 1.18, end: i * 1.18 + 1 })), encodingMs: 20, peakBufferBytes: 100000
  }));
  cancelAudio = vi.fn();
  locks = { request: vi.fn(async (_name: string, _options: unknown, callback: (lock: unknown | null) => Promise<unknown>) => callback({ name: 'test-lock' })) } as PodcastLockManager;
  controller = createController(); await controller.initialize();
  await controller.importFiles([new File(['fixture'], 'fictional.txt', { type: 'text/plain' })]);
  controller.setKey('dummy-key'); expect(state.sources).toHaveLength(1);
});
afterEach(async () => { controller.cancel(); await storage.clear(); await storage.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('podcast controller workflow', () => {
  it('presents the source-based script stage in both languages during generation', async () => {
    generateScript.mockImplementationOnce(async request => {
      expect(state.progress?.stageMessage?.key).toBe('runtime.podcastScript');
      expect(translateMessage('en', state.progress!.stageMessage!)).toBe('Writing a podcast conversation using your sources');
      expect(translateMessage('de', state.progress!.stageMessage!)).toBe('Podcast-Gespräch anhand deiner Quellen wird geschrieben');
      return script(request.language);
    });
    await controller.generatePodcast('en');
    expect(generateScript).toHaveBeenCalledTimes(1);
    expect(state.error).toBeNull();
  });
  it('creates and reloads a podcast without eagerly reading audio', async () => {
    const reading = vi.spyOn(storage, 'getPodcastAudio');
    await controller.generatePodcast('de');
    expect(state.error).toBeNull(); expect(podcasts()).toHaveLength(1); expect(podcasts()[0].status).toBe('ready');
    expect(synthesizeTurn).toHaveBeenCalledTimes(4); expect(render).toHaveBeenCalledTimes(1); expect(reading).not.toHaveBeenCalled();
    expect(generateScript.mock.calls[0][0].citations[0].text).toBe(state.sources[0].pages[0].text);
    const episode = podcasts()[0]; controller = createController(); await controller.initialize();
    expect(podcasts()[0].id).toBe(episode.id); expect(reading).not.toHaveBeenCalled();
    expect(await (await controller.getPodcastAudio(episode.id))!.text()).toBe('fictional final MP3');
    expect(reading).toHaveBeenCalledTimes(1);
  });
  it('requires Web Locks before issuing any paid generation or voice calls', async () => {
    controller = createController(null); await controller.initialize(); await controller.generatePodcast('de');
    expect(state.error).toMatch(/Web Locks|Browser|Tabs/i); expect(generateScript).not.toHaveBeenCalled();
    expect(resolveAudioConfig).not.toHaveBeenCalled(); expect(synthesizeTurn).not.toHaveBeenCalled();
  });
  it('does not start paid requests when the exclusive notebook/language lock is occupied', async () => {
    locks.request = vi.fn(async (_name: string, _options: unknown, callback: (lock: unknown | null) => Promise<unknown>) => callback(null)) as PodcastLockManager['request'];
    await controller.generatePodcast('de'); expect(generateScript).not.toHaveBeenCalled(); expect(synthesizeTurn).not.toHaveBeenCalled();
    expect(state.busy).toBe(false);
  });
  it('retains saved contributions on key removal and resumes only missing contributions with the same provider', async () => {
    const gate = deferred(); synthesizeTurn.mockImplementationOnce(async () => audioInput()).mockImplementationOnce(async () => { await gate.promise; return audioInput(); });
    const generating = controller.generatePodcast('de'); await vi.waitFor(() => expect(synthesizeTurn).toHaveBeenCalledTimes(2));
    const blocked = synthesizeTurn.mock.calls[1][0]; controller.setKey(''); expect(blocked.signal.aborted).toBe(true);
    gate.resolve(); await generating;
    const partial = (await storage.loadNotebook(state.activeNotebook!.id)).artifacts.find((a): a is PodcastArtifact => a.kind === 'podcast')!;
    expect(await storage.loadPodcastSegments(partial.id)).toHaveLength(1); expect(partial.status).toBe('paused');
    controller.setProvider('openrouter'); controller.setKey('dummy-router-key'); await controller.resumePodcast(partial.id);
    expect(synthesizeTurn).toHaveBeenCalledTimes(2);
    controller.setProvider('mistral'); controller.setKey('replacement-dummy-key'); await controller.resumePodcast(partial.id);
    expect(state.error).toBeNull(); expect(podcasts()[0].status).toBe('ready'); expect(synthesizeTurn).toHaveBeenCalledTimes(5);
    expect(synthesizeTurn.mock.calls.slice(2).map(([request]) => request.text)).toEqual(['Beitrag 2', 'Beitrag 3', 'Beitrag 4']);
    expect(generateScript).toHaveBeenCalledTimes(1); expect(resolveAudioConfig).toHaveBeenCalledTimes(1);
  });
  it('creates a disposable fictional voice test without persisting or transmitting notebook content', async () => {
    const probe = await controller.probePodcastVoices('en');
    expect(probe?.audio.blob.type).toBe('audio/mpeg'); expect(synthesizeTurn).toHaveBeenCalledTimes(2);
    expect(synthesizeTurn.mock.calls.map(([request]) => request.speaker)).toEqual(['A', 'B']);
    expect(synthesizeTurn.mock.calls.every(([request]) => !request.text.includes('Fiktives Quellenmaterial'))).toBe(true);
    expect(generateScript).not.toHaveBeenCalled(); expect(podcasts()).toEqual([]);
  });
  it('preserves the previous complete episode when replacement rendering fails', async () => {
    await controller.generatePodcast('de'); const old = podcasts()[0];
    render.mockRejectedValueOnce(new Error('Encoding failed')); await controller.generatePodcast('de');
    expect(await storage.getPodcastAudio(old.id)).toBeInstanceOf(Blob);
    expect(podcasts().find(a => a.id === old.id)?.status).toBe('ready'); expect(state.error).toBe('Encoding failed');
  });
});

describe('BYOK changes invalidate every asynchronous podcast stage', () => {
  for (const stage of ['script', 'voices', 'tts', 'prepare', 'render', 'finalize'] as const) {
    it.each(['remove', 'replace', 'provider'] as const)(`${stage}: rejects late completion after %s`, async change => {
      const gate = deferred();
      const originalCommit = storage.completePodcast.bind(storage);
      const committing = vi.spyOn(storage, 'completePodcast');
      if (stage === 'finalize') {
        committing.mockImplementationOnce(async (...args) => { await gate.promise; return originalCommit(...args); });
      }
      if (stage === 'script') generateScript.mockImplementationOnce(async request => { await gate.promise; return script(request.language); });
      if (stage === 'voices') resolveAudioConfig.mockImplementationOnce(async provider => { await gate.promise; return config(provider); });
      if (stage === 'tts') synthesizeTurn.mockImplementationOnce(async () => { await gate.promise; return audioInput(); });
      if (stage === 'prepare') prepare.mockImplementationOnce(async turnId => { await gate.promise; return prepared(turnId); });
      if (stage === 'render') {
        const original = render.getMockImplementation()!; render.mockImplementationOnce(async (...args) => { await gate.promise; return original(...args); });
      }
      const running = controller.generatePodcast('de');
      const pending = stage === 'script' ? generateScript : stage === 'voices' ? resolveAudioConfig : stage === 'tts' ? synthesizeTurn : stage === 'prepare' ? prepare : stage === 'render' ? render : committing;
      await vi.waitFor(() => expect(pending).toHaveBeenCalledTimes(1));
      const signal = stage === 'script' ? generateScript.mock.calls[0][0].signal : stage === 'voices' ? resolveAudioConfig.mock.calls[0][2]
        : stage === 'tts' ? synthesizeTurn.mock.calls[0][0].signal : stage === 'prepare' ? prepare.mock.calls[0][2] : stage === 'render' ? render.mock.calls[0][2] : committing.mock.calls[0][2]!;
      const before = synthesizeTurn.mock.calls.length;
      if (change === 'provider') controller.setProvider('openrouter'); else controller.setKey(change === 'remove' ? '' : 'new-dummy-key');
      expect(signal.aborted).toBe(true); expect(cancelAudio).toHaveBeenCalled();
      gate.resolve(); await running;
      expect(synthesizeTurn).toHaveBeenCalledTimes(before); expect(state.busy).toBe(false); expect(state.error).toBeNull();
      const artifacts = (await storage.loadNotebook(state.activeNotebook!.id)).artifacts;
      expect(artifacts.some(a => a.kind === 'podcast' && a.status === 'ready')).toBe(false);
      for (const a of artifacts) if (a.kind === 'podcast') expect(await storage.loadPodcastSegments(a.id)).toHaveLength(stage === 'render' || stage === 'finalize' ? 4 : 0);
    });
  }
});

describe('cross-tab persisted guards and late render results', () => {
  it.each(['revision', 'epoch'] as const)('issues no next TTS request after another tab changes %s', async mutation => {
    const gate = deferred(); prepare.mockImplementationOnce(async turnId => { await gate.promise; return prepared(turnId); });
    const running = controller.generatePodcast('de'); await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    const n = state.activeNotebook!;
    if (mutation === 'epoch') await storage.clear();
    else { const db = await openDB(DB_NAME, 2); await db.put('notebooks', { ...n, revision: n.revision + 1 }); db.close(); }
    gate.resolve(); await running; expect(synthesizeTurn).toHaveBeenCalledTimes(1); expect(render).not.toHaveBeenCalled();
    const artifacts = (await storage.loadNotebook(n.id)).artifacts;
    expect(artifacts.some(a => a.kind === 'podcast' && a.status === 'ready')).toBe(false);
  });
  it.each(['revision', 'epoch'] as const)('does not start script generation after %s changes during voice discovery', async mutation => {
    const gate = deferred(); resolveAudioConfig.mockImplementationOnce(async provider => { await gate.promise; return config(provider); });
    const running = controller.generatePodcast('de'); await vi.waitFor(() => expect(resolveAudioConfig).toHaveBeenCalledTimes(1));
    if (mutation === 'epoch') await storage.clear();
    else { const db = await openDB(DB_NAME, 2); const n = state.activeNotebook!; await db.put('notebooks', { ...n, revision: n.revision + 1 }); db.close(); }
    gate.resolve(); await running; expect(generateScript).not.toHaveBeenCalled(); expect(synthesizeTurn).not.toHaveBeenCalled();
  });
  it('rejects an old render result after a new rendering identity takes over the candidate', async () => {
    const gate = deferred(); const original = render.getMockImplementation()!;
    render.mockImplementationOnce(async (...args) => { await gate.promise; return original(...args); });
    const running = controller.generatePodcast('de'); await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    const episode = (await storage.loadNotebook(state.activeNotebook!.id)).artifacts.find((a): a is PodcastArtifact => a.kind === 'podcast')!;
    await storage.claimPodcastResume(episode.id, 'mistral', 'new-owner', await storage.getDataEpoch());
    gate.resolve(); await running;
    expect(await storage.getPodcastAudio(episode.id)).toBeNull();
    expect((await storage.loadNotebook(episode.notebookId)).artifacts[0]).toMatchObject({ renderId: 'new-owner', status: 'rendering' });
  });
});
