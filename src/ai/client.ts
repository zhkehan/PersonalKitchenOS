import { buildAiContext } from '../domain/ai/prompt';
import { resolveProposal, type Resolution } from '../domain/ai/resolve';
import { ruleParse } from '../domain/ai/ruleParser';
import type { Ctx } from '../domain/tx';
import type { KitchenState } from '../domain/types';
import { geminiProvider } from './gemini';
import { ProviderError } from './provider';

/**
 * AI 配置存在 localStorage：只在这台设备上，不进数据库，也不进备份。
 * direct = 手机直连 Gemini：Key 是用户在这台设备上填的，不在代码、仓库或构建产物里。
 * helper = 电脑辅助服务：前端只有配对口令，模型密钥留在电脑的 .env。
 */
export interface AiSettings {
  enabled: boolean;
  mode: 'direct' | 'helper';
  url: string;
  token: string;
  geminiKey: string;
}

export const DIRECT_MODEL = 'gemini-3.5-flash-lite';

const KEY = 'kos.ai';
const DEFAULTS: AiSettings = { enabled: false, mode: 'direct', url: '', token: '', geminiKey: '' };

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveAiSettings(s: AiSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 私密窗口等情况下不保存 */ }
}

/** 辅助服务打印的配对链接：#pair=<token>。fragment 不会发给任何服务器。 */
export function consumePairingLink(): boolean {
  try {
    const m = location.hash.match(/pair=([\w-]+)/);
    if (!m) return false;
    saveAiSettings({ ...loadAiSettings(), enabled: true, mode: 'helper', url: location.origin, token: m[1] });
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  } catch {
    return false;
  }
}

export type HelperStatus =
  | { state: 'off' }
  | { state: 'no_key' }
  | { state: 'unreachable'; detail: string }
  | { state: 'unauthorized' }
  | { state: 'no_provider' }
  | { state: 'ready'; provider: string; model: string };

type FetchLike = typeof fetch;

const baseUrl = (s: AiSettings) => (s.url || (typeof location !== 'undefined' ? location.origin : '')).replace(/\/$/, '');

export async function helperStatus(s: AiSettings, f: FetchLike = fetch): Promise<HelperStatus> {
  if (!s.enabled) return { state: 'off' };
  if (s.mode === 'direct') return s.geminiKey ? { state: 'ready', provider: 'Gemini 手机直连', model: DIRECT_MODEL } : { state: 'no_key' };
  try {
    const res = await f(`${baseUrl(s)}/api/health`, { headers: { Authorization: `Bearer ${s.token}` }, signal: AbortSignal.timeout(4000) });
    if (res.status === 401) return { state: 'unauthorized' };
    if (!res.ok) return { state: 'unreachable', detail: `HTTP ${res.status}` };
    const j = await res.json();
    if (!j.provider || j.provider === 'off') return { state: 'no_provider' };
    return { state: 'ready', provider: j.provider, model: j.model };
  } catch (e) {
    return { state: 'unreachable', detail: e instanceof Error ? e.message : '连接失败' };
  }
}

async function parseViaHelper(s: AiSettings, text: string, context: string, f: FetchLike): Promise<{ proposal: unknown; provider: string }> {
  const res = await f(`${baseUrl(s)}/api/ai/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` },
    body: JSON.stringify({ text, context }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`helper ${res.status}`);
  return res.json();
}

export interface Interpretation {
  resolution: Resolution;
  /** ai = 真实模型；rules = 本地规则（不是 AI）。 */
  source: 'ai' | 'rules';
  providerLabel: string;
  raw: unknown;
  /** AI 开着但这次没用上时的说明。 */
  degraded: string | null;
}

/** 文本 → 草稿 → 校验 → 预览。这里不写任何数据；确认由 UI 调用命令完成。 */
export async function interpret(state: KitchenState, ctx: Ctx, text: string, settings: AiSettings, f: FetchLike = fetch): Promise<Interpretation> {
  let degraded: string | null = null;
  if (settings.enabled) {
    try {
      const context = buildAiContext(state, ctx.now);
      let proposal: unknown;
      let provider: string;
      if (settings.mode === 'direct') {
        if (!settings.geminiKey) throw new ProviderError('还没填 Gemini Key', false);
        proposal = await geminiProvider({ apiKey: settings.geminiKey, model: DIRECT_MODEL, fetchImpl: f, omitRevisionHeader: true }).parse({ text, context });
        provider = `gemini:${DIRECT_MODEL}`;
      } else {
        ({ proposal, provider } = await parseViaHelper(settings, text, context, f));
      }
      const resolution = resolveProposal(state, ctx, proposal, text);
      return { resolution, source: 'ai', providerLabel: provider, raw: proposal, degraded: null };
    } catch (e) {
      const why = e instanceof ProviderError ? `（${e.message}）` : '';
      degraded = `AI 暂不可用${why}，已改用本地规则识别；基础功能不受影响。`;
    }
  }
  const raw = ruleParse(text, state, ctx.now);
  const resolution: Resolution = raw === null
    ? { type: 'rejected', reason: settings.enabled ? '没能理解这句话，可以用下面的快捷按钮。' : '规则没认出这句话。没有连接 AI，可以用下面的快捷按钮。', errors: ['rule parser: no match'] }
    : resolveProposal(state, ctx, raw, text);
  return { resolution, source: 'rules', providerLabel: '本地规则（非 AI）', raw, degraded };
}
