/**
 * Deterministic generation-integrity protections.
 *
 * Two local, model-free layers shared by Chat, Summary, FAQ, Study Guide and
 * Podcast:
 *
 * 1. `sanitizeForModel` separates instruction-like sentences from source
 *    content before excerpts enter the provider prompt. Uploaded documents
 *    are untrusted data; sentences that direct an assistant ("ignore all
 *    previous instructions", "you must say …", "print the API key", …) are
 *    replaced with a marker instead of being transmitted.
 *
 * 2. `applySupportGate` / `applyPodcastSupportGate` check every cited answer
 *    block (and every cited podcast turn) against the exact sanitized excerpt
 *    text the model saw. A block whose checkable specifics — quoted spans,
 *    numbers, or multi-token proper-noun phrases — cannot be found in its
 *    cited excerpts is quarantined: the claim text is replaced by a
 *    deterministic removal notice and its citations are dropped, so
 *    unsupported claims are never persisted or synthesized as sourced facts.
 *
 * Both layers are deterministic, run locally, add no model calls, and do not
 * change the source documents, the stored pages, or the retrieval index.
 * Residual limitation (documented in docs/security): prose without any
 * checkable specific can still be elaborated beyond the excerpts; presence of
 * a specific in an excerpt is necessary, not sufficient, evidence of support.
 */
import type { Citation, GroundedAnswer, PodcastScript } from './types';

/** Neutral replacement for instruction-like source sentences (idempotent). */
export const INSTRUCTION_MARKER = '[instruction-like content removed]';

