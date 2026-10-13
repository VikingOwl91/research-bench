// Generic hosting contract: no environment addresses, credentials or operations.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const ANNOUNCER_HASH = 'S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo=';
export const PROVIDER_ORIGINS = ['https://api.eu.mistral.ai', 'https://openrouter.ai'];
export const documentDirectives = {
  'default-src': ['none'], 'script-src': ['self'], 'script-src-attr': ['none'],
  'style-src': ['self'], 'style-src-attr': ['unsafe-hashes', `sha256-${ANNOUNCER_HASH}`],
  'connect-src': ['self', ...PROVIDER_ORIGINS], 'worker-src': ['self'],
  'img-src': ['self', 'data:'], 'media-src': ['self', 'blob:'], 'font-src': ['self'],
  'frame-src': ['none'], 'object-src': ['none'], 'base-uri': ['none'], 'form-action': ['none']
};
export function serializePolicy(directives) {
  return Object.entries(directives).map(([name, sources]) => `${name} ${sources.map(source => /^(?:https:|data:|blob:)/.test(source) ? source : `'${source}'`).join(' ')}`).join('; ');
}
export const DOCUMENT_HEADER_CSP = serializePolicy({
  'frame-ancestors': ['none'], 'connect-src': documentDirectives['connect-src'],
  'worker-src': ['self'], 'img-src': ['self', 'data:'], 'media-src': ['self', 'blob:'],
  'font-src': ['self'], 'frame-src': ['none'], 'object-src': ['none'],
  'base-uri': ['none'], 'form-action': ['none']
});
export const WORKER_CSP = serializePolicy({
  'default-src': ['none'], 'script-src': ['self', 'wasm-unsafe-eval'],
  'connect-src': ['self'], 'worker-src': ['none'], 'object-src': ['none'], 'base-uri': ['none']
});
export function isWorkerPath(path) {
  return /^\/?_app\/immutable\/workers\/(?:pipeline|encoder)\.worker-[A-Za-z0-9_-]+\.js$/.test(path);
}
export function isImmutablePath(path) {
  return /^\/?(?:_app\/immutable\/|models\/[a-f0-9]{64}\/)/.test(path) || isSourceOfferPath(path);
}
export function isSourceOfferPath(path) {
  return /^\/?source\/researchbench-[a-f0-9]{40}\.(?:tar\.gz|license\.txt)$/.test(path);
}
export function headersForPath(path) {
  return {
    'Content-Security-Policy': isWorkerPath(path) ? WORKER_CSP : DOCUMENT_HEADER_CSP,
    'X-Frame-Options': 'DENY', 'Strict-Transport-Security': 'max-age=31536000',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Cache-Control': isImmutablePath(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(isSourceOfferPath(path) && path.endsWith('.tar.gz') ? { 'Content-Disposition': `attachment; filename="${path.split('/').at(-1)}"` } : {})
  };
}
/** @param {string | URL} [path] */
export function verifyAnnouncerSource(path = new URL('../node_modules/@sveltejs/kit/src/runtime/components/root.svelte', import.meta.url)) {
  const source = readFileSync(path, 'utf8');
  const style = source.match(/id="svelte-announcer"[\s\S]*?style="([^"]+)"/)?.[1];
  if (!style || createHash('sha256').update(style).digest('base64') !== ANNOUNCER_HASH) throw new Error('SvelteKit announcer style changed: review the CSP exception.');
}

