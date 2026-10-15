import { Logger } from '@nestjs/common';
import { HINT_FIELDS, HTTP_METHODS, OpenApiDoc } from '../spec/openapi.types';
import { DiscussRequest, GosiBrain } from './brain.types';

const EXCLUDED_HEADERS = /^(host|connection|content-length|content-type|transfer-encoding|accept|accept-encoding|user-agent|authorization|x-apikey|x-forwarded-.*|via)$/i;

const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase();
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function formatOf(v: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date';
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return 'date-time';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return 'uuid';
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return 'email';
  return undefined;
}

function infer(values: unknown[], name: string): OpenApiDoc {
  const present = values.filter(v => v !== undefined);
  const nonNull = present.filter(v => v !== null);
  const s: OpenApiDoc = {};
  if (!nonNull.length) return { type: 'string', nullable: true, description: `${sentence(words(name))}.` };
  if (nonNull.every(Array.isArray)) {
    s.type = 'array';
    s.items = infer((nonNull as unknown[][]).flat(), name.replace(/s$/, ''));
  } else if (nonNull.every(v => typeof v === 'object')) {
    const objs = nonNull as Record<string, unknown>[];
    const keys = [...new Set(objs.flatMap(o => Object.keys(o)))];
    s.type = 'object';
    s.properties = Object.fromEntries(keys.map(k => [k, infer(objs.map(o => o[k]), k)]));
    const req = keys.filter(k => objs.every(o => k in o));
    if (req.length) s.required = req;
  } else if (nonNull.every(v => typeof v === 'number')) {
    s.type = nonNull.every(v => Number.isInteger(v)) ? 'integer' : 'number';
    s.example = nonNull[0];
  } else if (nonNull.every(v => typeof v === 'boolean')) {
    s.type = 'boolean';
    s.example = nonNull[0];
  } else {
    s.type = 'string';
    const f = formatOf(String(nonNull[0]));
    if (f) s.format = f;
    s.example = String(nonNull[0]);
  }
  if (nonNull.length < present.length) s.nullable = true;
  s.description = `${sentence(words(name))}.`;
  return s;
}

export class MockBrain extends GosiBrain {
  readonly mode = 'mock' as const;
  readonly model = 'offline-mock';
  readonly label = 'offline mock';
  private readonly log = new Logger('GosiBrain');

  async generate(proxy: string, input: OpenApiDoc): Promise<string> {
    this.log.log(`mock generate proxy=${proxy}`);
    const out: OpenApiDoc = structuredClone(input);
    const tagNames: string[] = (out.tags ?? []).map((t: OpenApiDoc) => t.name);
    out.info.description = `Offline draft of the ${out.info.title} API, covering ${Object.keys(out.paths).length} resource path(s). Generated without the AI for local testing.`;
    out.tags = tagNames.map(n => ({ name: n, description: `Operations of the ${n} API.` }));

    for (const [path, item] of Object.entries<OpenApiDoc>(out.paths)) {
      for (const [m, op] of Object.entries<OpenApiDoc>(item)) {
        if (!(HTTP_METHODS as readonly string[]).includes(m)) continue;
        const bodies: { status: number; request: unknown; response: unknown }[] = op.body_examples_for_ai ?? [];
        const query: Record<string, string>[] = op.query_parameters_examples_for_ai ?? [];
        const paths: Record<string, string>[] = op.path_examples_for_ai ?? [];
        const headers: { request: Record<string, string> }[] = op.headers_parameters_examples_for_ai ?? [];

        for (const p of op.parameters ?? []) {
          const ex = paths.find(x => x[p.name] !== undefined)?.[p.name];
          p.description = `${sentence(words(p.name))} in the request path.`;
          if (ex !== undefined) p.example = ex;
        }
        const qKeys = [...new Set(query.flatMap(q => Object.keys(q)))];
        const hKeys = [...new Set(headers.flatMap(h => Object.keys(h.request ?? {})))].filter(h => !EXCLUDED_HEADERS.test(h));
        op.parameters = [
          ...(op.parameters ?? []),
          ...qKeys.map(k => ({ name: k, in: 'query', required: false, description: `${sentence(words(k))} filter.`, schema: { type: 'string', example: query.find(q => q[k] !== undefined)![k] } })),
          ...hKeys.map(k => ({ name: k, in: 'header', required: headers.every(h => h.request?.[k] !== undefined), description: `${k} request header.`, schema: { type: 'string', example: headers.find(h => h.request?.[k])!.request[k] } })),
        ];
        if (!op.parameters.length) delete op.parameters;

        const reqBodies = bodies.map(b => b.request).filter(b => b !== null && b !== undefined);
        if (reqBodies.length) op.requestBody = { required: true, description: 'Request payload.', content: { 'application/json': { schema: infer(reqBodies, 'request') } } };

        for (const [code, resp] of Object.entries<OpenApiDoc>(op.responses)) {
          const rs = bodies.filter(b => String(b.status) === code).map(b => b.response).filter(b => b !== null && b !== undefined);
          resp.description = resp.description || (code.startsWith('2') ? 'Successful response.' : `Response with status ${code}.`);
          if (rs.length) resp.content = { 'application/json': { schema: infer(rs, 'response') } };
        }

        const summary = sentence(words(op.operationId ?? `${m} ${path}`));
        op.summary = summary;
        op.description = `${summary}. Responds with ${Object.keys(op.responses).join(', ')}.`;
        for (const h of HINT_FIELDS) delete op[h];
      }
    }
    return JSON.stringify(out, null, 2);
  }

  async discuss(req: DiscussRequest): Promise<string> {
    this.log.log(`mock discuss proxy=${req.proxy}`);
    return 'The AI is offline, so it cannot discuss the spec. To enable the discussion for free, set AI_PROVIDER=groq (or gemini, ollama) and AI_API_KEY in backend/.env, then run "npm run ai:check". See the README section "Free AI providers".';
  }
}
