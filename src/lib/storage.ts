import { getLocale } from './i18n/store';
import { translate, type MessageDescriptor } from './i18n/index';
import { runtimeErrorDescriptor } from './i18n/runtime-errors';
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { EMBEDDING_VERSION, LIMITS } from './constants';
import { applyPodcastSupportGate } from './support-gate';
import type { Artifact, ChatMessage, Chunk, Notebook, Source, TextArtifact, PodcastArtifact, PodcastFence, PodcastAudioSegment, PodcastRenderedAudio, Provider } from './types';

export const DB_NAME = 'researchbench-v1';
export interface StoredChunk extends Chunk { vector: Float32Array; embeddingVersion: string; }
interface AudioRow {
  id: string;
  notebookId: string;
  episodeId: string;
  kind: 'segment' | 'final';
  segment?: PodcastAudioSegment;
  blob?: Blob;
}
interface BenchDB extends DBSchema {
  notebooks: { key: string; value: Notebook };
  sources: { key: string; value: Source; indexes: { notebook: string } };
  chunks: { key: string; value: StoredChunk; indexes: { notebook: string; source: string } };
  messages: { key: string; value: ChatMessage; indexes: { notebook: string } };
  artifacts: { key: string; value: Artifact; indexes: { notebook: string } };
  audio: { key: string; value: AudioRow; indexes: { notebook: string; episode: string } };
  meta: { key: string; value: { id: string; epoch: number } };
}
const PODCAST_STORES: ['notebooks', 'artifacts', 'audio', 'meta'] = ['notebooks', 'artifacts', 'audio', 'meta'];
type PodcastTransaction = IDBPTransaction<BenchDB, typeof PODCAST_STORES, 'readwrite'>;
type PodcastReadTransaction = IDBPTransaction<BenchDB, typeof PODCAST_STORES, 'readonly'>;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
function signature(episode: PodcastArtifact) {
  return JSON.stringify({ script: episode.script, audioConfig: episode.audioConfig, provider: episode.provider, model: episode.model, revision: episode.revision });
}
function canceled(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError'); }
function conflict(tx: { abort(): void }, message?: string): never { tx.abort(); throw new StorageConflict(message); }

export class StorageConflict extends Error {
  readonly messageRef: MessageDescriptor;
  constructor(message = 'Die Quellen haben sich während der Verarbeitung geändert. Bitte erneut versuchen.') { super(message); this.name = 'StorageConflict'; this.messageRef = runtimeErrorDescriptor(message); }
}

function watchTransaction(tx: { abort(): void; done: Promise<unknown> }, signal?: AbortSignal) {
  const abort = () => { try { tx.abort(); } catch { /* Already committed/aborted. */ } };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  // Also consume transaction failure when validation aborts before awaiting tx.done.
  void tx.done.then(() => signal?.removeEventListener('abort', abort), () => signal?.removeEventListener('abort', abort));
}

export class BenchStorage {
  private database: Promise<IDBPDatabase<BenchDB>> | null = null;
  private open() {
    return this.database ??= openDB<BenchDB>(DB_NAME, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('notebooks', { keyPath: 'id' });
          for (const name of ['sources', 'messages', 'artifacts'] as const) {
            const store = db.createObjectStore(name, { keyPath: 'id' });
            store.createIndex('notebook', 'notebookId');
          }
          const chunks = db.createObjectStore('chunks', { keyPath: 'id' });
          chunks.createIndex('notebook', 'notebookId');
          chunks.createIndex('source', 'sourceId');
        }
        if (oldVersion < 2) {
          const audio = db.createObjectStore('audio', { keyPath: 'id' });
          audio.createIndex('notebook', 'notebookId');
          audio.createIndex('episode', 'episodeId');
          db.createObjectStore('meta', { keyPath: 'id' });
        }
      },
      blocking: () => { this.database?.then(db => db.close()); this.database = null; },
      terminated: () => { this.database = null; }
    });
  }
  async listNotebooks() {
    const db = await this.open();
    return (await db.getAll('notebooks')).sort((a, b) => a.createdAt - b.createdAt);
  }
  async createNotebook(name: string) {
    const notebook: Notebook = { id: crypto.randomUUID(), name: name.trim().slice(0, 120) || translate(getLocale(), 'runtime.newNotebook'), createdAt: Date.now(), revision: 0 };
    await (await this.open()).put('notebooks', notebook);
    return notebook;
  }
  async renameNotebook(id: string, name: string) {
    const db = await this.open();
    const tx = db.transaction('notebooks', 'readwrite');
    const notebook = await tx.store.get(id);
    if (!notebook) throw new StorageConflict('Dieses Notebook wurde bereits entfernt.');
    notebook.name = name.trim().slice(0, 120) || 'Notebook';
    await tx.store.put(notebook);
    await tx.done;
  }
  async loadNotebook(id: string) {
    const db = await this.open();
    const [notebook, sources, messages, artifacts] = await Promise.all([
      db.get('notebooks', id), db.getAllFromIndex('sources', 'notebook', id),
      db.getAllFromIndex('messages', 'notebook', id), db.getAllFromIndex('artifacts', 'notebook', id)
    ]);
    return {
      notebook: notebook ?? null,
      sources: sources.sort((a, b) => a.createdAt - b.createdAt),
      messages: messages.sort((a, b) => a.createdAt - b.createdAt),
      artifacts: artifacts.sort((a, b) => b.createdAt - a.createdAt)
    };
  }
  async chunks(id: string): Promise<StoredChunk[]> {
    const values = await (await this.open()).getAllFromIndex('chunks', 'notebook', id);
    if (values.some(c => c.embeddingVersion !== EMBEDDING_VERSION || c.vector.length !== 384)) {
      throw new Error('Dieser Index verwendet eine andere Modellversion. Bitte entferne die betroffenen Quellen und indexiere sie erneut.');
    }
    return values;
  }
  async saveSource(source: Source, chunks: StoredChunk[], revision: number, signal?: AbortSignal) {
    const db = await this.open();
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    const tx = db.transaction(['notebooks', 'sources', 'chunks'], 'readwrite');
    watchTransaction(tx, signal);
    const notebook = await tx.objectStore('notebooks').get(source.notebookId);
    const existing = await tx.objectStore('sources').index('notebook').getAll(source.notebookId);
    const count = await tx.objectStore('chunks').index('notebook').count(source.notebookId);
    const characters = [...existing, source].reduce((n, s) => n + s.pages.reduce((sum, p) => sum + Array.from(p.text).length, 0), 0);
    if (!notebook || notebook.revision !== revision) { tx.abort(); throw new StorageConflict(); }
    if (existing.length >= LIMITS.sources || count + chunks.length > LIMITS.chunks || characters > LIMITS.characters) {
      tx.abort(); throw new Error('Das Notebook-Limit ist erreicht (10 Quellen, 500.000 Zeichen oder 1.000 Chunks). Bitte verwende ein weiteres Notebook.');
    }
    if (!chunks.length || chunks.some(c => c.sourceId !== source.id || c.notebookId !== source.notebookId || c.vector.length !== 384 || !c.vector.every(Number.isFinite))) {
      tx.abort(); throw new Error('Der lokale Index ist unvollständig; die Quelle wurde nicht gespeichert.');
    }
    await tx.objectStore('sources').add(source);
    for (const chunk of chunks) await tx.objectStore('chunks').add(chunk);
    notebook.revision += 1;
    await tx.objectStore('notebooks').put(notebook);
    await tx.done;
  }
  async deleteSource(sourceId: string, notebookId: string) {
    const db = await this.open();
    const tx = db.transaction(['notebooks', 'sources', 'chunks'], 'readwrite');
    watchTransaction(tx);
    const notebook = await tx.objectStore('notebooks').get(notebookId);
    const source = await tx.objectStore('sources').get(sourceId);
    if (!notebook || !source || source.notebookId !== notebookId) { tx.abort(); throw new StorageConflict('Diese Quelle wurde bereits entfernt.'); }
    const keys = await tx.objectStore('chunks').index('source').getAllKeys(sourceId);
    for (const key of keys) await tx.objectStore('chunks').delete(key);
    await tx.objectStore('sources').delete(sourceId);
    notebook.revision += 1;
    await tx.objectStore('notebooks').put(notebook);
    await tx.done;
  }
  async saveMessages(messages: ChatMessage[], revision: number, signal?: AbortSignal) {
    const db = await this.open();
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    const tx = db.transaction(['notebooks', 'messages'], 'readwrite');
    watchTransaction(tx, signal);
    const notebook = await tx.objectStore('notebooks').get(messages[0].notebookId);
    if (!notebook || notebook.revision !== revision || messages.some(m => m.notebookId !== notebook.id || m.revision !== revision)) {
      tx.abort(); throw new StorageConflict();
    }
    for (const message of messages) await tx.objectStore('messages').put(message);
    await tx.done;
  }
  async saveArtifact(artifact: TextArtifact, signal?: AbortSignal) {
    if ((artifact as Artifact).kind === 'podcast') throw new StorageConflict('Podcast-Daten benötigen den abgesicherten Audio-Speicherpfad.');
    const db = await this.open();
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    const tx = db.transaction(['notebooks', 'artifacts'], 'readwrite');
    watchTransaction(tx, signal);
    const notebook = await tx.objectStore('notebooks').get(artifact.notebookId);
    if (!notebook || notebook.revision !== artifact.revision) { tx.abort(); throw new StorageConflict(); }
    await tx.objectStore('artifacts').put(artifact);
    await tx.done;
  }
  async deleteNotebook(id: string) {
    const db = await this.open();
    const tx = db.transaction(['notebooks', 'sources', 'chunks', 'messages', 'artifacts', 'audio'], 'readwrite');
    for (const name of ['sources', 'chunks', 'messages', 'artifacts', 'audio'] as const) {
      const keys = await tx.objectStore(name).index('notebook').getAllKeys(id);
      for (const key of keys) await tx.objectStore(name).delete(key);
    }
    await tx.objectStore('notebooks').delete(id);
    await tx.done;
  }
  async getDataEpoch(): Promise<number> {
    return (await (await this.open()).get('meta', 'data-epoch'))?.epoch ?? 0;
  }
  async getNotebookRevision(id: string): Promise<number | null> {
    return (await (await this.open()).get('notebooks', id))?.revision ?? null;
  }
  async assertPodcastFence(fence: PodcastFence): Promise<void> {
    const tx = (await this.open()).transaction(PODCAST_STORES, 'readonly'); watchTransaction(tx);
    await this.validateFence(tx, fence); await tx.done;
  }
  private async removeAudio(tx: PodcastTransaction, episodeId: string) {
    for (const key of await tx.objectStore('audio').index('episode').getAllKeys(episodeId)) await tx.objectStore('audio').delete(key);
  }
  private async validateFence(tx: PodcastTransaction | PodcastReadTransaction, fence: PodcastFence): Promise<PodcastArtifact> {
    const epoch = (await tx.objectStore('meta').get('data-epoch'))?.epoch ?? 0;
    const notebook = await tx.objectStore('notebooks').get(fence.notebookId);
    const artifact = await tx.objectStore('artifacts').get(fence.episodeId);
    const candidates = (await tx.objectStore('artifacts').index('notebook').getAll(fence.notebookId))
      .filter((a): a is PodcastArtifact => a.kind === 'podcast' && a.script.language === fence.language && a.status !== 'ready');
    if (epoch !== fence.dataEpoch || !notebook || notebook.revision !== fence.revision || !artifact || artifact.kind !== 'podcast' ||
      artifact.notebookId !== fence.notebookId || artifact.revision !== fence.revision || artifact.status !== 'rendering' ||
      artifact.renderId !== fence.renderId || !fence.renderId || artifact.script.language !== fence.language ||
      signature(artifact) !== fence.configSignature || candidates.length !== 1 || candidates[0].id !== artifact.id) conflict(tx);
    return artifact;
  }
  private fence(episode: PodcastArtifact, epoch: number): PodcastFence {
    return { notebookId: episode.notebookId, episodeId: episode.id, language: episode.script.language,
      revision: episode.revision, dataEpoch: epoch, renderId: episode.renderId!, configSignature: signature(episode) };
  }
  async createPodcastCandidate(draft: PodcastArtifact, expectedEpoch: number, signal?: AbortSignal): Promise<{ episode: PodcastArtifact; fence: PodcastFence }> {
    canceled(signal);
    if (draft.kind !== 'podcast' || draft.status !== 'rendering' || !draft.renderId || draft.completedTurnIds.length ||
      !draft.id || !draft.script.turns.length || new Set(draft.script.turns.map(t => t.id)).size !== draft.script.turns.length ||
      draft.script.turns.some(t => !t.id) || !['de', 'en'].includes(draft.script.language) || draft.provider !== draft.audioConfig.provider) throw new StorageConflict('Ungültiger Podcast-Entwurf.');
    const db = await this.open(); canceled(signal);
    const tx = db.transaction(PODCAST_STORES, 'readwrite'); watchTransaction(tx, signal);
    try {
      const epoch = (await tx.objectStore('meta').get('data-epoch'))?.epoch ?? 0;
      const notebook = await tx.objectStore('notebooks').get(draft.notebookId);
      if (epoch !== expectedEpoch || !notebook || notebook.revision !== draft.revision || await tx.objectStore('artifacts').get(draft.id)) conflict(tx);
      const artifacts = await tx.objectStore('artifacts').index('notebook').getAll(draft.notebookId);
      for (const a of artifacts) if (a.kind === 'podcast' && a.script.language === draft.script.language && a.status !== 'ready') {
        await this.removeAudio(tx, a.id); await tx.objectStore('artifacts').delete(a.id);
      }
      await tx.objectStore('artifacts').add(draft); await tx.done;
      return { episode: draft, fence: this.fence(draft, epoch) };
    } catch (error) { try { tx.abort(); } catch { /* Already committed/aborted. */ } throw error; }
  }
  async claimPodcastResume(episodeId: string, provider: Provider, renderId: string, expectedEpoch: number, signal?: AbortSignal): Promise<{ episode: PodcastArtifact; fence: PodcastFence }> {
    canceled(signal);
    if (!renderId) throw new StorageConflict();
    const db = await this.open(); canceled(signal);
    const tx = db.transaction(PODCAST_STORES, 'readwrite'); watchTransaction(tx, signal);
    try {
      const epoch = (await tx.objectStore('meta').get('data-epoch'))?.epoch ?? 0;
      const episode = await tx.objectStore('artifacts').get(episodeId);
      if (!episode || episode.kind !== 'podcast' || episode.status === 'ready' || episode.provider !== provider || epoch !== expectedEpoch || episode.renderId === renderId) conflict(tx);
      const notebook = await tx.objectStore('notebooks').get(episode.notebookId);
      const candidates = (await tx.objectStore('artifacts').index('notebook').getAll(episode.notebookId))
        .filter(a => a.kind === 'podcast' && a.script.language === episode.script.language && a.status !== 'ready');
      if (!notebook || notebook.revision !== episode.revision || candidates.length !== 1 || candidates[0].id !== episode.id) conflict(tx);
      // Existing drafts may predate the current heuristic. Check the frozen
      // evidence inside this fenced transaction, before changing status or
      // exposing a resumed transcript to fresh TTS. Reject rather than rewrite:
      // cached segments must continue to match their original script exactly.
      const evidence = episode.citations;
      const validEvidence = Array.isArray(evidence) && evidence.length > 0 && evidence.every(c =>
        typeof c.id === 'string' && !!c.id && typeof c.text === 'string' && !!c.text.trim());
      const ids = new Set(validEvidence ? evidence.map(c => c.id) : []);
      const turns = episode.script?.turns;
      const validTurns = Array.isArray(turns) && turns.length > 0 && turns.every(t =>
        typeof t.text === 'string' && !!t.text.trim() && Array.isArray(t.citationIds) &&
        new Set(t.citationIds).size === t.citationIds.length && t.citationIds.every(id => ids.has(id)));
      if (!validEvidence || ids.size !== evidence.length || !validTurns ||
        applyPodcastSupportGate(episode.script, evidence, '').quarantined > 0) {
        conflict(tx, translate('de', 'runtime.podcastResumeUnsupported'));
      }
      episode.status = 'rendering'; episode.renderId = renderId;
      await tx.objectStore('artifacts').put(episode); await tx.done;
      return { episode, fence: this.fence(episode, epoch) };
    } catch (error) { try { tx.abort(); } catch { /* Already committed/aborted. */ } throw error; }
  }
  async savePodcastSegment(fence: PodcastFence, segment: PodcastAudioSegment, signal?: AbortSignal): Promise<void> {
    canceled(signal);
    const db = await this.open(); canceled(signal);
    const tx = db.transaction(PODCAST_STORES, 'readwrite'); watchTransaction(tx, signal);
    try {
      const episode = await this.validateFence(tx, fence);
      const expectedType = { wav: 'audio/wav', pcm: 'audio/pcm', mp3: 'audio/mpeg' }[episode.audioConfig.format];
      const validPcm = episode.audioConfig.format !== 'pcm' || (!!segment.pcmFormat && !!episode.audioConfig.pcmFormat &&
        Number.isInteger(segment.pcmFormat.sampleRate) && segment.pcmFormat.sampleRate > 0 && segment.pcmFormat.channels === 1 &&
        ['f32le', 's16le'].includes(segment.pcmFormat.encoding) && JSON.stringify(segment.pcmFormat) === JSON.stringify(episode.audioConfig.pcmFormat));
      if (!episode.script.turns.some(t => t.id === segment.turnId) || episode.completedTurnIds.includes(segment.turnId) ||
        !(segment.blob instanceof Blob) || !segment.blob.size || segment.blob.size > MAX_AUDIO_BYTES || segment.mimeType !== expectedType || segment.blob.type !== expectedType || !validPcm ||
        !Number.isFinite(segment.durationSeconds) || segment.durationSeconds <= 0 || !Number.isInteger(segment.sampleRate) || segment.sampleRate <= 0 ||
        !Number.isInteger(segment.sampleCount) || segment.sampleCount <= 0 || Math.abs(segment.sampleCount / segment.sampleRate - segment.durationSeconds) > 0.05) conflict(tx, 'Ungültiges oder bereits gespeichertes Audiosegment.');
      const key = JSON.stringify([episode.id, 'segment', segment.turnId]);
      await tx.objectStore('audio').add({ id: key, notebookId: episode.notebookId, episodeId: episode.id, kind: 'segment', segment });
      episode.completedTurnIds.push(segment.turnId);
      await tx.objectStore('artifacts').put(episode); await tx.done;
    } catch (error) { try { tx.abort(); } catch { /* Already committed/aborted. */ } throw error; }
  }
  async loadPodcastSegments(episodeId: string): Promise<PodcastAudioSegment[]> {
    const db = await this.open();
    const tx = db.transaction(['artifacts', 'audio']);
    const episode = await tx.objectStore('artifacts').get(episodeId);
    const rows = await tx.objectStore('audio').index('episode').getAll(episodeId);
    await tx.done;
    if (!episode || episode.kind !== 'podcast') return [];
    const byId = new Map(rows.filter(r => r.kind === 'segment' && r.segment).map(r => [r.segment!.turnId, r.segment!]));
    return episode.script.turns.flatMap(turn => byId.has(turn.id) ? [byId.get(turn.id)!] : []);
  }
  async getPodcastAudio(episodeId: string): Promise<Blob | null> {
    const db = await this.open();
    const tx = db.transaction(['artifacts', 'audio']);
    const episode = await tx.objectStore('artifacts').get(episodeId);
    const row = await tx.objectStore('audio').get(JSON.stringify([episodeId, 'final']));
    await tx.done;
    return episode?.kind === 'podcast' && episode.status === 'ready' ? row?.blob ?? null : null;
  }
  async completePodcast(fence: PodcastFence, result: PodcastRenderedAudio, signal?: AbortSignal): Promise<PodcastArtifact> {
    canceled(signal);
    const db = await this.open(); canceled(signal);
    const tx = db.transaction(PODCAST_STORES, 'readwrite'); watchTransaction(tx, signal);
    try {
      const episode = await this.validateFence(tx, fence);
      const rows = await tx.objectStore('audio').index('episode').getAll(episode.id);
      const segments = new Map(rows.filter(r => r.kind === 'segment' && r.segment).map(r => [r.segment!.turnId, r.segment!]));
      const ids = episode.script.turns.map(t => t.id);
      let end = 0;
      const invalidTimeline = result.timeline.some((time, i) => {
        const segment = segments.get(ids[i]);
        const bad = !segment || time.turnId !== ids[i] || !Number.isFinite(time.start) || !Number.isFinite(time.end) ||
          time.end <= time.start || time.start < end || (i === 0 && time.start !== 0) || Math.abs(time.end - time.start - segment.durationSeconds) > 0.15;
        end = time.end; return bad;
      });
      if (!(result.blob instanceof Blob) || result.blob.type !== 'audio/mpeg' || !result.blob.size || result.blob.size > MAX_AUDIO_BYTES ||
        !Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0 || !Number.isFinite(result.encodingMs) || result.encodingMs < 0 ||
        !Number.isFinite(result.peakBufferBytes) || result.peakBufferBytes < 0 || result.timeline.length !== ids.length ||
        episode.completedTurnIds.length !== ids.length || segments.size !== ids.length || ids.some(id => !episode.completedTurnIds.includes(id)) ||
        invalidTimeline || Math.abs(end - result.durationSeconds) > 0.15) conflict(tx, 'Der fertige Podcast ist unvollständig oder ungültig.');
      const ready: PodcastArtifact = { ...episode, status: 'ready', renderId: null, durationSeconds: result.durationSeconds,
        timeline: result.timeline, encodingMs: result.encodingMs, peakBufferBytes: result.peakBufferBytes };
      await tx.objectStore('audio').add({ id: JSON.stringify([episode.id, 'final']), episodeId: episode.id, notebookId: episode.notebookId, kind: 'final', blob: result.blob });
      await tx.objectStore('artifacts').put(ready);
      const artifacts = await tx.objectStore('artifacts').index('notebook').getAll(episode.notebookId);
      for (const old of artifacts) if (old.kind === 'podcast' && old.id !== episode.id && old.script.language === episode.script.language && old.status === 'ready') {
        await this.removeAudio(tx, old.id); await tx.objectStore('artifacts').delete(old.id);
      }
      for (const row of rows) await tx.objectStore('audio').delete(row.id);
      await tx.done; return ready;
    } catch (error) { try { tx.abort(); } catch { /* Already committed/aborted. */ } throw error; }
  }
  async releasePodcastRender(fence: PodcastFence): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(PODCAST_STORES, 'readwrite'); watchTransaction(tx);
    const epoch = (await tx.objectStore('meta').get('data-epoch'))?.epoch ?? 0;
    const episode = await tx.objectStore('artifacts').get(fence.episodeId);
    if (epoch === fence.dataEpoch && episode?.kind === 'podcast' && episode.status === 'rendering' && episode.renderId === fence.renderId && episode.notebookId === fence.notebookId && episode.revision === fence.revision && episode.script.language === fence.language && signature(episode) === fence.configSignature) {
      episode.status = 'paused'; episode.renderId = null;
      await tx.objectStore('artifacts').put(episode);
    }
    await tx.done;
  }
  async deletePodcast(episodeId: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(PODCAST_STORES, 'readwrite'); watchTransaction(tx);
    const episode = await tx.objectStore('artifacts').get(episodeId);
    if (episode?.kind === 'podcast') { await this.removeAudio(tx, episodeId); await tx.objectStore('artifacts').delete(episodeId); }
    await tx.done;
  }
  async clear() {
    const db = await this.open();
    const tx = db.transaction(['notebooks', 'sources', 'chunks', 'messages', 'artifacts', 'audio', 'meta'], 'readwrite');
    watchTransaction(tx);
    const epoch = (await tx.objectStore('meta').get('data-epoch'))?.epoch ?? 0;
    for (const name of ['notebooks', 'sources', 'chunks', 'messages', 'artifacts', 'audio'] as const) await tx.objectStore(name).clear();
    await tx.objectStore('meta').put({ id: 'data-epoch', epoch: epoch + 1 });
    await tx.done;
  }
  async close() { if (this.database) (await this.database).close(); this.database = null; }
}
