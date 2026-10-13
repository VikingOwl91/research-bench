// Isolated loopback rehearsal of the generic static hosting contract.
// Production server configuration and credentials do not belong in this file.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath, readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headersForPath } from './hosting-policy.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.md': 'text/plain' };

/** @param {{directory?: string, port?: number, headers?: (path: string) => Record<string,string>, transform?: (path: string, bytes: Buffer) => Buffer | undefined | Promise<Buffer | undefined>, transformPath?: (path: string) => boolean, extraFiles?: Map<string,string>, onRequest?: (path: string, method: string) => void}} [options] */
export async function serveBuild({ directory = 'build', port = 4173, headers = headersForPath, transform, transformPath = () => true, extraFiles = new Map(), onRequest } = {}) {
  const root = await realpath(resolve(directory));
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      onRequest?.(pathname, request.method ?? '');
      const parts = pathname.split('/').filter(Boolean);
      const invalid = parts.some(part => part.startsWith('.') || part.includes('\\'));
      let file = resolve(root, ...parts);
      let filePath = parts.join('/');
      let info;
      if (!invalid && extraFiles.has(pathname)) { file = await realpath(extraFiles.get(pathname)); filePath = pathname.slice(1); info = await stat(file); }
      if (!invalid && (file === root || file.startsWith(root + sep))) {
        try { info = await stat(file); if (!info.isFile() || await realpath(file) !== file) info = undefined; } catch {}
      }
      if (!info && !invalid && !extname(pathname) && !/^\/(?:_app|models|runtime|pdfium|notices)(?:\/|$)/.test(pathname)) {
        file = resolve(root, 'index.html'); filePath = 'index.html'; info = await stat(file);
      }
      const safeHeaders = headers(info ? filePath : pathname);
      if (!info || !['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(info ? 405 : 404, { ...safeHeaders, 'content-type': 'text/plain', 'cache-control': 'no-cache' });
        response.end(request.method === 'HEAD' ? undefined : 'Not found'); return;
      }
      const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
      const transformed = transform && transformPath(filePath) ? await transform(filePath, await readFile(file)) : undefined;
      const contentLength = transformed?.byteLength ?? info.size;
      const resultHeaders = { ...safeHeaders, 'content-type': types[extname(filePath)] ?? 'application/octet-stream', 'content-length': contentLength, etag };
      if (request.headers['if-none-match'] === etag && !transformed) {
        response.writeHead(304, resultHeaders); response.end(); return;
      }
      response.writeHead(200, resultHeaders);
      if (request.method === 'HEAD') response.end();
      else if (transformed) response.end(transformed);
      else createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch { response.writeHead(400, { 'content-type': 'text/plain' }); response.end('Invalid request'); }
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}`, close: () => new Promise((accept, reject) => { server.close(error => error ? reject(error) : accept()); server.closeIdleConnections(); }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory = 'build', value = '4173'] = process.argv.slice(2);
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw new Error('Choose an unprivileged loopback port.');
  const instance = await serveBuild({ directory, port: Number(value) });
  console.log(`Isolated build rehearsal: ${instance.origin}`);
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await instance.close(); process.exit(0); });
}
