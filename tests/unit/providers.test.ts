import { describe, expect, it, vi } from 'vitest';
import { buildGenerationBody, generateAnswer, validateAnswer, GenerationError, type GenerationRequest } from '../../src/lib/providers';
import type { Citation, Provider } from '../../src/lib/types';

const citations: Citation[] = [{ id: 'C1', sourceId: 'source-1', sourceName: 'Quelle', page: 2, start: 0, end: 6, text: 'Belegt' }];
const answer = { title: 'Antwort', blocks: [{ heading: 'Ergebnis', text: 'Belegt.', citationIds: ['C1'] }] };
function request(provider: Provider = 'mistral'): GenerationRequest {
  return { provider, key: 'dummy-test-key', kind: 'chat', question: 'Was ist belegt?', citations, signal: new AbortController().signal };
}
function envelope(content: unknown = answer) {
  return Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
}

describe('shared output and citation validation', () => {
  it.each(['mistral', 'openrouter'] as const)('accepts a %s study overview citing more than twelve transmitted passages', async provider => {
    const context = Array.from({ length: 13 }, (_, i) => ({ ...citations[0], id: `C${i + 1}` }));
    const guide = { title: 'Lernplan', blocks: [{ heading: 'Lernziele', text: 'Vergleiche die dreizehn belegten Aspekte.', citationIds: context.map(c => c.id) }] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(envelope(guide));
    await expect(generateAnswer({ ...request(provider), kind: 'study', citations: context }, fetcher)).resolves.toEqual(guide);
  });
  it.each(['chat', 'summary', 'faq', 'study'] as const)('sends the same answer bounds for %s that the client validates', kind => {
    const body = buildGenerationBody({ ...request(), kind }) as any;
    const schema = body.response_format.json_schema.schema;
    expect(schema.properties.title.maxLength).toBe(300);
    expect(schema.properties.blocks).toMatchObject({ minItems: 1, maxItems: 60 });
    expect(schema.properties.blocks.items.properties.heading.maxLength).toBe(300);
    expect(schema.properties.blocks.items.properties.text).toMatchObject({ minLength: 1, maxLength: 6000 });
    expect(schema.properties.blocks.items.required).toEqual(['heading', 'text', 'citationIds']);
    expect(schema.properties.blocks.items.properties.citationIds).toMatchObject({ maxItems: 1 });
    expect(schema.properties.blocks.items.additionalProperties).toBe(false);
    expect(schema.additionalProperties).toBe(false);
  });
  it.each([
    ['title', { ...answer, title: 'x'.repeat(301) }, /300 Zeichen/],
    ['heading', { title: 'X', blocks: [{ ...answer.blocks[0], heading: 'x'.repeat(301) }] }, /300 Zeichen/],
    ['text', { title: 'X', blocks: [{ ...answer.blocks[0], text: 'x'.repeat(6001) }] }, /6.000 Zeichen/],
    ['empty text', { title: 'X', blocks: [{ ...answer.blocks[0], text: '' }] }, /6.000 Zeichen/],
    ['empty blocks', { title: 'X', blocks: [] }, /60 Abschnitte/],
    ['too many blocks', { title: 'X', blocks: Array.from({ length: 61 }, () => answer.blocks[0]) }, /60 Abschnitte/]
  ])('rejects %s with a payload-free contract diagnostic', async (_label, content, diagnostic) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(envelope(content));
    const error = await generateAnswer(request(), fetcher).catch(error => error);
    expect(error).toMatchObject({ code: 'invalid_response' });
    expect(error.message).toMatch(diagnostic as RegExp);
    expect(error.message).not.toContain('x'.repeat(20));
  });
  it('accepts the inclusive size bounds and empty generated headings', () => {
    const boundary = { title: 'x'.repeat(300), blocks: Array.from({ length: 60 }, () => ({ heading: '', text: 'x'.repeat(6000), citationIds: ['C1'] })) };
    expect(validateAnswer(boundary, citations)).toEqual(boundary);
  });
  it('counts unique sent citation IDs rather than duplicate context entries', () => {
    const body = buildGenerationBody({ ...request(), citations: [citations[0], citations[0]] }) as any;
    expect(body.response_format.json_schema.schema.properties.blocks.items.properties.citationIds).toMatchObject({ maxItems: 1, items: { enum: ['C1'] } });
  });
  it('accepts grounded blocks and explicit insufficient-evidence blocks', () => {
    expect(validateAnswer(answer, citations)).toEqual(answer);
    expect(validateAnswer({ title: 'Nicht belegt', blocks: [{ text: 'Die Quellen reichen nicht aus.', citationIds: [] }] }, citations).blocks).toHaveLength(1);
  });
  it('rejects citations outside the exact transmitted context', () => {
    expect(() => validateAnswer({ ...answer, blocks: [{ text: 'Erfunden', citationIds: ['C2'] }] }, citations)).toThrow(/Quellenverweis/);
  });
  it.each([
    { title: 'X', blocks: [] },
    { title: 'X', blocks: [{ text: '', citationIds: [] }] },
    { ...answer, unexpected: 'extra' },
    { title: 'X', blocks: [{ text: 'X', citationIds: [], toolCall: 'ignored?' }] },
    { title: 'X', blocks: [{ text: 'X', citationIds: [3] }] }
  ])('rejects malformed or extra fields: %j', value => {
    expect(() => validateAnswer(value, citations)).toThrow(GenerationError);
  });
});

