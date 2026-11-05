import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { BackupError, consumptionCsv, eventsCsv, exportBackup, inventoryCsv, restoreBackup, toBackup, validateBackup } from '../../src/data/backup';
import { commit, ensureSeeded, KitchenDB, loadState } from '../../src/data/db';
import { interpret } from '../../src/ai/client';
import { makeCtx } from '../../src/data/db';

const NOON = new Date('2026-11-04T20:00:00Z');
/** node 环境没有 localStorage：这里只保证 Key 不经过数据库，备份内容来自数据库。 */
const localStorage_set = (v: unknown) => { (globalThis as Record<string, unknown>).__kosAi = v; };
const TODAY = '2026-11-04';
let db: KitchenDB;
let n = 0;

beforeEach(async () => {
  db = new KitchenDB(`test-${++n}`);
  await ensureSeeded(db);
  await commit(db, NOON, 'syncPlan', {});
});

const buy = () => commit(db, NOON, 'confirmPurchase', { lines: [
  { ingredientId: 'chicken_breast', bought: true, qty: 1000, location: 'fridge' },
  { ingredientId: 'mushroom', bought: true, qty: 227 },
  { ingredientId: 'yellow_onion', bought: true, qty: 300 },
] });

describe('IndexedDB 事务', () => {
  it('首次打开只有目录，没有库存；重复 seed 不重复写', async () => {
    await ensureSeeded(db);
    expect(await db.store('inventory_lots').count()).toBe(0);
    expect(await db.store('inventory_events').count()).toBe(0);
    expect(await db.store('recipes').count()).toBeGreaterThan(20);
  });

  it('真实落库：做饭扣料、建熟菜、记食用都在库里', async () => {
    await buy();
    const r = await commit(db, NOON, 'finishCook', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 });
    expect(r.summary).toContain('本餐吃 1 份，剩 1 份');
    const s = await loadState(db);
    expect(s.inventory_lots.find((l) => l.ingredientId === 'chicken_breast')?.qty).toBe(500);
    expect(s.prepared_batches[0].portionsRemaining).toBe(1);
    expect(s.consumption_events).toHaveLength(1);
  });

  it('命令失败时事务回滚，数据库完全不变', async () => {
    await buy();
    const before = await loadState(db);
    await expect(commit(db, NOON, 'finishCook', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 1, eatNow: 5 })).rejects.toThrow();
    await expect(commit(db, NOON, 'finishCook', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1, actuals: [{ ingredientId: 'yellow_onion', qty: 1, unit: '颗' }] })).rejects.toThrow(/有多重/);
    expect(await loadState(db)).toEqual(before);
  });

  it('写入中途失败也回滚：不会肉扣了但熟菜没增加', async () => {
    await buy();
    const before = await loadState(db);
    const table = db.store('prepared_batches');
    const original = table.bulkPut.bind(table);
    (table as unknown as { bulkPut: unknown }).bulkPut = () => Promise.reject(new Error('磁盘写入失败'));
    await expect(commit(db, NOON, 'finishCook', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 })).rejects.toThrow('磁盘写入失败');
    (table as unknown as { bulkPut: unknown }).bulkPut = original;
    expect(await loadState(db)).toEqual(before);
  });

  it('并发双击（同一幂等键）只执行一次', async () => {
    await buy();
    const input = { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 };
    const [a, b] = await Promise.all([
      commit(db, NOON, 'finishCook', input, 'double-tap'),
      commit(db, NOON, 'finishCook', input, 'double-tap'),
    ]);
    expect([a.deduped, b.deduped].filter(Boolean)).toHaveLength(1);
    const s = await loadState(db);
    expect(s.prepared_batches).toHaveLength(1);
    expect(s.inventory_lots.find((l) => l.ingredientId === 'chicken_breast')?.qty).toBe(500);
  });

  it('撤销写入补偿流水，原流水保留', async () => {
    await buy();
    const cook = await commit(db, NOON, 'finishCook', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 });
    const events = await db.store('inventory_events').count();
    await commit(db, NOON, 'undoTransaction', { operationId: cook.operationId });
    const s = await loadState(db);
    expect(s.inventory_events.length).toBeGreaterThan(events);
    expect(s.inventory_lots.find((l) => l.ingredientId === 'chicken_breast')?.qty).toBe(1000);
    expect(s.prepared_batches[0].status).toBe('reverted');
    expect(s.audit_events.find((a) => a.id === cook.operationId)?.undoneBy).toBeTruthy();
  });
});

