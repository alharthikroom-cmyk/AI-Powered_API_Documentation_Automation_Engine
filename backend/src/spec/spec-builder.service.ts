import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApigeeFlow, ApigeeProxy, SplunkEvent } from '../sources/source.types';
import { maskDeep } from './masking';
import { BuildResult, OpenApiDoc, OperationSummary, ParsedFlow } from './openapi.types';

const singular = (s: string) => (s.endsWith('ies') ? s.slice(0, -3) + 'y' : s.endsWith('s') ? s.slice(0, -1) : s);
const camelSeg = (s: string) => s.replace(/[-_](\w)/g, (_, c: string) => c.toUpperCase());
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseFlow(flow: ApigeeFlow): ParsedFlow | null {
  const path = flow.condition.match(/MatchesPath\s+"([^"]+)"/)?.[1];
  const verb = flow.condition.match(/request\.verb\s*=\s*"(\w+)"/)?.[1];
  if (!path || !verb) return null;
  const segs = path.split('/').filter(Boolean);
  const params: string[] = [];
  const oa = segs.map((s, i) => {
    if (s !== '*') return s;
    const base = i > 0 ? camelSeg(singular(segs[i - 1])) : 'resource';
    let name = base + 'Id';
    let n = 2;
    while (params.includes(name)) name = base + 'Id' + n++;
    params.push(name);
    return `{${name}}`;
  });
  const rx = new RegExp('^/' + segs.map(s => (s === '*' ? '([^/]+)' : escapeRx(s))).join('/') + '/?$');
  return { name: flow.name, verb: verb.toLowerCase(), path: '/' + oa.join('/'), params, rx, wild: params.length };
}

@Injectable()
export class SpecBuilderService {
  private readonly maxSamples: number;

  constructor(config: ConfigService) {
    this.maxSamples = Number(config.get('SAMPLES_PER_OPERATION', 5));
  }

  build(proxy: ApigeeProxy, events: SplunkEvent[], mask: boolean): BuildResult {
    const flows = proxy.flows.map(parseFlow).filter((f): f is ParsedFlow => !!f);
    const order = [...flows].sort((a, b) => a.wild - b.wild);
    const byFlow = new Map<ParsedFlow, { e: SplunkEvent; values: Record<string, string> }[]>(flows.map(f => [f, []]));
    let unmatched = 0;

    for (const e of events) {
      const uri = (e.request?.uri ?? '').split('?')[0];
      const suffix = uri.startsWith(proxy.basePath) ? uri.slice(proxy.basePath.length) : uri;
      const verb = (e.request?.verb ?? '').toLowerCase();
      let hit: ParsedFlow | null = null;
      let m: RegExpMatchArray | null = null;
      for (const f of order) {
        if (f.verb === verb && (m = suffix.match(f.rx))) {
          hit = f;
          break;
        }
      }
      if (!hit || !m) {
        unmatched++;
        continue;
      }
      const match = m;
      byFlow.get(hit)!.push({ e, values: Object.fromEntries(hit.params.map((p, i) => [p, decodeURIComponent(match[i + 1])])) });
    }

    const spec: OpenApiDoc = {
      openapi: '3.0.3',
      info: { title: proxy.name, version: proxy.revision, description: '' },
      servers: [{ url: `https://${proxy.virtualHost}${proxy.basePath}` }],
      tags: [{ name: proxy.name }],
      paths: {},
    };
    const operations: OperationSummary[] = [];
    const mk = <T>(x: T): T => (mask ? (maskDeep(x) as T) : x);

    for (const f of flows) {
      const all = byFlow.get(f)!;
      const samples = all.slice(0, this.maxSamples);
      const codes = [...new Set(samples.map(s => String(s.e.response?.status)).filter(c => c && c !== 'undefined'))].sort();
      const op: OpenApiDoc = {
        tags: [proxy.name],
        operationId: lowerFirst(f.name),
        parameters: f.params.map(n => ({ name: n, in: 'path', required: true, schema: { type: 'string' } })),
        responses: codes.length
          ? Object.fromEntries(codes.map(c => [c, { description: '' }]))
          : { default: { description: '' } },
      };
      if (!op.parameters.length) delete op.parameters;
      if (samples.length) {
        if (f.params.length) op.path_examples_for_ai = mk(samples.map(s => s.values));
        const q = samples.map(s => s.e.request?.query).filter(x => x && Object.keys(x).length);
        if (q.length) op.query_parameters_examples_for_ai = mk(q);
        op.headers_parameters_examples_for_ai = mk(
          samples.map(s => ({ request: s.e.request?.headers ?? {}, response: s.e.response?.headers ?? {} })),
        );
        op.body_examples_for_ai = mk(
          samples.map(s => ({ status: s.e.response?.status, request: s.e.request?.body ?? null, response: s.e.response?.body ?? null })),
        );
      }
      spec.paths[f.path] = spec.paths[f.path] ?? {};
      spec.paths[f.path][f.verb] = op;
      operations.push({ method: f.verb, path: f.path, flow: f.name, samples: all.length, codes });
    }

    return { spec, operations, totalEvents: events.length, unmatched };
  }
}
