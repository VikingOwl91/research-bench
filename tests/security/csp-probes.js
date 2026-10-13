// Executed by a normal DOM click in an actual self-hosted module. DevTools
// evaluation itself may bypass string-compilation CSP and is not the probe.
const button = document.createElement('button');
button.id = 'security-probe'; button.textContent = 'Run security probes';
button.addEventListener('click', async () => {
  const result = { inline: false, eval: false, wasm: false, blobWorker: false };
  const script = document.createElement('script'); script.textContent = 'window.__forbiddenInline = true'; document.body.append(script);
  result.inline = !window.__forbiddenInline;
  try { new Function('return 1')(); } catch { result.eval = true; }
  try { await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); } catch { result.wasm = true; }
  const url = URL.createObjectURL(new Blob(['self.postMessage(1)'], { type: 'text/javascript' }));
  result.blobWorker = await new Promise(resolve => {
    let worker;
    try {
      worker = new Worker(url);
      worker.onerror = event => { event.preventDefault(); worker.terminate(); resolve(true); };
      worker.onmessage = () => { worker.terminate(); resolve(false); };
    } catch { resolve(true); }
  });
  URL.revokeObjectURL(url);
  window.__probeResults = result;
});
document.body.append(button);
