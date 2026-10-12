import { EMBEDDING_VERSION, LIMITS, MODEL_CACHE, MODEL_IDS } from './constants';
import { citeChunks, generatorContext } from './context';
import { LocalPipeline } from './pipeline';
import { generateAnswer } from './providers';
import { BenchStorage, type StoredChunk } from './storage';
import type { AppSnapshot, Artifact, ChatMessage, GeneratorKind, Progress, Provider, Source, SourceKind } from './types';

const KEY_PREFIX = 'researchbench:key:';
const ACTIVE_KEY = 'researchbench:active-notebook';
const PROVIDER_KEY = 'researchbench:provider';

export class ResearchBenchController {
  private state: AppSnapshot = {
    notebooks: [], activeNotebook: null, sources: [], messages: [], artifacts: [], searchHits: [],
    progress: null, busy: false, provider: 'mistral', hasKey: false, error: null
  };
  private listeners = new Set<(state: AppSnapshot) => void>();
  private storage: BenchStorage;
  private pipeline: LocalPipeline;
  private abortController: AbortController | null = null;
  private jobId = 0;
  private viewRevision = 0;
  private configRevision = 0;
  private initialization: Promise<void> | null = null;
  constructor(storage = new BenchStorage(), pipeline = new LocalPipeline(), private generateResponse = generateAnswer) {
    this.storage = storage; this.pipeline = pipeline;
  }
  subscribe(listener: (state: AppSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }
  private publish(patch: Partial<AppSnapshot> = {}) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
  private report(error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    const name = error instanceof Error ? error.name : '';
    const message = name === 'QuotaExceededError' ? 'Der Browser-Speicher ist voll. Entferne Quellen oder verwende ein kleineres Notebook.'
      : name === 'SecurityError' ? 'Der Browser blockiert lokalen Speicher. Bitte erlaube Website-Daten für ResearchBench.'
      : error instanceof Error ? error.message : 'Der Vorgang konnte nicht abgeschlossen werden.';
    this.publish({ error: message });
  }
  private getKey(provider = this.state.provider) {
    try { return sessionStorage.getItem(`${KEY_PREFIX}${provider}`) ?? ''; } catch { return ''; }
  }
  private rememberSelection() {
    if (this.state.activeNotebook) localStorage.setItem(ACTIVE_KEY, this.state.activeNotebook.id);
    else localStorage.removeItem(ACTIVE_KEY);
  }
  initialize() {
    return this.initialization ??= (async () => {
      try {
        const provider = sessionStorage.getItem(PROVIDER_KEY) === 'openrouter' ? 'openrouter' : 'mistral';
        this.publish({ provider, hasKey: !!this.getKey(provider) });
        const notebooks = await this.storage.listNotebooks();
        if (!notebooks.length) notebooks.push(await this.storage.createNotebook('Mein erstes Notebook'));
        const remembered = localStorage.getItem(ACTIVE_KEY);
        this.publish({ notebooks });
        await this.selectNotebook(notebooks.find(n => n.id === remembered)?.id ?? notebooks[0].id);
      } catch (error) { this.report(error); }
    })();
  }
  private async refresh(id = this.state.activeNotebook?.id) {
    const view = this.viewRevision;
    const notebooks = await this.storage.listNotebooks();
    const data = id ? await this.storage.loadNotebook(id) : null;
    if (view !== this.viewRevision) return;
    this.publish({ notebooks, activeNotebook: data?.notebook ?? null, sources: data?.sources ?? [], messages: data?.messages ?? [], artifacts: data?.artifacts ?? [] });
    this.rememberSelection();
  }
  async createNotebook(name: string) {
    this.cancel();
    try { const notebook = await this.storage.createNotebook(name); await this.selectNotebook(notebook.id); }
    catch (error) { this.report(error); }
  }
  async renameNotebook(name: string) {
    const id = this.state.activeNotebook?.id;
    if (!id) return;
    try { await this.storage.renameNotebook(id, name); await this.refresh(); } catch (error) { this.report(error); }
  }
  async selectNotebook(id: string) {
    this.cancel();
    this.viewRevision += 1;
    this.publish({ searchHits: [], error: null });
    try { await this.refresh(id); } catch (error) { this.report(error); }
  }
  async deleteNotebook(id: string) {
    this.cancel();
    this.viewRevision += 1;
    try {
      await this.storage.deleteNotebook(id);
      const notebooks = await this.storage.listNotebooks();
      if (this.state.activeNotebook?.id === id) await this.selectNotebook(notebooks[0]?.id ?? '');
      else await this.refresh();
    } catch (error) { this.report(error); }
  }
  async deleteSource(id: string) {
    const notebookId = this.state.activeNotebook?.id;
    if (!notebookId) return;
    this.cancel();
    try { await this.storage.deleteSource(id, notebookId); this.publish({ searchHits: [] }); await this.refresh(); }
    catch (error) { this.report(error); }
  }
  setProvider(provider: Provider) {
    if (provider === this.state.provider) return;
    this.cancel(); this.configRevision += 1;
    try {
      sessionStorage.setItem(PROVIDER_KEY, provider);
      this.publish({ provider, hasKey: !!this.getKey(provider), error: null });
    } catch (error) { this.report(error); }
  }
  setKey(key: string) {
    this.cancel(); this.configRevision += 1;
    try {
      const trimmed = key.trim();
      if (/\s/.test(trimmed)) throw new Error('Ein API-Key darf keine Leerzeichen oder Zeilenumbrüche enthalten.');
      if (trimmed) sessionStorage.setItem(`${KEY_PREFIX}${this.state.provider}`, trimmed);
      else sessionStorage.removeItem(`${KEY_PREFIX}${this.state.provider}`);
      this.publish({ hasKey: !!trimmed, error: null });
    } catch (error) { this.report(error); }
  }
  cancel() {
    this.jobId += 1;
    this.abortController?.abort(); this.abortController = null;
    this.pipeline.cancel();
    this.publish({ busy: false, progress: null });
  }
  clearError() { this.publish({ error: null }); }
  private assertCurrent(id: number, notebookId: string, revision?: number, config?: number) {
    if (this.jobId !== id || this.state.activeNotebook?.id !== notebookId || (revision !== undefined && this.state.activeNotebook.revision !== revision) || (config !== undefined && this.configRevision !== config)) {
      throw new DOMException('Abgebrochen', 'AbortError');
    }
  }
  private async job(action: (signal: AbortSignal, id: number, progress: (value: Progress) => void) => Promise<void>) {
    if (this.state.busy) return;
    const id = ++this.jobId;
    const abort = new AbortController(); this.abortController = abort;
    this.publish({ busy: true, error: null, progress: { stage: 'Vorbereitung', current: 0, total: 1 } });
    try { await action(abort.signal, id, value => { if (this.jobId === id) this.publish({ progress: value }); }); }
    catch (error) { if (this.jobId === id) this.report(error); }
    finally { if (this.jobId === id) { this.abortController = null; this.publish({ busy: false, progress: null }); } }
  }
  async importFiles(files: File[]) {
    const notebook = this.state.activeNotebook;
    if (!notebook || !files.length) return;
    await this.job(async (signal, id, progress) => {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        this.assertCurrent(id, notebook.id);
        if (file.size > LIMITS.fileBytes) throw new Error(`${file.name}: Dateien dürfen höchstens 10 MiB groß sein.`);
        if (!file.size) throw new Error(`${file.name}: Die Datei ist leer.`);
        const extension = file.name.split('.').at(-1)?.toLowerCase();
        if (!['pdf', 'md', 'txt'].includes(extension ?? '')) throw new Error('Bitte verwende PDF-, Markdown- oder TXT-Dateien.');
        if (this.state.sources.length >= LIMITS.sources) throw new Error('Das Notebook enthält bereits zehn Quellen.');
        const sourceId = crypto.randomUUID();
        const revision = this.state.activeNotebook!.revision;
        const existingChunks = await this.storage.chunks(notebook.id);
        const existingCharacters = this.state.sources.reduce((n, s) => n + s.pages.reduce((sum, p) => sum + Array.from(p.text).length, 0), 0);
        const result = await this.pipeline.index({
          bytes: await file.arrayBuffer(), kind: extension as SourceKind, notebookId: notebook.id, sourceId,
          remainingChunks: LIMITS.chunks - existingChunks.length, remainingCharacters: LIMITS.characters - existingCharacters
        }, signal, value => progress({ ...value, detail: `${file.name} · Datei ${index + 1} / ${files.length}` }));
        this.assertCurrent(id, notebook.id, revision);
        if (result.chunks.some(chunk => chunk.embeddingVersion !== EMBEDDING_VERSION)) throw new Error('Die Modellversion des Index stimmt nicht überein.');
        const source: Source = {
          id: sourceId, notebookId: notebook.id, name: file.name, kind: extension as SourceKind, size: file.size,
          createdAt: Date.now(), original: file, pages: result.pages, parser: result.parser, chunkCount: result.chunks.length
        };
        await this.storage.saveSource(source, result.chunks, revision, signal);
        this.assertCurrent(id, notebook.id);
        this.publish({ searchHits: [] });
        await this.refresh();
      }
    });
  }
  private matrix(chunks: StoredChunk[]) {
    const matrix = new Float32Array(chunks.length * 384);
    chunks.forEach((chunk, index) => matrix.set(chunk.vector, index * 384));
    return matrix;
  }
  async search(question: string) {
    const notebook = this.state.activeNotebook;
    if (!notebook || !question.trim()) return;
    await this.job(async (signal, id, progress) => {
      const chunks = await this.storage.chunks(notebook.id);
      if (!chunks.length) throw new Error('Bitte zuerst eine Quelle vollständig indexieren.');
      const result = await this.pipeline.search(this.matrix(chunks), question, undefined, 6, signal, progress);
      this.assertCurrent(id, notebook.id, notebook.revision);
      const sources = new Map(this.state.sources.map(source => [source.id, source.name]));
      this.publish({ searchHits: result.map(hit => ({ chunk: chunks[hit.index], score: hit.score, sourceName: sources.get(chunks[hit.index].sourceId) ?? 'Quelle' })) });
    });
  }
  async ask(question: string) {
    const notebook = this.state.activeNotebook;
    if (!notebook || !question.trim()) return;
    const provider = this.state.provider; const key = this.getKey(); const config = this.configRevision;
    await this.job(async (signal, id, progress) => {
      if (!key) throw new Error('Bitte zuerst deinen API-Key in den Einstellungen eingeben.');
      const chunks = await this.storage.chunks(notebook.id);
      if (!chunks.length) throw new Error('Bitte zuerst eine Quelle vollständig indexieren.');
      const history = this.state.messages.filter(m => m.revision === notebook.revision).slice(-8);
      const previous = history.filter(m => m.role === 'user').at(-1)?.text;
      const hits = await this.pipeline.search(this.matrix(chunks), question, previous, 6, signal, progress);
      this.assertCurrent(id, notebook.id, notebook.revision, config);
      const citations = citeChunks(hits.map(hit => chunks[hit.index]), this.state.sources);
      progress({ stage: provider === 'mistral' ? 'Mistral generiert eine belegte Antwort' : 'OpenRouter generiert eine belegte Antwort', current: 0, total: 0 });
      const answer = await this.generateResponse({ provider, key, kind: 'chat', question, citations, history, signal });
      this.assertCurrent(id, notebook.id, notebook.revision, config);
      const now = Date.now();
      const messages: ChatMessage[] = [
        { id: crypto.randomUUID(), notebookId: notebook.id, revision: notebook.revision, createdAt: now, role: 'user', text: question.trim(), citations: [] },
        { id: crypto.randomUUID(), notebookId: notebook.id, revision: notebook.revision, createdAt: now + 1, role: 'assistant', text: answer.blocks.map(block => block.text).join('\n\n'), answer, citations, provider, model: MODEL_IDS[provider] }
      ];
      await this.storage.saveMessages(messages, notebook.revision, signal);
      this.assertCurrent(id, notebook.id, notebook.revision, config);
      await this.refresh();
    });
  }
  async generate(kind: GeneratorKind) {
    const notebook = this.state.activeNotebook;
    if (!notebook) return;
    const provider = this.state.provider; const key = this.getKey(); const config = this.configRevision;
    await this.job(async (signal, id, progress) => {
      if (!key) throw new Error('Bitte zuerst deinen API-Key in den Einstellungen eingeben.');
      const chunks = await this.storage.chunks(notebook.id);
      if (!chunks.length) throw new Error('Bitte zuerst eine Quelle vollständig indexieren.');
      const context = generatorContext(this.state.sources, chunks);
      progress({ stage: 'Studio-Inhalt wird generiert', current: 0, total: 0 });
      const answer = await this.generateResponse({ provider, key, kind, citations: context.citations, signal });
      this.assertCurrent(id, notebook.id, notebook.revision, config);
      const artifact: Artifact = {
        id: crypto.randomUUID(), notebookId: notebook.id, revision: notebook.revision, kind, createdAt: Date.now(),
        answer, citations: context.citations, coverage: context.coverage, provider, model: MODEL_IDS[provider]
      };
      await this.storage.saveArtifact(artifact, signal);
      this.assertCurrent(id, notebook.id, notebook.revision, config);
      await this.refresh();
    });
  }
  async clearAll() {
    this.cancel(); this.viewRevision += 1; this.configRevision += 1;
    // Hide and release document/key state immediately, even when one storage backend is blocked.
    this.publish({ notebooks: [], activeNotebook: null, sources: [], messages: [], artifacts: [], searchHits: [], hasKey: false, provider: 'mistral', error: null });
    const tasks: Array<{ label: string; run: () => unknown }> = [
      { label: 'lokale Notebook-Daten', run: () => this.storage.clear() },
      { label: 'Mistral-Sitzungsschlüssel', run: () => sessionStorage.removeItem(`${KEY_PREFIX}mistral`) },
      { label: 'OpenRouter-Sitzungsschlüssel', run: () => sessionStorage.removeItem(`${KEY_PREFIX}openrouter`) },
      { label: 'API-Auswahl', run: () => sessionStorage.removeItem(PROVIDER_KEY) },
      { label: 'Notebook-Auswahl', run: () => localStorage.removeItem(ACTIVE_KEY) },
      { label: 'Modell-Cache', run: () => 'caches' in globalThis ? caches.delete(MODEL_CACHE) : undefined }
    ];
    const results = await Promise.allSettled(tasks.map(task => Promise.resolve().then(task.run)));
    const failed = results.flatMap((result, index) => result.status === 'rejected' ? [tasks[index].label] : []);
    if (failed.length) this.publish({ error: `Nicht vollständig gelöscht: ${failed.join(', ')}. Bitte entferne die Website-Daten in deinen Browser-Einstellungen.` });
  }
}
