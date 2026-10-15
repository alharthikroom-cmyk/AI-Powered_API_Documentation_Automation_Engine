import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import { BrainError, ProposeInput } from '../src/brain/brain.types';
import { OpenAiBrain } from '../src/brain/openai-brain';
import { resolveProvider } from '../src/brain/providers';

const body = (req: IncomingMessage) => new Promise<any>(r => {
  let s = '';
  req.on('data', c => (s += c));
  req.on('end', () => r(s ? JSON.parse(s) : null));
});

describe('OpenAiBrain', () => {
  let server: Server;
  let base: string;
  const seen: any[] = [];
  let mode: 'ok' | '429' | '401' = 'ok';

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const b = await body(req);
      seen.push({ auth: req.headers.authorization, url: req.url, body: b });
      res.setHeader('Content-Type', 'application/json');
      if (mode !== 'ok') {
        res.statusCode = Number(mode);
        res.end(JSON.stringify({ error: { message: 'nope' } }));
        return;
      }
      if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
      const msgs = b.messages;
      const last = msgs[msgs.length - 1];
      if (!b.tools) return res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '```json\n{"openapi":"3.0.3"}\n```' } }] }));
      if (last.role === 'tool') {
        return res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: `Proposed. Result: ${last.content}` } }] }));
      }
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{ id: 'c1', type: 'function', function: { name: 'propose_changes', arguments: JSON.stringify({ summary: 'Shorter', operations: [{ op: 'replace', path: '/info/title', value: 'x' }] }) } }],
              },
            },
          ],
        }),
      );
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(() => new Promise<void>(r => server.close(() => r())));

  const brain = () => new OpenAiBrain({ provider: 'groq', baseURL: base, apiKey: 'gsk_test' }, 'test-model', 'Groq', 8192, 1024);

  it('generates and sends the key', async () => {
    mode = 'ok';
    expect(await brain().generate('p', {}, 'prompt')).toContain('"openapi"');
    expect(seen[seen.length - 1].auth).toBe('Bearer gsk_test');
    expect(seen[seen.length - 1].body.max_tokens).toBe(8192);
  });

  it('runs the propose_changes tool loop', async () => {
    mode = 'ok';
    const got: ProposeInput[] = [];
    const reply = await brain().discuss({
      proxy: 'p',
      system: 'sys',
      messages: [{ role: 'user', content: 'shorter please' }],
      propose: i => {
        got.push(i);
        return { status: 'shown_to_reviewer' };
      },
    });
    expect(got[0].summary).toBe('Shorter');
    expect(reply).toContain('shown_to_reviewer');
    const toolTurn = seen[seen.length - 1].body.messages;
    expect(toolTurn[0]).toEqual({ role: 'system', content: 'sys' });
    expect(toolTurn.find((m: any) => m.role === 'tool').tool_call_id).toBe('c1');
  });

  it('maps provider errors to clear messages', async () => {
    mode = '429';
    await expect(brain().generate('p', {}, 'x')).rejects.toMatchObject({ code: 'rate_limited' });
    mode = '401';
    await expect(brain().generate('p', {}, 'x')).rejects.toMatchObject({ code: 'not_configured' });
    const down = new OpenAiBrain({ provider: 'ollama', baseURL: 'http://127.0.0.1:9/v1', apiKey: '' }, 'm', 'Ollama (local)', 100, 100);
    const e = (await down.generate('p', {}, 'x').catch(x => x)) as BrainError;
    expect(e.code).toBe('unreachable');
    expect(e.message).toContain('Ollama is running');
  });
});

describe('resolveProvider', () => {
  it('picks presets, requires keys, and falls back to offline', () => {
    expect(resolveProvider({ AI_PROVIDER: 'groq', AI_API_KEY: 'gsk_1' })).toMatchObject({ kind: 'openai', baseURL: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' });
    expect(resolveProvider({ AI_PROVIDER: 'groq' })).toMatchObject({ kind: 'mock' });
    expect(resolveProvider({ AI_PROVIDER: 'ollama' })).toMatchObject({ kind: 'openai', apiKey: '' });
    expect(resolveProvider({ AI_PROVIDER: 'gemini', AI_API_KEY: 'k', AI_MODEL: 'gemini-x' }).model).toBe('gemini-x');
    expect(resolveProvider({ ANTHROPIC_API_KEY: 'sk-ant-1' })).toMatchObject({ kind: 'claude' });
    expect(resolveProvider({ AI_PROVIDER: 'groq', AI_API_KEY: 'k', BRAIN_MODE: 'mock' })).toMatchObject({ kind: 'mock' });
    expect(resolveProvider({ AI_PROVIDER: 'nope' }).problem).toContain('Unknown AI_PROVIDER');
  });
});
