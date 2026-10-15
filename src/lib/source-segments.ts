import type { HiddenSpan } from '#lib/types.ts';

export interface SourceSegment { text: string; hidden: boolean; cited: boolean }
export const MAX_VIEWER_HIDDEN_SPANS = 1_000;

// Cap markup as well as computation: a valid PDF can contain tens of thousands
// of alternating paint modes. All source text and the citation remain available
// when per-span provenance decoration exceeds this budget.
export function buildSourceSegments(text: string, hiddenSpans: HiddenSpan[], cited?: { start: number; end: number }) {
  const valid = (span: { start: number; end: number }) => Number.isInteger(span.start) && Number.isInteger(span.end)
    && span.start >= 0 && span.end > span.start && span.end <= text.length;
  const citation = cited && valid(cited) ? cited : undefined;
  const markersLimited = hiddenSpans.length > MAX_VIEWER_HIDDEN_SPANS;
  const spans = markersLimited ? [] : hiddenSpans.filter(valid).map(({ start, end }) => ({ start, end })).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
    else merged.push(span);
  }
  const boundaries = new Set([0, text.length]);
  for (const span of merged) { boundaries.add(span.start); boundaries.add(span.end); }
  if (citation) { boundaries.add(citation.start); boundaries.add(citation.end); }
  const points = [...boundaries].sort((a, b) => a - b);
  const segments: SourceSegment[] = [];
  let cursor = 0;
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index], end = points[index + 1];
    if (end <= start) continue;
    while (cursor < merged.length && merged[cursor].end <= start) cursor++;
    segments.push({ text: text.slice(start, end), hidden: cursor < merged.length && merged[cursor].start < end,
      cited: !!citation && citation.start < end && start < citation.end });
  }
  return { segments, markersLimited };
}
