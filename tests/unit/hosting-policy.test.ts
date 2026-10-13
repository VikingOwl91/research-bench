import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ANNOUNCER_HASH, DOCUMENT_HEADER_CSP, WORKER_CSP, documentDirectives, serializePolicy, headersForPath, parsePolicy, parsePolicies, effectiveSources, capabilityAllowed, validateDocumentPolicy, validateWorkerPolicy, validateSecurityHeaders, verifyAnnouncerSource, isImmutablePath, isWorkerPath } from '../../scripts/hosting-policy.mjs';
const bootstrap = 'window.app = true;';
const bootstrapHash = `sha256-${createHash('sha256').update(bootstrap).digest('base64')}`;
const meta = () => serializePolicy({ ...documentDirectives, 'script-src': ['self', bootstrapHash] });
const html = (policy = meta()) => `<html><head><meta charset="utf-8"/><meta http-equiv="content-security-policy" content="${policy}"><link rel="stylesheet" href="/_app/immutable/app.css"></head><body><script>${bootstrap}</script></body></html>`;

describe('effective CSP intersection', () => {
  it('accepts complementary HTTP+early hash-meta and a separate worker realm', () => {
    expect(validateDocumentPolicy(html(), DOCUMENT_HEADER_CSP).bootstrapHashes).toEqual([`'${bootstrapHash}'`]);
    expect(() => validateWorkerPolicy(WORKER_CSP)).not.toThrow();
  });
  it('uses all delivered HTTP policies and blocks a conflicting one', () => {
    expect(() => validateDocumentPolicy(html(), `${DOCUMENT_HEADER_CSP}, script-src 'none'`)).toThrow(/script-src-elem/);
    expect(() => validateDocumentPolicy(html(), `${DOCUMENT_HEADER_CSP}; script-src 'self'`)).toThrow(/script-src-elem/);
    expect(() => validateDocumentPolicy(html(), `${DOCUMENT_HEADER_CSP}, connect-src 'self'`)).toThrow(/connect-src/);
    expect(() => validateDocumentPolicy(html(), `${DOCUMENT_HEADER_CSP}, worker-src 'none'`)).toThrow(/worker-src/);
  });
  it('handles the worker fallback and missing-directive identity correctly', () => {
    expect(effectiveSources(parsePolicy("child-src 'none'; script-src 'self'"), 'worker-src')).toEqual(["'none'"]);
    expect(effectiveSources(parsePolicy("script-src 'self'"), 'worker-src')).toEqual(["'self'"]);
    expect(effectiveSources(parsePolicy("default-src 'none'"), 'worker-src')).toEqual(["'none'"]);
    expect(effectiveSources(parsePolicy("base-uri 'none'"), 'worker-src')).toBeNull();
    expect(capabilityAllowed(parsePolicies("base-uri 'none', worker-src 'self'"), 'worker-src', "'self'")).toBe(true);
  });
  it('matches self and exact approved origins semantically across policies', () => {
    const policies = parsePolicies("connect-src 'self', connect-src https://api.eu.mistral.ai");
    const options = { origin: 'https://api.eu.mistral.ai' };
    expect(capabilityAllowed(policies, 'connect-src', "'self'", options)).toBe(true);
    expect(capabilityAllowed(policies, 'connect-src', 'https://api.eu.mistral.ai/v1/chat/completions', options)).toBe(true);
    expect(capabilityAllowed(policies, 'connect-src', 'https://openrouter.ai/api/v1', options)).toBe(false);
    expect(capabilityAllowed(policies, 'connect-src', "'self'", { origin: 'https://researchbench.invalid' })).toBe(false);
    const actions = parsePolicies(`script-src 'self' '${bootstrapHash}' 'wasm-unsafe-eval', script-src https://api.eu.mistral.ai '${bootstrapHash}'`);
    expect(capabilityAllowed(actions, 'script-src-elem', "'self'", options)).toBe(true);
    expect(capabilityAllowed(actions, 'script-src-elem', `'${bootstrapHash}'`, options)).toBe(true);
    expect(capabilityAllowed(actions, 'script-src', "'wasm-unsafe-eval'", options)).toBe(false);
    expect(capabilityAllowed(actions, 'script-src-elem', `'sha256-${ANNOUNCER_HASH}'`, options)).toBe(false);
    expect(capabilityAllowed(parsePolicies("style-src-attr https://api.eu.mistral.ai"), 'style-src-attr', "'self'", options)).toBe(false);
  });
  it('handles elem/attr/connection fallback independently from compilation', () => {
    const policies = parsePolicies("script-src 'self' 'wasm-unsafe-eval'; default-src 'none'");
    expect(capabilityAllowed(policies, 'script-src-elem', "'self'")).toBe(true);
    expect(capabilityAllowed(policies, 'script-src', "'wasm-unsafe-eval'")).toBe(true);
    expect(capabilityAllowed(policies, 'connect-src', "'self'")).toBe(false);
    expect(() => validateWorkerPolicy(WORKER_CSP.replace(" 'wasm-unsafe-eval'", ''))).toThrow(/wasm/);
    expect(() => validateWorkerPolicy(`${WORKER_CSP}, script-src 'self'`)).toThrow(/wasm/);
    expect(() => validateDocumentPolicy(html(meta().replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'")), DOCUMENT_HEADER_CSP)).toThrow(/wasm/);
  });
  it('rejects unsupported, malformed, duplicate and broad source expressions', () => {
    for (const policy of ["script-src 'unsafe-inline'", "script-src\u00a0'self'", "script-src 'unsafe-eval'", 'script-src *', 'script-src https:', "script-src 'self'; script-src 'none'", "unknown-src 'none'", "img-src 'none' data:", "script-src 'sha256-broken'", "worker-src 'wasm-unsafe-eval'", "style-src-attr 'self' 'self'"]) expect(() => parsePolicy(policy)).toThrow();
  });
  it('rejects blob workers, remote scripts and broadened image/media capability', () => {
    expect(() => validateDocumentPolicy(html(meta().replace("worker-src 'self'", "worker-src 'self' blob:")), DOCUMENT_HEADER_CSP.replace("worker-src 'self'", "worker-src 'self' blob:"))).toThrow(/worker-src/);
    expect(() => validateDocumentPolicy(html(meta().replace("script-src 'self'", "script-src 'self' https://openrouter.ai")), DOCUMENT_HEADER_CSP)).toThrow(/script-src-elem/);
    expect(() => validateDocumentPolicy(html(meta().replace("img-src 'self' data:", "img-src 'self' data: blob:")), DOCUMENT_HEADER_CSP.replace("img-src 'self' data:", "img-src 'self' data: blob:"))).toThrow(/img-src/);
  });
  it('rejects frame ancestors from either header or meta-compatible capabilities', () => {
    const header = DOCUMENT_HEADER_CSP.replace("frame-ancestors 'none'", 'frame-ancestors https://openrouter.ai');
    expect(() => validateDocumentPolicy(html(), header)).toThrow(/frame-ancestors/);
    expect(() => validateSecurityHeaders(new Headers({ ...headersForPath('/'), 'Content-Security-Policy': header }), '/')).toThrow(/frame-ancestors/);
  });
  it('rejects missing announcer permission or unjustified hashes', () => {
    expect(() => validateDocumentPolicy(html(meta().replace("'unsafe-hashes' ", '')), DOCUMENT_HEADER_CSP)).toThrow(/style-src-attr/);
    expect(() => validateDocumentPolicy(html(meta().replace("script-src 'self'", `script-src 'self' 'sha256-${ANNOUNCER_HASH}'`)), DOCUMENT_HEADER_CSP)).toThrow(/Unjustified/);
  });
});

describe('CSP artifact and hosting boundaries', () => {
  it('requires meta immediately after charset and authenticates exact bootstrap bytes', () => {
    for (const source of [html().replace(/<meta http-equiv[^>]+>/, ''), html().replace('<meta http-equiv', '<link rel="preload" href="/foo"><meta http-equiv'), html().replace('<meta http-equiv', '<script>0</script><meta http-equiv'), html().replace(bootstrap, 'window.app = false;'), html().replace('<script>', '<script nonce="test">')]) expect(() => validateDocumentPolicy(source, DOCUMENT_HEADER_CSP)).toThrow();
  });
  it('rejects duplicate meta and unsupported external script URLs', () => {
    expect(() => validateDocumentPolicy(html().replace('<link', `<meta http-equiv="content-security-policy" content="${meta()}"><link`), DOCUMENT_HEADER_CSP)).toThrow();
    expect(() => validateDocumentPolicy(html().replace('<script>', '<script src="https://openrouter.ai/app.js">'), DOCUMENT_HEADER_CSP)).toThrow();
  });
  it('recognizes only actual worker entry points and versioned model caching', () => {
    expect(isWorkerPath('/_app/immutable/workers/pipeline.worker-aBc12.js')).toBe(true);
    expect(isWorkerPath('_app/immutable/workers/encoder.worker-abc.js')).toBe(true);
    expect(isWorkerPath('/_app/immutable/chunks/foo.js')).toBe(false);
    expect(isImmutablePath(`/models/${'a'.repeat(64)}/multilingual-e5-small/model.onnx`)).toBe(true);
    expect(isImmutablePath('/models/multilingual-e5-small/model.onnx')).toBe(false);
    expect(headersForPath('/runtime/ort.mjs')['Cache-Control']).toBe('no-cache');
  });
  it('requires HTTPS HSTS, frame defenses and prevents early HTTP preloads', () => {
    const headers = new Headers(headersForPath('/'));
    expect(() => validateSecurityHeaders(headers, '/')).not.toThrow();
    headers.delete('Strict-Transport-Security');
    expect(() => validateSecurityHeaders(headers, '/')).toThrow(/HSTS/);
    expect(() => validateSecurityHeaders(headers, '/', { https: false })).not.toThrow();
    headers.set('Link', '</app.js>; rel=preload');
    expect(() => validateSecurityHeaders(headers, '/', { https: false })).toThrow(/preloads/);
    headers.delete('Link'); headers.delete('X-Frame-Options');
    expect(() => validateSecurityHeaders(headers, '/', { https: false })).toThrow(/security header/);
  });
  it('pins the installed announcer and fails source drift', async () => {
    expect(() => verifyAnnouncerSource()).not.toThrow();
    const dir = await mkdtemp(join(tmpdir(), 'announcer-csp-'));
    try { const file = join(dir, 'root.svelte'); await writeFile(file, '<div id="svelte-announcer" style="display:none">'); expect(() => verifyAnnouncerSource(file)).toThrow(/changed/); }
    finally { await rm(dir, { recursive: true, force: true }); }
  });
});
