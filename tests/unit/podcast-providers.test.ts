import { describe, expect, it, vi } from 'vitest';
import { buildPodcastScriptBody, generatePodcastScript, PODCAST_AUDIO_MODELS, PODCAST_ENCODER_VERSION, PODCAST_VOICE_SLUGS, resolvePodcastAudioConfig, synthesizePodcastTurn, validatePodcastScript } from '../../src/lib/podcast-providers';
import type { Citation, PodcastAudioConfig, Provider } from '../../src/lib/types';
const citations: Citation[] = [{ id: 'C1', sourceId: 's', sourceName: 'Fiktiv', page: 1, start: 0, end: 4, text: 'Beleg' }];
const script = { title: 'Zwei Gedanken', language: 'de' as const, turns: Array.from({ length: 4 }, (_, index) => ({ speaker: index % 2 ? 'B' : 'A', text: `Beitrag ${index}`, citationIds: ['C1'] })) };
const signal = () => new AbortController().signal;
const request = (provider: Provider = 'mistral') => ({ provider, key: 'dummy-test-key', language: 'de' as const, citations, signal: signal() });
const config = (provider: Provider = 'mistral'): PodcastAudioConfig => ({ provider, model: PODCAST_AUDIO_MODELS[provider], format: provider === 'mistral' ? 'wav' : 'mp3', voices: { A: { id: provider === 'mistral' ? 'preset-a' : PODCAST_VOICE_SLUGS.A, slug: PODCAST_VOICE_SLUGS.A }, B: { id: provider === 'mistral' ? 'preset-b' : PODCAST_VOICE_SLUGS.B, slug: PODCAST_VOICE_SLUGS.B } }, encoderVersion: PODCAST_ENCODER_VERSION, pauseMs: 180 });

describe('podcast script contract', () => {
  it('creates stable local contribution IDs and allows source-sparse scripts', () => {
    expect(validatePodcastScript(script, citations, 'de').turns.map(t => t.id)).toEqual(['T1', 'T2', 'T3', 'T4']);
  });
  it.each([
    { ...script, language: 'en' }, { ...script, turns: script.turns.slice(0, 3) },
    { ...script, turns: script.turns.map(t => ({ ...t, speaker: 'A' })) },
    { ...script, turns: [{ ...script.turns[0], id: 'api-generated-id' }, ...script.turns.slice(1)] },
    { ...script, turns: script.turns.map(t => ({ ...t, text: 'x'.repeat(1801) })) },
    { ...script, turns: Array.from({ length: 8 }, (_, i) => ({ ...script.turns[i % 4], text: 'x'.repeat(1600) })) }
  ])('rejects malformed or oversized dialog', value => expect(() => validatePodcastScript(value, citations, 'de')).toThrow());
  it.each([[['C2']], [['C1', 'C1']]])('rejects outside or duplicate citation IDs', citationIds => {
    // Duplicate ID allowance is cardinality-based on a two-item transmitted context.
    expect(() => validatePodcastScript({ ...script, turns: [{ ...script.turns[0], citationIds }, ...script.turns.slice(1)] }, [...citations, { ...citations[0], id: 'C3' }], 'de')).toThrow(/Quellenverweise/);
  });
  it('sends strict matching size constraints and collaborative role tendencies', () => {
    const body = buildPodcastScriptBody(request('openrouter')) as any;
    expect(body.provider).toEqual({ zdr: true, data_collection: 'deny', require_parameters: true });
    expect(body.response_format.json_schema.schema.properties.turns).toMatchObject({ minItems: 4, maxItems: 24 });
    expect(body.response_format.json_schema.schema.properties.turns.items.properties.text.maxLength).toBe(1800);
    expect(body.messages[0].content).toContain('kein starres Interview');
    expect(JSON.stringify(body.messages)).not.toContain('dummy-test-key');
  });
  it.each(['mistral', 'openrouter'] as const)('parses schema output from %s without emitting provider metadata', async provider => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(script) }, finish_reason: 'stop' }] }));
    expect((await generatePodcastScript(request(provider), fetcher)).turns).toHaveLength(4);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });
  it('rejects truncated script output', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(script) }, finish_reason: 'length' }] }));
    await expect(generatePodcastScript(request(), fetcher)).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('discovered voices and pinned provider configuration', () => {
  it('resolves Mistral voice IDs via EU cursor pages, never fabricates IDs from slugs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [{ id: 'a', type: 'preset', slug: PODCAST_VOICE_SLUGS.A }], next_page_token: 'cursor 1' })).mockResolvedValueOnce(Response.json({ data: [{ id: 'b', type: 'preset', slug: PODCAST_VOICE_SLUGS.B }], next_page_token: null }));
    const result = await resolvePodcastAudioConfig('mistral', 'dummy-test-key', signal(), fetcher);
    expect(result.voices.A.id).toBe('a'); expect(result.voices.B.id).toBe('b'); expect(result.format).toBe('wav');
    expect(fetcher.mock.calls[1][0]).toContain('https://api.eu.mistral.ai/v2/audio/voices?');
    expect(fetcher.mock.calls[1][0]).toContain('page_token=cursor+1');
  });
  it('rejects unavailable or ambiguous presets', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id: 'a', type: 'preset', slug: PODCAST_VOICE_SLUGS.A }, { id: 'aa', type: 'preset', slug: PODCAST_VOICE_SLUGS.A }], next_page_token: null }));
    await expect(resolvePodcastAudioConfig('mistral', 'dummy-test-key', signal(), fetcher)).rejects.toMatchObject({ code: 'voice_unavailable' });
  });
  it('detects repeated cursor rather than looping or using an unchecked partial list', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [], next_page_token: 'same' }));
    await expect(resolvePodcastAudioConfig('mistral', 'dummy-test-key', signal(), fetcher)).rejects.toMatchObject({ code: 'voice_unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('verifies OpenRouter supported voices and explicitly requests MP3 without inventing PCM metadata', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id: 'other/model', supported_voices: null }, { id: PODCAST_AUDIO_MODELS.openrouter, supported_voices: Object.values(PODCAST_VOICE_SLUGS) }] }));
    const result = await resolvePodcastAudioConfig('openrouter', 'dummy-test-key', signal(), fetcher);
    expect(result.format).toBe('mp3'); expect(result.pcmFormat).toBeUndefined();
    expect(fetcher.mock.calls[0][1]?.headers).toBeUndefined();
  });
  it('fails closed when metadata omits the selected voice', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id: PODCAST_AUDIO_MODELS.openrouter, supported_voices: [PODCAST_VOICE_SLUGS.A] }] }));
    await expect(resolvePodcastAudioConfig('openrouter', 'dummy-test-key', signal(), fetcher)).rejects.toMatchObject({ code: 'voice_unavailable' });
  });
});

