/** Counts only; deliberately excludes document contents, keys, and request bodies. */
export function installWasmProbe() {
  const root = globalThis as typeof globalThis & { __securityWasm?: { calls: number; successful: number; rust: number; pdfium: number; onnx: number; unknown: number }; __securityViolations?: number };
  root.__securityWasm = { calls: 0, successful: 0, rust: 0, pdfium: 0, onnx: 0, unknown: 0 };
  root.__securityViolations = 0;
  globalThis.addEventListener('securitypolicyviolation', () => { root.__securityViolations!++; });
  const origins = new WeakMap<object, string>();
  const classify = (url: string) => /research_core_bg/.test(url) ? 'rust' : /pdfium\.wasm/.test(url) ? 'pdfium' : /\/runtime\/.*\.wasm/.test(url) ? 'onnx' : 'unknown';
  const from = (input: unknown): string => {
    if (input instanceof Response) return input.url;
    if (input && typeof input === 'object') return origins.get(input) ?? (ArrayBuffer.isView(input) ? origins.get(input.buffer) : '') ?? '';
    return '';
  };
  const done = (source: unknown, result: unknown) => {
    const origin = from(source);
    root.__securityWasm!.successful++;
    root.__securityWasm![classify(origin)]++;
    if (result && typeof result === 'object') {
      origins.set(result, origin);
      const module = (result as { module?: object }).module; if (module) origins.set(module, origin);
    }
  };
  const arrayBuffer = Response.prototype.arrayBuffer;
  Response.prototype.arrayBuffer = async function () { const bytes = await arrayBuffer.call(this); origins.set(bytes, this.url); return bytes; };
  for (const name of ['compile', 'compileStreaming', 'instantiate', 'instantiateStreaming'] as const) {
    const original = WebAssembly[name] as (...args: unknown[]) => Promise<unknown>;
    (WebAssembly as unknown as Record<string, unknown>)[name] = function (...args: unknown[]) {
      root.__securityWasm!.calls++;
      return original.apply(WebAssembly, args).then(async result => { done(await args[0], result); return result; });
    };
  }
  for (const name of ['Module', 'Instance'] as const) {
    const original = WebAssembly[name];
    (WebAssembly as unknown as Record<string, unknown>)[name] = new Proxy(original, { construct(target, args, newTarget) {
      root.__securityWasm!.calls++;
      const result = Reflect.construct(target, args, newTarget); done(args[0], result); return result;
    } });
  }
}