const directives = new Set(['default-src', 'script-src', 'script-src-elem', 'script-src-attr', 'style-src', 'style-src-elem', 'style-src-attr', 'connect-src', 'worker-src', 'child-src', 'img-src', 'media-src', 'font-src', 'frame-src', 'frame-ancestors', 'object-src', 'base-uri', 'form-action']);
const validHash = value => /^'sha256-[A-Za-z0-9+/]{43}='$/.test(value);
export function parsePolicy(value) {
  if (typeof value !== 'string' || !value.trim() || /[^\x20-\x7E\t]|[,<>]/.test(value)) throw new Error('Missing or malformed CSP.');
  const policy = new Map();
  for (const part of value.split(';')) {
    if (!part.trim()) continue;
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!directives.has(name) || policy.has(name)) throw new Error('Unsupported or duplicate CSP directive.');
    if (new Set(sources).size !== sources.length || (sources.includes("'none'") && sources.length !== 1)) throw new Error('Duplicate or mixed CSP sources.');
    for (const source of sources) {
      if (!["'none'", "'self'", "'unsafe-hashes'", "'wasm-unsafe-eval'", 'data:', 'blob:', ...PROVIDER_ORIGINS].includes(source) && !validHash(source)) throw new Error('Unsupported CSP source.');
      if (source === "'wasm-unsafe-eval'" && name !== 'script-src') throw new Error('Invalid WASM permission placement.');
      if ((source === "'unsafe-hashes'" || validHash(source)) && !['script-src', 'script-src-elem', 'style-src', 'style-src-attr'].includes(name)) throw new Error('Invalid hash permission placement.');
    }
    policy.set(name, sources);
  }
  if (!policy.size) throw new Error('Empty CSP.');
  return policy;
}
export function parsePolicies(value) {
  if (!value) throw new Error('Missing CSP header.');
  return value.split(',').map(parsePolicy);
}
const fallbacks = {
  'script-src-elem': ['script-src-elem', 'script-src', 'default-src'],
  'script-src-attr': ['script-src-attr', 'script-src', 'default-src'],
  'script-src': ['script-src', 'default-src'],
  'style-src-elem': ['style-src-elem', 'style-src', 'default-src'],
  'style-src-attr': ['style-src-attr', 'style-src', 'default-src'],
  'worker-src': ['worker-src', 'child-src', 'script-src', 'default-src'],
  'frame-src': ['frame-src', 'child-src', 'default-src']
};
export function effectiveSources(policy, directive) {
  const candidates = fallbacks[directive] ?? (['base-uri', 'form-action', 'frame-ancestors'].includes(directive) ? [directive] : [directive, 'default-src']);
  for (const candidate of candidates) if (policy.has(candidate)) return policy.get(candidate);
  return null; // Absent directive and fallback is unrestricted in this one policy.
}
export const BUILD_POLICY_ORIGIN = 'https://researchbench.invalid';
/** @param {{ origin?: string }} [options] */
export function capabilityAllowed(policies, directive, source, { origin = BUILD_POLICY_ORIGIN } = {}) {
  const protectedURL = new URL(origin);
  if (!['https:', 'http:'].includes(protectedURL.protocol) || protectedURL.username || protectedURL.password || protectedURL.pathname !== '/' || protectedURL.search || protectedURL.hash) throw new Error('Protected CSP origin must be an HTTP(S) origin.');
  const protectedOrigin = protectedURL.origin;
  // Hashes and evaluation keywords authorize actions, never a request URL.
  const permission = validHash(source) || source === "'wasm-unsafe-eval'" || source === "'unsafe-hashes'";
  const attributeAction = ['script-src-attr', 'style-src-attr'].includes(directive);
  const requestedOrigin = source === "'self'" ? protectedOrigin : /^https?:\/\//.test(source) ? new URL(source).origin : null;
  return policies.every(policy => {
    const sources = effectiveSources(policy, directive);
    if (sources === null) return true;
    if (directive === 'style-src-attr' && validHash(source) && !sources.includes("'unsafe-hashes'")) return false;
    if (permission) return sources.includes(source);
    // Host source expressions cannot authorize inline attribute execution.
    if (attributeAction) return false;
    if (requestedOrigin !== null) return sources.some(expression => expression === "'self'" ? requestedOrigin === protectedOrigin : /^https?:\/\//.test(expression) && new URL(expression).origin === requestedOrigin);
    // The bounded contract supports only exact data:/blob: scheme permissions.
    return ['data:', 'blob:'].includes(source) && sources.includes(source);
  });
}
function requireCapability(policies, directive, source, allowed, options) {
  if (capabilityAllowed(policies, directive, source, options) !== allowed) throw new Error(`Effective CSP capability mismatch: ${directive} ${source}.`);
}
function validateEffective(policies, realm, hashes = [], options = {}) {
  const protectedOrigin = new URL(options.origin ?? BUILD_POLICY_ORIGIN).origin;
  const require = (directive, source, allowed) => requireCapability(policies, directive, source, allowed, options);
  const worker = realm === 'worker';
  if (worker && !policies.some(policy => policy.get('default-src')?.join(' ') === "'none'")) throw new Error('Worker default-src must deny by default.');
  for (const directive of ['script-src-elem', 'style-src-elem', 'font-src']) require(directive, "'self'", !worker || directive === 'script-src-elem');
  require('connect-src', "'self'", true);
  if (worker) require('script-src', "'self'", true);
  for (const providerOrigin of PROVIDER_ORIGINS) require('connect-src', providerOrigin, !worker || providerOrigin === protectedOrigin);
  require('worker-src', "'self'", !worker);
  require('script-src', "'wasm-unsafe-eval'", worker);
  for (const directive of ['script-src-elem', 'script-src-attr', 'worker-src', 'connect-src', 'style-src-elem', 'style-src-attr', 'img-src', 'media-src', 'font-src', 'frame-src', 'object-src', 'base-uri', 'form-action']) {
    if (worker && ['script-src-attr', 'form-action'].includes(directive)) continue;
    for (const source of ['data:', 'blob:', ...PROVIDER_ORIGINS]) {
      const sameOrigin = source === protectedOrigin;
      const selfAllowed = worker ? ['script-src-elem', 'connect-src'].includes(directive) : ['script-src-elem', 'worker-src', 'connect-src', 'style-src-elem', 'img-src', 'media-src', 'font-src'].includes(directive);
      const allowed = (sameOrigin && selfAllowed) || !worker && ((directive === 'img-src' && source === 'data:') || (directive === 'media-src' && source === 'blob:') || (directive === 'connect-src' && PROVIDER_ORIGINS.includes(source)));
      require(directive, source, allowed);
    }
  }
  for (const directive of [...(worker ? [] : ['script-src-attr']), 'frame-src', 'object-src', 'base-uri']) require(directive, "'self'", false);
  if (!worker) {
    require('form-action', "'self'", false);
    for (const source of ["'self'", 'data:', 'blob:', ...PROVIDER_ORIGINS]) require('frame-ancestors', source, false);
    require('img-src', "'self'", true);
    require('media-src', "'self'", true);
    require('style-src-attr', `'sha256-${ANNOUNCER_HASH}'`, true);
    for (const hash of hashes) require('script-src-elem', hash, true);
  }
  // Reject hash exceptions not justified by this artifact/announcer, even if another policy masks them.
  for (const policy of policies) for (const [name, sources] of policy) for (const source of sources) {
    if (validHash(source) && !((['script-src', 'script-src-elem'].includes(name) && hashes.includes(source)) || (name === 'style-src-attr' && source === `'sha256-${ANNOUNCER_HASH}'`))) throw new Error('Unjustified CSP hash exception.');
    if (source === "'unsafe-hashes'" && name !== 'style-src-attr') throw new Error('Unjustified CSP unsafe-hashes exception.');
  }
}
const decodeAttribute = text => text.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
function attributes(tag) {
  const values = new Map();
  for (const match of tag.matchAll(/([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const name = match[1].toLowerCase();
    if (values.has(name)) throw new Error('Duplicate HTML attribute.');
    values.set(name, decodeAttribute(match[2] ?? match[3]));
  }
  return values;
}
/** @param {{ origin?: string }} [options] */
export function validateDocumentPolicy(html, header, options = {}) {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1];
  if (!head) throw new Error('Missing HTML head.');
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].filter(match => attributes(match[0]).get('http-equiv')?.toLowerCase() === 'content-security-policy');
  if (metas.length !== 1) throw new Error('Exactly one early CSP meta is required.');
  const meta = metas[0];
  if (!/^\s*<meta\s+charset=(?:"utf-8"|'utf-8')\s*\/?>\s*$/i.test(head.slice(0, meta.index))) throw new Error('CSP meta must immediately follow charset, before resources or active content.');
  const content = attributes(meta[0]).get('content');
  const metaPolicy = parsePolicy(content);
  if (metaPolicy.get('default-src')?.join(' ') !== "'none'") throw new Error('Document default-src must deny by default.');
  const hashes = [];
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bon\w+\s*=|\bnonce\s*=/i.test(script[1])) throw new Error('Unapproved script attributes.');
    const attrs = attributes(`<script ${script[1]}>`);
    if (attrs.has('src')) {
      if (!/^\/?_app\//.test(attrs.get('src'))) throw new Error('Unapproved script URL.');
    } else hashes.push(`'sha256-${createHash('sha256').update(script[2]).digest('base64')}'`);
  }
  if (!hashes.length) throw new Error('Missing SvelteKit bootstrap.');
  validateEffective([...parsePolicies(header), metaPolicy], 'document', hashes, options);
  return { bootstrapHashes: hashes, metaPolicy: content };
}
/** @param {{ origin?: string }} [options] */
export function validateWorkerPolicy(header, options = {}) { validateEffective(parsePolicies(header), 'worker', [], options); }
/** @param {{ https?: boolean, origin?: string }} [options] */
export function validateSecurityHeaders(headers, path, { https = true, origin = BUILD_POLICY_ORIGIN } = {}) {
  const normalized = headers instanceof Headers ? headers : new Headers(headers);
  const get = name => normalized.get(name);
  if (get('x-content-type-options') !== 'nosniff' || get('referrer-policy') !== 'no-referrer' || get('x-frame-options') !== 'DENY') throw new Error('Missing security header.');
  if (https && get('strict-transport-security') !== 'max-age=31536000') throw new Error('HSTS differs from contract.');
  const value = get('content-security-policy');
  if (isWorkerPath(path)) validateWorkerPolicy(value, { origin });
  else {
    const policies = parsePolicies(value);
    for (const directive of ['frame-ancestors', 'frame-src', 'object-src', 'base-uri', 'form-action']) for (const source of ["'self'", 'data:', 'blob:', ...PROVIDER_ORIGINS]) requireCapability(policies, directive, source, false, { origin });
  }
  if (get('link')) throw new Error('HTTP Link preloads precede document CSP.');
}
