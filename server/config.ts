import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anthropicProvider, geminiProvider, ollamaProvider, type Provider } from './providers';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * .env 里有密钥，项目却在 Dropbox 里。不同步标记是 NTFS 附加流，
 * 整文件重写（部分编辑器、脚本）会把它冲掉，所以每次启动都检查并补上。
 * 返回 true 表示这次补了标记。
 */
export function protectEnvFile(path: string, platform: string = process.platform): boolean {
  if (platform !== 'win32' || !/dropbox/i.test(path) || !existsSync(path)) return false;
  const stream = `${path}:com.dropbox.ignored`;
  if (existsSync(stream)) return false;
  writeFileSync(stream, '1');
  return true;
}

export function loadEnv() {
  const path = join(ROOT, '.env');
  if (!existsSync(path)) return;
  try {
    if (protectEnvFile(path)) console.warn('注意：.env 的 Dropbox 不同步标记丢失，已补上。如果里面已有 API Key，它可能同步过，建议到服务商后台重新生成。');
  } catch (e) {
    console.warn(`注意：没能标记 .env 不同步到 Dropbox：${(e as Error).message}`);
  }
  process.loadEnvFile(path);
}

export function makeProvider(env: NodeJS.ProcessEnv = process.env): Provider | null {
  const name = env.KITCHEN_AI_PROVIDER || 'off';
  if (name === 'off') return null;
  if (name === 'ollama') return ollamaProvider({ url: env.OLLAMA_URL || 'http://127.0.0.1:11434', model: env.OLLAMA_MODEL || 'qwen2.5:7b' });
  if (name === 'gemini') {
    if (!env.GEMINI_API_KEY) throw new Error('KITCHEN_AI_PROVIDER=gemini，但 .env 里没有 GEMINI_API_KEY。');
    return geminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite' });
  }
  if (name === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('KITCHEN_AI_PROVIDER=anthropic，但 .env 里没有 ANTHROPIC_API_KEY。');
    return anthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || 'claude-opus-5-5' });
  }
  throw new Error(`未知的 KITCHEN_AI_PROVIDER：${name}`);
}