describe('speech transport bounds, abort and safe errors', () => {
  it('normalizes Mistral Base64 WAV and selects speaker B using a discovered ID', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ audio_data: btoa('RIFFfixture') }));
    const result = await synthesizePodcastTurn({ config: config(), speaker: 'B', key: 'dummy-test-key', text: 'Hallo', signal: signal() }, fetcher);
    expect(await result.blob.text()).toBe('RIFFfixture'); expect(result.blob.type).toBe('audio/wav');
    expect(fetcher.mock.calls[0][0]).toBe('https://api.eu.mistral.ai/v1/audio/speech');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toMatchObject({ voice_id: 'preset-b', response_format: 'wav', stream: false });
  });
  it('accepts OpenRouter audio bytes with privacy flags and no chat-only parameter routing', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('mp3fixture', { headers: { 'content-type': 'audio/mpeg' } }));
    const result = await synthesizePodcastTurn({ config: config('openrouter'), speaker: 'A', key: 'dummy-test-key', text: 'Hello', signal: signal() }, fetcher);
    expect(result.mimeType).toBe('audio/mpeg'); expect(await result.blob.text()).toBe('mp3fixture');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string).provider).toEqual({ zdr: true, data_collection: 'deny' });
  });
  it.each([401, 402, 404, 429, 500])('never surfaces private raw error bodies for HTTP %s', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('SECRET_SOURCE_CONTENT', { status }));
    const error = await synthesizePodcastTurn({ config: config(), speaker: 'A', key: 'dummy-test-key', text: 'Hallo', signal: signal() }, fetcher).catch(error => error);
    expect(error.code).toBe(`http_${status}`); expect(error.message).not.toContain('SECRET_SOURCE_CONTENT'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects unknown raw PCM configurations without a paid request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(synthesizePodcastTurn({ config: { ...config('openrouter'), format: 'pcm' }, speaker: 'A', key: 'dummy-test-key', text: 'Hello', signal: signal() }, fetcher)).rejects.toMatchObject({ code: 'invalid_config' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not fetch after abort even when a fetch mock ignores signals', async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ audio_data: btoa('audio') }));
    await expect(synthesizePodcastTurn({ config: config(), speaker: 'A', key: 'dummy-test-key', text: 'Hallo', signal: controller.signal }, fetcher)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('aborts a stalled body reader after headers and cancels the stream', async () => {
    const controller = new AbortController(); const cancelled = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled })));
    const pending = synthesizePodcastTurn({ config: config('openrouter'), speaker: 'A', key: 'dummy-test-key', text: 'Hello', signal: controller.signal }, fetcher);
    await Promise.resolve(); await Promise.resolve(); controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(cancelled).toHaveBeenCalled();
  });
  it('discards a late response from a fetcher that ignores abort', async () => {
    const controller = new AbortController();
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = synthesizePodcastTurn({ config: config(), speaker: 'A', key: 'dummy-test-key', text: 'Hallo', signal: controller.signal }, fetcher);
    controller.abort(); resolve(Response.json({ audio_data: btoa('late') }));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects oversized advertised or streamed responses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('small', { headers: { 'content-length': String(9 * 1024 * 1024) } }));
    await expect(synthesizePodcastTurn({ config: config('openrouter'), speaker: 'A', key: 'dummy-test-key', text: 'Hello', signal: signal() }, fetcher)).rejects.toMatchObject({ code: 'response_too_large' });
  });
  it('rejects malformed Base64 without leaking payload', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ audio_data: 'secret-invalid-§§' }));
    await expect(synthesizePodcastTurn({ config: config(), speaker: 'A', key: 'dummy-test-key', text: 'Hallo', signal: signal() }, fetcher)).rejects.toMatchObject({ code: 'invalid_audio' });
  });
});