describe('provider isolation', () => {
  it.each([
    ['mistral', 'https://api.eu.mistral.ai/v1/chat/completions', 'mistral-small-2603'],
    ['openrouter', 'https://openrouter.ai/api/v1/chat/completions', 'mistralai/mistral-small-2603']
  ] as const)('uses only the chosen %s endpoint, key and model', async (provider, endpoint, model) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(envelope());
    const result = await generateAnswer({ ...request(provider), key: '  dummy-test-key  ' }, fetcher);
    expect(result).toEqual(answer);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(endpoint);
    expect(init?.headers).toEqual({ Authorization: 'Bearer dummy-test-key', 'Content-Type': 'application/json' });
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe(model);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties.blocks.items.properties.citationIds.items.enum).toEqual(['C1']);
    expect(init!.body as string).not.toContain('dummy-test-key');
    if (provider === 'mistral') expect(body).not.toHaveProperty('provider');
    else expect(body.provider).toEqual({ data_collection: 'deny', zdr: true, require_parameters: true });
  });
  it('keeps history bounded and document data inside a data envelope', () => {
    const history = Array.from({ length: 12 }, (_, i) => ({ id: String(i), notebookId: 'n', revision: 1, createdAt: i, role: 'user' as const, text: String(i).repeat(4000), citations: [] }));
    const body = buildGenerationBody({ ...request(), history });
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(10);
    expect(messages.slice(1, -1).every(m => m.content.length <= 3000)).toBe(true);
    expect(messages[1].content).toBe(history[4].text.slice(0, 3000));
    expect(JSON.parse(messages.at(-1)!.content).sources).toEqual([{ id: 'C1', page: 2, text: 'Belegt' }]);
  });
  it.each(['missing_key', 'empty_context'])('rejects %s without an API call', async code => {
    const fetcher = vi.fn<typeof fetch>();
    const input = code === 'missing_key' ? { ...request(), key: '  ' } : { ...request(), citations: [] };
    await expect(generateAnswer(input, fetcher)).rejects.toMatchObject({ code });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('explicit failure behavior', () => {
  it.each([400, 401, 402, 403, 404, 422, 429, 500])('sanitizes HTTP %i and never retries or falls back', async status => {
    const raw = 'PRIVATE-PROVIDER-PAYLOAD';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(raw, { status }));
    const error = await generateAnswer(request('openrouter'), fetcher).catch(error => error);
    expect(error).toMatchObject({ code: `http_${status}` });
    expect(error.message).not.toContain(raw);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    if (status === 404) expect(error.message).toMatch(/nicht gelockert/);
  });
  it.each([
    () => new Response('not JSON', { status: 200 }),
    () => Response.json({ choices: [] }),
    () => Response.json({ choices: [{ message: { content: 'no structured JSON' } }] }),
    () => Response.json({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'length' }] }),
    () => envelope({ title: 'Malformed', blocks: [] })
  ])('rejects malformed, truncated or unstructured responses', async response => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    await expect(generateAnswer(request(), fetcher)).rejects.toMatchObject({ code: 'invalid_response' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects a foreign citation even when valid JSON comes from the API', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(envelope({ title: 'X', blocks: [{ text: 'X', citationIds: ['OTHER'] }] }));
    await expect(generateAnswer(request(), fetcher)).rejects.toMatchObject({ code: 'invalid_citation' });
  });
  it('maps connection failures without leaking raw errors or retrying', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('PRIVATE-CONNECTION-DETAIL'));
    const error = await generateAnswer(request(), fetcher).catch(error => error);
    expect(error).toMatchObject({ code: 'network' });
    expect(error.message).not.toContain('PRIVATE-CONNECTION-DETAIL');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('propagates cancellation as AbortError without a second request', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true });
    }));
    const pending = generateAnswer({ ...request(), signal: abort.signal }, fetcher);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
