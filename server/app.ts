import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { parseProposal } from '../src/domain/ai/schema';
import { ProviderError, type Provider } from './providers';

const MAX_BODY = 16 * 1024;
const MAX_TEXT = 500;
const MAX_CONTEXT = 4000;
const RATE_PER_MINUTE = 30;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json',
};

export interface HelperConfig {
  host: string;
  token: string;
  provider: Provider | null;
  allowedOrigins: string[];
  distDir: string | null;
  log?: (line: string) => void;
}

export const isLoopback = (host: string) => host === '127.0.0.1' || host === 'localhost' || host === '::1';

export function assertSafeConfig(cfg: Pick<HelperConfig, 'host' | 'token'>) {
  if (!isLoopback(cfg.host) && cfg.token.length < 16) {
    throw new Error('拒绝启动：监听局域网地址时必须设置至少 16 位的 KITCHEN_HELPER_TOKEN。');
  }
}

export const randomToken = () => randomBytes(18).toString('base64url');

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from((header ?? '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { fail(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

function serveStatic(req: IncomingMessage, res: ServerResponse, dist: string) {
  const url = new URL(req.url ?? '/', 'http://x');
  const safe = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const root = resolve(dist);
  let file = resolve(join(root, safe));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  if (safe.split(/[/\\]/).some((p) => p.startsWith('.'))) { res.writeHead(404).end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  if (!existsSync(file)) { res.writeHead(404).end('还没有构建。先运行 npm run build。'); return; }
  const noCache = /(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)$/.test(file);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': noCache ? 'no-cache' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(file).pipe(res);
}

/**
 * 辅助服务只做三件事：托管构建好的 PWA、健康检查、把一句话转给模型。
 * 它不碰数据：库存全在手机的 IndexedDB 里，这里没有写接口。
 * 模型输出在这里和前端各校验一次，任何不合 schema 的结果都不会返回。
 */
export function createHelper(cfg: HelperConfig): Server {
  assertSafeConfig(cfg);
  const log = cfg.log ?? (() => {});
  const hits: number[] = [];

  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    const path = new URL(req.url ?? '/', 'http://x').pathname;

    if (path.startsWith('/api/')) {
      if (origin && cfg.allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        // Chrome 的私有网络访问预检：只对白名单来源放行。
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

      const authed = tokenMatches(req.headers.authorization, cfg.token);
      if (path === '/api/health') {
        // 没带口令只回答「活着」，不透露提供者。
        if (!req.headers.authorization) return json(res, 200, { ok: true });
        if (!authed) return json(res, 401, { error: 'unauthorized' });
        return json(res, 200, { ok: true, provider: cfg.provider?.id ?? 'off', model: cfg.provider?.model ?? null });
      }
      if (!authed) return json(res, 401, { error: 'unauthorized' });
      if (path !== '/api/ai/parse' || req.method !== 'POST') return json(res, 404, { error: 'not_found' });
      if (!cfg.provider) return json(res, 503, { error: 'ai_off' });

      const now = Date.now();
      while (hits.length && now - hits[0] > 60_000) hits.shift();
      if (hits.length >= RATE_PER_MINUTE) return json(res, 429, { error: 'rate_limited' });
      hits.push(now);

      let body: { text?: unknown; context?: unknown };
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        return json(res, (e as Error).message === 'too_large' ? 413 : 400, { error: 'bad_request' });
      }
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > MAX_TEXT) return json(res, 400, { error: 'bad_text' });
      const context = typeof body.context === 'string' ? body.context.slice(0, MAX_CONTEXT) : '';

      try {
        const raw = await cfg.provider.parse({ text: body.text, context });
        const parsed = parseProposal(raw);
        if (!parsed.ok) {
          // 不记录用户原话，只记录校验错误。
          log(`[ai] 模型输出未通过校验：${parsed.errors.slice(0, 3).join('; ')}`);
          return json(res, 422, { error: 'invalid_model_output', details: parsed.errors.slice(0, 5) });
        }
        return json(res, 200, { proposal: parsed.proposal, provider: `${cfg.provider.id}:${cfg.provider.model}` });
      } catch (e) {
        const msg = e instanceof ProviderError ? e.message : '模型调用失败';
        log(`[ai] ${msg}`);
        return json(res, 502, { error: 'provider_failed', message: msg });
      }
    }

    if (cfg.distDir && (req.method === 'GET' || req.method === 'HEAD')) return serveStatic(req, res, cfg.distDir);
    res.writeHead(404).end();
  });
}
