// One-shot codemod: add explicit .js extensions to relative imports so the
// codebase is valid Node ESM (required for Vercel's file-traced functions and
// for `node dist`). Resolves directory imports to /index.js.
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';

const ROOTS = ['src', 'api', 'scripts'];
const files = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (p.endsWith('.ts')) files.push(p);
  }
}
ROOTS.forEach((r) => existsSync(r) && walk(r));

const importRe = /(\bfrom\s+|\bimport\s+)(['"])(\.[^'"]*)(['"])/g;
let changed = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const out = src.replace(importRe, (m, kw, q1, spec, q2) => {
    if (spec.endsWith('.js') || spec.endsWith('.json')) return m;
    const abs = resolve(dirname(file), spec);
    let target;
    if (existsSync(abs + '.ts')) target = spec + '.js';
    else if (existsSync(join(abs, 'index.ts'))) target = spec.replace(/\/$/, '') + '/index.js';
    else target = spec + '.js'; // best effort
    return `${kw}${q1}${target}${q2}`;
  });
  if (out !== src) {
    writeFileSync(file, out);
    changed++;
  }
}
console.log(`Updated ${changed} of ${files.length} files`);
