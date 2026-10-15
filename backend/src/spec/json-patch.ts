import { PatchOp } from './openapi.types';

export function pointer(p: string): string[] {
  if (p === '') return [];
  if (!p.startsWith('/')) throw new Error(`Path must start with "/": ${p}`);
  return p.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function getAt(doc: unknown, p: string): unknown {
  try {
    return pointer(p).reduce<any>((a, k) => (a == null ? undefined : a[k]), doc);
  } catch {
    return undefined;
  }
}

export function resolveRef(doc: unknown, ref: string): unknown {
  return ref.startsWith('#/') ? getAt(doc, ref.slice(1)) : undefined;
}

export function applyPatch<T>(doc: T, ops: PatchOp[]): T {
  const out = structuredClone(doc) as any;
  for (const op of ops) {
    const segs = pointer(op.path);
    if (!segs.length) throw new Error('Replacing the whole document is not allowed');
    const last = segs.pop()!;
    const parent = segs.reduce((a, k) => {
      if (a == null || typeof a !== 'object') throw new Error(`Path not found: ${op.path}`);
      return a[k];
    }, out);
    if (parent == null || typeof parent !== 'object') throw new Error(`Path not found: ${op.path}`);
    if (op.op === 'remove') {
      if (!(last in parent)) throw new Error(`Nothing to remove at ${op.path}`);
      Array.isArray(parent) ? parent.splice(Number(last), 1) : delete parent[last];
    } else if (op.op === 'replace') {
      if (!(last in parent)) throw new Error(`Nothing to replace at ${op.path} (use add)`);
      parent[last] = op.value;
    } else if (op.op === 'add') {
      if (Array.isArray(parent)) last === '-' ? parent.push(op.value) : parent.splice(Number(last), 0, op.value);
      else parent[last] = op.value;
    } else {
      throw new Error(`Unsupported op "${(op as PatchOp).op}". Use add, replace or remove`);
    }
  }
  return out;
}
