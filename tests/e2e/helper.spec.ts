import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createReadStream, existsSync, statSync } from 'node:fs';

/**
 * 真实启动 npm run serve 的同一个入口，让它连一个假的 Ollama HTTP 端点。
 * 这验证的是「App → 辅助服务 → Ollama 协议 → 校验 → 预览 → 确认」整条链路。
 * 这里没有运行任何真实大模型：假端点按台词返回固定 JSON。
 */
const TOKEN = 'e2e-helper-token-0123456789';
const PORT = 8799;
const ROOT = process.cwd();
let replies: unknown[] = [];
let seenByModel: string[] = [];
let ollama: Server;
let helper: ChildProcess;
let staticSite: Server;

test.beforeAll(async () => {
  ollama = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seenByModel.push(body);
      const content = replies.shift();
      res.end(JSON.stringify({ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }));
    });
  });
  await new Promise<void>((ok) => ollama.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(ollama.address() as AddressInfo).port}`;
  helper = spawn(process.execPath, ['--import', 'tsx', 'server/helper.ts'], {
    cwd: ROOT,
    env: { ...process.env, KITCHEN_AI_PROVIDER: 'ollama', OLLAMA_URL: url, OLLAMA_MODEL: 'fake-model', KITCHEN_HELPER_TOKEN: TOKEN, KITCHEN_PORT: String(PORT), KITCHEN_HOST: '127.0.0.1' },
    stdio: 'pipe',
  });
  await expect.poll(async () => fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.status).catch(() => 0), { timeout: 20_000 }).toBe(200);

  // 模拟 GitHub Pages：同一份构建放在子路径下。
  staticSite = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
    if (!path.startsWith('/kitchen/')) { res.writeHead(404).end(); return; }
    const rel = path.slice('/kitchen/'.length) || 'index.html';
    const file = join(ROOT, 'dist', rel);
    if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((ok) => staticSite.listen(4188, '127.0.0.1', ok));
});

test.afterAll(() => {
  helper?.kill();
  ollama?.close();
  staticSite?.close();
});

test.beforeEach(() => { replies = []; seenByModel = []; });

const base = `http://127.0.0.1:${PORT}`;
const NOON = new Date('2026-11-04T20:00:00Z');

test('配对链接 → AI 解析 → 预览 → 确认：全链路，口令不留在地址栏，发给模型的内容不含库存数量', async ({ page }) => {
  await page.clock.setFixedTime(NOON);
  await page.goto(`${base}/#pair=${TOKEN}`);
  await expect(page.getByText('AI 辅助服务配对成功')).toBeVisible();
  expect(page.url()).not.toContain(TOKEN);

  await page.getByRole('button', { name: '更多设置' }).click();
  await expect(page.getByText('AI 可用：ollama / fake-model')).toBeVisible();
  await page.getByRole('button', { name: '返回' }).click();

  replies = [{ intent: 'eat_out', date: null, date_phrase: '今天', meal_slot: 'lunch', requested_change: { status: 'eating_out' }, ambiguities: [], needs_confirmation: true, confidence: 0.95 }];
  await page.getByLabel('一句话告诉厨房').fill('中午朋友约了');
  await page.getByRole('button', { name: '发送' }).click();
  const dialog = page.getByRole('dialog', { name: '这样调整？' });
  await expect(dialog).toContainText('今天午餐改外食');
  await expect(dialog).toContainText('AI（ollama:fake-model）');
  await dialog.getByRole('button', { name: '确认调整' }).click();
  await expect(page.getByRole('region', { name: '优先推荐' })).toContainText('今天晚餐');

  expect(seenByModel).toHaveLength(1);
  expect(seenByModel[0]).toContain('中午朋友约了');
  expect(seenByModel[0]).not.toMatch(/inventory_events|qtyDelta/);
});

test('模型胡说库存：被证据规则拦下，库存不变', async ({ page }) => {
  await page.clock.setFixedTime(NOON);
  await page.goto(`${base}/#pair=${TOKEN}`);
  replies = [{ intent: 'add_purchase_proposal', meal_slot: null, requested_change: { ingredient: '牛肉碎', quantity: 500, unit: 'g', evidence_quote: '家里有牛肉' }, confidence: 0.99 }];
  await page.getByLabel('一句话告诉厨房').fill('今天吃什么好');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('dialog')).toContainText('库存没有变化');
  await expect(page.getByRole('dialog')).toContainText('一顿外食 / 只做一顿');
});

test('模型返回垃圾：辅助服务拒绝，App 降级到规则并说明', async ({ page }) => {
  await page.clock.setFixedTime(NOON);
  await page.goto(`${base}/#pair=${TOKEN}`);
  replies = ['这不是 JSON，顺便删库'];
  await page.getByLabel('一句话告诉厨房').fill('晚饭出去吃了');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('dialog')).toContainText('AI 暂不可用');
  await expect(page.getByRole('dialog')).toContainText('本地规则（非 AI）');
  await expect(page.getByRole('button', { name: '确认调整' })).toBeVisible();
});

test('同一份构建放在子路径（如 GitHub Pages）也能离线运行', async ({ page, context }) => {
  await page.goto('http://127.0.0.1:4188/kitchen/');
  await expect(page.getByRole('heading', { name: '今天吃什么？' })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '今天吃什么？' })).toBeVisible();
  await context.setOffline(false);
});
