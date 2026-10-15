import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { proxyFromEnv, redactProxy } from './anthropic-client';
import { GosiBrain } from './brain.types';
import { ClaudeBrain } from './claude-brain';
import { OpenAiBrain } from './openai-brain';
import { isLocal, resolveProvider } from './providers';
import { MockBrain } from './mock-brain';

export const PROMPT_TEMPLATE = 'PROMPT_TEMPLATE';

@Module({
  providers: [
    {
      provide: GosiBrain,
      useFactory: (): GosiBrain => {
        const log = new Logger('AI');
        const env = process.env;
        const r = resolveProvider(env);
        const proxy = proxyFromEnv();
        if (r.kind === 'mock') {
          log.warn(`${r.problem}. Running offline: use step 4 free options, or run "npm run ai:check"`);
          return new MockBrain();
        }
        if (r.kind === 'claude') {
          log.log(`Provider Claude model=${r.model}${proxy ? ` proxy=${redactProxy(proxy)}` : ''}${r.baseURL ? ` baseURL=${r.baseURL}` : ''}`);
          return new ClaudeBrain(
            { apiKey: r.apiKey, proxy, baseURL: r.baseURL || undefined },
            r.model,
            Number(env.BRAIN_MAX_TOKENS ?? 32000),
            Number(env.BRAIN_CHAT_MAX_TOKENS ?? 4096),
          );
        }
        log.log(`Provider ${r.preset!.name} model=${r.model} baseURL=${r.baseURL}${proxy && !isLocal(r.baseURL) ? ` proxy=${redactProxy(proxy)}` : ''}`);
        return new OpenAiBrain(
          { provider: r.preset!.id, baseURL: r.baseURL, apiKey: r.apiKey, proxy },
          r.model,
          r.preset!.name,
          Number(env.AI_MAX_TOKENS ?? 8192),
          Number(env.BRAIN_CHAT_MAX_TOKENS ?? 4096),
        );
      },
    },
    {
      provide: PROMPT_TEMPLATE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): string => {
        const t = readFileSync(resolve(config.get<string>('PROMPT_FILE', './prompts/prompt-v0.6.md')), 'utf8');
        if (!t.includes('{{INPUT_SPEC}}')) throw new Error('Prompt file must contain the {{INPUT_SPEC}} placeholder');
        return t;
      },
    },
  ],
  exports: [GosiBrain, PROMPT_TEMPLATE],
})
export class BrainModule {}
