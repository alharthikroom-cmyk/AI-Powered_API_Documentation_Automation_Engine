import { Injectable } from '@nestjs/common';
import { resolveRef } from './json-patch';
import { Check, HTTP_METHODS, OpenApiDoc } from './openapi.types';

function walk(o: unknown, fn: (k: string, v: unknown) => void): void {
  if (Array.isArray(o)) o.forEach(x => walk(x, fn));
  else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      fn(k, v);
      walk(v, fn);
    }
  }
}

function operations(doc: OpenApiDoc): { key: string; op: OpenApiDoc }[] {
  const out: { key: string; op: OpenApiDoc }[] = [];
  for (const [p, item] of Object.entries<OpenApiDoc>(doc.paths ?? {})) {
    for (const [m, op] of Object.entries<OpenApiDoc>(item ?? {})) {
      if ((HTTP_METHODS as readonly string[]).includes(m)) out.push({ key: `${m.toUpperCase()} ${p}`, op });
    }
  }
  return out;
}

@Injectable()
export class ValidatorService {
  validate(out: unknown, input: OpenApiDoc): Check[] {
    const r: Check[] = [];
    const add = (ok: boolean, label: string, detail = '') => r.push({ ok, label, detail });

    if (!out || typeof out !== 'object' || Array.isArray(out)) {
      add(false, 'Valid JSON object', 'The response could not be parsed as an OpenAPI object');
      return r;
    }
    const doc = out as OpenApiDoc;
    add(true, 'Valid JSON object');

    const left = new Set<string>();
    walk(doc, k => {
      if (k.endsWith('_for_ai')) left.add(k);
    });
    add(!left.size, 'All hint fields removed', left.size ? `Still present: ${[...left].join(', ')}` : '');

    const opsIn = operations(input).map(o => o.key);
    const opsOut = operations(doc);
    const keysOut = opsOut.map(o => o.key);
    const missing = opsIn.filter(o => !keysOut.includes(o));
    const extra = keysOut.filter(o => !opsIn.includes(o));
    add(
      !missing.length && !extra.length,
      'Paths and methods unchanged',
      [missing.length ? `Missing: ${missing.join(', ')}` : '', extra.length ? `Added: ${extra.join(', ')}` : ''].filter(Boolean).join(' · '),
    );

    const metaOk =
      doc.openapi === input.openapi &&
      doc.info?.title === input.info?.title &&
      doc.info?.version === input.info?.version &&
      JSON.stringify(doc.servers) === JSON.stringify(input.servers);
    add(metaOk, 'Title, version, servers and openapi kept', metaOk ? '' : 'One of these values was changed');

    add(!!String(doc.info?.description ?? '').trim(), 'info.description written');

    const tags: OpenApiDoc[] = Array.isArray(doc.tags) ? doc.tags : [];
    const noDesc = tags.filter(t => !String(t.description ?? '').trim()).map(t => t.name);
    add(tags.length > 0 && !noDesc.length, 'Every tag has a description', noDesc.length ? `Missing on: ${noDesc.join(', ')}` : '');

    const ids: string[] = [];
    const noId: string[] = [];
    const noOpDesc: string[] = [];
    for (const { key, op } of opsOut) {
      if (op.operationId) ids.push(op.operationId);
      else noId.push(key);
      if (!String(op.description ?? '').trim()) noOpDesc.push(key);
    }
    const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
    const bad = ids.filter(x => !/^[A-Za-z][A-Za-z0-9]*$/.test(x));
    add(
      !noId.length && !dup.length && !bad.length,
      'Unique, well-formed operationId on every operation',
      [noId.length ? `Missing: ${noId.join(', ')}` : '', dup.length ? `Duplicated: ${dup.join(', ')}` : '', bad.length ? `Invalid: ${bad.join(', ')}` : '']
        .filter(Boolean)
        .join(' · '),
    );
    add(!noOpDesc.length, 'Every operation has a description', noOpDesc.length ? `Missing on: ${noOpDesc.join(', ')}` : '');

    const unresolved = new Set<string>();
    walk(doc, (k, v) => {
      if (k === '$ref' && typeof v === 'string' && resolveRef(doc, v) === undefined) unresolved.add(v);
    });
    add(!unresolved.size, 'Every $ref resolves', unresolved.size ? `Unresolved: ${[...unresolved].join(', ')}` : '');

    return r;
  }
}
