import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mp3Encoder } from '@breezystack/lamejs';
import { PodcastAudioEngine } from '../../src/lib/audio/engine';
import { AUDIO_SAMPLE_RATE, decodeRawPcm, decodeWav, inspectMp3, mp3Duration, normalizeSpeechLevel, toInt16 } from '../../src/lib/audio/pcm';
import { PODCAST_ENCODER_VERSION } from '../../src/lib/podcast-providers';
import type { PodcastAudioConfig } from '../../src/lib/types';

function wav(seconds = 0.2, bits = 16, encoding = 1, channels = 1): ArrayBuffer {
  const count = Math.round(seconds * AUDIO_SAMPLE_RATE); const bytes = bits / 8;
  const buffer = new ArrayBuffer(44 + count * bytes * channels); const data = new DataView(buffer);
  const write = (offset: number, text: string) => [...text].forEach((char, i) => data.setUint8(offset + i, char.charCodeAt(0)));
  write(0, 'RIFF'); data.setUint32(4, buffer.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt '); data.setUint32(16, 16, true);
  data.setUint16(20, encoding, true); data.setUint16(22, channels, true); data.setUint32(24, AUDIO_SAMPLE_RATE, true); data.setUint32(28, AUDIO_SAMPLE_RATE * bytes * channels, true); data.setUint16(32, bytes * channels, true); data.setUint16(34, bits, true); write(36, 'data'); data.setUint32(40, count * bytes * channels, true);
  for (let i = 0; i < count * channels; i++) {
    const n = Math.sin(Math.floor(i / channels) * 2 * Math.PI * 220 / AUDIO_SAMPLE_RATE) * 0.4; const offset = 44 + i * bytes;
    if (encoding === 3) data.setFloat32(offset, n, true);
    else if (bits === 16) data.setInt16(offset, n * 32767, true);
    else if (bits === 32) data.setInt32(offset, n * 2147483647, true);
    else { const v = Math.round(n * 8388607); data.setUint8(offset, v & 255); data.setUint8(offset + 1, (v >>> 8) & 255); data.setUint8(offset + 2, (v >>> 16) & 255); }
  }
  return buffer;
}
const config: PodcastAudioConfig = { provider: 'mistral', model: 'voxtral-mini-tts-2603', voices: { A: { id: 'a', slug: 'a' }, B: { id: 'b', slug: 'b' } }, format: 'wav', pauseMs: 180, encoderVersion: PODCAST_ENCODER_VERSION };
class RealEncoderWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  private encoder: Mp3Encoder | null = null;
  private chunks: Uint8Array[] = [];
  postMessage(data: { id: number; kind: string; samples?: Int16Array }): void {
    queueMicrotask(() => {
      if (this.terminated) return;
      let bytes: Uint8Array | undefined;
      if (data.kind === 'init') this.encoder = new Mp3Encoder(1, AUDIO_SAMPLE_RATE, 64);
      if (data.kind === 'chunk') for (let offset = 0; offset < data.samples!.length; offset += 1152) this.chunks.push(new Uint8Array(this.encoder!.encodeBuffer(data.samples!.subarray(offset, offset + 1152))));
      if (data.kind === 'finish') {
        this.chunks.push(new Uint8Array(this.encoder!.flush()));
        bytes = new Uint8Array(this.chunks.reduce((sum, c) => sum + c.length, 0));
        let offset = 0; for (const c of this.chunks) { bytes.set(c, offset); offset += c.length; }
      }
      this.onmessage?.({ data: { id: data.id, bytes, bufferedBytes: this.chunks.reduce((sum, c) => sum + c.length, 0) } } as MessageEvent);
    });
  }
  terminate() { this.terminated = true; }
}
afterEach(() => vi.unstubAllGlobals());

