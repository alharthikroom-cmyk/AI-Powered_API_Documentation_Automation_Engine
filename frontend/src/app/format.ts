import { OpenApiDoc } from './models';

export const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function highlightJson(value: unknown): string {
  const json = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return esc(json).replace(
    /(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(true|false|null)\b/g,
    (_m, s, colon, n, b) =>
      s ? (colon ? `<span class="k">${s}</span>${colon}` : `<span class="s">${s}</span>`) : `<span class="nu">${n ?? b}</span>`,
  );
}

export function chatHtml(text: string): string {
  return esc(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
}

export function short(v: unknown): string {
  if (v === undefined) return '–';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 180 ? s.slice(0, 180) + '…' : s;
}

export function resolveRef(doc: OpenApiDoc, ref: string): OpenApiDoc | undefined {
  if (!ref.startsWith('#/')) return undefined;
  return ref
    .slice(2)
    .split('/')
    .reduce<any>((o, k) => o?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], doc);
}

export interface SchemaRow {
  name: string;
  depth: number;
  required: boolean;
  type: string;
  description: string;
  example: string;
}

export function schemaRows(doc: OpenApiDoc, schema: OpenApiDoc | undefined): SchemaRow[] {
  const rows: SchemaRow[] = [];
  const walk = (sch: OpenApiDoc | undefined, name: string | null, req: boolean, depth: number, seen: string[]) => {
    if (!sch || depth > 7) return;
    let refName = '';
    if (sch['$ref']) {
      refName = String(sch['$ref']).split('/').pop()!;
      if (seen.includes(sch['$ref'])) {
        rows.push({ name: name ?? '', depth, required: req, type: refName, description: 'Recursive reference', example: '' });
        return;
      }
      seen = [...seen, sch['$ref']];
      sch = resolveRef(doc, sch['$ref']) ?? {};
    }
    const t = sch['type'] ? (Array.isArray(sch['type']) ? sch['type'].join(' | ') : sch['type']) : sch['properties'] ? 'object' : '';
    const itemType = sch['items']?.['$ref'] ? String(sch['items']['$ref']).split('/').pop() : sch['items']?.['type'] ?? '';
    const type =
      (t === 'array' ? `array<${itemType}>` : t) + (sch['format'] ? ` · ${sch['format']}` : '') + (sch['nullable'] ? ' · nullable' : '') + (refName ? ` · ${refName}` : '');
    const example = sch['example'] !== undefined ? JSON.stringify(sch['example']) : sch['enum'] ? `enum: ${sch['enum'].join(', ')}` : '';
    if (name !== null) rows.push({ name, depth, required: req, type, description: sch['description'] ?? '', example });
    const d = name !== null ? depth + 1 : depth;
    for (const [k, v] of Object.entries<OpenApiDoc>(sch['properties'] ?? {})) walk(v, k, (sch['required'] ?? []).includes(k), d, seen);
    if (sch['items']) {
      const it = sch['items']['$ref'] ? resolveRef(doc, sch['items']['$ref']) : sch['items'];
      if (it?.['properties']) walk(sch['items'], '[ ]', false, d, seen);
    }
  };
  walk(schema, null, false, 0, []);
  return rows;
}

export interface DocOperation {
  method: string;
  path: string;
  op: OpenApiDoc;
  params: OpenApiDoc[];
  bodySchemas: OpenApiDoc[];
  responses: { code: string; description: string; schema?: OpenApiDoc }[];
}

export function docOperations(doc: OpenApiDoc): DocOperation[] {
  const out: DocOperation[] = [];
  for (const [path, item] of Object.entries<OpenApiDoc>(doc['paths'] ?? {})) {
    for (const [method, op] of Object.entries<OpenApiDoc>(item ?? {})) {
      if (!METHODS.includes(method)) continue;
      const deref = (x: OpenApiDoc) => (x?.['$ref'] ? resolveRef(doc, x['$ref']) ?? {} : x);
      const params = [...(item['parameters'] ?? []), ...(op['parameters'] ?? [])].map(deref);
      const body = op['requestBody'] ? deref(op['requestBody']) : null;
      out.push({
        method,
        path,
        op,
        params,
        bodySchemas: body ? Object.values<OpenApiDoc>(body['content'] ?? {}).map(c => c['schema']) : [],
        responses: Object.entries<OpenApiDoc>(op['responses'] ?? {}).map(([code, r]) => {
          const rr = deref(r);
          return { code, description: rr['description'] ?? '', schema: Object.values<OpenApiDoc>(rr['content'] ?? {})[0]?.['schema'] };
        }),
      });
    }
  }
  return out;
}
