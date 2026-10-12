import { describe, expect, it } from 'vitest';
import { citeChunks, generatorContext } from '../../src/lib/context';
import type { Chunk, Source } from '../../src/lib/types';

function source(id: string, texts: string[]): Source {
  return { id, notebookId: 'notebook', name: `${id}.txt`, kind: 'txt', size: 1, createdAt: 1, parser: 'test', original: new Blob(), pages: texts.map((text, i) => ({ page: i + 1, text })), chunkCount: 0 };
}
function chunks(s: Source, size = 1000, overlap = 200): Chunk[] {
  return s.pages.flatMap(page => {
    const scalars = Array.from(page.text);
    const out: Chunk[] = [];
    for (let start = 0; start < scalars.length; start += size - overlap) {
      const text = scalars.slice(start, start + size).join('');
      const offset = scalars.slice(0, start).join('').length;
      out.push({ id: `${s.id}:${page.page}:${start}`, notebookId: s.notebookId, sourceId: s.id, page: page.page, start: offset, end: offset + text.length, text });
      if (start + size >= scalars.length) break;
    }
    return out;
  });
}

describe('generator coverage and exact source spans', () => {
  it('uses each canonical page completely once under budget despite overlapping chunks', () => {
    const sources = [source('A', ['😀Grüße\n'.repeat(300), 'Ende']), source('B', ['Second source'])];
    const context = generatorContext(sources, sources.flatMap(s => chunks(s)));
    expect(context.citations).toHaveLength(3);
    expect(context.coverage).toEqual({ selectedCharacters: 2117, totalCharacters: 2117, selectedSources: 2, totalSources: 2, limited: false });
    expect(context.citations.map(c => c.id)).toEqual(['C1', 'C2', 'C3']);
    for (const citation of context.citations) {
      const page = sources.find(s => s.id === citation.sourceId)!.pages.find(p => p.page === citation.page)!;
      expect(citation.start).toBe(0);
      expect(citation.end).toBe(page.text.length);
      expect(page.text.slice(citation.start, citation.end)).toBe(citation.text);
    }
  });
  it('fits the bounded budget and distributes excerpts across every source and document regions', () => {
    const sources = [source('A', ['a'.repeat(40_000)]), source('B', ['😀'.repeat(40_000)]), source('C', ['c'.repeat(40_000)])];
    const allChunks = sources.flatMap(s => chunks(s));
    const { citations, coverage } = generatorContext(sources, allChunks);
    expect(coverage.limited).toBe(true);
    expect(coverage.totalCharacters).toBe(120_000);
    expect(coverage.selectedCharacters).toBeGreaterThan(18_000);
    expect(coverage.selectedCharacters).toBeLessThanOrEqual(24_000);
    expect(coverage.selectedSources).toBe(3);
    expect(new Set(citations.map(c => c.id)).size).toBe(citations.length);
    for (const s of sources) {
      const selected = citations.filter(c => c.sourceId === s.id);
      expect(selected.length).toBeGreaterThanOrEqual(3);
      expect(Math.min(...selected.map(c => c.start))).toBe(0);
      expect(Math.max(...selected.map(c => c.end))).toBe(s.pages[0].text.length);
      expect(selected.some(c => c.start >= s.pages[0].text.length * 0.4 && c.start <= s.pages[0].text.length * 0.6)).toBe(true);
      for (const c of selected) expect(s.pages[0].text.slice(c.start, c.end)).toBe(c.text);
      for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) {
        expect(selected[i].start < selected[j].end && selected[j].start < selected[i].end).toBe(false);
      }
    }
  });
  it('includes a small source alongside a large one without starving it', () => {
    const sources = [source('large', ['a'.repeat(100_000)]), source('small', ['Wichtige Randbedingung.'])];
    const context = generatorContext(sources, sources.flatMap(s => chunks(s)));
    expect(context.coverage.selectedSources).toBe(2);
    expect(context.citations.find(c => c.sourceId === 'small')!.text).toBe('Wichtige Randbedingung.');
  });
  it('counts scalar characters but preserves UTF-16 positions in retrieval citations', () => {
    const s = source('emoji', ['ä😀b𐐀c']);
    const c = { id: 'chunk', notebookId: 'notebook', sourceId: s.id, page: 1, start: 3, end: 7, text: 'b𐐀c' };
    expect(citeChunks([c], [s])).toEqual([{ id: 'C1', sourceId: 'emoji', sourceName: 'emoji.txt', page: 1, start: 3, end: 7, text: 'b𐐀c' }]);
    const context = generatorContext([s], [c]);
    expect(context.coverage.totalCharacters).toBe(5);
    expect(context.citations[0].end).toBe(7);
  });
});