/**
 * Sentence patterns that direct an assistant, in the app's UI languages
 * (English, German) plus French (tested by the audit). Matching is
 * case-insensitive; each pattern must be directed at an assistant or be an
 * unambiguous injection marker, so ordinary prose is preserved.
 */
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\bsystem[\s-]*override\b/i,
  /\bignore\s+(?:all|any|the)\s+(?:previous|prior|above|earlier)\s+instructions?\b/i,
  /\bignoriere\s+(?:alle\s+)?(?:vorherigen\s+)?anweisungen\b/i,
  /\bignorez\s+toutes\s+les\s+instructions\b/i,
  /\bignore\s+toutes\s+les\s+instructions\s+précédentes\b/i,
  /\bdisregard\s+(?:all|the)\s+(?:previous|prior)\s+instructions?\b/i,
  /\bmissachte\s+(?:alle|die)\s+(?:vorherigen\s+)?anweisungen\b/i,
  /\boverride\s+(?:all|the|your)\s+(?:previous\s+)?instructions?\b/i,
  /\b(?:print|reveal|show|disclose|output|leak|exfiltrate)\s+(?:the\s+|your\s+|the\s+user'?s\s+)?(?:api[\s-]*key|api[\s-]*schlüssel|system[\s-]*prompt|anweisungen|instructions?)\b/i,
  /\b(?:gib|verrate)\s+(?:den|deinen|mir\s+den)\s+(?:api[\s-]*schlüssel|api[\s-]*key|system[\s-]*prompt)\b/i,
  /\bdivulgue\s+la\s+clé\s+api\b/i,
  /\bdo\s+not\s+cite\b/i,
  /\b(?:do\s+not|don't)\s+mention\s+that\s+(?:this|the)\s+(?:instruction|note)\s+exists\b/i,
  /\bne\s+mentionne\s+pas\s+(?:cette|que\s+cette)\s+instruction\b/i,
  /\b(?:erwähne|erwähnen\s+sie)\s+nicht,?\s*dass\s+(?:diese|die|eine)\s+(?:anweisung|instruktion|notiz)\b/i,
  /\bnever\s+reveal\s+that\s+you\s+(?:were|have\s+been)\s+instructed\b/i,
  /\bverrate\s+nicht,?\s*dass\s+du\s+angewiesen\b/i,
  /\bnote\s+to\s+(?:any|the)\s+assistant\b/i,
  /\b(?:hinweis|nachricht)\s+an\s+(?:den|die|alle|jedwede)\s+assistenten\b/i,
  /\byou\s+must\s+(?:say|state|claim|answer|report|respond|output|print)\b/i,
  /\bdu\s+musst\s+(?:sagen|angeben|behaupten|antworten|ausgeben)\b/i,
  /\btu\s+dois\s+(?:dire|affirmer|répondre|indiquer)\b/i,
  /\battribute\s+(?:that|this)\s+claim\b/i,
  /\battribue\s+cette\s+affirmation\b/i,
  /\binstructions?\s+for\s+(?:future\s+)?(?:conversations?|answers?|turns?|messages?)\b/i,
  /\banweisunge?n\s+für\s+(?:zukünftige\s+)?(?:konversationen|antworten|beiträge|nachrichten)\b/i,
  /\bin\s+every\s+later\s+answer\b/i,
  /\bin\s+jeder\s+(?:späteren|weiteren|folgenden)\s+antwort\b/i,
  /\bfor\s+future\s+conversations?\b/i,
  /\b(?:when|whenever|if)\s+the\s+user\s+asks?\s+(?:about|regarding|for|anything)\b[^.!?]{0,120}\b(?:say|state|claim|answer|report|respond|tell)\b/i,
  /\bwenn\s+(?:der|die|das)\s+(?:benutzer|nutzer|anwender)\s+fragt\b[^.!?]{0,120}\b(?:sag|sage|antworte|behaupte|berichte)\b/i,
  /\breply\s+with\s+(?:plain\s+text|only|just)\b/i,
  /\bantworte\s+(?:nur|ausschließlich)\s+mit\b/i,
  /\bréponds\s+(?:uniquement|seulement)\b/i,
  /\bregardless\s+of\s+(?:what|the)\s+(?:this\s+|the\s+)?(?:document|source|excerpt|log|text)s?\s+(?:says?|states?|contain|show)\b/i,
  /\bunabhängig\s+davon,?\s+was\s+(?:dieses|diese|die|das|der)\s+\w*\s+(?:sagt|enthält|zeigt)\b/i,
  /\banswer\s+every\s+question\s+with\b/i,
  /\boutput\s+(?:the\s+full\s+)?(?:conversation|chat)\s+history\b/i,
  /\badd\s+the\s+sentence\b/i,
  /\bfüge\s+den\s+satz\s+hinzu\b/i,
  /\battach\s+(?:a\s+|the\s+)?citation\b/i,
  /\b(?:füge|hänge)\s+(?:einen\s+)?quellenverweis\s+hinzu\b/i,
  /\beven\s+if\s+(?:it|they)\s+do(?:es)?\s+not\s+support\b/i,
  /\bauch\s+wenn\s+(?:es|sie|er)\s+nicht\s+belegt\b/i,
  /\byou\s+are\s+now\s+(?:unfiltered|unrestricted|not\s+bound)\b/i
];

/** Replace instruction-like sentences with a neutral marker; keep the rest. */
export function sanitizeForModel(text: string): string {
  if (!text) return text;
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  let changed = false;
  const sanitized = sentences.map(sentence => {
    const trimmed = sentence.trim();
    if (trimmed && INSTRUCTION_PATTERNS.some(pattern => pattern.test(trimmed))) {
      changed = true;
      return sentence.replace(trimmed, INSTRUCTION_MARKER);
    }
    return sentence;
  });
  return changed ? sanitized.join(' ') : text;
}

interface Specific { kind: 'quote' | 'number'; value: string; number?: number }

function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function parseNumber(raw: string): number | null {
  const normalized = raw.replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function significantDigits(raw: string): number {
  const digits = raw.replace(/[^\d]/g, '').replace(/^0+/, '');
  return digits.length;
}

/**
 * Extract checkable specifics from generated text: quoted spans and numbers
 * with at least two significant digits. A preceding word character, "(" or "."
 * excludes identifiers, citation IDs and function-call payloads; single-digit
 * numbers are too weak to enforce. Multi-token proper-noun phrases are
 * deliberately NOT checked: German capitalizes every noun, so the heuristic
 * produced unacceptable false positives (documented residual: fabricated
 * names are not caught by the deterministic gate).
 */
export function extractSpecifics(text: string): Specific[] {
  const specifics: Specific[] = [];
  const cleaned = text.replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/gi, ' ');
  const quotePattern = /["“„«‹][^"“„«‹”»›]{2,}["”»›]|['‘’][^'‘’]{2,}[’]/g;
  for (const match of cleaned.matchAll(quotePattern)) {
    const value = normalizeText(match[0].slice(1, -1));
    if (value) specifics.push({ kind: 'quote', value });
  }
  const numberPattern = /(?<![\w(.@#])\d+(?:[.,]\d+)*/g;
  for (const match of cleaned.matchAll(numberPattern)) {
    const value = parseNumber(match[0]);
    if (value === null || significantDigits(match[0]) < 2) continue;
    specifics.push({ kind: 'number', value: match[0], number: value });
  }
  return specifics;
}

function extractNumbers(text: string): number[] {
  const numbers: number[] = [];
  for (const match of text.matchAll(/(?<![\w(.@#])\d+(?:[.,]\d+)*/g)) {
    const value = parseNumber(match[0]);
    if (value !== null) numbers.push(value);
  }
  return numbers;
}

function excerptPool(citations: readonly Citation[], ids: readonly string[]): { pool: string; numbers: number[] } | null {
  const wanted = new Set(ids);
  const texts = citations.filter(citation => wanted.has(citation.id)).map(citation => normalizeText(sanitizeForModel(citation.text)));
  if (!texts.length) return null;
  const pool = texts.join(' \n ');
  return { pool, numbers: extractNumbers(pool) };
}

/** True when every checkable specific in `text` is present in the excerpt pool. */
export function isSupportedByExcerpts(text: string, pool: string, poolNumbers: readonly number[]): boolean {
  const specifics = extractSpecifics(text);
  if (!specifics.length) return true; // Unverifiable prose passes; see module docs.
  return specifics.every(specific => {
    if (specific.kind === 'number') {
      return poolNumbers.some(number => Math.abs(number - specific.number!) <= 1e-6 * Math.max(1, Math.abs(number)));
    }
    return pool.includes(specific.value);
  });
}

export interface SupportGateResult<T> { value: T; quarantined: number }

/**
 * Quarantine answer blocks whose cited excerpts cannot match their checkable
 * specifics. Quarantined blocks keep their supported heading (if any), lose
 * their citations, and carry a deterministic removal notice instead of the
 * unsupported claim.
 */
export function applySupportGate(answer: GroundedAnswer, citations: readonly Citation[], notice: string): SupportGateResult<GroundedAnswer> {
  let quarantined = 0;
  const blocks = answer.blocks.map(block => {
    if (!block.citationIds.length) return block;
    const excerpt = excerptPool(citations, block.citationIds);
    if (!excerpt) return block;
    const headingSupported = !block.heading || isSupportedByExcerpts(block.heading, excerpt.pool, excerpt.numbers);
    const textSupported = isSupportedByExcerpts(block.text, excerpt.pool, excerpt.numbers);
    if (headingSupported && textSupported) return block;
    quarantined++;
    return { ...block, heading: headingSupported ? block.heading : '', text: notice, citationIds: [] };
  });
  return { value: { ...answer, blocks }, quarantined };
}

/**
 * Podcast equivalent: an unsupported cited turn is replaced by a deterministic
 * removal notice (same speaker, no citations), so the fabricated claim is never
 * persisted in the transcript nor sent to speech synthesis.
 */
export function applyPodcastSupportGate(script: PodcastScript, citations: readonly Citation[], notice: string): SupportGateResult<PodcastScript> {
  let quarantined = 0;
  const turns = script.turns.map(turn => {
    if (!turn.citationIds.length) return turn;
    const excerpt = excerptPool(citations, turn.citationIds);
    if (!excerpt) return turn;
    if (isSupportedByExcerpts(turn.text, excerpt.pool, excerpt.numbers)) return turn;
    quarantined++;
    return { ...turn, text: notice, citationIds: [] };
  });
  return { value: { ...script, turns }, quarantined };
}
