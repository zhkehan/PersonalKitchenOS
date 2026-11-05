import Anthropic from '@anthropic-ai/sdk';
import { buildUserMessage, SYSTEM_PROMPT } from '../src/domain/ai/prompt';
import { PROPOSAL_JSON_SCHEMA } from '../src/domain/ai/schema';
import { ProviderError, type Provider } from '../src/ai/provider';

export type { ParseRequest, Provider } from '../src/ai/provider';
export { ProviderError } from '../src/ai/provider';
export { geminiProvider } from '../src/ai/gemini';

export interface OllamaConfig {
  url: string;
  model: string;
  fetchImpl?: typeof fetch;
}

/** 本地模型。format 传 JSON Schema，让 Ollama 约束输出。 */
export function ollamaProvider(cfg: OllamaConfig): Provider {
  const f = cfg.fetchImpl ?? fetch;
  return {
    id: 'ollama',
    model: cfg.model,
    async parse({ text, context }) {
      const res = await f(`${cfg.url.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cfg.model,
          stream: false,
          format: PROPOSAL_JSON_SCHEMA,
          options: { temperature: 0 },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserMessage(context, text) },
          ],
        }),
        signal: AbortSignal.timeout(40_000),
      });
      if (!res.ok) throw new ProviderError(`Ollama ${res.status}`);
      const body = (await res.json()) as { message?: { content?: string } };
      const content = body.message?.content;
      if (!content) throw new ProviderError('Ollama 返回为空');
      return content;
    },
  };
}

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

/**
 * 云端模型，只有用户在 .env 里明确选择才启用。密钥只存在这个进程里。
 * 这是单次解析调用：用结构化输出约束 JSON，effort 设为 low。
 * 开启 fallbacks: "default"，被安全分类器拒绝时由服务端换模型重试。
 */
export function anthropicProvider(cfg: AnthropicConfig): Provider {
  const client = new Anthropic({ apiKey: cfg.apiKey, maxRetries: 1, timeout: 40_000, ...(cfg.fetchImpl ? { fetch: cfg.fetchImpl } : {}) });
  return {
    id: 'anthropic',
    model: cfg.model,
    async parse({ text, context }) {
      let message;
      try {
        message = await client.beta.messages.create({
          model: cfg.model,
          max_tokens: 2048,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserMessage(context, text) }],
          output_config: { effort: 'low', format: { type: 'json_schema', schema: PROPOSAL_JSON_SCHEMA } },
        } as never) as unknown as Anthropic.Message;
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
          throw new ProviderError('Anthropic API Key 无效或无权限', false);
        }
        if (e instanceof Anthropic.BadRequestError) throw new ProviderError(`Anthropic 请求被拒绝：${e.message}`, false);
        if (e instanceof Anthropic.RateLimitError) throw new ProviderError('Anthropic 限流');
        if (e instanceof Anthropic.APIConnectionError) throw new ProviderError('连不上 Anthropic');
        if (e instanceof Anthropic.APIError) throw new ProviderError(`Anthropic 错误 ${e.status ?? ''}`);
        throw e;
      }
      if (message.stop_reason === 'refusal') throw new ProviderError('模型拒绝了这个请求', false);
      if (message.stop_reason === 'max_tokens') throw new ProviderError('模型输出被截断');
      const block = message.content.find((b) => b.type === 'text');
      if (!block || block.type !== 'text') throw new ProviderError('模型没有返回文本');
      return block.text;
    },
  };
}
