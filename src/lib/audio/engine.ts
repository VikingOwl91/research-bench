import { message, type MessageDescriptor } from '../i18n/index';
import { GenerationError } from '../providers';
import type { PodcastAudioConfig, PodcastAudioSegment, PodcastPcmFormat, PodcastRenderedAudio, Progress } from '../types';
import { AUDIO_BUFFER_LIMIT, AUDIO_SAMPLE_RATE, decodeRawPcm, decodeWav, MAX_EPISODE_SECONDS, MAX_SEGMENT_BYTES, inspectMp3, mp3Duration, normalizeSpeechLevel, toInt16 } from './pcm';
import type { DecodedPcm } from './pcm';

export interface PodcastAudioInput { blob: Blob; mimeType: PodcastAudioSegment['mimeType']; pcmFormat?: PodcastPcmFormat; }
interface EncoderReply { id: number; bufferedBytes?: number; bytes?: Uint8Array<ArrayBuffer>; error?: string; errorMessage?: MessageDescriptor; }
const abort = () => new DOMException('Abgebrochen', 'AbortError');
const ensureActive = (signal: AbortSignal) => { if (signal.aborted) throw abort(); };

export class PodcastAudioEngine {
  private generation = 0;
  private worker: Worker | null = null;
  private pending = new Map<number, { resolve: (reply: EncoderReply) => void; reject: (error: unknown) => void }>();
  private sequence = 0;
  private interruptions = new Set<(error: unknown) => void>();
  constructor(private readonly workerFactory = () => new Worker(new URL('./encoder.worker.ts', import.meta.url), { type: 'module' })) {}

  cancel(): void {
    this.generation++;
    this.worker?.terminate(); this.worker = null;
    for (const pending of this.pending.values()) pending.reject(abort());
    this.pending.clear();
    for (const reject of this.interruptions) reject(abort());
    this.interruptions.clear();
  }
  private check(signal: AbortSignal, generation: number): void { ensureActive(signal); if (this.generation !== generation) throw abort(); }

  private async waitActive<T>(promise: Promise<T>, signal: AbortSignal, generation: number): Promise<T> {
    this.check(signal, generation);
    let rejectWait: (error: unknown) => void = () => {};
    const interrupted = new Promise<never>((_, reject) => { rejectWait = reject; });
    const onAbort = () => rejectWait(abort());
    this.interruptions.add(rejectWait);
    signal.addEventListener('abort', onAbort, { once: true });
    try { const result = await Promise.race([promise, interrupted]); this.check(signal, generation); return result; }
    finally { this.interruptions.delete(rejectWait); signal.removeEventListener('abort', onAbort); }
  }