describe('strict WAV and PCM handling', () => {
  it.each([[16, 1], [24, 1], [32, 1], [32, 3]])('decodes supported %s-bit format %s without losing time boundaries', (bits, encoding) => {
    const result = decodeWav(wav(0.2, bits, encoding)); expect(result.samples.length).toBe(4800); expect(result.sampleRate).toBe(24000);
    expect(result.samples[27]).toBeCloseTo(0.4, 2);
  });
  it('downmixes stereo to a mono contribution', () => expect(decodeWav(wav(0.2, 16, 1, 2)).samples.length).toBe(4800));
  it('rejects truncated chunks and inconsistent block lengths', () => {
    expect(() => decodeWav(wav().slice(0, -2))).toThrow();
    const broken = wav(); new DataView(broken).setUint16(32, 7, true); expect(() => decodeWav(broken)).toThrow();
  });
  it('rejects NaN float samples', () => {
    const broken = wav(0.2, 32, 3); new DataView(broken).setFloat32(44, NaN, true); expect(() => decodeWav(broken)).toThrow(/Samples/);
  });
  it('requires explicit raw PCM metadata instead of guessing', () => {
    const data = new Int16Array([32767, -32768]).buffer;
    expect(() => decodeRawPcm(data)).toThrow(/Formatbeschreibung/);
    expect([...decodeRawPcm(data, { channels: 1, sampleRate: 24000, encoding: 's16le' }).samples]).toEqual([32767 / 32768, -1]);
  });
  it('preflights native MP3 duration and rejects fake or truncated compressed input', () => {
    const bytes = new Uint8Array(new Mp3Encoder(1, 24000, 64).flush());
    expect(inspectMp3(bytes).durationSeconds).toBeGreaterThan(0);
    expect(inspectMp3(bytes).durationSeconds).toBeCloseTo(mp3Duration(bytes), 8);
    expect(() => inspectMp3(new TextEncoder().encode('not audio'))).toThrow();
    expect(() => inspectMp3(bytes.subarray(0, bytes.length - 1))).toThrow();
  });
  it('normalizes quiet contributions in-place with bounded gain and target RMS', () => {
    const quiet = new Float32Array([0.02, -0.02, 0.02, -0.02]); const original = quiet.buffer;
    expect(normalizeSpeechLevel(quiet)).toBe(3); expect(quiet.buffer).toBe(original);
    expect(quiet[0]).toBeCloseTo(0.06, 6);
    const medium = new Float32Array([0.05, -0.05]);
    expect(normalizeSpeechLevel(medium)).toBeCloseTo(2, 5); expect(medium[0]).toBeCloseTo(0.1, 6);
  });
  it('limits isolated peaks and does not amplify silence or noise floors', () => {
    const samples = new Float32Array(10000); samples[42] = 0.9;
    expect(normalizeSpeechLevel(samples)).toBeCloseTo(0.92 / 0.9, 5); expect(samples[42]).toBeLessThanOrEqual(0.920001);
    const silence = new Float32Array([0, 0, 0]); expect(normalizeSpeechLevel(silence)).toBe(1);
    const floor = new Float32Array([0.00001, -0.00001]); expect(normalizeSpeechLevel(floor)).toBe(1);
    expect(() => normalizeSpeechLevel(new Float32Array([NaN]))).toThrow(/Samples/);
  });
  it('converts finite samples with saturation to signed 16-bit', () => {
    expect([...toInt16(new Float32Array([-2, -1, 0, 1, 2]), 0, 5)]).toEqual([-32768, -32768, 0, 32767, 32767]);
    expect(() => toInt16(new Float32Array([NaN]), 0, 1)).toThrow();
  });
});

