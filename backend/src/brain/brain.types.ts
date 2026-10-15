import { OpenApiDoc } from '../spec/openapi.types';

export type BrainErrorCode = 'not_configured' | 'unreachable' | 'rate_limited' | 'truncated' | 'unparsable' | 'refused' | 'upstream';

export class BrainError extends Error {
  constructor(
    readonly code: BrainErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProposeInput {
  summary: string;
  operations: { op: string; path: string; value?: unknown }[];
}

export interface DiscussRequest {
  proxy: string;
  system: string;
  messages: ChatTurn[];
  propose: (input: ProposeInput) => Record<string, unknown>;
}

export abstract class GosiBrain {
  abstract readonly mode: 'claude' | 'openai' | 'mock';
  abstract readonly label: string;
  abstract readonly model: string;
  abstract generate(proxy: string, input: OpenApiDoc, prompt: string): Promise<string>;
  abstract discuss(req: DiscussRequest): Promise<string>;
}

export function parseSpecText(text: string): OpenApiDoc {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new BrainError('unparsable', 'The AI did not return a JSON object');
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    throw new BrainError('unparsable', 'The AI returned invalid JSON');
  }
}
