import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { message, translateMessage } from '../../src/lib/i18n/index';
import { setLocale } from '../../src/lib/i18n/store';
import { runtimeErrorDescriptor, localizedProgress } from '../../src/lib/i18n/runtime-errors';
import { errorDescriptor, localizedError } from '../../src/lib/i18n/message';
import { buildGenerationBody, generateAnswer, GenerationError, type GenerationRequest } from '../../src/lib/providers';
import { resolvePodcastAudioConfig } from '../../src/lib/podcast-providers';
import { StorageConflict, BenchStorage } from '../../src/lib/storage';
import { ResearchBenchController } from '../../src/lib/controller';
import { LocalPipeline } from '../../src/lib/pipeline';
import { EMBEDDING_VERSION } from '../../src/lib/constants';
import type { AppSnapshot, GroundedAnswer } from '../../src/lib/types';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}
afterEach(() => { setLocale('en'); vi.unstubAllGlobals(); });

describe('runtime presentation descriptors', () => {
  it.each([
    ['Die Textdatei ist nicht gültig als UTF-8 kodiert.', 'runtime.rustUtf8', 'The text file is not valid UTF-8.'],
    ['Die PDF ist verschlüsselt oder passwortgeschützt. Bitte eine ungeschützte Datei verwenden.', 'runtime.rustPdfEncrypted', 'The PDF is encrypted or password-protected. Use an unprotected file.'],
    ['Vektoren enthalten nicht-endliche Werte.', 'runtime.rustNonFiniteVectors', 'Vectors contain non-finite values.'],
    ['Die PDF enthält keinen extrahierbaren Text. Gescannte PDFs benötigen OCR, die hier nicht enthalten ist.', 'runtime.rustPdfNoText', 'The PDF has no extractable text. Scanned PDFs require OCR, which is not included here.']
  ])('maps the finite Rust diagnostic %s without changing the ABI', (raw, key, expected) => {
    const ref = runtimeErrorDescriptor(raw);
    expect(ref.key).toBe(key);
    expect(translateMessage('de', ref)).toBe(raw);
    expect(translateMessage('en', ref)).toBe(expected);
  });
  it('never exposes unknown provider or parser payloads in localized errors', () => {
    const ref = runtimeErrorDescriptor(new Error('Secret token: pretend-secret; document: private source'));
    expect(ref).toEqual(message('runtime.operationFailed'));
    expect(translateMessage('en', ref)).not.toContain('pretend-secret');
    expect(translateMessage('de', ref)).not.toContain('private source');
  });
  it('preserves error categories and legacy diagnostics while presentation is bilingual', () => {
    const error = new GenerationError(message('runtime.apiHttp', { status: 503 }), 'http_503');
    expect(error.name).toBe('GenerationError'); expect(error.code).toBe('http_503');
    expect(error.message).toContain('Die API meldet einen Fehler (HTTP 503)');
    expect(translateMessage('en', errorDescriptor(error)!)).toContain('The API returned an error (HTTP 503)');
    const conflict = new StorageConflict();
    expect(translateMessage('en', runtimeErrorDescriptor(conflict))).toBe('Sources changed during processing. Try again.');
  });
  it('maps quota and blocked-storage errors safely', () => {
    expect(runtimeErrorDescriptor(new DOMException('private storage text', 'QuotaExceededError')).key).toBe('runtime.quota');
    expect(runtimeErrorDescriptor(new DOMException('private storage text', 'SecurityError')).key).toBe('runtime.storageBlocked');
  });
  it('localizes provider names within missing-key errors for both API paths', async () => {
    const request: GenerationRequest = { provider: 'mistral', key: '', kind: 'chat', citations: [], signal: new AbortController().signal };
    for (const operation of [() => generateAnswer(request), () => resolvePodcastAudioConfig('mistral', '', request.signal)]) {
      const error = await operation().catch(error => error);
      expect(error).toBeInstanceOf(GenerationError);
      expect(translateMessage('en', runtimeErrorDescriptor(error))).toBe('Enter your Mistral direct API key first.');
      expect(error.message).toBe('Bitte zuerst deinen Mistral direkt-API-Key eingeben.');
    }
  });
  it('keeps filenames intact and localizes counters, stages and encoder details', () => {
    const progress = localizedProgress({ stage: 'Quellen werden lokal indexiert', current: 1, total: 2, detail: 'legacy', detailMessage: message('runtime.fileProgress', { filename: 'Müller-notes.txt', current: 1000, total: 2000 }) });
    expect(translateMessage('en', progress.stageMessage!)).toBe('Indexing sources locally');
    expect(translateMessage('de', progress.detailMessage!)).toBe('Müller-notes.txt · Datei 1.000 / 2.000');
    expect(translateMessage('en', progress.detailMessage!)).toBe('Müller-notes.txt · File 1,000 / 2,000');
    expect(translateMessage('en', localizedProgress({ stage: 'encoding', current: 0, total: 1 }).stageMessage!)).toBe('Assembling audio');
  });
  it('translates an existing partial-wipe descriptor live, including failed area labels', () => {
    const ref = message('runtime.wipeIncomplete', { items: [message('runtime.wipeMistralKey'), message('runtime.wipeModelCache')] });
    expect(translateMessage('en', ref)).toContain('Mistral session key and model cache');
    expect(translateMessage('de', ref)).toContain('Mistral-Sitzungsschlüssel und Modell-Cache');
  });
});

