import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import qrcode from 'qrcode-terminal';
import { assertSafeConfig, createHelper, isLoopback, randomToken } from './app';
import { loadEnv, makeProvider, ROOT } from './config';
import type { Provider } from './providers';

loadEnv();
const env = process.env;
const host = env.KITCHEN_HOST || '127.0.0.1';
const port = Number(env.KITCHEN_PORT || 8787);
const token = env.KITCHEN_HELPER_TOKEN || randomToken();
assertSafeConfig({ host, token });

// AI 配错不能拖垮 App：页面照常托管，AI 显示不可用。
let provider: Provider | null = null;
try {
  provider = makeProvider(env);
} catch (e) {
  console.warn(`AI 没有启用：${(e as Error).message}`);
}

const distDir = join(ROOT, 'dist');
const server = createHelper({
  host, token, provider,
  allowedOrigins: (env.KITCHEN_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  distDir,
  log: (l) => console.log(l),
});

server.listen(port, host, () => {
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  const publicUrl = env.KITCHEN_PUBLIC_URL || (isLoopback(host) ? `http://127.0.0.1:${port}` : `http://${lan ?? host}:${port}`);
  console.log(`\nPersonal Kitchen OS 辅助服务已启动`);
  console.log(`  本机地址  http://${host}:${port}`);
  console.log(`  AI 提供者 ${provider ? `${provider.id} / ${provider.model}` : '关闭（App 仍可完整使用）'}`);
  if (!existsSync(join(distDir, 'index.html'))) console.log('  注意：还没有构建，先运行 npm run build');
  const pair = `${publicUrl}/#pair=${token}`;
  console.log(`\n配对链接（含口令，别分享）：\n  ${pair}\n`);
  if (publicUrl.startsWith('https://') || !isLoopback(host)) qrcode.generate(pair, { small: true });
  if (publicUrl.startsWith('http://') && !isLoopback(host)) {
    console.log('提示：普通 http 局域网地址不是安全上下文，安卓上不能离线、不能安装 PWA。见 README「手机安装」。');
  }
});
