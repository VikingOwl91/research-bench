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
 * 2. `applySupportGate` / `applyPodcastSupportGate` compare selected numeric
 *    literals and literal quotations in each block/turn with its sanitized
 *    excerpts (all excerpts for uncited text). Unmatched specifics trigger a
 *    deterministic replacement notice. This is a lexical heuristic, not claim
 *    entailment: matching numbers/quotes do not establish the factual meaning,
 *    and prose, proper nouns, single-digit values and titles remain unchecked.
 *
 * Both layers run locally, add no model calls, and leave source documents and
 * the retrieval index unchanged. The gates return replacement values; callers
 * must apply them before display, persistence or speech synthesis. Sanitization
 * can also remove benign reported instructions; see docs/security limitations.
 */
import type { Citation, GroundedAnswer, PodcastScript } from './types';

/** Neutral replacement for instruction-like source sentences (idempotent). */
export const INSTRUCTION_MARKER = '[instruction-like content removed]';

/**
 * Sentence patterns that direct an assistant, in the app's UI languages
 * (English, German) plus French (tested by the audit). Matching is
 * case-insensitive; each pattern must be directed at an assistant or be an
 * injection marker. Benign prose quoting these instructions can also match.
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

interface Specific { kind: 'quote' | 'number'; value: string; number?: string }

function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(/\u2212/g, '-').replace(/\s+/g, ' ').trim();
}

/**
 * Exact lexical number keys; never use floating-point tolerance or infer a
 * locale. A lone separator followed by three digits is ambiguous (1.234 could
 * be a decimal or grouped integer), so it matches only the same literal.
 * This deliberately rejects equivalent-looking but ambiguous reformattings.
 * Mixed grouping/decimal forms and repeated thousands groups are unambiguous.
 */
function parseNumber(raw: string): string | null {
  const sign = raw.startsWith('-') ? '-' : '';
  const unsigned = raw.replace(/^[+-]/, '').replace(/^([.,])(?=\d)/, '0$1');
  if (!/^\d+(?:[.,]\d+)*$/.test(unsigned)) return null;
  if (/^\d+[.,]\d{3}$/.test(unsigned)) return `literal:${raw}`;
  let decimal = unsigned;
  if (unsigned.includes('.') && unsigned.includes(',')) {
    const decimalMark = unsigned.lastIndexOf('.') > unsigned.lastIndexOf(',') ? '.' : ',';
    const grouping = decimalMark === '.' ? ',' : '.';
    const [integer, fraction, ...extra] = unsigned.split(decimalMark);
    const grouped = new RegExp(`^\\d{1,3}(?:\\${grouping}\\d{3})+$`);
    if (extra.length || !fraction || !/^\d+$/.test(fraction) || !grouped.test(integer)) return null;
    decimal = `${integer.split(grouping).join('')}.${fraction}`;
  } else if (/^\d{1,3}(?:([.,])\d{3}){2,}$/.test(unsigned)) {
    // A single grouping convention is required: 1,234.567 is not grouped integer.
    const grouping = unsigned.includes(',') ? ',' : '.';
    if (unsigned.includes(grouping === ',' ? '.' : ',')) return null;
    decimal = unsigned.split(grouping).join('');
  } else if (/^\d+(?:[.,]\d+)?$/.test(unsigned)) {
    decimal = unsigned.replace(',', '.');
  } else return null;
  const [integer, fraction = ''] = decimal.split('.');
  const whole = integer.replace(/^0+(?=\d)/, '');
  const fractional = fraction.replace(/0+$/, '');
  const value = `${whole}${fractional ? `.${fractional}` : ''}`;
  return `value:${value === '0' ? '' : sign}${value}`;
}

const WORD = /[\p{L}\p{N}\p{M}_]/u;
const QUOTE_ENDS: Record<string, readonly string[]> = {
  '"': ['"', '”'], '“': ['”'], '„': ['“', '”'], '«': ['»'], '‹': ['›'],
  "'": ["'"], '‘': ['’'], '‚': ['‘', '’']
};
const SINGLE_QUOTES = new Set(["'", '‘', '’', '‚']);

