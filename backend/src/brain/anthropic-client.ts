import Anthropic from '@anthropic-ai/sdk';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

export interface AiConnection {
  apiKey: string;
  baseURL?: string;
  proxy?: string;
  timeoutMs?: number;
}

export function proxyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.AI_PROXY || env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || undefined;
}

export function redactProxy(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '***';
      u.password = '';
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    return 'invalid proxy URL';
  }
}

export function createAnthropicClient(c: AiConnection): Anthropic {
  const options: ConstructorParameters<typeof Anthropic>[0] = {
    apiKey: c.apiKey,
    baseURL: c.baseURL || undefined,
    timeout: c.timeoutMs ?? 600000,
    maxRetries: 2,
  };
  if (c.proxy) {
    const dispatcher = new ProxyAgent(c.proxy);
    options.fetch = ((url: string, init?: Record<string, unknown>) => undiciFetch(url, { ...(init ?? {}), dispatcher } as never)) as never;
  }
  return new Anthropic(options);
}
