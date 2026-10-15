export interface ProviderPreset {
  id: string;
  name: string;
  baseURL: string;
  model: string;
  needsKey: boolean;
  keyUrl: string;
}

export const PRESETS: Record<string, ProviderPreset> = {
  groq: {
    id: 'groq',
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-flash-latest',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-oss-120b:free',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (local)',
    baseURL: 'http://localhost:11434/v1',
    model: 'gpt-oss:20b',
    needsKey: false,
    keyUrl: 'https://ollama.com/download',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI-compatible',
    baseURL: '',
    model: '',
    needsKey: false,
    keyUrl: '',
  },
};

export interface ResolvedProvider {
  kind: 'claude' | 'openai' | 'mock';
  preset: ProviderPreset | null;
  baseURL: string;
  model: string;
  apiKey: string;
  problem: string | null;
}

const clean = (v: string | undefined) => String(v ?? '').trim().replace(/^["']|["']$/g, '').trim();

export function resolveProvider(env: Record<string, string | undefined>): ResolvedProvider {
  const mode = clean(env.BRAIN_MODE).toLowerCase();
  const id = clean(env.AI_PROVIDER).toLowerCase() || 'claude';
  if (mode === 'mock') return { kind: 'mock', preset: null, baseURL: '', model: '', apiKey: '', problem: 'BRAIN_MODE=mock forces offline mode' };
  if (id === 'claude' || id === 'anthropic') {
    const key = clean(env.ANTHROPIC_API_KEY);
    const placeholder = /your-key|^changeme$/i.test(key);
    return {
      kind: key && !placeholder ? 'claude' : 'mock',
      preset: null,
      baseURL: clean(env.ANTHROPIC_BASE_URL),
      model: clean(env.BRAIN_MODEL) || 'claude-sonnet-5-5',
      apiKey: placeholder ? '' : key,
      problem: key && !placeholder ? null : 'ANTHROPIC_API_KEY is empty',
    };
  }
  const preset = PRESETS[id];
  if (!preset) {
    return { kind: 'mock', preset: null, baseURL: '', model: '', apiKey: '', problem: `Unknown AI_PROVIDER "${id}". Use claude, groq, gemini, openrouter, ollama or openai` };
  }
  const baseURL = (clean(env.AI_BASE_URL) || preset.baseURL).replace(/\/+$/, '');
  const model = clean(env.AI_MODEL) || preset.model;
  const apiKey = clean(env.AI_API_KEY);
  let problem: string | null = null;
  if (!baseURL) problem = 'AI_BASE_URL is required for AI_PROVIDER=openai';
  else if (!model) problem = 'AI_MODEL is required for AI_PROVIDER=openai';
  else if (preset.needsKey && !apiKey) problem = `AI_API_KEY is empty. Get a free key at ${preset.keyUrl}`;
  return { kind: problem ? 'mock' : 'openai', preset, baseURL, model, apiKey, problem };
}

export function isLocal(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
