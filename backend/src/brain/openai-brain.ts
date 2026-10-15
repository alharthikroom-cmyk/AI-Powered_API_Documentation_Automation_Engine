import { Logger } from '@nestjs/common';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { OpenApiDoc } from '../spec/openapi.types';
import { BrainError, DiscussRequest, GosiBrain, ProposeInput } from './brain.types';
import { PROPOSE_DESCRIPTION, PROPOSE_NAME, PROPOSE_SCHEMA } from './propose-tool';
import { isLocal } from './providers';

export interface OpenAiConnection {
  provider: string;
  baseURL: string;
  apiKey: string;
  proxy?: string;
  timeoutMs?: number;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ChatResponse {
  choices?: { message?: ChatMessage; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
}

export class OpenAiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class OpenAiClient {
  private readonly dispatcher?: ProxyAgent;

  constructor(readonly c: OpenAiConnection) {
    if (c.proxy && !isLocal(c.baseURL)) this.dispatcher = new ProxyAgent(c.proxy);
  }

  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.c.apiKey) headers.Authorization = `Bearer ${this.c.apiKey}`;
    if (this.c.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'http://localhost';
      headers['X-Title'] = 'API Documentation Engine';
    }
    let res;
    try {
      res = await undiciFetch(`${this.c.baseURL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(this.c.timeoutMs ?? 600000),
      } as never);
    } catch (e) {
      throw new OpenAiError(0, (e as Error & { cause?: Error }).cause?.message ?? (e as Error).message);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const err = (data as ChatResponse | null)?.error;
      const msg = typeof err === 'string' ? err : err?.message ?? (Array.isArray(data) ? (data as { error?: { message?: string } }[])[0]?.error?.message : undefined) ?? text.slice(0, 300);
      throw new OpenAiError(res.status, msg || `HTTP ${res.status}`);
    }
    return data as T;
  }

  chat(body: Record<string, unknown>): Promise<ChatResponse> {
    return this.request<ChatResponse>('POST', '/chat/completions', body);
  }

  async models(): Promise<string[]> {
    const r = await this.request<{ data?: { id: string }[] }>('GET', '/models');
    return (r?.data ?? []).map(m => String(m.id).replace(/^models\//, ''));
  }
}

export class OpenAiBrain extends GosiBrain {
  readonly mode = 'openai' as const;
  private readonly log = new Logger('AI');
  private readonly client: OpenAiClient;

  constructor(
    connection: OpenAiConnection,
    readonly model: string,
    private readonly providerName: string,
    private readonly maxTokens: number,
    private readonly chatMaxTokens: number,
  ) {
    super();
    this.client = new OpenAiClient(connection);
  }

  get label(): string {
    return `${this.providerName} · ${this.model}`;
  }

  async generate(proxy: string, _input: OpenApiDoc, prompt: string): Promise<string> {
    const started = Date.now();
    this.log.log(`generate start proxy=${proxy} provider=${this.providerName} model=${this.model} promptChars=${prompt.length}`);
    try {
      const r = await this.client.chat({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      });
      const choice = r.choices?.[0];
      this.log.log(
        `generate done proxy=${proxy} finish=${choice?.finish_reason} inTokens=${r.usage?.prompt_tokens ?? '?'} outTokens=${r.usage?.completion_tokens ?? '?'} elapsedMs=${Date.now() - started}`,
      );
      if (choice?.finish_reason === 'length') throw new BrainError('truncated', 'The AI stopped before finishing the file. Raise AI_MAX_TOKENS or lower SAMPLES_PER_OPERATION');
      const text = choice?.message?.content ?? '';
      if (!text.trim()) throw new BrainError('unparsable', 'The AI returned an empty reply');
      return text;
    } catch (e) {
      throw this.wrap(e, proxy, started);
    }
  }

  async discuss(req: DiscussRequest): Promise<string> {
    const started = Date.now();
    const messages: ChatMessage[] = [{ role: 'system', content: req.system }, ...req.messages.map(m => ({ role: m.role, content: m.content }))];
    const texts: string[] = [];
    const tools = [{ type: 'function', function: { name: PROPOSE_NAME, description: PROPOSE_DESCRIPTION, parameters: PROPOSE_SCHEMA } }];
    try {
      for (let round = 0; round < 6; round++) {
        const r = await this.client.chat({ model: this.model, max_tokens: this.chatMaxTokens, temperature: 0.2, tools, messages });
        const choice = r.choices?.[0];
        const msg = choice?.message;
        this.log.log(`discuss round=${round} proxy=${req.proxy} finish=${choice?.finish_reason} inTokens=${r.usage?.prompt_tokens ?? '?'} outTokens=${r.usage?.completion_tokens ?? '?'}`);
        if (msg?.content?.trim()) texts.push(msg.content.trim());
        const calls = msg?.tool_calls ?? [];
        if (!calls.length) break;
        messages.push({ role: 'assistant', content: msg?.content ?? null, tool_calls: calls });
        for (const c of calls) {
          let content: string;
          try {
            if (c.function?.name !== PROPOSE_NAME) throw new Error(`Unknown tool ${c.function?.name}`);
            content = JSON.stringify(req.propose(JSON.parse(c.function.arguments || '{}') as ProposeInput));
          } catch (err) {
            content = JSON.stringify({ error: (err as Error).message });
          }
          messages.push({ role: 'tool', tool_call_id: c.id, content });
        }
      }
      this.log.log(`discuss done proxy=${req.proxy} elapsedMs=${Date.now() - started}`);
      return texts.join('\n\n');
    } catch (e) {
      throw this.wrap(e, req.proxy, started);
    }
  }

  private wrap(e: unknown, proxy: string, started: number): BrainError {
    if (e instanceof BrainError) return e;
    const elapsed = Date.now() - started;
    if (e instanceof OpenAiError) {
      if (e.status === 0) {
        this.log.error(`connection failed proxy=${proxy} provider=${this.providerName} elapsedMs=${elapsed} detail=${e.message}`);
        return new BrainError('unreachable', `Cannot reach ${this.providerName}. Check the internet connection${this.providerName.startsWith('Ollama') ? ' or that Ollama is running' : ' or proxy settings'}`);
      }
      this.log.error(`provider error proxy=${proxy} provider=${this.providerName} status=${e.status} elapsedMs=${elapsed}`);
      if (e.status === 401 || e.status === 403) return new BrainError('not_configured', `${this.providerName} rejected the API key. Run "npm run ai:check" in the backend folder`);
      if (e.status === 404) return new BrainError('not_configured', `The model "${this.model}" was not found. Run "npm run ai:check" to see available models`);
      if (e.status === 429) return new BrainError('rate_limited', `${this.providerName} free limit reached. Wait a minute and try again`);
      if (e.status === 413 || /context|too large|too long|tokens/i.test(e.message)) {
        return new BrainError('upstream', `The request is too large for this free model. Lower SAMPLES_PER_OPERATION or AI_MAX_TOKENS in .env`);
      }
      return new BrainError('upstream', `${this.providerName} returned an error (${e.status})`);
    }
    this.log.error(`unexpected failure proxy=${proxy} elapsedMs=${elapsed}`, (e as Error)?.stack);
    return new BrainError('upstream', 'The AI request failed');
  }
}
