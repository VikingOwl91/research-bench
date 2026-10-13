/// <reference lib="webworker" />
import { localizedProgress, runtimeErrorDescriptor } from './i18n/runtime-errors';
import { translateMessage } from './i18n/index';
import { AutoTokenizer, env, pipeline, type FeatureExtractionPipeline, type PreTrainedTokenizer } from '@huggingface/transformers';
import * as rust from './wasm/research_core.js';
import { EMBEDDING_VERSION, LIMITS, MODEL_CACHE } from './constants';
import type { PageText, Progress, SourceKind } from './types';

declare const __MODEL_ASSET_BASE__: string;

interface RawChunk { page: number; start: number; end: number; text: string; }
interface IndexPayload { bytes: ArrayBuffer; kind: SourceKind; notebookId: string; sourceId: string; remainingChunks: number; remainingCharacters: number; }
interface SearchPayload { matrix: Float32Array; question: string; previousQuestion?: string; k: number; }
let coreReady: Promise<void> | null = null;
let rustExports: Awaited<ReturnType<typeof rust.default>>;
let pdfReady: Promise<void> | null = null;
let modelReady: Promise<void> | null = null;
let extractor: FeatureExtractionPipeline;
let tokenizer: PreTrainedTokenizer;
let currentId = 0;

function progress(value: Progress) { self.postMessage({ id: currentId, progress: localizedProgress(value) }); }

function initCore() { return coreReady ??= rust.default().then(exports => { rustExports = exports; }); }

function initPdfium() {
  return pdfReady ??= (async () => {
    await initCore();
    const script = '/pdfium/pdfium.js';
    const glue = await import(/* @vite-ignore */ script);
    const module = await glue.default({
      locateFile: (name: string) => name.endsWith('.wasm') ? '/pdfium/pdfium.wasm' : `/pdfium/${name}`,
      print: () => {}, printErr: () => {}
    });
    if (!rust.initialize_pdfium_render(module, rustExports, false)) throw new Error('PDF-Verarbeitung konnte nicht initialisiert werden.');
  })();
}

function initModel() {
  return modelReady ??= (async () => {
    progress({ stage: 'Lokales Modell wird geladen', current: 0, total: 0 });
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = __MODEL_ASSET_BASE__;
    env.useFS = false;
    env.useFSCache = false;
    env.useBrowserCache = true;
    env.cacheKey = MODEL_CACHE;
    env.useWasmCache = true;
    env.logLevel = 50;
    env.backends.onnx.wasm!.wasmPaths = '/runtime/';
    env.backends.onnx.wasm!.numThreads = 1;
    env.backends.onnx.wasm!.proxy = false;
    // Transformers 4.3.1's progress reader repeatedly reallocates unknown-length
    // compressed responses (quadratic copying, especially in Firefox). The normal
    // arrayBuffer path preserves response/cache semantics and needs no fake headers.
    tokenizer = await AutoTokenizer.from_pretrained('multilingual-e5-small', { local_files_only: true });
    extractor = await pipeline('feature-extraction', 'multilingual-e5-small', {
      device: 'wasm', dtype: 'q8', local_files_only: true
    });
  })();
}

function tokenLength(text: string): number {
  const output = tokenizer(text, { add_special_tokens: true, truncation: false });
  return output.input_ids.data.length;
}

function boundedChunks(initial: RawChunk[]): RawChunk[] {
  const result: RawChunk[] = [];
  const pending = initial.slice().reverse();
  while (pending.length) {
    const chunk = pending.pop()!;
    if (tokenLength(`passage: ${chunk.text}`) <= 512) { result.push(chunk); continue; }
    const size = Math.floor(Array.from(chunk.text).length / 2);
    if (size < 1) throw new Error('Ein Textabschnitt überschreitet das Tokenlimit.');
    const children = rust.chunk_pages([{ page: chunk.page, text: chunk.text }], size, Math.floor(size / 5)) as RawChunk[];
    if (!children.length || children.some(child => child.text.length >= chunk.text.length)) throw new Error('Textabschnitte konnten nicht sicher geteilt werden.');
    pending.push(...children.map(child => ({ ...child, start: child.start + chunk.start, end: child.end + chunk.start })).reverse());
    if (result.length + pending.length > LIMITS.chunks) throw new Error('Der Text benötigt mehr als 1.000 Chunks. Bitte verwende eine kleinere Quelle.');
  }
  return result;
}

