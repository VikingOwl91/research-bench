import type { Chunk } from './types';

const word = /[\p{L}\p{N}\p{M}_]/u;
const leadingWord = /^[\p{L}\p{N}\p{M}_]+/u;
const trailingWord = /[\p{L}\p{N}\p{M}_]+$/u;

/** Presentation only: citation text and canonical UTF-16 spans stay unchanged. */
export function displaySearchSnippet(chunk: Pick<Chunk, 'text' | 'start' | 'end'>, pageText?: string): string {
  if (pageText === undefined || pageText.slice(chunk.start, chunk.end) !== chunk.text) return chunk.text;
  const before = chunk.start > 0 ? Array.from(pageText.slice(Math.max(0, chunk.start - 2), chunk.start)).at(-1) ?? '' : '';
  const after = chunk.end < pageText.length ? String.fromCodePoint(pageText.codePointAt(chunk.end)!) : '';
  let preview = chunk.text;
  if (word.test(before) && word.test(Array.from(preview.slice(0, 2))[0] ?? '')) preview = preview.replace(leadingWord, '');
  if (word.test(after) && word.test(Array.from(preview.slice(-2)).at(-1) ?? '')) preview = preview.replace(trailingWord, '');
  // An opaque token longer than a window has no complete word to preview.
  // Keep it visible as an explicitly clipped fragment rather than an empty hit.
  preview = preview.trim() || chunk.text;
  return `${chunk.start > 0 ? '… ' : ''}${preview}${chunk.end < pageText.length ? ' …' : ''}`;
}
