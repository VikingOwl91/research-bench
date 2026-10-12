import { LIMITS } from './constants';
import type { Chunk, Citation, Coverage, Source } from './types';

export function citeChunks(chunks: Chunk[], sources: Source[]): Citation[] {
  const byId = new Map(sources.map(source => [source.id, source]));
  return chunks.map((chunk, index) => ({
    id: `C${index + 1}`, sourceId: chunk.sourceId,
    sourceName: byId.get(chunk.sourceId)?.name ?? 'Quelle', page: chunk.page,
    start: chunk.start, end: chunk.end, text: chunk.text
  }));
}

export function generatorContext(sources: Source[], chunks: Chunk[]): { citations: Citation[]; coverage: Coverage } {
  const totalCharacters = sources.reduce((n, source) => n + source.pages.reduce((sum, page) => sum + Array.from(page.text).length, 0), 0);
  const full: Citation[] = sources.flatMap(source => source.pages.filter(page => page.text.trim()).map(page => ({
    id: '', sourceId: source.id, sourceName: source.name, page: page.page,
    start: 0, end: page.text.length, text: page.text
  })));
  let selected = full;
  if (totalCharacters > LIMITS.contextCharacters) {
    selected = [];
    const queues = sources.map(source => {
      const ordered = chunks.filter(c => c.sourceId === source.id).sort((a, b) => a.page - b.page || a.start - b.start);
      // Sampling starts with the beginning, middle and end, then fills evenly spaced locations.
      const spread: Chunk[] = [];
      const seen = new Set<number>();
      for (let divisions = 1; divisions <= ordered.length * 2; divisions *= 2) {
        for (let i = 0; i <= divisions; i++) {
          const index = Math.min(ordered.length - 1, Math.floor(i * (ordered.length - 1) / divisions));
          if (index >= 0 && !seen.has(index)) { seen.add(index); spread.push(ordered[index]); }
        }
      }
      return { source, chunks: spread };
    });
    let used = 0;
    let hadCandidate = true;
    while (hadCandidate && used < LIMITS.contextCharacters) {
      hadCandidate = false;
      for (const queue of queues) {
        const chunk = queue.chunks.shift();
        if (!chunk) continue;
        hadCandidate = true;
        const size = Array.from(chunk.text).length;
        const overlaps = selected.some(c => c.sourceId === chunk.sourceId && c.page === chunk.page && c.start < chunk.end && chunk.start < c.end);
        if (overlaps || used + size > LIMITS.contextCharacters) continue;
        selected.push({ id: '', sourceId: chunk.sourceId, sourceName: queue.source.name, page: chunk.page, start: chunk.start, end: chunk.end, text: chunk.text });
        used += size;
      }
    }
  }
  selected = selected.map((citation, index) => ({ ...citation, id: `C${index + 1}` }));
  return {
    citations: selected,
    coverage: {
      selectedCharacters: selected.reduce((n, c) => n + Array.from(c.text).length, 0), totalCharacters,
      selectedSources: new Set(selected.map(c => c.sourceId)).size, totalSources: sources.length,
      limited: totalCharacters > LIMITS.contextCharacters
    }
  };
}
