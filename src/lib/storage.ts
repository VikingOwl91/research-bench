import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { EMBEDDING_VERSION, LIMITS } from './constants';
import type { Artifact, ChatMessage, Chunk, Notebook, Source } from './types';

export const DB_NAME = 'researchbench-v1';
export interface StoredChunk extends Chunk { vector: Float32Array; embeddingVersion: string; }
interface BenchDB extends DBSchema {
  notebooks: { key: string; value: Notebook };
  sources: { key: string; value: Source; indexes: { notebook: string } };
  chunks: { key: string; value: StoredChunk; indexes: { notebook: string; source: string } };
  messages: { key: string; value: ChatMessage; indexes: { notebook: string } };
  artifacts: { key: string; value: Artifact; indexes: { notebook: string } };
}
export class StorageConflict extends Error {
  constructor(message = 'Die Quellen haben sich während der Verarbeitung geändert. Bitte erneut versuchen.') { super(message); this.name = 'StorageConflict'; }
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
    return this.database ??= openDB<BenchDB>(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('notebooks', { keyPath: 'id' });
        for (const name of ['sources', 'messages', 'artifacts'] as const) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          store.createIndex('notebook', 'notebookId');
        }
        const chunks = db.createObjectStore('chunks', { keyPath: 'id' });
        chunks.createIndex('notebook', 'notebookId');
        chunks.createIndex('source', 'sourceId');
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
    const notebook: Notebook = { id: crypto.randomUUID(), name: name.trim().slice(0, 120) || 'Neues Notebook', createdAt: Date.now(), revision: 0 };
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
  async saveArtifact(artifact: Artifact, signal?: AbortSignal) {
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
    const tx = db.transaction(['notebooks', 'sources', 'chunks', 'messages', 'artifacts'], 'readwrite');
    for (const name of ['sources', 'chunks', 'messages', 'artifacts'] as const) {
      const keys = await tx.objectStore(name).index('notebook').getAllKeys(id);
      for (const key of keys) await tx.objectStore(name).delete(key);
    }
    await tx.objectStore('notebooks').delete(id);
    await tx.done;
  }
  async clear() {
    const db = await this.open();
    const tx = db.transaction(['notebooks', 'sources', 'chunks', 'messages', 'artifacts'], 'readwrite');
    for (const name of ['notebooks', 'sources', 'chunks', 'messages', 'artifacts'] as const) await tx.objectStore(name).clear();
    await tx.done;
  }
  async close() { if (this.database) (await this.database).close(); this.database = null; }
}