  private async decode(input: PodcastAudioInput, signal: AbortSignal, generation: number, availableBufferBytes = AUDIO_BUFFER_LIMIT): Promise<{ pcm: DecodedPcm; bytes: number }> {
    this.check(signal, generation);
    if (!(input.blob instanceof Blob) || !input.blob.size || input.blob.size > MAX_SEGMENT_BYTES) throw new GenerationError('Der Audiobeitrag ist leer oder zu groß.', 'invalid_audio');
    const buffer = await this.waitActive(input.blob.arrayBuffer(), signal, generation);
    this.check(signal, generation);
    if (input.mimeType === 'audio/wav') return { pcm: decodeWav(buffer), bytes: buffer.byteLength };
    if (input.mimeType === 'audio/pcm') return { pcm: decodeRawPcm(buffer, input.pcmFormat), bytes: buffer.byteLength };
    if (input.mimeType !== 'audio/mpeg') throw new GenerationError('Das Audioformat wird nicht unterstützt.', 'invalid_audio');
    const metadata = inspectMp3(new Uint8Array(buffer));
    const predictedCount = Math.ceil(metadata.durationSeconds * AUDIO_SAMPLE_RATE) + 1152;
    // Reserve native decode/channel buffers, mono copy and subsequent rendering copies BEFORE allocation.
    const predictedBytes = input.blob.size + predictedCount * 4 * (metadata.channels + 4);
    if (predictedBytes > availableBufferBytes) throw new GenerationError('Die lokalen Audiopuffer würden 128 MiB überschreiten. Bitte eine kürzere Folge erstellen.', 'audio_too_large');
    const Audio = globalThis.OfflineAudioContext;
    if (!Audio) throw new GenerationError('Dieser Browser unterstützt die lokale Audio-Decodierung nicht.', 'audio_unavailable');
    let decoded: AudioBuffer;
    try { decoded = await this.waitActive(new Audio(1, 1, AUDIO_SAMPLE_RATE).decodeAudioData(buffer), signal, generation); }
    catch { this.check(signal, generation); throw new GenerationError('Der Browser konnte die MP3-Daten nicht decodieren.', 'invalid_audio'); }
    this.check(signal, generation);
    if (!decoded.length || decoded.duration > MAX_EPISODE_SECONDS || decoded.numberOfChannels > 2 || decoded.length * decoded.numberOfChannels * 4 > 48 * 1024 * 1024) throw new GenerationError('Der Audiobeitrag überschreitet die Größenbegrenzung.', 'audio_too_large');
    const samples = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const source = decoded.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) {
        if (!Number.isFinite(source[i])) throw new GenerationError('Die Audiodaten enthalten ungültige Samples.', 'invalid_audio');
        samples[i] += source[i] / decoded.numberOfChannels;
      }
    }
    return { pcm: { samples, sampleRate: decoded.sampleRate }, bytes: input.blob.size + decoded.length * decoded.numberOfChannels * 4 };
  }

  async prepare(turnId: string, input: PodcastAudioInput, signal: AbortSignal): Promise<PodcastAudioSegment> {
    const generation = this.generation;
    if (!turnId) throw new GenerationError('Der Audiobeitrag hat keine Identität.', 'invalid_audio');
    const { pcm } = await this.decode(input, signal, generation);
    this.check(signal, generation);
    const sampleCount = Math.round(pcm.samples.length * AUDIO_SAMPLE_RATE / pcm.sampleRate);
    if (!sampleCount) throw new GenerationError('Der Audiobeitrag ist zu kurz.', 'invalid_audio');
    return { turnId, ...input, sampleRate: AUDIO_SAMPLE_RATE, sampleCount, durationSeconds: sampleCount / AUDIO_SAMPLE_RATE };
  }

  private async resample(pcm: DecodedPcm, signal: AbortSignal, generation: number): Promise<DecodedPcm> {
    if (pcm.sampleRate === AUDIO_SAMPLE_RATE) return pcm;
    const count = Math.round(pcm.samples.length * AUDIO_SAMPLE_RATE / pcm.sampleRate);
    const Audio = globalThis.OfflineAudioContext;
    if (!Audio) throw new GenerationError('Dieser Browser unterstützt die lokale Audio-Samplingrate nicht.', 'audio_unavailable');
    const context = new Audio(1, count, AUDIO_SAMPLE_RATE);
    const source = context.createBufferSource();
    const buffer = context.createBuffer(1, pcm.samples.length, pcm.sampleRate);
    buffer.copyToChannel(pcm.samples, 0); source.buffer = buffer; source.connect(context.destination); source.start();
    let result: AudioBuffer;
    try { result = await this.waitActive(context.startRendering(), signal, generation); }
    catch { this.check(signal, generation); throw new GenerationError('Der Browser konnte die Audiosamples nicht umrechnen.', 'invalid_audio'); }
    this.check(signal, generation);
    return { samples: new Float32Array(result.getChannelData(0)), sampleRate: AUDIO_SAMPLE_RATE };
  }

  private rpc(kind: 'init' | 'chunk' | 'finish', samples?: Int16Array<ArrayBuffer>): Promise<EncoderReply> {
    if (!this.worker) return Promise.reject(abort());
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker!.postMessage({ id, kind, samples }, samples ? [samples.buffer] : []); }
      catch { this.pending.delete(id); reject(new GenerationError('Der Encoder-Worker ist nicht erreichbar.', 'encoding')); }
    });
  }

  async render(segments: PodcastAudioSegment[], config: PodcastAudioConfig, signal: AbortSignal, onProgress?: (progress: Progress) => void): Promise<PodcastRenderedAudio> {
    this.cancel();
    const generation = this.generation;
    this.check(signal, generation);
    const inputBytes = segments.reduce((sum, segment) => sum + segment.blob.size, 0);
    if (!segments.length || segments.length > 24 || new Set(segments.map(s => s.turnId)).size !== segments.length || inputBytes > 80 * 1024 * 1024 || config.encoderVersion !== 'lamejs-1.2.7:mono24k:64k:v1' || (config.loudness !== undefined && config.loudness !== 'speech-rms-v1') || !Number.isFinite(config.pauseMs) || config.pauseMs < 0 || config.pauseMs > 1000) throw new GenerationError('Die Audio-Zusammenstellung ist ungültig oder zu groß.', 'invalid_audio');
    const started = performance.now();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; this.cancel(); }, 30000);
    const onAbort = () => this.cancel();
    signal.addEventListener('abort', onAbort, { once: true });
    let peakBufferBytes = inputBytes;
    let buffered = 0;
    const timeline: PodcastRenderedAudio['timeline'] = [];
    let samplesSent = 0;
    const pauseCount = Math.round(config.pauseMs * AUDIO_SAMPLE_RATE / 1000);
    try {
      this.worker = this.workerFactory();
      this.worker.onmessage = (event: MessageEvent<EncoderReply>) => {
        if (this.generation !== generation) return;
        const reply = event.data;
        const pending = this.pending.get(reply.id);
        if (!pending) return;
        this.pending.delete(reply.id);
        if (reply.error) pending.reject(new GenerationError(reply.errorMessage ?? message('runtime.encoderProcessFailed'), 'encoding'));
        else { buffered = reply.bufferedBytes ?? buffered; pending.resolve(reply); }
      };
      this.worker.onerror = () => { for (const pending of this.pending.values()) pending.reject(new GenerationError('Der lokale MP3-Encoder ist fehlgeschlagen.', 'encoding')); this.pending.clear(); };
      await this.rpc('init');
      for (let index = 0; index < segments.length; index++) {
        this.check(signal, generation);
        const decoded = await this.decode(segments[index], signal, generation, AUDIO_BUFFER_LIMIT - inputBytes - buffered * 2 - 73728 - 4 * 1024 * 1024);
        // Include native decoder/input copies and output resampling copies conservatively; never build episode-sized PCM.
        const targetCount = Math.round(decoded.pcm.samples.length * AUDIO_SAMPLE_RATE / decoded.pcm.sampleRate);
        const decodeBytes = decoded.bytes + decoded.pcm.samples.byteLength * 2 + targetCount * 8;
        peakBufferBytes = Math.max(peakBufferBytes, inputBytes + decodeBytes + buffered * 2 + 73728 + 4 * 1024 * 1024);
        if (peakBufferBytes > AUDIO_BUFFER_LIMIT) throw new GenerationError('Die lokalen Audiopuffer überschreiten 128 MiB. Bitte eine kürzere Folge erstellen.', 'audio_too_large');
        const pcm = await this.resample(decoded.pcm, signal, generation);
        if (config.loudness === 'speech-rms-v1') normalizeSpeechLevel(pcm.samples);
        this.check(signal, generation);
        if (samplesSent + pcm.samples.length + (index < segments.length - 1 ? pauseCount : 0) > MAX_EPISODE_SECONDS * AUDIO_SAMPLE_RATE) throw new GenerationError('Die Folge überschreitet die maximale Länge von zehn Minuten.', 'audio_too_long');
        timeline.push({ turnId: segments[index].turnId, start: samplesSent / AUDIO_SAMPLE_RATE, end: (samplesSent + pcm.samples.length) / AUDIO_SAMPLE_RATE });
        for (let offset = 0; offset < pcm.samples.length; offset += 36864) {
          this.check(signal, generation);
          await this.rpc('chunk', toInt16(pcm.samples, offset, Math.min(offset + 36864, pcm.samples.length)));
        }
        samplesSent += pcm.samples.length;
        if (index < segments.length - 1 && pauseCount) { await this.rpc('chunk', new Int16Array(pauseCount)); samplesSent += pauseCount; }
        onProgress?.({ stage: 'encoding', stageMessage: message('runtime.audioEncoding'), current: index + 1, total: segments.length, detail: `Audio ${index + 1}/${segments.length} zusammenbauen`, detailMessage: message('runtime.encodingDetail', { current: index + 1, total: segments.length }) });
      }
      const reply = await this.rpc('finish');
      this.check(signal, generation);
      if (!reply.bytes) throw new GenerationError('Der Encoder hat keine Audiodaten geliefert.', 'encoding');
      const durationSeconds = mp3Duration(reply.bytes);
      const nominalDuration = samplesSent / AUDIO_SAMPLE_RATE;
      if (durationSeconds < nominalDuration || durationSeconds - nominalDuration > 0.15) throw new GenerationError('Die MP3-Dauer passt nicht zum erzeugten Audio.', 'encoding');
      // LAME emits no gapless tag: account for 576 encoder + 529 decoder priming samples.
      // Attribute priming to the first contribution and final frame padding to the last.
      const priming = 1105 / AUDIO_SAMPLE_RATE;
      for (let index = 0; index < timeline.length; index++) {
        if (index > 0) timeline[index].start += priming;
        timeline[index].end = index < timeline.length - 1 ? timeline[index].end + priming : durationSeconds;
      }
      peakBufferBytes = Math.max(peakBufferBytes, inputBytes + reply.bytes.byteLength * 2);
      return { blob: new Blob([reply.bytes], { type: 'audio/mpeg' }), durationSeconds, timeline, encodingMs: performance.now() - started, peakBufferBytes };
    } catch (error) {
      if (timedOut) throw new GenerationError('Das lokale MP3-Encoding hat die Grenze von 30 Sekunden überschritten.', 'encoding_timeout');
      if (signal.aborted || generation !== this.generation) throw abort();
      throw error;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', onAbort); if (generation === this.generation) this.cancel(); }
  }
}
