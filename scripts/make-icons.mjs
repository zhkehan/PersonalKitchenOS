// 用 Playwright 的 Chromium 把 SVG 渲染成 PWA 图标。只在图标改动时运行一次：npm run icons
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const svg = readFileSync(join(out, 'icon.svg'), 'utf8');
const browser = await chromium.launch();

async function render(name, size, inner) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px}svg{display:block;width:100%;height:100%}</style>${inner}`);
  writeFileSync(join(out, name), await page.screenshot({ omitBackground: false }));
  await page.close();
}

await render('icon-192.png', 192, svg);
await render('icon-512.png', 512, svg);
// maskable 图标：系统会裁切外圈，把主体缩到安全区里。
await render('icon-maskable-512.png', 512, `<div style="width:512px;height:512px;background:#2f5d50;display:flex;align-items:center;justify-content:center"><div style="width:380px;height:380px">${svg}</div></div>`);
await browser.close();