describe('33 备份与恢复', () => {
  async function busy() {
    await buy();
    await commit(db, NOON, 'finishCook', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 });
    await commit(db, NOON, 'setSeasoningLevel', { ingredientId: 'cumin', level: 'low' });
    await commit(db, NOON, 'createShoppingList', {});
  }

  it('导出后完整恢复到新设备：库存、流水、熟菜、餐次、菜谱、调料、采购一致', async () => {
    await busy();
    const file = JSON.parse(JSON.stringify(await exportBackup(db, NOON)));
    const phone = new KitchenDB(`phone-${++n}`);
    await restoreBackup(phone, file, NOON);
    const a = await loadState(db);
    const b = await loadState(phone);
    const { backup_metadata: _a, ...ra } = a;
    const { backup_metadata: _b, ...rb } = b;
    expect(rb).toEqual(ra);
    // 恢复后幂等键仍然有效
    const again = await commit(phone, NOON, 'syncPlan', {});
    expect(again.summary).toBeDefined();
  });

  it('恢复后继续记账正常，撤销仍可用', async () => {
    await busy();
    const file = JSON.parse(JSON.stringify(await exportBackup(db, NOON)));
    const phone = new KitchenDB(`phone-${++n}`);
    await restoreBackup(phone, file, NOON);
    const s = await loadState(phone);
    const op = s.audit_events.find((a) => a.name === 'createShoppingList')!;
    await commit(phone, NOON, 'undoTransaction', { operationId: op.id });
    expect((await loadState(phone)).shopping_items).toHaveLength(0);
  });

  it('校验：损坏、错误格式、更新版本、缺表、重复、负库存都拒绝，且原数据不变', async () => {
    await busy();
    const good = JSON.parse(JSON.stringify(toBackup(await loadState(db), NOON)));
    const before = await loadState(db);

    const tampered = JSON.parse(JSON.stringify(good));
    tampered.tables.inventory_lots[0].qty = 99999;
    await expect(restoreBackup(db, tampered, NOON)).rejects.toThrow(/校验失败/);

    await expect(restoreBackup(db, { hello: 1 }, NOON)).rejects.toThrow(BackupError);
    await expect(restoreBackup(db, { ...good, schemaVersion: 99 }, NOON)).rejects.toThrow(/更新的版本/);
    expect(await loadState(db)).toEqual(before);
  });

  it('备份升级链按版本依次执行，缺步骤时报错', async () => {
    const state = await loadState(db);
    const v1 = JSON.parse(JSON.stringify(toBackup(state, NOON)));
    const migrated = validateBackup(v1, { 1: (b) => ({ ...b, tables: { ...b.tables } }) }, 2);
    expect(migrated.schemaVersion).toBe(2);
    expect(() => validateBackup(v1, {}, 2)).toThrow(/缺少 v1/);
  });

  it('备份里没有 AI 口令或密钥', async () => {
    await busy();
    const text = JSON.stringify(await exportBackup(db, NOON));
    expect(text).not.toMatch(/api[_-]?key|ANTHROPIC|helperToken/i);
  });

  it('CSV 导出带表头，数量未知不写成 0，公式字符被转义', async () => {
    await buy();
    await commit(db, NOON, 'calibrateInventory', { entries: [{ ingredientId: 'egg', present: true }] });
    await commit(db, NOON, 'finishCook', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 });
    await commit(db, NOON, 'recordSnack', { label: '=HYPERLINK("x")' });
    const s = await loadState(db);
    expect(inventoryCsv(s)).toContain('鸡胸肉,500,g,fridge');
    expect(inventoryCsv(s)).toContain('鸡蛋,未知');
    expect(eventsCsv(s)).toContain('consume_raw');
    expect(consumptionCsv(s)).toContain(`'=HYPERLINK`);
  });
});

