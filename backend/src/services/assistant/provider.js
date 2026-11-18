/**
 * LLM provider interface:  provider.complete({ system, user, history, maxTokens }) -> string
 * Swap providers by calling setProvider() (used by tests) or adding another class here.
 */
import Anthropic from '@anthropic-ai/sdk';

export const ASSISTANT_TIMEOUT_MS = 8000;
export const DEFAULT_MODEL = 'claude-opus-5-5';

export class AnthropicProvider {
  name = 'anthropic';
  constructor({ apiKey, model }) {
    this.model = model;
    this.client = new Anthropic({ apiKey });
  }
  async complete({ system, user, history = [], maxTokens = 700 }) {
    const res = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: maxTokens,
        system,
        output_config: { effort: 'low' }, // short factual answers; keeps latency inside the 8s budget
        messages: [...history, { role: 'user', content: user }],
      },
      { timeout: ASSISTANT_TIMEOUT_MS, maxRetries: 0 },
    );
    if (res.stop_reason === 'refusal') throw new Error('model declined');
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!text) throw new Error('empty response');
    return text;
  }
}

let override = null;
let cached = null;
/** Returns the active provider, or null when none is configured (=> Basic mode). */
export function getProvider() {
  if (override !== undefined && override !== null) return override;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.ASSISTANT_MODEL || DEFAULT_MODEL;
  if (!cached || cached.model !== model) cached = new AnthropicProvider({ apiKey: key, model });
  return cached;
}
/** Test hook: setProvider(mock) forces a provider; setProvider(null) restores env-based selection. */
export function setProvider(p) { override = p; }

/** Hard wall-clock cap in addition to the SDK timeout, so a hung socket can never stall the demo. */
export function withTimeout(promise, ms = ASSISTANT_TIMEOUT_MS + 500) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('assistant timeout')), ms); })]).finally(() => clearTimeout(t));
}
