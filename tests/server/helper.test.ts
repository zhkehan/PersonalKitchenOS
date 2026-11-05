import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertSafeConfig, createHelper, randomToken, type HelperConfig } from '../../server/app';
import { makeProvider, protectEnvFile } from '../../server/config';
import { anthropicProvider, geminiProvider, ollamaProvider, ProviderError, type Provider } from '../../server/providers';

const TOKEN = 'test-token-0123456789';
const servers: { close(): void }[] = [];
afterEach(() => { servers.splice(0).forEach((s) => s.close()); });

async function start(over: Partial<HelperConfig> = {}) {
  const server = createHelper({ host: '127.0.0.1', token: TOKEN, provider: null, allowedOrigins: [], distDir: null, ...over });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const fake = (out: string | (() => string)): Provider => ({ id: 'fake', model: 'm', parse: async () => (typeof out === 'string' ? out : out()) });
const post = (url: string, body: unknown, token: string | null = TOKEN) => fetch(`${url}/api/ai/parse`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
});

describe('辅助服务的安全默认值', () => {
  it('暴露到局域网但没有强口令时拒绝启动', () => {
    expect(() => assertSafeConfig({ host: '0.0.0.0', token: '' })).toThrow(/拒绝启动/);
    expect(() => assertSafeConfig({ host: '0.0.0.0', token: 'short' })).toThrow(/拒绝启动/);
    expect(() => assertSafeConfig({ host: '0.0.0.0', token: randomToken() })).not.toThrow();
    expect(() => assertSafeConfig({ host: '127.0.0.1', token: '' })).not.toThrow();
  });

  it('没有口令不能调用模型；健康检查不泄露提供者', async () => {
    const url = await start({ provider: fake('{}') });
    expect((await post(url, { text: 'x' }, null)).status).toBe(401);
    expect((await post(url, { text: 'x' }, 'wrong-token-wrong-tok')).status).toBe(401);
    expect(await (await fetch(`${url}/api/health`)).json()).toEqual({ ok: true });
    const authed = await fetch(`${url}/api/health`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect((await authed.json()).provider).toBe('fake');
  });

  it('没有写库存的接口', async () => {
    const url = await start({ provider: fake('{}') });
    for (const path of ['/api/inventory', '/api/commit', '/api/db']) {
      const res = await fetch(`${url}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
      expect(res.status).toBe(404);
    }
  });

  it('跨域只放行白名单来源', async () => {
    const url = await start({ allowedOrigins: ['https://me.github.io'] });
    const ok = await fetch(`${url}/api/health`, { headers: { Origin: 'https://me.github.io' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://me.github.io');
    const bad = await fetch(`${url}/api/health`, { headers: { Origin: 'https://evil.example' } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('超长文本和超大请求被拒绝，请求限流', async () => {
    const url = await start({ provider: fake(JSON.stringify({ intent: 'ask_what_to_cook' })) });
    expect((await post(url, { text: 'x'.repeat(501) })).status).toBe(400);
    const big = await post(url, { text: 'x', context: 'y'.repeat(20000) }).catch(() => null);
    expect(big === null || big.status === 413).toBe(true);
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await post(url, { text: '今天吃什么' })).status);
    expect(codes).toContain(429);
  });

  it('静态服务不能穿越目录，也不暴露点文件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-'));
    writeFileSync(join(dir, 'index.html'), '<title>app</title>');
    writeFileSync(join(dir, '.env'), 'SECRET=1');
    const url = await start({ distDir: dir });
    expect(await (await fetch(`${url}/`)).text()).toContain('app');
    expect((await fetch(`${url}/.env`)).status).toBe(404);
    const trav = await fetch(`${url}/..%2f..%2fpackage.json`);
    expect(await trav.text()).not.toContain('"dependencies"');
  });
});

describe('.env 不同步标记', () => {
  const file = () => {
    const dir = mkdtempSync(join(tmpdir(), 'Dropbox-test-'));
    const path = join(dir, '.env');
    writeFileSync(path, 'SECRET=1');
    return path;
  };

  // NTFS 附加流只有 Windows 才有；CI 跑在 Linux 上。
  it.skipIf(process.platform !== 'win32')('Dropbox 里的 .env 缺标记时补上，已有时不动，重写冲掉后能再补上', () => {
    const path = file();
    expect(protectEnvFile(path, 'win32')).toBe(true);
    expect(protectEnvFile(path, 'win32')).toBe(false);
    expect(readFileSync(`${path}:com.dropbox.ignored`, 'utf8')).toBe('1');
    expect(readFileSync(path, 'utf8')).toBe('SECRET=1');
    writeFileSync(path, 'SECRET=2');
    expect(protectEnvFile(path, 'win32')).toBe(true);
  });

  it('不在 Dropbox 或不是 Windows 时什么都不做', () => {
    expect(protectEnvFile(file(), 'linux')).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'plain-'));
    const path = join(dir, '.env');
    writeFileSync(path, 'x');
    expect(protectEnvFile(path, 'win32')).toBe(false);
  });
});

describe('模型输出校验', () => {
  it('合法草稿返回；非法 JSON / 未授权动作返回 422', async () => {
    const ok = await post(await start({ provider: fake(JSON.stringify({ intent: 'eat_out', meal_slot: 'lunch' })) }), { text: '中午外食' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).proposal.intent).toBe('eat_out');

    const bad = await post(await start({ provider: fake('库存有 500g 牛肉') }), { text: 'x' });
    expect(bad.status).toBe(422);
    const evil = await post(await start({ provider: fake(JSON.stringify({ intent: 'drop_table' })) }), { text: 'x' });
    expect(evil.status).toBe(422);
  });

  it('模型不可用返回 502，不崩溃', async () => {
    const failing: Provider = { id: 'x', model: 'm', parse: async () => { throw new ProviderError('down'); } };
    expect((await post(await start({ provider: failing }), { text: 'x' })).status).toBe(502);
    expect((await post(await start(), { text: 'x' })).status).toBe(503);
  });

  it('日志不记录用户原话和口令', async () => {
    const lines: string[] = [];
    const url = await start({ provider: fake('not json'), log: (l) => lines.push(l) });
    await post(url, { text: '我的隐私句子' });
    expect(lines.join()).not.toContain('隐私');
    expect(lines.join()).not.toContain(TOKEN);
  });
});

describe('Provider 线上格式（用假的 HTTP 端点验证；不是真实模型）', () => {
  it('Ollama：/api/chat，非流式，format 是 JSON Schema，用户文字在 user 消息里', async () => {
    let seen: { url: string; body: { model: string; stream: boolean; format: { type: string }; messages: { role: string; content: string }[] } } | undefined;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(init.body as string) };
      return new Response(JSON.stringify({ message: { content: '{"intent":"ask_what_to_cook"}' } }));
    }) as unknown as typeof fetch;
    const out = await ollamaProvider({ url: 'http://x:11434/', model: 'qwen', fetchImpl: f }).parse({ text: '吃啥', context: 'ctx' });
    expect(out).toContain('ask_what_to_cook');
    expect(seen?.url).toBe('http://x:11434/api/chat');
    expect(seen?.body.stream).toBe(false);
    expect(seen?.body.format.type).toBe('object');
    expect(seen?.body.messages[0].role).toBe('system');
    expect(seen?.body.messages[1].content).toContain('<user_text>\n吃啥\n</user_text>');
  });

  it('Ollama 没启动时抛可识别的错误', async () => {
    const f = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(ollamaProvider({ url: 'http://x', model: 'm', fetchImpl: f }).parse({ text: 'a', context: '' })).rejects.toThrow(ProviderError);
  });

  type Sent = { url: string; headers: Headers; body: { model: string; store: boolean; input: string; system_instruction: string; temperature?: number; response_format: { type: string; mime_type: string; schema?: { type: string } } } };

  function geminiStub(replies: { status?: number; body: unknown }[]) {
    const sent: Sent[] = [];
    const f = (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: new Headers(init.headers), body: JSON.parse(init.body as string) });
      const r = replies[Math.min(sent.length - 1, replies.length - 1)];
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }) as unknown as typeof fetch;
    return { sent, provider: geminiProvider({ apiKey: 'g-test-key', model: 'gemini-3.5-flash-lite', fetchImpl: f }) };
  }
  const done = (steps: unknown[]) => ({ object: 'interaction', status: 'completed', steps });
  const output = (text: string) => ({ type: 'model_output', content: [{ type: 'text', text }] });

  it('Gemini：Interactions 请求格式，密钥在请求头，不留存，不发采样参数', async () => {
    const { sent, provider } = geminiStub([{ body: done([output('{"intent":"ask_what_to_cook"}')]) }]);
    expect(await provider.parse({ text: '吃啥', context: 'c' })).toContain('ask_what_to_cook');
    const { url, headers, body } = sent[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(url).not.toContain('g-test-key');
    expect(headers.get('x-goog-api-key')).toBe('g-test-key');
    expect(headers.get('api-revision')).toBe('2026-05-20');
    expect(body.model).toBe('gemini-3.5-flash-lite');
    expect(body.store).toBe(false);
    expect(body.temperature).toBeUndefined();
    expect(body.system_instruction).toContain('意图解析器');
    expect(body.input).toContain('<user_text>\n吃啥\n</user_text>');
    expect(body.response_format).toMatchObject({ type: 'text', mime_type: 'application/json' });
    expect(body.response_format.schema?.type).toBe('object');
  });

  it('Gemini：跳过思考步骤，取最后的模型输出', async () => {
    const { provider } = geminiStub([{ body: done([{ type: 'thought', content: [{ type: 'text', text: '想一想' }] }, output('{"a":'), output('{"intent":"eat_out"}')]) }]);
    expect(await provider.parse({ text: 'a', context: '' })).toBe('{"intent":"eat_out"}');
  });

  it('Gemini：schema 太复杂被拒时退回纯 JSON 模式，并把字段名写进提示', async () => {
    const { sent, provider } = geminiStub([
      { status: 400, body: { error: { code: 'invalid_request', message: 'Schema exceeds the limit on total states' } } },
      { body: done([output('{"intent":"eat_out"}')]) },
    ]);
    expect(await provider.parse({ text: 'a', context: '' })).toContain('eat_out');
    expect(sent).toHaveLength(2);
    expect(sent[1].body.response_format.schema).toBeUndefined();
    expect(sent[1].body.system_instruction).toContain('evidence_quote');
  });

  it('Gemini：密钥错误、额度用完、模型不存在、截断、未完成都给出明确错误，且不泄露密钥', async () => {
    const bad = async (replies: { status?: number; body: unknown }[], expected: RegExp) => {
      const { sent, provider } = geminiStub(replies);
      const err = await provider.parse({ text: 'a', context: '' }).catch((e) => e as Error);
      expect((err as Error).message).toMatch(expected);
      expect((err as Error).message).not.toContain('g-test-key');
      return sent;
    };
    await bad([{ status: 400, body: { error: { code: 'invalid_request', message: 'API key not valid' } } }], /API Key/);
    await bad([{ status: 401, body: { error: { code: 'authentication', message: 'x' } } }], /API Key/);
    await bad([{ status: 429, body: { error: { code: 'quota_exceeded', message: 'x' } } }], /免费额度/);
    await bad([{ status: 404, body: { error: { code: 'model_not_found', message: 'x' } } }], /没有这个模型/);
    await bad([{ body: { status: 'incomplete', steps: [] } }], /截断/);
    await bad([{ body: { status: 'failed', steps: [] } }], /未完成/);
    await bad([{ body: done([]) }], /没有返回文本/);
    expect(await bad([{ status: 400, body: { error: { code: 'invalid_request', message: 'bad field' } } }], /拒绝了请求/)).toHaveLength(1);
  });

  it('配置：选 gemini 时用 flash-lite，缺密钥时明确报错', () => {
    expect(makeProvider({ KITCHEN_AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' })?.model).toBe('gemini-3.5-flash-lite');
    expect(makeProvider({ KITCHEN_AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-2.5-flash-lite' })?.model).toBe('gemini-2.5-flash-lite');
    expect(() => makeProvider({ KITCHEN_AI_PROVIDER: 'gemini' })).toThrow(/GEMINI_API_KEY/);
    expect(makeProvider({})).toBeNull();
    expect(() => makeProvider({ KITCHEN_AI_PROVIDER: 'nope' })).toThrow(/未知/);
  });

  function anthropicStub(reply: Record<string, unknown>, status = 200) {
    const seen: { headers?: Headers; body?: Record<string, unknown>; url?: string } = {};
    const f = (async (url: string, init: RequestInit) => {
      seen.url = String(url); seen.headers = new Headers(init.headers); seen.body = JSON.parse(init.body as string);
      return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { seen, provider: anthropicProvider({ apiKey: 'sk-test', model: 'claude-opus-5-5', fetchImpl: f }) };
  }
  const msg = (over: Record<string, unknown>) => ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"intent":"ask_what_to_cook"}' }], usage: { input_tokens: 1, output_tokens: 1 }, ...over });

  it('Anthropic：请求含结构化输出、低 effort、fallback 头；不发 temperature / thinking', async () => {
    const { seen, provider } = anthropicStub(msg({}));
    expect(await provider.parse({ text: '吃啥', context: 'c' })).toContain('ask_what_to_cook');
    expect(seen.url).toContain('/v1/messages');
    expect(seen.headers?.get('authorization')).toBe('Bearer sk-test');
    expect(seen.headers?.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    const body = seen.body as { model: string; fallbacks: string; output_config: { effort: string; format: { type: string } }; temperature?: number; thinking?: unknown };
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.fallbacks).toBe('default');
    expect(body.output_config.effort).toBe('low');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  it('Anthropic：refusal、截断、认证失败都转成明确错误', async () => {
    await expect(anthropicStub(msg({ stop_reason: 'refusal', content: [] })).provider.parse({ text: 'a', context: '' })).rejects.toThrow('拒绝');
    await expect(anthropicStub(msg({ stop_reason: 'max_tokens' })).provider.parse({ text: 'a', context: '' })).rejects.toThrow('截断');
    await expect(anthropicStub({ type: 'error', error: { type: 'authentication_error', message: 'bad' } }, 401).provider.parse({ text: 'a', context: '' })).rejects.toThrow('API Key');
  });
});