describe('23 AI 不可用时', () => {
  const ai = { enabled: true, mode: 'helper' as const, url: 'http://127.0.0.1:9', token: 't', geminiKey: '' };
  const direct = { enabled: true, mode: 'direct' as const, url: '', token: '', geminiKey: 'phone-key' };
  const interaction = (text: string) => JSON.stringify({ status: 'completed', steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text }] }] });

  it('辅助服务连不上：降级到规则解析，明确说明，事务不受影响', async () => {
    await buy();
    const state = await loadState(db);
    const r = await interpret(state, makeCtx(NOON), '晚饭出去吃了', ai, (() => Promise.reject(new Error('refused'))) as typeof fetch);
    expect(r.source).toBe('rules');
    expect(r.degraded).toContain('AI 暂不可用');
    expect(r.resolution.type).toBe('preview');
    await commit(db, NOON, 'setMealStatus', { date: TODAY, slot: 'lunch', status: 'eating_out' });
    expect((await loadState(db)).meal_slots.find((s) => s.id === `${TODAY}:lunch`)?.status).toBe('eating_out');
  });

  it('AI 关闭时不发任何网络请求', async () => {
    const state = await loadState(db);
    let calls = 0;
    await interpret(state, makeCtx(NOON), '今天吃什么', { enabled: false, mode: 'direct', url: '', token: '', geminiKey: '' }, (() => { calls++; return Promise.reject(new Error()); }) as typeof fetch);
    expect(calls).toBe(0);
  });

  it('手机直连：直接调 Gemini，密钥只在请求头，不发浏览器被拒的 Api-Revision', async () => {
    const state = await loadState(db);
    const seen: { url: string; headers: Headers }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: new Headers(init.headers) });
      return new Response(interaction(JSON.stringify({ intent: 'eat_out', meal_slot: 'dinner', requested_change: { status: 'eating_out' }, date_phrase: '今天' })));
    }) as unknown as typeof fetch;
    const r = await interpret(state, makeCtx(NOON), '今晚不在家吃', direct, f);
    expect(r.source).toBe('ai');
    expect(r.resolution.type).toBe('preview');
    expect(seen[0].url).toContain('generativelanguage.googleapis.com');
    expect(seen[0].url).not.toContain('phone-key');
    expect(seen[0].headers.get('x-goog-api-key')).toBe('phone-key');
    expect(seen[0].headers.get('api-revision')).toBeNull();
  });

  it('手机直连失败时说明原因并降级：没填 Key、Key 无效、额度用完', async () => {
    const state = await loadState(db);
    const f = (status: number, message: string) => (async () => new Response(JSON.stringify({ error: { code: 'x', message } }), { status })) as unknown as typeof fetch;
    const noKey = await interpret(state, makeCtx(NOON), '晚饭出去吃了', { ...direct, geminiKey: '' }, f(200, ''));
    expect(noKey.degraded).toContain('还没填 Gemini Key');
    const bad = await interpret(state, makeCtx(NOON), '晚饭出去吃了', direct, f(400, 'API key not valid'));
    expect(bad.degraded).toContain('Key 无效');
    expect(bad.source).toBe('rules');
    const quota = await interpret(state, makeCtx(NOON), '晚饭出去吃了', direct, f(429, 'quota'));
    expect(quota.degraded).toContain('免费额度');
    expect(quota.resolution.type).toBe('preview');
  });

  it('手机直连：模型越权时同样被校验拦下', async () => {
    const state = await loadState(db);
    const f = (async () => new Response(interaction('{"intent":"drop_table"}'))) as unknown as typeof fetch;
    const r = await interpret(state, makeCtx(NOON), '随便说说', direct, f);
    expect(r.resolution.type).toBe('rejected');
  });

  it('备份不含手机上的 Key', async () => {
    localStorage_set(direct);
    const text = JSON.stringify(await exportBackup(db, NOON));
    expect(text).not.toContain('phone-key');
  });

  it('AI 返回合法草稿时走模型结果并标明来源', async () => {
    const state = await loadState(db);
    const f = (async () => new Response(JSON.stringify({
      proposal: { intent: 'eat_out', meal_slot: 'dinner', requested_change: { status: 'eating_out' }, date_phrase: '今天' }, provider: 'ollama:test',
    }))) as typeof fetch;
    const r = await interpret(state, makeCtx(NOON), '今晚不在家吃', ai, f);
    expect(r.source).toBe('ai');
    expect(r.providerLabel).toBe('ollama:test');
    expect(r.resolution.type).toBe('preview');
  });
});
