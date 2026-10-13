import { localizedError } from './i18n/message';
import { localizedProgress, runtimeErrorDescriptor } from './i18n/runtime-errors';
import type { PageText, Progress, SourceKind } from './types';
import type { StoredChunk } from './storage';

export interface IndexResult { pages: PageText[]; chunks: StoredChunk[]; parser: string; }
export class LocalPipeline {
  private worker: Worker | null = null;
  private sequence = 0;
  private active: { id: number; reject: (error: Error) => void } | null = null;

  cancel() {
    this.worker?.terminate();
    this.worker = null;
    this.active?.reject(new DOMException('Abgebrochen', 'AbortError'));
    this.active = null;
  }
  private request<T>(type: 'index' | 'search', payload: unknown, signal: AbortSignal, onProgress: (progress: Progress) => void, transfer: Transferable[] = []): Promise<T> {
    if (signal.aborted) return Promise.reject(new DOMException('Abgebrochen', 'AbortError'));
    if (this.active) return Promise.reject(localizedError('runtime.pipelineAlreadyRunning'));
    this.worker ??= new Worker(new URL('./pipeline.worker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, result?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        worker.onmessage = null;
        worker.onerror = null;
        if (this.active?.id === id) this.active = null;
        if (error) reject(error); else resolve(result as T);
      };
      const abort = () => this.cancel();
      const timer = setTimeout(() => {
        finish(localizedError('runtime.pipelineTimeout'));
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      }, 300_000);
      this.active = { id, reject: error => finish(error) };
      signal.addEventListener('abort', abort, { once: true });
      worker.onmessage = event => {
        if (event.data.id !== id) return;
        if (event.data.progress) onProgress(localizedProgress(event.data.progress));
        else if (event.data.error) {
          // Initialization errors can leave ONNX/Pdfium promises or runtime state poisoned.
          // A new request gets a fresh Worker, while successful asset caches remain reusable.
          worker.terminate();
          if (this.worker === worker) this.worker = null;
          const descriptor = event.data.errorMessage;
          const error = descriptor ? localizedError(descriptor.key, descriptor.params) : Object.assign(new Error(event.data.error), { messageRef: runtimeErrorDescriptor(event.data.error) });
          finish(error);
        }
        else finish(undefined, event.data.result as T);
      };
      worker.onerror = () => {
        finish(localizedError('runtime.pipelineWorkerUnavailable'));
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      };
      worker.postMessage({ id, type, payload }, transfer);
    });
  }
  index(payload: { bytes: ArrayBuffer; kind: SourceKind; notebookId: string; sourceId: string; remainingChunks: number; remainingCharacters: number }, signal: AbortSignal, onProgress: (progress: Progress) => void) {
    return this.request<IndexResult>('index', payload, signal, onProgress, [payload.bytes]);
  }
  search(matrix: Float32Array, question: string, previousQuestion: string | undefined, k: number, signal: AbortSignal, onProgress: (progress: Progress) => void) {
    return this.request<Array<{ index: number; score: number }>>('search', { matrix, question, previousQuestion, k }, signal, onProgress, [matrix.buffer]);
  }
}
