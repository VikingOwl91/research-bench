import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalPipeline } from '../../src/lib/pipeline';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn<(message: { id: number; type: string; payload: unknown }, transfer?: Transferable[]) => void>();
  constructor(readonly url: URL, readonly options: WorkerOptions) { FakeWorker.instances.push(this); }
  emit(data: unknown) { this.onmessage?.(new MessageEvent('message', { data })); }
}
let pipeline: LocalPipeline;
beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  pipeline = new LocalPipeline();
});
afterEach(() => { pipeline.cancel(); vi.unstubAllGlobals(); });

describe('local Worker recovery', () => {
  it.each(['ordinary-response-error', 'runtime-error'] as const)('terminates a worker after %s and succeeds with a fresh worker next time', async failure => {
    const signal = new AbortController().signal;
    const progress = vi.fn();
    const failing = pipeline.search(new Float32Array(384), 'Erste Suche', undefined, 6, signal, progress);
    expect(FakeWorker.instances).toHaveLength(1);
    const first = FakeWorker.instances[0];
    expect(first.options.type).toBe('module');
    const firstId = first.postMessage.mock.calls[0][0].id;
    if (failure === 'ordinary-response-error') first.emit({ id: firstId, error: 'Modellinitialisierung fehlgeschlagen' });
    else first.onerror?.({} as ErrorEvent);
    await expect(failing).rejects.toThrow(failure === 'ordinary-response-error' ? 'Modellinitialisierung fehlgeschlagen' : /Worker/);
    expect(first.terminate).toHaveBeenCalledTimes(1);
    expect(first.onmessage).toBeNull(); expect(first.onerror).toBeNull();
    const succeeding = pipeline.search(new Float32Array(384), 'Zweite Suche', undefined, 6, signal, progress);
    expect(FakeWorker.instances).toHaveLength(2);
    const second = FakeWorker.instances[1];
    expect(second).not.toBe(first);
    expect(first.postMessage).toHaveBeenCalledTimes(1);
    const secondId = second.postMessage.mock.calls[0][0].id;
    expect(secondId).not.toBe(firstId);
    const hits = [{ index: 3, score: 0.87 }];
    second.emit({ id: secondId, result: hits });
    await expect(succeeding).resolves.toEqual(hits);
    expect(second.terminate).not.toHaveBeenCalled();
  });
});

describe('progress-resetting watchdog (RB-RT-006)', () => {
  it('does not kill a job that keeps reporting progress', async () => {
    vi.useFakeTimers();
    try {
      const signal = new AbortController().signal;
      const progress = vi.fn();
      const pending = pipeline.search(new Float32Array(384), 'Suche', undefined, 6, signal, progress);
      const worker = FakeWorker.instances[0];
      const id = worker.postMessage.mock.calls[0][0].id;
      // Twenty minutes of work with progress every four minutes must not trip the watchdog.
      for (let round = 0; round < 5; round++) {
        await vi.advanceTimersByTimeAsync(240_000);
        worker.emit({ id, progress: { stage: 'Quellen werden lokal indexiert', current: round, total: 5 } });
      }
      await vi.advanceTimersByTimeAsync(240_000);
      worker.emit({ id, result: [{ index: 0, score: 1 }] });
      await expect(pending).resolves.toEqual([{ index: 0, score: 1 }]);
      expect(worker.terminate).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('still kills a wedged worker that stops reporting progress', async () => {
    vi.useFakeTimers();
    try {
      const signal = new AbortController().signal;
      const pending = pipeline.search(new Float32Array(384), 'Suche', undefined, 6, signal, vi.fn());
      // Attach the rejection handler before advancing time so the rejection is never unhandled.
      const assertion = expect(pending).rejects.toThrow(/fünf Minuten/);
      const worker = FakeWorker.instances[0];
      const id = worker.postMessage.mock.calls[0][0].id;
      worker.emit({ id, progress: { stage: 'Vorbereitung', current: 0, total: 1 } });
      await vi.advanceTimersByTimeAsync(300_000);
      await assertion;
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
