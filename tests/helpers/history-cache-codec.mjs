import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const root = new URL('../../artifacts/kub/src/lib/', import.meta.url);
export async function historyCacheCodecModules(transform = source => source) {
  const modules = new Map();
  async function load(path) {
    if (modules.has(path)) return modules.get(path);
    let source = await readFile(new URL(path, root), 'utf8');
    if (path === 'historyCache/codec.ts') source = transform(source);
    for (const match of source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
      const relative = new URL(match[1], new URL(path, root));
      const dep = await load(relative.href.slice(root.href.length));
      source = source.replace(match[0], `from ${JSON.stringify(dep)}`);
    }
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
    const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
    modules.set(path, url); return url;
  }
  return load('historyCache/codec.ts');
}