describe('sequential MP3 rendering and cancellation', () => {
  it('encodes a single valid MP3, uses real frame duration and contribution-level markers', async () => {
    const worker = new RealEncoderWorker(); const engine = new PodcastAudioEngine(() => worker as unknown as Worker);
    const input = { blob: new Blob([wav()], { type: 'audio/wav' }), mimeType: 'audio/wav' as const };
    const segmentA = await engine.prepare('T1', input, new AbortController().signal);
    const segmentB = await engine.prepare('T2', input, new AbortController().signal);
    const result = await engine.render([segmentA, segmentB], config, new AbortController().signal);
    expect(result.blob.type).toBe('audio/mpeg'); expect(result.blob.size).toBeGreaterThan(1000);
    expect(result.durationSeconds).toBe(mp3Duration(new Uint8Array(await result.blob.arrayBuffer())));
    expect(result.durationSeconds).toBeGreaterThanOrEqual(0.58); expect(result.durationSeconds).toBeLessThan(0.73);
    expect(result.timeline[0].start).toBe(0); expect(result.timeline[1].start).toBeCloseTo(0.38 + 1105 / 24000, 5);
    expect(result.timeline[1].end).toBe(result.durationSeconds); expect(result.peakBufferBytes).toBeLessThan(128 * 1024 * 1024); expect(worker.terminated).toBe(true);
  });
  it('applies configured loudness to new render inputs while leaving legacy configs unchanged', async () => {
    class RecordingWorker extends RealEncoderWorker {
      peak = 0;
      override postMessage(data: { id: number; kind: string; samples?: Int16Array }): void {
        if (data.samples) for (const sample of data.samples) this.peak = Math.max(this.peak, Math.abs(sample));
        super.postMessage(data);
      }
    }
    const samples = wav(); const view = new DataView(samples);
    for (let offset = 44; offset < samples.byteLength; offset += 2) view.setInt16(offset, view.getInt16(offset, true) * 0.1, true);
    const input = { blob: new Blob([samples], { type: 'audio/wav' }), mimeType: 'audio/wav' as const };
    const legacyWorker = new RecordingWorker(); const legacy = new PodcastAudioEngine(() => legacyWorker as unknown as Worker);
    const segment = await legacy.prepare('T1', input, new AbortController().signal);
    await legacy.render([segment], config, new AbortController().signal);
    const normalizedWorker = new RecordingWorker(); const engine = new PodcastAudioEngine(() => normalizedWorker as unknown as Worker);
    const result = await engine.render([segment], { ...config, loudness: 'speech-rms-v1' }, new AbortController().signal);
    expect(normalizedWorker.peak).toBeGreaterThan(legacyWorker.peak * 2.99);
    expect(normalizedWorker.peak).toBeLessThanOrEqual(legacyWorker.peak * 3.01);
    expect(result.timeline[0].start).toBe(0);
  });
  it('renders the five-minute 24-contribution reference without episode-sized PCM buffers', async () => {
    const worker = new RealEncoderWorker(); const engine = new PodcastAudioEngine(() => worker as unknown as Worker);
    const seconds = (300 - 23 * 0.18) / 24;
    const input = { blob: new Blob([wav(seconds)], { type: 'audio/wav' }), mimeType: 'audio/wav' as const };
    const base = await engine.prepare('T1', input, new AbortController().signal);
    const result = await engine.render(Array.from({ length: 24 }, (_, index) => ({ ...base, turnId: `T${index + 1}` })), config, new AbortController().signal);
    expect(result.durationSeconds).toBeGreaterThanOrEqual(299.99); expect(result.durationSeconds).toBeLessThan(300.15);
    expect(result.encodingMs).toBeLessThan(30000); expect(result.peakBufferBytes).toBeLessThan(128 * 1024 * 1024);
    expect(result.timeline).toHaveLength(24);
    console.info(JSON.stringify({ referenceAudioSeconds: result.durationSeconds, turns: 24, encodingMs: Math.round(result.encodingMs), accountedPeakBufferBytes: result.peakBufferBytes, mp3Bytes: result.blob.size }));
  }, 40000);
  it('cancels stalled encoder requests immediately and terminates the worker', async () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null };
    const engine = new PodcastAudioEngine(() => worker as unknown as Worker);
    const input = { blob: new Blob([wav()], { type: 'audio/wav' }), mimeType: 'audio/wav' as const };
    const segment = await engine.prepare('T1', input, new AbortController().signal);
    const controller = new AbortController(); const pending = engine.render([segment], config, controller.signal);
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(worker.terminate).toHaveBeenCalled();
  });
  it('aborts MP3 decoding without waiting for a native decoder that resolves later', async () => {
    let resolve!: (value: AudioBuffer) => void;
    vi.stubGlobal('OfflineAudioContext', class { decodeAudioData() { return new Promise<AudioBuffer>(r => { resolve = r; }); } });
    const engine = new PodcastAudioEngine(); const controller = new AbortController();
    const pending = engine.prepare('T1', { blob: new Blob([new Uint8Array(new Mp3Encoder(1, 24000, 64).flush())], { type: 'audio/mpeg' }), mimeType: 'audio/mpeg' }, controller.signal);
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function')); controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    resolve({ length: 1, duration: 0.1, numberOfChannels: 1, sampleRate: 24000, getChannelData: () => new Float32Array(1) } as unknown as AudioBuffer);
  });
  it('can cancel a native decoder even when its caller does not abort the signal', async () => {
    let entered = false;
    vi.stubGlobal('OfflineAudioContext', class { decodeAudioData() { entered = true; return new Promise<AudioBuffer>(() => {}); } });
    const engine = new PodcastAudioEngine();
    const pending = engine.prepare('T1', { blob: new Blob([new Uint8Array(new Mp3Encoder(1, 24000, 64).flush())], { type: 'audio/mpeg' }), mimeType: 'audio/mpeg' }, new AbortController().signal);
    await vi.waitFor(() => expect(entered).toBe(true)); engine.cancel();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('enforces the encoding watchdog for a stalled worker and permits a fresh attempt', async () => {
    vi.useFakeTimers();
    try {
      const stalled = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null };
      const engine = new PodcastAudioEngine(() => stalled as unknown as Worker);
      const input = { blob: new Blob([wav()], { type: 'audio/wav' }), mimeType: 'audio/wav' as const };
      const segment = await engine.prepare('T1', input, new AbortController().signal);
      const pending = engine.render([segment], config, new AbortController().signal);
      const assertion = expect(pending).rejects.toMatchObject({ code: 'encoding_timeout' });
      await vi.advanceTimersByTimeAsync(30000); await assertion;
      expect(stalled.terminate).toHaveBeenCalled();
      expect((await engine.prepare('T1', input, new AbortController().signal)).sampleCount).toBe(4800);
    } finally { vi.useRealTimers(); }
  });
  it('rejects projected PCM memory BEFORE entering the native decoder', async () => {
    const short = new Uint8Array(new Mp3Encoder(1, 24000, 64).flush());
    const firstFrame = short.subarray(0, 192);
    const compressed = new Uint8Array(Math.ceil(400 / 0.024) * 192);
    for (let offset = 0; offset < compressed.length; offset += 192) compressed.set(firstFrame, offset);
    const nativeDecoder = vi.fn(); vi.stubGlobal('OfflineAudioContext', nativeDecoder);
    const worker = new RealEncoderWorker(); const engine = new PodcastAudioEngine(() => worker as unknown as Worker);
    const first = { turnId: 'T1', blob: new Blob([compressed], { type: 'audio/mpeg' }), mimeType: 'audio/mpeg' as const, sampleRate: 24000, sampleCount: 9600000, durationSeconds: 400 };
    const filler = new Blob([new Uint8Array(8 * 1024 * 1024)], { type: 'audio/wav' });
    const segments = [first, ...Array.from({ length: 9 }, (_, index) => ({ ...first, turnId: `T${index + 2}`, blob: filler, mimeType: 'audio/wav' as const }))];
    await expect(engine.render(segments, config, new AbortController().signal)).rejects.toMatchObject({ code: 'audio_too_large' });
    expect(nativeDecoder).not.toHaveBeenCalled();
  });
  it('rejects unknown loudness policies and preserves old configurations without a policy', async () => {
    const factory = vi.fn(); const engine = new PodcastAudioEngine(factory);
    const segment = await engine.prepare('T1', { blob: new Blob([wav()], { type: 'audio/wav' }), mimeType: 'audio/wav' }, new AbortController().signal);
    await expect(engine.render([segment], { ...config, loudness: 'unknown' } as unknown as PodcastAudioConfig, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid_audio' });
    expect(factory).not.toHaveBeenCalled();
  });
  it('rejects oversized episodes before creating a worker', async () => {
    const factory = vi.fn(); const engine = new PodcastAudioEngine(factory);
    const segment = { turnId: 'T1', blob: new Blob(['x']), mimeType: 'audio/wav' as const, sampleRate: 24000, sampleCount: 1, durationSeconds: 1 / 24000 };
    await expect(engine.render(Array.from({ length: 25 }, (_, i) => ({ ...segment, turnId: `T${i}` })), config, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid_audio' });
    expect(factory).not.toHaveBeenCalled();
  });
});
