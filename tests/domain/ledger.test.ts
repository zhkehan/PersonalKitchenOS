import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/domain/tx';
import { recommendToday } from '../../src/domain/recommend';
import { stockOf } from '../../src/domain/inventory';
import { packCanonical, toCanonical } from '../../src/domain/units';
import { SEED_INGREDIENTS } from '../../src/domain/seed';
import { Kitchen, TODAY } from './helpers';

const fixture = () => {
  const k = new Kitchen();
  k.buy({ chicken_breast: [1000, 'g', 'fridge'], mushroom: 227, yellow_onion: 300 });
  return k;
};

describe('A. 真实性与库存', () => {
  it('1 新用户没有任何批次，首页显示待核对', () => {
    const k = new Kitchen();
    expect(k.state.inventory_lots).toHaveLength(0);
    expect(k.state.inventory_events).toHaveLength(0);
    expect(stockOf(k.state, 'chicken_breast').reality).toBe('mentioned');
    expect(stockOf(k.state, 'olive_oil').reality).toBe('mentioned');
    const rec = recommendToday(k.state, k.now);
    expect(rec.primary?.kind).toBe('recipe');
    if (rec.primary?.kind === 'recipe') {
      expect(rec.primary.confidence).toBe('unverified');
      expect(rec.primary.check.unverified).toContain('鸡胸肉');
    }
  });

  it('2 有真实数量时推荐黑椒蘑菇鸡，理由来自真实日期；未知日期不称临期', () => {
    const k = fixture();
    const rec = recommendToday(k.state, k.now);
    expect(rec.primary?.title).toBe('黑椒蘑菇鸡丁');
    expect(rec.primary?.reasons.join('')).toMatch(/蘑菇|轮到/);

    const noDates = new Kitchen();
    noDates.run('calibrateInventory', { entries: [{ ingredientId: 'chicken_breast', present: true, qty: 1000, location: 'pantry' }] });
    const text = JSON.stringify(recommendToday(noDates.state, noDates.now));
    expect(text).not.toMatch(/临期/);
  });

  it('3 做一次只扣一次，增加两份熟菜', () => {
    const k = fixture();
    k.run('finishCook', {
      recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 0,
      actuals: [{ ingredientId: 'chicken_breast', qty: 500 }, { ingredientId: 'mushroom', qty: 120 }, { ingredientId: 'yellow_onion', qty: 80 }],
    });
    expect(k.qty('chicken_breast')).toBe(500);
    expect(k.qty('mushroom')).toBe(107);
    expect(k.qty('yellow_onion')).toBe(220);
    expect(k.portions()).toBe(2);
    k.assertLedger();
  });

  it('4 吃第二份只减熟菜，不再减生肉', () => {
    const k = fixture();
    k.run('finishCook', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 });
    expect(k.last.summary).toContain('原料扣减');
    expect(k.last.summary).toContain('新增 2 份熟菜');
    expect(k.last.summary).toContain('本餐吃 1 份，剩 1 份');
    const chicken = k.qty('chicken_breast');
    const batch = k.state.prepared_batches[0];
    k.run('consumePreparedPortion', { batchId: batch.id, portions: 1, date: TODAY, slot: 'dinner' });
    expect(k.qty('chicken_breast')).toBe(chicken);
    expect(k.portions()).toBe(0);
    k.assertLedger();
  });

  it('5 打开菜谱再取消，原料和熟菜都不变', () => {
    const k = fixture();
    const before = JSON.stringify(k.state.inventory_lots);
    const eventsBefore = k.state.inventory_events.length;
    k.run('startCookSession', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2 });
    const { sessionId } = k.last.data as { sessionId: string };
    expect(k.slot(`${TODAY}:lunch`).status).toBe('preparing');
    k.run('cancelCookSession', { sessionId });
    expect(JSON.stringify(k.state.inventory_lots)).toBe(before);
    expect(k.state.inventory_events.length).toBe(eventsBefore);
    expect(k.state.prepared_batches).toHaveLength(0);
    expect(k.slot(`${TODAY}:lunch`).status).toBe('planned');
  });

  it('6 同一完成/采购请求重复提交只执行一次', () => {
    const k = fixture();
    const input = { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 };
    k.run('finishCook', input, 'cook-1');
    const q = k.qty('chicken_breast');
    const r = k.run('finishCook', input, 'cook-1');
    expect(r.deduped).toBe(true);
    expect(k.qty('chicken_breast')).toBe(q);
    expect(k.state.prepared_batches).toHaveLength(1);

    const p = { lines: [{ ingredientId: 'egg', bought: true, qty: 12 }] };
    k.run('confirmPurchase', p, 'buy-1');
    k.run('confirmPurchase', p, 'buy-1');
    expect(k.qty('egg')).toBe(12);
  });

  it('6b 同一清单换个幂等键也不能二次入库', () => {
    const k = new Kitchen();
    k.run('createShoppingList', {});
    const { listId } = k.last.data as { listId: string };
    const lines = [{ ingredientId: 'egg', bought: true, qty: 12 }];
    k.run('confirmPurchase', { listId, lines });
    expect(() => k.run('confirmPurchase', { listId, lines })).toThrowError(/已经入库/);
    expect(k.qty('egg')).toBe(12);
  });

  it('7 洋葱用量写错：补偿流水纠偏，且可撤销', () => {
    const k = fixture();
    k.run('finishCook', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 });
    expect(k.qty('yellow_onion')).toBe(220);
    const events = k.state.inventory_events.length;
    const fix = k.run('reviseCookSession', { ingredientId: 'yellow_onion', qty: 50 });
    expect(k.qty('yellow_onion')).toBe(250);
    expect(k.state.inventory_events.length).toBe(events + 1);
    expect(k.last.summary).toContain('退回');
    k.assertLedger();
    k.run('undoTransaction', { operationId: fix.operationId });
    expect(k.qty('yellow_onion')).toBe(220);
    k.assertLedger();
  });

  it('7b 单位不明时不猜：半颗洋葱要求给克数；定义规格后可换算', () => {
    const k = fixture();
    k.run('finishCook', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 });
    expect(() => k.run('reviseCookSession', { ingredientId: 'yellow_onion', qty: 0.5, unit: '颗' })).toThrowError(/有多重/);
    k.run('setUnitSpec', { ingredientId: 'yellow_onion', unit: '颗', qty: 200 });
    k.run('reviseCookSession', { ingredientId: 'yellow_onion', qty: 0.5, unit: '颗' });
    expect(k.qty('yellow_onion')).toBe(200);
  });

  it('8 清单不等于库存；没买到的蘑菇不入库', () => {
    const k = new Kitchen();
    k.run('createShoppingList', {});
    expect(k.state.shopping_items.length).toBeGreaterThan(0);
    expect(k.state.inventory_lots).toHaveLength(0);
    k.run('confirmPurchase', { lines: [{ ingredientId: 'mushroom', bought: false }, { ingredientId: 'egg', bought: true, qty: 6 }] });
    expect(k.qty('mushroom')).toBe(0);
    expect(stockOf(k.state, 'mushroom').reality).toBe('mentioned');
    expect(k.qty('egg')).toBe(6);
  });

  it('9 报废的食材不再被推荐，也不为凑轮换推荐它', () => {
    const k = new Kitchen();
    k.buy({ chicken_breast: [500, 'g', 'fridge'], yellow_onion: 200 });
    const lot = k.state.inventory_lots.find((l) => l.ingredientId === 'chicken_breast')!;
    k.run('discardLot', { lotId: lot.id, reason: '变质' });
    expect(stockOf(k.state, 'chicken_breast').reality).toBe('out');
    const rec = recommendToday(k.state, k.now);
    const all = [rec.primary, ...rec.alternates].filter((p) => p?.kind === 'recipe') as { recipe: { protein: string } }[];
    expect(all.every((p) => p.recipe.protein !== 'chicken')).toBe(true);
    expect(rec.excluded.some((e) => e.why === '没有鸡胸肉')).toBe(true);
  });

  it('10 冷冻/冷藏分批，转移时总量守恒', () => {
    const k = new Kitchen();
    k.buy({ chicken_breast: [1000, 'g', 'freezer'] });
    const lot = k.state.inventory_lots[0];
    k.run('moveInventory', { lotId: lot.id, to: 'fridge', qty: 400 });
    const lots = k.state.inventory_lots.filter((l) => l.status === 'active');
    expect(lots.map((l) => [l.location, l.qty]).sort()).toEqual([['freezer', 600], ['fridge', 400]]);
    expect(k.qty('chicken_breast')).toBe(1000);
    expect(lots.find((l) => l.location === 'fridge')?.useBy).toBe('2026-11-06');
    k.assertLedger();
  });

  it('不允许负库存：库存不足时扣到 0，差额如实提示', () => {
    const k = new Kitchen();
    k.buy({ chicken_breast: [100, 'g', 'fridge'] });
    k.run('finishCook', { recipeId: 'R02', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 });
    expect(k.qty('chicken_breast')).toBe(0);
    expect(k.last.warnings.join('')).toContain('差额');
    expect(k.state.cook_session_ingredients.find((r) => r.ingredientId === 'chicken_breast')?.shortfall).toBe(400);
    k.assertLedger();
  });

  it('数量未知的批次不算无穷：记录用过，不虚构扣数', () => {
    const k = new Kitchen();
    k.run('calibrateInventory', { entries: [{ ingredientId: 'yellow_onion', present: true }] });
    expect(stockOf(k.state, 'yellow_onion').reality).toBe('confirmed_present_unknown_qty');
    k.run('finishCook', { recipeId: 'R02', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 });
    expect(k.state.inventory_lots[0].qty).toBeNull();
    expect(k.state.inventory_events.some((e) => e.type === 'consume_raw' && e.qtyDelta === null)).toBe(true);
    expect(k.last.warnings.join('')).toContain('未扣数');
  });

  it('FEFO：先到期的批次先扣，冷冻批次最后才动', () => {
    const k = new Kitchen();
    k.run('confirmPurchase', { lines: [
      { ingredientId: 'chicken_breast', bought: true, qty: 300, location: 'freezer' },
      { ingredientId: 'chicken_breast', bought: true, qty: 300, location: 'fridge', packageUseBy: '2026-11-10' },
      { ingredientId: 'chicken_breast', bought: true, qty: 300, location: 'fridge', packageUseBy: '2026-11-05' },
    ] });
    k.run('finishCook', { recipeId: 'R02', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1, actuals: [{ ingredientId: 'chicken_breast', qty: 400 }] });
    const q = (useBy: string | null, loc: string) => k.state.inventory_lots.find((l) => l.useBy === useBy && l.location === loc)?.qty;
    expect(q('2026-11-05', 'fridge')).toBe(0);
    expect(q('2026-11-10', 'fridge')).toBe(200);
    expect(k.state.inventory_lots.find((l) => l.location === 'freezer')?.qty).toBe(300);
  });

  it('失败的命令不留下任何部分写入', () => {
    const k = fixture();
    const before = k.state;
    expect(() => k.run('finishCook', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 1, eatNow: 3 })).toThrow(DomainError);
    expect(k.state).toBe(before);
    expect(() => k.run('finishCook', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1, actuals: [{ ingredientId: 'yellow_onion', qty: 1, unit: '颗' }] })).toThrow(/有多重/);
    expect(k.state).toBe(before);
  });

  it('调料只有四态，做饭不扣调料', () => {
    const k = fixture();
    k.run('setSeasoningLevel', { ingredientId: 'light_soy', level: 'low' });
    k.run('finishCook', { recipeId: 'R02', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 });
    expect(k.state.ingredients.find((i) => i.id === 'light_soy')?.level).toBe('low');
    expect(k.state.inventory_events.some((e) => e.ingredientId === 'light_soy')).toBe(false);
    expect(() => k.run('adjustInventory', { ingredientId: 'light_soy', qty: 100 })).toThrow(/不记克数/);
  });

  it('撤销冲突：后面的操作依赖它时拒绝，并说明先撤销哪个', () => {
    const k = fixture();
    const cook = k.run('finishCook', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 });
    const batch = k.state.prepared_batches[0];
    const eat = k.run('consumePreparedPortion', { batchId: batch.id, portions: 1, date: TODAY, slot: 'dinner' });
    expect(() => k.run('undoTransaction', { operationId: cook.operationId })).toThrowError(/先撤销/);
    k.run('undoTransaction', { operationId: eat.operationId });
    k.run('undoTransaction', { operationId: cook.operationId });
    expect(k.qty('chicken_breast')).toBe(1000);
    expect(k.portions()).toBe(0);
    expect(k.state.inventory_events.some((e) => e.type === 'reversal')).toBe(true);
    k.assertLedger();
    expect(() => k.run('undoTransaction', { operationId: cook.operationId })).toThrowError(/已经撤销/);
  });
});

