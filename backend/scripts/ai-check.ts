import Anthropic from '@anthropic-ai/sdk';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { createAnthropicClient, proxyFromEnv, redactProxy } from '../src/brain/anthropic-client';
import { OpenAiClient, OpenAiError } from '../src/brain/openai-brain';
import { isLocal, PRESETS, resolveProvider } from '../src/brain/providers';

const ok = (m: string) => console.log(`  [OK]   ${m}`);
const bad = (m: string) => console.log(`  [FAIL] ${m}`);
const info = (m: string) => console.log(`         ${m}`);
const done = () => console.log('\nAll good. Restart the app (npm start) and the header badge will show the provider and model.\n');

async function checkClaude(apiKey: string, model: string, baseURL: string): Promise<number> {
  const proxy = proxyFromEnv();
  info(proxy ? `Using proxy ${redactProxy(proxy)}` : 'No proxy configured (set AI_PROXY in .env if your network needs one)');
  if (!apiKey.startsWith('sk-ant-')) {
    bad('ANTHROPIC_API_KEY does not look like a Claude API key (expected sk-ant-...)');
    return 1;
  }
  ok(`API key set (sk-ant-...${apiKey.slice(-4)})`);
  const client = createAnthropicClient({ apiKey, proxy, baseURL: baseURL || undefined, timeoutMs: 30000 });
  try {
    const started = Date.now();
    const r = await client.messages.create({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the word: ready' }] });
    const text = r.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('').trim();
    ok(`Reached Claude in ${Date.now() - started} ms. Reply: "${text}"`);
    done();
    return 0;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) bad('The API key was rejected (401). Copy it again from the Console');
    else if (e instanceof Anthropic.NotFoundError) bad(`Model "${model}" was not found (404). Set BRAIN_MODEL to a model your account can use`);
    else if (e instanceof Anthropic.RateLimitError) bad('Rate limited (429). The key works, try again in a minute');
    else if (e instanceof Anthropic.APIConnectionError) {
      bad('Could not connect to Claude');
      info('On a corporate network set AI_PROXY=http://host:port in .env; for SSL inspection set NODE_EXTRA_CA_CERTS');
    } else if (e instanceof Anthropic.APIError && /credit|billing/i.test(e.message)) {
      bad('Your key works, but the Claude account has no API credit');
      info('Add credit in console.anthropic.com > Plans & Billing, or switch to a free provider:');
      info('  AI_PROVIDER=groq   AI_API_KEY=<free key from https://console.groq.com/keys>');
    } else if (e instanceof Anthropic.APIError) bad(`Claude returned ${e.status}: ${e.message}`);
    else bad(`Unexpected error: ${(e as Error).message}`);
    console.log('');
    return 1;
  }
}

async function checkOpenAi(id: string, name: string, baseURL: string, apiKey: string, model: string, keyUrl: string): Promise<number> {
  const proxy = proxyFromEnv();
  const local = isLocal(baseURL);
  ok(`Endpoint ${baseURL}`);
  if (apiKey) ok(`API key set (...${apiKey.slice(-4)})`);
  if (!local) info(proxy ? `Using proxy ${redactProxy(proxy)}` : 'No proxy configured (set AI_PROXY in .env if your network needs one)');
  const client = new OpenAiClient({ provider: id, baseURL, apiKey, proxy, timeoutMs: 60000 });
  try {
    const models = await client.models();
    if (models.length) {
      if (models.includes(model)) ok(`Model ${model} is available`);
      else {
        bad(`Model "${model}" is not in your list of ${models.length} models`);
        info(`Set AI_MODEL in .env to one of: ${models.slice(0, 12).join(', ')}${models.length > 12 ? ', ...' : ''}`);
        return 1;
      }
    }
  } catch (e) {
    const err = e as OpenAiError;
    if (err.status === 0) {
      bad(`Could not connect to ${name}`);
      if (local) info('Start Ollama (open the Ollama app, or run "ollama serve") and try again');
      else info('Check the internet connection. On a corporate network set AI_PROXY=http://host:port in .env');
      info(`Detail: ${err.message}`);
      return 1;
    }
    if (err.status === 401 || err.status === 403) {
      bad(`${name} rejected the API key (${err.status})`);
      info(`Create a new free key at ${keyUrl} and set AI_API_KEY in .env`);
      return 1;
    }
    info(`Could not list models (${err.status}), testing the model directly`);
  }
  try {
    const started = Date.now();
    const r = await client.chat({ model, max_tokens: 200, messages: [{ role: 'user', content: 'Reply with the word: ready' }] });
    const text = (r.choices?.[0]?.message?.content ?? '').trim();
    ok(`Reached ${name} in ${Date.now() - started} ms. Reply: "${text.slice(0, 40)}"`);
    done();
    return 0;
  } catch (e) {
    const err = e as OpenAiError;
    if (err.status === 429) bad(`${name} free limit reached (429). The key works, try again in a minute`);
    else if (err.status === 404) bad(`Model "${model}" was not found (404). Set AI_MODEL in .env`);
    else if (err.status === 0) bad(`Could not connect to ${name}: ${err.message}`);
    else bad(`${name} returned ${err.status}: ${err.message}`);
    if (local && err.status === 404) info(`Download it first: ollama pull ${model}`);
    console.log('');
    return 1;
  }
}

async function main(): Promise<number> {
  console.log('\nAI connection check\n');
  const envFile = resolve('.env');
  if (!existsSync(envFile)) {
    bad(`No .env file in ${process.cwd()}`);
    info('Run: copy .env.example .env   (Windows)   or   cp .env.example .env');
    return 1;
  }
  loadEnv({ path: envFile });
  ok(`.env found at ${envFile}`);
  const r = resolveProvider(process.env);
  const id = (process.env.AI_PROVIDER ?? '').trim().toLowerCase() || 'claude';
  ok(`AI_PROVIDER=${id}`);
  if (r.kind === 'mock') {
    bad(r.problem ?? 'Offline mode');
    if (id === 'claude') {
      info('Option 1: add credit to Claude and set ANTHROPIC_API_KEY');
      info('Option 2 (free): set AI_PROVIDER=groq and AI_API_KEY=<key from https://console.groq.com/keys>');
    }
    return 1;
  }
  if (r.kind === 'claude') {
    ok(`Model ${r.model}`);
    return checkClaude(r.apiKey, r.model, r.baseURL);
  }
  const p = r.preset ?? PRESETS.openai;
  return checkOpenAi(p.id, p.name, r.baseURL, r.apiKey, r.model, p.keyUrl);
}

main().then(code => process.exit(code));
