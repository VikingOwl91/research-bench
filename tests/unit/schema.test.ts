import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('strict-CSP validation', () => {
  it('proves the swallowed probe and its removal in independent fresh processes', () => {
    for (const jitless of [false, true]) {
      const program = [
        'let attempts=0;',
        'globalThis.Function=new Proxy(Function,{apply(){attempts++;throw new EvalError("Blocked")},construct(){attempts++;throw new EvalError("Blocked")}});',
        jitless ? 'const {z}=await import("./src/lib/schema.ts");' : 'const {z}=await import("zod");',
        'const schema=z.object({text:z.string()}).strict();',
        'console.log(JSON.stringify({attempts,valid:schema.safeParse({text:"fixture"}).success,invalid:schema.safeParse({text:42}).success}));'
      ].join('\n');
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ attempts: jitless ? 0 : 1, valid: true, invalid: false });
    }
  });
  it('keeps application Zod imports behind the interpreter initializer', async () => {
    const direct: string[] = [];
    async function walk(directory: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory() && entry.name !== 'wasm') await walk(path);
        else if (entry.isFile() && /\.(ts|svelte)$/.test(path) && /(?:from\s*['"]zod['"]|(?:import|require)\s*\(\s*['"]zod['"])/.test(await readFile(path, 'utf8'))) direct.push(path);
      }
    }
    await walk('src');
    expect(direct).toEqual([join('src', 'lib', 'schema.ts')]);
  });
  it('validates and rejects actual provider output without attempting Function compilation', async () => {
    vi.resetModules();
    const compile = vi.fn(() => { throw new EvalError('Compilation is blocked'); });
    vi.stubGlobal('Function', compile);
    try {
      const { z } = await import('../../src/lib/schema');
      expect(z.config().jitless).toBe(true);
      const { validateAnswer } = await import('../../src/lib/providers');
      const { validatePodcastScript } = await import('../../src/lib/podcast-providers');
      const citations = [{ id: 'C1', sourceId: 's', sourceName: 'Fixture', page: 1, start: 0, end: 4, text: 'Text' }];
      const answer = { title: 'Fixture', blocks: [{ heading: '', text: 'Text', citationIds: ['C1'] }] };
      expect(validateAnswer(answer, citations)).toEqual(answer);
      expect(() => validateAnswer({ ...answer, blocks: [] }, citations)).toThrow();
      expect(validatePodcastScript({ title: 'Fixture', language: 'en', turns: Array.from({ length: 4 }, (_, i) => ({ speaker: i % 2 ? 'B' : 'A', text: 'Text', citationIds: ['C1'] })) }, citations, 'en').turns).toHaveLength(4);
      expect(compile).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