async function index(payload: IndexPayload) {
  progress({ stage: 'Dokument wird gelesen', current: 0, total: 1 });
  await initCore();
  if (payload.kind === 'pdf') await initPdfium();
  const bytes = new Uint8Array(payload.bytes);
  const pages = (payload.kind === 'pdf' ? rust.parse_pdf(bytes) : rust.parse_text(bytes)) as PageText[];
  if (!Array.isArray(pages) || !pages.length || !pages.some(page => page.text.trim())) throw new Error('Die Quelle enthält keinen extrahierbaren Text. Scans benötigen OCR und werden in dieser Version nicht unterstützt.');
  const characters = pages.reduce((n, page) => n + Array.from(page.text).length, 0);
  if (characters > payload.remainingCharacters) throw new Error('Das Notebook überschreitet das Limit von 500.000 Zeichen.');
  await initModel();
  const chunks = boundedChunks(rust.chunk_pages(pages, 1000, 200) as RawChunk[]);
  if (chunks.length > payload.remainingChunks) throw new Error('Das Notebook überschreitet das Limit von 1.000 Chunks.');
  const stored = [];
  for (let offset = 0; offset < chunks.length; offset += 4) {
    const batch = chunks.slice(offset, offset + 4);
    progress({ stage: 'Quellen werden lokal indexiert', current: offset, total: chunks.length });
    const output = await extractor(batch.map(c => `passage: ${c.text}`), { pooling: 'mean', normalize: true });
    if (output.data.length !== batch.length * 384) throw new Error('Das lokale Modell hat eine unerwartete Vektordimension geliefert.');
    for (let i = 0; i < batch.length; i++) {
      stored.push({
        ...batch[i], id: `${payload.sourceId}:${batch[i].page}:${batch[i].start}:${batch[i].end}`,
        notebookId: payload.notebookId, sourceId: payload.sourceId,
        vector: new Float32Array(output.data.slice(i * 384, (i + 1) * 384) as Float32Array),
        embeddingVersion: EMBEDDING_VERSION
      });
    }
  }
  progress({ stage: 'Quelle fertig indexiert', current: chunks.length, total: chunks.length });
  return { pages, chunks: stored, parser: payload.kind === 'pdf' ? 'pdfium-render:0.9.4/pdfium:8046d' : 'research-core:utf8:v1' };
}

async function search(payload: SearchPayload) {
  await initCore();
  await initModel();
  const question = payload.question.trim();
  if (tokenLength(`query: ${question}`) > 512) throw new Error('Die Frage ist für das lokale Suchmodell zu lang. Bitte kürze sie.');
  let text = question;
  if (payload.previousQuestion) {
    let previous = Array.from(payload.previousQuestion).slice(0, 1000).join('');
    while (previous && tokenLength(`query: ${previous}\n${question}`) > 512) previous = Array.from(previous).slice(0, -32).join('');
    if (previous) text = `${previous}\n${question}`;
  }
  const output = await extractor(`query: ${text}`, { pooling: 'mean', normalize: true });
  const query = new Float32Array(output.data as Float32Array);
  return rust.cosine_search(payload.matrix, query, payload.k);
}

// Requests are serialized by the client. Terminating this Worker is the cancellation boundary,
// including synchronous PDFium/Rust calls and ONNX inference.
self.onmessage = async (event: MessageEvent<{ id: number; type: 'index' | 'search'; payload: IndexPayload | SearchPayload }>) => {
  currentId = event.data.id;
  try {
    const result = event.data.type === 'index' ? await index(event.data.payload as IndexPayload) : await search(event.data.payload as SearchPayload);
    self.postMessage({ id: currentId, result });
  } catch (error) {
    const errorMessage = runtimeErrorDescriptor(error);
    self.postMessage({ id: currentId, error: translateMessage('de', errorMessage), errorMessage });
  }
};