describe('generation language and operation boundaries', () => {
  it('defaults requests to English and keeps an explicit question language override', () => {
    const request: GenerationRequest = { provider: 'mistral', key: 'fictional', kind: 'chat', question: 'Please answer in French', citations: [{ id: 'C1', sourceId: 's1', sourceName: 'fictional.txt', page: 1, start: 0, end: 4, text: 'Fact' }], signal: new AbortController().signal };
    const english = buildGenerationBody(request).messages as Array<{ role: string; content: string }>;
    expect(english[0].content).toContain('Respond in English');
    expect(english[0].content).toContain('sofern die Frage keine andere Sprache ausdrücklich verlangt');
    expect(english.at(-1)!.content).toContain('Please answer in French');
    const german = buildGenerationBody({ ...request, language: 'de' }).messages as Array<{ role: string; content: string }>;
    expect(german[0].content).toContain('Antworte auf Deutsch');
  });
  it('captures language once per operation and switching locale does not cancel or mutate stored content', async () => {
    vi.stubGlobal('sessionStorage', new MemoryStorage()); vi.stubGlobal('localStorage', new MemoryStorage());
    const storage = new BenchStorage(); await storage.clear();
    const pipeline = new LocalPipeline();
    vi.spyOn(pipeline, 'cancel').mockImplementation(() => {});
    vi.spyOn(pipeline, 'index').mockImplementation(async payload => {
      const vector = new Float32Array(384); vector[0] = 1;
      return { parser: 'fixture', pages: [{ page: 1, text: 'Preserved original source.' }], chunks: [{ id: 'original-chunk', notebookId: payload.notebookId, sourceId: payload.sourceId, page: 1, start: 0, end: 26, text: 'Preserved original source.', vector, embeddingVersion: EMBEDDING_VERSION }] };
    });
    vi.spyOn(pipeline, 'search').mockResolvedValue([{ index: 0, score: 1 }]);
    let release!: (answer: GroundedAnswer) => void;
    const generate = vi.fn<(request: GenerationRequest) => Promise<GroundedAnswer>>().mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const controller = new ResearchBenchController(storage, pipeline, generate);
    let state!: AppSnapshot; controller.subscribe(value => { state = value; });
    try {
      setLocale('en'); await controller.initialize();
      expect(state.activeNotebook?.name).toBe('My first notebook');
      await controller.importFiles([new File(['fixture'], 'unchanged.txt')]); controller.setKey('fictional-key');
      setLocale('de'); const asking = controller.ask('Original question');
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
      const captured = generate.mock.calls[0][0];
      expect(captured.language).toBe('de');
      setLocale('en');
      expect(captured.signal.aborted).toBe(false); expect(state.busy).toBe(true);
      release({ title: 'Existing German answer', blocks: [{ text: 'Unchanged generated content', citationIds: ['C1'] }] });
      await asking;
      expect(state.error).toBeNull(); expect(state.sources[0].name).toBe('unchanged.txt');
      expect(state.sources[0].pages[0].text).toBe('Preserved original source.');
      expect(state.messages[0].text).toBe('Original question');
      expect(state.messages[1].text).toBe('Unchanged generated content');
      expect(state.activeNotebook?.name).toBe('My first notebook');
      await controller.clearAll();
      expect(localStorage.getItem('researchbench:locale')).toBe('en');
    } finally { controller.cancel(); await storage.clear(); await storage.close(); }
  });
  it('keeps parameterized filename errors translatable after their creation', () => {
    const error = localizedError('runtime.emptyFile', { filename: 'Résumé.txt' });
    expect(error.message).toBe('Résumé.txt: Die Datei ist leer.');
    expect(translateMessage('en', runtimeErrorDescriptor(error))).toBe('Résumé.txt: The file is empty.');
  });
});
