import { GenerationError } from '../providers';
import type { PodcastPcmFormat } from '../types';

export const AUDIO_SAMPLE_RATE = 24000;
export const AUDIO_BUFFER_LIMIT = 128 * 1024 * 1024;
export const MAX_SEGMENT_BYTES = 8 * 1024 * 1024;
export const MAX_EPISODE_SECONDS = 600;
export interface DecodedPcm { samples: Float32Array<ArrayBuffer>; sampleRate: number; }
function invalid(message = 'Das Audioformat ist beschädigt oder nicht unterstützt.'): never { throw new GenerationError(message, 'invalid_audio'); }
const fourCC = (data: DataView, offset: number) => String.fromCharCode(...new Uint8Array(data.buffer, data.byteOffset + offset, 4));
function rate(value: number): void { if (!Number.isInteger(value) || value < 8000 || value > 192000) invalid('Die Audio-Samplingrate wird nicht unterstützt.'); }

/** RIFF/WAVE PCM (16/24/32-bit signed) and IEEE float32. No guessed raw-PCM layout. */
export function decodeWav(buffer: ArrayBuffer): DecodedPcm {
  if (buffer.byteLength < 44 || buffer.byteLength > MAX_SEGMENT_BYTES) invalid();
  const data = new DataView(buffer);
  if (fourCC(data, 0) !== 'RIFF' || fourCC(data, 8) !== 'WAVE') invalid();
  const end = data.getUint32(4, true) + 8;
  if (end !== buffer.byteLength || end < 44) invalid();
  let format: { encoding: number; channels: number; sampleRate: number; bits: number; block: number } | null = null;
  let body: { offset: number; length: number } | null = null;
  let cursor = 12;
  while (cursor < end) {
    if (cursor + 8 > end) invalid();
    const name = fourCC(data, cursor);
    const length = data.getUint32(cursor + 4, true);
    const offset = cursor + 8;
    if (offset + length > end) invalid();
    if (name === 'fmt ') {
      if (format || length < 16) invalid();
      format = { encoding: data.getUint16(offset, true), channels: data.getUint16(offset + 2, true), sampleRate: data.getUint32(offset + 4, true), block: data.getUint16(offset + 12, true), bits: data.getUint16(offset + 14, true) };
      rate(format.sampleRate);
      if (format.channels < 1 || format.channels > 2 || ![16, 24, 32].includes(format.bits) || ![1, 3].includes(format.encoding) || (format.encoding === 3 && format.bits !== 32)) invalid();
      if (format.block !== format.channels * format.bits / 8 || data.getUint32(offset + 8, true) !== format.sampleRate * format.block) invalid();
    }
    if (name === 'data') { if (body) invalid(); body = { offset, length }; }
    cursor = offset + length + (length & 1);
    if (cursor > end) invalid();
  }
  if (!format || !body || !body.length || body.length % format.block) invalid();
  const count = body.length / format.block;
  if (count / format.sampleRate > MAX_EPISODE_SECONDS || count * 4 + buffer.byteLength > AUDIO_BUFFER_LIMIT) invalid('Das Audio überschreitet die Größenbegrenzung.');
  const samples = new Float32Array(count);
  const bytes = format.bits / 8;
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel++) {
      const offset = body.offset + i * format.block + channel * bytes;
      let value: number;
      if (format.encoding === 3) value = data.getFloat32(offset, true);
      else if (format.bits === 16) value = data.getInt16(offset, true) / 32768;
      else if (format.bits === 32) value = data.getInt32(offset, true) / 2147483648;
      else { const n = data.getUint8(offset) | data.getUint8(offset + 1) << 8 | data.getUint8(offset + 2) << 16; value = (n & 0x800000 ? n - 0x1000000 : n) / 8388608; }
      if (!Number.isFinite(value) || value < -1.001 || value > 1.001) invalid('Die Audiodaten enthalten ungültige Samples.');
      sum += value;
    }
    samples[i] = Math.max(-1, Math.min(1, sum / format.channels));
  }
  return { samples, sampleRate: format.sampleRate };
}

export function decodeRawPcm(buffer: ArrayBuffer, format?: PodcastPcmFormat): DecodedPcm {
  if (!format || format.channels !== 1 || !['f32le', 's16le'].includes(format.encoding)) invalid('Rohes PCM erfordert eine bekannte, vollständige Formatbeschreibung.');
  rate(format.sampleRate);
  const bytes = format.encoding === 'f32le' ? 4 : 2;
  if (!buffer.byteLength || buffer.byteLength > MAX_SEGMENT_BYTES || buffer.byteLength % bytes) invalid();
  const count = buffer.byteLength / bytes;
  if (count / format.sampleRate > MAX_EPISODE_SECONDS) invalid();
  const data = new DataView(buffer);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const value = bytes === 4 ? data.getFloat32(i * bytes, true) : data.getInt16(i * bytes, true) / 32768;
    if (!Number.isFinite(value) || value < -1.001 || value > 1.001) invalid();
    samples[i] = Math.max(-1, Math.min(1, value));
  }
  return { samples, sampleRate: format.sampleRate };
}

