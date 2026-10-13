import { message } from '../i18n/index';
// Self-hosted unchanged upstream ESM; prepared with hash and license by assets:prepare.
type Encoder = { encodeBuffer(samples: Int16Array): Int8Array; flush(): Int8Array };
let encoder: Encoder | null = null;
let chunks: Uint8Array<ArrayBuffer>[] = [];
let bytes = 0;
const worker = globalThis as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };
worker.onmessage = async (event: MessageEvent<{ id: number; kind: 'init' | 'chunk' | 'finish'; samples?: Int16Array }>) => {
  const { id, kind, samples } = event.data;
  try {
    if (kind === 'init') {
      const path = '/runtime/lamejs.js';
      const module = await import(/* @vite-ignore */ path);
      encoder = new module.Mp3Encoder(1, 24000, 64);
      chunks = []; bytes = 0;
    } else if (kind === 'chunk') {
      if (!encoder || !(samples instanceof Int16Array) || samples.length > 36864) throw new Error('invalid');
      for (let offset = 0; offset < samples.length; offset += 1152) append(encoder.encodeBuffer(samples.subarray(offset, offset + 1152)));
    } else if (kind === 'finish') {
      if (!encoder) throw new Error('invalid');
      append(encoder.flush());
      const result = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
      chunks = []; encoder = null;
      worker.postMessage({ id, bytes: result }, [result.buffer]);
      return;
    }
    worker.postMessage({ id, bufferedBytes: bytes });
  } catch { worker.postMessage({ id, error: 'Der lokale MP3-Encoder konnte das Audio nicht verarbeiten.', errorMessage: message('runtime.encoderProcessFailed') }); }
};
function append(encoded: Int8Array): void {
  if (!encoded.byteLength) return;
  bytes += encoded.byteLength;
  if (bytes > 6 * 1024 * 1024) throw new Error('limit');
  chunks.push(new Uint8Array(encoded));
}
