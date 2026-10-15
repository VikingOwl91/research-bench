import { describe, expect, it } from 'vitest';
import { buildSourceSegments, MAX_VIEWER_HIDDEN_SPANS } from '#lib/source-segments.ts';
import type { HiddenSpan } from '#lib/types.ts';

const hidden = (start: number, end: number): HiddenSpan => ({ start, end, kind: 'invisible' });
const content = (result: ReturnType<typeof buildSourceSegments>) => result.segments.map(segment => segment.text).join('');

describe('bounded source-viewer segmentation', () => {
  it('merges unsorted and overlapping spans while preserving the exact UTF-16 citation', () => {
    const text = 'ab😀cdefghij';
    const result = buildSourceSegments(text, [hidden(6, 8), hidden(2, 5), hidden(4, 7)], { start: 2, end: 6 });
    expect(result.markersLimited).toBe(false);
    expect(content(result)).toBe(text);
    expect(result.segments.filter(segment => segment.cited).map(segment => segment.text).join('')).toBe('😀cd');
    expect(result.segments.filter(segment => segment.hidden).map(segment => segment.text).join('')).toBe('😀cdef');
  });

  it('does not mark invalid ranges or lose any source text', () => {
    const text = 'abc';
    const result = buildSourceSegments(text, [hidden(-1, 2), hidden(1, 10), hidden(2, 2), hidden(0.5, 2), hidden(NaN, 2)], { start: -1, end: 2 });
    expect(result.segments).toEqual([{ text, hidden: false, cited: false }]);
    expect(content(result)).toBe(text);
  });

  it('caps per-span markup for 50,000 valid alternating spans and retains the full text and citation', () => {
    const text = 'x'.repeat(100_000) + '😀';
    const result = buildSourceSegments(text, Array.from({ length: 50_000 }, (_, i) => hidden(i * 2, i * 2 + 1)), { start: 99_999, end: text.length });
    expect(result.markersLimited).toBe(true);
    expect(result.segments).toHaveLength(2);
    expect(result.segments.filter(segment => segment.hidden)).toHaveLength(0);
    expect(result.segments.find(segment => segment.cited)?.text).toBe('x😀');
    expect(content(result)).toBe(text);
  });

  it('keeps individual provenance at the exact budget and bounds the number of segments', () => {
    const text = 'x'.repeat(MAX_VIEWER_HIDDEN_SPANS * 2);
    const result = buildSourceSegments(text, Array.from({ length: MAX_VIEWER_HIDDEN_SPANS }, (_, i) => hidden(i * 2, i * 2 + 1)), { start: 1, end: 4 });
    expect(result.markersLimited).toBe(false);
    expect(result.segments.length).toBeLessThanOrEqual(MAX_VIEWER_HIDDEN_SPANS * 2 + 3);
    expect(content(result)).toBe(text);
  });

  it('handles empty pages without creating empty text nodes', () => {
    expect(buildSourceSegments('', [])).toEqual({ segments: [], markersLimited: false });
  });
});
