import type { Citation } from './types';

/** Exact saved source payload for local diagnostics; no request or account metadata. */
export function serializeRetrievalContext(citations: readonly Citation[]): string {
  return `${JSON.stringify({ sources: citations.map(({ id, page, text }) => ({ id, page, text })) }, null, 2)}\n`;
}