export function toInt16(samples: Float32Array, start: number, end: number): Int16Array<ArrayBuffer> {
  const result = new Int16Array(end - start);
  for (let i = start; i < end; i++) {
    const value = samples[i];
    if (!Number.isFinite(value)) invalid();
    result[i - start] = Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767));
  }
  return result;
}

/** Our encoder emits MPEG-2 Layer III, fixed 24 kHz, 64 kbit/s, without ID3/Xing. */
export function mp3Duration(bytes: Uint8Array): number {
  let offset = 0;
  let frames = 0;
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length || bytes[offset] !== 255 || (bytes[offset + 1] & 0xfe) !== 0xf2 || (bytes[offset + 2] >>> 4) !== 8 || ((bytes[offset + 2] >>> 2) & 3) !== 1) invalid('Der MP3-Encoder hat ein ungültiges Ergebnis geliefert.');
    const frameLength = 192 + ((bytes[offset + 2] >>> 1) & 1);
    if (offset + frameLength > bytes.length) invalid();
    frames++; offset += frameLength;
  }
  if (!frames) invalid();
  return frames * 576 / AUDIO_SAMPLE_RATE;
}

/** Inspect compressed MP3 before native decoding, preventing tiny compressed inputs from allocating huge PCM. */
export function inspectMp3(bytes: Uint8Array): { durationSeconds: number; channels: number } {
  let offset = 0;
  if (bytes.length >= 10 && String.fromCharCode(...bytes.subarray(0, 3)) === 'ID3') {
    if (bytes[3] < 2 || bytes[3] > 4 || bytes.subarray(6, 10).some(value => value & 0x80)) invalid();
    const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
    offset = 10 + size + (bytes[3] === 4 && (bytes[5] & 0x10) ? 10 : 0);
    if (offset >= bytes.length) invalid();
  }
  let durationSeconds = 0;
  let channels = 1;
  let frames = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset === 128 && String.fromCharCode(...bytes.subarray(offset, offset + 3)) === 'TAG') break;
    if (offset + 4 > bytes.length || bytes[offset] !== 255 || (bytes[offset + 1] & 0xe0) !== 0xe0) invalid();
    const version = (bytes[offset + 1] >>> 3) & 3;
    const layer = (bytes[offset + 1] >>> 1) & 3;
    const bitrateIndex = bytes[offset + 2] >>> 4;
    const rateIndex = (bytes[offset + 2] >>> 2) & 3;
    if (version === 1 || layer !== 1 || !bitrateIndex || bitrateIndex === 15 || rateIndex === 3) invalid();
    const bitrate = (version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitrateIndex];
    const sampleRate = [44100, 48000, 32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const frameSize = Math.floor((version === 3 ? 144000 : 72000) * bitrate / sampleRate) + ((bytes[offset + 2] >>> 1) & 1);
    if (offset + frameSize > bytes.length) invalid();
    durationSeconds += (version === 3 ? 1152 : 576) / sampleRate;
    channels = Math.max(channels, bytes[offset + 3] >>> 6 === 3 ? 1 : 2);
    if (durationSeconds > MAX_EPISODE_SECONDS || Math.ceil(durationSeconds * AUDIO_SAMPLE_RATE) * channels * 4 > 48 * 1024 * 1024) invalid('Der komprimierte Audiobeitrag überschreitet die sichere PCM-Größe.');
    offset += frameSize; frames++;
  }
  if (!frames) invalid();
  return { durationSeconds, channels };
}

/** Bounded per-contribution speech level, in-place; not LUFS normalization or a compressor. */
export function normalizeSpeechLevel(samples: Float32Array): number {
  if (!samples.length) return 1;
  let energy = 0;
  let peak = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) invalid('Die Audiodaten enthalten ungültige Samples.');
    energy += sample * sample; peak = Math.max(peak, Math.abs(sample));
  }
  const rms = Math.sqrt(energy / samples.length);
  if (rms < 0.0001 || !peak) return 1;
  const gain = Math.min(3, 0.1 / rms, 0.92 / peak);
  for (let index = 0; index < samples.length; index++) samples[index] *= gain;
  return gain;
}
