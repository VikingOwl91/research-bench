import { describe, expect, it } from 'vitest';
import { displaySearchSnippet } from '../../src/lib/display-search-snippet';

function excerpt(page: string, start: number, end: number) { return { text: page.slice(start, end), start, end }; }

describe('search snippet presentation', () => {
  it('shows complete pages unchanged', () => {
    const page = 'A whole sentence.\nAnother sentence.';
    expect(displaySearchSnippet(excerpt(page, 0, page.length), page)).toBe(page);
  });
  it('removes partial words at both edges while preserving the original citation span', () => {
    const page = 'Companies and governance inform measurement.';
    const chunk = excerpt(page, 5, page.length - 4);
    const original = { ...chunk };
    expect(displaySearchSnippet(chunk, page)).toBe('… and governance inform …');
    expect(chunk).toEqual(original);
    expect(page.slice(chunk.start, chunk.end)).toBe(chunk.text);
  });
  it('marks a sentence fragment starting at a whole word without inventing context', () => {
    const page = 'A continuous process informs the other functions.';
    const chunk = excerpt(page, page.indexOf('informs'), page.length);
    expect(displaySearchSnippet(chunk, page)).toBe('… informs the other functions.');
  });
  it('preserves full words at a page edge and marks only the omitted side', () => {
    const page = 'GOVERN is cross-cutting. Next sentence.';
    expect(displaySearchSnippet(excerpt(page, 0, page.indexOf(' Next')), page)).toBe('GOVERN is cross-cutting. …');
  });
  it('uses Unicode word boundaries without shifting UTF-16 offsets after emoji', () => {
    const page = '🧪 Überprüfung und Maßnahmen werden überprüft.';
    const start = page.indexOf('prüfung'), end = page.indexOf(' überprüft');
    const chunk = excerpt(page, start, end);
    expect(displaySearchSnippet(chunk, page)).toBe('… und Maßnahmen werden …');
    expect(page.slice(chunk.start, chunk.end)).toBe(chunk.text);
  });
  it('keeps opaque tokens visible and makes no guesses for unavailable or mismatched pages', () => {
    const page = 'abcdefghijkl';
    const chunk = excerpt(page, 2, 8);
    expect(displaySearchSnippet(chunk, page)).toBe('… cdefgh …');
    expect(displaySearchSnippet(chunk)).toBe(chunk.text);
    expect(displaySearchSnippet(chunk, 'another page')).toBe(chunk.text);
  });
});
