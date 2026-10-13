import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { displaySourceName } from '../../src/lib/display-source-name';
import { translate } from '../../src/lib/i18n/index';
import GroundedAnswer from '../../src/lib/components/GroundedAnswer.svelte';
import SourceViewer from '../../src/lib/components/SourceViewer.svelte';
import { ResearchBenchController } from '../../src/lib/controller';
import { BenchStorage } from '../../src/lib/storage';
import { LocalPipeline } from '../../src/lib/pipeline';
import { EMBEDDING_VERSION } from '../../src/lib/constants';
import type { AppSnapshot, Citation, Source } from '../../src/lib/types';

const controls = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
const rawName = 'report\u202efdp.txt';
const displayed = 'report⟦U+202E⟧fdp.txt';
const citation: Citation = { id: 'C1', sourceId: 'legacy-source', sourceName: rawName, page: 1, start: 0, end: 8, text: 'evidence' };

describe('source name display boundary', () => {
  it.each(controls)('exposes control U+%s without removing surrounding filename text', code => {
    const marker = `⟦U+${code.toString(16).toUpperCase().padStart(4, '0')}⟧`;
    expect(displaySourceName(`a${String.fromCodePoint(code)}b.txt`)).toBe(`a${marker}b.txt`);
  });
  it.each(['überblick.txt', 'تقرير.pdf', 'מחקר.md', '🧪 results.pdf', '<img onerror=alert(1)>.txt', '', 'a\u200cb\u200d.txt'])('preserves ordinary and natural RTL names: %s', name => {
    expect(displaySourceName(name)).toBe(name);
  });
  it.each(['en', 'de'] as const)('keeps the filename prefix separately isolatable in %s error/progress messages', language => {
    for (const key of ['runtime.fileTooLarge', 'runtime.emptyFile', 'runtime.fileProgress'] as const) {
      const params = { filename: displayed, current: 1, total: 2 };
      expect(translate(language, key, params)).toBe(displayed + translate(language, key, { ...params, filename: '' }));
    }
  });
  it('is idempotent and leaves the original name unchanged', () => {
    expect(displaySourceName(displaySourceName(rawName))).toBe(displayed);
    expect(rawName).toBe('report\u202efdp.txt');
  });
  it('displays persisted legacy citation names in isolated text and tooltips without mutating them', () => {
    const before = structuredClone(citation);
    const output = render(GroundedAnswer, { props: { answer: { title: 'Legacy answer', blocks: [{ text: 'answer', citationIds: ['C1'] }] }, citations: [citation], onCitation() {}, availableSourceIds: ['legacy-source'] } }).body;
    expect(output).toContain(`<bdi>${displayed}</bdi>`);
    expect(output).toContain(`title="${displayed} · Page 1`);
    expect(output).not.toContain('\u202e');
    expect(citation).toEqual(before);
  });
  it('isolates viewer titles while preserving document text and citation offsets', () => {
    const source: Source = { id: 'legacy-source', notebookId: 'notebook', name: rawName, kind: 'txt', size: 8, createdAt: 0, original: new Blob(['evidence']), pages: [{ page: 1, text: 'evidence\u202e original text' }], parser: 'fixture', chunkCount: 1 };
    const output = render(SourceViewer, { props: { source, citation, onClose() {} } }).body;
    expect(output.split(`<bdi>${displayed}</bdi>`)).toHaveLength(3);
    expect(output).toContain(' original text');
    expect(output).toContain('\u202e'); // Original document text is not content-filtered.
    expect(citation.start).toBe(0); expect(citation.end).toBe(8);
    expect(source.name).toBe(rawName);
  });
});


it('sanitizes import progress and error parameters while retaining persisted source names and original bytes', async () => {
  const entries = new Map<string, string>();
  const webStorage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) };
  vi.stubGlobal('localStorage', webStorage); vi.stubGlobal('sessionStorage', webStorage);
  const storage = new BenchStorage();
  await storage.clear();
  const pipeline = new LocalPipeline();
  const inputText = 'Original source text';
  const vector = new Float32Array(384); vector[0] = 1;
  const index = vi.spyOn(pipeline, 'index').mockImplementation(async (payload, _signal, progress) => {
    expect(new TextDecoder().decode(payload.bytes)).toBe(inputText);
    progress?.({ stage: 'Chunking', current: 1, total: 1 });
    return { parser: 'fixture', pages: [{ page: 1, text: inputText }], chunks: [{ id: `${payload.sourceId}:1`, sourceId: payload.sourceId, notebookId: payload.notebookId, page: 1, start: 0, end: inputText.length, text: inputText, vector, embeddingVersion: EMBEDDING_VERSION }] };
  });
  const controller = new ResearchBenchController(storage, pipeline);
  const snapshots: AppSnapshot[] = [];
  controller.subscribe(snapshot => snapshots.push(snapshot));
  try {
    await controller.initialize();
    await controller.importFiles([new File([inputText], rawName)]);
    expect(index).toHaveBeenCalledOnce();
    const progress = snapshots.find(snapshot => snapshot.progress?.detailMessage?.key === 'runtime.fileProgress')?.progress;
    expect(progress?.detailMessage?.params?.filename).toBe(displayed);
    expect(progress?.detail).toContain(displayed);
    const source = snapshots.at(-1)!.sources[0];
    expect(source.name).toBe(rawName);
    expect(new TextDecoder().decode(await source.original.arrayBuffer())).toBe(inputText);
    expect((await storage.loadNotebook(source.notebookId))!.sources[0].name).toBe(rawName);
    await controller.importFiles([new File([], rawName)]);
    expect(snapshots.at(-1)?.errorMessage?.params?.filename).toBe(displayed);
  } finally {
    controller.cancel(); await storage.clear(); await storage.close(); vi.unstubAllGlobals();
  }
});
