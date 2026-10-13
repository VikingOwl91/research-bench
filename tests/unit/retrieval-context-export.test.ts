import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { serializeRetrievalContext } from '../../src/lib/retrieval-context-export';
import { buildGenerationBody } from '../../src/lib/providers';
import { citeChunks } from '../../src/lib/context';
import type { Citation, Chunk, Source } from '../../src/lib/types';

const source: Citation = { id: 'C1', sourceId: 'private-source', sourceName: 'private-name.txt', page: 2, start: 0, end: 8, text: 'Exact quotation: “naïve”\n日本語 🦉\n' };

describe('local saved retrieval-context export', () => {
  it('preserves all selected entries, order, aliases, quotes and Unicode without mutating the saved context', () => {
    const selected = [Object.freeze({ ...source, id: 'C2' }), Object.freeze({ ...source, id: 'C1', text: 'Selected but unused in the generated answer.\n' })];
    Object.freeze(selected);
    const before = JSON.stringify(selected);
    const serialized = serializeRetrievalContext(selected);
    expect(serialized.endsWith('\n')).toBe(true);
    expect(JSON.parse(serialized)).toEqual({ sources: [{ id: 'C2', page: 2, text: source.text }, { id: 'C1', page: 2, text: selected[1].text }] });
    expect(JSON.stringify(selected)).toBe(before);
    expect(serialized).toBe(JSON.stringify(JSON.parse(serialized), null, 2) + '\n');
  });
  it('projects only id, page and exact text, without inspecting or exporting request/account metadata', () => {
    const selected = { ...source, text: 'The source literally says "API key"; keep this passage unchanged.\n',
      key: 'dummy-extraneous-key', history: [{ text: 'private history' }], notebookId: 'private-notebook',
      provider: 'mistral', model: 'private-model', headers: { Authorization: 'dummy-authorization' } };
    const serialized = serializeRetrievalContext([selected]);
    expect(JSON.parse(serialized)).toEqual({ sources: [{ id: 'C1', page: 2, text: selected.text }] });
    for (const omitted of ['dummy-extraneous-key', 'private history', 'private-notebook', 'private-model', 'dummy-authorization', 'private-source', 'private-name.txt']) expect(serialized).not.toContain(omitted);
    Object.defineProperty(selected, 'key', { get: () => { throw new Error('Account field must not be read'); } });
    expect(() => serializeRetrievalContext([selected])).not.toThrow();
  });
  it.each(['mistral', 'openrouter'] as const)('matches the actual %s request sources for full public fixture text and locally assigned citation aliases', provider => {
    const text = readFileSync(new URL('../../docs/public-demo/nist-ai-rmf-launch.txt', import.meta.url), 'utf8');
    const chunks: Chunk[] = [
      { id: 'raw-chunk-id-1', notebookId: 'private-notebook', sourceId: 'nist', page: 1, start: 0, end: text.length, text },
      { id: 'raw-chunk-id-2', notebookId: 'private-notebook', sourceId: 'nist', page: 2, start: 0, end: source.text.length, text: source.text }
    ];
    const sources: Source[] = [{ id: 'nist', notebookId: 'private-notebook', name: 'nist-ai-rmf-launch.txt', kind: 'txt', size: text.length, createdAt: 0, parser: 'txt', original: new Blob([text]), pages: [{ page: 1, text }], chunkCount: 2 }];
    const citations = citeChunks(chunks, sources);
    const body = buildGenerationBody({ provider, key: 'dummy-test-key', kind: 'chat', question: 'What does the source say?', citations, signal: new AbortController().signal });
    const messages = body.messages as Array<{ role: string; content: string }>;
    const requestSources = JSON.parse(messages.at(-1)!.content).sources;
    const exported = JSON.parse(serializeRetrievalContext(citations));
    expect(exported.sources).toEqual(requestSources);
    expect(exported.sources.map((entry: { id: string }) => entry.id)).toEqual(['C1', 'C2']);
    expect(exported.sources[0].text).toBe(text);
    expect(JSON.stringify(exported)).not.toContain('raw-chunk-id');
    expect(Object.keys(exported)).toEqual(['sources']);
  });
  it('exports an empty selected context without inventing entries or IDs', () => {
    expect(serializeRetrievalContext([])).toBe('{\n  "sources": []\n}\n');
  });
});