function extractQuotes(text: string): Specific[] {
  const quotes: Specific[] = [];
  const closingPositions = new Map<string, number[]>();
  const cursors = new Map<string, number>();
  const openingPositions = new Map<string, number[]>();
  const wordBefore = (index: number) => /[\p{L}\p{N}\p{M}_]$/u.test(text.slice(Math.max(0, index - 2), index));
  const wordAfter = (index: number) => WORD.test(String.fromCodePoint(text.codePointAt(index + 1) ?? 0));
  const closers = new Set(Object.values(QUOTE_ENDS).flat());
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (QUOTE_ENDS[char] && (!SINGLE_QUOTES.has(char) || !wordBefore(index))) {
      const positions = openingPositions.get(char) ?? [];
      positions.push(index);
      openingPositions.set(char, positions);
    }
    if (!closers.has(char)) continue;
    if (SINGLE_QUOTES.has(char) && wordAfter(index)) continue;
    const positions = closingPositions.get(char) ?? [];
    positions.push(index);
    closingPositions.set(char, positions);
  }
  const hasOpeningBetween = (opener: string, after: number, before: number) => {
    const positions = openingPositions.get(opener) ?? [];
    let low = 0, high = positions.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (positions[middle] <= after) low = middle + 1;
      else high = middle;
    }
    return low < positions.length && positions[low] < before;
  };
  const possiblePluralPossessives = new Map<number, boolean>();
  const isPossiblePluralPossessive = (index: number) => {
    let possible = possiblePluralPossessives.get(index);
    if (possible === undefined) {
      let next = index + 1;
      while (next < text.length && /\s/u.test(text[next])) next++;
      possible = /s/i.test(text[index - 1] ?? '') && next > index + 1
        && WORD.test(String.fromCodePoint(text.codePointAt(next) ?? 0));
      possiblePluralPossessives.set(index, possible);
    }
    return possible;
  };
  for (let start = 0; start < text.length; start++) {
    const ends = QUOTE_ENDS[text[start]];
    // Internal and trailing word apostrophes (lab's, lab’s, cats’) do not
    // start quotations. Inside quotations, contractions do not end them.
    if (!ends || (SINGLE_QUOTES.has(text[start]) && wordBefore(start))) continue;
    let end = Infinity;
    for (const closer of ends) {
      const positions = closingPositions.get(closer) ?? [];
      let cursor = cursors.get(closer) ?? 0;
      while (cursor < positions.length && positions[cursor] <= start) cursor++;
      // Skip a possible inner plural possessive only when a defensible
      // terminal closer exists before a fresh opener. Another "labs’ report"
      // alone is not evidence that an earlier "risks’" was inside the quote.
      // Intrinsically ambiguous punctuation still follows this lexical policy.
      if (cursor < positions.length && SINGLE_QUOTES.has(closer) && isPossiblePluralPossessive(positions[cursor])) {
        for (let later = cursor + 1; later < positions.length; later++) {
          if (hasOpeningBetween(text[start], positions[cursor], positions[later])) break;
          if (!isPossiblePluralPossessive(positions[later])) {
            cursor = later;
            break;
          }
        }
      }
      cursors.set(closer, cursor);
      if (cursor < positions.length) end = Math.min(end, positions[cursor]);
    }
    if (!Number.isFinite(end)) continue;
    const value = normalizeText(text.slice(start + 1, end));
    if (value) quotes.push({ kind: 'quote', value });
    start = end;
  }
  return quotes;
}

/** Whole numeric tokens, including signs and malformed separators, are read
 * together so a malformed value cannot match a supported numeric prefix.
 * Visible HTML/code-like text is plain text in the UI and is checked too.
 */
