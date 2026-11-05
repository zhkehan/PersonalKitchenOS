import { buildUserMessage, SYSTEM_PROMPT } from '../domain/ai/prompt';
import { PROPOSAL_JSON_SCHEMA } from '../domain/ai/schema';
import { ProviderError, type Provider } from './provider';

export interface GeminiConfig {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  /** 浏览器直连时不能发 Api-Revision：Google 的跨域预检不放行这个头（2026-11 实测）。 */
  omitRevisionHeader?: boolean;
}

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const GEMINI_API_REVISION = '2026-05-20';

/** schema 被拒绝时的提示：把字段名写进系统提示，结果仍由 zod 严格校验。 */
function fieldGuide(): string {
  const change = Object.keys(PROPOSAL_JSON_SCHEMA.properties.requested_change.properties).join('、');
  return `\n\n输出一个 JSON 对象，字段：intent、date、date_phrase、meal_slot、requested_change、ambiguities、needs_confirmation、confidence。requested_change 只能含：${change}。不适用的字段填 null。`;
}

interface GeminiInteraction {
  status?: string;
  steps?: { type?: string; content?: { type?: string; text?: string }[] }[];
}

/**
 * Gemini Interactions API。store: false 表示不在服务端保留这次请求。
 * 官方文档说明过于复杂的 schema 会返回 400，所以被拒时退回纯 JSON 模式再试一次；
 * 无论走哪条路，输出都要通过同一份 zod 校验。
 */
export function geminiProvider(cfg: GeminiConfig): Provider {
  const f = cfg.fetchImpl ?? fetch;
  const call = (system: string, responseFormat: Record<string, unknown>, input: string) => f(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey, ...(cfg.omitRevisionHeader ? {} : { 'Api-Revision': GEMINI_API_REVISION }) },
    body: JSON.stringify({
      model: cfg.model,
      system_instruction: system,
      input,
      response_format: responseFormat,
      generation_config: { max_output_tokens: 4096 },
      store: false,
    }),
    signal: AbortSignal.timeout(40_000),
  });
  const errorMessage = async (res: Response) => {
    const body = (await res.clone().json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    return { code: body?.error?.code ?? '', message: (body?.error?.message ?? '').slice(0, 200) };
  };

  return {
    id: 'gemini',
    model: cfg.model,
    async parse({ text, context }) {
      const input = buildUserMessage(context, text);
      const base = { type: 'text', mime_type: 'application/json' };
      let res = await call(SYSTEM_PROMPT, { ...base, schema: PROPOSAL_JSON_SCHEMA }, input);
      if (res.status === 400) {
        const { message } = await errorMessage(res);
        if (/schema|response_format|state|nesting/i.test(message)) {
          console.warn('Gemini 拒绝了 JSON Schema，改用纯 JSON 模式。');
          res = await call(SYSTEM_PROMPT + fieldGuide(), base, input);
        }
      }
      if (!res.ok) {
        const { code, message } = await errorMessage(res);
        if (res.status === 401 || res.status === 403 || /api.?key/i.test(message)) throw new ProviderError('Gemini API Key 无效或无权限', false);
        if (res.status === 429) throw new ProviderError('Gemini 免费额度用完或请求太快，太平洋时间午夜重置每日额度');
        if (res.status === 404) throw new ProviderError(`Gemini 没有这个模型：${cfg.model}`, false);
        if (res.status === 400) throw new ProviderError(`Gemini 拒绝了请求：${message || code}`, false);
        throw new ProviderError(`Gemini 错误 ${res.status}`);
      }
      const body = (await res.json()) as GeminiInteraction;
      if (body.status === 'incomplete') throw new ProviderError('模型输出被截断');
      if (body.status !== 'completed') throw new ProviderError(`Gemini 未完成：${body.status ?? '未知状态'}`);
      const output = body.steps?.filter((s) => s.type === 'model_output').at(-1);
      const content = output?.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
      if (!content) throw new ProviderError('模型没有返回文本');
      return content;
    },
  };
}