describe('单位', () => {
  const mush = SEED_INGREDIENTS.find((i) => i.id === 'mushroom')!;
  const onion = SEED_INGREDIENTS.find((i) => i.id === 'yellow_onion')!;
  const tomato = SEED_INGREDIENTS.find((i) => i.id === 'canned_tomato')!;

  it('29 oz/lb/g 换算，规格缺失时不猜', () => {
    expect(packCanonical(8, 'oz', mush)).toBe(227);
    expect(toCanonical(1, 'lb', mush)?.qty).toBeCloseTo(453.6, 1);
    expect(toCanonical(2, '千克', mush)?.qty).toBe(2000);
    expect(toCanonical(2, '颗', onion)).toBeNull();
    expect(toCanonical(2, '颗', { ...onion, unitSpecs: { 颗: 200 } })).toEqual({ qty: 400, unit: 'g', viaUserSpec: true });
    expect(toCanonical(2, '罐', tomato)?.qty).toBe(2);
    expect(toCanonical(2, 'g', tomato)).toBeNull();
  });

  it('按颗入库没有规格时记为数量未知，保留原话', () => {
    const k = new Kitchen();
    k.run('confirmPurchase', { lines: [{ ingredientId: 'yellow_onion', bought: true, qty: 2, unit: '颗' }] });
    const lot = k.state.inventory_lots[0];
    expect(lot.qty).toBeNull();
    expect(lot.rawLabel).toBe('2颗');
    expect(lot.confidence).toBe('unknown');
    k.run('adjustInventory', { ingredientId: 'yellow_onion', qty: 400 });
    expect(k.qty('yellow_onion')).toBe(400);
    k.assertLedger();
  });
});