function extractNumbers(text: string): Specific[] {
  const specifics: Specific[] = [];
  const listMarkers = new Set<number>();
  for (const marker of text.matchAll(/^[^\S\r\n]*(\d+)[.)][^\S\r\n]/gm)) {
    listMarkers.add(marker.index + marker[0].indexOf(marker[1]));
  }
  const numberPattern = /(?<![\p{L}\p{N}_@#.,+-])[+-]*(?:\d[\d.,+-]*|[.,]+\d[\d.,+-]*)(?:[eE][+-]?\d+)?/gu;
  for (const match of text.matchAll(numberPattern)) {
    let raw = match[0];
    // A sentence's final period/comma is punctuation, not part of the number.
    if (/[.,]$/.test(raw) && !/[.,]{2}$/.test(raw)) raw = raw.slice(0, -1);
    // Only a line-leading list marker is exempt, not parenthesized quantities.
    if (listMarkers.has(match.index)) continue;
    specifics.push({ kind: 'number', value: raw, number: parseNumber(raw) ?? `invalid:${raw}` });
  }
  return specifics;
}

/** Significant numeric values and paired literal quotations; no semantic
 * equivalence, proper-name validation, unit conversion or negation analysis.
 */
export function extractSpecifics(text: string): Specific[] {
  const normalized = text.normalize('NFKC').replace(/\u2212/g, '-');
  return [
    ...extractQuotes(normalized),
    ...extractNumbers(normalized).filter(specific => specific.value.replace(/[^\d]/g, '').replace(/^0+/, '').length >= 2)
  ];
}

function excerptPool(citations: readonly Citation[], ids: readonly string[]): { pool: string; numbers: ReadonlySet<string> } | null {
  const wanted = new Set(ids);
  const texts = citations.filter(citation => wanted.has(citation.id)).map(citation => normalizeText(sanitizeForModel(citation.text)));
  if (!texts.length) return null;
  const pool = texts.join(' \n ');
  return { pool, numbers: new Set(extractNumbers(pool).map(specific => specific.number!)) };
}

/** Numeric/quote presence is necessary but does not establish claim support. */
export function isSupportedByExcerpts(text: string, pool: string, poolNumbers?: ReadonlySet<string>): boolean {
  const normalizedPool = normalizeText(pool);
  const numbers = poolNumbers ?? new Set(extractNumbers(normalizedPool).map(specific => specific.number!));
  return extractSpecifics(text).every(specific => specific.kind === 'number'
    ? numbers.has(specific.number!)
    : normalizedPool.includes(specific.value));
}

export interface SupportGateResult<T> { value: T; quarantined: number }

/**
 * Quarantine answer blocks whose cited excerpts cannot match their checkable
 * specifics. Blocks without citations are checked against the full excerpt
 * pool, so an uncited fabricated claim cannot evade the gate either. Quarantined
 * text carries a deterministic removal notice instead of the unsupported claim;
 * a supported heading or text survives independently of the other.
 */
export function applySupportGate(answer: GroundedAnswer, citations: readonly Citation[], notice: string): SupportGateResult<GroundedAnswer> {
  let quarantined = 0;
  const full = excerptPool(citations, citations.map(c => c.id));
  const blocks = answer.blocks.map(block => {
    const excerpt = block.citationIds.length ? excerptPool(citations, block.citationIds) : full;
    if (!excerpt) return block;
    const headingSupported = !block.heading || isSupportedByExcerpts(block.heading, excerpt.pool, excerpt.numbers);
    const textSupported = isSupportedByExcerpts(block.text, excerpt.pool, excerpt.numbers);
    if (headingSupported && textSupported) return block;
    quarantined++;
    return {
      ...block,
      heading: headingSupported ? block.heading : '',
      text: textSupported ? block.text : notice,
      citationIds: textSupported ? block.citationIds : []
    };
  });
  return { value: { ...answer, blocks }, quarantined };
}

/**
 * Podcast equivalent: a turn whose cited excerpts cannot match its checkable
 * specifics is replaced by a deterministic removal notice (same speaker, no
 * citations), so callers can use the returned transcript before
 * persistence and speech synthesis. Uncited turns are checked against the full
 * excerpt pool, like answer blocks.
 */
export function applyPodcastSupportGate(script: PodcastScript, citations: readonly Citation[], notice: string): SupportGateResult<PodcastScript> {
  let quarantined = 0;
  const full = excerptPool(citations, citations.map(c => c.id));
  const turns = script.turns.map(turn => {
    const excerpt = turn.citationIds.length ? excerptPool(citations, turn.citationIds) : full;
    if (!excerpt) return turn;
    if (isSupportedByExcerpts(turn.text, excerpt.pool, excerpt.numbers)) return turn;
    quarantined++;
    return { ...turn, text: notice, citationIds: [] };
  });
  return { value: { ...script, turns }, quarantined };
}
