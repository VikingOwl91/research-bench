import { displaySourceName } from './display-source-name';
import { message, translate, type MessageDescriptor } from './i18n/index';
import { getLocale } from './i18n/store';
import { localizedError } from './i18n/message';
import { localizedProgress, runtimeErrorDescriptor } from './i18n/runtime-errors';
import { EMBEDDING_VERSION, LIMITS, MODEL_CACHE, MODEL_IDS } from './constants';
import { citeChunks, generatorContext } from './context';
import { LocalPipeline } from './pipeline';
import { generateAnswer } from './providers';
import { generatePodcastScript, resolvePodcastAudioConfig, synthesizePodcastTurn } from './podcast-providers';
import { PodcastAudioEngine } from './audio/engine';
import { BenchStorage, type StoredChunk } from './storage';
import type { AppSnapshot, TextArtifact, ChatMessage, GeneratorKind, Progress, Provider, Source, SourceKind, PodcastArtifact, PodcastLanguage, PodcastFence, PodcastAudioConfig, PodcastRenderedAudio } from './types';

export interface PodcastLockManager {
  request<T>(name: string, options: { mode: 'exclusive'; ifAvailable: true }, callback: (lock: unknown | null) => Promise<T>): Promise<T>;
}
export interface PodcastServices {
  generateScript?: typeof generatePodcastScript;
  resolveAudioConfig?: typeof resolvePodcastAudioConfig;
  synthesizeTurn?: typeof synthesizePodcastTurn;
  audioEngine?: Pick<PodcastAudioEngine, 'cancel' | 'prepare' | 'render'>;
  locks?: PodcastLockManager | null;
}

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
  private audio: Pick<PodcastAudioEngine, 'cancel' | 'prepare' | 'render'>;
  constructor(storage = new BenchStorage(), pipeline = new LocalPipeline(), private generateResponse = generateAnswer, private podcast: PodcastServices = {}) {
    this.storage = storage; this.pipeline = pipeline;
    this.audio = podcast.audioEngine ?? new PodcastAudioEngine();
  }
  subscribe(listener: (state: AppSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }
  private publish(patch: Partial<AppSnapshot> = {}) {
    if (patch.error === null) patch.errorMessage = null;
    if (patch.progress) patch.progress = localizedProgress(patch.progress);
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
  private report(error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    const name = error instanceof Error ? error.name : '';
    const message = name === 'QuotaExceededError' ? 'Der Browser-Speicher ist voll. Entferne Quellen oder verwende ein kleineres Notebook.'
      : name === 'SecurityError' ? 'Der Browser blockiert lokalen Speicher. Bitte erlaube Website-Daten für ResearchBench.'
      : error instanceof Error ? error.message : 'Der Vorgang konnte nicht abgeschlossen werden.';
    this.publish({ error: message, errorMessage: runtimeErrorDescriptor(error) });
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
        if (!notebooks.length) notebooks.push(await this.storage.createNotebook(translate(getLocale(), 'runtime.firstNotebook')));
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
    const wasBusy = this.state.busy;
    this.cancel();
    try {
      const notebook = await this.storage.createNotebook(name);
      await this.selectNotebook(notebook.id);
      if (wasBusy) this.notifyDiscarded();
    } catch (error) { this.report(error); }
  }
  async renameNotebook(name: string) {
    const id = this.state.activeNotebook?.id;
    if (!id) return;
    try { await this.storage.renameNotebook(id, name); await this.refresh(); } catch (error) { this.report(error); }
  }
  async selectNotebook(id: string) {
    const wasBusy = this.state.busy;
    this.cancel();
    this.viewRevision += 1;
    this.publish({ searchHits: [], error: null });
    if (wasBusy) this.notifyDiscarded();
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
    const wasBusy = this.state.busy;
    this.cancel();
    if (wasBusy) this.notifyDiscarded();
    try { await this.storage.deleteSource(id, notebookId); this.publish({ searchHits: [] }); await this.refresh(); }
    catch (error) { this.report(error); }
  }
  setProvider(provider: Provider) {
    if (provider === this.state.provider) return;
    const wasBusy = this.state.busy;
    this.cancel(); this.configRevision += 1;
    try {
      sessionStorage.setItem(PROVIDER_KEY, provider);
      this.publish({ provider, hasKey: !!this.getKey(provider), error: null });
    } catch (error) { this.report(error); }
    if (wasBusy) this.notifyDiscarded();
  }
  setKey(key: string) {
    const wasBusy = this.state.busy;
    this.cancel(); this.configRevision += 1;
    try {
      const trimmed = key.trim();
      if (/\s/.test(trimmed)) throw new Error('Ein API-Key darf keine Leerzeichen oder Zeilenumbrüche enthalten.');
      if (trimmed) sessionStorage.setItem(`${KEY_PREFIX}${this.state.provider}`, trimmed);
      else sessionStorage.removeItem(`${KEY_PREFIX}${this.state.provider}`);
      this.publish({ hasKey: !!trimmed, error: null });
    } catch (error) { this.report(error); }
    if (wasBusy) this.notifyDiscarded();
  }
  cancel() {
    this.jobId += 1;
    this.abortController?.abort(); this.abortController = null;
    this.pipeline.cancel();
    this.audio.cancel();
    this.publish({ busy: false, progress: null });
  }
  clearError() { this.publish({ error: null }); }
  /** Tell the user when an in-flight job was discarded because the inputs changed. */
  private notifyDiscarded() {
    if (this.state.error) return; // A real error from the action itself takes precedence.
    this.publish({ error: translate(getLocale(), 'runtime.staleAbort'), errorMessage: message('runtime.staleAbort') });
  }
  private assertCurrent(id: number, notebookId: string, revision?: number, config?: number) {
    if (this.jobId !== id || this.state.activeNotebook?.id !== notebookId) {
      throw new DOMException('Abgebrochen', 'AbortError');
    }
    // The job is still current, but the sources or configuration changed (for
    // example from another tab): report it instead of dropping the result silently.
    if ((revision !== undefined && this.state.activeNotebook!.revision !== revision) || (config !== undefined && this.configRevision !== config)) {
      throw localizedError('runtime.staleAbort');
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
        if (file.size > LIMITS.fileBytes) throw localizedError('runtime.fileTooLarge', { filename: displaySourceName(file.name) });
        if (!file.size) throw localizedError('runtime.emptyFile', { filename: displaySourceName(file.name) });
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
        }, signal, value => progress({ ...value, detail: `${displaySourceName(file.name)} · Datei ${index + 1} / ${files.length}`, detailMessage: message('runtime.fileProgress', { filename: displaySourceName(file.name), current: index + 1, total: files.length }) }));
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
      this.publish({ searchHits: result.map(hit => ({ chunk: chunks[hit.index], score: hit.score, sourceName: sources.get(chunks[hit.index].sourceId) ?? translate(getLocale(), 'runtime.source') })) });
    });
  }
  async ask(question: string) {
    const notebook = this.state.activeNotebook;
    if (!notebook || !question.trim()) return;
    const provider = this.state.provider; const key = this.getKey(); const config = this.configRevision; const language = getLocale();
    await this.job(async (signal, id, progress) => {
      if (!key) throw new Error('Bitte zuerst deinen API-Key in den Einstellungen eingeben.');
      const chunks = await this.storage.chunks(notebook.id);
      if (!chunks.length) throw new Error('Bitte zuerst eine Quelle vollständig indexieren.');
      const history = this.state.messages.filter(m => m.revision === notebook.revision).slice(-8);
      const previous = history.filter(m => m.role === 'user').at(-1)?.text;
      const hits = await this.pipeline.search(this.matrix(chunks), question, previous, 6, signal, progress);
      this.assertCurrent(id, notebook.id, notebook.revision, config);
      const citations = citeChunks(hits.map(hit => chunks[hit.index]), this.state.sources);
      progress({ stage: provider === 'mistral' ? 'Mistral generiert eine belegte Antwort' : 'OpenRouter generiert eine belegte Antwort', stageMessage: message('runtime.answerProgress', { provider: provider === 'mistral' ? 'Mistral' : 'OpenRouter' }), current: 0, total: 0 });
      const answer = await this.generateResponse({ provider, key, kind: 'chat', question, citations, history, signal, language });
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
    const provider = this.state.provider; const key = this.getKey(); const config = this.configRevision; const language = getLocale();
    await this.job(async (signal, id, progress) => {
      if (!key) throw new Error('Bitte zuerst deinen API-Key in den Einstellungen eingeben.');
      const chunks = await this.storage.chunks(notebook.id);
      if (!chunks.length) throw new Error('Bitte zuerst eine Quelle vollständig indexieren.');
      const context = generatorContext(this.state.sources, chunks);
      progress({ stage: 'Studio-Inhalt wird generiert', current: 0, total: 0 });
      const answer = await this.generateResponse({ provider, key, kind, citations: context.citations, signal, language });
      this.assertCurrent(id, notebook.id, notebook.revision, config);
      const artifact: TextArtifact = {
        id: crypto.randomUUID(), notebookId: notebook.id, revision: notebook.revision, kind, createdAt: Date.now(),
        answer, citations: context.citations, coverage: context.coverage, provider, model: MODEL_IDS[provider]
      };
      await this.storage.saveArtifact(artifact, signal);
      this.assertCurrent(id, notebook.id, notebook.revision, config);
      await this.refresh();
    });
  }
  private async podcastLock<T>(name: string, signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    const locks: PodcastLockManager | null | undefined = this.podcast.locks === undefined ? globalThis.navigator?.locks as PodcastLockManager | undefined : this.podcast.locks;
    if (!locks) throw new Error('Dieser Browser unterstützt keine sicheren parallelen Podcast-Aufträge (Web Locks). Wiedergabe bleibt verfügbar.');
    if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    // ifAvailable cannot be combined with signal. Nothing queues; the callback checks cancellation itself.
    return locks.request(`researchbench:podcast:${name}`, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
      if (!lock) throw new Error('Dieser Podcast wird bereits in einem anderen Tab verarbeitet. Bitte dort beenden oder später ausdrücklich fortsetzen.');
      return action();
    });
  }
  private async assertPodcastSource(id: number, notebookId: string, revision: number, config: number, epoch: number) {
    this.assertCurrent(id, notebookId, revision, config);
    const [storedRevision, storedEpoch] = await Promise.all([this.storage.getNotebookRevision(notebookId), this.storage.getDataEpoch()]);
    this.assertCurrent(id, notebookId, revision, config);
    if (storedRevision !== revision || storedEpoch !== epoch) throw new Error('Die lokalen Quellen oder Daten wurden in einem anderen Tab geändert. Bitte das Notebook neu öffnen.');
  }
  private async renderPodcast(episode: PodcastArtifact, fence: PodcastFence, key: string, config: number, signal: AbortSignal, id: number, progress: (value: Progress) => void) {
    const guard = () => this.assertCurrent(id, episode.notebookId, episode.revision, config);
    const persistedGuard = async () => { guard(); await this.storage.assertPodcastFence(fence); guard(); };
    const segments = new Map((await this.storage.loadPodcastSegments(episode.id)).map(segment => [segment.turnId, segment]));
    for (const turn of episode.script.turns) {
      if (segments.has(turn.id)) continue;
      await persistedGuard();
      progress({ stage: 'Podcast-Beiträge werden gesprochen', current: segments.size, total: episode.script.turns.length, detail: `Host ${turn.speaker} · ${turn.id}`, detailMessage: message('runtime.hostTurn', { speaker: turn.speaker, turn: turn.id }) });
      const spoken = await (this.podcast.synthesizeTurn ?? synthesizePodcastTurn)({ config: episode.audioConfig, speaker: turn.speaker, key, text: turn.text, signal });
      guard();
      const segment = await this.audio.prepare(turn.id, spoken, signal);
      guard();
      await this.storage.savePodcastSegment(fence, segment, signal);
      guard(); segments.set(turn.id, segment);
      await this.refresh(episode.notebookId);
    }
    await persistedGuard();
    const ordered = episode.script.turns.map(turn => segments.get(turn.id)!);
    const result = await this.audio.render(ordered, episode.audioConfig, signal, value => { guard(); progress(value); });
    guard();
    await this.storage.completePodcast(fence, result, signal);
    guard(); await this.refresh(episode.notebookId);
  }
  private async releasePodcast(fence: PodcastFence) {
    // Cleanup belongs to the old render even when its job was canceled. Storage checks its identity.
    try {
      await this.storage.releasePodcastRender(fence);
      const currentJob = this.jobId;
      if (this.state.activeNotebook?.id === fence.notebookId && !this.state.busy) {
        const data = await this.storage.loadNotebook(fence.notebookId);
        if (this.jobId === currentJob && this.state.activeNotebook?.id === fence.notebookId && !this.state.busy) this.publish({ artifacts: data.artifacts });
      }
    } catch { /* Preserve original failure; reload can reclaim a persisted render with a new identity. */ }
  }
  async generatePodcast(language: PodcastLanguage) {
    const notebook = this.state.activeNotebook;
    if (!notebook) return;
    const provider = this.state.provider, key = this.getKey(), config = this.configRevision;
    await this.job(async (signal, id, progress) => {
      if (!key) throw new Error('Bitte zuerst deinen API-Key in den Einstellungen eingeben.');
      await this.podcastLock(`${notebook.id}:${language}`, signal, async () => {
        const epoch = await this.storage.getDataEpoch();
        await this.assertPodcastSource(id, notebook.id, notebook.revision, config, epoch);
        const chunks = await this.storage.chunks(notebook.id);
        if (!chunks.length) throw new Error('Bitte zuerst eine Quelle vollständig indexieren.');
        const context = generatorContext(this.state.sources, chunks);
        progress({ stage: 'Podcast-Stimmen prüfen', current: 0, total: 0 });
        const audioConfig = await (this.podcast.resolveAudioConfig ?? resolvePodcastAudioConfig)(provider, key, signal);
        await this.assertPodcastSource(id, notebook.id, notebook.revision, config, epoch);
        progress({ stage: 'Podcast-Gespräch anhand deiner Quellen wird geschrieben', current: 0, total: 0 });
        const script = await (this.podcast.generateScript ?? generatePodcastScript)({ provider, key, language, citations: context.citations, signal });
        await this.assertPodcastSource(id, notebook.id, notebook.revision, config, epoch);
        const draft: PodcastArtifact = {
          id: crypto.randomUUID(), notebookId: notebook.id, revision: notebook.revision, kind: 'podcast', createdAt: Date.now(),
          script, citations: context.citations, coverage: context.coverage, provider, model: MODEL_IDS[provider], audioConfig,
          status: 'rendering', renderId: crypto.randomUUID(), completedTurnIds: []
        };
        const { episode, fence } = await this.storage.createPodcastCandidate(draft, epoch, signal);
        try { this.assertCurrent(id, notebook.id, notebook.revision, config); await this.refresh(); await this.renderPodcast(episode, fence, key, config, signal, id, progress); }
        finally { await this.releasePodcast(fence); }
      });
    });
    if (this.state.activeNotebook?.id === notebook.id && !this.state.busy) await this.refresh();
  }
  async resumePodcast(episodeId: string) {
    const draft = this.state.artifacts.find((artifact): artifact is PodcastArtifact => artifact.id === episodeId && artifact.kind === 'podcast');
    if (!draft || draft.status === 'ready') return;
    const provider = this.state.provider, key = this.getKey(), config = this.configRevision;
    await this.job(async (signal, id, progress) => {
      if (!key) throw new Error('Bitte zuerst deinen API-Key in den Einstellungen eingeben.');
      if (draft.provider !== provider) throw new Error('Dieser Entwurf verwendet einen anderen Anbieter. Wähle den ursprünglichen Anbieter zum Fortsetzen.');
      await this.podcastLock(`${draft.notebookId}:${draft.script.language}`, signal, async () => {
        const epoch = await this.storage.getDataEpoch();
        await this.assertPodcastSource(id, draft.notebookId, draft.revision, config, epoch);
        const { episode, fence } = await this.storage.claimPodcastResume(draft.id, provider, crypto.randomUUID(), epoch, signal);
        try { this.assertCurrent(id, draft.notebookId, draft.revision, config); await this.refresh(); await this.renderPodcast(episode, fence, key, config, signal, id, progress); }
        finally { await this.releasePodcast(fence); }
      });
    });
    if (this.state.activeNotebook?.id === draft.notebookId && !this.state.busy) await this.refresh();
  }
  getPodcastAudio(episodeId: string) { return this.storage.getPodcastAudio(episodeId); }
  async deletePodcast(episodeId: string) {
    this.cancel();
    try { await this.storage.deletePodcast(episodeId); await this.refresh(); } catch (error) { this.report(error); }
  }
  async probePodcastVoices(language: PodcastLanguage): Promise<{ audio: PodcastRenderedAudio; config: PodcastAudioConfig } | null> {
    const notebook = this.state.activeNotebook;
    if (!notebook) return null;
    const provider = this.state.provider, key = this.getKey(), configRevision = this.configRevision;
    let result: { audio: PodcastRenderedAudio; config: PodcastAudioConfig } | null = null;
    await this.job(async (signal, id, progress) => {
      if (!key) throw new Error('Bitte zuerst deinen API-Key in den Einstellungen eingeben.');
      await this.podcastLock(`probe:${provider}`, signal, async () => {
        const guard = () => this.assertCurrent(id, notebook.id, undefined, configRevision);
        progress({ stage: 'Stimmenprobe vorbereiten', current: 0, total: 2 });
        const config = await (this.podcast.resolveAudioConfig ?? resolvePodcastAudioConfig)(provider, key, signal); guard();
        const texts = language === 'de' ? [
          'Willkommen bei unserer Stimmenprobe. Stellen wir uns ein kleines Wasserlabor vor: Was können wir gemeinsam aus einer Probe lernen?',
          'Wir vergleichen die Messwerte und fragen nach ihren Grenzen. Das ist ein frei erfundenes Beispiel, damit du unsere Aussprache und den Übergang zwischen den Stimmen hören kannst.'
        ] : [
          'Welcome to our voice test. Imagine a small water laboratory: what can we learn together from a sample?',
          'We compare the measurements and question their limits. This is a fictional example so you can hear our pronunciation and the transition between voices.'
        ];
        const segments = [];
        for (const [index, text] of texts.entries()) {
          guard(); progress({ stage: 'Stimmenprobe wird gesprochen', current: index, total: 2 });
          const input = await (this.podcast.synthesizeTurn ?? synthesizePodcastTurn)({ config, key, text, speaker: index === 0 ? 'A' : 'B', signal }); guard();
          const segment = await this.audio.prepare(`T${index + 1}`, input, signal); guard(); segments.push(segment);
        }
        const audio = await this.audio.render(segments, config, signal, value => { guard(); progress(value); }); guard();
        result = { audio, config };
      });
    });
    return result;
  }
  async clearAll() {
    this.cancel(); this.viewRevision += 1; this.configRevision += 1;
    // Hide and release document/key state immediately, even when one storage backend is blocked.
    this.publish({ notebooks: [], activeNotebook: null, sources: [], messages: [], artifacts: [], searchHits: [], hasKey: false, provider: 'mistral', error: null });
    const tasks: Array<{ label: string; message: MessageDescriptor; run: () => unknown }> = [
      { label: 'lokale Notebook-Daten', message: message('runtime.wipeNotebooks'), run: () => this.storage.clear() },
      { label: 'Mistral-Sitzungsschlüssel', message: message('runtime.wipeMistralKey'), run: () => sessionStorage.removeItem(`${KEY_PREFIX}mistral`) },
      { label: 'OpenRouter-Sitzungsschlüssel', message: message('runtime.wipeOpenRouterKey'), run: () => sessionStorage.removeItem(`${KEY_PREFIX}openrouter`) },
      { label: 'API-Auswahl', message: message('runtime.wipeProvider'), run: () => sessionStorage.removeItem(PROVIDER_KEY) },
      { label: 'Notebook-Auswahl', message: message('runtime.wipeNotebookSelection'), run: () => localStorage.removeItem(ACTIVE_KEY) },
      { label: 'Modell-Cache', message: message('runtime.wipeModelCache'), run: () => 'caches' in globalThis ? caches.delete(MODEL_CACHE) : undefined }
    ];
    const results = await Promise.allSettled(tasks.map(task => Promise.resolve().then(task.run)));
    const failed = results.flatMap((result, index) => result.status === 'rejected' ? [tasks[index].label] : []);
    if (failed.length) this.publish({ error: `Nicht vollständig gelöscht: ${failed.join(', ')}. Bitte entferne die Website-Daten in deinen Browser-Einstellungen.`, errorMessage: message('runtime.wipeIncomplete', { items: results.flatMap((result, index) => result.status === 'rejected' ? [tasks[index].message] : []) }) });
  }
}
