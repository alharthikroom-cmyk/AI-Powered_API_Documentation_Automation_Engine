import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { OpenApiDoc } from '../spec/openapi.types';
import { AiConnection, createAnthropicClient } from './anthropic-client';
import { BrainError, DiscussRequest, GosiBrain, ProposeInput } from './brain.types';
import { PROPOSE_DESCRIPTION, PROPOSE_NAME, PROPOSE_SCHEMA } from './propose-tool';

const PROPOSE_TOOL: Anthropic.Messages.Tool = { name: PROPOSE_NAME, description: PROPOSE_DESCRIPTION, input_schema: PROPOSE_SCHEMA };

export class ClaudeBrain extends GosiBrain {
  readonly mode = 'claude' as const;
  get label(): string {
    return this.model;
  }
  private readonly log = new Logger('GosiBrain');
  private readonly client: Anthropic;

  constructor(
    connection: AiConnection,
    readonly model: string,
    private readonly maxTokens: number,
    private readonly chatMaxTokens: number,
  ) {
    super();
    this.client = createAnthropicClient(connection);
  }

  async generate(proxy: string, _input: OpenApiDoc, prompt: string): Promise<string> {
    const started = Date.now();
    this.log.log(`generate start proxy=${proxy} model=${this.model} promptChars=${prompt.length}`);
    try {
      const msg = await this.client.messages
        .stream({ model: this.model, max_tokens: this.maxTokens, messages: [{ role: 'user', content: prompt }] })
        .finalMessage();
      this.log.log(
        `generate done proxy=${proxy} stop=${msg.stop_reason} inTokens=${msg.usage.input_tokens} outTokens=${msg.usage.output_tokens} elapsedMs=${Date.now() - started}`,
      );
      if (msg.stop_reason === 'max_tokens') throw new BrainError('truncated', 'The AI stopped before finishing the file');
      if (msg.stop_reason === 'refusal') throw new BrainError('refused', 'The AI declined this request');
      return msg.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
    } catch (e) {
      throw this.wrap(e, proxy, started);
    }
  }

  async discuss(req: DiscussRequest): Promise<string> {
    const started = Date.now();
    const messages: Anthropic.Messages.MessageParam[] = req.messages.map(m => ({ role: m.role, content: m.content }));
    const texts: string[] = [];
    try {
      for (let round = 0; round < 6; round++) {
        const msg = await this.client.messages.create({
          model: this.model,
          max_tokens: this.chatMaxTokens,
          system: req.system,
          tools: [PROPOSE_TOOL],
          messages,
        });
        this.log.log(
          `discuss round=${round} proxy=${req.proxy} stop=${msg.stop_reason} inTokens=${msg.usage.input_tokens} outTokens=${msg.usage.output_tokens}`,
        );
        for (const b of msg.content) if (b.type === 'text' && b.text.trim()) texts.push(b.text.trim());
        const calls = msg.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
        if (msg.stop_reason !== 'tool_use' || !calls.length) break;
        messages.push({ role: 'assistant', content: msg.content as Anthropic.Messages.ContentBlockParam[] });
        messages.push({
          role: 'user',
          content: calls.map(c => {
            try {
              const result = req.propose(c.input as ProposeInput);
              return { type: 'tool_result' as const, tool_use_id: c.id, content: JSON.stringify(result) };
            } catch (err) {
              return { type: 'tool_result' as const, tool_use_id: c.id, is_error: true, content: (err as Error).message };
            }
          }),
        });
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
    if (e instanceof Anthropic.RateLimitError) {
      this.log.warn(`rate limited proxy=${proxy} elapsedMs=${elapsed}`);
      return new BrainError('rate_limited', 'The AI is busy, try again shortly');
    }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      this.log.error(`authentication failed proxy=${proxy} status=${(e as InstanceType<typeof Anthropic.APIError>).status}`);
      return new BrainError('not_configured', 'The AI service rejected the API key. Run "npm run ai:check" in the backend folder');
    }
    if (e instanceof Anthropic.NotFoundError) {
      this.log.error(`model not found proxy=${proxy} model=${this.model}`);
      return new BrainError('not_configured', 'The configured AI model is not available. Run "npm run ai:check" in the backend folder');
    }
    if (e instanceof Anthropic.APIConnectionError) {
      this.log.error(`connection failed proxy=${proxy} elapsedMs=${elapsed}`, (e as Error)?.stack);
      return new BrainError('unreachable', 'Cannot reach the AI service. Check the internet connection or proxy settings');
    }
    if (e instanceof Anthropic.APIError && e.status === 400 && /credit|billing/i.test(e.message)) {
      this.log.error(`billing issue proxy=${proxy}`);
      return new BrainError('not_configured', 'The AI account has no available credit');
    }
    this.log.error(`upstream failure proxy=${proxy} elapsedMs=${elapsed}`, (e as Error)?.stack);
    return new BrainError('upstream', 'The AI request failed');
  }
}
